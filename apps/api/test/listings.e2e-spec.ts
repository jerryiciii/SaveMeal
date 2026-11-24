import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { bearer, createAuthTestApp, login, uniquePhone, type CapturingOtpSender, type Session } from './auth-helpers';
import { DECLARATION, completeInput, draft, published, seller, uploadImage } from './listing-helpers';

const HOUR = 3600_000;

describe('Listings (LIST-2..8, SELLER-1)', () => {
  let app: INestApplication;
  let otp: CapturingOtpSender;
  let prisma: PrismaService;
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    ({ app, otp } = await createAuthTestApp());
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  /** Simulates RESERVED/COMPLETED orders (the reservation endpoints arrive in M4). */
  async function reserve(listingId: string, sellerId: string, quantity: number, status: 'RESERVED' | 'COMPLETED' = 'RESERVED') {
    const buyer = await login(app, otp, uniquePhone());
    await prisma.$executeRaw`UPDATE food_listings SET quantity_available = quantity_available - ${quantity}::int WHERE id = ${listingId}::uuid`;
    const r = await prisma.reservation.create({
      data: {
        listingId,
        sellerId,
        buyerId: buyer.userId,
        quantity,
        unitPrice: 15000,
        totalPrice: 15000 * quantity,
        payableAmount: 15000 * quantity,
        code: String(1000 + Math.floor(Math.random() * 9000)),
        status,
        idempotencyKey: randomUUID(),
      },
    });
    const token = await prisma.pickupToken.create({
      data: { reservationId: r.id, tokenHash: randomUUID(), expiresAt: new Date(Date.now() + 600_000) },
    });
    return { buyer, reservation: r, token };
  }

  describe('LIST-3 · POST /listings', () => {
    it('201 DRAFT with missing[] and the seller’s default pickup point', async () => {
      const s = await seller(app, otp);
      const res = await http().post('/api/v1/listings').set(bearer(s)).send({ title: 'Bánh bông lan', category: 'BAKERY' }).expect(201);
      expect(res.body.data).toMatchObject({
        title: 'Bánh bông lan',
        status: 'DRAFT',
        pickup: { address: 'Đà Nẵng', lat: 16.0478, lng: 108.2431 },
        quantityAvailable: 0,
        missing: ['PHOTO', 'PRICE', 'PORTIONS', 'ORIGIN', 'PREPARED_AT', 'STORAGE', 'PICKUP_WINDOW'],
        editableFields: expect.arrayContaining(['category', 'storage', 'pickupStart']),
        seller: { id: s.userId, name: 'Tiệm test', type: 'BAKERY', verified: false },
        publishedAt: null,
        declaredAt: null,
      });
      expect(await prisma.eventLog.count({ where: { event: 'LISTING_CREATED', entityId: res.body.data.id } })).toBe(1);
    });

    it('a complete draft has an empty missing[] and keeps image order', async () => {
      const s = await seller(app, otp);
      const [a, b] = [await uploadImage(app, s), await uploadImage(app, s)];
      const res = await http().post('/api/v1/listings').set(bearer(s)).send(completeInput([b, a])).expect(201);
      expect(res.body.data.missing).toEqual([]);
      expect(res.body.data.images.map((i: { id: string }) => i.id)).toEqual([b, a]);
      expect(res.body.data.image.id).toBe(b);
    });

    it.each([
      [{ category: 'BAKERY' }, 'title'],
      [{ title: 'Bánh mì' }, 'category'],
      [{ title: 'Bá', category: 'BAKERY' }, 'title'],
      [{ title: 'Bánh', category: 'SAVORY' }, 'category'],
      [{ title: 'Bánh', category: 'BAKERY', quantityTotal: 51 }, 'quantityTotal'],
      [{ title: 'Bánh', category: 'BAKERY', price: 30000, originalPrice: 25000 }, 'price'],
      [{ title: 'Bánh', category: 'BAKERY', status: 'PUBLISHED' }, 'status'],
      [{ title: 'Bánh', category: 'BAKERY', imageIds: [randomUUID()] }, 'imageIds'],
    ])('400 VALIDATION_FAILED for %p', async (body, field) => {
      const s = await seller(app, otp);
      const res = await http().post('/api/v1/listings').set(bearer(s)).send(body).expect(400);
      expect(res.body.error.code).toBe('VALIDATION_FAILED');
      expect(res.body.error.details.fields).toHaveProperty(field);
    });

    it('422 LISTING_LIMIT beyond 5 active listings; terminal ones do not count', async () => {
      const s = await seller(app, otp);
      const ids: string[] = [];
      for (let i = 0; i < 5; i++) {
        ids.push((await http().post('/api/v1/listings').set(bearer(s)).send({ title: `Món ${i}`, category: 'MEAL' }).expect(201)).body.data.id);
      }
      const res = await http().post('/api/v1/listings').set(bearer(s)).send({ title: 'Món 6', category: 'MEAL' }).expect(422);
      expect(res.body.error.code).toBe('LISTING_LIMIT');
      await http().post(`/api/v1/listings/${ids[0]}/withdraw`).set(bearer(s)).send({ reason: 'OTHER' }).expect(200);
      await http().post('/api/v1/listings').set(bearer(s)).send({ title: 'Món 6', category: 'MEAL' }).expect(201);
    });

    it('401 without a token, 403 ACCOUNT_SUSPENDED when suspended', async () => {
      await http().post('/api/v1/listings').send({ title: 'Bánh', category: 'BAKERY' }).expect(401);
      const s = await seller(app, otp);
      await prisma.account.update({ where: { id: s.userId }, data: { status: 'SUSPENDED' } });
      expect((await http().post('/api/v1/listings').set(bearer(s)).send({ title: 'Bánh', category: 'BAKERY' }).expect(403)).body.error.code).toBe(
        'ACCOUNT_SUSPENDED',
      );
    });
  });

  describe('LIST-6 · POST /listings/{id}/publish', () => {
    it('200 PUBLISHED: stock = total, declaration recorded as evidence', async () => {
      const s = await seller(app, otp);
      const d = await draft(app, s);
      const res = await http().post(`/api/v1/listings/${d.id}/publish`).set(bearer(s)).send({ declaration: DECLARATION }).expect(200);
      expect(res.body.data).toMatchObject({
        status: 'PUBLISHED',
        quantityTotal: 5,
        quantityAvailable: 5,
        soldOut: false,
        price: 15000,
        originalPrice: 25000,
        isFree: false,
        missing: [],
        editableFields: ['title', 'description', 'imageIds', 'quantityTotal', 'price', 'pickupEnd'],
        declaredAt: expect.stringMatching(/\+07:00$/),
        publishedAt: expect.stringMatching(/\+07:00$/),
      });
      const event = await prisma.eventLog.findFirstOrThrow({ where: { event: 'LISTING_PUBLISHED', entityId: d.id } });
      expect(event.data).toMatchObject({ declaration: DECLARATION, quantityTotal: 5 });
    });

    it('422 LISTING_INCOMPLETE with details.missing', async () => {
      const s = await seller(app, otp);
      const d = await http().post('/api/v1/listings').set(bearer(s)).send({ title: 'Cơm gà', category: 'MEAL', price: 18000 }).expect(201);
      const res = await http().post(`/api/v1/listings/${d.body.data.id}/publish`).set(bearer(s)).send({ declaration: DECLARATION }).expect(422);
      expect(res.body.error).toMatchObject({
        code: 'LISTING_INCOMPLETE',
        details: { missing: ['PHOTO', 'PORTIONS', 'ORIGIN', 'PREPARED_AT', 'STORAGE', 'PICKUP_WINDOW'] },
      });
    });

    it.each([
      [{ ...DECLARATION, NOT_SPOILED: false }, ['NOT_SPOILED']],
      [{ NOT_EXPIRED: true }, ['STORED_PROPERLY', 'NOT_SPOILED', 'NOT_SERVED_LEFTOVERS', 'INFO_DECLARED', 'PICKUP_WINDOW_OK']],
      [{}, ['NOT_EXPIRED', 'STORED_PROPERLY', 'NOT_SPOILED', 'NOT_SERVED_LEFTOVERS', 'INFO_DECLARED', 'PICKUP_WINDOW_OK']],
    ])('422 DECLARATION_INCOMPLETE for %p', async (declaration, missing) => {
      const s = await seller(app, otp);
      const d = await draft(app, s);
      const res = await http().post(`/api/v1/listings/${d.id}/publish`).set(bearer(s)).send({ declaration }).expect(422);
      expect(res.body.error).toMatchObject({ code: 'DECLARATION_INCOMPLETE', details: { missing } });
      expect((await prisma.foodListing.findUniqueOrThrow({ where: { id: d.id } })).status).toBe('DRAFT');
    });

    it('422 PICKUP_WINDOW_INVALID when the window has ended', async () => {
      const s = await seller(app, otp);
      const d = await draft(app, s);
      await prisma.foodListing.update({
        where: { id: d.id },
        data: { pickupStart: new Date(Date.now() - 2 * HOUR), pickupEnd: new Date(Date.now() - HOUR) },
      });
      const res = await http().post(`/api/v1/listings/${d.id}/publish`).set(bearer(s)).send({ declaration: DECLARATION }).expect(422);
      expect(res.body.error.code).toBe('PICKUP_WINDOW_INVALID');
    });

    it('422 LISTING_TOO_OLD past the sanity limit (24 h; 72 h for PACKAGED)', async () => {
      const s = await seller(app, otp);
      const old = new Date(Date.now() - 30 * HOUR).toISOString();
      const d = await draft(app, s, { preparedAt: old });
      expect((await http().post(`/api/v1/listings/${d.id}/publish`).set(bearer(s)).send({ declaration: DECLARATION }).expect(422)).body.error.code).toBe(
        'LISTING_TOO_OLD',
      );
      const packaged = await draft(app, s, { preparedAt: old, category: 'PACKAGED' });
      await http().post(`/api/v1/listings/${packaged.id}/publish`).set(bearer(s)).send({ declaration: DECLARATION }).expect(200);
    });

    it('409 INVALID_STATE_TRANSITION when already published; 403/404 for others', async () => {
      const s = await seller(app, otp);
      const p = await published(app, s);
      const again = await http().post(`/api/v1/listings/${p.id}/publish`).set(bearer(s)).send({ declaration: DECLARATION }).expect(409);
      expect(again.body.error).toMatchObject({ code: 'INVALID_STATE_TRANSITION', details: { from: 'PUBLISHED', action: 'publish' } });
      const other = await seller(app, otp);
      await http().post(`/api/v1/listings/${p.id}/publish`).set(bearer(other)).send({ declaration: DECLARATION }).expect(403);
      const d = await draft(app, s);
      expect((await http().post(`/api/v1/listings/${d.id}/publish`).set(bearer(other)).send({ declaration: DECLARATION }).expect(404)).body.error.code).toBe(
        'LISTING_NOT_FOUND',
      );
    });

    it('403 ACCOUNT_SUSPENDED and 429 RATE_LIMITED (10 per hour)', async () => {
      const s = await seller(app, otp);
      const d = await draft(app, s);
      for (let i = 0; i < 10; i++) {
        await prisma.eventLog.create({ data: { actorId: s.userId, actorType: 'USER', event: 'LISTING_PUBLISHED', entityType: 'listing', entityId: randomUUID() } });
      }
      const limited = await http().post(`/api/v1/listings/${d.id}/publish`).set(bearer(s)).send({ declaration: DECLARATION }).expect(429);
      expect(limited.body.error.code).toBe('RATE_LIMITED');
      expect(limited.headers['retry-after']).toBeDefined();

      const t = await seller(app, otp);
      const d2 = await draft(app, t);
      await prisma.account.update({ where: { id: t.userId }, data: { status: 'SUSPENDED' } });
      await http().post(`/api/v1/listings/${d2.id}/publish`).set(bearer(t)).send({ declaration: DECLARATION }).expect(403);
    });

    it('there is no other path to PUBLISHED: status cannot be PATCHed and no admin override exists', async () => {
      const s = await seller(app, otp);
      const d = await draft(app, s);
      await http().patch(`/api/v1/listings/${d.id}`).set(bearer(s)).send({ status: 'PUBLISHED' }).expect(400);
      const admin = await login(app, otp, uniquePhone());
      await prisma.account.update({ where: { id: admin.userId }, data: { role: 'ADMIN' } });
      await http().post(`/api/v1/listings/${d.id}/publish`).set(bearer(admin)).send({ declaration: DECLARATION }).expect(404);
      expect((await prisma.foodListing.findUniqueOrThrow({ where: { id: d.id } })).status).toBe('DRAFT');
    });
  });

  describe('LIST-4 · PATCH /listings/{id}', () => {
    it('drafts accept any field', async () => {
      const s = await seller(app, otp);
      const d = await draft(app, s);
      const res = await http().patch(`/api/v1/listings/${d.id}`).set(bearer(s)).send({ category: 'PACKAGED', storage: 'CHILLED', price: 10000 }).expect(200);
      expect(res.body.data).toMatchObject({ category: 'PACKAGED', storage: 'CHILLED', price: 10000 });
    });

    it('409 FIELD_LOCKED for safety facts on a PUBLISHED listing (unchanged values pass)', async () => {
      const s = await seller(app, otp);
      const p = await published(app, s);
      const res = await http().patch(`/api/v1/listings/${p.id}`).set(bearer(s)).send({ category: 'MEAL', storage: 'CHILLED', title: 'Mới' }).expect(409);
      expect(res.body.error).toMatchObject({ code: 'FIELD_LOCKED', details: { fields: ['category', 'storage'] } });
      await http().patch(`/api/v1/listings/${p.id}`).set(bearer(s)).send({ category: 'BAKERY', title: 'Bánh còn nguyên' }).expect(200);
    });

    it('price only goes down; pickup end only earlier and never in the past', async () => {
      const s = await seller(app, otp);
      const p = await published(app, s);
      expect((await http().patch(`/api/v1/listings/${p.id}`).set(bearer(s)).send({ price: 20000 }).expect(409)).body.error.code).toBe(
        'PRICE_INCREASE_NOT_ALLOWED',
      );
      await http().patch(`/api/v1/listings/${p.id}`).set(bearer(s)).send({ price: 12000 }).expect(200);
      const later = new Date(Date.now() + 3 * HOUR).toISOString();
      expect((await http().patch(`/api/v1/listings/${p.id}`).set(bearer(s)).send({ pickupEnd: later }).expect(409)).body.error.code).toBe(
        'PICKUP_WINDOW_EXTENSION_NOT_ALLOWED',
      );
      const past = new Date(Date.now() - 60_000).toISOString();
      await http().patch(`/api/v1/listings/${p.id}`).set(bearer(s)).send({ pickupEnd: past }).expect(400);
      const earlier = new Date(Date.now() + HOUR).toISOString();
      await http().patch(`/api/v1/listings/${p.id}`).set(bearer(s)).send({ pickupEnd: earlier }).expect(200);
    });

    it('quantity moves stock atomically and never below the reserved count', async () => {
      const s = await seller(app, otp);
      const p = await published(app, s);
      await reserve(p.id, s.userId, 2);
      await reserve(p.id, s.userId, 1, 'COMPLETED');
      const below = await http().patch(`/api/v1/listings/${p.id}`).set(bearer(s)).send({ quantityTotal: 2 }).expect(409);
      expect(below.body.error.code).toBe('QUANTITY_BELOW_RESERVED');
      const up = await http().patch(`/api/v1/listings/${p.id}`).set(bearer(s)).send({ quantityTotal: 8 }).expect(200);
      expect(up.body.data).toMatchObject({ quantityTotal: 8, quantityAvailable: 5, reservedCount: 2, completedCount: 1 });
      const down = await http().patch(`/api/v1/listings/${p.id}`).set(bearer(s)).send({ quantityTotal: 3 }).expect(200);
      expect(down.body.data).toMatchObject({ quantityTotal: 3, quantityAvailable: 0, soldOut: true });
    });

    it('404 for someone else’s draft, 403 for their published listing, 400 for bad input', async () => {
      const s = await seller(app, otp);
      const other = await seller(app, otp);
      const d = await draft(app, s);
      const p = await published(app, s);
      await http().patch(`/api/v1/listings/${d.id}`).set(bearer(other)).send({ title: 'Hack' }).expect(404);
      expect((await http().patch(`/api/v1/listings/${p.id}`).set(bearer(other)).send({ title: 'Hack' }).expect(403)).body.error.code).toBe('FORBIDDEN');
      const bad = await http().patch(`/api/v1/listings/${d.id}`).set(bearer(s)).send({ pickupStart: new Date(Date.now() + 5 * HOUR).toISOString() }).expect(400);
      expect(bad.body.error.details.fields).toHaveProperty('pickupEnd');
    });
  });

  describe('state machine (D§3): every action from every status', () => {
    type Status = 'DRAFT' | 'PUBLISHED' | 'EXPIRED' | 'WITHDRAWN' | 'BLOCKED';
    const table: [Status, 'update' | 'delete' | 'publish' | 'withdraw', number][] = [
      ['DRAFT', 'update', 200], ['DRAFT', 'delete', 204], ['DRAFT', 'publish', 200], ['DRAFT', 'withdraw', 200],
      ['PUBLISHED', 'update', 200], ['PUBLISHED', 'delete', 409], ['PUBLISHED', 'publish', 409], ['PUBLISHED', 'withdraw', 200],
      ['EXPIRED', 'update', 409], ['EXPIRED', 'delete', 409], ['EXPIRED', 'publish', 409], ['EXPIRED', 'withdraw', 409],
      ['WITHDRAWN', 'update', 409], ['WITHDRAWN', 'delete', 409], ['WITHDRAWN', 'publish', 409], ['WITHDRAWN', 'withdraw', 409],
      ['BLOCKED', 'update', 409], ['BLOCKED', 'delete', 409], ['BLOCKED', 'publish', 409], ['BLOCKED', 'withdraw', 409],
    ];

    it.each(table)('%s + %s → %i', async (status, action, expected) => {
      const s = await seller(app, otp);
      const listing = status === 'DRAFT' ? await draft(app, s) : await published(app, s);
      if (status !== 'DRAFT' && status !== 'PUBLISHED') {
        await prisma.foodListing.update({ where: { id: listing.id }, data: { status, closedAt: new Date() } });
      }
      const url = `/api/v1/listings/${listing.id}`;
      const req = {
        update: () => http().patch(url).set(bearer(s)).send({ title: 'Đổi tên' }),
        delete: () => http().delete(url).set(bearer(s)),
        publish: () => http().post(`${url}/publish`).set(bearer(s)).send({ declaration: DECLARATION }),
        withdraw: () => http().post(`${url}/withdraw`).set(bearer(s)).send({ reason: 'STORAGE_NOT_OK' }),
      }[action];
      const res = await req().expect(expected);
      if (expected === 409) expect(res.body.error).toMatchObject({ code: 'INVALID_STATE_TRANSITION', details: { from: status, action } });
    });
  });

  describe('LIST-5 · DELETE /listings/{id}', () => {
    it('204 on a draft; its images become unattached', async () => {
      const s = await seller(app, otp);
      const d = await draft(app, s);
      await http().delete(`/api/v1/listings/${d.id}`).set(bearer(s)).expect(204);
      expect(await prisma.foodListing.findUnique({ where: { id: d.id } })).toBeNull();
      expect(await prisma.listingImage.count({ where: { uploaderId: s.userId, listingId: null } })).toBe(1);
    });
  });

  describe('LIST-7 · POST /listings/{id}/withdraw', () => {
    it('cancels RESERVED orders (SELLER_WITHDREW) and revokes their tokens; stock is not released', async () => {
      const s = await seller(app, otp);
      const p = await published(app, s);
      const { reservation, token } = await reserve(p.id, s.userId, 2);
      const res = await http()
        .post(`/api/v1/listings/${p.id}/withdraw`)
        .set(bearer(s))
        .send({ reason: 'STORAGE_NOT_OK', note: 'Tủ lạnh hỏng' })
        .expect(200);
      expect(res.body.data).toMatchObject({ status: 'WITHDRAWN', closeReason: 'STORAGE_NOT_OK: Tủ lạnh hỏng', quantityAvailable: 3 });
      expect(await prisma.reservation.findUniqueOrThrow({ where: { id: reservation.id } })).toMatchObject({
        status: 'CANCELLED',
        cancelReason: 'SELLER_WITHDREW',
      });
      expect((await prisma.pickupToken.findUniqueOrThrow({ where: { id: token.id } })).revokedAt).not.toBeNull();
    });

    it('400 VALIDATION_FAILED for an unknown reason', async () => {
      const s = await seller(app, otp);
      const p = await published(app, s);
      await http().post(`/api/v1/listings/${p.id}/withdraw`).set(bearer(s)).send({ reason: 'BORED' }).expect(400);
    });
  });

  describe('LIST-2 · GET /listings/{id}', () => {
    it('public detail for a PUBLISHED listing (no owner fields)', async () => {
      const s = await seller(app, otp);
      const p = await published(app, s);
      const res = await http().get(`/api/v1/listings/${p.id}`).expect(200);
      expect(res.body.data).toMatchObject({ id: p.id, status: 'PUBLISHED', origin: 'Làm tại tiệm sáng nay', underReview: false, myActiveReservationId: null });
      expect(res.body.data).not.toHaveProperty('missing');
      expect(res.body.data).not.toHaveProperty('quantityTotal');
    });

    it('the owner (and an admin) get the owner view, also for drafts; the public does not see drafts', async () => {
      const s = await seller(app, otp);
      const d = await draft(app, s);
      await http().get(`/api/v1/listings/${d.id}`).expect(404);
      expect((await http().get(`/api/v1/listings/${d.id}`).set(bearer(s)).expect(200)).body.data.missing).toEqual([]);
      const admin = await login(app, otp, uniquePhone());
      await prisma.account.update({ where: { id: admin.userId }, data: { role: 'ADMIN' } });
      expect((await http().get(`/api/v1/listings/${d.id}`).set(bearer(admin)).expect(200)).body.data).toHaveProperty('missing');
    });

    it('under review and sold out stay viewable; a suspended seller’s listing is hidden', async () => {
      const s = await seller(app, otp);
      const p = await published(app, s);
      await prisma.foodListing.update({ where: { id: p.id }, data: { underReview: true, quantityAvailable: 0 } });
      expect((await http().get(`/api/v1/listings/${p.id}`).expect(200)).body.data).toMatchObject({ underReview: true, soldOut: true });
      await prisma.account.update({ where: { id: s.userId }, data: { status: 'SUSPENDED' } });
      await http().get(`/api/v1/listings/${p.id}`).expect(404);
    });

    it('a buyer still sees a closed listing they reserved, with their active reservation id', async () => {
      const s = await seller(app, otp);
      const p = await published(app, s);
      const { buyer, reservation } = await reserve(p.id, s.userId, 1);
      expect((await http().get(`/api/v1/listings/${p.id}`).set(bearer(buyer)).expect(200)).body.data.myActiveReservationId).toBe(reservation.id);
      await prisma.foodListing.update({ where: { id: p.id }, data: { status: 'EXPIRED', closedAt: new Date() } });
      await http().get(`/api/v1/listings/${p.id}`).expect(404);
      await http().get(`/api/v1/listings/${p.id}`).set(bearer(buyer)).expect(200);
    });

    it('404 LISTING_NOT_FOUND for unknown or malformed ids', async () => {
      await http().get(`/api/v1/listings/${randomUUID()}`).expect(404);
      expect((await http().get('/api/v1/listings/abc').expect(404)).body.error.code).toBe('LISTING_NOT_FOUND');
    });
  });

  describe('LIST-8 · GET /me/listings', () => {
    it('active tab = DRAFT + PUBLISHED, done tab = terminal, paginated', async () => {
      const s = await seller(app, otp);
      const d = await draft(app, s);
      const p = await published(app, s);
      const w = await published(app, s);
      await http().post(`/api/v1/listings/${w.id}/withdraw`).set(bearer(s)).send({ reason: 'SOLD_ELSEWHERE' }).expect(200);

      const active = await http().get('/api/v1/me/listings?tab=active').set(bearer(s)).expect(200);
      expect(active.body.data.map((l: { id: string }) => l.id).sort()).toEqual([d.id, p.id].sort());
      expect(active.body.page).toEqual({ nextCursor: null, limit: 20 });
      const done = await http().get('/api/v1/me/listings?tab=done').set(bearer(s)).expect(200);
      expect(done.body.data.map((l: { id: string }) => l.id)).toEqual([w.id]);

      const page1 = await http().get('/api/v1/me/listings?limit=1').set(bearer(s)).expect(200);
      expect(page1.body.data).toHaveLength(1);
      const page2 = await http().get(`/api/v1/me/listings?limit=1&cursor=${page1.body.page.nextCursor}`).set(bearer(s)).expect(200);
      expect(page2.body.data[0].id).not.toBe(page1.body.data[0].id);
      expect(page2.body.page.nextCursor).toBeNull();
      await http().get('/api/v1/me/listings?cursor=garbage').set(bearer(s)).expect(400);
      await http().get('/api/v1/me/listings').expect(401);
    });
  });

  describe('SELLER-1 · GET /sellers/{id}', () => {
    it('public profile with counts; 404 SELLER_NOT_FOUND when suspended or unknown', async () => {
      const s = await seller(app, otp);
      const p = await published(app, s);
      await reserve(p.id, s.userId, 1, 'COMPLETED');
      const res = await http().get(`/api/v1/sellers/${s.userId}`).expect(200);
      expect(res.body.data).toEqual({
        id: s.userId,
        name: 'Tiệm test',
        type: 'BAKERY',
        verified: false,
        activeListingCount: 1,
        completedHandovers: 1,
        memberSince: expect.stringMatching(/\+07:00$/),
      });
      expect(JSON.stringify(res.body)).not.toMatch(/phone|email/);
      await prisma.account.update({ where: { id: s.userId }, data: { status: 'SUSPENDED' } });
      expect((await http().get(`/api/v1/sellers/${s.userId}`).expect(404)).body.error.code).toBe('SELLER_NOT_FOUND');
      await http().get(`/api/v1/sellers/${randomUUID()}`).expect(404);
    });
  });

  it('serves listing images publicly at their url', async () => {
    const s: Session = await seller(app, otp);
    const p = await published(app, s);
    const detail = await http().get(`/api/v1/listings/${p.id}`).expect(200);
    const res = await http().get(detail.body.data.image.url).expect(200);
    expect(res.headers['content-type']).toBe('image/webp');
  });
});
