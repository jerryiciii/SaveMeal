import { Controller, Get, type INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { AdminOnly } from '../src/auth/auth.guard';
import { OTP_SENDER } from '../src/auth/otp-sender';
import { PrismaService } from '../src/prisma/prisma.service';
import { createTestApp } from './app';
import { bearer, CapturingOtpSender, login, uniquePhone, type Session } from './auth-helpers';

@Controller('__admin-probe')
@AdminOnly()
class AdminProbeController {
  @Get()
  ok() {
    return { data: { ok: true } };
  }
}

const HOUR = 3600_000;

describe('Me (ME-1..3)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const otp = new CapturingOtpSender();
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    app = await createTestApp({ controllers: [AdminProbeController] }, (b) => b.overrideProvider(OTP_SENDER).useValue(otp));
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  async function publishedListing(sellerId: string, quantity = 5) {
    const now = Date.now();
    return prisma.foodListing.create({
      data: {
        sellerId,
        title: 'Bánh',
        category: 'BAKERY',
        origin: 'Tiệm',
        preparedAt: new Date(now - HOUR),
        storage: 'ROOM_TEMP',
        price: 15000,
        quantityTotal: quantity,
        quantityAvailable: quantity,
        pickupStart: new Date(now + HOUR),
        pickupEnd: new Date(now + 2 * HOUR),
        pickupAddress: 'Đà Nẵng',
        pickupLat: 16.05,
        pickupLng: 108.24,
        status: 'PUBLISHED',
        declaration: {},
        declaredAt: new Date(now),
        publishedAt: new Date(now),
      },
    });
  }

  async function reservation(listingId: string, buyerId: string, sellerId: string, status: 'RESERVED' | 'COMPLETED', quantity = 1) {
    return prisma.reservation.create({
      data: {
        listingId,
        buyerId,
        sellerId,
        quantity,
        unitPrice: 15000,
        totalPrice: 15000 * quantity,
        payableAmount: 15000 * quantity,
        code: String(1000 + Math.floor(Math.random() * 9000)),
        status,
        idempotencyKey: randomUUID(),
      },
    });
  }

  describe('ME-1 · GET /me', () => {
    it('returns the stats for both sides of the account', async () => {
      const seller = await login(app, otp, uniquePhone());
      const buyer = await login(app, otp, uniquePhone());
      const listing = await publishedListing(seller.userId);
      await prisma.foodListing.create({ data: { sellerId: seller.userId, title: 'Nháp', category: 'MEAL' } });
      await reservation(listing.id, buyer.userId, seller.userId, 'COMPLETED', 2);
      const other = await login(app, otp, uniquePhone());
      await reservation(listing.id, other.userId, seller.userId, 'RESERVED');

      const sellerMe = await http().get('/api/v1/me').set(bearer(seller)).expect(200);
      expect(sellerMe.body.data.stats).toEqual({ portionsHandedOver: 2, reservationsActive: 0, listingsActive: 2 });
      const otherMe = await http().get('/api/v1/me').set(bearer(other)).expect(200);
      expect(otherMe.body.data.stats).toEqual({ portionsHandedOver: 0, reservationsActive: 1, listingsActive: 0 });
      const buyerMe = await http().get('/api/v1/me').set(bearer(buyer)).expect(200);
      expect(buyerMe.body.data.stats.portionsHandedOver).toBe(2);
    });
  });

  describe('ME-2 · PATCH /me', () => {
    let session: Session;

    beforeAll(async () => {
      session = await login(app, otp, uniquePhone());
    });

    it('updates the display name and seller info', async () => {
      const res = await http()
        .patch('/api/v1/me')
        .set(bearer(session))
        .send({
          displayName: 'Minh',
          seller: {
            name: 'Tiệm bánh Mây',
            type: 'BAKERY',
            defaultPickup: { address: '12 Ngô Thì Sĩ, Đà Nẵng', lat: 16.0478, lng: 108.2431 },
          },
        })
        .expect(200);
      expect(res.body.data).toMatchObject({
        displayName: 'Minh',
        seller: {
          name: 'Tiệm bánh Mây',
          type: 'BAKERY',
          verified: false,
          defaultPickup: { address: '12 Ngô Thì Sĩ, Đà Nẵng', lat: 16.0478, lng: 108.2431 },
        },
      });
    });

    it('clears seller fields with null and leaves omitted ones alone', async () => {
      const res = await http()
        .patch('/api/v1/me')
        .set(bearer(session))
        .send({ seller: { defaultPickup: null } })
        .expect(200);
      expect(res.body.data.seller).toEqual({
        name: 'Tiệm bánh Mây',
        type: 'BAKERY',
        verified: false,
        defaultPickup: null,
        bankQrImage: null,
      });
      expect(res.body.data.displayName).toBe('Minh');
    });

    it('sets and clears an avatar the caller uploaded', async () => {
      const image = await prisma.listingImage.create({
        data: { uploaderId: session.userId, purpose: 'AVATAR', storageKey: `test/${randomUUID()}.webp`, width: 64, height: 64, bytes: 10 },
      });
      const set = await http().patch('/api/v1/me').set(bearer(session)).send({ avatarImageId: image.id }).expect(200);
      expect(set.body.data.avatar).toEqual({ id: image.id, url: `/api/v1/media/${image.storageKey}`, width: 64, height: 64 });
      const cleared = await http().patch('/api/v1/me').set(bearer(session)).send({ avatarImageId: null }).expect(200);
      expect(cleared.body.data.avatar).toBeNull();
    });

    it('404 IMAGE_NOT_FOUND for an unknown image or someone else’s', async () => {
      const someoneElse = await login(app, otp, uniquePhone());
      const theirs = await prisma.listingImage.create({
        data: { uploaderId: someoneElse.userId, purpose: 'AVATAR', storageKey: `test/${randomUUID()}.webp`, width: 1, height: 1, bytes: 1 },
      });
      for (const id of [randomUUID(), theirs.id]) {
        const res = await http().patch('/api/v1/me').set(bearer(session)).send({ avatarImageId: id }).expect(404);
        expect(res.body.error.code).toBe('IMAGE_NOT_FOUND');
      }
    });

    it.each([
      [{ displayName: 'M' }, 'displayName'],
      [{ phone: '+84900000000' }, 'phone'],
      [{ seller: { type: 'RESTAURANT' } }, 'seller.type'],
      [{ seller: { defaultPickup: { address: 'Đà Nẵng', lat: 200, lng: 108 } } }, 'seller.defaultPickup.lat'],
      [{ avatarImageId: 'not-a-uuid' }, 'avatarImageId'],
    ])('400 VALIDATION_FAILED for %p', async (body, field) => {
      const res = await http().patch('/api/v1/me').set(bearer(session)).send(body).expect(400);
      expect(res.body.error.code).toBe('VALIDATION_FAILED');
      expect(res.body.error.details.fields).toHaveProperty([field]);
    });

    it('401 without a token', async () => {
      await http().patch('/api/v1/me').send({ displayName: 'Minh' }).expect(401);
    });
  });

  describe('ME-3 · DELETE /me', () => {
    it('400 VALIDATION_FAILED without the exact confirmation text', async () => {
      const session = await login(app, otp, uniquePhone());
      const res = await http().delete('/api/v1/me').set(bearer(session)).send({ confirm: 'xoa' }).expect(400);
      expect(res.body.error.details.fields).toHaveProperty('confirm');
    });

    it('409 ACCOUNT_HAS_ACTIVE_ITEMS with counts while orders or listings are active', async () => {
      const seller = await login(app, otp, uniquePhone());
      const buyer = await login(app, otp, uniquePhone());
      const listing = await publishedListing(seller.userId);
      await reservation(listing.id, buyer.userId, seller.userId, 'RESERVED');

      const asBuyer = await http().delete('/api/v1/me').set(bearer(buyer)).send({ confirm: 'XOA TAI KHOAN' }).expect(409);
      expect(asBuyer.body.error).toMatchObject({
        code: 'ACCOUNT_HAS_ACTIVE_ITEMS',
        details: { activeReservations: 1, activeListings: 0 },
      });
      const asSeller = await http().delete('/api/v1/me').set(bearer(seller)).send({ confirm: 'XOA TAI KHOAN' }).expect(409);
      expect(asSeller.body.error.details).toEqual({ activeReservations: 0, activeListings: 1 });
    });

    it('204: anonymises the account, deletes drafts, revokes sessions and keeps history', async () => {
      const phone = uniquePhone();
      const session = await login(app, otp, phone);
      const draft = await prisma.foodListing.create({ data: { sellerId: session.userId, title: 'Nháp', category: 'MEAL' } });

      const res = await http()
        .delete('/api/v1/me')
        .set(bearer(session))
        .set('Cookie', session.cookie)
        .send({ confirm: 'XOA TAI KHOAN' })
        .expect(204);
      expect(([] as string[]).concat(res.headers['set-cookie']).some((c) => c.startsWith('lb_rt=;'))).toBe(true);

      const account = await prisma.account.findUniqueOrThrow({ where: { id: session.userId } });
      expect(account).toMatchObject({
        status: 'DELETED',
        phone: null,
        email: null,
        avatarImageId: null,
        displayName: 'Người dùng đã xóa',
        sellerName: null,
      });
      expect(account.deletedAt).not.toBeNull();
      expect(await prisma.foodListing.findUnique({ where: { id: draft.id } })).toBeNull();
      expect(await prisma.eventLog.count({ where: { event: 'ACCOUNT_DELETED', entityId: session.userId } })).toBe(1);

      await http().get('/api/v1/me').set(bearer(session)).expect(401);
      await http().post('/api/v1/auth/refresh').set('Cookie', session.cookie).expect(401);

      // The phone is free again: signing in creates a brand-new account.
      const again = await login(app, otp, phone);
      expect(again.isNewUser).toBe(true);
      expect(again.userId).not.toBe(session.userId);
    });
  });

  describe('ADMIN guard', () => {
    it('403 FORBIDDEN for a USER, 200 for an ADMIN', async () => {
      const user = await login(app, otp, uniquePhone());
      expect((await http().get('/api/v1/__admin-probe').set(bearer(user)).expect(403)).body.error.code).toBe('FORBIDDEN');
      await prisma.account.update({ where: { id: user.userId }, data: { role: 'ADMIN' } });
      await http().get('/api/v1/__admin-probe').set(bearer(user)).expect(200);
    });
  });
});
