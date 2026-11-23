/**
 * FE-local mirror of docs/API_CONTRACT.md §1 (v1.1, MVP).
 * Temporary: replace with imports from `@savemeal/shared` once BE M1 lands.
 * Do not add fields that are not in the contract.
 */

export type Envelope<T> = { data: T };
export type Page = { nextCursor: string | null; limit: number };
export type ListEnvelope<T> = { data: T[]; page: Page };

export type Image = { id: string; url: string; width: number; height: number };

export type AccountStatus = "ACTIVE" | "SUSPENDED";
export const SELLER_TYPES = ["INDIVIDUAL", "SHOP", "CAFE", "BAKERY", "CANTEEN"] as const;
export type SellerType = (typeof SELLER_TYPES)[number];
export const CATEGORIES = ["BAKERY", "MEAL", "DRINK", "PACKAGED", "OTHER"] as const;
export type Category = (typeof CATEGORIES)[number];
export type Storage = "ROOM_TEMP" | "CHILLED" | "FROZEN";
export const ALLERGENS = ["GLUTEN", "MILK", "EGG", "PEANUT", "TREE_NUT", "SOY", "FISH", "SHELLFISH", "SESAME"] as const;
export type Allergen = (typeof ALLERGENS)[number];
export type ListingStatus = "DRAFT" | "PUBLISHED" | "EXPIRED" | "WITHDRAWN" | "BLOCKED";
export type ReservationStatus = "RESERVED" | "COMPLETED" | "CANCELLED" | "EXPIRED";
export type CancelReason =
  | "BUYER_LATE"
  | "BUYER_WRONG_QTY"
  | "BUYER_CHANGED_PLAN"
  | "BUYER_OTHER"
  | "SELLER_WITHDREW"
  | "LISTING_BLOCKED"
  | "ADMIN";
export type ReportType = "WRONG_INFO" | "UNSAFE_FOOD" | "NOT_RECEIVED" | "SELLER_ABSENT" | "OTHER";
export const DECLARATION_KEYS = [
  "NOT_EXPIRED",
  "STORED_PROPERLY",
  "NOT_SPOILED",
  "NOT_SERVED_LEFTOVERS",
  "INFO_DECLARED",
  "PICKUP_WINDOW_OK",
] as const;
export type DeclarationKey = (typeof DECLARATION_KEYS)[number];
export type ChecklistKey =
  | "PHOTO"
  | "NAME"
  | "PRICE"
  | "PORTIONS"
  | "ORIGIN"
  | "PREPARED_AT"
  | "STORAGE"
  | "PICKUP_WINDOW"
  | "PICKUP_LOCATION";

export type PickupLocation = { address: string; lat: number; lng: number };

export type SellerSummary = { id: string; name: string; type: SellerType | null; verified: boolean };

export type Me = {
  id: string;
  displayName: string | null;
  phone: string | null;
  email: string | null;
  avatar: Image | null;
  role: "USER" | "ADMIN";
  status: AccountStatus;
  seller: { name: string | null; type: SellerType | null; verified: boolean; defaultPickup: PickupLocation | null };
  stats: { portionsHandedOver: number; reservationsActive: number; listingsActive: number };
  createdAt: string;
};

export type SellerProfile = SellerSummary & { activeListingCount: number; completedHandovers: number; memberSince: string };

export type ListingCard = {
  id: string;
  title: string;
  category: Category;
  image: Image | null;
  originalPrice: number | null;
  price: number;
  isFree: boolean;
  quantityAvailable: number;
  soldOut: boolean;
  pickupStart: string;
  pickupEnd: string;
  pickup: PickupLocation;
  distanceMeters: number | null;
  seller: SellerSummary;
};

export type MapPin = {
  id: string;
  lat: number;
  lng: number;
  title: string;
  price: number;
  isFree: boolean;
  quantityAvailable: number;
  category: Category;
};

export type ListingDetail = ListingCard & {
  description: string | null;
  images: Image[];
  origin: string;
  preparedAt: string;
  storage: Storage;
  storageNote: string | null;
  ingredients: string | null;
  allergens: Allergen[];
  status: ListingStatus;
  underReview: boolean;
  /** Copy: "Người bán đã xác nhận thông tin". Never imply a safety certificate. */
  declaredAt: string | null;
  myActiveReservationId: string | null;
};

export type ListingOwnerView = ListingDetail & {
  quantityTotal: number;
  reservedCount: number;
  completedCount: number;
  missing: ChecklistKey[];
  editableFields: string[];
  closeReason: string | null;
  blockedReason: string | null;
  createdAt: string;
  publishedAt: string | null;
};

export type PickupToken = { qrPayload: string; expiresAt: string };

export type Reservation = {
  id: string;
  code: string;
  status: ReservationStatus;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  listing: {
    id: string;
    title: string;
    image: Image | null;
    pickupStart: string;
    pickupEnd: string;
    pickup: PickupLocation;
    status: ListingStatus;
  };
  seller: SellerSummary;
  buyer: { displayName: string } | null;
  pickupToken: PickupToken | null;
  cancelReason: CancelReason | null;
  createdAt: string;
  completedAt: string | null;
  closedAt: string | null;
  canCancel: boolean;
  canReport: boolean;
};

export type AppConfig = {
  features: { payments: boolean; googleLogin: boolean };
  enums: {
    categories: Category[];
    storage: Storage[];
    allergens: Allergen[];
    sellerTypes: SellerType[];
    reportTypes: ReportType[];
    cancelReasons: CancelReason[];
  };
  limits: {
    maxQtyPerReservation: number;
    maxActiveReservations: number;
    radiusKmOptions: number[];
    maxRadiusKm: number;
    maxImagesPerListing: number;
    maxWindowHours: number;
    pickupTokenTtlMin: number;
    earlyPickupMin: number;
  };
  defaultCenter: { lat: number; lng: number; label: string };
  popularSearches: string[];
  map: { styleUrl: string; attribution: string };
};

/** LIST-1 query parameters (contract §6). */
export type ListingSearchParams = {
  lat?: number;
  lng?: number;
  radiusKm?: number;
  q?: string;
  category?: Category[];
  priceMax?: number;
  free?: boolean;
  pickupDay?: "today" | "tomorrow";
  pickupFrom?: string;
  pickupTo?: string;
  sellerId?: string;
  includeSoldOut?: boolean;
  sort?: "distance" | "pickupSoon" | "priceAsc" | "newest";
  view?: "list" | "map";
  cursor?: string;
  limit?: number;
};
