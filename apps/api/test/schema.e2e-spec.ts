// Database-level invariants from the init migration (DOMAIN v1.1 §2, §5, §6). These hold no matter
// what the application code does.
import { Prisma, PrismaClient, type FoodListing } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { testDatabaseUrl } from './test-db';

const prisma = new PrismaClient({ datasources: { db: { url: testDatabaseUrl() } } });
const HOUR = 3600_000;

let phoneSeq = 0;
async function account(name: string) {
  phoneSeq += 1;
  return prisma.account.create({
    data: { phone: `+8491${String(Date.now()).slice(-5)}${String(phoneSeq).padStart(2, '0')}`, displayName: name },
  });
}

async function publishedListing(sellerId: string, overrides: Partial<Prisma.FoodListingUncheckedCreateInput> = {}) {
  const now = Date.now();
  return prisma.foodListing.create({
    data: {
      sellerId,
      title: 'Bánh test',
      category: 'BAKERY',
      origin: 'Làm tại tiệm',
      preparedAt: new Date(now - 2 * HOUR),
      storage: 'ROOM_TEMP',
      price: 15000,
      originalPrice: 25000,
      quantityTotal: 5,
      quantityAvailable: 5,
      pickupStart: new Date(now + HOUR),
      pickupEnd: new Date(now + 2 * HOUR),
      pickupAddress: '12 Ngô Thì Sĩ',
      pickupLat: 16.0478,
      pickupLng: 108.2431,
      status: 'PUBLISHED',
      declaration: { NOT_EXPIRED: true },
      declaredAt: new Date(now),
      publishedAt: new Date(now),
      ...overrides,
    },
  });
}

async function reservation(listingId: string, buyerId: string, sellerId: string, code: string) {
  return prisma.reservation.create({
    data: {
      listingId,
      buyerId,
      sellerId,
      quantity: 1,
      unitPrice: 15000,
      totalPrice: 15000,
      payableAmount: 15000,
      code,
      idempotencyKey: randomUUID(),
    },
  });
}

/** Asserts that a write is rejected by a named constraint or trigger. */
async function expectRejected(promise: Promise<unknown>, pattern: RegExp) {
  await expect(promise).rejects.toThrow(pattern);
}

describe('database invariants (init migration)', () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('runs on PostgreSQL 16 with every spec §3.2 table', async () => {
    const tables = await prisma.$queryRaw<{ table_name: string }[]>`
      SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name <> '_prisma_migrations' ORDER BY table_name`;
    expect(tables.map((t) => t.table_name)).toEqual([
      'accounts',
      'event_logs',
      'feedback',
      'food_listings',
      'listing_images',
      'otp_requests',
      'payments',
      'pickup_tokens',
      'refresh_tokens',
      'reports',
      'reservations',
      'seller_payout_accounts',
      'transaction_metrics',
    ]);
  });

  describe('food_listings stock CHECK: 0 ≤ quantity_available ≤ quantity_total', () => {
    let listing: FoodListing;

    beforeAll(async () => {
      const seller = await account('Seller');
      listing = await publishedListing(seller.id);
    });

    it('rejects negative stock', async () => {
      await expectRejected(
        prisma.$executeRaw`UPDATE food_listings SET quantity_available = -1 WHERE id = ${listing.id}::uuid`,
        /food_listings_quantity_check/,
      );
    });

    it('rejects stock above the total', async () => {
      await expectRejected(
        prisma.$executeRaw`UPDATE food_listings SET quantity_available = 6 WHERE id = ${listing.id}::uuid`,
        /food_listings_quantity_check/,
      );
    });

    it('accepts the bounds 0 and quantity_total', async () => {
      await prisma.$executeRaw`UPDATE food_listings SET quantity_available = 0 WHERE id = ${listing.id}::uuid`;
      await prisma.$executeRaw`UPDATE food_listings SET quantity_available = 5 WHERE id = ${listing.id}::uuid`;
    });

    it('a conditional decrement can never drive stock below zero', async () => {
      const updated = await prisma.$executeRaw`
        UPDATE food_listings SET quantity_available = quantity_available - 9
         WHERE id = ${listing.id}::uuid AND quantity_available >= 9`;
      expect(updated).toBe(0);
    });
  });

  describe('published listings are always complete (D§5)', () => {
    it('rejects PUBLISHED without the required info or declaration', async () => {
      const seller = await account('Seller');
      await expectRejected(
        prisma.foodListing.create({
          data: { sellerId: seller.id, title: 'Thiếu', category: 'MEAL', status: 'PUBLISHED', publishedAt: new Date() },
        }),
        /food_listings_published_complete_check/,
      );
      await expectRejected(publishedListing(seller.id, { declaration: undefined, declaredAt: null }), /published_complete/);
    });

    it('rejects PUBLISHED without published_at', async () => {
      const seller = await account('Seller');
      await expectRejected(publishedListing(seller.id, { publishedAt: null }), /food_listings_published_status_check/);
    });

    it('allows an incomplete DRAFT to be WITHDRAWN', async () => {
      const seller = await account('Seller');
      const draft = await prisma.foodListing.create({ data: { sellerId: seller.id, title: 'Nháp', category: 'MEAL' } });
      await prisma.foodListing.update({ where: { id: draft.id }, data: { status: 'WITHDRAWN', closedAt: new Date() } });
    });

    it('rejects an inverted pickup window and quantities outside 1–50', async () => {
      const seller = await account('Seller');
      const now = Date.now();
      await expectRejected(
        publishedListing(seller.id, { pickupStart: new Date(now + 2 * HOUR), pickupEnd: new Date(now + HOUR) }),
        /pickup_window_check/,
      );
      await expectRejected(publishedListing(seller.id, { quantityTotal: 51, quantityAvailable: 51 }), /quantity_total_check/);
      await expectRejected(publishedListing(seller.id, { price: -1 }), /food_listings_price_check/);
    });
  });

  describe('reservations', () => {
    it('allows one RESERVED order per buyer and listing, and another after it closes', async () => {
      const seller = await account('Seller');
      const buyer = await account('Buyer');
      const listing = await publishedListing(seller.id);
      const first = await reservation(listing.id, buyer.id, seller.id, '1111');
      await expectRejected(
        reservation(listing.id, buyer.id, seller.id, '2222'),
        /reservations_one_active_per_buyer_listing|Unique constraint/,
      );
      await prisma.reservation.update({ where: { id: first.id }, data: { status: 'CANCELLED' } });
      await reservation(listing.id, buyer.id, seller.id, '3333');
    });

    it('keeps the 4-digit code unique among the seller’s RESERVED orders only', async () => {
      const seller = await account('Seller');
      const [b1, b2, b3] = [await account('B1'), await account('B2'), await account('B3')];
      const listing = await publishedListing(seller.id);
      const r1 = await reservation(listing.id, b1.id, seller.id, '4281');
      await expectRejected(reservation(listing.id, b2.id, seller.id, '4281'), /Unique constraint|code_unique/);
      await prisma.reservation.update({ where: { id: r1.id }, data: { status: 'COMPLETED' } });
      await reservation(listing.id, b3.id, seller.id, '4281');
    });

    it('rejects a seller reserving their own listing, bad totals and bad codes', async () => {
      const seller = await account('Seller');
      const buyer = await account('Buyer');
      const listing = await publishedListing(seller.id);
      await expectRejected(reservation(listing.id, seller.id, seller.id, '5555'), /reservations_not_own_listing_check/);
      await expectRejected(reservation(listing.id, buyer.id, seller.id, '12a4'), /reservations_code_check/);
      await expectRejected(
        prisma.reservation.create({
          data: {
            listingId: listing.id,
            buyerId: buyer.id,
            sellerId: seller.id,
            quantity: 2,
            unitPrice: 15000,
            totalPrice: 15000,
            payableAmount: 15000,
            code: '6666',
            idempotencyKey: randomUUID(),
          },
        }),
        /reservations_total_check/,
      );
    });

    it('makes the Idempotency-Key unique per buyer', async () => {
      const seller = await account('Seller');
      const buyer = await account('Buyer');
      const l1 = await publishedListing(seller.id);
      const l2 = await publishedListing(seller.id);
      const key = randomUUID();
      const base = { buyerId: buyer.id, sellerId: seller.id, quantity: 1, unitPrice: 0, totalPrice: 0 };
      await prisma.reservation.create({ data: { ...base, listingId: l1.id, code: '7001', idempotencyKey: key } });
      await expectRejected(
        prisma.reservation.create({ data: { ...base, listingId: l2.id, code: '7002', idempotencyKey: key } }),
        /Unique constraint/,
      );
    });
  });

  it('pickup_tokens: at most one used token per reservation (single handover)', async () => {
    const seller = await account('Seller');
    const buyer = await account('Buyer');
    const listing = await publishedListing(seller.id);
    const r = await reservation(listing.id, buyer.id, seller.id, '8001');
    const exp = new Date(Date.now() + 10 * 60_000);
    await prisma.pickupToken.create({ data: { reservationId: r.id, tokenHash: randomUUID(), expiresAt: exp, usedAt: new Date() } });
    await expectRejected(
      prisma.pickupToken.create({ data: { reservationId: r.id, tokenHash: randomUUID(), expiresAt: exp, usedAt: new Date() } }),
      /Unique constraint|one_used_per_reservation/,
    );
    await prisma.pickupToken.create({ data: { reservationId: r.id, tokenHash: randomUUID(), expiresAt: exp } });
  });

  it('event_logs is append-only', async () => {
    const log = await prisma.eventLog.create({
      data: { actorType: 'SYSTEM', event: 'TEST', entityType: 'test', entityId: randomUUID() },
    });
    await expectRejected(prisma.eventLog.update({ where: { id: log.id }, data: { event: 'X' } }), /append-only/);
    await expectRejected(prisma.eventLog.delete({ where: { id: log.id } }), /append-only/);
  });

  it('feedback ratings are 1–5', async () => {
    const seller = await account('Seller');
    const buyer = await account('Buyer');
    const listing = await publishedListing(seller.id);
    const r = await reservation(listing.id, buyer.id, seller.id, '9001');
    await expectRejected(
      prisma.feedback.create({ data: { reservationId: r.id, authorId: buyer.id, sellerId: seller.id, rating: 6 } }),
      /feedback_rating_check/,
    );
  });
});
