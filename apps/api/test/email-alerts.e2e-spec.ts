import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { OTP_SENDER } from '../src/auth/otp-sender';
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
import { bearer, CapturingOtpSender, login, uniquePhone } from './auth-helpers';
import { published, seller } from './listing-helpers';

class CapturingMailer implements PaymentMailer {
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

describe('Email alerts v1.3.1 (instant-RESERVED emails & opt-in nearby listing alerts)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const otp = new CapturingOtpSender();
  const mailer = new CapturingMailer();
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    app = await createTestApp({}, (builder) =>
      builder
        .overrideProvider(OTP_SENDER)
        .useValue(otp)
        .overrideProvider(PAYMENT_MAILER)
        .useValue(mailer),
    );
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    mailer.clear();
  });

  describe('RES-1 instant-RESERVED emails', () => {
    it('sends both seller and buyer emails for a free listing reservation and does not duplicate on idempotent replay', async () => {
      const sellerSession = await seller(app, otp, { lat: 16.051, lng: 108.211 }, 'Tiệm Bánh Miễn Phí');
      const buyerSession = await login(app, otp, uniquePhone());
      await http().patch('/api/v1/me').set(bearer(buyerSession)).send({ displayName: 'Minh Buyer' }).expect(200);

      const sellerEmail = `seller-${randomUUID().slice(0, 8)}@savemeal.test`;
      const buyerEmail = `buyer-${randomUUID().slice(0, 8)}@savemeal.test`;
      await setEmail(prisma, sellerSession.userId, sellerEmail);
      await setEmail(prisma, buyerSession.userId, buyerEmail);

      const listing = await published(app, sellerSession, {
        title: 'Bánh mì 0đ chia sẻ',
        price: 0,
        originalPrice: null,
        quantityTotal: 3,
      });

      const idempotencyKey = randomUUID();
      const first = await http()
        .post('/api/v1/reservations')
        .set(bearer(buyerSession))
        .set('Idempotency-Key', idempotencyKey)
        .send({ listingId: listing.id, quantity: 2 })
        .expect(201);

      expect(first.body.data.status).toBe('RESERVED');
      expect(first.body.data.totalPrice).toBe(0);

      expect(mailer.reservationCreatedSeller).toHaveLength(1);
      expect(mailer.reservationCreatedSeller[0]).toMatchObject({
        toEmail: sellerEmail,
        sellerName: 'Tiệm Bánh Miễn Phí',
        buyerName: 'Minh Buyer',
        listingTitle: 'Bánh mì 0đ chia sẻ',
        orderCode: first.body.data.code,
        quantity: 2,
        totalPrice: 0,
        reservationId: first.body.data.id,
      });

      expect(mailer.reservationCreatedBuyer).toHaveLength(1);
      expect(mailer.reservationCreatedBuyer[0]).toMatchObject({
        toEmail: buyerEmail,
        buyerName: 'Minh Buyer',
        sellerName: 'Tiệm Bánh Miễn Phí',
        listingTitle: 'Bánh mì 0đ chia sẻ',
        orderCode: first.body.data.code,
        quantity: 2,
        reservationId: first.body.data.id,
      });

      // Idempotent replay must NOT send duplicate emails.
      const replay = await http()
        .post('/api/v1/reservations')
        .set(bearer(buyerSession))
        .set('Idempotency-Key', idempotencyKey)
        .send({ listingId: listing.id, quantity: 2 })
        .expect(201);

      expect(replay.body.data.id).toBe(first.body.data.id);
      expect(mailer.reservationCreatedSeller).toHaveLength(1);
      expect(mailer.reservationCreatedBuyer).toHaveLength(1);
    });
  });

  describe('ME-2 & ME-3 nearbyAlerts settings', () => {
    it('validates coords when enabled, rounds lat/lng to 2 decimals, clears on disable, and clears on DELETE /me', async () => {
      const user = await login(app, otp, uniquePhone());

      // Defaults on GET /me
      const initial = await http().get('/api/v1/me').set(bearer(user)).expect(200);
      expect(initial.body.data.nearbyAlerts).toEqual({
        enabled: false,
        lat: null,
        lng: null,
        radiusKm: 3,
      });

      // Reject enabled: true without coordinates
      const missingCoords = await http()
        .patch('/api/v1/me')
        .set(bearer(user))
        .send({ nearbyAlerts: { enabled: true } })
        .expect(400);
      expect(missingCoords.body.error.code).toBe('VALIDATION_FAILED');

      // Reject invalid radiusKm
      await http()
        .patch('/api/v1/me')
        .set(bearer(user))
        .send({ nearbyAlerts: { enabled: true, lat: 16.0544, lng: 108.2022, radiusKm: 10 } })
        .expect(400);

      // Enable with precise coordinates -> rounded to 2 decimal places
      const enabled = await http()
        .patch('/api/v1/me')
        .set(bearer(user))
        .send({ nearbyAlerts: { enabled: true, lat: 16.0544123, lng: 108.2022987, radiusKm: 5 } })
        .expect(200);
      expect(enabled.body.data.nearbyAlerts).toEqual({
        enabled: true,
        lat: 16.05,
        lng: 108.2,
        radiusKm: 5,
      });

      // Disable -> clears lat & lng to null
      const disabled = await http()
        .patch('/api/v1/me')
        .set(bearer(user))
        .send({ nearbyAlerts: { enabled: false } })
        .expect(200);
      expect(disabled.body.data.nearbyAlerts).toEqual({
        enabled: false,
        lat: null,
        lng: null,
        radiusKm: 5,
      });

      // Re-enable, then DELETE /me -> clears nearbyAlerts columns in DB
      await http()
        .patch('/api/v1/me')
        .set(bearer(user))
        .send({ nearbyAlerts: { enabled: true, lat: 16.05, lng: 108.2, radiusKm: 3 } })
        .expect(200);

      await http().delete('/api/v1/me').set(bearer(user)).send({ confirm: 'XOA TAI KHOAN' }).expect(204);

      const deletedRow = await prisma.account.findUniqueOrThrow({
        where: { id: user.userId },
        select: {
          nearbyAlertsEnabled: true,
          nearbyAlertLat: true,
          nearbyAlertLng: true,
          nearbyAlertLastSentAt: true,
        },
      });
      expect(deletedRow).toEqual({
        nearbyAlertsEnabled: false,
        nearbyAlertLat: null,
        nearbyAlertLng: null,
        nearbyAlertLastSentAt: null,
      });
    });
  });

  describe('LIST-6 publish nearby alerts', () => {
    it('notifies opted-in nearby users within radiusKm, skips seller and far users, and respects 2-hour cooldown', async () => {
      // Listing area: (16.05, 108.20)
      const sellerSession = await seller(app, otp, { lat: 16.05, lng: 108.2 }, 'Bếp Xanh Đà Nẵng');
      const sellerEmail = `seller-nearby-${randomUUID().slice(0, 8)}@savemeal.test`;
      await setEmail(prisma, sellerSession.userId, sellerEmail);
      // Even if the seller also opts into nearby alerts at the same coords, they must be skipped.
      await http()
        .patch('/api/v1/me')
        .set(bearer(sellerSession))
        .send({ nearbyAlerts: { enabled: true, lat: 16.05, lng: 108.2, radiusKm: 5 } })
        .expect(200);

      // Nearby user within 1 km (~0 km from 16.05, 108.20)
      const nearbyUser = await login(app, otp, uniquePhone());
      const nearbyEmail = `nearby-${randomUUID().slice(0, 8)}@savemeal.test`;
      await setEmail(prisma, nearbyUser.userId, nearbyEmail);
      await http()
        .patch('/api/v1/me')
        .set(bearer(nearbyUser))
        .send({ displayName: 'Lan Nearby', nearbyAlerts: { enabled: true, lat: 16.054, lng: 108.202, radiusKm: 1 } })
        .expect(200);

      // Far user (~11 km north at 16.15, 108.20, radiusKm = 3)
      const farUser = await login(app, otp, uniquePhone());
      const farEmail = `far-${randomUUID().slice(0, 8)}@savemeal.test`;
      await setEmail(prisma, farUser.userId, farEmail);
      await http()
        .patch('/api/v1/me')
        .set(bearer(farUser))
        .send({ displayName: 'Nam Far', nearbyAlerts: { enabled: true, lat: 16.15, lng: 108.2, radiusKm: 3 } })
        .expect(200);

      // First publish -> only nearbyUser receives the alert
      const firstListing = await published(app, sellerSession, {
        title: 'Cơm trưa nóng hổi',
        price: 15_000,
        originalPrice: 30_000,
        quantityTotal: 4,
      });

      const alertsForFirst = mailer.nearbyListingAlerts.filter((a) => a.listingId === firstListing.id);
      expect(alertsForFirst.map((a) => a.toEmail)).toEqual([nearbyEmail]);
      expect(alertsForFirst[0]).toMatchObject({
        toEmail: nearbyEmail,
        recipientName: 'Lan Nearby',
        listingId: firstListing.id,
        listingTitle: 'Cơm trưa nóng hổi',
        sellerName: 'Bếp Xanh Đà Nẵng',
        price: 15_000,
        quantityAvailable: 4,
      });
      expect(alertsForFirst[0]!.distanceKm).toBeLessThanOrEqual(1);

      // Second publish immediately after -> nearbyUser is within 2-hour cooldown and must NOT be alerted again
      mailer.clear();
      const secondListing = await published(app, sellerSession, {
        title: 'Bánh ngọt chiều',
        price: 0,
        originalPrice: null,
        quantityTotal: 2,
      });

      const alertsForSecond = mailer.nearbyListingAlerts.filter((a) => a.listingId === secondListing.id);
      expect(alertsForSecond.find((a) => a.toEmail === nearbyEmail)).toBeUndefined();
      expect(alertsForSecond.find((a) => a.toEmail === sellerEmail)).toBeUndefined();
      expect(alertsForSecond.find((a) => a.toEmail === farEmail)).toBeUndefined();
    });
  });
});

async function setEmail(prisma: PrismaService, accountId: string, email: string): Promise<void> {
  await prisma.account.update({ where: { id: accountId }, data: { email } });
}
