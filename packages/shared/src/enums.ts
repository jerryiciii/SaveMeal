// Enum values mirror docs/API_CONTRACT.md v1.2 §1 and docs/DOMAIN.md §2. Each enum is a readonly
// tuple (usable at runtime, e.g. for validation and GET /config) plus a string-literal union type.

export const USER_ROLES = ['USER', 'ADMIN'] as const;
export type UserRole = (typeof USER_ROLES)[number];

/** Account status as exposed by the API. `DELETED` exists in the database only. */
export const ACCOUNT_STATUSES = ['ACTIVE', 'SUSPENDED'] as const;
export type AccountStatus = (typeof ACCOUNT_STATUSES)[number];

export const OTP_CHANNELS = ['SMS', 'EMAIL'] as const;
export type OtpChannel = (typeof OTP_CHANNELS)[number];

export const SELLER_TYPES = ['INDIVIDUAL', 'SHOP', 'CAFE', 'BAKERY', 'CANTEEN'] as const;
export type SellerType = (typeof SELLER_TYPES)[number];

export const CATEGORIES = ['BAKERY', 'MEAL', 'DRINK', 'PACKAGED', 'OTHER'] as const;
export type Category = (typeof CATEGORIES)[number];

export const STORAGES = ['ROOM_TEMP', 'CHILLED', 'FROZEN'] as const;
export type Storage = (typeof STORAGES)[number];

/** Optional, informational only: never a filter or a publish gate (D§9 D5). */
export const ALLERGENS = [
  'GLUTEN',
  'MILK',
  'EGG',
  'PEANUT',
  'TREE_NUT',
  'SOY',
  'FISH',
  'SHELLFISH',
  'SESAME',
] as const;
export type Allergen = (typeof ALLERGENS)[number];

export const LISTING_STATUSES = ['DRAFT', 'PUBLISHED', 'EXPIRED', 'WITHDRAWN', 'BLOCKED'] as const;
export type ListingStatus = (typeof LISTING_STATUSES)[number];

export const TERMINAL_LISTING_STATUSES = ['EXPIRED', 'WITHDRAWN', 'BLOCKED'] as const satisfies readonly ListingStatus[];

export const RESERVATION_STATUSES = [
  'PENDING_PAYMENT',
  'RESERVED',
  'COMPLETED',
  'CANCELLED',
  'EXPIRED',
] as const;
export type ReservationStatus = (typeof RESERVATION_STATUSES)[number];

export const PAYMENT_PROVIDERS = ['SEPAY', 'MOCK'] as const;
export type PaymentProvider = (typeof PAYMENT_PROVIDERS)[number];

export const PAYMENT_STATUSES = ['UNPAID', 'PAID', 'EXPIRED', 'REFUND_DUE', 'REFUNDED'] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const PAYOUT_STATUSES = ['NONE', 'PENDING_PAYOUT', 'SETTLED'] as const;
export type PayoutStatus = (typeof PAYOUT_STATUSES)[number];

export const CANCEL_REASONS = [
  'BUYER_LATE',
  'BUYER_WRONG_QTY',
  'BUYER_CHANGED_PLAN',
  'BUYER_OTHER',
  'SELLER_WITHDREW',
  'LISTING_BLOCKED',
  'ADMIN',
] as const;
export type CancelReason = (typeof CANCEL_REASONS)[number];

/** The reasons a buyer may pick in RES-4 (V1/39). Also `config.enums.cancelReasons`. */
export const BUYER_CANCEL_REASONS = [
  'BUYER_LATE',
  'BUYER_WRONG_QTY',
  'BUYER_CHANGED_PLAN',
  'BUYER_OTHER',
] as const satisfies readonly CancelReason[];
export type BuyerCancelReason = (typeof BUYER_CANCEL_REASONS)[number];

/** LIST-7 `reason`. */
export const WITHDRAW_REASONS = ['STORAGE_NOT_OK', 'SOLD_ELSEWHERE', 'OTHER'] as const;
export type WithdrawReason = (typeof WITHDRAW_REASONS)[number];

export const REPORT_TYPES = ['WRONG_INFO', 'UNSAFE_FOOD', 'NOT_RECEIVED', 'SELLER_ABSENT', 'OTHER'] as const;
export type ReportType = (typeof REPORT_TYPES)[number];

export const REPORT_STATUSES = ['OPEN', 'IN_REVIEW', 'RESOLVED', 'DISMISSED'] as const;
export type ReportStatus = (typeof REPORT_STATUSES)[number];

export const REPORT_ACTIONS = ['NONE', 'WARNING', 'LISTING_BLOCKED', 'ACCOUNT_SUSPENDED'] as const;
export type ReportAction = (typeof REPORT_ACTIONS)[number];

/** The 6 seller declarations sent with LIST-6 (D§5, V1/26). */
export const DECLARATION_KEYS = [
  'NOT_EXPIRED',
  'STORED_PROPERLY',
  'NOT_SPOILED',
  'NOT_SERVED_LEFTOVERS',
  'INFO_DECLARED',
  'PICKUP_WINDOW_OK',
] as const;
export type DeclarationKey = (typeof DECLARATION_KEYS)[number];

/** The required-info checklist (D§5); `missing[]` lists the keys not yet satisfied. */
export const CHECKLIST_KEYS = [
  'PHOTO',
  'NAME',
  'PRICE',
  'PORTIONS',
  'ORIGIN',
  'PREPARED_AT',
  'STORAGE',
  'PICKUP_WINDOW',
  'PICKUP_LOCATION',
] as const;
export type ChecklistKey = (typeof CHECKLIST_KEYS)[number];

/** IMG-1 `purpose`. */
export const IMAGE_PURPOSES = ['LISTING', 'REPORT', 'AVATAR'] as const;
export type ImagePurpose = (typeof IMAGE_PURPOSES)[number];

/** RES-7 `blockingReason`. */
export const PICKUP_BLOCKING_REASONS = [
  'TOO_EARLY',
  'WINDOW_CLOSED',
  'NOT_ACTIVE',
  'TOKEN_EXPIRED',
  'TOKEN_USED',
  'LISTING_BLOCKED',
] as const;
export type PickupBlockingReason = (typeof PICKUP_BLOCKING_REASONS)[number];

/** LIST-1 query enums. */
export const LISTING_SORTS = ['distance', 'pickupSoon', 'priceAsc', 'newest'] as const;
export type ListingSort = (typeof LISTING_SORTS)[number];

export const LISTING_VIEWS = ['list', 'map'] as const;
export type ListingView = (typeof LISTING_VIEWS)[number];

export const PICKUP_DAYS = ['today', 'tomorrow'] as const;
export type PickupDay = (typeof PICKUP_DAYS)[number];

/** LIST-8 `tab` (`active` = DRAFT and PUBLISHED; `done` = terminal). */
export const LISTING_TABS = ['active', 'done'] as const;
export type ListingTab = (typeof LISTING_TABS)[number];

/** RES-2 `tab` (`upcoming` = PENDING_PAYMENT and RESERVED). */
export const RESERVATION_TABS = ['upcoming', 'history'] as const;
export type ReservationTab = (typeof RESERVATION_TABS)[number];
