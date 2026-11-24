// Request and response shapes from docs/API_CONTRACT.md v1.1 (MVP endpoints only). Times are
// ISO 8601 strings with +07:00, money is integer VND, IDs are UUID strings, absent optionals are
// `null`.
import type {
  AccountStatus,
  Allergen,
  BuyerCancelReason,
  CancelReason,
  Category,
  ChecklistKey,
  DeclarationKey,
  ImagePurpose,
  ListingSort,
  ListingStatus,
  ListingTab,
  ListingView,
  OtpChannel,
  PickupBlockingReason,
  PickupDay,
  ReportAction,
  ReportStatus,
  ReportType,
  ReservationStatus,
  ReservationTab,
  SellerType,
  Storage,
  UserRole,
  WithdrawReason,
} from './enums';

// ---------------------------------------------------------------------------------------------
// Envelopes (§0)
// ---------------------------------------------------------------------------------------------

export type DataEnvelope<T> = { data: T };
export type PageInfo = { nextCursor: string | null; limit: number };
export type ListEnvelope<T> = { data: T[]; page: PageInfo };
export type PageQuery = { cursor?: string; limit?: number };

// ---------------------------------------------------------------------------------------------
// Shared objects (§1)
// ---------------------------------------------------------------------------------------------

export type Image = { id: string; url: string; width: number; height: number };

export type PickupLocation = { address: string; lat: number; lng: number };

export type SellerSummary = {
  id: string;
  /** sellerName ?? displayName */
  name: string;
  type: SellerType | null;
  verified: boolean;
};

export type MeSeller = {
  name: string | null;
  type: SellerType | null;
  verified: boolean;
  defaultPickup: PickupLocation | null;
};

export type Me = {
  id: string;
  displayName: string | null;
  phone: string | null;
  email: string | null;
  avatar: Image | null;
  role: UserRole;
  status: AccountStatus;
  seller: MeSeller;
  stats: { portionsHandedOver: number; reservationsActive: number; listingsActive: number };
  createdAt: string;
};

export type SellerProfile = SellerSummary & {
  activeListingCount: number;
  completedHandovers: number;
  memberSince: string;
};

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
  /** UI copy: "Người bán đã xác nhận thông tin". Never "an toàn". */
  declaredAt: string | null;
  myActiveReservationId: string | null;
};

export type ListingOwnerView = ListingDetail & {
  quantityTotal: number;
  reservedCount: number;
  completedCount: number;
  /** Empty = ready to publish. */
  missing: ChecklistKey[];
  editableFields: string[];
  closeReason: string | null;
  blockedReason: string | null;
  createdAt: string;
  publishedAt: string | null;
};

export type PickupToken = {
  /** "SM1.<token>" */
  qrPayload: string;
  expiresAt: string;
};

export type Reservation = {
  id: string;
  /** Display order code, e.g. "SM–4281". */
  code: string;
  status: ReservationStatus;
  quantity: number;
  /** Paid offline at pickup. */
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
  /** SELLER / ADMIN only; never phone or email. */
  buyer: { displayName: string } | null;
  /** BUYER only, while RESERVED (current token, if unexpired). */
  pickupToken: PickupToken | null;
  cancelReason: CancelReason | null;
  createdAt: string;
  completedAt: string | null;
  closedAt: string | null;
  canCancel: boolean;
  canReport: boolean;
};

export type Report = {
  id: string;
  type: ReportType;
  description: string;
  images: Image[];
  listingId: string | null;
  reservationId: string | null;
  reportedAccountId: string;
  status: ReportStatus;
  action: ReportAction | null;
  resolution: string | null;
  createdAt: string;
  handledAt: string | null;
  /** ADMIN only. */
  reporter: { id: string; displayName: string } | null;
};

/** LIST-3 (partial allowed for a draft) / LIST-4. */
export type ListingInput = {
  /** 3–80 chars. */
  title: string;
  /** ≤ 500 chars. */
  description?: string | null;
  category: Category;
  /** 1–4 to publish (PHOTO). */
  imageIds?: string[];
  /** ≤ 200 chars. */
  origin: string;
  preparedAt: string;
  storage: Storage;
  storageNote?: string | null;
  ingredients?: string | null;
  allergens?: Allergen[];
  /** Reference price; price ≤ originalPrice when set. */
  originalPrice?: number | null;
  /** ≥ 0 */
  price: number;
  /** 1–50 */
  quantityTotal: number;
  pickupStart: string;
  pickupEnd: string;
  /** Defaults to me.seller.defaultPickup. */
  pickup?: PickupLocation;
};

// ---------------------------------------------------------------------------------------------
// System (§2)
// ---------------------------------------------------------------------------------------------

/** SYS-1 */
export type HealthResponse = { status: 'ok'; db: 'ok'; version: string };

/** SYS-2 */
export type AppConfigResponse = {
  features: { payments: boolean; googleLogin: boolean };
  enums: {
    categories: Category[];
    storage: Storage[];
    allergens: Allergen[];
    sellerTypes: SellerType[];
    reportTypes: ReportType[];
    cancelReasons: BuyerCancelReason[];
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

// ---------------------------------------------------------------------------------------------
// Auth (§3)
// ---------------------------------------------------------------------------------------------

/** AUTH-1 */
export type OtpRequestBody = { channel: OtpChannel; identifier: string };
export type OtpRequestResponse = {
  requestId: string;
  expiresAt: string;
  resendAfterSec: number;
  codeLength: number;
};

/** AUTH-2 */
export type OtpVerifyBody = { requestId: string; code: string };
export type AuthSessionResponse = {
  accessToken: string;
  accessTokenExpiresAt: string;
  isNewUser: boolean;
  user: Me;
};

/** AUTH-3 */
export type RefreshResponse = { accessToken: string; accessTokenExpiresAt: string };

/** AUTH-4 */
export type LogoutBody = { allDevices?: boolean };

// ---------------------------------------------------------------------------------------------
// Me and sellers (§4)
// ---------------------------------------------------------------------------------------------

/** ME-2 */
export type UpdateMeBody = {
  displayName?: string;
  avatarImageId?: string | null;
  seller?: { name?: string | null; type?: SellerType | null; defaultPickup?: PickupLocation | null };
};

/** ME-3 */
export type DeleteMeBody = { confirm: 'XOA TAI KHOAN' };
export type AccountHasActiveItemsDetails = { activeReservations: number; activeListings: number };

// ---------------------------------------------------------------------------------------------
// Images (§5)
// ---------------------------------------------------------------------------------------------

/** IMG-1 multipart fields (besides `file`). */
export type UploadImageFields = { purpose: ImagePurpose };

// ---------------------------------------------------------------------------------------------
// Listings (§6)
// ---------------------------------------------------------------------------------------------

/** LIST-1 */
export type ListingSearchQuery = PageQuery & {
  lat?: number;
  lng?: number;
  radiusKm?: number;
  q?: string;
  /** csv of Category */
  category?: string;
  priceMax?: number;
  free?: boolean;
  pickupDay?: PickupDay;
  /** HH:mm */
  pickupFrom?: string;
  /** HH:mm */
  pickupTo?: string;
  sellerId?: string;
  includeSoldOut?: boolean;
  sort?: ListingSort;
  view?: ListingView;
};

/** LIST-3 */
export type CreateListingBody = Partial<ListingInput> & Pick<ListingInput, 'title' | 'category'>;

/** LIST-4 */
export type UpdateListingBody = Partial<ListingInput>;

/** LIST-6 */
export type PublishListingBody = { declaration: Record<DeclarationKey, boolean> };
export type ListingIncompleteDetails = { missing: ChecklistKey[] };
export type DeclarationIncompleteDetails = { missing: DeclarationKey[] };

/** LIST-7 */
export type WithdrawListingBody = { reason: WithdrawReason; note?: string | null };

/** LIST-8 */
export type MyListingsQuery = PageQuery & { tab?: ListingTab };

// ---------------------------------------------------------------------------------------------
// Reservations and handover (§7)
// ---------------------------------------------------------------------------------------------

/** RES-1 (header `Idempotency-Key` required) */
export type CreateReservationBody = { listingId: string; quantity: number };

/** RES-2 */
export type MyReservationsQuery = PageQuery & { tab?: ReservationTab };

/** RES-4 */
export type CancelReservationBody = { reason: BuyerCancelReason; note?: string | null };

/** RES-5 */
export type MySalesQuery = PageQuery & {
  /** csv of ReservationStatus, default RESERVED */
  status?: string;
  /** YYYY-MM-DD, default today */
  date?: string;
  listingId?: string;
};

/** RES-7 */
export type PickupLookupBody = { qrPayload: string } | { code: string };
export type PickupLookupResponse = {
  reservation: Reservation;
  amountToCollect: number;
  canConfirm: boolean;
  blockingReason: PickupBlockingReason | null;
};

/** RES-8 */
export type PickupConfirmBody =
  | { reservationId: string; qrPayload: string }
  | { reservationId: string; code: string };
export type PickupConfirmResponse = { reservation: Reservation; listingRemaining: number };

// ---------------------------------------------------------------------------------------------
// Reports (§8)
// ---------------------------------------------------------------------------------------------

/** REP-1 */
export type CreateReportBody = {
  type: ReportType;
  listingId: string | null;
  reservationId: string | null;
  accountId: string | null;
  description: string;
  imageIds: string[];
};

// ---------------------------------------------------------------------------------------------
// Admin (§9)
// ---------------------------------------------------------------------------------------------

/** ADM-2 */
export type AdminUpdateReportBody = {
  status: Exclude<ReportStatus, 'OPEN'>;
  action: ReportAction;
  resolution: string;
  clearReview: boolean;
};

/** ADM-3 */
export type AdminBlockListingBody = { reason: string };

/** ADM-4 */
export type AdminAccountStatusBody = { status: AccountStatus; reason: string };
export type AdminAccountStatusResponse = { id: string; status: AccountStatus };

/** ADM-5 */
export type AdminSellerVerificationBody = { verified: boolean; note: string };
export type AdminSellerVerificationResponse = { id: string; seller: MeSeller };

/** ADM-6 */
export type AdminAccount = {
  id: string;
  displayName: string | null;
  phone: string | null;
  email: string | null;
  status: AccountStatus;
  seller: MeSeller;
  createdAt: string;
};

/** ADM-9 */
export type AdminMetrics = {
  portionsHandedOver: number;
  reservations: { created: number; completed: number; cancelled: number; expired: number };
  completionRate: number;
  listings: { published: number; expiredWithStock: number };
  listingExpiredRate: number;
  discount: { avgRate: number; samples: number };
  reports: {
    total: number;
    byType: Partial<Record<ReportType, number>>;
    open: number;
    medianHandlingHours: number;
    byAction: Partial<Record<ReportAction, number>>;
  };
};
