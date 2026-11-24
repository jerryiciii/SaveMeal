import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { OTP_SENDER } from '../src/auth/otp-sender';
import { AppConfig } from '../src/config/app-config';
import { parseEnv } from '../src/config/env';
import { PrismaService } from '../src/prisma/prisma.service';
import { createTestApp } from './app';
import { bearer, CapturingOtpSender, login, uniquePhone, type Session } from './auth-helpers';
import { published, seller } from './listing-helpers';

const SEPAY_SECRET = 'test_sepay_webhook_secret_987654';
const HOUR = 3600_000;
const MINUTE = 60_000;

async function createPaymentsApp(provider: 'mock' | 'sepay'): Promise<{
  app: INestApplication;
  otp: CapturingOtpSender;
}> {
  const otp = new CapturingOtpSender();
  const config = new AppConfig(
    parseEnv({
      ...process.env,
      PAYMENTS_ENABLED: 'true',
      PAYMENT_PROVIDER: provider,
      ...(provider === 'sepay'
        ? {
            SEPAY_BANK_CODE: 'MB',
            SEPAY_ACCOUNT_NO: '0123456789',
            SEPAY_ACCOUNT_NAME: 'SAVEMEAL PILOT',
            SEPAY_WEBHOOK_SECRET: SEPAY_SECRET,
          }
        : {}),
    }),
  );
  const app = await createTestApp({}, (builder) =>
    builder
      .overrideProvider(OTP_SENDER)
      .useValue(otp)
      .overrideProvider(AppConfig)
      .useValue(config),
  );
  return { app, otp };
}

async function createAdmin(app: INestApplication, otp: CapturingOtpSender): Promise<Session> {
  const session = await login(app, otp, uniquePhone());
  await app.get(PrismaService).account.update({
    where: { id: session.userId },
    data: { role: 'ADMIN', displayName: 'Admin Pilot' },
  });
  return session;
}

describe('Payments v1.2 (mock provider)', () => {
  let app: INestApplication;
  let otp: CapturingOtpSender;
  let prisma: PrismaService;

  beforeAll(async () => {
    ({ app, otp } = await createPaymentsApp('mock'));
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  it('skips PENDING_PAYMENT for free listings (price = 0)', async () => {
    const s = await seller(app, otp, { lat: 16.051, lng: 108.211 }, 'Tiệm miễn phí');
    const b = await login(app, otp, uniquePhone());
    const listing = await published(app, s, { price: 0, originalPrice: null, quantityTotal: 3 });

    const res = await request(app.getHttpServer())
      .post('/api/v1/reservations')
      .set(bearer(b))
      .set('Idempotency-Key', randomUUID())
      .send({ listingId: listing.id, quantity: 1 })
      .expect(201);

    expect(res.body.data.status).toBe('RESERVED');
    expect(res.body.data.platformFee).toBe(0);
    expect(res.body.data.payableAmount).toBe(0);
    expect(res.body.data.payment).toBeNull();
    expect(res.body.data.pickupToken?.qrPayload).toMatch(/^SM1\./);
  });

  it('computes flat 2.000đ fee for paid orders ≤ 20k and 5% fee for orders > 20k', async () => {
    const s = await seller(app, otp, { lat: 16.052, lng: 108.212 }, 'Tiệm phí');
    const b1 = await login(app, otp, uniquePhone());
    const b2 = await login(app, otp, uniquePhone());

    const listing15k = await published(app, s, { price: 15_000, originalPrice: 25_000, quantityTotal: 5 });
    const r1 = await request(app.getHttpServer())
      .post('/api/v1/reservations')
      .set(bearer(b1))
      .set('Idempotency-Key', randomUUID())
      .send({ listingId: listing15k.id, quantity: 1 })
      .expect(201);

    expect(r1.body.data.status).toBe('PENDING_PAYMENT');
    expect(r1.body.data.platformFee).toBe(2_000);
    expect(r1.body.data.payableAmount).toBe(17_000);
    expect(r1.body.data.pickupToken).toBeNull();
    expect(r1.body.data.payment).toMatchObject({
      provider: 'MOCK',
      status: 'UNPAID',
      payoutStatus: 'NONE',
      foodAmount: 15_000,
      platformFee: 2_000,
      payableAmount: 17_000,
      sellerNet: 15_000,
    });
    expect(r1.body.data.payment.transferContent).toMatch(/^SM[A-Z0-9]{8}$/);

    // PAY-1: buyer can fetch payment; unrelated buyer gets 404
    const p1 = await request(app.getHttpServer())
      .get(`/api/v1/reservations/${r1.body.data.id}/payment`)
      .set(bearer(b1))
      .expect(200);
    expect(p1.body.data.id).toBe(r1.body.data.payment.id);

    await request(app.getHttpServer())
      .get(`/api/v1/reservations/${r1.body.data.id}/payment`)
      .set(bearer(b2))
      .expect(404);

    // > 20k: 30.000đ -> 5% = 1.500đ, payableAmount = 31.500đ
    const listing30k = await published(app, s, { price: 30_000, originalPrice: 50_000, quantityTotal: 5 });
    const r2 = await request(app.getHttpServer())
      .post('/api/v1/reservations')
      .set(bearer(b2))
      .set('Idempotency-Key', randomUUID())
      .send({ listingId: listing30k.id, quantity: 1 })
      .expect(201);

    expect(r2.body.data.status).toBe('PENDING_PAYMENT');
    expect(r2.body.data.platformFee).toBe(1_500);
    expect(r2.body.data.payableAmount).toBe(31_500);
  });

  it('rejects holdMinutes < 5 or exceeding pickupEnd with 422 PAYMENT_HOLD_INVALID', async () => {
    const s = await seller(app, otp, { lat: 16.053, lng: 108.213 }, 'Tiệm giữ chỗ');
    const b = await login(app, otp, uniquePhone());
    const now = Date.now();
    const listing = await published(app, s, {
      price: 15_000,
      quantityTotal: 4,
      pickupStart: new Date(now + 10 * MINUTE).toISOString(),
      pickupEnd: new Date(now + 20 * MINUTE).toISOString(),
    });

    const tooShort = await request(app.getHttpServer())
      .post('/api/v1/reservations')
      .set(bearer(b))
      .set('Idempotency-Key', randomUUID())
      .send({ listingId: listing.id, quantity: 1, holdMinutes: 4 })
      .expect(422);
    expect(tooShort.body.error.code).toBe('PAYMENT_HOLD_INVALID');

    const tooLong = await request(app.getHttpServer())
      .post('/api/v1/reservations')
      .set(bearer(b))
      .set('Idempotency-Key', randomUUID())
      .send({ listingId: listing.id, quantity: 1, holdMinutes: 30 })
      .expect(422);
    expect(tooLong.body.error.code).toBe('PAYMENT_HOLD_INVALID');
  });

  it('lazy-expires overdue PENDING_PAYMENT on GET /reservations/:id and GET /listings, releasing stock', async () => {
    const s = await seller(app, otp, { lat: 16.054, lng: 108.214 }, 'Tiệm lazy expiry');
    const b1 = await login(app, otp, uniquePhone());
    const b2 = await login(app, otp, uniquePhone());
    const listing = await published(app, s, { price: 15_000, quantityTotal: 5 });

    // 1) Lazy-expiry triggered by GET /reservations/:id
    const r1 = await request(app.getHttpServer())
      .post('/api/v1/reservations')
      .set(bearer(b1))
      .set('Idempotency-Key', randomUUID())
      .send({ listingId: listing.id, quantity: 2 })
      .expect(201);

    const beforeExpiry = await prisma.foodListing.findUnique({ where: { id: listing.id } });
    expect(beforeExpiry?.quantityAvailable).toBe(3);

    await prisma.reservation.update({
      where: { id: r1.body.data.id },
      data: { paymentExpiresAt: new Date(Date.now() - 60_000) },
    });

    const getRes = await request(app.getHttpServer())
      .get(`/api/v1/reservations/${r1.body.data.id}`)
      .set(bearer(b1))
      .expect(200);
    expect(getRes.body.data.status).toBe('EXPIRED');
    expect(getRes.body.data.payment.status).toBe('EXPIRED');

    const afterExpiry = await prisma.foodListing.findUnique({ where: { id: listing.id } });
    expect(afterExpiry?.quantityAvailable).toBe(5);

    // 2) Lazy-expiry triggered by GET /listings
    const r2 = await request(app.getHttpServer())
      .post('/api/v1/reservations')
      .set(bearer(b2))
      .set('Idempotency-Key', randomUUID())
      .send({ listingId: listing.id, quantity: 1 })
      .expect(201);

    await prisma.reservation.update({
      where: { id: r2.body.data.id },
      data: { paymentExpiresAt: new Date(Date.now() - 60_000) },
    });

    const search = await request(app.getHttpServer())
      .get('/api/v1/listings')
      .query({ lat: 16.054, lng: 108.214, radiusKm: 1 })
      .expect(200);
    const found = (search.body.data as { id: string; quantityAvailable: number }[]).find((l) => l.id === listing.id);
    expect(found?.quantityAvailable).toBe(5);

    const r2Db = await prisma.reservation.findUnique({
      where: { id: r2.body.data.id },
      include: { payment: true },
    });
    expect(r2Db?.status).toBe('EXPIRED');
    expect(r2Db?.payment?.status).toBe('EXPIRED');
  });

  it('supports PAY-DEV simulate, handover (amountToCollect=0), payouts, payout account, and admin settle', async () => {
    const s = await seller(app, otp, { lat: 16.055, lng: 108.215 }, 'Tiệm mô phỏng');
    const b = await login(app, otp, uniquePhone());
    const admin = await createAdmin(app, otp);

    const now = Date.now();
    const listing = await published(app, s, {
      price: 15_000,
      originalPrice: 25_000,
      quantityTotal: 4,
      pickupStart: new Date(now + 5 * MINUTE).toISOString(),
      pickupEnd: new Date(now + 1.5 * HOUR).toISOString(),
    });

    const created = await request(app.getHttpServer())
      .post('/api/v1/reservations')
      .set(bearer(b))
      .set('Idempotency-Key', randomUUID())
      .send({ listingId: listing.id, quantity: 2 })
      .expect(201);
    const reservationId = created.body.data.id as string;
    expect(created.body.data.status).toBe('PENDING_PAYMENT');
    expect(created.body.data.totalPrice).toBe(30_000);
    expect(created.body.data.platformFee).toBe(1_500);
    expect(created.body.data.payableAmount).toBe(31_500);

    // PAY-DEV simulate
    const sim = await request(app.getHttpServer())
      .post(`/api/v1/reservations/${reservationId}/payment/simulate`)
      .set(bearer(b))
      .send({})
      .expect(200);
    expect(sim.body.data.status).toBe('RESERVED');
    expect(sim.body.data.payment.status).toBe('PAID');
    expect(sim.body.data.pickupToken?.qrPayload).toMatch(/^SM1\./);

    // Second simulate -> 409 INVALID_STATE_TRANSITION
    const simAgain = await request(app.getHttpServer())
      .post(`/api/v1/reservations/${reservationId}/payment/simulate`)
      .set(bearer(b))
      .send({})
      .expect(409);
    expect(simAgain.body.error.code).toBe('INVALID_STATE_TRANSITION');

    // RES-7 lookup: amountToCollect = 0
    const qrPayload = sim.body.data.pickupToken.qrPayload as string;
    const lookup = await request(app.getHttpServer())
      .post('/api/v1/pickups/lookup')
      .set(bearer(s))
      .send({ qrPayload })
      .expect(200);
    expect(lookup.body.data.amountToCollect).toBe(0);
    expect(lookup.body.data.canConfirm).toBe(true);

    // RES-8 confirm: COMPLETED + payment.payoutStatus = PENDING_PAYOUT
    const confirm = await request(app.getHttpServer())
      .post('/api/v1/pickups/confirm')
      .set(bearer(s))
      .send({ reservationId, qrPayload })
      .expect(200);
    expect(confirm.body.data.reservation.status).toBe('COMPLETED');
    expect(confirm.body.data.reservation.payment.payoutStatus).toBe('PENDING_PAYOUT');

    // PAY-3 GET /me/payouts
    const payouts1 = await request(app.getHttpServer())
      .get('/api/v1/me/payouts')
      .set(bearer(s))
      .expect(200);
    expect(payouts1.body.data.summary).toEqual({
      pendingPayoutVnd: 30_000,
      settledVnd: 0,
      totalFoodRevenueVnd: 30_000,
    });
    expect(payouts1.body.data.items).toHaveLength(1);
    expect(payouts1.body.data.items[0].sellerNet).toBe(30_000);
    expect(payouts1.body.data.items[0].payoutStatus).toBe('PENDING_PAYOUT');

    // PAY-4 PUT /me/payout-account
    const payoutAcct = await request(app.getHttpServer())
      .put('/api/v1/me/payout-account')
      .set(bearer(s))
      .send({ bankCode: 'vcb', accountNo: '9988776655', accountName: 'NGUYEN VAN B' })
      .expect(200);
    expect(payoutAcct.body.data).toMatchObject({
      bankCode: 'VCB',
      accountNo: '9988776655',
      accountName: 'NGUYEN VAN B',
    });

    // PAY-5 POST /admin/payouts/:sellerId/settle
    const settled = await request(app.getHttpServer())
      .post(`/api/v1/admin/payouts/${s.userId}/settle`)
      .set(bearer(admin))
      .send({ note: 'Chuyen khoan dot 1' })
      .expect(200);
    expect(settled.body.data).toMatchObject({
      sellerId: s.userId,
      settledCount: 1,
      settledAmountVnd: 30_000,
    });

    const payouts2 = await request(app.getHttpServer())
      .get('/api/v1/me/payouts')
      .set(bearer(s))
      .expect(200);
    expect(payouts2.body.data.summary).toEqual({
      pendingPayoutVnd: 0,
      settledVnd: 30_000,
      totalFoodRevenueVnd: 30_000,
    });
  });

  it('marks payment REFUND_DUE on buyer cancel or listing withdraw and lets admin mark-refunded', async () => {
    const s = await seller(app, otp, { lat: 16.056, lng: 108.216 }, 'Tiệm hoàn tiền');
    const b1 = await login(app, otp, uniquePhone());
    const b2 = await login(app, otp, uniquePhone());
    const admin = await createAdmin(app, otp);

    const listing = await published(app, s, { price: 15_000, quantityTotal: 5 });

    // Order 1: paid then buyer cancels -> REFUND_DUE
    const r1 = await request(app.getHttpServer())
      .post('/api/v1/reservations')
      .set(bearer(b1))
      .set('Idempotency-Key', randomUUID())
      .send({ listingId: listing.id, quantity: 1 })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/v1/reservations/${r1.body.data.id}/payment/simulate`)
      .set(bearer(b1))
      .send({})
      .expect(200);

    const cancelled = await request(app.getHttpServer())
      .post(`/api/v1/reservations/${r1.body.data.id}/cancel`)
      .set(bearer(b1))
      .send({ reason: 'BUYER_CHANGED_PLAN', note: 'Bận đột xuất' })
      .expect(200);
    expect(cancelled.body.data.status).toBe('CANCELLED');
    expect(cancelled.body.data.payment.status).toBe('REFUND_DUE');

    // Order 2: paid then seller withdraws listing -> REFUND_DUE
    const r2 = await request(app.getHttpServer())
      .post('/api/v1/reservations')
      .set(bearer(b2))
      .set('Idempotency-Key', randomUUID())
      .send({ listingId: listing.id, quantity: 1 })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/v1/reservations/${r2.body.data.id}/payment/simulate`)
      .set(bearer(b2))
      .send({})
      .expect(200);

    await request(app.getHttpServer())
      .post(`/api/v1/listings/${listing.id}/withdraw`)
      .set(bearer(s))
      .send({ reason: 'STORAGE_NOT_OK', note: 'Tủ lạnh hỏng' })
      .expect(200);

    const r2After = await request(app.getHttpServer())
      .get(`/api/v1/reservations/${r2.body.data.id}`)
      .set(bearer(b2))
      .expect(200);
    expect(r2After.body.data.status).toBe('CANCELLED');
    expect(r2After.body.data.payment.status).toBe('REFUND_DUE');

    // PAY-5 admin list & mark-refunded
    const listRes = await request(app.getHttpServer())
      .get('/api/v1/admin/payments')
      .set(bearer(admin))
      .query({ status: 'REFUND_DUE', sellerId: s.userId })
      .expect(200);
    expect(listRes.body.data).toHaveLength(2);

    const paymentId = r1.body.data.payment.id as string;
    const refunded = await request(app.getHttpServer())
      .post(`/api/v1/admin/payments/${paymentId}/mark-refunded`)
      .set(bearer(admin))
      .send({ note: 'Da hoan tien qua VietQR' })
      .expect(200);
    expect(refunded.body.data.status).toBe('REFUNDED');
    expect(refunded.body.data.refundedAt).not.toBeNull();

    // Marking refunded again -> 409 PAYMENT_NOT_REFUNDABLE
    const refundAgain = await request(app.getHttpServer())
      .post(`/api/v1/admin/payments/${paymentId}/mark-refunded`)
      .set(bearer(admin))
      .send({ note: 'Duplicate' })
      .expect(409);
    expect(refundAgain.body.error.code).toBe('PAYMENT_NOT_REFUNDABLE');
  });
});

describe('Payments v1.2 (SePay provider & webhook)', () => {
  let app: INestApplication;
  let otp: CapturingOtpSender;
  let prisma: PrismaService;

  beforeAll(async () => {
    ({ app, otp } = await createPaymentsApp('sepay'));
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  it('rejects PAY-DEV simulate with 403 FEATURE_DISABLED when provider is sepay', async () => {
    const s = await seller(app, otp, { lat: 16.057, lng: 108.217 }, 'Tiệm SePay');
    const b = await login(app, otp, uniquePhone());
    const listing = await published(app, s, { price: 15_000, quantityTotal: 3 });

    const created = await request(app.getHttpServer())
      .post('/api/v1/reservations')
      .set(bearer(b))
      .set('Idempotency-Key', randomUUID())
      .send({ listingId: listing.id, quantity: 1 })
      .expect(201);

    expect(created.body.data.payment.provider).toBe('SEPAY');
    expect(created.body.data.payment.qrImageUrl).toContain('https://qr.sepay.vn/img?');

    const sim = await request(app.getHttpServer())
      .post(`/api/v1/reservations/${created.body.data.id}/payment/simulate`)
      .set(bearer(b))
      .send({})
      .expect(403);
    expect(sim.body.error.code).toBe('FEATURE_DISABLED');
  });

  it('handles PAY-2 SePay webhook: auth check, settlement, idempotency, and late payment REFUND_DUE', async () => {
    const s = await seller(app, otp, { lat: 16.058, lng: 108.218 }, 'Tiệm Webhook');
    const b1 = await login(app, otp, uniquePhone());
    const b2 = await login(app, otp, uniquePhone());
    const listing = await published(app, s, { price: 15_000, quantityTotal: 5 });

    // Missing or wrong Apikey -> 401
    await request(app.getHttpServer())
      .post('/api/v1/webhooks/sepay')
      .send({ id: 1001, transferType: 'in', transferAmount: 17_000, content: 'SM12345678' })
      .expect(401);

    await request(app.getHttpServer())
      .post('/api/v1/webhooks/sepay')
      .set('Authorization', 'Apikey wrong_secret')
      .send({ id: 1001, transferType: 'in', transferAmount: 17_000, content: 'SM12345678' })
      .expect(401);

    // Create order 1 and settle via SePay webhook
    const r1 = await request(app.getHttpServer())
      .post('/api/v1/reservations')
      .set(bearer(b1))
      .set('Idempotency-Key', randomUUID())
      .send({ listingId: listing.id, quantity: 1 })
      .expect(201);
    const transferContent1 = r1.body.data.payment.transferContent as string;

    const txId1 = `SEPAY-${Date.now()}-1`;
    const hook1 = await request(app.getHttpServer())
      .post('/api/v1/webhooks/sepay')
      .set('Authorization', `Apikey ${SEPAY_SECRET}`)
      .send({
        id: txId1,
        gateway: 'MBBank',
        transferType: 'in',
        transferAmount: 17_000,
        content: `MBVCB.999999.${transferContent1}.CT tu BUYER`,
      })
      .expect(200);
    expect(hook1.body.data).toEqual({ received: true });

    const r1After = await request(app.getHttpServer())
      .get(`/api/v1/reservations/${r1.body.data.id}`)
      .set(bearer(b1))
      .expect(200);
    expect(r1After.body.data.status).toBe('RESERVED');
    expect(r1After.body.data.payment.status).toBe('PAID');
    expect(r1After.body.data.payment.paidAt).not.toBeNull();

    const tokenCount = await prisma.pickupToken.count({ where: { reservationId: r1.body.data.id } });
    expect(tokenCount).toBe(1);

    // Duplicate delivery with same providerTxId -> idempotent 200, no extra token or status change
    const hookDup = await request(app.getHttpServer())
      .post('/api/v1/webhooks/sepay')
      .set('Authorization', `Apikey ${SEPAY_SECRET}`)
      .send({
        id: txId1,
        transferType: 'in',
        transferAmount: 17_000,
        content: transferContent1,
      })
      .expect(200);
    expect(hookDup.body.data).toEqual({ received: true });
    expect(await prisma.pickupToken.count({ where: { reservationId: r1.body.data.id } })).toBe(1);

    // Late payment after expiry -> REFUND_DUE
    const r2 = await request(app.getHttpServer())
      .post('/api/v1/reservations')
      .set(bearer(b2))
      .set('Idempotency-Key', randomUUID())
      .send({ listingId: listing.id, quantity: 1 })
      .expect(201);
    const transferContent2 = r2.body.data.payment.transferContent as string;

    await prisma.reservation.update({
      where: { id: r2.body.data.id },
      data: { paymentExpiresAt: new Date(Date.now() - 60_000) },
    });
    // Trigger lazy-expiry so reservation is EXPIRED
    await request(app.getHttpServer())
      .get(`/api/v1/reservations/${r2.body.data.id}`)
      .set(bearer(b2))
      .expect(200);

    const txId2 = `SEPAY-${Date.now()}-2`;
    await request(app.getHttpServer())
      .post('/api/v1/webhooks/sepay')
      .set('Authorization', `Apikey ${SEPAY_SECRET}`)
      .send({
        id: txId2,
        transferType: 'in',
        transferAmount: 17_000,
        content: `CHUYEN KHOAN ${transferContent2.toLowerCase()}`,
      })
      .expect(200);

    const p2After = await request(app.getHttpServer())
      .get(`/api/v1/reservations/${r2.body.data.id}/payment`)
      .set(bearer(b2))
      .expect(200);
    expect(p2After.body.data.status).toBe('REFUND_DUE');
  });
});
