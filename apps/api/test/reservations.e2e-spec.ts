import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { RateLimiter } from '../src/common/rate-limiter';
import { PrismaService } from '../src/prisma/prisma.service';
import { bearer, createAuthTestApp, login, uniquePhone, type CapturingOtpSender, type Session } from './auth-helpers';
import { published, seller } from './listing-helpers';

const HOUR = 3600_000;
const MIN = 60_000;

describe('Reservations and handover (RES-1..8)', () => {
  let app: INestApplication;
  let otp: CapturingOtpSender;
  let prisma: PrismaService;
  let rateLimiter: RateLimiter;

  beforeAll(async () => {
    ({ app, otp } = await createAuthTestApp());
    prisma = app.get(PrismaService);
    rateLimiter = app.get(RateLimiter);
  });

  beforeEach(() => {
    rateLimiter.reset();
  });

  afterAll(async () => {
    await app.close();
  });

  async function buyer(name = 'Người mua test'): Promise<{ session: Session; phone: string }> {
    const phone = uniquePhone();
    const session = await login(app, otp, phone);
    await request(app.getHttpServer())
      .patch('/api/v1/me')
      .set(bearer(session))
      .send({ displayName: name })
      .expect(200);
    return { session, phone };
  }

  function assertNoBuyerPii(payload: unknown, phone: string): void {
    const raw = JSON.stringify(payload);
    expect(raw).not.toContain(phone);
    expect(raw).not.toContain(phone.slice(-8));
    expect(raw).not.toMatch(/"phone"\s*:/);
    expect(raw).not.toMatch(/"email"\s*:/);
  }

  it('RES-1..3, RES-5..8: full reservation, QR rotation, lookup, and QR handover flow without leaking buyer PII', async () => {
    const s = await seller(app, otp);
    const { session: b, phone: buyerPhone } = await buyer('Minh Anh');
    const listing = await published(app, s, {
      quantityTotal: 5,
      price: 15000,
      originalPrice: 25000,
      pickupStart: new Date(Date.now() + 10 * MIN).toISOString(),
      pickupEnd: new Date(Date.now() + 90 * MIN).toISOString(),
    });

    // RES-1: reserve 1 portion
    const idemKey = randomUUID();
    const created = await request(app.getHttpServer())
      .post('/api/v1/reservations')
      .set(bearer(b))
      .set('Idempotency-Key', idemKey)
      .send({ listingId: listing.id, quantity: 1 })
      .expect(201);

    const resv = created.body.data;
    expect(resv.status).toBe('RESERVED');
    expect(resv.quantity).toBe(1);
    expect(resv.unitPrice).toBe(15000);
    expect(resv.totalPrice).toBe(15000);
    expect(resv.code).toMatch(/^SM–\d{4}$/);
    expect(resv.buyer).toBeNull();
    expect(resv.pickupToken).toBeTruthy();
    expect(resv.pickupToken.qrPayload).toMatch(/^SM1\.[A-Za-z0-9_-]+$/);
    expect(resv.canCancel).toBe(true);
    expect(resv.canReport).toBe(true);

    // Stock decremented 5 -> 4
    const afterReserve = await prisma.foodListing.findUnique({ where: { id: listing.id } });
    expect(afterReserve?.quantityAvailable).toBe(4);

    // Idempotency replay with same key & same body returns the same reservation without decrementing again
    const replay = await request(app.getHttpServer())
      .post('/api/v1/reservations')
      .set(bearer(b))
      .set('Idempotency-Key', idemKey)
      .send({ listingId: listing.id, quantity: 1 })
      .expect(201);
    expect(replay.body.data.id).toBe(resv.id);
    const afterReplay = await prisma.foodListing.findUnique({ where: { id: listing.id } });
    expect(afterReplay?.quantityAvailable).toBe(4);

    // Idempotency replay with different body -> 422 IDEMPOTENCY_KEY_REUSED
    const reused = await request(app.getHttpServer())
      .post('/api/v1/reservations')
      .set(bearer(b))
      .set('Idempotency-Key', idemKey)
      .send({ listingId: listing.id, quantity: 2 })
      .expect(422);
    expect(reused.body.error.code).toBe('IDEMPOTENCY_KEY_REUSED');

    // RES-2: buyer upcoming reservations
    const upcoming = await request(app.getHttpServer())
      .get('/api/v1/me/reservations?tab=upcoming')
      .set(bearer(b))
      .expect(200);
    expect(upcoming.body.data.map((r: { id: string }) => r.id)).toContain(resv.id);
    expect(upcoming.body.page).toEqual({ nextCursor: null, limit: 20 });

    // RES-3: buyer, seller, and stranger views
    const buyerView = await request(app.getHttpServer())
      .get(`/api/v1/reservations/${resv.id}`)
      .set(bearer(b))
      .expect(200);
    expect(buyerView.body.data.buyer).toBeNull();

    const sellerView = await request(app.getHttpServer())
      .get(`/api/v1/reservations/${resv.id}`)
      .set(bearer(s))
      .expect(200);
    expect(sellerView.body.data.buyer).toEqual({ displayName: 'Minh Anh' });
    expect(sellerView.body.data.pickupToken).toBeNull();
    assertNoBuyerPii(sellerView.body, buyerPhone);

    const { session: stranger } = await buyer('Người lạ');
    await request(app.getHttpServer())
      .get(`/api/v1/reservations/${resv.id}`)
      .set(bearer(stranger))
      .expect(404);

    // RES-5: seller sales list (privacy check)
    const sales = await request(app.getHttpServer()).get('/api/v1/me/sales').set(bearer(s)).expect(200);
    expect(sales.body.data.map((r: { id: string }) => r.id)).toContain(resv.id);
    expect(sales.body.data[0].buyer).toEqual({ displayName: 'Minh Anh' });
    assertNoBuyerPii(sales.body, buyerPhone);

    // RES-6: rotate pickup token revokes the initial token
    const oldQr = resv.pickupToken.qrPayload as string;
    const rotated = await request(app.getHttpServer())
      .post(`/api/v1/reservations/${resv.id}/pickup-token`)
      .set(bearer(b))
      .expect(201);
    const freshQr = rotated.body.data.qrPayload as string;
    expect(freshQr).toMatch(/^SM1\./);
    expect(freshQr).not.toBe(oldQr);

    // Lookup with revoked old QR reports TOKEN_EXPIRED; confirm rejects with PICKUP_TOKEN_EXPIRED
    const oldLookup = await request(app.getHttpServer())
      .post('/api/v1/pickups/lookup')
      .set(bearer(s))
      .send({ qrPayload: oldQr })
      .expect(200);
    expect(oldLookup.body.data.canConfirm).toBe(false);
    expect(oldLookup.body.data.blockingReason).toBe('TOKEN_EXPIRED');

    const oldConfirm = await request(app.getHttpServer())
      .post('/api/v1/pickups/confirm')
      .set(bearer(s))
      .send({ reservationId: resv.id, qrPayload: oldQr })
      .expect(409);
    expect(oldConfirm.body.error.code).toBe('PICKUP_TOKEN_EXPIRED');

    // RES-7: lookup with fresh QR (does not mutate state; no buyer PII)
    const lookup = await request(app.getHttpServer())
      .post('/api/v1/pickups/lookup')
      .set(bearer(s))
      .send({ qrPayload: freshQr })
      .expect(200);
    expect(lookup.body.data.canConfirm).toBe(true);
    expect(lookup.body.data.blockingReason).toBeNull();
    expect(lookup.body.data.amountToCollect).toBe(15000);
    expect(lookup.body.data.reservation.status).toBe('RESERVED');
    assertNoBuyerPii(lookup.body, buyerPhone);

    // RES-8: confirm with fresh QR -> COMPLETED
    const confirm = await request(app.getHttpServer())
      .post('/api/v1/pickups/confirm')
      .set(bearer(s))
      .send({ reservationId: resv.id, qrPayload: freshQr })
      .expect(200);
    expect(confirm.body.data.reservation.status).toBe('COMPLETED');
    expect(confirm.body.data.listingRemaining).toBe(4);
    assertNoBuyerPii(confirm.body, buyerPhone);

    // Re-scanning used QR -> TOKEN_USED on lookup, PICKUP_TOKEN_USED on confirm
    const usedLookup = await request(app.getHttpServer())
      .post('/api/v1/pickups/lookup')
      .set(bearer(s))
      .send({ qrPayload: freshQr })
      .expect(200);
    expect(usedLookup.body.data.canConfirm).toBe(false);
    expect(usedLookup.body.data.blockingReason).toBe('TOKEN_USED');

    const usedConfirm = await request(app.getHttpServer())
      .post('/api/v1/pickups/confirm')
      .set(bearer(s))
      .send({ reservationId: resv.id, qrPayload: freshQr })
      .expect(409);
    expect(usedConfirm.body.error.code).toBe('PICKUP_TOKEN_USED');

    // RES-2 history now contains the completed reservation
    const history = await request(app.getHttpServer())
      .get('/api/v1/me/reservations?tab=history')
      .set(bearer(b))
      .expect(200);
    expect(history.body.data.map((r: { id: string }) => r.id)).toContain(resv.id);
  });

  it('RES-7 & RES-8: manual 4-digit code lookup & confirm, plus invalid token/code errors', async () => {
    const s = await seller(app, otp);
    const otherSeller = await seller(app, otp);
    const { session: b, phone: buyerPhone } = await buyer('Lan');
    const listing = await published(app, s, {
      quantityTotal: 3,
      pickupStart: new Date(Date.now() + 5 * MIN).toISOString(),
      pickupEnd: new Date(Date.now() + 60 * MIN).toISOString(),
    });

    const created = await request(app.getHttpServer())
      .post('/api/v1/reservations')
      .set(bearer(b))
      .set('Idempotency-Key', randomUUID())
      .send({ listingId: listing.id, quantity: 2 })
      .expect(201);
    const resv = created.body.data;
    const digits = (resv.code as string).replace(/\D/g, '');

    // Another seller cannot look up this QR -> 422 PICKUP_TOKEN_INVALID
    const wrongSeller = await request(app.getHttpServer())
      .post('/api/v1/pickups/lookup')
      .set(bearer(otherSeller))
      .send({ qrPayload: resv.pickupToken.qrPayload })
      .expect(422);
    expect(wrongSeller.body.error.code).toBe('PICKUP_TOKEN_INVALID');

    // Malformed QR -> 422 PICKUP_TOKEN_INVALID
    const badQr = await request(app.getHttpServer())
      .post('/api/v1/pickups/lookup')
      .set(bearer(s))
      .send({ qrPayload: 'NOT_A_QR' })
      .expect(422);
    expect(badQr.body.error.code).toBe('PICKUP_TOKEN_INVALID');

    // Wrong manual code -> 422 PICKUP_CODE_INVALID
    const wrongCode = digits === '0000' ? '9999' : '0000';
    const badCode = await request(app.getHttpServer())
      .post('/api/v1/pickups/lookup')
      .set(bearer(s))
      .send({ code: wrongCode })
      .expect(422);
    expect(badCode.body.error.code).toBe('PICKUP_CODE_INVALID');

    // Valid manual code with SM– prefix -> lookup & confirm succeed
    const lookup = await request(app.getHttpServer())
      .post('/api/v1/pickups/lookup')
      .set(bearer(s))
      .send({ code: `SM–${digits}` })
      .expect(200);
    expect(lookup.body.data.canConfirm).toBe(true);
    assertNoBuyerPii(lookup.body, buyerPhone);

    const confirm = await request(app.getHttpServer())
      .post('/api/v1/pickups/confirm')
      .set(bearer(s))
      .send({ reservationId: resv.id, code: digits })
      .expect(200);
    expect(confirm.body.data.reservation.status).toBe('COMPLETED');
    expect(confirm.body.data.listingRemaining).toBe(1);
    assertNoBuyerPii(confirm.body, buyerPhone);
  });

  it('RES-1 error guards: OWN_LISTING_RESERVATION, QUANTITY_LIMIT_EXCEEDED, ALREADY_RESERVED, ACTIVE_RESERVATION_LIMIT', async () => {
    const s = await seller(app, otp);
    const { session: b } = await buyer();
    const l1 = await published(app, s, { quantityTotal: 5 });
    const l2 = await published(app, s, { quantityTotal: 5 });
    const l3 = await published(app, s, { quantityTotal: 5 });
    const l4 = await published(app, s, { quantityTotal: 5 });

    // Own listing -> 403 OWN_LISTING_RESERVATION
    const own = await request(app.getHttpServer())
      .post('/api/v1/reservations')
      .set(bearer(s))
      .set('Idempotency-Key', randomUUID())
      .send({ listingId: l1.id, quantity: 1 })
      .expect(403);
    expect(own.body.error.code).toBe('OWN_LISTING_RESERVATION');

    // Quantity > MAX_QTY_PER_RESERVATION (2) -> 422 QUANTITY_LIMIT_EXCEEDED
    const tooMany = await request(app.getHttpServer())
      .post('/api/v1/reservations')
      .set(bearer(b))
      .set('Idempotency-Key', randomUUID())
      .send({ listingId: l1.id, quantity: 3 })
      .expect(422);
    expect(tooMany.body.error.code).toBe('QUANTITY_LIMIT_EXCEEDED');

    // Reserve l1 once -> 201
    const first = await request(app.getHttpServer())
      .post('/api/v1/reservations')
      .set(bearer(b))
      .set('Idempotency-Key', randomUUID())
      .send({ listingId: l1.id, quantity: 1 })
      .expect(201);

    // Reserve l1 again with a different idempotency key -> 409 ALREADY_RESERVED
    const dup = await request(app.getHttpServer())
      .post('/api/v1/reservations')
      .set(bearer(b))
      .set('Idempotency-Key', randomUUID())
      .send({ listingId: l1.id, quantity: 1 })
      .expect(409);
    expect(dup.body.error.code).toBe('ALREADY_RESERVED');
    expect(dup.body.error.details.reservationId).toBe(first.body.data.id);

    // Reserve l2 and l3 (reaching MAX_ACTIVE_RESERVATIONS_PER_ACCOUNT = 3)
    await request(app.getHttpServer())
      .post('/api/v1/reservations')
      .set(bearer(b))
      .set('Idempotency-Key', randomUUID())
      .send({ listingId: l2.id, quantity: 1 })
      .expect(201);
    await request(app.getHttpServer())
      .post('/api/v1/reservations')
      .set(bearer(b))
      .set('Idempotency-Key', randomUUID())
      .send({ listingId: l3.id, quantity: 1 })
      .expect(201);

    // 4th active reservation -> 409 ACTIVE_RESERVATION_LIMIT
    const fourth = await request(app.getHttpServer())
      .post('/api/v1/reservations')
      .set(bearer(b))
      .set('Idempotency-Key', randomUUID())
      .send({ listingId: l4.id, quantity: 1 })
      .expect(409);
    expect(fourth.body.error.code).toBe('ACTIVE_RESERVATION_LIMIT');
  });

  it('RES-4: cancel releases stock atomically, and rejects CANCEL_WINDOW_CLOSED after pickupEnd', async () => {
    const s = await seller(app, otp);
    const { session: b1 } = await buyer('B1');
    const { session: b2 } = await buyer('B2');
    const listing = await published(app, s, { quantityTotal: 4 });

    const r1 = await request(app.getHttpServer())
      .post('/api/v1/reservations')
      .set(bearer(b1))
      .set('Idempotency-Key', randomUUID())
      .send({ listingId: listing.id, quantity: 2 })
      .expect(201);
    expect((await prisma.foodListing.findUnique({ where: { id: listing.id } }))?.quantityAvailable).toBe(2);

    // Cancel before pickupEnd -> stock returns 2 -> 4
    const cancelled = await request(app.getHttpServer())
      .post(`/api/v1/reservations/${r1.body.data.id}/cancel`)
      .set(bearer(b1))
      .send({ reason: 'BUYER_CHANGED_PLAN', note: 'Bận đột xuất' })
      .expect(200);
    expect(cancelled.body.data.status).toBe('CANCELLED');
    expect(cancelled.body.data.cancelReason).toBe('BUYER_CHANGED_PLAN');
    expect((await prisma.foodListing.findUnique({ where: { id: listing.id } }))?.quantityAvailable).toBe(4);

    // Reserve with b2, then move pickupEnd into the past -> CANCEL_WINDOW_CLOSED
    const r2 = await request(app.getHttpServer())
      .post('/api/v1/reservations')
      .set(bearer(b2))
      .set('Idempotency-Key', randomUUID())
      .send({ listingId: listing.id, quantity: 1 })
      .expect(201);

    await prisma.foodListing.update({
      where: { id: listing.id },
      data: {
        pickupStart: new Date(Date.now() - 2 * HOUR),
        pickupEnd: new Date(Date.now() - 5 * MIN),
      },
    });

    const lateCancel = await request(app.getHttpServer())
      .post(`/api/v1/reservations/${r2.body.data.id}/cancel`)
      .set(bearer(b2))
      .send({ reason: 'BUYER_LATE' })
      .expect(409);
    expect(lateCancel.body.error.code).toBe('CANCEL_WINDOW_CLOSED');
  });

  it('RES-7 & RES-8 time & status guards: PICKUP_TOO_EARLY, PICKUP_WINDOW_CLOSED, LISTING_BLOCKED', async () => {
    const s = await seller(app, otp);
    const { session: b } = await buyer();
    const listing = await published(app, s, {
      quantityTotal: 3,
      pickupStart: new Date(Date.now() + 2 * HOUR).toISOString(),
      pickupEnd: new Date(Date.now() + 3 * HOUR).toISOString(),
    });

    const resv = (
      await request(app.getHttpServer())
        .post('/api/v1/reservations')
        .set(bearer(b))
        .set('Idempotency-Key', randomUUID())
        .send({ listingId: listing.id, quantity: 1 })
        .expect(201)
    ).body.data;
    const qr = resv.pickupToken.qrPayload as string;

    // Too early (> 30 min before pickupStart)
    const earlyLookup = await request(app.getHttpServer())
      .post('/api/v1/pickups/lookup')
      .set(bearer(s))
      .send({ qrPayload: qr })
      .expect(200);
    expect(earlyLookup.body.data.blockingReason).toBe('TOO_EARLY');

    const earlyConfirm = await request(app.getHttpServer())
      .post('/api/v1/pickups/confirm')
      .set(bearer(s))
      .send({ reservationId: resv.id, qrPayload: qr })
      .expect(409);
    expect(earlyConfirm.body.error.code).toBe('PICKUP_TOO_EARLY');

    // Window closed (pickupEnd + 15m grace in the past)
    await prisma.foodListing.update({
      where: { id: listing.id },
      data: {
        pickupStart: new Date(Date.now() - 2 * HOUR),
        pickupEnd: new Date(Date.now() - 20 * MIN),
      },
    });
    const closedLookup = await request(app.getHttpServer())
      .post('/api/v1/pickups/lookup')
      .set(bearer(s))
      .send({ qrPayload: qr })
      .expect(200);
    expect(closedLookup.body.data.blockingReason).toBe('WINDOW_CLOSED');

    const closedConfirm = await request(app.getHttpServer())
      .post('/api/v1/pickups/confirm')
      .set(bearer(s))
      .send({ reservationId: resv.id, qrPayload: qr })
      .expect(409);
    expect(closedConfirm.body.error.code).toBe('PICKUP_WINDOW_CLOSED');

    // Listing blocked -> LISTING_BLOCKED
    await prisma.foodListing.update({
      where: { id: listing.id },
      data: {
        status: 'BLOCKED',
        pickupStart: new Date(Date.now() - 10 * MIN),
        pickupEnd: new Date(Date.now() + 60 * MIN),
      },
    });
    const blockedLookup = await request(app.getHttpServer())
      .post('/api/v1/pickups/lookup')
      .set(bearer(s))
      .send({ qrPayload: qr })
      .expect(200);
    expect(blockedLookup.body.data.blockingReason).toBe('LISTING_BLOCKED');

    const blockedConfirm = await request(app.getHttpServer())
      .post('/api/v1/pickups/confirm')
      .set(bearer(s))
      .send({ reservationId: resv.id, qrPayload: qr })
      .expect(409);
    expect(blockedConfirm.body.error.code).toBe('LISTING_BLOCKED');
  });

  it('RES-1 parallel concurrency: 8 buyers race for 3 portions -> exactly 3 succeed, 5 get LISTING_SOLD_OUT', async () => {
    const s = await seller(app, otp);
    const listing = await published(app, s, { quantityTotal: 3 });

    const buyers = await Promise.all(Array.from({ length: 8 }, (_, i) => buyer(`Buyer ${i + 1}`)));

    const responses = await Promise.all(
      buyers.map(({ session }) =>
        request(app.getHttpServer())
          .post('/api/v1/reservations')
          .set(bearer(session))
          .set('Idempotency-Key', randomUUID())
          .send({ listingId: listing.id, quantity: 1 }),
      ),
    );

    const succeeded = responses.filter((r) => r.status === 201);
    const soldOut = responses.filter((r) => r.status === 409 && r.body.error?.code === 'LISTING_SOLD_OUT');

    expect(succeeded).toHaveLength(3);
    expect(soldOut).toHaveLength(5);

    const finalListing = await prisma.foodListing.findUnique({ where: { id: listing.id } });
    expect(finalListing?.quantityAvailable).toBe(0);

    const dbReservations = await prisma.reservation.count({
      where: { listingId: listing.id, status: 'RESERVED' },
    });
    expect(dbReservations).toBe(3);
  });

  it('RES-1 active limit: ignores overdue RESERVED rows past pickupEnd + grace so a buyer can still reserve', async () => {
    const s = await seller(app, otp);
    const { session: b } = await buyer('Khách quá hạn');

    const overdueListings = [
      await published(app, s, { quantityTotal: 2 }),
      await published(app, s, { quantityTotal: 2 }),
      await published(app, s, { quantityTotal: 2 }),
    ];

    for (const l of overdueListings) {
      await request(app.getHttpServer())
        .post('/api/v1/reservations')
        .set(bearer(b))
        .set('Idempotency-Key', randomUUID())
        .send({ listingId: l.id, quantity: 1 })
        .expect(201);
    }

    // Age all 3 listings past pickupEnd + 15m grace while keeping reservations RESERVED (simulating cron lag)
    await prisma.foodListing.updateMany({
      where: { id: { in: overdueListings.map((l) => l.id) } },
      data: {
        pickupStart: new Date(Date.now() - 2 * HOUR),
        pickupEnd: new Date(Date.now() - 20 * MIN),
      },
    });

    const freshListing = await published(app, s, { quantityTotal: 2 });
    const created = await request(app.getHttpServer())
      .post('/api/v1/reservations')
      .set(bearer(b))
      .set('Idempotency-Key', randomUUID())
      .send({ listingId: freshListing.id, quantity: 1 })
      .expect(201);
    expect(created.body.data.status).toBe('RESERVED');
  });
});
