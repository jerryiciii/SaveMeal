# API contract: SaveMeal `/api/v1`

> **Contract-first.** This file is fixed before code. Any change lands here first, in its own
> `docs(contract): …` commit, before code on either side. Entities, states and guards are defined in
> [`DOMAIN.md`](DOMAIN.md). Section numbers like "D§3" refer to that file. The product spec is the
> competition dossier (D§0). The UI is Figma V1.

Version: **v1.3** (2026-11-24) · **42 MVP endpoints** + 26 Later · 4 jobs (D§7) · changelog in §18

Every endpoint is tagged **[MVP]** (build now) or **[LATER]** (designed only; do not build, and no
milestone includes it). The demo slice to build first is in D§10.

---

## 0. Conventions

### Transport

- The base URL is `/api/v1`. The web app calls it same-origin through a Next.js rewrite, and the API
  listens on `:4000`.
- Bodies are JSON. Image upload is the exception and uses `multipart/form-data`.
- Fields are camelCase and enums are UPPER_SNAKE. IDs are UUID strings.
- **Money** is integer VND. Times are ISO 8601 with an offset, returned in `+07:00`. Dates are
  `YYYY-MM-DD` in local time.
- Optional fields are returned as `null`, not omitted.

### Envelope, pagination and errors

```jsonc
{ "data": { ... } }                                                       // single resource
{ "data": [ ... ], "page": { "nextCursor": "opaque-or-null", "limit": 20 } } // list
{ "error": { "code": "LISTING_SOLD_OUT", "message": "Món này vừa hết suất.", "details": {}, "requestId": "req_…" } }
```

- Pagination uses `cursor` and `limit` (default 20, max 50).
- `message` is Vietnamese and safe to show to users. `code` is stable (see §16).
  `VALIDATION_FAILED` uses `details.fields`.
- Every response has an `X-Request-Id` header.

### Auth

- Phone or email OTP, then JWT. The access JWT lasts 15 min and is sent as
  `Authorization: Bearer`. Its claims are `sub`, `role` and `sid`.
- The refresh token is opaque, rotating and valid for 30 days. It is delivered **only** as the
  cookie `lb_rt` (`HttpOnly; Secure; SameSite=Lax; Path=/api/v1/auth`). Reusing a rotated token
  revokes the whole family.
- A `SUSPENDED` account gets `403 ACCOUNT_SUSPENDED` on every authenticated call except AUTH-4 and
  ME-1.

### Roles

| Role | Meaning |
|---|---|
| `PUBLIC` | No token needed. A token is accepted and enriches the response. |
| `USER` | A signed-in, `ACTIVE` account |
| `OWNER` | The USER who is the listing's `sellerId` |
| `BUYER` | The USER who made the reservation |
| `SELLER` | The USER who owns the reservation's listing |
| `ADMIN` | `role = ADMIN` |

### Headers and rate limits

- `Idempotency-Key` (UUID) is **required** on RES-1 and optional on other POSTs. The same key with
  the same body replays the response for 24 h. A different body returns
  `422 IDEMPOTENCY_KEY_REUSED`.
- Rate limits (`429 RATE_LIMITED` with `Retry-After`):

| Endpoint | Limit |
|---|---|
| OTP request | 1 per 60 s and 5 per hour per identifier, 20 per hour per IP |
| OTP verify | 5 attempts per request |
| Pickup lookup/confirm | 10 per minute per seller (manual code: 5 per minute) |
| Reports | 10 per day per account |
| Listing publish | 10 per hour per account |
| Default | 120 per minute |

---

## 1. Shared objects

```ts
type Image = { id: string; url: string; width: number; height: number };
type ImagePurpose = "LISTING" | "REPORT" | "AVATAR" | "PAYMENT_QR" | "PAYMENT_PROOF";
type AccountStatus = "ACTIVE" | "SUSPENDED";
type SellerType = "INDIVIDUAL" | "SHOP" | "CAFE" | "BAKERY" | "CANTEEN";
type Category = "BAKERY" | "MEAL" | "DRINK" | "PACKAGED" | "OTHER";
type Storage = "ROOM_TEMP" | "CHILLED" | "FROZEN";
type Allergen = "GLUTEN" | "MILK" | "EGG" | "PEANUT" | "TREE_NUT" | "SOY" | "FISH" | "SHELLFISH" | "SESAME";
type ListingStatus = "DRAFT" | "PUBLISHED" | "EXPIRED" | "WITHDRAWN" | "BLOCKED";
type ReservationStatus = "PENDING_PAYMENT" | "AWAITING_SELLER_CONFIRM" | "RESERVED" | "COMPLETED" | "CANCELLED" | "EXPIRED";
type PaymentStatus = "UNPAID" | "PROOF_SUBMITTED" | "CONFIRMED" | "REJECTED" | "EXPIRED";
type CancelReason = "BUYER_LATE" | "BUYER_WRONG_QTY" | "BUYER_CHANGED_PLAN" | "BUYER_OTHER"
  | "PAYMENT_REJECTED" | "SELLER_WITHDREW" | "LISTING_BLOCKED" | "ADMIN";
type ReportType = "WRONG_INFO" | "UNSAFE_FOOD" | "NOT_RECEIVED" | "SELLER_ABSENT" | "OTHER";
type DeclarationKey = "NOT_EXPIRED" | "STORED_PROPERLY" | "NOT_SPOILED" | "NOT_SERVED_LEFTOVERS"
  | "INFO_DECLARED" | "PICKUP_WINDOW_OK";
type ChecklistKey = "PHOTO" | "NAME" | "PRICE" | "PORTIONS" | "ORIGIN" | "PREPARED_AT" | "STORAGE"
  | "PICKUP_WINDOW" | "PICKUP_LOCATION" | "PAYMENT_QR";

type PickupLocation = { address: string; lat: number; lng: number };

type SellerSummary = {                 // public
  id: string; name: string;            // sellerName ?? displayName
  type: SellerType | null; verified: boolean };

type Me = {
  id: string; displayName: string | null; phone: string | null; email: string | null;
  avatar: Image | null; role: "USER" | "ADMIN"; status: AccountStatus;
  seller: { name: string | null; type: SellerType | null; verified: boolean;
            defaultPickup: PickupLocation | null; bankQrImage: Image | null };
  stats: { portionsHandedOver: number; reservationsActive: number; listingsActive: number }; // V1/08, V1/35
  createdAt: string };

type SellerProfile = SellerSummary & {  // V1/16
  activeListingCount: number; completedHandovers: number; memberSince: string };

type ListingCard = {
  id: string; title: string; category: Category; image: Image | null;
  originalPrice: number | null; price: number; isFree: boolean;
  quantityAvailable: number; soldOut: boolean;
  pickupStart: string; pickupEnd: string;
  pickup: PickupLocation; distanceMeters: number | null; seller: SellerSummary };

type MapPin = { id: string; lat: number; lng: number; title: string; price: number; isFree: boolean;
  quantityAvailable: number; category: Category };

type ListingDetail = ListingCard & {   // V1/04
  description: string | null; images: Image[]; origin: string; preparedAt: string;
  storage: Storage; storageNote: string | null; ingredients: string | null; allergens: Allergen[];
  status: ListingStatus; underReview: boolean;
  declaredAt: string | null;           // copy: "Người bán đã xác nhận thông tin", never "an toàn"
  myActiveReservationId: string | null };

type ListingOwnerView = ListingDetail & {  // OWNER / ADMIN
  quantityTotal: number; reservedCount: number; completedCount: number;
  bankQrImage: Image | null;           // listing bank QR (falls back to me.seller.bankQrImage)
  missing: ChecklistKey[];             // empty = ready to publish
  editableFields: string[]; closeReason: string | null; blockedReason: string | null;
  createdAt: string; publishedAt: string | null };

type PickupToken = { qrPayload: string /* "SM1.<token>" */; expiresAt: string };

type Payment = {
  id: string;
  reservationId: string;
  status: PaymentStatus;
  amount: number;                      // = totalPrice (0 platform fee in v1.3)
  sellerQrImage: Image | null;
  proofImage: Image | null;
  expiresAt: string;
  proofSubmittedAt: string | null;
  confirmedAt: string | null;
  rejectedAt: string | null;
  rejectReason: string | null;
};

type Reservation = {
  id: string; code: string /* "SM–4281" */; status: ReservationStatus;
  quantity: number; unitPrice: number; totalPrice: number;
  platformFee: number;                 // 0 in v1.3 P2P
  payableAmount: number;               // = totalPrice in v1.3 P2P
  listing: { id: string; title: string; image: Image | null; pickupStart: string; pickupEnd: string;
             pickup: PickupLocation; status: ListingStatus };
  seller: SellerSummary;
  buyer: { displayName: string } | null;  // SELLER / ADMIN only; never phone or email
  pickupToken: PickupToken | null;        // BUYER only, while RESERVED (null while PENDING_PAYMENT or AWAITING_SELLER_CONFIRM)
  payment: Payment | null;                // non-null for paid orders when PAYMENTS_ENABLED=true
  cancelReason: CancelReason | null;
  createdAt: string; completedAt: string | null; closedAt: string | null;
  canCancel: boolean; canReport: boolean };

type Report = { id: string; type: ReportType; description: string; images: Image[];
  listingId: string | null; reservationId: string | null; reportedAccountId: string;
  status: "OPEN" | "IN_REVIEW" | "RESOLVED" | "DISMISSED";
  action: "NONE" | "WARNING" | "LISTING_BLOCKED" | "ACCOUNT_SUSPENDED" | null;
  resolution: string | null; createdAt: string; handledAt: string | null;
  reporter: { id: string; displayName: string } | null };   // ADMIN only
```

```ts
type ListingInput = {                  // LIST-3 (partial allowed for a draft) / LIST-4
  title: string;                       // 3–80
  description?: string | null;         // ≤ 500
  category: Category;
  imageIds?: string[];                 // 1–4 to publish (PHOTO)
  origin: string;                      // ≤ 200
  preparedAt: string;
  storage: Storage; storageNote?: string | null;
  ingredients?: string | null; allergens?: Allergen[];   // optional information
  originalPrice?: number | null;       // reference price; price ≤ originalPrice when set
  price: number;                       // ≥ 0
  quantityTotal: number;               // 1–50
  pickupStart: string; pickupEnd: string;
  pickup?: PickupLocation;             // defaults to me.seller.defaultPickup
  bankQrImageId?: string | null;       // defaults to me.seller.bankQrImageId; required for paid listings when PAYMENTS_ENABLED=true
};
```

---

## 2. System

- **SYS-1 · `GET /health` [MVP].** Role PUBLIC. Returns 200
  `{ "data": { "status": "ok", "db": "ok", "version": "1.3.0" } }`.
- **SYS-2 · `GET /config` [MVP].** Role PUBLIC. Returns 200 with:

```json
{ "data": {
  "features": { "payments": false, "googleLogin": false },
  "enums": { "categories": ["BAKERY","MEAL","DRINK","PACKAGED","OTHER"], "storage": ["ROOM_TEMP","CHILLED","FROZEN"],
             "allergens": ["GLUTEN","…"], "sellerTypes": ["INDIVIDUAL","…"], "reportTypes": ["…"],
             "cancelReasons": ["BUYER_LATE","BUYER_WRONG_QTY","BUYER_CHANGED_PLAN","BUYER_OTHER"] },
  "limits": { "maxQtyPerReservation": 2, "maxActiveReservations": 3, "radiusKmOptions": [1,3,5], "maxRadiusKm": 10,
              "maxImagesPerListing": 4, "maxWindowHours": 4, "pickupTokenTtlMin": 10, "earlyPickupMin": 30,
              "minPaymentHoldMin": 5, "defaultPaymentHoldMin": 10 },
  "fees": { "percent": 0, "thresholdVnd": 0, "flatVnd": 0, "paidBy": "NONE" },
  "defaultCenter": { "lat": 16.0544, "lng": 108.2022, "label": "Đà Nẵng" },
  "popularSearches": ["Bánh mì","Bánh ngọt","Cơm trưa","Món miễn phí"],
  "map": { "styleUrl": "https://…/style.json", "attribution": "© OpenStreetMap contributors" }
} }
```

- **SYS-3 · `GET /internal/cron/daily` [INFRA].** (Infrastructure endpoint; not counted in the 42 MVP
  endpoints.) Role `CRON` (`Authorization: Bearer <CRON_SECRET>`). Runs JOB-1 (`expireListings`),
  JOB-2 (`expireReservations`), JOB-3 (`cleanupExpiredData`) and JOB-4 (`rebuildMetrics`)
  sequentially for serverless deployments (e.g. Vercel Cron). Returns 200:

```json
{ "data": {
  "listingsExpired": 0,
  "reservationsExpired": 0,
  "cleanup": { "otpRequests": 0, "refreshTokens": 0, "pickupTokens": 0, "images": 0 },
  "metricsRebuilt": 0
} }
```

  - Errors: `401 UNAUTHENTICATED` (missing or invalid bearer token), `403 FORBIDDEN` (`CRON_SECRET`
    not configured).

## 3. Auth

- **AUTH-1 · `POST /auth/otp/request` [MVP].**
  - Role: PUBLIC.
  - Request: `{ "channel": "SMS" | "EMAIL", "identifier": "+849… | a@b.vn" }`.
  - 200: `{ requestId, expiresAt, resendAfterSec: 60, codeLength: 6 }`. The response is the same
    whether or not an account exists. In dev, `OTP_PROVIDER=console` logs the code, and production
    refuses to boot with it.
  - Errors: `400 VALIDATION_FAILED`, `429 RATE_LIMITED`.
- **AUTH-2 · `POST /auth/otp/verify` [MVP].**
  - Request: `{ requestId, code }`.
  - 200: `{ accessToken, accessTokenExpiresAt, isNewUser, user: Me }`, plus the `lb_rt` cookie. The
    first verify creates the account.
  - Errors: `400 OTP_INVALID` (`details.attemptsLeft`), `400 OTP_EXPIRED`,
    `429 OTP_TOO_MANY_ATTEMPTS`, `403 ACCOUNT_SUSPENDED`.
- **AUTH-3 · `POST /auth/refresh` [MVP].**
  - Uses the cookie `lb_rt`.
  - 200: `{ accessToken, accessTokenExpiresAt }`, plus a rotated cookie.
  - Errors: `401 REFRESH_INVALID`, `403 ACCOUNT_SUSPENDED`.
- **AUTH-4 · `POST /auth/logout` [MVP].**
  - Request: `{ allDevices?: boolean }`.
  - 204: revokes the token family and clears the cookie. It is idempotent.
- **AUTH-5 · `POST /auth/google` [LATER].**
  - Request: `{ idToken }` behind `GOOGLE_LOGIN_ENABLED`. It returns `403 FEATURE_DISABLED` while
    the flag is off.

## 4. Me (one account that buys and sells)

- **ME-1 · `GET /me` [MVP].** Role USER. Returns 200 `{ data: Me }`.
- **ME-2 · `PATCH /me` [MVP].**
  - Role: USER.
  - Request: `{ displayName?, avatarImageId?, seller?: { name?, type?, defaultPickup?: PickupLocation | null, bankQrImageId?: string | null } }`.
  - 200: `Me`.
  - Errors: `400 VALIDATION_FAILED`, `404 IMAGE_NOT_FOUND`.
  - Phone and email cannot be changed in v1. Setting seller info is optional; anyone can sell (D§9
    D1/D4). `seller.bankQrImageId` references an image uploaded via IMG-1 with `purpose=PAYMENT_QR`
    (exposed as `Me.seller.bankQrImage`).
- **ME-3 · `DELETE /me` [MVP].**
  - Role: USER.
  - Request: `{ "confirm": "XOA TAI KHOAN" }`.
  - 204: soft-deletes the account and anonymises personal data (phone, email and avatar set to null;
    name "Người dùng đã xóa"). Tokens are revoked, and the account's own `DRAFT` listings are
    deleted. Anonymised reservations, reports and event_logs are kept.
  - Errors: `409 ACCOUNT_HAS_ACTIVE_ITEMS` (`details: { activeReservations, activeListings }`).
- **SELLER-1 · `GET /sellers/{accountId}` [MVP].**
  - Role: PUBLIC.
  - 200: `SellerProfile` (V1/16). The listings come from LIST-1 `sellerId=`.
  - Errors: `404 SELLER_NOT_FOUND` (also returned for deleted or suspended accounts).

## 5. Images

- **IMG-1 · `POST /images` [MVP].**
  - Role: USER.
  - Request: `multipart/form-data` with `file` (jpeg, png or webp, ≤ 5 MB) and
    `purpose=LISTING|REPORT|AVATAR|PAYMENT_QR|PAYMENT_PROOF`.
  - 201: `Image`. The server re-encodes it to webp (≤ 1600 px) and **strips EXIF/GPS**. An image not
    attached within 24 h is purged.
  - Errors: `413 IMAGE_TOO_LARGE`, `415 IMAGE_TYPE_UNSUPPORTED`.
- **IMG-2 · `DELETE /images/{imageId}` [MVP].**
  - Role: the uploader.
  - 204.
  - Errors: `404 IMAGE_NOT_FOUND`, `409 IMAGE_IN_USE` (on a published listing, a report, a seller
    bank QR, or a payment proof).

## 6. Listings (`food_listings`)

### LIST-1 · `GET /listings` [MVP]: map, list and search

Role: PUBLIC. It returns only visible listings (D§3: `PUBLISHED`, not under review, an `ACTIVE`
seller, `pickupEnd` in the future, and stock left unless `includeSoldOut`).

| Param | Type | Default | Notes |
|---|---|---|---|
| `lat`, `lng` | number | `config.defaultCenter` | The buyer's chosen point. Never stored, and logged rounded to 2 decimals. |
| `radiusKm` | number | 3 | 0.5–10 (distance filter; V1/12: 1, 3, 5) |
| `q` | string | — | Title or seller name (V1/03) |
| `category` | csv `Category` | all | Food type filter |
| `priceMax` | int VND | — | Price filter ("Dưới 20k" = 20000) |
| `free` | boolean | — | `price = 0` |
| `pickupDay` | `today\|tomorrow` | — | Pickup-time filter (V1/12) |
| `pickupFrom`, `pickupTo` | `HH:mm` | — | Optional pickup-time range: the listing's window overlaps it |
| `sellerId` | uuid | — | Listings of one seller (V1/16) |
| `includeSoldOut` | boolean | false | |
| `sort` | `distance\|pickupSoon\|priceAsc\|newest` | `distance` | |
| `view` | `list\|map` | `list` | `map` returns `MapPin[]` (≤ 200, no cursor) |
| `cursor`, `limit` | | | `list` only |

- **200:** `{ data: ListingCard[] | MapPin[], page? }`. An empty result drives V1/37.
- **Errors:** `400 VALIDATION_FAILED`.

### Other listing endpoints

- **LIST-2 · `GET /listings/{listingId}` [MVP].**
  - Role: PUBLIC for `PUBLISHED` listings, including sold-out or under-review ones (shown as
    unavailable, V1/38). OWNER and ADMIN get `ListingOwnerView` for any status. A BUYER who has a
    reservation on a closed listing still gets it.
  - 200: `ListingDetail | ListingOwnerView`.
  - Errors: `404 LISTING_NOT_FOUND`.
- **LIST-3 · `POST /listings` [MVP]: create a draft.**
  - Role: USER.
  - Request: a partial `ListingInput`, where only `title` and `category` are required. Optional
    `bankQrImageId` (`purpose=PAYMENT_QR`) defaults to `me.seller.bankQrImageId`; setting it on a
    listing also populates `accounts.bank_qr_image_id` if the seller has no default yet.
  - 201: `ListingOwnerView` with `status: DRAFT` and `missing[]`.
  - Errors: `400 VALIDATION_FAILED`, `404 IMAGE_NOT_FOUND`, `422 LISTING_LIMIT` (`MAX_ACTIVE_LISTINGS`).
  - Transition: — → `DRAFT`.
- **LIST-4 · `PATCH /listings/{listingId}` [MVP].**
  - Role: OWNER.
  - Request: a partial `ListingInput` (including optional `bankQrImageId`; setting it also
    populates `accounts.bank_qr_image_id` if the seller has no default yet).
  - 200: `ListingOwnerView`.
  - Errors:
    - `400 VALIDATION_FAILED`;
    - `404 IMAGE_NOT_FOUND`;
    - `409 FIELD_LOCKED` (`details.fields`);
    - `409 QUANTITY_BELOW_RESERVED`;
    - `409 PRICE_INCREASE_NOT_ALLOWED`;
    - `409 PICKUP_WINDOW_EXTENSION_NOT_ALLOWED`;
    - `409 INVALID_STATE_TRANSITION` (a terminal status).
  - Rules: on a `PUBLISHED` listing only the D§3 editable fields can change. Raising
    `quantityTotal` raises `quantityAvailable` by the same amount atomically.
- **LIST-5 · `DELETE /listings/{listingId}` [MVP].**
  - Role: OWNER. Works on `DRAFT` only.
  - 204.
  - Errors: `409 INVALID_STATE_TRANSITION`.
- **LIST-6 · `POST /listings/{listingId}/publish` [MVP].**
  - Role: OWNER.
  - Request: `{ "declaration": { "NOT_EXPIRED": true, "STORED_PROPERLY": true, "NOT_SPOILED": true, "NOT_SERVED_LEFTOVERS": true, "INFO_DECLARED": true, "PICKUP_WINDOW_OK": true } }`.
  - 200: `ListingOwnerView` with `status: PUBLISHED` (V1/28).
  - Rules: when `PAYMENTS_ENABLED=true` and `price > 0`, publishing requires a `bankQrImageId` (on
    the listing or on the seller's account default); otherwise returns `422 LISTING_INCOMPLETE`
    with `"PAYMENT_QR"` in `details.missing`. Free listings (`price === 0`) do not require a bank
    QR.
  - Errors:
    - `422 LISTING_INCOMPLETE` (`details.missing: ChecklistKey[]`);
    - `422 DECLARATION_INCOMPLETE` (`details.missing: DeclarationKey[]`);
    - `422 PICKUP_WINDOW_INVALID`;
    - `422 LISTING_TOO_OLD` (`MAX_LISTING_AGE_HOURS`; a sanity limit, not a safety claim);
    - `409 INVALID_STATE_TRANSITION`;
    - `403 ACCOUNT_SUSPENDED`;
    - `429 RATE_LIMITED`.
  - Transition: `DRAFT` → `PUBLISHED`. It sets `quantityAvailable = quantityTotal` and writes the
    `LISTING_PUBLISHED` event with the declaration as evidence.
- **LIST-7 · `POST /listings/{listingId}/withdraw` [MVP].**
  - Role: OWNER.
  - Request: `{ "reason": "STORAGE_NOT_OK" | "SOLD_ELSEWHERE" | "OTHER", "note": "≤ 200|null" }`.
  - 200: `ListingOwnerView` with `status: WITHDRAWN`.
  - Errors: `409 INVALID_STATE_TRANSITION`.
  - Transition: `DRAFT|PUBLISHED` → `WITHDRAWN`. Every `PENDING_PAYMENT`,
    `AWAITING_SELLER_CONFIRM`, or `RESERVED` order → `CANCELLED` (`SELLER_WITHDREW`), its tokens
    are revoked, and `UNPAID` / `PROOF_SUBMITTED` payments → `EXPIRED`. Buyers see it on their
    order status (there is no push in the MVP).
- **LIST-8 · `GET /me/listings` [MVP].**
  - Role: USER.
  - Query: `tab=active|done` (`active` = `DRAFT` and `PUBLISHED`; `done` = terminal), `cursor`,
    `limit`.
  - 200: `ListingOwnerView[]` (V1/29).
- **LIST-9 · `POST /listings/{id}/pause` and LIST-10 · `POST /listings/{id}/resume` [LATER].** These
  hide or show the listing without closing it.

## 7. Reservations and handover

- **RES-1 · `POST /reservations` [MVP]: reserve atomically.**
  - Role: USER. The `Idempotency-Key` header is required.
  - Request: `{ "listingId": "uuid", "quantity": 1, "holdMinutes": 10 }` (`holdMinutes` is optional,
    integer ≥ `minPaymentHoldMin` (5), default `defaultPaymentHoldMin` (10); ignored for free items
    or when `PAYMENTS_ENABLED=false`).
  - 201: `{ data: Reservation }`:
    - When `PAYMENTS_ENABLED=true` and `totalPrice > 0`: `status: PENDING_PAYMENT`, `pickupToken:
      null`, `platformFee: 0`, `payableAmount: totalPrice`, and `payment` populated (`status:
      UNPAID`, `amount: totalPrice`, `sellerQrImage` copied from listing/seller default,
      `expiresAt = now + holdMinutes`). Stock is decremented immediately.
    - When free (`totalPrice === 0`) or `PAYMENTS_ENABLED=false`: `status: RESERVED`, `pickupToken`
      set right away, `platformFee: 0`, `payableAmount: totalPrice`, `payment: null`.
  - Errors:
    - `409 LISTING_SOLD_OUT` (`details.quantityAvailable`);
    - `409 LISTING_NOT_AVAILABLE` (not published, under review or the window has ended);
    - `422 QUANTITY_LIMIT_EXCEEDED`;
    - `422 PAYMENT_HOLD_INVALID` (`holdMinutes < minPaymentHoldMin` or `now + holdMinutes >
      listing.pickupEnd`);
    - `409 ACTIVE_RESERVATION_LIMIT`;
    - `409 ALREADY_RESERVED` (`details.reservationId`);
    - `403 OWN_LISTING_RESERVATION`;
    - `403 ACCOUNT_SUSPENDED`;
    - `422 IDEMPOTENCY_KEY_REUSED`.
  - Transition: runs lazy-expiry on expired `PENDING_PAYMENT` holds first (D§6), then — →
    `PENDING_PAYMENT` or `RESERVED`, with `quantityAvailable −= quantity` in one conditional
    `UPDATE` inside a transaction (D§6).
- **RES-2 · `GET /me/reservations` [MVP].**
  - Role: USER.
  - Query: `tab=upcoming|history` (`upcoming` = `PENDING_PAYMENT`, `AWAITING_SELLER_CONFIRM`, and
    `RESERVED`; `history` = `COMPLETED`, `CANCELLED`, `EXPIRED`), `cursor`, `limit`.
  - 200: `Reservation[]` (V1/17). Runs lazy-expiry on expired `PENDING_PAYMENT` holds (does not
    expire `AWAITING_SELLER_CONFIRM`). The FE polls it every 30 s while the screen is open.
- **RES-3 · `GET /reservations/{reservationId}` [MVP].**
  - Role: BUYER, SELLER or ADMIN.
  - 200: `Reservation` (V1/06, V1/18, V2.1/06b). Runs lazy-expiry if `PENDING_PAYMENT` and expired.
    `pickupToken` is sent to the BUYER only while `RESERVED` (`null` while `PENDING_PAYMENT`,
    `AWAITING_SELLER_CONFIRM`, or if the current token has expired, in which case the FE calls
    RES-6).
  - Errors: `404 RESERVATION_NOT_FOUND`.
- **RES-4 · `POST /reservations/{reservationId}/cancel` [MVP].**
  - Role: BUYER.
  - Request: `{ "reason": "BUYER_LATE" | "BUYER_WRONG_QTY" | "BUYER_CHANGED_PLAN" | "BUYER_OTHER", "note": "≤ 200|null" }`.
  - 200: `Reservation` with `status: CANCELLED`.
  - Errors: `409 RESERVATION_NOT_ACTIVE`, `409 CANCEL_WINDOW_CLOSED`.
  - Transition:
    - `PENDING_PAYMENT` or `AWAITING_SELLER_CONFIRM` → `CANCELLED`: releases stock atomically (if
      listing still `PUBLISHED` and `now < pickupEnd`) and marks `payment.status = EXPIRED`.
    - `RESERVED` → `CANCELLED`: releases stock atomically (D§4) and revokes tokens.
- **RES-5 · `GET /me/sales` [MVP]: the seller's orders.**
  - Role: USER (the seller side of the same account).
  - Query: `status` (csv, default `RESERVED`; supports `PENDING_PAYMENT`, `AWAITING_SELLER_CONFIRM`,
    `RESERVED`, `COMPLETED`, `CANCELLED`, `EXPIRED`, e.g.
    `status=AWAITING_SELLER_CONFIRM,RESERVED` for screen `30b`), `date` (default today),
    `listingId`, `cursor`, `limit`.
  - 200: `Reservation[]` with `buyer.displayName`, sorted by `pickupStart` ascending (V1/30,
    V2.1/30b). The FE polls it every 30 s.
- **RES-6 · `POST /reservations/{reservationId}/pickup-token` [MVP].**
  - Role: BUYER.
  - Request: an empty body.
  - 201: `{ data: PickupToken }`. It is a new random token, and older unused ones are revoked.
  - Errors: `409 RESERVATION_NOT_ACTIVE`, `409 PICKUP_WINDOW_CLOSED`, `429 RATE_LIMITED`
    (6 per minute).
- **RES-7 · `POST /pickups/lookup` [MVP].**
  - Role: USER (as seller).
  - Request: `{ "qrPayload": "SM1.<token>" }` **or** `{ "code": "4281" }` (`SM–`, dashes and spaces
    are stripped).
  - 200: `{ data: { reservation: Reservation, amountToCollect: 0, canConfirm: true, blockingReason: null } }`.
    `amountToCollect` is `0` when `payment.status === "CONFIRMED"` (or free), else `totalPrice`. It
    does **not** change state.
  - `blockingReason` is one of:
    `TOO_EARLY | WINDOW_CLOSED | NOT_ACTIVE | TOKEN_EXPIRED | TOKEN_USED | LISTING_BLOCKED`.
  - Errors: `422 PICKUP_TOKEN_INVALID` (unknown token, or a token for another seller's order),
    `422 PICKUP_CODE_INVALID`, `429 RATE_LIMITED`.
- **RES-8 · `POST /pickups/confirm` [MVP]: handover.**
  - Role: the SELLER of the reservation.
  - Request: `{ "reservationId": "uuid", "qrPayload": "SM1.<token>" }` **or**
    `{ "reservationId": "uuid", "code": "4281" }`.
  - 200: `{ data: { reservation: Reservation /* COMPLETED */, listingRemaining: 4 } }` (V1/32).
  - Errors:
    - `422 PICKUP_TOKEN_INVALID`;
    - `409 PICKUP_TOKEN_EXPIRED`;
    - `409 PICKUP_TOKEN_USED`;
    - `422 PICKUP_CODE_INVALID`;
    - `409 RESERVATION_NOT_ACTIVE`;
    - `409 PICKUP_TOO_EARLY`;
    - `409 PICKUP_WINDOW_CLOSED`;
    - `409 LISTING_BLOCKED`.
  - Transition: `RESERVED` → `COMPLETED` ("Hoàn tất"). Atomically sets the token's `usedAt` and
    writes `RESERVATION_COMPLETED`. **Pickup only. It is not a safety certificate.**
- **RES-9 · `POST /reservations/{id}/no-show` [LATER].** A manual no-show. In the MVP, JOB-2 expires
  orders automatically.

## 8. Reports (violations, spec §1.3, §3.3)

- **REP-1 · `POST /reports` [MVP].**
  - Role: USER.
  - Request: `{ "type": ReportType, "listingId": "uuid|null", "reservationId": "uuid|null", "accountId": "uuid|null", "description": "10–1000", "imageIds": [] }`.
    At least one target is required, and the server derives `reportedAccountId`. `NOT_RECEIVED` and
    `SELLER_ABSENT` need the caller's own `reservationId`.
  - 201: `Report` (V1/23).
  - Errors: `400 VALIDATION_FAILED`, `422 REPORT_TARGET_INVALID`, `429 RATE_LIMITED`.
  - Side effects: `UNSAFE_FOOD` on a listing sets `underReview = true` immediately. The listing is
    then hidden and cannot be reserved until an admin acts (ADM-2).
- **REP-2 · `GET /me/reports` [LATER].** The reporter's view of their reports and their status.

## 9. Admin (moderation and KPIs)

All of these are ADMIN only and write an event_log.

- **ADM-1 · `GET /admin/reports` [MVP].** Query: `status`, `type`, `cursor`, `limit`. Returns 200
  `Report[]` (with `reporter`).
- **ADM-2 · `PATCH /admin/reports/{reportId}` [MVP].**
  - Request: `{ "status": "IN_REVIEW" | "RESOLVED" | "DISMISSED", "action": "NONE" | "WARNING" | "LISTING_BLOCKED" | "ACCOUNT_SUSPENDED", "resolution": "text", "clearReview": true }`.
  - 200: `Report`, with `handledAt` set when it is resolved or dismissed.
  - Effects:
    - `LISTING_BLOCKED` = ADM-3 on the listing.
    - `ACCOUNT_SUSPENDED` = ADM-4 on the reported account.
    - `clearReview` sets `underReview = false`.
- **ADM-3 · `POST /admin/listings/{listingId}/block` [MVP].**
  - Request: `{ "reason": "required" }`.
  - 200: `ListingOwnerView` with `status: BLOCKED`.
  - Transition: `PUBLISHED|EXPIRED` → `BLOCKED`. Every `PENDING_PAYMENT`,
    `AWAITING_SELLER_CONFIRM`, or `RESERVED` order → `CANCELLED` (`LISTING_BLOCKED`), pickup tokens
    are revoked, and `UNPAID` / `PROOF_SUBMITTED` payments → `EXPIRED`.
- **ADM-4 · `POST /admin/accounts/{accountId}/status` [MVP].**
  - Request: `{ "status": "ACTIVE" | "SUSPENDED", "reason": "required" }`.
  - 200: `{ id, status }`.
  - Suspending revokes the account's refresh tokens, hides their listings (they become invisible
    because the seller is not `ACTIVE`) and blocks new reservations by or for them. Existing orders
    stay as they are, so an admin decides on those.
- **ADM-5 · `POST /admin/accounts/{accountId}/seller-verification` [MVP].** Request:
  `{ "verified": true, "note": "Đã kiểm tra thông tin cơ sở" }`. Returns 200 `{ id, seller }` and
  sets or clears the "Đã xác minh" badge (D§9 D4).
- **ADM-6 · `GET /admin/accounts` [MVP].** Query: `q` (name, phone or email), `status`,
  `sellerOnly`, `cursor`, `limit`. Returns 200 a list of
  `{ id, displayName, phone, email, status, seller, createdAt }`. Contact data is visible to admins
  only.
- **ADM-7 · `GET /admin/listings` [MVP].** Query: `status`, `underReview`, `sellerId`, `from`, `to`,
  `cursor`, `limit`. Returns 200 `ListingOwnerView[]`.
- **ADM-8 · `GET /admin/reservations` [MVP].** Query: `status`, `sellerId`, `from`, `to`, `cursor`,
  `limit`. Returns 200 `Reservation[]` (never `pickupToken`).
- **ADM-9 · `GET /admin/metrics` [MVP].**
  - Query: `from`, `to`, `sellerId?`.
  - 200 (the KPIs exactly as in D§8):

```json
{ "data": {
  "portionsHandedOver": 31,
  "reservations": { "created": 40, "completed": 31, "cancelled": 5, "expired": 4 },
  "completionRate": 0.775,
  "listings": { "published": 25, "expiredWithStock": 6 },
  "listingExpiredRate": 0.24,
  "discount": { "avgRate": 0.38, "samples": 22 },
  "reports": { "total": 3, "byType": { "UNSAFE_FOOD": 1, "WRONG_INFO": 2 }, "open": 1,
               "medianHandlingHours": 5.5, "byAction": { "LISTING_BLOCKED": 1, "NONE": 1 } }
} }
```

- **ADM-10 · `GET /admin/exports/{dataset}.csv` [LATER].** An anonymised research export with
  hashed IDs, no personal data and coordinates rounded to 2 decimals.

## 10. Later only (designed, not built; no MVP milestone)

| ID | Endpoint | Notes |
|---|---|---|
| CHAT-1..2 | `GET`/`POST /reservations/{id}/messages` | Reservation-scoped chat (V1/24) |
| NOTI-1..4 | `GET /me/notifications`, `POST /me/notifications/read`, `POST`/`DELETE /me/push-subscriptions` | The in-app list and web push (V1/34) |
| SAVE-1..3 | `GET /me/saved`, `PUT`/`DELETE /me/saved/{type}/{id}` | Saved listings and sellers (V1/15) |
| FB-1..2 | `POST /reservations/{id}/feedback`, `GET /sellers/{id}/feedback` | Ratings, stored in the `feedback` table |
| WASTE-1..3 | Seller waste logs | Baseline waste data is collected outside the app (spec §6.2) |
| (Later) | Automated payment gateway webhooks (SePay/PayOS), platform fee, `/me/payouts`, `/me/payout-account`, `/admin/payments*`, `/admin/payouts*` | Deferred from v1.2 to Later; v1.3 uses P2P Direct QR + Proof (§12) |
| (none yet) | Store dashboard, staff accounts, scheduled promotions | Spec §2.3 |
| AUTH-5, LIST-9..10, RES-9, REP-2, ADM-10 | see above | |

## 11. Scheduled jobs

JOB-1 (listing expiry), JOB-2 (reservation expiry: expired `PENDING_PAYMENT` holds, plus
`AWAITING_SELLER_CONFIRM` and `RESERVED` orders past `pickup_end + NO_SHOW_GRACE_MIN`), JOB-3
(cleanup) and JOB-4 (metrics) are specified in D§7. They change state in exactly the same way as
the endpoints do. In serverless deployments where in-process `@Cron` schedules are disabled, they
are triggered via SYS-3 (`GET /internal/cron/daily`), and `PENDING_PAYMENT` holds are also swept
via lazy-expiry (D§6). Lazy-expiry does **not** expire `AWAITING_SELLER_CONFIRM` on the hold timer.

## 12. Payments (v1.3 P2P Direct QR + Proof + Resend Email)

Controlled by `PAYMENTS_ENABLED` (default `false` in env/tests until FE finishes wiring screens
`25b`, `21`, `30b`, `06b`). SaveMeal holds no money and charges no platform fee in v1.3
(`platformFee = 0`, `payableAmount = totalPrice`, `amount = totalPrice`). Automated gateway
webhooks (SePay/PayOS) and platform fees are deferred to Later (§10).

- **PAY-1 · `GET /reservations/{reservationId}/payment` [MVP].**
  - Role: BUYER, SELLER or ADMIN.
  - Runs lazy-expiry check if the reservation is `PENDING_PAYMENT` and expired (does not expire
    `AWAITING_SELLER_CONFIRM`).
  - 200: `{ data: Payment }`.
  - Errors: `404 RESERVATION_NOT_FOUND`, `404 PAYMENT_NOT_FOUND`.
- **PAY-2 · `POST /reservations/{reservationId}/payment-proof` [MVP].**
  - Role: BUYER.
  - Request: `{ "proofImageId": "uuid" }` (uploaded via IMG-1 with `purpose=PAYMENT_PROOF`).
  - Preconditions: `reservation.status === "PENDING_PAYMENT"` and `payment.status === "UNPAID"`
    (runs lazy-expiry first).
  - 200: `{ data: Reservation }`.
  - Transition: atomically transitions reservation `PENDING_PAYMENT` → `AWAITING_SELLER_CONFIRM`,
    payment `UNPAID` → `PROOF_SUBMITTED`, saves `proofImageId` and `proofSubmittedAt`, writes
    `PAYMENT_PROOF_SUBMITTED` to `event_logs`, and **sends a Resend email to the seller** notifying
    them of the new payment proof.
  - Errors:
    - `422 PROOF_REQUIRED` (missing or blank `proofImageId`);
    - `404 RESERVATION_NOT_FOUND`, `404 PAYMENT_NOT_FOUND`, `404 IMAGE_NOT_FOUND`;
    - `409 PAYMENT_NOT_CONFIRMABLE` (reservation is not `PENDING_PAYMENT` or payment is not `UNPAID`).
- **PAY-3 · `POST /reservations/{reservationId}/payment/confirm` [MVP].**
  - Role: SELLER.
  - Request: an empty body.
  - Preconditions: `reservation.status IN ("PENDING_PAYMENT", "AWAITING_SELLER_CONFIRM")`.
  - 200: `{ data: Reservation }`.
  - Transition: atomically transitions reservation → `RESERVED`, payment → `CONFIRMED`
    (`confirmedAt = now`), issues the first `pickupToken`, writes `PAYMENT_CONFIRMED` and
    `RESERVATION_PAID` to `event_logs`, and **sends a Resend email to the buyer** confirming
    payment and pickup QR readiness.
  - Errors:
    - `404 RESERVATION_NOT_FOUND`, `404 PAYMENT_NOT_FOUND`;
    - `409 PAYMENT_NOT_CONFIRMABLE` (reservation is not `PENDING_PAYMENT` or `AWAITING_SELLER_CONFIRM`).
- **PAY-4 · `POST /reservations/{reservationId}/payment/reject` [MVP].**
  - Role: SELLER.
  - Request: `{ "reason": "string (3–300 chars)" }`.
  - Preconditions: `reservation.status IN ("PENDING_PAYMENT", "AWAITING_SELLER_CONFIRM")`.
  - 200: `{ data: Reservation }`.
  - Transition: atomically transitions reservation → `CANCELLED` (`cancelReason: "PAYMENT_REJECTED"`),
    payment → `REJECTED` (`rejectedAt = now`, `rejectReason`), **releases stock atomically** back
    to the listing if still `PUBLISHED` and `now < pickupEnd`, writes `PAYMENT_REJECTED` and
    `RESERVATION_CANCELLED` to `event_logs`, and **sends a Resend email to the buyer** with the
    rejection reason.
  - Errors:
    - `400 VALIDATION_FAILED` (`reason` missing or outside 3–300 chars);
    - `404 RESERVATION_NOT_FOUND`, `404 PAYMENT_NOT_FOUND`;
    - `409 PAYMENT_NOT_CONFIRMABLE` (reservation is not `PENDING_PAYMENT` or `AWAITING_SELLER_CONFIRM`).

## 13–15. (reserved)

## 16. Error code catalogue

| HTTP | Codes |
|---|---|
| 400 | `VALIDATION_FAILED`, `OTP_INVALID`, `OTP_EXPIRED` |
| 401 | `UNAUTHENTICATED`, `TOKEN_EXPIRED`, `REFRESH_INVALID` |
| 403 | `FORBIDDEN`, `ACCOUNT_SUSPENDED`, `FEATURE_DISABLED`, `OWN_LISTING_RESERVATION` |
| 404 | `NOT_FOUND`, `LISTING_NOT_FOUND`, `RESERVATION_NOT_FOUND`, `PAYMENT_NOT_FOUND`, `SELLER_NOT_FOUND`, `IMAGE_NOT_FOUND`, `REPORT_NOT_FOUND`, `ACCOUNT_NOT_FOUND`. These are also used to hide resources from callers without access. |
| 409 | `INVALID_STATE_TRANSITION` (`details: { from, action }`), `FIELD_LOCKED`, `QUANTITY_BELOW_RESERVED`, `PRICE_INCREASE_NOT_ALLOWED`, `PICKUP_WINDOW_EXTENSION_NOT_ALLOWED`, `LISTING_SOLD_OUT`, `LISTING_NOT_AVAILABLE`, `LISTING_BLOCKED`, `ACTIVE_RESERVATION_LIMIT`, `ALREADY_RESERVED`, `RESERVATION_NOT_ACTIVE`, `CANCEL_WINDOW_CLOSED`, `PICKUP_TOO_EARLY`, `PICKUP_WINDOW_CLOSED`, `PICKUP_TOKEN_EXPIRED`, `PICKUP_TOKEN_USED`, `PAYMENT_NOT_CONFIRMABLE`, `IMAGE_IN_USE`, `ACCOUNT_HAS_ACTIVE_ITEMS` |
| 413 / 415 | `IMAGE_TOO_LARGE` / `IMAGE_TYPE_UNSUPPORTED` |
| 422 | `LISTING_INCOMPLETE`, `DECLARATION_INCOMPLETE`, `LISTING_TOO_OLD`, `LISTING_LIMIT`, `PICKUP_WINDOW_INVALID`, `PAYMENT_HOLD_INVALID`, `PROOF_REQUIRED`, `QUANTITY_LIMIT_EXCEEDED`, `PICKUP_TOKEN_INVALID`, `PICKUP_CODE_INVALID`, `REPORT_TARGET_INVALID`, `IDEMPOTENCY_KEY_REUSED` |
| 429 | `RATE_LIMITED`, `OTP_TOO_MANY_ATTEMPTS` |
| 500 | `INTERNAL` (never leaks a stack trace) |

## 17. Figma V1 & V2.1 screen → endpoint map

| Screen | MVP endpoints | Notes |
|---|---|---|
| 01 Bản đồ khám phá [2:2] | SYS-2, LIST-1 (`view=map`, and `free=true` for the sheet) | The map is MapLibre plus OSM tiles (`config.map`) |
| 02 Bottom sheet mở rộng [2:97] | LIST-1 (`view=list`) | |
| 03 Tìm kiếm [2:188] | SYS-2, LIST-1 (`q`) | |
| 04 Chi tiết món [2:237] | LIST-2, SELLER-1 (link) | ♡ save is Later; hide it |
| 05 Xác nhận đặt giữ [2:266] | LIST-2, RES-1 | When `config.features.payments=true` and `price > 0`: shows direct P2P payment summary (`platformFee = 0`) + `holdMinutes` selector → 21; free items or `payments=false` → 06 |
| 06 Nhận mã QR [2:293] | RES-3, RES-6 | QR = `pickupToken.qrPayload`. Code `SM–NNNN`. |
| 06b Chờ người bán xác nhận (V2.1) | RES-3, PAY-1 | Shown while `status === AWAITING_SELLER_CONFIRM` after buyer uploads proof; polls every 30 s until seller confirms (`RESERVED` → 06) or rejects (`CANCELLED`) |
| 07 Đăng pass món [2:324] | IMG-1, LIST-3, ME-1 (default pickup) | |
| 08 Tài khoản mua & bán [2:350] | ME-1, RES-2, LIST-8 | |
| 09 Onboarding [7:2] | — | |
| 10 Sign in [7:19] | AUTH-1 | Google button hidden (Later) |
| 11 Location permission [7:37] | — | Client-only geolocation |
| 12 Advanced filters [7:54] | SYS-2, LIST-1 | Price, food type, distance, pickup time |
| 13 Pin mini-sheet [7:96] | LIST-1 (map), LIST-2 | |
| 14 Free food list [7:122] | LIST-1 (`free=true&pickupDay=today`) | |
| 15 Saved listings [7:168] | — | **Later** (SAVE) |
| 16 Seller profile [7:204] | SELLER-1, LIST-1 (`sellerId`) | |
| 17 Đơn của tôi [8:2] | RES-2 | `tab=upcoming` includes `PENDING_PAYMENT`, `AWAITING_SELLER_CONFIRM`, and `RESERVED` |
| 18 Chi tiết đơn [8:43] | RES-3, RES-4 (Hủy đơn), REP-1 | |
| 21 Chuyển khoản VietQR & tải ảnh biên lai (V2.1) | RES-1, PAY-1, IMG-1 (`PAYMENT_PROOF`), PAY-2 | Active when `config.features.payments=true` and `totalPrice > 0`. Displays `payment.sellerQrImage` + countdown, buyer uploads transfer receipt proof → 06b. Skipped for free items or when `payments=false` (05 → 06). |
| 23 Báo cáo chất lượng [8:351] | IMG-1 (`REPORT`), REP-1 | |
| 24 Trò chuyện P2P [8:375] | — | **Later** (CHAT) |
| 25 Giờ nhận & bảo quản [9:181] | LIST-4, ME-2 (save default pickup) | |
| 25b Ảnh QR ngân hàng người bán (V2.1) | IMG-1 (`PAYMENT_QR`), ME-2 (`seller.bankQrImageId`), LIST-3 / LIST-4 (`bankQrImageId`) | Seller uploads default or per-listing bank QR image; required to publish paid listings when `payments=true` |
| 26 Checklist an toàn [9:210] | — (client state) | The declarations are sent with LIST-6 |
| 27 Xem trước tin đăng [9:254] | LIST-2 (owner view), LIST-6 | |
| 28 Đăng thành công [9:274] | LIST-6 response | |
| 29 Tin đang đăng & quản lý [10:2] | LIST-8, LIST-7 | "Tạm dừng" → withdraw (D§9 D6) |
| 30 Đơn đang chờ người nhận [10:43] | RES-5 | Polls 30 s |
| 30b Xác nhận / từ chối biên lai thanh toán (V2.1) | RES-5 (`status=AWAITING_SELLER_CONFIRM,RESERVED`), PAY-1, PAY-3, PAY-4 | Seller reviews buyer `proofImage`, confirms payment (`RESERVED` + buyer email) or rejects with reason (`CANCELLED` + stock released + buyer email) |
| 31 Quét QR và nhập mã [10:68] | RES-7, RES-8 | `amountToCollect = 0` when `payment.status === CONFIRMED` (or free), else `totalPrice` |
| 32 Giao hàng hoàn tất [10:88] | RES-8 response (`listingRemaining`) | |
| 33 Chỉnh sửa & tạm dừng tin [11:2] | LIST-2, LIST-4, LIST-7 | |
| 34 Thông báo [11:33] | — | **Later** (NOTI). Hide the entry point in the MVP. |
| 35 Trung tâm tài khoản [11:84] | ME-1, RES-2, LIST-8 | "Tin nhắn" and "Đã lưu" are Later |
| 36 Cài đặt & PWA [11:135] | ME-2, ME-3, AUTH-4 | The PWA install prompt is client-side. Push is Later. |
| 37 Không có món gần đây [11:186] | LIST-1 (empty) | |
| 38 Hết suất / quá hạn [11:201] | LIST-2, LIST-1 (suggestions) | |
| 39 Hủy đơn [11:220] | RES-3, RES-4 | Releases stock atomically; `PENDING_PAYMENT` / `AWAITING_SELLER_CONFIRM` marks payment `EXPIRED` |
| 40 Xác minh OTP [11:243] | AUTH-2, AUTH-1 (resend) | |
| (no frame) Admin | ADM-1..9 | Built from the V1 design system (frame `13:48`) |

## 18. Changelog

### v1.3 (2026-11-24): P2P Direct Bank QR + Transfer Proof + Resend Email payments

1. **P2P Direct QR model (no gateway / no platform fee in v1.3).** Automated gateway webhooks
   (SePay/PayOS), platform fees, seller payouts (`/me/payouts`, `/me/payout-account`), and admin
   refund/payout ledger (`/admin/payments*`, `/admin/payouts*`) are deferred to Later. In v1.3,
   `platformFee = 0`, `payableAmount = totalPrice`, and `amount = totalPrice`; buyers pay sellers
   directly via the seller's uploaded bank QR image. Feature flag `PAYMENTS_ENABLED` stays `false`
   until FE finishes wiring screens `25b`, `21`, `30b`, `06b`.
2. **Image purposes & seller bank QR (`bankQrImageId`).** Added `PAYMENT_QR` and `PAYMENT_PROOF`
   to `ImagePurpose` (`IMG-1`). Added optional `bank_qr_image_id` on `accounts` (`Me.seller.bankQrImage`,
   editable via `ME-2`) and `food_listings` (`bankQrImageId` on `LIST-3`/`LIST-4`, defaulting to
   `me.seller.bankQrImageId` and backfilling the account default if unset; exposed as `bankQrImage`
   on `ListingOwnerView`). Paid listings (`price > 0`) require a bank QR to publish when
   `PAYMENTS_ENABLED=true` (`ChecklistKey` `PAYMENT_QR`); free listings (`price === 0`) do not
   require one and skip `PENDING_PAYMENT` directly into `RESERVED` + `pickupToken`.
3. **Statuses, `Payment` object & shared queries.** Added `AWAITING_SELLER_CONFIRM` to
   `ReservationStatus`, `PAYMENT_REJECTED` to `CancelReason`, and redefined `PaymentStatus` as
   `UNPAID | PROOF_SUBMITTED | CONFIRMED | REJECTED | EXPIRED` and `Payment` for P2P QR + proof
   metadata (`sellerQrImage`, `proofImage`, `proofSubmittedAt`, `confirmedAt`, `rejectedAt`,
   `rejectReason`). Updated `RES-2` (`tab=upcoming` includes `PENDING_PAYMENT`,
   `AWAITING_SELLER_CONFIRM`, `RESERVED`), `RES-5` (`status` csv supports `PENDING_PAYMENT` and
   `AWAITING_SELLER_CONFIRM`), and `RES-7` (`amountToCollect = 0` when `payment.status === "CONFIRMED"`,
   else `totalPrice`).
4. **Lazy-expiry.** Auto-expires `PENDING_PAYMENT` where `payment_expires_at <= now` and releases
   stock atomically, but does **not** expire `AWAITING_SELLER_CONFIRM` on the hold timer (waits for
   seller confirm/reject or `JOB-2` after `pickup_end + NO_SHOW_GRACE_MIN`).
5. **P2P payment endpoints (`PAY-1..4`, §12) & Resend emails.** Replaced v1.2 gateway/payout
   endpoints with: `PAY-1` (`GET /reservations/{id}/payment` for BUYER/SELLER/ADMIN), `PAY-2`
   (`POST /reservations/{id}/payment-proof` by BUYER → `AWAITING_SELLER_CONFIRM` + seller email),
   `PAY-3` (`POST /reservations/{id}/payment/confirm` by SELLER → `RESERVED` + `pickupToken` +
   buyer email), and `PAY-4` (`POST /reservations/{id}/payment/reject` by SELLER → `CANCELLED` +
   `PAYMENT_REJECTED` + atomic stock release + buyer email). Total: **42 MVP endpoints** + 26 Later.
6. **Errors & V2.1 screen map.** Added `422 PROOF_REQUIRED` and `409 PAYMENT_NOT_CONFIRMABLE` to
   §16 (keeping `404 PAYMENT_NOT_FOUND` and `422 PAYMENT_HOLD_INVALID`). Mapped Figma V2.1 screens
   `25b`, `21`, `30b`, `06b` in §17.

### v1.2 (2026-11-24): Option C automated VietQR payments (SePay), buyer-paid platform fee and refund/payout ledger

1. **Provider & feature flag.** Added automated VietQR payment flow via SePay webhook
   (`PAYMENT_PROVIDER=sepay|mock`) behind `PAYMENTS_ENABLED` (default `false` in env/tests; `true`
   when enabled). The `Payment` response is provider-agnostic so PayOS or other gateways can plug
   in later without FE changes.
2. **Buyer-paid platform fee.** Free items (`totalPrice === 0`) incur `0` fee and skip
   `PENDING_PAYMENT`. Paid items (`PAYMENTS_ENABLED=true`) charge `5%` when `totalPrice > 20.000đ`
   or flat `2.000đ` when `≤ 20.000đ`. Buyer transfers `payableAmount = totalPrice + platformFee`;
   seller receives `sellerNet = totalPrice` upon `COMPLETED` handover.
3. **Hold duration & lazy-expiry.** `RES-1` accepts optional `holdMinutes` (≥ 5, default 10, must
   satisfy `now + holdMinutes <= listing.pickupEnd`, else `422 PAYMENT_HOLD_INVALID`). Stock is
   decremented atomically while `PENDING_PAYMENT`, and expired holds are swept atomically on reads,
   creates, and `JOB-2`.
4. **Endpoints promoted to MVP (§12).** Added `PAY-1` (`GET /reservations/{id}/payment`), `PAY-2`
   (`POST /webhooks/sepay`), `PAY-3` (`GET /me/payouts`), `PAY-4` (`PUT /me/payout-account`),
   `PAY-5` (`GET /admin/payments`, `POST /admin/payments/{id}/mark-refunded`,
   `POST /admin/payouts/{sellerId}/settle`), and `PAY-DEV`
   (`POST /reservations/{id}/payment/simulate`, mock provider only). Total: **46 MVP endpoints** +
   20 Later.
5. **Config, enums & errors.** Updated `SYS-2` (`GET /config`) with `limits.minPaymentHoldMin`,
   `limits.defaultPaymentHoldMin`, and `fees`. Added `PENDING_PAYMENT` to `ReservationStatus`,
   `PaymentStatus`, `PayoutStatus`, `PaymentProvider`, `Payment`, `PayoutAccount`, `PayoutItem`,
   and error codes `422 PAYMENT_HOLD_INVALID`, `404 PAYMENT_NOT_FOUND`, `409 PAYMENT_NOT_REFUNDABLE`.

### v1.1.1 (2026-11-24): add internal daily cron endpoint for serverless deployments

- Added **SYS-3 · `GET /internal/cron/daily`** (infra endpoint, role `CRON` via
  `Authorization: Bearer <CRON_SECRET>`) to trigger JOB-1..4 sequentially on serverless hosts such
  as Vercel.

### v1.1 (2026-11-23): adopt the competition dossier (spec v2) and rename the product to SaveMeal

1. **Name.** The product is SaveMeal (it was LASTBITE). The order code prefix is now `SM–`, and the
   QR prefix is `SM1.`
2. **Scope.** Every endpoint is tagged MVP or LATER (spec §2.3). That gives 38 MVP endpoints and
   25 Later ones (§10).
3. **Payments out of the MVP.** The buyer pays the seller offline. `PENDING_PAYMENT`,
   `paymentMode`, deposits, refunds, `REFUND_DUE`/`PAYMENT_*` notifications and PAY-1..5 moved to
   Later.
4. **Data model renamed to the spec's tables** (D§2): `accounts`, `food_listings`,
   `listing_images`, `reservations`, `pickup_tokens`, `reports`, `event_logs`, `feedback`,
   `transaction_metrics`. Batches became listings (`/listings`, LIST-*), incidents became reports
   (REP-*), and audit_logs became event_logs.
5. **Stores removed.** Seller info now lives on the account (`me.seller`), pickup location is per
   listing, and there is a public `GET /sellers/{id}`. STORE-1..9 and store members were dropped,
   and the store dashboard is Later.
6. **Safety and moderation.**
   - The required-info checklist (photo, name, price, portions, origin, prepared time, storage,
     pickup window, pickup location) plus 6 seller declarations are sent with publish. The
     `SAFETY_CHECKED` state was removed.
   - Admin verification is no longer required to publish; it gives a badge instead (pending user
     confirmation).
   - New: block listing, suspend account, and an `under_review` auto-hide on `UNSAFE_FOOD`
     reports. Allergens are optional and no longer a filter.
7. **Listing states** are now `DRAFT` → `PUBLISHED` → `EXPIRED` | `WITHDRAWN` | `BLOCKED`.
   Withdraw replaces cancel and remove-unsafe, and pause is Later.
8. **Reservation states** are now `RESERVED` → `COMPLETED` | `CANCELLED` | `EXPIRED`. `PICKED_UP`
   became `COMPLETED` ("Hoàn tất"), and `NO_SHOW` became `EXPIRED`. Seller confirmation is the QR
   handover (pending user confirmation).
9. **QR.** A random, time-limited (10 min), single-use `pickup_tokens` token replaces the HMAC
   4-digit `LB1:<id>:<code>` payload. RES-6 rotates it. The 4-digit code is only a manual
   fallback.
10. **Filters.** Price, food type, distance and pickup time (`pickupDay`, `pickupFrom`/`To`), and
    `sellerId`. `excludeAllergens` was removed. `config.map` was added (MapLibre and OSM).
11. **KPIs.** ADM-9 is redefined around spec §6.1: handed-over portions, completion rate,
    listing-expired rate, actual discount (only with a reference price), and reports (handling time
    and outcome). Waste logs are Later, and the baseline is collected outside the app.
12. **Notifications, chat, saved items, feedback, CSV export and Google login** moved to Later. The
    MVP polls the order screens instead.
13. **Demo slice** (D§10): 21 endpoints and 2 jobs to build first.

### v1.0.1: re-mapped the screens to Figma V1. v1.0: initial contract (73 endpoints).
