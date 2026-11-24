import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { RateLimiter } from '../src/common/rate-limiter';
import { PrismaService } from '../src/prisma/prisma.service';
import { bearer, createAuthTestApp, login, uniquePhone, type CapturingOtpSender, type Session } from './auth-helpers';
import { published, seller, uploadImage } from './listing-helpers';

const MIN = 60_000;

describe('Reports and Admin (REP-1, ADM-1..9)', () => {
  let app: INestApplication;
  let otp: CapturingOtpSender;
  let prisma: PrismaService;
  let rateLimiter: RateLimiter;
  let adminSession: Session;

  beforeAll(async () => {
    ({ app, otp } = await createAuthTestApp());
    prisma = app.get(PrismaService);
    rateLimiter = app.get(RateLimiter);

    // Promote a dedicated test account to ADMIN via Prisma
    adminSession = await login(app, otp, uniquePhone());
    await prisma.account.update({
      where: { id: adminSession.userId },
      data: { role: 'ADMIN', displayName: 'Admin SaveMeal' },
    });
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

  async function reserve(buyerSession: Session, listingId: string, quantity = 1) {
    const res = await request(app.getHttpServer())
      .post('/api/v1/reservations')
      .set(bearer(buyerSession))
      .set('Idempotency-Key', randomUUID())
      .send({ listingId, quantity })
      .expect(201);
    return res.body.data as {
      id: string;
      status: string;
      pickupToken: { qrPayload: string };
      [k: string]: unknown;
    };
  }

  // ============================================================================================
  // REP-1 · POST /api/v1/reports
  // ============================================================================================

  describe('REP-1 · POST /api/v1/reports', () => {
    it('validates report targets: missing target, self-report, and reservation-scoped types', async () => {
      const s = await seller(app, otp);
      const { session: b } = await buyer('Khách kiểm tra');
      const { session: stranger } = await buyer('Người lạ');
      const listing = await published(app, s);
      const resv = await reserve(b, listing.id, 1);

      // Missing target -> 422 REPORT_TARGET_INVALID
      const missing = await request(app.getHttpServer())
        .post('/api/v1/reports')
        .set(bearer(b))
        .send({ type: 'WRONG_INFO', description: 'Thiếu đối tượng báo cáo hợp lệ' })
        .expect(422);
      expect(missing.body.error.code).toBe('REPORT_TARGET_INVALID');

      // Self-report on own listing -> 422 REPORT_TARGET_INVALID
      const selfListing = await request(app.getHttpServer())
        .post('/api/v1/reports')
        .set(bearer(s))
        .send({
          type: 'WRONG_INFO',
          listingId: listing.id,
          description: 'Tự báo cáo bài đăng của chính mình',
        })
        .expect(422);
      expect(selfListing.body.error.code).toBe('REPORT_TARGET_INVALID');

      // Self-report on own account -> 422 REPORT_TARGET_INVALID
      const selfAccount = await request(app.getHttpServer())
        .post('/api/v1/reports')
        .set(bearer(b))
        .send({
          type: 'OTHER',
          accountId: b.userId,
          description: 'Tự báo cáo tài khoản của chính mình',
        })
        .expect(422);
      expect(selfAccount.body.error.code).toBe('REPORT_TARGET_INVALID');

      // NOT_RECEIVED without reservationId -> 422 REPORT_TARGET_INVALID
      const notReceivedNoResv = await request(app.getHttpServer())
        .post('/api/v1/reports')
        .set(bearer(b))
        .send({
          type: 'NOT_RECEIVED',
          listingId: listing.id,
          description: 'Báo cáo chưa nhận hàng nhưng không có đơn',
        })
        .expect(422);
      expect(notReceivedNoResv.body.error.code).toBe('REPORT_TARGET_INVALID');

      // SELLER_ABSENT without reservationId -> 422 REPORT_TARGET_INVALID
      const sellerAbsentNoResv = await request(app.getHttpServer())
        .post('/api/v1/reports')
        .set(bearer(b))
        .send({
          type: 'SELLER_ABSENT',
          accountId: s.userId,
          description: 'Báo cáo người bán vắng mặt nhưng không có đơn',
        })
        .expect(422);
      expect(sellerAbsentNoResv.body.error.code).toBe('REPORT_TARGET_INVALID');

      // NOT_RECEIVED with someone else's reservationId -> 422 REPORT_TARGET_INVALID
      const foreignResv = await request(app.getHttpServer())
        .post('/api/v1/reports')
        .set(bearer(stranger))
        .send({
          type: 'NOT_RECEIVED',
          reservationId: resv.id,
          description: 'Báo cáo đơn hàng của người khác không hợp lệ',
        })
        .expect(422);
      expect(foreignResv.body.error.code).toBe('REPORT_TARGET_INVALID');

      // SELLER_ABSENT submitted by seller (not buyer) on reservation -> 422 REPORT_TARGET_INVALID
      const sellerOnBuyerType = await request(app.getHttpServer())
        .post('/api/v1/reports')
        .set(bearer(s))
        .send({
          type: 'SELLER_ABSENT',
          reservationId: resv.id,
          description: 'Người bán không thể báo cáo SELLER_ABSENT',
        })
        .expect(422);
      expect(sellerOnBuyerType.body.error.code).toBe('REPORT_TARGET_INVALID');
    });

    it('creates a WRONG_INFO report with REPORT-purpose image and hides reporter in response', async () => {
      const s = await seller(app, otp);
      const { session: b } = await buyer('Nguyễn Minh');
      const listing = await published(app, s);
      const reportImageId = await uploadImage(app, b, 'REPORT');

      const res = await request(app.getHttpServer())
        .post('/api/v1/reports')
        .set(bearer(b))
        .send({
          type: 'WRONG_INFO',
          listingId: listing.id,
          description: 'Thông tin giá gốc chưa đúng với thực tế tại tiệm',
          imageIds: [reportImageId],
        })
        .expect(201);

      const rep = res.body.data;
      expect(rep.type).toBe('WRONG_INFO');
      expect(rep.status).toBe('OPEN');
      expect(rep.action).toBeNull();
      expect(rep.listingId).toBe(listing.id);
      expect(rep.reportedAccountId).toBe(s.userId);
      expect(rep.reporter).toBeNull();
      expect(rep.images).toHaveLength(1);
      expect(rep.images[0].id).toBe(reportImageId);
    });

    it('UNSAFE_FOOD report immediately flags underReview=true, hides listing from feed, and blocks new reservations', async () => {
      const geo = { lat: 16.0612, lng: 108.2215 };
      const s = await seller(app, otp, geo, 'Tiệm bánh kiểm tra ATTP');
      const { session: reporter } = await buyer('Người báo cáo ATTP');
      const { session: otherBuyer } = await buyer('Người mua khác');
      const listing = await published(app, s);

      // Visible before report
      const beforeFeed = await request(app.getHttpServer())
        .get(`/api/v1/listings?lat=${geo.lat}&lng=${geo.lng}&radiusKm=5`)
        .expect(200);
      expect(beforeFeed.body.data.map((l: { id: string }) => l.id)).toContain(listing.id);

      // Submit UNSAFE_FOOD report
      await request(app.getHttpServer())
        .post('/api/v1/reports')
        .set(bearer(reporter))
        .send({
          type: 'UNSAFE_FOOD',
          listingId: listing.id,
          description: 'Thực phẩm có mùi lạ, nghi ngờ không đảm bảo an toàn',
        })
        .expect(201);

      // DB immediately has underReview = true
      const dbListing = await prisma.foodListing.findUnique({ where: { id: listing.id } });
      expect(dbListing?.underReview).toBe(true);

      // Disappears from GET /api/v1/listings
      const afterFeed = await request(app.getHttpServer())
        .get(`/api/v1/listings?lat=${geo.lat}&lng=${geo.lng}&radiusKm=5`)
        .expect(200);
      expect(afterFeed.body.data.map((l: { id: string }) => l.id)).not.toContain(listing.id);

      // POST /api/v1/reservations returns 409 LISTING_NOT_AVAILABLE
      const resvRes = await request(app.getHttpServer())
        .post('/api/v1/reservations')
        .set(bearer(otherBuyer))
        .set('Idempotency-Key', randomUUID())
        .send({ listingId: listing.id, quantity: 1 })
        .expect(409);
      expect(resvRes.body.error.code).toBe('LISTING_NOT_AVAILABLE');
    });

    it('enforces rate limit of 10 reports per day per account (11th returns 429 RATE_LIMITED)', async () => {
      const s = await seller(app, otp);
      const { session: spammer } = await buyer('Người gửi nhiều báo cáo');
      const listing = await published(app, s);

      for (let i = 1; i <= 10; i += 1) {
        await request(app.getHttpServer())
          .post('/api/v1/reports')
          .set(bearer(spammer))
          .send({
            type: 'WRONG_INFO',
            listingId: listing.id,
            description: `Báo cáo hợp lệ số ${i} về thông tin sản phẩm`,
          })
          .expect(201);
      }

      const eleventh = await request(app.getHttpServer())
        .post('/api/v1/reports')
        .set(bearer(spammer))
        .send({
          type: 'WRONG_INFO',
          listingId: listing.id,
          description: 'Báo cáo thứ 11 trong ngày vượt giới hạn cho phép',
        })
        .expect(429);
      expect(eleventh.body.error.code).toBe('RATE_LIMITED');
    });
  });

  // ============================================================================================
  // ADM-1..9 · /api/v1/admin/*
  // ============================================================================================

  describe('ADM-1..9 · Admin endpoints', () => {
    it('rejects non-admin users with 403 FORBIDDEN', async () => {
      const { session: normalUser } = await buyer('Người dùng thường');

      const endpoints = [
        '/api/v1/admin/reports',
        '/api/v1/admin/accounts',
        '/api/v1/admin/listings',
        '/api/v1/admin/reservations',
        '/api/v1/admin/metrics',
      ];
      for (const path of endpoints) {
        const res = await request(app.getHttpServer()).get(path).set(bearer(normalUser)).expect(403);
        expect(res.body.error.code).toBe('FORBIDDEN');
      }
    });

    it('ADM-1 & ADM-2: lists reports with reporter populated, filters by status/type, clears underReview, blocks listing, and suspends account', async () => {
      // 1) clearReview: true with DISMISSED / NONE clears underReview and sets handledAt
      const s1 = await seller(app, otp);
      const { session: b1 } = await buyer('Trần Thị Bình');
      const listing1 = await published(app, s1);

      const rep1Res = await request(app.getHttpServer())
        .post('/api/v1/reports')
        .set(bearer(b1))
        .send({
          type: 'UNSAFE_FOOD',
          listingId: listing1.id,
          description: 'Nghi ngờ bánh để lâu nhưng kiểm tra lại vẫn ổn',
        })
        .expect(201);
      const rep1Id = rep1Res.body.data.id as string;

      // ADM-1: GET /admin/reports with status & type filters + reporter populated
      const listRes = await request(app.getHttpServer())
        .get('/api/v1/admin/reports?status=OPEN&type=UNSAFE_FOOD&limit=50')
        .set(bearer(adminSession))
        .expect(200);
      const found1 = listRes.body.data.find((r: { id: string }) => r.id === rep1Id);
      expect(found1).toBeTruthy();
      expect(found1.reporter).toEqual({ id: b1.userId, displayName: 'Trần Thị Bình' });

      // ADM-2: dismiss and clearReview
      const dismissRes = await request(app.getHttpServer())
        .patch(`/api/v1/admin/reports/${rep1Id}`)
        .set(bearer(adminSession))
        .send({
          status: 'DISMISSED',
          action: 'NONE',
          resolution: 'Đã xác minh, thực phẩm đạt chuẩn an toàn',
          clearReview: true,
        })
        .expect(200);
      expect(dismissRes.body.data.status).toBe('DISMISSED');
      expect(dismissRes.body.data.action).toBe('NONE');
      expect(dismissRes.body.data.handledAt).toBeTruthy();

      const clearedListing = await prisma.foodListing.findUnique({ where: { id: listing1.id } });
      expect(clearedListing?.underReview).toBe(false);

      // 2) action: 'LISTING_BLOCKED' blocks listing and cancels active RESERVED orders
      const s2 = await seller(app, otp);
      const { session: b2 } = await buyer('Lê Văn Cường');
      const listing2 = await published(app, s2);
      const activeResv = await reserve(b2, listing2.id, 1);

      const rep2Res = await request(app.getHttpServer())
        .post('/api/v1/reports')
        .set(bearer(b2))
        .send({
          type: 'WRONG_INFO',
          listingId: listing2.id,
          description: 'Bài đăng sai thông tin nghiêm trọng cần khoá ngay',
        })
        .expect(201);
      const rep2Id = rep2Res.body.data.id as string;

      const blockViaReport = await request(app.getHttpServer())
        .patch(`/api/v1/admin/reports/${rep2Id}`)
        .set(bearer(adminSession))
        .send({
          status: 'RESOLVED',
          action: 'LISTING_BLOCKED',
          resolution: 'Khoá bài đăng do vi phạm thông tin',
          clearReview: true,
        })
        .expect(200);
      expect(blockViaReport.body.data.status).toBe('RESOLVED');
      expect(blockViaReport.body.data.action).toBe('LISTING_BLOCKED');

      const blockedListing2 = await prisma.foodListing.findUnique({ where: { id: listing2.id } });
      expect(blockedListing2?.status).toBe('BLOCKED');

      const cancelledOrder = await prisma.reservation.findUnique({ where: { id: activeResv.id } });
      expect(cancelledOrder?.status).toBe('CANCELLED');
      expect(cancelledOrder?.cancelReason).toBe('LISTING_BLOCKED');

      // 3) action: 'ACCOUNT_SUSPENDED' suspends reported account and revokes refresh tokens
      const s3 = await seller(app, otp);
      const { session: b3 } = await buyer('Phạm Thu Hà');
      const listing3 = await published(app, s3);

      const rep3Res = await request(app.getHttpServer())
        .post('/api/v1/reports')
        .set(bearer(b3))
        .send({
          type: 'OTHER',
          listingId: listing3.id,
          description: 'Tài khoản có dấu hiệu gian lận nhiều lần',
        })
        .expect(201);
      const rep3Id = rep3Res.body.data.id as string;

      await request(app.getHttpServer())
        .patch(`/api/v1/admin/reports/${rep3Id}`)
        .set(bearer(adminSession))
        .send({
          status: 'RESOLVED',
          action: 'ACCOUNT_SUSPENDED',
          resolution: 'Tạm khoá tài khoản do gian lận',
          clearReview: false,
        })
        .expect(200);

      const suspendedAcc = await prisma.account.findUnique({ where: { id: s3.userId } });
      expect(suspendedAcc?.status).toBe('SUSPENDED');

      const activeTokens = await prisma.refreshToken.count({
        where: { accountId: s3.userId, revokedAt: null },
      });
      expect(activeTokens).toBe(0);

      await request(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .set('Cookie', s3.cookie)
        .expect(401);
    });

    it('ADM-3: blocks PUBLISHED listing directly, cancels active reservations, and rejects terminal listing with 409 INVALID_STATE_TRANSITION', async () => {
      const s = await seller(app, otp);
      const { session: b } = await buyer('Khách bị huỷ đơn');
      const listing = await published(app, s);
      const activeResv = await reserve(b, listing.id, 2);

      const blockRes = await request(app.getHttpServer())
        .post(`/api/v1/admin/listings/${listing.id}/block`)
        .set(bearer(adminSession))
        .send({ reason: 'Vi phạm quy định an toàn thực phẩm' })
        .expect(200);

      expect(blockRes.body.data.status).toBe('BLOCKED');
      expect(blockRes.body.data.underReview).toBe(false);

      const resvAfter = await prisma.reservation.findUnique({ where: { id: activeResv.id } });
      expect(resvAfter?.status).toBe('CANCELLED');
      expect(resvAfter?.cancelReason).toBe('LISTING_BLOCKED');

      // Blocking an already BLOCKED (terminal) listing -> 409 INVALID_STATE_TRANSITION
      const secondBlock = await request(app.getHttpServer())
        .post(`/api/v1/admin/listings/${listing.id}/block`)
        .set(bearer(adminSession))
        .send({ reason: 'Thử khoá lại bài đã khoá' })
        .expect(409);
      expect(secondBlock.body.error.code).toBe('INVALID_STATE_TRANSITION');
    });

    it('ADM-4: suspends account (403 ACCOUNT_SUSPENDED except GET /me & POST /auth/logout; refresh fails) then reactivates to ACTIVE', async () => {
      const { session: user } = await buyer('Tài khoản thử tạm khoá');

      // Suspend
      const suspendRes = await request(app.getHttpServer())
        .post(`/api/v1/admin/accounts/${user.userId}/status`)
        .set(bearer(adminSession))
        .send({ status: 'SUSPENDED', reason: 'Kiểm tra vi phạm chính sách' })
        .expect(200);
      expect(suspendRes.body.data).toEqual({ id: user.userId, status: 'SUSPENDED' });

      // Regular authed endpoint -> 403 ACCOUNT_SUSPENDED
      const blockedCall = await request(app.getHttpServer())
        .get('/api/v1/me/reservations?tab=upcoming')
        .set(bearer(user))
        .expect(403);
      expect(blockedCall.body.error.code).toBe('ACCOUNT_SUSPENDED');

      // GET /me is still allowed for suspended accounts
      const meRes = await request(app.getHttpServer())
        .get('/api/v1/me')
        .set(bearer(user))
        .expect(200);
      expect(meRes.body.data.status).toBe('SUSPENDED');

      // Refresh cookie fails (revoked on suspend)
      const refreshRes = await request(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .set('Cookie', user.cookie)
        .expect(401);
      expect(refreshRes.body.error.code).toBe('REFRESH_INVALID');

      // POST /auth/logout is still allowed for suspended accounts
      await request(app.getHttpServer())
        .post('/api/v1/auth/logout')
        .set(bearer(user))
        .expect(204);

      // Reactivate to ACTIVE
      const reactivateRes = await request(app.getHttpServer())
        .post(`/api/v1/admin/accounts/${user.userId}/status`)
        .set(bearer(adminSession))
        .send({ status: 'ACTIVE', reason: 'Đã xác minh, mở lại tài khoản' })
        .expect(200);
      expect(reactivateRes.body.data).toEqual({ id: user.userId, status: 'ACTIVE' });

      // Subsequent authed call succeeds again
      await request(app.getHttpServer())
        .get('/api/v1/me/reservations?tab=upcoming')
        .set(bearer(user))
        .expect(200);
    });

    it('ADM-5: toggles seller verified badge (true -> false) and GET /sellers/:id reflects it', async () => {
      const s = await seller(app, otp, { lat: 16.05, lng: 108.22 }, 'Tiệm Bánh Xác Minh');

      // Verify true
      const verifyOn = await request(app.getHttpServer())
        .post(`/api/v1/admin/accounts/${s.userId}/seller-verification`)
        .set(bearer(adminSession))
        .send({ verified: true, note: 'Đã kiểm tra cửa hàng trực tiếp' })
        .expect(200);
      expect(verifyOn.body.data.id).toBe(s.userId);
      expect(verifyOn.body.data.seller.verified).toBe(true);

      const publicOn = await request(app.getHttpServer())
        .get(`/api/v1/sellers/${s.userId}`)
        .expect(200);
      expect(publicOn.body.data.verified).toBe(true);

      // Verify false
      const verifyOff = await request(app.getHttpServer())
        .post(`/api/v1/admin/accounts/${s.userId}/seller-verification`)
        .set(bearer(adminSession))
        .send({ verified: false, note: 'Thu hồi huy hiệu xác minh' })
        .expect(200);
      expect(verifyOff.body.data.seller.verified).toBe(false);

      const publicOff = await request(app.getHttpServer())
        .get(`/api/v1/sellers/${s.userId}`)
        .expect(200);
      expect(publicOff.body.data.verified).toBe(false);
    });

    it('ADM-6, ADM-7, ADM-8: lists accounts, listings, and reservations (pickupToken=null & buyer.displayName present)', async () => {
      const uniqueSellerName = `Tiệm ADM678 ${Date.now()}`;
      const s = await seller(app, otp, { lat: 16.051, lng: 108.221 }, uniqueSellerName);
      const { session: b } = await buyer('Nguyễn Bảo Ngọc');
      const listing = await published(app, s);
      const resv = await reserve(b, listing.id, 1);

      // ADM-6: GET /admin/accounts
      const accsRes = await request(app.getHttpServer())
        .get(`/api/v1/admin/accounts?q=${encodeURIComponent(uniqueSellerName)}&sellerOnly=true`)
        .set(bearer(adminSession))
        .expect(200);
      expect(accsRes.body.data).toHaveLength(1);
      expect(accsRes.body.data[0].id).toBe(s.userId);
      expect(accsRes.body.data[0].seller.name).toBe(uniqueSellerName);
      expect(accsRes.body.page).toEqual({ nextCursor: null, limit: 20 });

      // ADM-7: GET /admin/listings
      const listingsRes = await request(app.getHttpServer())
        .get(`/api/v1/admin/listings?sellerId=${s.userId}&status=PUBLISHED`)
        .set(bearer(adminSession))
        .expect(200);
      expect(listingsRes.body.data.map((l: { id: string }) => l.id)).toContain(listing.id);

      // ADM-8: GET /admin/reservations
      const resvsRes = await request(app.getHttpServer())
        .get(`/api/v1/admin/reservations?sellerId=${s.userId}&status=RESERVED`)
        .set(bearer(adminSession))
        .expect(200);
      const row = resvsRes.body.data.find((r: { id: string }) => r.id === resv.id);
      expect(row).toBeTruthy();
      expect(row.pickupToken).toBeNull();
      expect(row.buyer).toEqual({ displayName: 'Nguyễn Bảo Ngọc' });
    });

    it('ADM-9: computes KPIs accurately for portionsHandedOver, reservations, completionRate, listings, discount, and reports', async () => {
      const s = await seller(app, otp, { lat: 16.052, lng: 108.222 }, 'Tiệm KPI Test');
      const { session: b1 } = await buyer('Khách KPI 1');
      const { session: b2 } = await buyer('Khách KPI 2');

      // Listing 1: 50% discount (originalPrice 40000 -> price 20000), qty 5
      const listing1 = await published(app, s, {
        originalPrice: 40000,
        price: 20000,
        quantityTotal: 5,
        pickupStart: new Date(Date.now() + 10 * MIN).toISOString(),
        pickupEnd: new Date(Date.now() + 90 * MIN).toISOString(),
      });

      // Listing 2: published then expired with remaining stock
      const listing2 = await published(app, s, {
        originalPrice: 30000,
        price: 15000,
        quantityTotal: 3,
      });
      await prisma.foodListing.update({
        where: { id: listing2.id },
        data: { status: 'EXPIRED', quantityAvailable: 2 },
      });

      // Reservation 1: qty 2, COMPLETED via handover confirm
      const r1 = await reserve(b1, listing1.id, 2);
      await request(app.getHttpServer())
        .post('/api/v1/pickups/confirm')
        .set(bearer(s))
        .send({ reservationId: r1.id, qrPayload: r1.pickupToken.qrPayload })
        .expect(200);

      // Reservation 2: qty 1, CANCELLED by buyer
      const r2 = await reserve(b2, listing1.id, 1);
      await request(app.getHttpServer())
        .post(`/api/v1/reservations/${r2.id}/cancel`)
        .set(bearer(b2))
        .send({ reason: 'BUYER_CHANGED_PLAN' })
        .expect(200);

      // Reports: 1 OPEN (WRONG_INFO) + 1 RESOLVED (OTHER, action WARNING)
      await request(app.getHttpServer())
        .post('/api/v1/reports')
        .set(bearer(b1))
        .send({
          type: 'WRONG_INFO',
          listingId: listing1.id,
          description: 'Báo cáo đang mở để tính vào thống kê KPI',
        })
        .expect(201);

      const rep2 = await request(app.getHttpServer())
        .post('/api/v1/reports')
        .set(bearer(b2))
        .send({
          type: 'OTHER',
          listingId: listing1.id,
          description: 'Báo cáo sẽ được xử lý để tính vào thống kê KPI',
        })
        .expect(201);

      await request(app.getHttpServer())
        .patch(`/api/v1/admin/reports/${rep2.body.data.id}`)
        .set(bearer(adminSession))
        .send({
          status: 'RESOLVED',
          action: 'WARNING',
          resolution: 'Đã nhắc nhở người bán',
          clearReview: false,
        })
        .expect(200);

      // ADM-9: GET /admin/metrics scoped to this seller
      const metricsRes = await request(app.getHttpServer())
        .get(`/api/v1/admin/metrics?sellerId=${s.userId}`)
        .set(bearer(adminSession))
        .expect(200);

      const m = metricsRes.body.data;
      expect(m.portionsHandedOver).toBe(2);
      expect(m.reservations).toEqual({
        created: 2,
        completed: 1,
        cancelled: 1,
        expired: 0,
      });
      expect(m.completionRate).toBe(0.5);
      expect(m.listings).toEqual({
        published: 2,
        expiredWithStock: 1,
      });
      expect(m.listingExpiredRate).toBe(0.5);
      expect(m.discount).toEqual({
        avgRate: 0.5,
        samples: 1,
      });
      expect(m.reports.total).toBe(2);
      expect(m.reports.open).toBe(1);
      expect(m.reports.byType).toEqual({ WRONG_INFO: 1, OTHER: 1 });
      expect(m.reports.byAction).toEqual({ WARNING: 1 });
      expect(typeof m.reports.medianHandlingHours).toBe('number');
      expect(m.reports.medianHandlingHours).toBeGreaterThanOrEqual(0);
    });
  });
});
