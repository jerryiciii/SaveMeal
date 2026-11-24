import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { localWallTime } from '../src/common/time';
import { PrismaService } from '../src/prisma/prisma.service';
import { createAuthTestApp, type CapturingOtpSender } from './auth-helpers';
import { published, seller } from './listing-helpers';

const HOUR = 3600_000;
let spot = 0;
/** A fresh, far-away centre per test so other suites' listings never appear in results. */
function nextCentre() {
  spot += 1;
  return { lat: 11 + spot * 0.5, lng: 105 + spot * 0.5 };
}
/** A point `km` kilometres north of `c`. */
const north = (c: { lat: number; lng: number }, km: number) => ({ lat: c.lat + km / 111.32, lng: c.lng });

describe('LIST-1 · GET /listings (search, list, map)', () => {
  let app: INestApplication;
  let otp: CapturingOtpSender;
  let prisma: PrismaService;
  const http = () => request(app.getHttpServer());
  const search = (c: { lat: number; lng: number }, qs = '') => http().get(`/api/v1/listings?lat=${c.lat}&lng=${c.lng}${qs}`);
  const ids = (res: request.Response) => res.body.data.map((l: { id: string }) => l.id);

  beforeAll(async () => {
    ({ app, otp } = await createAuthTestApp());
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns only visible listings: no drafts, under review, sold out, ended or suspended sellers', async () => {
    const c = nextCentre();
    const s = await seller(app, otp, c);
    const visible = await published(app, s, { title: 'Hiện' });
    const soldOut = await published(app, s, { title: 'Hết' });
    const review = await published(app, s, { title: 'Xem xét' });
    const ended = await published(app, s, { title: 'Hết giờ' });
    await prisma.foodListing.update({ where: { id: soldOut.id }, data: { quantityAvailable: 0 } });
    await prisma.foodListing.update({ where: { id: review.id }, data: { underReview: true } });
    await prisma.foodListing.update({
      where: { id: ended.id },
      data: { pickupStart: new Date(Date.now() - 2 * HOUR), pickupEnd: new Date(Date.now() - HOUR) },
    });
    await http().post('/api/v1/listings').set('Authorization', `Bearer ${s.accessToken}`).send({ title: 'Nháp', category: 'MEAL' }).expect(201);

    const res = await search(c).expect(200);
    expect(ids(res)).toEqual([visible.id]);
    expect(res.body.page).toEqual({ nextCursor: null, limit: 20 });
    expect(res.body.data[0]).toEqual({
      id: visible.id,
      title: 'Hiện',
      category: 'BAKERY',
      image: { id: expect.any(String), url: expect.stringMatching(/^\/api\/v1\/media\//), width: 64, height: 48 },
      originalPrice: 25000,
      price: 15000,
      isFree: false,
      quantityAvailable: 5,
      soldOut: false,
      pickupStart: expect.stringMatching(/\+07:00$/),
      pickupEnd: expect.stringMatching(/\+07:00$/),
      pickup: { address: 'Đà Nẵng', lat: c.lat, lng: c.lng },
      distanceMeters: 0,
      seller: { id: s.userId, name: 'Tiệm test', type: 'BAKERY', verified: false },
    });

    const withSoldOut = await search(c, '&includeSoldOut=true').expect(200);
    expect(ids(withSoldOut).sort()).toEqual([visible.id, soldOut.id].sort());
    expect(withSoldOut.body.data.find((l: { id: string }) => l.id === soldOut.id).soldOut).toBe(true);

    await prisma.account.update({ where: { id: s.userId }, data: { status: 'SUSPENDED' } });
    expect(ids(await search(c).expect(200))).toEqual([]);
  });

  it('filters by radius and sorts by distance (haversine), default 3 km', async () => {
    const c = nextCentre();
    const near = await published(app, await seller(app, otp, north(c, 0.5)));
    const mid = await published(app, await seller(app, otp, north(c, 2)));
    const far = await published(app, await seller(app, otp, north(c, 4.5)));

    const res = await search(c).expect(200);
    expect(ids(res)).toEqual([near.id, mid.id]);
    expect(res.body.data[0].distanceMeters).toBeGreaterThan(480);
    expect(res.body.data[0].distanceMeters).toBeLessThan(520);
    expect(ids(await search(c, '&radiusKm=5').expect(200))).toEqual([near.id, mid.id, far.id]);
    expect(ids(await search(c, '&radiusKm=1').expect(200))).toEqual([near.id]);
  });

  it('filters by price, free, category, text and seller', async () => {
    const c = nextCentre();
    const s = await seller(app, otp, c, 'Tiệm bánh Mây');
    const cheap = await published(app, s, { title: 'Bánh mì', price: 10000, originalPrice: 20000 });
    const pricey = await published(app, s, { title: 'Bánh kem', price: 25000, originalPrice: 40000 });
    const free = await published(app, s, { title: 'Trà tắc', category: 'DRINK', price: 0, originalPrice: null });
    const other = await published(app, await seller(app, otp, c, 'Cơm nhà'), { title: 'Cơm gà', category: 'MEAL', price: 18000 });

    expect(ids(await search(c, '&priceMax=20000&sort=priceAsc').expect(200))).toEqual([free.id, cheap.id, other.id]);
    const freeRes = await search(c, '&free=true').expect(200);
    expect(ids(freeRes)).toEqual([free.id]);
    expect(freeRes.body.data[0]).toMatchObject({ isFree: true, originalPrice: null });
    expect(ids(await search(c, '&category=DRINK,MEAL').expect(200)).sort()).toEqual([free.id, other.id].sort());
    expect(ids(await search(c, '&q=kem').expect(200))).toEqual([pricey.id]);
    expect(ids(await search(c, '&q=m%C3%A2y').expect(200)).sort()).toEqual([cheap.id, pricey.id, free.id].sort());
    expect(ids(await search(c, `&sellerId=${other.seller && (other.seller as { id: string }).id}`).expect(200))).toEqual([other.id]);
    expect(ids(await search(c, '&q=100%25').expect(200))).toEqual([]);
  });

  it('filters by pickup day and time range (local time) and sorts by pickup time and newest', async () => {
    const c = nextCentre();
    const s = await seller(app, otp, c);
    const now = new Date();
    const soon = await published(app, s, { title: 'Sớm' });
    const tomorrowStart = localWallTime(now, 9, 0, 1);
    const tomorrow = await published(app, s, {
      title: 'Ngày mai',
      category: 'PACKAGED',
      preparedAt: new Date(now.getTime() - HOUR).toISOString(),
      pickupStart: tomorrowStart.toISOString(),
      pickupEnd: new Date(tomorrowStart.getTime() + HOUR).toISOString(),
    });

    expect(ids(await search(c, '&pickupDay=tomorrow').expect(200))).toEqual([tomorrow.id]);
    expect(ids(await search(c, '&pickupDay=tomorrow&pickupFrom=09:30&pickupTo=11:00').expect(200))).toEqual([tomorrow.id]);
    expect(ids(await search(c, '&pickupDay=tomorrow&pickupFrom=11:00&pickupTo=12:00').expect(200))).toEqual([]);
    expect(ids(await search(c, '&sort=pickupSoon').expect(200))).toEqual([soon.id, tomorrow.id]);
    expect(ids(await search(c, '&sort=newest').expect(200))).toEqual([tomorrow.id, soon.id]);
  });

  it('view=map returns MapPin[] without a page', async () => {
    const c = nextCentre();
    const p = await published(app, await seller(app, otp, c));
    const res = await search(c, '&view=map').expect(200);
    expect(res.body).toEqual({
      data: [{ id: p.id, lat: c.lat, lng: c.lng, title: '5 phần bánh còn nguyên', price: 15000, isFree: false, quantityAvailable: 5, category: 'BAKERY' }],
    });
  });

  it('paginates with an opaque cursor', async () => {
    const c = nextCentre();
    const s = await seller(app, otp, c);
    for (let i = 0; i < 3; i++) await published(app, s, { title: `Món ${i}` });
    const p1 = await search(c, '&limit=2').expect(200);
    expect(p1.body.data).toHaveLength(2);
    expect(p1.body.page.limit).toBe(2);
    const p2 = await search(c, `&limit=2&cursor=${p1.body.page.nextCursor}`).expect(200);
    expect(p2.body.data).toHaveLength(1);
    expect(p2.body.page.nextCursor).toBeNull();
    expect(new Set([...ids(p1), ...ids(p2)]).size).toBe(3);
  });

  it('defaults to the Đà Nẵng centre without coordinates', async () => {
    const res = await http().get('/api/v1/listings').expect(200);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  it.each([
    ['?lat=91&lng=108', 'lat'],
    ['?lat=16', 'lng'],
    ['?radiusKm=20', 'radiusKm'],
    ['?category=PIZZA', 'category'],
    ['?sort=random', 'sort'],
    ['?pickupFrom=25:00', 'pickupFrom'],
    ['?limit=51', 'limit'],
    ['?free=maybe', 'free'],
  ])('400 VALIDATION_FAILED for %s', async (qs, field) => {
    const res = await http().get(`/api/v1/listings${qs}`).expect(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
    expect(res.body.error.details.fields).toHaveProperty(field);
  });
});
