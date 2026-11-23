import type { AppConfig, BatchDetail, StoreProfile } from "@/lib/contract/types";

/**
 * Mock data for the in-browser mock API. Names and places follow Figma V1
 * sample content. Times are generated relative to "today" in Đà Nẵng.
 */

export const mockConfig: AppConfig = {
  features: { payments: false, googleLogin: false },
  enums: {
    categories: ["BAKERY", "SAVORY", "DRINK", "PACKAGED", "OTHER"],
    allergens: ["GLUTEN", "MILK", "EGG", "PEANUT", "TREE_NUT", "SOY", "FISH", "SHELLFISH", "SESAME"],
    storage: ["ROOM_TEMP", "CHILLED"],
    storeTypes: ["CAFE", "BAKERY", "CANTEEN", "RESTAURANT", "INDIVIDUAL"],
    incidentTypes: ["WRONG_INFO", "UNSAFE_FOOD", "NOT_RECEIVED", "SELLER_ABSENT", "OTHER"],
    cancelReasons: ["BUYER_LATE", "BUYER_WRONG_QTY", "BUYER_CHANGED_PLAN", "BUYER_OTHER"],
  },
  limits: {
    maxQtyPerReservation: 2,
    maxActiveReservations: 3,
    radiusKmOptions: [1, 3, 5],
    maxRadiusKm: 10,
    depositAmount: 5000,
    freeCancelBeforeMin: 30,
    maxImagesPerBatch: 4,
  },
  defaultCenter: { lat: 16.0544, lng: 108.2022, label: "Đà Nẵng" },
  popularSearches: ["Bánh mì", "Bánh ngọt", "Cơm trưa", "Món miễn phí"],
  vapidPublicKey: "mock-vapid-public-key",
};

/** Mock "me" location near Mỹ An, used when the buyer has not chosen one. */
export const mockOrigin = { lat: 16.0495, lng: 108.2405 };

const PHOTO = { id: "img-croissant", url: "/mock/croissant.png", width: 200, height: 196 };

function store(
  id: string,
  name: string,
  type: StoreProfile["type"],
  area: string,
  address: string,
  lat: number,
  lng: number,
  description: string | null,
): StoreProfile {
  return {
    id,
    name,
    type,
    area,
    lat,
    lng,
    verified: true,
    ratingAvg: null,
    ratingCount: 0,
    description,
    address,
    pickupInstructions: "Nhận trực tiếp tại quầy theo giờ ghi trên từng món.",
    cover: null,
    activeBatchCount: 0,
    createdAt: "2026-11-01T08:00:00+07:00",
  };
}

export const mockStores: StoreProfile[] = [
  store("st-may", "Tiệm bánh Mây", "BAKERY", "Mỹ An, Đà Nẵng", "12 Ngô Thì Sĩ, Mỹ An", 16.0478, 108.2431,
    "Bánh được chuẩn bị trong ngày. Nhận trực tiếp tại quầy theo giờ ghi trên từng món."),
  store("st-bep-may", "Bếp Nhà Của Mây", "INDIVIDUAL", "Mỹ An, Đà Nẵng", "45 Lê Quang Đạo, Mỹ An", 16.0532, 108.2418, null),
  store("st-an-thuong", "Bếp An Thượng", "RESTAURANT", "An Thượng, Đà Nẵng", "8 An Thượng 4", 16.0512, 108.2462, null),
  store("st-can-tin", "Căn tin nhỏ", "CANTEEN", "Ngũ Hành Sơn, Đà Nẵng", "Khu A, Ngũ Hành Sơn", 16.0402, 108.2398, null),
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
  storeId: string;
  title: string;
  category: BatchDetail["category"];
  rescuePrice: number;
  originalPrice: number;
  quantity: number;
  /** Minutes after "now" rounded up to the next half hour, so mock data is always live. */
  startIn: number;
  durationMin: number;
  allergens: BatchDetail["allergens"];
  ingredients: string | null;
  storage: BatchDetail["storage"];
};

const seeds: Seed[] = [
  { id: "b-croissant", storeId: "st-may", title: "Bánh croissant bơ", category: "BAKERY", rescuePrice: 0, originalPrice: 35000,
    quantity: 2, startIn: 60, durationMin: 60, allergens: ["GLUTEN", "MILK"], ingredients: "Bột mì, sữa, bơ. Có gluten.", storage: "ROOM_TEMP" },
  { id: "b-banhmi-bo-toi", storeId: "st-bep-may", title: "Bánh mì bơ tỏi", category: "BAKERY", rescuePrice: 0, originalPrice: 20000,
    quantity: 2, startIn: 90, durationMin: 60, allergens: ["GLUTEN", "MILK"], ingredients: "Bánh mì, bơ, tỏi.", storage: "ROOM_TEMP" },
  { id: "b-com-ga", storeId: "st-an-thuong", title: "Combo cơm gà nướng", category: "SAVORY", rescuePrice: 18000, originalPrice: 35000,
    quantity: 3, startIn: 90, durationMin: 60, allergens: ["SOY"], ingredients: "Cơm, gà nướng, rau.", storage: "CHILLED" },
  { id: "b-banh-ngot", storeId: "st-may", title: "Hộp bánh ngọt cuối ngày", category: "BAKERY", rescuePrice: 15000, originalPrice: 40000,
    quantity: 4, startIn: 150, durationMin: 60, allergens: ["GLUTEN", "EGG", "MILK"], ingredients: "Bột mì, trứng, sữa, đường.", storage: "ROOM_TEMP" },
  { id: "b-com-chay", storeId: "st-can-tin", title: "Cơm chay trưa", category: "SAVORY", rescuePrice: 0, originalPrice: 25000,
    quantity: 1, startIn: 720, durationMin: 90, allergens: ["SOY"], ingredients: "Cơm, đậu hũ, rau củ.", storage: "CHILLED" },
  { id: "b-sua-chua", storeId: "st-can-tin", title: "Sữa chua đóng hộp", category: "PACKAGED", rescuePrice: 12000, originalPrice: 20000,
    quantity: 0, startIn: 0, durationMin: 120, allergens: ["MILK"], ingredients: "Sữa, men sữa chua.", storage: "CHILLED" },
];

export function buildMockBatches(now: Date = new Date()): BatchDetail[] {
  const anchor = mockAnchor(now);
  return seeds.map((s) => {
    const st = mockStores.find((x) => x.id === s.storeId)!;
    const start = anchor + s.startIn * MINUTE;
    const end = start + s.durationMin * MINUTE;
    return {
      id: s.id,
      title: s.title,
      category: s.category,
      image: PHOTO,
      images: [PHOTO],
      originalPrice: s.originalPrice,
      rescuePrice: s.rescuePrice,
      isFree: s.rescuePrice === 0,
      quantityAvailable: s.quantity,
      soldOut: s.quantity === 0,
      pickupStart: iso(start),
      pickupEnd: iso(end),
      allergens: s.allergens,
      distanceMeters: null,
      isSaved: false,
      description: null,
      ingredients: s.ingredients,
      storage: s.storage,
      preparedAt: iso(anchor - 6 * 60 * MINUTE),
      bestBefore: iso(end + 6 * 60 * MINUTE),
      status: "PUBLISHED",
      isPaused: false,
      safetyConfirmedAt: iso(anchor - 60 * MINUTE),
      store: st,
      myActiveReservationId: null,
    };
  });
}
