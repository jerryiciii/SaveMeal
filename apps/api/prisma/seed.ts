// Demo seed (local development only; never run against production). Re-runnable: accounts are
// upserted by phone, and the seed sellers' listings without reservations are recreated with
// pickup windows relative to "now", so the map always has live listings near Đà Nẵng.
//
// Accounts (sign in with the console OTP provider from M2):
//   +84900000001  admin
//   +84900000002  Tiệm bánh Mây (BAKERY, verified badge): the spec §7.3 demo listing
//   +84900000003  Cơm nhà Hạnh (INDIVIDUAL, no badge: publishing does not need one, D§9 D4)
//   +84900000004  buyer (student)
//   +84900000005  second buyer
import { Prisma, PrismaClient, type Category, type Storage } from '@prisma/client';
import { DECLARATION_KEYS } from '@savemeal/shared';
import { existsSync, mkdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import sharp from 'sharp';

const OFFSET_MS = 7 * 3600_000; // Asia/Ho_Chi_Minh, fixed UTC+7
const HOUR = 3600_000;
const MIN = 60_000;

/** Local wall-clock time on the local date of `base`, as a UTC instant. */
function localAt(base: Date, hh: number, mm: number): Date {
  const local = new Date(base.getTime() + OFFSET_MS);
  return new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate(), hh, mm) - OFFSET_MS);
}

/** Next half hour strictly after `t`. */
function nextHalfHour(t: Date): Date {
  return new Date(Math.ceil((t.getTime() + 1) / (30 * MIN)) * 30 * MIN);
}

/**
 * The spec §7.3 demo window is 17:00–18:00 local. Later in the day (or past it) the window starts
 * at the next half hour instead, so the demo listing is always live after seeding.
 */
export function demoWindow(now: Date): { start: Date; end: Date } {
  const start = localAt(now, 17, 0);
  if (now.getTime() <= start.getTime() - 30 * MIN) return { start, end: new Date(start.getTime() + HOUR) };
  const s = nextHalfHour(now);
  return { start: s, end: new Date(s.getTime() + HOUR) };
}

export const SEED_PHONES = {
  admin: '+84900000001',
  bakery: '+84900000002',
  homeCook: '+84900000003',
  buyer: '+84900000004',
  buyer2: '+84900000005',
} as const;

type SeedListing = {
  title: string;
  description: string;
  category: Category;
  origin: string;
  storage: Storage;
  storageNote: string | null;
  ingredients: string | null;
  originalPrice: number | null;
  price: number;
  quantity: number;
  /** Pickup window relative to the demo window start, in minutes. */
  startOffsetMin: number;
  durationMin: number;
  preparedHoursBeforeStart: number;
  image: string;
  published: boolean;
};

const PALETTE = ['#F59E0B', '#EF4444', '#10B981', '#3B82F6', '#8B5CF6'];

/** Writes a placeholder webp (coloured card with the title) for a seed image if it is missing. */
async function ensureSeedImage(key: string, title: string, index: number): Promise<number> {
  const path = join(resolve(process.env.UPLOAD_DIR ?? 'uploads'), key);
  if (!existsSync(path)) {
    mkdirSync(dirname(path), { recursive: true });
    const safe = title.replace(/[<>&"]/g, '');
    const svg = Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600">` +
        `<rect width="800" height="600" fill="${PALETTE[index % PALETTE.length]}"/>` +
        `<text x="400" y="310" font-family="sans-serif" font-size="44" fill="#fff" text-anchor="middle">${safe}</text>` +
        `</svg>`,
    );
    await sharp(svg).webp({ quality: 80 }).toFile(path);
  }
  return statSync(path).size;
}

const DECLARATION =Object.fromEntries(DECLARATION_KEYS.map((k) => [k, true]));

async function upsertAccount(prisma: PrismaClient, phone: string, data: Prisma.AccountCreateInput) {
  return prisma.account.upsert({ where: { phone }, update: {}, create: { ...data, phone } });
}

async function recreateListings(
  prisma: PrismaClient,
  sellerId: string,
  pickup: { address: string; lat: number; lng: number },
  listings: SeedListing[],
  now: Date,
): Promise<number> {
  // Keep anything that already has reservations (history); recreate the rest with fresh times.
  const stale = await prisma.foodListing.findMany({
    where: { sellerId, reservations: { none: {} } },
    select: { id: true },
  });
  const staleIds = stale.map((l) => l.id);
  await prisma.listingImage.deleteMany({ where: { listingId: { in: staleIds } } });
  await prisma.foodListing.deleteMany({ where: { id: { in: staleIds } } });

  const demo = demoWindow(now);
  for (const [index, item] of listings.entries()) {
    const storageKey = `seed/${item.image}.webp`;
    const bytes = await ensureSeedImage(storageKey, item.title, index);
    const pickupStart = new Date(demo.start.getTime() + item.startOffsetMin * MIN);
    const pickupEnd = new Date(pickupStart.getTime() + item.durationMin * MIN);
    const preparedAt = new Date(
      Math.min(pickupStart.getTime() - item.preparedHoursBeforeStart * HOUR, now.getTime() - 30 * MIN),
    );
    const listing = await prisma.foodListing.create({
      data: {
        sellerId,
        title: item.title,
        description: item.description,
        category: item.category,
        origin: item.origin,
        preparedAt,
        storage: item.storage,
        storageNote: item.storageNote,
        ingredients: item.ingredients,
        originalPrice: item.originalPrice,
        price: item.price,
        quantityTotal: item.quantity,
        quantityAvailable: item.published ? item.quantity : 0,
        pickupStart,
        pickupEnd,
        pickupAddress: pickup.address,
        pickupLat: pickup.lat,
        pickupLng: pickup.lng,
        status: item.published ? 'PUBLISHED' : 'DRAFT',
        declaration: item.published ? DECLARATION : undefined,
        declaredAt: item.published ? now : null,
        publishedAt: item.published ? now : null,
        images: {
          create: {
            uploaderId: sellerId,
            purpose: 'LISTING',
            storageKey,
            width: 800,
            height: 600,
            bytes,
            position: 0,
          },
        },
      },
    });
    await prisma.eventLog.create({
      data: {
        actorId: sellerId,
        actorType: 'USER',
        event: item.published ? 'LISTING_PUBLISHED' : 'LISTING_CREATED',
        entityType: 'listing',
        entityId: listing.id,
        data: item.published ? { declaration: DECLARATION, seed: true } : { seed: true },
      },
    });
  }
  return listings.length;
}

export async function seed(prisma: PrismaClient, now = new Date()): Promise<{ accounts: number; listings: number }> {
  const admin = await upsertAccount(prisma, SEED_PHONES.admin, {
    displayName: 'Quản trị SaveMeal',
    role: 'ADMIN',
  });

  const bakeryPickup = { address: '12 Ngô Thì Sĩ, Mỹ An, Ngũ Hành Sơn, Đà Nẵng', lat: 16.0478, lng: 108.2431 };
  const bakery = await upsertAccount(prisma, SEED_PHONES.bakery, {
    displayName: 'Mây',
    sellerName: 'Tiệm bánh Mây',
    sellerType: 'BAKERY',
    sellerVerifiedAt: now,
    sellerVerifier: { connect: { id: admin.id } },
    defaultPickupAddress: bakeryPickup.address,
    defaultPickupLat: bakeryPickup.lat,
    defaultPickupLng: bakeryPickup.lng,
  });

  const homePickup = { address: '45 Lê Văn Hiến, Khuê Mỹ, Ngũ Hành Sơn, Đà Nẵng', lat: 16.0512, lng: 108.2378 };
  const homeCook = await upsertAccount(prisma, SEED_PHONES.homeCook, {
    displayName: 'Hạnh',
    sellerName: 'Cơm nhà Hạnh',
    sellerType: 'INDIVIDUAL',
    defaultPickupAddress: homePickup.address,
    defaultPickupLat: homePickup.lat,
    defaultPickupLng: homePickup.lng,
  });

  await upsertAccount(prisma, SEED_PHONES.buyer, { displayName: 'Minh' });
  await upsertAccount(prisma, SEED_PHONES.buyer2, { displayName: 'Lan' });

  let listings = 0;
  listings += await recreateListings(prisma, bakery.id, bakeryPickup, [
    {
      // Spec §7.3 demo listing.
      title: '5 phần bánh còn nguyên',
      description: 'Bánh ngọt làm trong ngày, còn nguyên hộp.',
      category: 'BAKERY',
      origin: 'Làm tại tiệm sáng nay',
      storage: 'ROOM_TEMP',
      storageNote: 'Để nơi thoáng mát, tránh nắng',
      ingredients: 'Bột mì, trứng, sữa, đường',
      originalPrice: 25000,
      price: 15000,
      quantity: 5,
      startOffsetMin: 0,
      durationMin: 60,
      preparedHoursBeforeStart: 8,
      image: 'banh-ngot',
      published: true,
    },
    {
      title: 'Bánh mì thịt cuối ngày',
      description: 'Bánh mì kẹp thịt nguội và rau.',
      category: 'BAKERY',
      origin: 'Làm tại tiệm chiều nay',
      storage: 'ROOM_TEMP',
      storageNote: null,
      ingredients: 'Bánh mì, thịt nguội, pate, rau thơm',
      originalPrice: 20000,
      price: 10000,
      quantity: 6,
      startOffsetMin: 0,
      durationMin: 120,
      preparedHoursBeforeStart: 3,
      image: 'banh-mi',
      published: true,
    },
    {
      title: 'Bánh bông lan (nháp)',
      description: 'Tin nháp chưa đăng.',
      category: 'BAKERY',
      origin: 'Làm tại tiệm',
      storage: 'ROOM_TEMP',
      storageNote: null,
      ingredients: null,
      originalPrice: 30000,
      price: 18000,
      quantity: 4,
      startOffsetMin: 60,
      durationMin: 60,
      preparedHoursBeforeStart: 4,
      image: 'bong-lan',
      published: false,
    },
  ], now);

  listings += await recreateListings(prisma, homeCook.id, homePickup, [
    {
      title: 'Cơm gà xối mỡ',
      description: 'Cơm gà nấu dư bữa trưa, chưa phục vụ khách.',
      category: 'MEAL',
      origin: 'Nấu tại nhà trưa nay',
      storage: 'CHILLED',
      storageNote: 'Ngăn mát 4°C',
      ingredients: 'Cơm, gà, dưa leo',
      originalPrice: 35000,
      price: 18000,
      quantity: 4,
      startOffsetMin: -30,
      durationMin: 90,
      preparedHoursBeforeStart: 4,
      image: 'com-ga',
      published: true,
    },
    {
      title: 'Trà tắc tặng kèm',
      description: 'Trà tắc pha trong ngày, miễn phí.',
      category: 'DRINK',
      origin: 'Pha tại nhà chiều nay',
      storage: 'CHILLED',
      storageNote: null,
      ingredients: 'Trà, tắc, đường',
      originalPrice: null,
      price: 0,
      quantity: 5,
      startOffsetMin: 0,
      durationMin: 60,
      preparedHoursBeforeStart: 2,
      image: 'tra-tac',
      published: true,
    },
  ], now);

  return { accounts: 5, listings };
}

if (require.main === module) {
  const prisma = new PrismaClient();
  seed(prisma)
    .then((result) => console.log(`seeded ${result.accounts} accounts and ${result.listings} listings`))
    .catch((error: unknown) => {
      console.error(error);
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}
