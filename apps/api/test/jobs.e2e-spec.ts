import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { access } from 'node:fs/promises';
import request from 'supertest';
import { localDate } from '../src/common/time';
import { JobsService } from '../src/jobs/jobs.service';
import { MediaStorage } from '../src/media/media-storage';
import { PrismaService } from '../src/prisma/prisma.service';
import { bearer, createAuthTestApp, login, uniquePhone, type CapturingOtpSender } from './auth-helpers';
import { published, seller, uploadImage } from './listing-helpers';

const HOUR = 3600_000;
const DAY = 24 * HOUR;
const MIN = 60_000;

describe('Scheduled jobs (JOB-1..4)', () => {
  let app: INestApplication;
  let otp: CapturingOtpSender;
  let prisma: PrismaService;
  let jobs: JobsService;
  let media: MediaStorage;

  beforeAll(async () => {
    ({ app, otp } = await createAuthTestApp());
    prisma = app.get(PrismaService);
    jobs = app.get(JobsService);
    media = app.get(MediaStorage);
  });

  afterAll(async () => {
    await app.close();
  });

  it('JOB-1: expireListings idempotently expires past-pickupEnd listings and writes SYSTEM event_logs', async () => {
    const s = await seller(app, otp);
    const lPast = await published(app, s, {
      quantityTotal: 3,
      pickupStart: new Date(Date.now() + 5 * MIN).toISOString(),
      pickupEnd: new Date(Date.now() + 30 * MIN).toISOString(),
    });
    const lFuture = await published(app, s, {
      quantityTotal: 2,
      pickupStart: new Date(Date.now() + 2 * HOUR).toISOString(),
      pickupEnd: new Date(Date.now() + 3 * HOUR).toISOString(),
    });

    const runAt = new Date(Date.now() + 45 * MIN);
    const first = await jobs.expireListings(runAt);
    expect(first).toBeGreaterThanOrEqual(1);

    const updatedPast = await prisma.foodListing.findUnique({ where: { id: lPast.id } });
    const updatedFuture = await prisma.foodListing.findUnique({ where: { id: lFuture.id } });
    expect(updatedPast?.status).toBe('EXPIRED');
    expect(updatedPast?.closedAt).toEqual(runAt);
    expect(updatedFuture?.status).toBe('PUBLISHED');

    const logs = await prisma.eventLog.findMany({
      where: { entityType: 'listing', entityId: lPast.id, event: 'LISTING_EXPIRED' },
    });
    expect(logs).toHaveLength(1);
    expect(logs[0]!.actorType).toBe('SYSTEM');
    expect(logs[0]!.data).toMatchObject({
      sellerId: s.userId,
      quantityAvailable: 3,
      expiredWithStock: true,
    });

    // Idempotent second run at same timestamp
    const second = await jobs.expireListings(runAt);
    expect(second).toBe(0);
    const logsAfter = await prisma.eventLog.count({
      where: { entityType: 'listing', entityId: lPast.id, event: 'LISTING_EXPIRED' },
    });
    expect(logsAfter).toBe(1);
  });

  it('JOB-2: expireReservations expires unclaimed orders after pickupEnd + grace, revokes tokens, and is idempotent', async () => {
    const s = await seller(app, otp);
    const b = await login(app, otp, uniquePhone());
    const pickupEnd = new Date(Date.now() + 30 * MIN);
    const listing = await published(app, s, {
      quantityTotal: 3,
      pickupStart: new Date(Date.now() + 5 * MIN).toISOString(),
      pickupEnd: pickupEnd.toISOString(),
    });

    const created = await request(app.getHttpServer())
      .post('/api/v1/reservations')
      .set(bearer(b))
      .set('Idempotency-Key', randomUUID())
      .send({ listingId: listing.id, quantity: 1 })
      .expect(201);
    const reservationId = created.body.data.id as string;

    // 5 minutes after pickupEnd (still within 15m grace) -> not expired yet
    await jobs.expireReservations(new Date(pickupEnd.getTime() + 5 * MIN));
    expect((await prisma.reservation.findUnique({ where: { id: reservationId } }))?.status).toBe('RESERVED');

    // 16 minutes after pickupEnd (past 15m grace) -> expired + token revoked
    const expireAt = new Date(pickupEnd.getTime() + 16 * MIN);
    const expiredCount = await jobs.expireReservations(expireAt);
    expect(expiredCount).toBeGreaterThanOrEqual(1);

    const updated = await prisma.reservation.findUnique({ where: { id: reservationId } });
    expect(updated?.status).toBe('EXPIRED');
    expect(updated?.closedAt).toEqual(expireAt);

    const unrevokedTokens = await prisma.pickupToken.count({
      where: { reservationId, revokedAt: null, usedAt: null },
    });
    expect(unrevokedTokens).toBe(0);

    const logs = await prisma.eventLog.findMany({
      where: { entityType: 'reservation', entityId: reservationId, event: 'RESERVATION_EXPIRED' },
    });
    expect(logs).toHaveLength(1);
    expect(logs[0]!.actorType).toBe('SYSTEM');
    expect(logs[0]!.data).toMatchObject({
      listingId: listing.id,
      sellerId: s.userId,
      quantity: 1,
    });

    // Idempotent second run
    expect(await jobs.expireReservations(expireAt)).toBe(0);
    expect(
      await prisma.eventLog.count({
        where: { entityType: 'reservation', entityId: reservationId, event: 'RESERVATION_EXPIRED' },
      }),
    ).toBe(1);
  });

  it('JOB-3: cleanupExpiredData purges old tokens (> 7d) and unattached images (> 24h) including files on disk', async () => {
    const s = await seller(app, otp);
    const now = new Date();
    const tenDaysAgo = new Date(now.getTime() - 10 * DAY);

    // Seed old expired OTP and refresh token
    const oldOtp = await prisma.otpRequest.create({
      data: {
        channel: 'SMS',
        identifierHash: `hash_${randomUUID()}`,
        identifierEnc: 'enc',
        codeHash: 'code',
        expiresAt: tenDaysAgo,
      },
    });
    const oldRefresh = await prisma.refreshToken.create({
      data: {
        accountId: s.userId,
        tokenHash: `rt_${randomUUID()}`,
        familyId: randomUUID(),
        expiresAt: tenDaysAgo,
      },
    });

    // Upload an unattached image and age its createdAt to > 24h ago
    const orphanImageId = await uploadImage(app, s, 'LISTING');
    const orphanRow = await prisma.listingImage.update({
      where: { id: orphanImageId },
      data: { createdAt: new Date(now.getTime() - 25 * HOUR) },
    });
    // Also upload a fresh unattached image (< 24h) which must be preserved
    const freshImageId = await uploadImage(app, s, 'LISTING');

    // Confirm orphan file currently exists on disk
    await expect(access(media.pathOf(orphanRow.storageKey))).resolves.toBeUndefined();

    const cleaned = await jobs.cleanupExpiredData(now);
    expect(cleaned.otpRequests).toBeGreaterThanOrEqual(1);
    expect(cleaned.refreshTokens).toBeGreaterThanOrEqual(1);
    expect(cleaned.images).toBeGreaterThanOrEqual(1);

    expect(await prisma.otpRequest.findUnique({ where: { id: oldOtp.id } })).toBeNull();
    expect(await prisma.refreshToken.findUnique({ where: { id: oldRefresh.id } })).toBeNull();
    expect(await prisma.listingImage.findUnique({ where: { id: orphanImageId } })).toBeNull();
    expect(await prisma.listingImage.findUnique({ where: { id: freshImageId } })).not.toBeNull();

    // Orphan file removed from disk
    await expect(access(media.pathOf(orphanRow.storageKey))).rejects.toThrow();
  });

  it('JOB-4: rebuildMetrics aggregates event_logs by local Da Nang date and sellerId', async () => {
    const s = await seller(app, otp);
    const b1 = await login(app, otp, uniquePhone());
    const b2 = await login(app, otp, uniquePhone());
    const b3 = await login(app, otp, uniquePhone());

    // Publish 1 listing: 5 portions, originalPrice 25000, price 15000 (discountRate = 0.4)
    const pickupEnd = new Date(Date.now() + 40 * MIN);
    const listing = await published(app, s, {
      quantityTotal: 5,
      originalPrice: 25000,
      price: 15000,
      pickupStart: new Date(Date.now() + 5 * MIN).toISOString(),
      pickupEnd: pickupEnd.toISOString(),
    });

    // Buyer 1 reserves 2 and completes handover
    const r1 = (
      await request(app.getHttpServer())
        .post('/api/v1/reservations')
        .set(bearer(b1))
        .set('Idempotency-Key', randomUUID())
        .send({ listingId: listing.id, quantity: 2 })
        .expect(201)
    ).body.data;
    await request(app.getHttpServer())
      .post('/api/v1/pickups/confirm')
      .set(bearer(s))
      .send({ reservationId: r1.id, qrPayload: r1.pickupToken.qrPayload })
      .expect(200);

    // Buyer 2 reserves 1 and cancels
    const r2 = (
      await request(app.getHttpServer())
        .post('/api/v1/reservations')
        .set(bearer(b2))
        .set('Idempotency-Key', randomUUID())
        .send({ listingId: listing.id, quantity: 1 })
        .expect(201)
    ).body.data;
    await request(app.getHttpServer())
      .post(`/api/v1/reservations/${r2.id}/cancel`)
      .set(bearer(b2))
      .send({ reason: 'BUYER_LATE' })
      .expect(200);

    // Buyer 3 reserves 1 and lets it expire (remaining stock on listing = 2)
    await request(app.getHttpServer())
      .post('/api/v1/reservations')
      .set(bearer(b3))
      .set('Idempotency-Key', randomUUID())
      .send({ listingId: listing.id, quantity: 1 })
      .expect(201);

    const afterGrace = new Date(pickupEnd.getTime() + 20 * MIN);
    await jobs.expireListings(afterGrace);
    await jobs.expireReservations(afterGrace);

    // Rebuild metrics (twice to verify idempotency)
    await jobs.rebuildMetrics();
    await jobs.rebuildMetrics();

    const today = new Date(`${localDate(new Date())}T00:00:00.000Z`);
    const metric = await prisma.transactionMetric.findUnique({
      where: { date_sellerId: { date: today, sellerId: s.userId } },
    });

    expect(metric).not.toBeNull();
    expect(metric!.listingsPublished).toBe(1);
    expect(metric!.listingsExpiredWithStock).toBe(1);
    expect(metric!.portionsListed).toBe(5);
    expect(metric!.portionsReserved).toBe(4);
    expect(metric!.portionsHandedOver).toBe(2);
    expect(metric!.reservationsCreated).toBe(3);
    expect(metric!.reservationsCompleted).toBe(1);
    expect(metric!.reservationsCancelled).toBe(1);
    expect(metric!.reservationsExpired).toBe(1);
    expect(metric!.discountSamples).toBe(1);
    expect(metric!.discountRateSum).toBeCloseTo(0.4, 5);
  });
});
