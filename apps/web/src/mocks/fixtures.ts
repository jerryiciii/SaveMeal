import type { AppConfig, ListingDetail, SellerSummary } from "@/lib/contract/types";

/**
 * Mock data for the in-browser mock API (contract v1.1). Names and places follow
 * Figma V1 sample content. Pickup windows are relative to "now", so the demo
 * always has live listings.
 */

export const mockConfig: AppConfig = {
  features: { payments: false, googleLogin: false },
  enums: {
    categories: ["BAKERY", "MEAL", "DRINK", "PACKAGED", "OTHER"],
    storage: ["ROOM_TEMP", "CHILLED", "FROZEN"],
    allergens: ["GLUTEN", "MILK", "EGG", "PEANUT", "TREE_NUT", "SOY", "FISH", "SHELLFISH", "SESAME"],
    sellerTypes: ["INDIVIDUAL", "SHOP", "CAFE", "BAKERY", "CANTEEN"],
    reportTypes: ["WRONG_INFO", "UNSAFE_FOOD", "NOT_RECEIVED", "SELLER_ABSENT", "OTHER"],
    cancelReasons: ["BUYER_LATE", "BUYER_WRONG_QTY", "BUYER_CHANGED_PLAN", "BUYER_OTHER"],
  },
  limits: {
    maxQtyPerReservation: 2,
    maxActiveReservations: 3,
    radiusKmOptions: [1, 3, 5],
    maxRadiusKm: 10,
    maxImagesPerListing: 4,
    maxWindowHours: 4,
    pickupTokenTtlMin: 10,
    earlyPickupMin: 30,
  },
  defaultCenter: { lat: 16.0544, lng: 108.2022, label: "Đà Nẵng" },
  popularSearches: ["Bánh mì", "Bánh ngọt", "Cơm trưa", "Món miễn phí"],
  map: { styleUrl: "https://tiles.openfreemap.org/styles/dark", attribution: "© OpenStreetMap contributors" },
};

/** Mock "me" location near Mỹ An, used when the buyer has not chosen one. */
export const mockOrigin = { lat: 16.0495, lng: 108.2405 };

const PHOTO = { id: "img-croissant", url: "/mock/croissant.png", width: 200, height: 196 };

type MockSeller = SellerSummary & { address: string; lat: number; lng: number };

export const mockSellers: MockSeller[] = [
  { id: "acc-may", name: "Tiệm bánh Mây", type: "BAKERY", verified: true, address: "12 Ngô Thì Sĩ, Mỹ An", lat: 16.0478, lng: 108.2431 },
  { id: "acc-bep-may", name: "Bếp Nhà Của Mây", type: "INDIVIDUAL", verified: false, address: "45 Lê Quang Đạo, Mỹ An", lat: 16.0532, lng: 108.2418 },
  { id: "acc-an-thuong", name: "Bếp An Thượng", type: "SHOP", verified: true, address: "8 An Thượng 4", lat: 16.0512, lng: 108.2462 },
  { id: "acc-can-tin", name: "Căn tin nhỏ", type: "CANTEEN", verified: false, address: "Khu A, Ngũ Hành Sơn", lat: 16.0402, lng: 108.2398 },
];

const HALF_HOUR = 30 * 60 * 1000;
const MINUTE = 60 * 1000;

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

/** `now` rounded up to the next half hour (all mock windows hang off this anchor). */
export function mockAnchor(now: Date): number {
  return Math.ceil(now.getTime() / HALF_HOUR) * HALF_HOUR;
}

type Seed = {
  id: string;
  sellerId: string;
  title: string;
  category: ListingDetail["category"];
  price: number;
  originalPrice: number | null;
  quantity: number;
  /** Minutes after the anchor (now rounded up to the next half hour). */
  startIn: number;
  durationMin: number;
  origin: string;
  storage: ListingDetail["storage"];
  ingredients: string | null;
  allergens: ListingDetail["allergens"];
};

const seeds: Seed[] = [
  // Spec §7.3 demo listing: 5 pastries, 25.000đ → 15.000đ.
  { id: "l-banh-ngot", sellerId: "acc-may", title: "5 phần bánh còn nguyên", category: "BAKERY", price: 15000, originalPrice: 25000,
    quantity: 5, startIn: 30, durationMin: 60, origin: "Làm tại tiệm sáng nay", storage: "ROOM_TEMP",
    ingredients: "Bột mì, trứng, sữa, đường.", allergens: ["GLUTEN", "EGG", "MILK"] },
  { id: "l-croissant", sellerId: "acc-may", title: "Bánh croissant bơ", category: "BAKERY", price: 0, originalPrice: 35000,
    quantity: 2, startIn: 60, durationMin: 60, origin: "Làm tại tiệm sáng nay", storage: "ROOM_TEMP",
    ingredients: "Bột mì, sữa, bơ. Có gluten.", allergens: ["GLUTEN", "MILK"] },
  { id: "l-banhmi-bo-toi", sellerId: "acc-bep-may", title: "Bánh mì bơ tỏi", category: "BAKERY", price: 0, originalPrice: null,
    quantity: 2, startIn: 90, durationMin: 60, origin: "Nhà làm, nướng chiều nay", storage: "ROOM_TEMP",
    ingredients: "Bánh mì, bơ, tỏi.", allergens: [] },
  { id: "l-com-ga", sellerId: "acc-an-thuong", title: "Combo cơm gà nướng", category: "MEAL", price: 18000, originalPrice: 35000,
    quantity: 3, startIn: 90, durationMin: 60, origin: "Bếp quán nấu trưa nay", storage: "CHILLED",
    ingredients: "Cơm, gà nướng, rau.", allergens: [] },
  { id: "l-com-chay", sellerId: "acc-can-tin", title: "Cơm chay trưa", category: "MEAL", price: 0, originalPrice: 25000,
    quantity: 1, startIn: 720, durationMin: 90, origin: "Căn tin nấu trong ngày", storage: "CHILLED",
    ingredients: "Cơm, đậu hũ, rau củ.", allergens: ["SOY"] },
  { id: "l-sua-chua", sellerId: "acc-can-tin", title: "Sữa chua đóng hộp", category: "PACKAGED", price: 12000, originalPrice: 20000,
    quantity: 0, startIn: 0, durationMin: 120, origin: "Hàng đóng gói, còn hạn", storage: "CHILLED",
    ingredients: "Sữa, men sữa chua.", allergens: ["MILK"] },
];

export function buildMockListings(now: Date = new Date()): ListingDetail[] {
  const anchor = mockAnchor(now);
  return seeds.map((s) => {
    const seller = mockSellers.find((x) => x.id === s.sellerId)!;
    const start = anchor + s.startIn * MINUTE;
    const end = start + s.durationMin * MINUTE;
    return {
      id: s.id,
      title: s.title,
      category: s.category,
      image: PHOTO,
      images: [PHOTO],
      originalPrice: s.originalPrice,
      price: s.price,
      isFree: s.price === 0,
      quantityAvailable: s.quantity,
      soldOut: s.quantity === 0,
      pickupStart: iso(start),
      pickupEnd: iso(end),
      pickup: { address: seller.address, lat: seller.lat, lng: seller.lng },
      distanceMeters: null,
      seller: { id: seller.id, name: seller.name, type: seller.type, verified: seller.verified },
      description: null,
      origin: s.origin,
      preparedAt: iso(anchor - 6 * 60 * MINUTE),
      storage: s.storage,
      storageNote: null,
      ingredients: s.ingredients,
      allergens: s.allergens,
      status: "PUBLISHED",
      underReview: false,
      declaredAt: iso(anchor - 60 * MINUTE),
      myActiveReservationId: null,
    };
  });
}
