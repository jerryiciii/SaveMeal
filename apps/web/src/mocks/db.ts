import type {
  Allergen,
  CancelReason,
  Category,
  DeclarationKey,
  ListingStatus,
  PickupLocation,
  ReservationStatus,
  SellerType,
  Storage as StorageMethod,
} from "@/lib/contract/types";
import { saveReports, seedDemoReports } from "./reportsStore";

/**
 * Mock database for the in-browser mock API. In the browser it is persisted to
 * localStorage, so two tabs (buyer + seller) share listings and orders, like the
 * real API would. Each tab keeps its own session (sessionStorage), see mockFetch.
 */

export type DbAccount = {
  id: string;
  phone: string | null;
  email: string | null;
  displayName: string | null;
  role: "USER" | "ADMIN";
  status: "ACTIVE" | "SUSPENDED";
  seller: { name: string | null; type: SellerType | null; verified: boolean; defaultPickup: PickupLocation | null };
  createdAt: string;
};

export type DbImage = { id: string; url: string; width: number; height: number; uploaderId: string | null };

export type DbListing = {
  id: string;
  sellerId: string;
  title: string | null;
  description: string | null;
  category: Category;
  imageIds: string[];
  origin: string | null;
  preparedAt: string | null;
  storage: StorageMethod | null;
  storageNote: string | null;
  ingredients: string | null;
  allergens: Allergen[];
  originalPrice: number | null;
  price: number | null;
  quantityTotal: number | null;
  quantityAvailable: number;
  pickupStart: string | null;
  pickupEnd: string | null;
  pickup: PickupLocation | null;
  declaration: Partial<Record<DeclarationKey, boolean>> | null;
  declaredAt: string | null;
  status: ListingStatus;
  underReview: boolean;
  publishedAt: string | null;
  closedAt: string | null;
  closeReason: string | null;
  createdAt: string;
};

export type DbReservation = {
  id: string;
  listingId: string;
  buyerId: string;
  sellerId: string;
  quantity: number;
  unitPrice: number;
  code: string;
  status: ReservationStatus;
  cancelReason: CancelReason | null;
  createdAt: string;
  completedAt: string | null;
  closedAt: string | null;
};

export type DbPickupToken = {
  token: string;
  reservationId: string;
  expiresAt: string;
  usedAt: string | null;
  revokedAt: string | null;
};

export type DbOtp = { requestId: string; identifier: string; code: string; expiresAt: string; attempts: number };

export type Db = {
  version: number;
  accounts: DbAccount[];
  images: DbImage[];
  listings: DbListing[];
  reservations: DbReservation[];
  tokens: DbPickupToken[];
  otps: DbOtp[];
  idempotency: Record<string, { status: number; body: unknown }>;
};

export const DB_VERSION = 4;
const STORAGE_KEY = "sm-mock-db";
const MINUTE = 60_000;
const HALF_HOUR = 30 * MINUTE;

/** Demo phone numbers aligned with apps/api/prisma/seed.ts. OTP in mock mode is always 123456. */
export const MOCK_OTP = "123456";
export const DEMO_ADMIN_PHONE = "+84900000001";
export const DEMO_SELLER_PHONE = "+84900000002";
export const DEMO_BUYER_PHONE = "+84900000004";

const PHOTO: DbImage = { id: "img-croissant", url: "/mock/croissant.png", width: 200, height: 196, uploaderId: null };

const iso = (ms: number) => new Date(ms).toISOString();

export function seedDb(now: Date = new Date()): Db {
  const t = now.getTime();
  // Demo listing window already open, so the handover can be shown at any time of day.
  const openStart = Math.floor(t / HALF_HOUR) * HALF_HOUR;
  const anchor = Math.ceil(t / HALF_HOUR) * HALF_HOUR;
  const created = iso(t - 3 * 60 * MINUTE);

  const admin: DbAccount = {
    id: "acc-admin", phone: DEMO_ADMIN_PHONE, email: null, displayName: "Quản trị SaveMeal", role: "ADMIN", status: "ACTIVE",
    seller: { name: null, type: null, verified: false, defaultPickup: null }, createdAt: created,
  };
  const may: DbAccount = {
    id: "acc-may", phone: DEMO_SELLER_PHONE, email: null, displayName: "Chị Mây", role: "USER", status: "ACTIVE",
    seller: { name: "Tiệm bánh Mây", type: "BAKERY", verified: true,
      defaultPickup: { address: "12 Ngô Thì Sĩ, Mỹ An, Đà Nẵng", lat: 16.0478, lng: 108.2431 } },
    createdAt: created,
  };
  const buyer: DbAccount = {
    id: "acc-minh", phone: DEMO_BUYER_PHONE, email: null, displayName: "Minh", role: "USER", status: "ACTIVE",
    seller: { name: null, type: null, verified: false, defaultPickup: null }, createdAt: created,
  };
  const others: DbAccount[] = [
    { id: "acc-bep-may", name: "Bếp Nhà Của Mây", type: "INDIVIDUAL" as const, verified: false, address: "45 Lê Quang Đạo, Mỹ An", lat: 16.0532, lng: 108.2418 },
    { id: "acc-an-thuong", name: "Bếp An Thượng", type: "SHOP" as const, verified: true, address: "8 An Thượng 4", lat: 16.0512, lng: 108.2462 },
    { id: "acc-can-tin", name: "Căn tin nhỏ", type: "CANTEEN" as const, verified: false, address: "Khu A, Ngũ Hành Sơn", lat: 16.0402, lng: 108.2398 },
  ].map((s) => ({
    id: s.id, phone: null, email: null, displayName: s.name, role: "USER" as const, status: "ACTIVE" as const,
    seller: { name: s.name, type: s.type, verified: s.verified, defaultPickup: { address: s.address, lat: s.lat, lng: s.lng } },
    createdAt: created,
  }));
  const accounts = [admin, may, buyer, ...others];

  type Seed = Pick<DbListing, "id" | "sellerId" | "title" | "category" | "price" | "originalPrice" | "origin" | "storage" | "ingredients" | "allergens"> & {
    qty: number;
    start: number;
    durationMin: number;
  };
  const seeds: Seed[] = [
    // Spec §7.3 demo listing: 5 pastries, 25.000đ → 15.000đ.
    { id: "l-banh-ngot", sellerId: "acc-may", title: "5 phần bánh còn nguyên", category: "BAKERY", price: 15000, originalPrice: 25000,
      origin: "Làm tại tiệm sáng nay", storage: "ROOM_TEMP", ingredients: "Bột mì, trứng, sữa, đường.", allergens: ["GLUTEN", "EGG", "MILK"],
      qty: 5, start: openStart, durationMin: 120 },
    { id: "l-croissant", sellerId: "acc-may", title: "Bánh croissant bơ", category: "BAKERY", price: 0, originalPrice: 35000,
      origin: "Làm tại tiệm sáng nay", storage: "ROOM_TEMP", ingredients: "Bột mì, sữa, bơ.", allergens: ["GLUTEN", "MILK"],
      qty: 2, start: anchor + 60 * MINUTE, durationMin: 60 },
    { id: "l-banhmi-bo-toi", sellerId: "acc-bep-may", title: "Bánh mì bơ tỏi", category: "BAKERY", price: 0, originalPrice: null,
      origin: "Nhà làm, nướng chiều nay", storage: "ROOM_TEMP", ingredients: "Bánh mì, bơ, tỏi.", allergens: [],
      qty: 2, start: anchor + 90 * MINUTE, durationMin: 60 },
    { id: "l-com-ga", sellerId: "acc-an-thuong", title: "Combo cơm gà nướng", category: "MEAL", price: 18000, originalPrice: 35000,
      origin: "Bếp quán nấu trưa nay", storage: "CHILLED", ingredients: "Cơm, gà nướng, rau.", allergens: [],
      qty: 3, start: anchor + 90 * MINUTE, durationMin: 60 },
    { id: "l-com-chay", sellerId: "acc-can-tin", title: "Cơm chay trưa", category: "MEAL", price: 0, originalPrice: 25000,
      origin: "Căn tin nấu trong ngày", storage: "CHILLED", ingredients: "Cơm, đậu hũ, rau củ.", allergens: ["SOY"],
      qty: 1, start: anchor + 12 * 60 * MINUTE, durationMin: 90 },
    { id: "l-sua-chua", sellerId: "acc-can-tin", title: "Sữa chua đóng hộp", category: "PACKAGED", price: 12000, originalPrice: 20000,
      origin: "Hàng đóng gói, còn hạn", storage: "CHILLED", ingredients: "Sữa, men sữa chua.", allergens: ["MILK"],
      qty: 0, start: openStart, durationMin: 120 },
  ];
  const listings: DbListing[] = seeds.map((s) => {
    const seller = accounts.find((a) => a.id === s.sellerId)!;
    return {
      id: s.id, sellerId: s.sellerId, title: s.title, description: null, category: s.category, imageIds: [PHOTO.id],
      origin: s.origin, preparedAt: iso(t - 4 * 60 * MINUTE), storage: s.storage, storageNote: null,
      ingredients: s.ingredients, allergens: s.allergens, originalPrice: s.originalPrice, price: s.price,
      quantityTotal: Math.max(s.qty, 1), quantityAvailable: s.qty,
      pickupStart: iso(s.start), pickupEnd: iso(s.start + s.durationMin * MINUTE), pickup: seller.seller.defaultPickup,
      declaration: { NOT_EXPIRED: true, STORED_PROPERLY: true, NOT_SPOILED: true, NOT_SERVED_LEFTOVERS: true, INFO_DECLARED: true, PICKUP_WINDOW_OK: true },
      declaredAt: created, status: "PUBLISHED", underReview: false, publishedAt: created, closedAt: null, closeReason: null,
      createdAt: created,
    };
  });

  return { version: DB_VERSION, accounts, images: [PHOTO], listings, reservations: [], tokens: [], otps: [], idempotency: {} };
}

function storage(): globalThis.Storage | null {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null;
  }
}

let memoryDb: Db | null = null;

export function loadDb(now: Date = new Date()): Db {
  const ls = storage();
  if (ls) {
    try {
      const raw = ls.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Db;
        if (parsed.version === DB_VERSION) return parsed;
      }
    } catch {
      // fall through to a fresh seed
    }
    const fresh = seedDb(now);
    saveDb(fresh);
    saveReports(seedDemoReports(now));
    return fresh;
  }
  if (!memoryDb) {
    memoryDb = seedDb(now);
    saveReports(seedDemoReports(now));
  }
  return memoryDb;
}

export function saveDb(db: Db): void {
  const ls = storage();
  if (ls) {
    try {
      ls.setItem(STORAGE_KEY, JSON.stringify(db));
    } catch {
      // quota exceeded: keep working in memory for this request
    }
  } else {
    memoryDb = db;
  }
}

/** Reset to the seed (used by the dev "reset demo" button and by tests). */
export function resetDb(now: Date = new Date()): Db {
  const fresh = seedDb(now);
  memoryDb = null;
  saveDb(fresh);
  if (!storage()) memoryDb = fresh;
  saveReports(seedDemoReports(now));
  return fresh;
}
