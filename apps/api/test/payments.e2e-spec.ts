import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { OTP_SENDER } from '../src/auth/otp-sender';
import { AppConfig } from '../src/config/app-config';
import { parseEnv } from '../src/config/env';
import {
  PAYMENT_MAILER,
  type NearbyListingAlertEmailParams,
  type PaymentConfirmedEmailParams,
  type PaymentMailer,
  type PaymentRejectedEmailParams,
  type ProofSubmittedEmailParams,
  type ReservationCreatedBuyerEmailParams,
  type ReservationCreatedSellerEmailParams,
} from '../src/payments/payment-mailer';
import { PrismaService } from '../src/prisma/prisma.service';
import { createTestApp } from './app';
import { bearer, CapturingOtpSender, login, uniquePhone, type Session } from './auth-helpers';
import { completeInput, DECLARATION, draft, published, seller, uploadImage } from './listing-helpers';

const HOUR = 3600_000;
const MINUTE = 60_000;

class CapturingPaymentMailer implements PaymentMailer {
  readonly proofSubmitted: ProofSubmittedEmailParams[] = [];
  readonly confirmed: PaymentConfirmedEmailParams[] = [];
  readonly rejected: PaymentRejectedEmailParams[] = [];
  readonly reservationCreatedSeller: ReservationCreatedSellerEmailParams[] = [];
  readonly reservationCreatedBuyer: ReservationCreatedBuyerEmailParams[] = [];
  readonly nearbyListingAlerts: NearbyListingAlertEmailParams[] = [];

  async sendProofSubmittedToSeller(params: ProofSubmittedEmailParams): Promise<void> {
    this.proofSubmitted.push(params);
  }

  async sendPaymentConfirmedToBuyer(params: PaymentConfirmedEmailParams): Promise<void> {
    this.confirmed.push(params);
  }

  async sendPaymentRejectedToBuyer(params: PaymentRejectedEmailParams): Promise<void> {
    this.rejected.push(params);
  }

  async sendReservationCreatedToSeller(params: ReservationCreatedSellerEmailParams): Promise<void> {
    this.reservationCreatedSeller.push(params);
  }

  async sendReservationCreatedToBuyer(params: ReservationCreatedBuyerEmailParams): Promise<void> {
    this.reservationCreatedBuyer.push(params);
  }

  async sendNearbyListingAlert(params: NearbyListingAlertEmailParams): Promise<void> {
    this.nearbyListingAlerts.push(params);
  }

  clear(): void {
    this.proofSubmitted.length = 0;
    this.confirmed.length = 0;
    this.rejected.length = 0;
    this.reservationCreatedSeller.length = 0;
    this.reservationCreatedBuyer.length = 0;
    this.nearbyListingAlerts.length = 0;
  }
}

async function createPaymentsApp(): Promise<{
  app: INestApplication;
  otp: CapturingOtpSender;
  mailer: CapturingPaymentMailer;
}> {
  const otp = new CapturingOtpSender();
  const mailer = new CapturingPaymentMailer();
  const config = new AppConfig(
    parseEnv({
      ...process.env,
      PAYMENTS_ENABLED: 'true',
    }),
  );
  const app = await createTestApp({}, (builder) =>
    builder
      .overrideProvider(OTP_SENDER)
      .useValue(otp)
      .overrideProvider(PAYMENT_MAILER)
      .useValue(mailer)
      .overrideProvider(AppConfig)
      .useValue(config),
  );
  return { app, otp, mailer };
}

async function setEmail(prisma: PrismaService, accountId: string, email: string): Promise<void> {
  await prisma.account.update({ where: { id: accountId }, data: { email } });
}

async function createSellerWithQr(
  app: INestApplication,
  otp: CapturingOtpSender,
  prisma: PrismaService,
  at: { lat: number; lng: number },
  name: string,
): Promise<{ session: Session; qrImageId: string; email: string }> {
  const s = await seller(app, otp, at, name);
  const email = `seller-${randomUUID().slice(0, 8)}@savemeal.test`;
  await setEmail(prisma, s.userId, email);
  const qrImageId = await uploadImage(app, s, 'PAYMENT_QR');
  const patchRes = await request(app.getHttpServer())
    .patch('/api/v1/me')
    .set(bearer(s))
    .send({ seller: { bankQrImageId: qrImageId } })
    .expect(200);
  expect(patchRes.body.data.seller.bankQrImage?.id).toBe(qrImageId);
  return { session: s, qrImageId, email };
}

describe('Payments v1.3 (P2P Direct Bank QR + Proof + Resend Email)', () => {
  let app: INestApplication;
  let otp: CapturingOtpSender;
  let mailer: CapturingPaymentMailer;
  let prisma: PrismaService;

  beforeAll(async () => {
    ({ app, otp, mailer } = await createPaymentsApp());
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    mailer.clear();
  });

  it('requires PAYMENT_QR to publish a paid listing when PAYMENTS_ENABLED=true, and allows free listings without one', async () => {
    const s = await seller(app, otp, { lat: 16.051, lng: 108.211 }, 'Tiệm chưa có QR');
    const paidDraft = await draft(app, s, { price: 15_000, originalPrice: 25_000, quantityTotal: 3 });
    expect(paidDraft.missing).toContain('PAYMENT_QR');

    const failPub = await request(app.getHttpServer())
      .post(`/api/v1/listings/${paidDraft.id}/publish`)
      .set(bearer(s))
      .send({ declaration: DECLARATION })
      .expect(422);
    expect(failPub.body.error.code).toBe('LISTING_INCOMPLETE');
    expect(failPub.body.error.details.missing).toContain('PAYMENT_QR');

    // Attaching a PAYMENT_QR image via LIST-4 also backfills account default and unblocks publish.
    const qrImageId = await uploadImage(app, s, 'PAYMENT_QR');
    const updatedDraft = await request(app.getHttpServer())
      .patch(`/api/v1/listings/${paidDraft.id}`)
      .set(bearer(s))
      .send({ bankQrImageId: qrImageId })
      .expect(200);
    expect(updatedDraft.body.data.bankQrImage?.id).toBe(qrImageId);
    expect(updatedDraft.body.data.missing).toEqual([]);

    const meRes = await request(app.getHttpServer()).get('/api/v1/me').set(bearer(s)).expect(200);
    expect(meRes.body.data.seller.bankQrImage?.id).toBe(qrImageId);

    await request(app.getHttpServer())
      .post(`/api/v1/listings/${paidDraft.id}/publish`)
      .set(bearer(s))
      .send({ declaration: DECLARATION })
      .expect(200);

    // Deleting an in-use PAYMENT_QR image returns 409 IMAGE_IN_USE.
    const delQr = await request(app.getHttpServer())
      .delete(`/api/v1/images/${qrImageId}`)
      .set(bearer(s))
      .expect(409);
    expect(delQr.body.error.code).toBe('IMAGE_IN_USE');

    // Free listing without QR publishes and skips PENDING_PAYMENT.
    const sFree = await seller(app, otp, { lat: 16.0512, lng: 108.2112 }, 'Tiệm miễn phí');
    const freeListing = await published(app, sFree, { price: 0, originalPrice: null, quantityTotal: 2 });
    const b = await login(app, otp, uniquePhone());
    const freeRes = await request(app.getHttpServer())
      .post('/api/v1/reservations')
      .set(bearer(b))
      .set('Idempotency-Key', randomUUID())
      .send({ listingId: freeListing.id, quantity: 1 })
      .expect(201);

    expect(freeRes.body.data.status).toBe('RESERVED');
    expect(freeRes.body.data.platformFee).toBe(0);
    expect(freeRes.body.data.payableAmount).toBe(0);
    expect(freeRes.body.data.payment).toBeNull();
    expect(freeRes.body.data.pickupToken?.qrPayload).toMatch(/^SM1\./);
  });

  it('validates holdMinutes (< 5 or exceeding pickupEnd → 422 PAYMENT_HOLD_INVALID)', async () => {
    const { session: s } = await createSellerWithQr(app, otp, prisma, { lat: 16.052, lng: 108.212 }, 'Tiệm Hold');
    const b = await login(app, otp, uniquePhone());
    const now = Date.now();
    const img = await uploadImage(app, s);
    const created = await request(app.getHttpServer())
      .post('/api/v1/listings')
      .set(bearer(s))
      .send(
        completeInput([img], {
          price: 15_000,
          pickupStart: new Date(now + 2 * MINUTE).toISOString(),
          pickupEnd: new Date(now + 20 * MINUTE).toISOString(),
        }),
      )
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/v1/listings/${created.body.data.id}/publish`)
      .set(bearer(s))
      .send({ declaration: DECLARATION })
      .expect(200);

    const tooShort = await request(app.getHttpServer())
      .post('/api/v1/reservations')
      .set(bearer(b))
      .set('Idempotency-Key', randomUUID())
      .send({ listingId: created.body.data.id, quantity: 1, holdMinutes: 4 })
      .expect(422);
    expect(tooShort.body.error.code).toBe('PAYMENT_HOLD_INVALID');

    const pastPickupEnd = await request(app.getHttpServer())
      .post('/api/v1/reservations')
      .set(bearer(b))
      .set('Idempotency-Key', randomUUID())
      .send({ listingId: created.body.data.id, quantity: 1, holdMinutes: 30 })
      .expect(422);
    expect(pastPickupEnd.body.error.code).toBe('PAYMENT_HOLD_INVALID');
  });

  it('completes full P2P flow: RES-1 → PAY-2 proof (+ seller email) → PAY-3 confirm (+ buyer email) → RES-6/7/8 handover', async () => {
    const { session: s, qrImageId, email: sellerEmail } = await createSellerWithQr(
      app,
      otp,
      prisma,
      { lat: 16.053, lng: 108.213 },
      'Tiệm Bánh P2P',
    );
    const b = await login(app, otp, uniquePhone());
    const buyerEmail = `buyer-${randomUUID().slice(0, 8)}@savemeal.test`;
    await setEmail(prisma, b.userId, buyerEmail);

    const now = Date.now();
    const listing = await published(app, s, {
      price: 15_000,
      originalPrice: 25_000,
      quantityTotal: 5,
      pickupStart: new Date(now - 5 * MINUTE).toISOString(),
      pickupEnd: new Date(now + 2 * HOUR).toISOString(),
    });

    // RES-1: creates PENDING_PAYMENT with 0 fee, sellerQrImage, and pickupToken = null.
    const res1 = await request(app.getHttpServer())
      .post('/api/v1/reservations')
      .set(bearer(b))
      .set('Idempotency-Key', randomUUID())
      .send({ listingId: listing.id, quantity: 1 })
      .expect(201);

    const reservationId = res1.body.data.id as string;
    expect(res1.body.data.status).toBe('PENDING_PAYMENT');
    expect(res1.body.data.platformFee).toBe(0);
    expect(res1.body.data.payableAmount).toBe(15_000);
    expect(res1.body.data.pickupToken).toBeNull();
    expect(res1.body.data.payment).toMatchObject({
      reservationId,
      status: 'UNPAID',
      amount: 15_000,
      proofImage: null,
      proofSubmittedAt: null,
      confirmedAt: null,
      rejectedAt: null,
      rejectReason: null,
    });
    expect(res1.body.data.payment.sellerQrImage?.id).toBe(qrImageId);

    // PAY-1: buyer and seller can both read payment.
    const pay1 = await request(app.getHttpServer())
      .get(`/api/v1/reservations/${reservationId}/payment`)
      .set(bearer(b))
      .expect(200);
    expect(pay1.body.data.status).toBe('UNPAID');
    expect(pay1.body.data.sellerQrImage?.id).toBe(qrImageId);

    // PAY-2: missing proofImageId → 422 PROOF_REQUIRED.
    const missingProof = await request(app.getHttpServer())
      .post(`/api/v1/reservations/${reservationId}/payment-proof`)
      .set(bearer(b))
      .send({})
      .expect(422);
    expect(missingProof.body.error.code).toBe('PROOF_REQUIRED');

    // PAY-2: valid PAYMENT_PROOF image → AWAITING_SELLER_CONFIRM + seller email captured.
    const proofImageId = await uploadImage(app, b, 'PAYMENT_PROOF');
    const pay2 = await request(app.getHttpServer())
      .post(`/api/v1/reservations/${reservationId}/payment-proof`)
      .set(bearer(b))
      .send({ proofImageId })
      .expect(200);

    expect(pay2.body.data.status).toBe('AWAITING_SELLER_CONFIRM');
    expect(pay2.body.data.pickupToken).toBeNull();
    expect(pay2.body.data.payment.status).toBe('PROOF_SUBMITTED');
    expect(pay2.body.data.payment.proofImage?.id).toBe(proofImageId);
    expect(pay2.body.data.payment.proofSubmittedAt).toBeTruthy();

    expect(mailer.proofSubmitted).toHaveLength(1);
    expect(mailer.proofSubmitted[0]!.toEmail).toBe(sellerEmail);
    expect(mailer.proofSubmitted[0]!.amount).toBe(15_000);

    // Lazy-expiry must NOT expire AWAITING_SELLER_CONFIRM even if payment_expires_at is in the past.
    await prisma.reservation.update({
      where: { id: reservationId },
      data: { paymentExpiresAt: new Date(Date.now() - 5 * MINUTE) },
    });
    const afterWait = await request(app.getHttpServer())
      .get(`/api/v1/reservations/${reservationId}`)
      .set(bearer(b))
      .expect(200);
    expect(afterWait.body.data.status).toBe('AWAITING_SELLER_CONFIRM');

    // RES-2 upcoming includes AWAITING_SELLER_CONFIRM.
    const upcoming = await request(app.getHttpServer())
      .get('/api/v1/me/reservations?tab=upcoming')
      .set(bearer(b))
      .expect(200);
    expect(upcoming.body.data.some((r: { id: string }) => r.id === reservationId)).toBe(true);

    // PAY-3: non-seller (buyer) cannot confirm → 404 RESERVATION_NOT_FOUND.
    await request(app.getHttpServer())
      .post(`/api/v1/reservations/${reservationId}/payment/confirm`)
      .set(bearer(b))
      .expect(404);

    // PAY-3: seller confirms → RESERVED, payment CONFIRMED, buyer email captured.
    const pay3 = await request(app.getHttpServer())
      .post(`/api/v1/reservations/${reservationId}/payment/confirm`)
      .set(bearer(s))
      .expect(200);
    expect(pay3.body.data.status).toBe('RESERVED');
    expect(pay3.body.data.payment.status).toBe('CONFIRMED');
    expect(pay3.body.data.payment.confirmedAt).toBeTruthy();

    expect(mailer.confirmed).toHaveLength(1);
    expect(mailer.confirmed[0]!.toEmail).toBe(buyerEmail);
    expect(mailer.confirmed[0]!.reservationId).toBe(reservationId);

    // RES-6: buyer fetches/rotates pickup QR.
    const qrRes = await request(app.getHttpServer())
      .post(`/api/v1/reservations/${reservationId}/pickup-token`)
      .set(bearer(b))
      .expect(201);
    const qrPayload = qrRes.body.data.qrPayload as string;
    expect(qrPayload).toMatch(/^SM1\./);

    // RES-7: lookup shows amountToCollect = 0 because payment is CONFIRMED.
    const lookup = await request(app.getHttpServer())
      .post('/api/v1/pickups/lookup')
      .set(bearer(s))
      .send({ qrPayload })
      .expect(200);
    expect(lookup.body.data.amountToCollect).toBe(0);
    expect(lookup.body.data.canConfirm).toBe(true);

    // RES-8: handover completes order.
    const confirm = await request(app.getHttpServer())
      .post('/api/v1/pickups/confirm')
      .set(bearer(s))
      .send({ reservationId, qrPayload })
      .expect(200);
    expect(confirm.body.data.reservation.status).toBe('COMPLETED');
    expect(confirm.body.data.listingRemaining).toBe(4);
  });

  it('handles PAY-4 seller rejection: CANCELLED (PAYMENT_REJECTED), stock released, buyer email captured, re-confirm returns 409', async () => {
    const { session: s } = await createSellerWithQr(
      app,
      otp,
      prisma,
      { lat: 16.054, lng: 108.214 },
      'Tiệm Từ Chối',
    );
    const b = await login(app, otp, uniquePhone());
    const buyerEmail = `buyer-rej-${randomUUID().slice(0, 8)}@savemeal.test`;
    await setEmail(prisma, b.userId, buyerEmail);

    const listing = await published(app, s, { price: 20_000, originalPrice: 35_000, quantityTotal: 4 });
    const res1 = await request(app.getHttpServer())
      .post('/api/v1/reservations')
      .set(bearer(b))
      .set('Idempotency-Key', randomUUID())
      .send({ listingId: listing.id, quantity: 2 })
      .expect(201);
    const reservationId = res1.body.data.id as string;

    const proofId = await uploadImage(app, b, 'PAYMENT_PROOF');
    await request(app.getHttpServer())
      .post(`/api/v1/reservations/${reservationId}/payment-proof`)
      .set(bearer(b))
      .send({ proofImageId: proofId })
      .expect(200);

    // Stock is currently 4 - 2 = 2.
    const midListing = await request(app.getHttpServer())
      .get(`/api/v1/listings/${listing.id}`)
      .set(bearer(s))
      .expect(200);
    expect(midListing.body.data.quantityAvailable).toBe(2);

    // PAY-4: reject with reason.
    const rej = await request(app.getHttpServer())
      .post(`/api/v1/reservations/${reservationId}/payment/reject`)
      .set(bearer(s))
      .send({ reason: 'Chưa thấy tiền vào tài khoản sau khi kiểm tra' })
      .expect(200);

    expect(rej.body.data.status).toBe('CANCELLED');
    expect(rej.body.data.cancelReason).toBe('PAYMENT_REJECTED');
    expect(rej.body.data.payment.status).toBe('REJECTED');
    expect(rej.body.data.payment.rejectReason).toBe('Chưa thấy tiền vào tài khoản sau khi kiểm tra');
    expect(rej.body.data.payment.rejectedAt).toBeTruthy();

    // Stock returned atomically: 2 -> 4.
    const afterListing = await request(app.getHttpServer())
      .get(`/api/v1/listings/${listing.id}`)
      .set(bearer(s))
      .expect(200);
    expect(afterListing.body.data.quantityAvailable).toBe(4);

    // Buyer email captured.
    expect(mailer.rejected).toHaveLength(1);
    expect(mailer.rejected[0]!.toEmail).toBe(buyerEmail);
    expect(mailer.rejected[0]!.reason).toBe('Chưa thấy tiền vào tài khoản sau khi kiểm tra');

    // Re-confirming a rejected payment returns 409 PAYMENT_NOT_CONFIRMABLE.
    const reconfirm = await request(app.getHttpServer())
      .post(`/api/v1/reservations/${reservationId}/payment/confirm`)
      .set(bearer(s))
      .expect(409);
    expect(reconfirm.body.error.code).toBe('PAYMENT_NOT_CONFIRMABLE');
  });

  it('lazy-expires overdue PENDING_PAYMENT holds and releases stock back to listing', async () => {
    const { session: s } = await createSellerWithQr(
      app,
      otp,
      prisma,
      { lat: 16.055, lng: 108.215 },
      'Tiệm Lazy Expire',
    );
    const b = await login(app, otp, uniquePhone());
    const listing = await published(app, s, { price: 15_000, originalPrice: 25_000, quantityTotal: 2 });

    const res1 = await request(app.getHttpServer())
      .post('/api/v1/reservations')
      .set(bearer(b))
      .set('Idempotency-Key', randomUUID())
      .send({ listingId: listing.id, quantity: 2 })
      .expect(201);
    const reservationId = res1.body.data.id as string;

    // Force hold expiry in the past.
    await prisma.reservation.update({
      where: { id: reservationId },
      data: { paymentExpiresAt: new Date(Date.now() - MINUTE) },
    });

    // Reading the reservation triggers lazy-expiry.
    const resGet = await request(app.getHttpServer())
      .get(`/api/v1/reservations/${reservationId}`)
      .set(bearer(b))
      .expect(200);
    expect(resGet.body.data.status).toBe('EXPIRED');
    expect(resGet.body.data.payment.status).toBe('EXPIRED');

    // Stock is back to 2.
    const afterListing = await request(app.getHttpServer())
      .get(`/api/v1/listings/${listing.id}`)
      .set(bearer(s))
      .expect(200);
    expect(afterListing.body.data.quantityAvailable).toBe(2);
  });
});
