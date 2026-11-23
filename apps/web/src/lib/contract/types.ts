/**
 * FE-local mirror of docs/API_CONTRACT.md §1 (v1.0.1).
 * Temporary: replace with imports from `@savemeal/shared` once BE M1 lands.
 * Do not add fields that are not in the contract.
 */

export type Envelope<T> = { data: T };
export type Page = { nextCursor: string | null; limit: number };
export type ListEnvelope<T, M = undefined> = { data: T[]; page: Page } & (M extends undefined ? object : { meta: M });

export type Image = { id: string; url: string; width: number; height: number };

export type StoreVerification = "PENDING" | "VERIFIED" | "REJECTED" | "SUSPENDED";
export type StoreType = "CAFE" | "BAKERY" | "CANTEEN" | "RESTAURANT" | "INDIVIDUAL";

export type Me = {
  id: string;
  displayName: string | null;
  phone: string | null;
  email: string | null;
  avatar: Image | null;
  role: "USER" | "ADMIN";
  status: "ACTIVE" | "SUSPENDED";
  notificationPrefs: { push: boolean; pickupReminders: boolean; chat: boolean; listingUpdates: boolean };
  stores: { id: string; name: string; role: "OWNER" | "STAFF"; verificationStatus: StoreVerification }[];
  stats: { portionsRescued: number; reservationsActive: number; listingsActive: number };
  createdAt: string;
};

export type StoreSummary = {
  id: string;
  name: string;
  type: StoreType;
  area: string;
  lat: number;
  lng: number;
  verified: boolean;
  ratingAvg: number | null;
  ratingCount: number;
};

export type StoreProfile = StoreSummary & {
  description: string | null;
  address: string;
  pickupInstructions: string | null;
  cover: Image | null;
  activeBatchCount: number;
  createdAt: string;
};

export type StoreOwnerView = StoreProfile & {
  verificationStatus: StoreVerification;
  verificationNote: string | null;
  contactPhone: string | null;
  myRole: "OWNER" | "STAFF" | null;
  payoutAccount: { bankBin: string; accountNumberMasked: string; accountName: string } | null;
};

export const CATEGORIES = ["BAKERY", "SAVORY", "DRINK", "PACKAGED", "OTHER"] as const;
export type Category = (typeof CATEGORIES)[number];
export const ALLERGENS = ["GLUTEN", "MILK", "EGG", "PEANUT", "TREE_NUT", "SOY", "FISH", "SHELLFISH", "SESAME"] as const;
export type Allergen = (typeof ALLERGENS)[number];
export type Storage = "ROOM_TEMP" | "CHILLED";
export type BatchStatus = "DRAFT" | "SAFETY_CHECKED" | "PUBLISHED" | "EXPIRED" | "CANCELLED" | "REMOVED_UNSAFE";

export type BatchCard = {
  id: string;
  title: string;
  category: Category;
  image: Image | null;
  originalPrice: number;
  rescuePrice: number;
  isFree: boolean;
  quantityAvailable: number;
  soldOut: boolean;
  pickupStart: string;
  pickupEnd: string;
  allergens: Allergen[];
  distanceMeters: number | null;
  store: StoreSummary;
  isSaved: boolean;
};

export type MapPin = {
  id: string;
  lat: number;
  lng: number;
  title: string;
  rescuePrice: number;
  isFree: boolean;
  quantityAvailable: number;
  category: Category;
};

export type BatchDetail = Omit<BatchCard, "store"> & {
  description: string | null;
  images: Image[];
  ingredients: string | null;
  storage: Storage;
  preparedAt: string;
  bestBefore: string;
  status: BatchStatus;
  isPaused: boolean;
  /** Copy must say "Người bán đã xác nhận checklist", never imply a safety certificate. */
  safetyConfirmedAt: string | null;
  store: StoreProfile;
  myActiveReservationId: string | null;
};

export type SafetyItemKey =
  | "NOT_EXPIRED"
  | "STORED_PROPERLY"
  | "NO_SPOILAGE"
  | "NOT_CUSTOMER_LEFTOVERS"
  | "ALLERGENS_DECLARED"
  | "PICKUP_WINDOW_SAFE";
export type SystemCheckKey =
  | "STORE_VERIFIED"
  | "CATEGORY_ALLOWED"
  | "NOT_EXPIRED_AT_PICKUP"
  | "WINDOW_WITHIN_LIMIT"
  | "ALLERGENS_PRESENT"
  | "EVIDENCE_RECORDED";

export type ReservationStatus = "PENDING_PAYMENT" | "RESERVED" | "PICKED_UP" | "CANCELLED" | "NO_SHOW" | "EXPIRED";
export type CancelReason =
  | "BUYER_LATE"
  | "BUYER_WRONG_QTY"
  | "BUYER_CHANGED_PLAN"
  | "BUYER_OTHER"
  | "SELLER_CANCELLED"
  | "BATCH_REMOVED_UNSAFE"
  | "ADMIN";
export type IncidentType = "WRONG_INFO" | "UNSAFE_FOOD" | "NOT_RECEIVED" | "SELLER_ABSENT" | "OTHER";

export type AppConfig = {
  features: { payments: boolean; googleLogin: boolean };
  enums: {
    categories: Category[];
    allergens: Allergen[];
    storage: Storage[];
    storeTypes: StoreType[];
    incidentTypes: IncidentType[];
    cancelReasons: CancelReason[];
  };
  limits: {
    maxQtyPerReservation: number;
    maxActiveReservations: number;
    radiusKmOptions: number[];
    maxRadiusKm: number;
    depositAmount: number;
    freeCancelBeforeMin: number;
    maxImagesPerBatch: number;
  };
  defaultCenter: { lat: number; lng: number; label: string };
  popularSearches: string[];
  vapidPublicKey: string;
};

/** BATCH-1 query parameters (contract §7). */
export type BatchSearchParams = {
  lat?: number;
  lng?: number;
  radiusKm?: number;
  q?: string;
  category?: Category[];
  priceMax?: number;
  free?: boolean;
  excludeAllergens?: Allergen[];
  pickupDay?: "today" | "tomorrow";
  includeSoldOut?: boolean;
  sort?: "distance" | "pickupSoon" | "priceAsc" | "newest";
  view?: "list" | "map";
  cursor?: string;
  limit?: number;
};
