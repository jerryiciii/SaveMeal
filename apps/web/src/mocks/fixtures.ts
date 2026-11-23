import type { AppConfig } from "@/lib/contract/types";

/** SYS-2 response for the mock API (contract v1.1). Listings and accounts are in ./db.ts. */
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
  defaultCenter: { lat: 16.0495, lng: 108.2405, label: "Mỹ An, Đà Nẵng" },
  popularSearches: ["Bánh mì", "Bánh ngọt", "Cơm trưa", "Món miễn phí"],
  map: { styleUrl: "https://tiles.openfreemap.org/styles/dark", attribution: "© OpenStreetMap contributors" },
};

/** Mock "me" location near Mỹ An, used when the buyer has not chosen one. */
export const mockOrigin = { lat: 16.0495, lng: 108.2405 };
