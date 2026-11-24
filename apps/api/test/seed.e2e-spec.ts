import { PrismaClient } from '@prisma/client';
import { demoWindow, seed, SEED_PHONES } from '../prisma/seed';
import { testDatabaseUrl } from './test-db';

const prisma = new PrismaClient({ datasources: { db: { url: testDatabaseUrl() } } });

describe('demo seed (spec §7.3)', () => {
  // 09:00 local (UTC+7) on 2026-11-23.
  const morning = new Date('2026-11-23T02:00:00Z');

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('uses the 17:00–18:00 local window early in the day, else the next half hour', () => {
    expect(demoWindow(morning)).toEqual({
      start: new Date('2026-11-23T10:00:00Z'),
      end: new Date('2026-11-23T11:00:00Z'),
    });
    // 17:10 local → 17:30–18:30 local.
    expect(demoWindow(new Date('2026-11-23T10:10:00Z'))).toEqual({
      start: new Date('2026-11-23T10:30:00Z'),
      end: new Date('2026-11-23T11:30:00Z'),
    });
  });

  it('creates the admin, two sellers, two buyers and the demo listing; re-running is safe', async () => {
    await seed(prisma, morning);
    await seed(prisma, morning);

    const accounts = await prisma.account.findMany({ where: { phone: { in: Object.values(SEED_PHONES) } } });
    expect(accounts).toHaveLength(5);
    expect(accounts.find((a) => a.phone === SEED_PHONES.admin)?.role).toBe('ADMIN');

    const bakery = accounts.find((a) => a.phone === SEED_PHONES.bakery)!;
    expect(bakery.sellerName).toBe('Tiệm bánh Mây');
    expect(bakery.sellerVerifiedAt).not.toBeNull();
    const homeCook = accounts.find((a) => a.phone === SEED_PHONES.homeCook)!;
    expect(homeCook.sellerVerifiedAt).toBeNull();

    const demo = await prisma.foodListing.findMany({
      where: { sellerId: bakery.id, title: '5 phần bánh còn nguyên' },
      include: { images: true },
    });
    expect(demo).toHaveLength(1);
    expect(demo[0]).toMatchObject({
      status: 'PUBLISHED',
      originalPrice: 25000,
      price: 15000,
      quantityTotal: 5,
      quantityAvailable: 5,
      pickupStart: new Date('2026-11-23T10:00:00Z'),
      pickupEnd: new Date('2026-11-23T11:00:00Z'),
      underReview: false,
    });
    expect(demo[0]!.images).toHaveLength(1);
    expect(demo[0]!.preparedAt!.getTime()).toBeLessThan(morning.getTime());
    expect(demo[0]!.declaration).toEqual({
      NOT_EXPIRED: true,
      STORED_PROPERLY: true,
      NOT_SPOILED: true,
      NOT_SERVED_LEFTOVERS: true,
      INFO_DECLARED: true,
      PICKUP_WINDOW_OK: true,
    });

    const sellerIds = [bakery.id, homeCook.id];
    expect(await prisma.foodListing.count({ where: { sellerId: { in: sellerIds }, status: 'PUBLISHED' } })).toBe(4);
    expect(await prisma.foodListing.count({ where: { sellerId: { in: sellerIds }, status: 'DRAFT' } })).toBe(1);
    expect(await prisma.foodListing.count({ where: { sellerId: { in: sellerIds }, price: 0, status: 'PUBLISHED' } })).toBe(1);
    expect(
      await prisma.eventLog.count({ where: { event: 'LISTING_PUBLISHED', actorId: { in: sellerIds } } }),
    ).toBeGreaterThanOrEqual(4);
  });
});
