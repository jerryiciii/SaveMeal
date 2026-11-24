import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { bearer, createAuthTestApp, login, uniquePhone, type CapturingOtpSender } from './auth-helpers';
import { published, seller } from './listing-helpers';

const HOUR = 3600_000;
const MIN = 60_000;
const TEST_CRON_SECRET = 'test-cron-secret-1234567890';

describe('Internal daily cron endpoint (SYS-3)', () => {
  describe('when CRON_SECRET is unset', () => {
    let app: INestApplication;
    const prevSecret = process.env.CRON_SECRET;

    beforeAll(async () => {
      process.env.CRON_SECRET = '';
      ({ app } = await createAuthTestApp());
    });

    afterAll(async () => {
      await app.close();
      if (prevSecret === undefined) delete process.env.CRON_SECRET;
      else process.env.CRON_SECRET = prevSecret;
    });

    it('returns 403 FORBIDDEN even when an Authorization header is sent', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/internal/cron/daily')
        .set('Authorization', `Bearer ${TEST_CRON_SECRET}`)
        .expect(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });
  });

  describe('when CRON_SECRET is configured', () => {
    let app: INestApplication;
    let otp: CapturingOtpSender;
    let prisma: PrismaService;
    const prevSecret = process.env.CRON_SECRET;

    beforeAll(async () => {
      process.env.CRON_SECRET = TEST_CRON_SECRET;
      ({ app, otp } = await createAuthTestApp());
      prisma = app.get(PrismaService);
    });

    afterAll(async () => {
      await app.close();
      if (prevSecret === undefined) delete process.env.CRON_SECRET;
      else process.env.CRON_SECRET = prevSecret;
    });

    it('returns 401 UNAUTHENTICATED when Authorization header is missing or invalid', async () => {
      const missing = await request(app.getHttpServer()).get('/api/v1/internal/cron/daily').expect(401);
      expect(missing.body.error.code).toBe('UNAUTHENTICATED');

      const wrong = await request(app.getHttpServer())
        .get('/api/v1/internal/cron/daily')
        .set('Authorization', 'Bearer wrong-secret')
        .expect(401);
      expect(wrong.body.error.code).toBe('UNAUTHENTICATED');

      const wrongScheme = await request(app.getHttpServer())
        .get('/api/v1/internal/cron/daily')
        .set('Authorization', `Basic ${TEST_CRON_SECRET}`)
        .expect(401);
      expect(wrongScheme.body.error.code).toBe('UNAUTHENTICATED');
    });

    it('runs JOB-1..4 on valid bearer token and expires overdue listings and reservations', async () => {
      const s = await seller(app, otp);
      const b = await login(app, otp, uniquePhone());

      // Create a published listing and a reservation, then age pickupEnd past the 15m no-show grace
      const listing = await published(app, s, {
        quantityTotal: 3,
        pickupStart: new Date(Date.now() + 5 * MIN).toISOString(),
        pickupEnd: new Date(Date.now() + 45 * MIN).toISOString(),
      });

      const created = await request(app.getHttpServer())
        .post('/api/v1/reservations')
        .set(bearer(b))
        .set('Idempotency-Key', randomUUID())
        .send({ listingId: listing.id, quantity: 1 })
        .expect(201);
      const reservationId = created.body.data.id as string;

      await prisma.foodListing.update({
        where: { id: listing.id },
        data: {
          pickupStart: new Date(Date.now() - 2 * HOUR),
          pickupEnd: new Date(Date.now() - 20 * MIN),
        },
      });

      const res = await request(app.getHttpServer())
        .get('/api/v1/internal/cron/daily')
        .set('Authorization', `Bearer ${TEST_CRON_SECRET}`)
        .expect(200);

      expect(res.body.data).toMatchObject({
        listingsExpired: expect.any(Number),
        reservationsExpired: expect.any(Number),
        cleanup: {
          otpRequests: expect.any(Number),
          refreshTokens: expect.any(Number),
          pickupTokens: expect.any(Number),
          images: expect.any(Number),
        },
        metricsRebuilt: expect.any(Number),
      });
      expect(res.body.data.listingsExpired).toBeGreaterThanOrEqual(1);
      expect(res.body.data.reservationsExpired).toBeGreaterThanOrEqual(1);

      const updatedListing = await prisma.foodListing.findUnique({ where: { id: listing.id } });
      const updatedReservation = await prisma.reservation.findUnique({ where: { id: reservationId } });
      expect(updatedListing?.status).toBe('EXPIRED');
      expect(updatedReservation?.status).toBe('EXPIRED');
    });
  });
});
