# API contract: LASTBITE `/api/v1`

> **Contract-first.** This file is fixed before code. Any change lands here first, in its own
> `docs(contract): …` commit, before code on either side. Entities, states and guards are defined in
> [`DOMAIN.md`](DOMAIN.md). Section numbers like "D§3" refer to that file.

Version: **v1.0.1** (2026-11-23; v1.0.1 re-maps screens to Figma V1, no API change) · **73 endpoints** · 6 scheduled jobs (D§7)

---

## 0. Conventions

### Transport

- The base URL is `/api/v1`. The web app reaches it same-origin through a Next.js rewrite, and the
  API listens on `:4000`.
- Bodies are JSON (`Content-Type: application/json; charset=utf-8`). Image upload is the one
  exception and uses `multipart/form-data`.
- Fields are `camelCase`. Enums are `UPPER_SNAKE` strings. IDs are UUID strings.
- **Money** is an integer VND amount (`18000`). **Times** are ISO 8601 with an offset
  (`2026-11-23T17:30:00+07:00`), and the API returns them in `+07:00`. A **date** is `YYYY-MM-DD` in
  local time (Asia/Ho_Chi_Minh).
- Coordinates are `lat` and `lng` as decimal degrees (WGS84).
- Optional fields that have no value are returned as `null`, not omitted.

### Envelope

```jsonc
// single resource
{ "data": { ... } }
// list
{ "data": [ ... ], "page": { "nextCursor": "opaque-string-or-null", "limit": 20 } }
// 204 No Content has no body
```

### Pagination

These are cursor-based list query parameters:

- `cursor` is an opaque string taken from `page.nextCursor`.
- `limit` defaults to 20 and has a maximum of 50.

The end of the list is signalled by `nextCursor: null`.

### Errors

```json
{
  "error": {
    "code": "BATCH_SOLD_OUT",
    "message": "Món này vừa hết suất.",
    "details": { "quantityAvailable": 0 },
    "requestId": "req_01H…"
  }
}
```

- `code` is stable and machine-readable (catalogue in §15).
- `message` is safe to show to users, in Vietnamese. The FE may map `code` to its own copy.
- `details` is optional. `VALIDATION_FAILED` uses `details.fields: { [path]: reason }`.
- Every response carries an `X-Request-Id` header.

### Auth

- **Phone or email OTP, then JWT.**
- The access token is a JWT (HS256, 15 min). It is sent as `Authorization: Bearer <token>`. Its
  claims are `sub` (userId), `role` (`USER|ADMIN`) and `sid` (refresh family).
- The refresh token is opaque, valid for 30 days and rotated on every use. It is delivered **only**
  as the cookie `lb_rt`, which is `HttpOnly; Secure; SameSite=Lax; Path=/api/v1/auth`. It is stored
  hashed. If a rotated (old) token is reused, the whole family is revoked.
- Store membership is not in the JWT. It is checked per request against `store_members`.

### Roles used below

| Role | Meaning |
|---|---|
| `PUBLIC` | No token needed (a token is accepted and enriches the response, e.g. `isSaved`) |
| `USER` | Any signed-in, non-suspended account |
| `MEMBER` | A `USER` who is OWNER or STAFF of the `{storeId}`, or of the batch's or reservation's store |
| `OWNER` | A `USER` who is OWNER of the `{storeId}` |
| `BUYER` | The `USER` who made the `{reservationId}` |
| `ADMIN` | `role = ADMIN` |

### Common headers

- `Idempotency-Key` (UUID) is **required** on `POST /reservations` and optional on other `POST`
  requests. The same key with the same body within 24 h replays the first response. The same key
  with a different body returns `422 IDEMPOTENCY_KEY_REUSED`.
- `Accept-Language` is ignored. Messages are always Vietnamese.

### Rate limits (429 `RATE_LIMITED`, with a `Retry-After` header)

| Endpoint | Limits |
|---|---|
| OTP request | 1 per 60 s per identifier, 5 per hour per identifier, 20 per hour per IP |
| OTP verify | 5 attempts per request |
| Pickup lookup/confirm | 10 per minute per store member |
| Chat | 20 messages per minute per user |
| Default | 120 per minute per user |

---

## 1. Shared objects

```ts
type Image = { id: string; url: string; width: number; height: number };

type Me = {
  id: string; displayName: string | null; phone: string | null; email: string | null;
  avatar: Image | null; role: "USER" | "ADMIN"; status: "ACTIVE" | "SUSPENDED";
  notificationPrefs: { push: boolean; pickupReminders: boolean; chat: boolean; listingUpdates: boolean };
  stores: { id: string; name: string; role: "OWNER" | "STAFF"; verificationStatus: StoreVerification }[];
  stats: { portionsRescued: number; reservationsActive: number; listingsActive: number }; // V1/35 "Hoạt động của bạn"
  createdAt: string;
};

type StoreVerification = "PENDING" | "VERIFIED" | "REJECTED" | "SUSPENDED";
type StoreType = "CAFE" | "BAKERY" | "CANTEEN" | "RESTAURANT" | "INDIVIDUAL";

type StoreSummary = { id: string; name: string; type: StoreType; area: string; lat: number; lng: number;
  verified: boolean; ratingAvg: number | null; ratingCount: number };

type StoreProfile = StoreSummary & {             // public (V1/16)
  description: string | null; address: string; pickupInstructions: string | null; cover: Image | null;
  activeBatchCount: number; createdAt: string };

type StoreOwnerView = StoreProfile & {           // OWNER / MEMBER / ADMIN
  verificationStatus: StoreVerification; verificationNote: string | null;
  contactPhone: string | null; myRole: "OWNER" | "STAFF" | null;
  payoutAccount: { bankBin: string; accountNumberMasked: string; accountName: string } | null };

type Category = "BAKERY" | "SAVORY" | "DRINK" | "PACKAGED" | "OTHER";
type Allergen = "GLUTEN" | "MILK" | "EGG" | "PEANUT" | "TREE_NUT" | "SOY" | "FISH" | "SHELLFISH" | "SESAME";
type Storage = "ROOM_TEMP" | "CHILLED";
type BatchStatus = "DRAFT" | "SAFETY_CHECKED" | "PUBLISHED" | "EXPIRED" | "CANCELLED" | "REMOVED_UNSAFE";

type BatchCard = {                                // list, search, store profile
  id: string; title: string; category: Category; image: Image | null;
  originalPrice: number; rescuePrice: number; isFree: boolean;
  quantityAvailable: number; soldOut: boolean;
  pickupStart: string; pickupEnd: string; allergens: Allergen[];
  distanceMeters: number | null; store: StoreSummary; isSaved: boolean };

type MapPin = { id: string; lat: number; lng: number; title: string;
  rescuePrice: number; isFree: boolean; quantityAvailable: number; category: Category };

type BatchDetail = BatchCard & {                  // V1/04
  description: string | null; images: Image[]; ingredients: string | null; storage: Storage;
  preparedAt: string; bestBefore: string; status: BatchStatus; isPaused: boolean;
  safetyConfirmedAt: string | null;               // copy: "Người bán đã xác nhận checklist", never "an toàn"
  store: StoreProfile; myActiveReservationId: string | null };

type BatchSellerView = BatchDetail & {            // MEMBER / ADMIN
  quantityTotal: number; reservedCount: number; pickedUpCount: number; noShowCount: number;
  pauseReason: "SELLER" | "INCIDENT" | null; closeReason: string | null;
  safetyCheck: SafetyCheck | null; editableFields: string[]; createdAt: string; publishedAt: string | null };

type SafetyItemKey = "NOT_EXPIRED" | "STORED_PROPERLY" | "NO_SPOILAGE" | "NOT_CUSTOMER_LEFTOVERS"
  | "ALLERGENS_DECLARED" | "PICKUP_WINDOW_SAFE";
type SystemCheckKey = "STORE_VERIFIED" | "CATEGORY_ALLOWED" | "NOT_EXPIRED_AT_PICKUP"
  | "WINDOW_WITHIN_LIMIT" | "ALLERGENS_PRESENT" | "EVIDENCE_RECORDED";
type SafetyCheck = { id: string; items: Record<SafetyItemKey, boolean>;
  systemChecks: Record<SystemCheckKey, boolean>; note: string | null; evidence: Image[];
  checkedBy: { id: string; displayName: string }; checkedAt: string; stale: boolean };

type ReservationStatus = "PENDING_PAYMENT" | "RESERVED" | "PICKED_UP" | "CANCELLED" | "NO_SHOW" | "EXPIRED";
type CancelReason = "BUYER_LATE" | "BUYER_WRONG_QTY" | "BUYER_CHANGED_PLAN" | "BUYER_OTHER"
  | "SELLER_CANCELLED" | "BATCH_REMOVED_UNSAFE" | "ADMIN";

type Reservation = {
  id: string; code: string /* "LB–4281" */; status: ReservationStatus;
  quantity: number; unitPrice: number; totalPrice: number;
  paymentMode: "AT_COUNTER" | "DEPOSIT" | "FULL"; payment: Payment | null;
  batch: { id: string; title: string; image: Image | null; pickupStart: string; pickupEnd: string; status: BatchStatus };
  store: { id: string; name: string; address: string; lat: number; lng: number; pickupInstructions: string | null };
  pickup: { code: string; qrPayload: string } | null;   // BUYER only, only while RESERVED
  buyer: { displayName: string } | null;                 // MEMBER / ADMIN only. Never phone or email.
  cancelReason: CancelReason | null; cancelNote: string | null;
  createdAt: string; reservedAt: string | null; pickedUpAt: string | null; closedAt: string | null;
  canCancel: boolean; canReview: boolean; canReportIncident: boolean;
  chat: { open: boolean; unreadCount: number } };

type Payment = { id: string; type: "DEPOSIT" | "FULL"; method: "BANK_TRANSFER" | "VIETQR";
  amount: number; remainingAtCounter: number; transferContent: string /* "LB 4281" */;
  vietQr: { payload: string; bankBin: string; accountNumber: string; accountName: string } | null;
  status: "PENDING" | "SENT" | "CONFIRMED" | "REFUND_DUE" | "REFUNDED" | "FORFEITED" | "EXPIRED";
  holdExpiresAt: string | null };

type Notification = { id: string; type: NotificationType; title: string; body: string;
  data: { reservationId?: string; batchId?: string; storeId?: string; incidentId?: string };
  readAt: string | null; createdAt: string };
type NotificationType = "RESERVATION_CREATED" | "RESERVATION_CANCELLED" | "PICKUP_REMINDER" | "PICKED_UP"
  | "NO_SHOW" | "BATCH_ENDING" | "BATCH_EXPIRED_LOG_WASTE" | "BATCH_REMOVED" | "PAYMENT_SENT"
  | "PAYMENT_CONFIRMED" | "REFUND_DUE" | "NEW_MESSAGE" | "STORE_VERIFIED" | "STORE_REJECTED"
  | "STORE_SUSPENDED" | "INCIDENT_REPORTED" | "INCIDENT_UPDATED";

type ChatMessage = { id: string; senderSide: "BUYER" | "STORE"; senderName: string; body: string;
  createdAt: string; mine: boolean };
type Review = { id: string; rating: 1 | 2 | 3 | 4 | 5; comment: string | null; authorName: string; createdAt: string };
type IncidentType = "WRONG_INFO" | "UNSAFE_FOOD" | "NOT_RECEIVED" | "SELLER_ABSENT" | "OTHER";
type Incident = { id: string; type: IncidentType; description: string; images: Image[];
  status: "OPEN" | "INVESTIGATING" | "RESOLVED" | "DISMISSED"; resolution: string | null;
  storeId: string; batchId: string | null; reservationId: string | null; createdAt: string;
  reporter: { displayName: string } | null };  // only for ADMIN
type WasteLog = { id: string; date: string; batchId: string | null; category: Category;
  eligibleSurplus: number; listed: number; pickedUp: number; discarded: number;
  discardedWeightGrams: number | null; reason: string | null; createdAt: string };
```

The batch write fields (`BatchInput`) are used by BATCH-3 and BATCH-4:

```ts
type BatchInput = {
  storeId: string;                 // create only
  title: string;                   // 3–80 chars
  description?: string | null;     // ≤ 500
  category: Category; imageIds?: string[];  // ≤ 4, purpose BATCH
  allergens: Allergen[]; ingredients?: string | null;   // ≤ 300
  storage: Storage;
  preparedAt: string; bestBefore: string;
  quantityTotal: number;           // 1–50
  originalPrice: number;           // ≥ 0
  rescuePrice: number;             // 0 ≤ rescuePrice ≤ originalPrice; 0 = free
  pickupStart: string; pickupEnd: string;  // pickupStart < pickupEnd, pickupEnd > now
};
```

---

## 2. System

### SYS-1 · `GET /health`

- **Role**: PUBLIC
- **200**: `{ "data": { "status": "ok", "db": "ok", "version": "1.0.0" } }`

### SYS-2 · `GET /config`

- **Role**: PUBLIC
- **200**:

```json
{ "data": {
  "features": { "payments": false, "googleLogin": false },
  "enums": { "categories": ["BAKERY","SAVORY","DRINK","PACKAGED","OTHER"], "allergens": ["GLUTEN","…"],
             "storage": ["ROOM_TEMP","CHILLED"], "storeTypes": ["CAFE","…"], "incidentTypes": ["…"],
             "cancelReasons": ["BUYER_LATE","BUYER_WRONG_QTY","BUYER_CHANGED_PLAN","BUYER_OTHER"] },
  "limits": { "maxQtyPerReservation": 2, "maxActiveReservations": 3, "radiusKmOptions": [1,3,5],
              "maxRadiusKm": 10, "depositAmount": 5000, "freeCancelBeforeMin": 30, "maxImagesPerBatch": 4 },
  "defaultCenter": { "lat": 16.0544, "lng": 108.2022, "label": "Đà Nẵng" },
  "popularSearches": ["Bánh mì","Cơm trưa","Bánh ngọt","Đồ uống"],
  "vapidPublicKey": "B…"
} }
```

---

## 3. Auth

### AUTH-1 · `POST /auth/otp/request`

- **Role**: PUBLIC
- **Request**: `{ "channel": "SMS" | "EMAIL", "identifier": "+84901234567" | "a@b.vn" }`. A phone
  number is normalised to E.164; a VN local `09…` becomes `+849…`.
- **200**: `{ "data": { "requestId": "uuid", "expiresAt": "…", "resendAfterSec": 60, "codeLength": 6 } }`
- **Errors**: `400 VALIDATION_FAILED`, `429 RATE_LIMITED`, `403 ACCOUNT_SUSPENDED`
- **Notes**: The response is the same whether or not an account exists (no enumeration). In dev,
  `OTP_PROVIDER=console` logs the code, and production refuses to boot with that provider.

### AUTH-2 · `POST /auth/otp/verify`

- **Role**: PUBLIC
- **Request**: `{ "requestId": "uuid", "code": "428153" }`
- **200**: `{ "data": { "accessToken": "jwt", "accessTokenExpiresAt": "…", "isNewUser": true, "user": Me } }`,
  plus `Set-Cookie: lb_rt=…`
- **Errors**: `400 OTP_INVALID` (`details.attemptsLeft`), `400 OTP_EXPIRED`,
  `429 OTP_TOO_MANY_ATTEMPTS`, `403 ACCOUNT_SUSPENDED`
- **State**: This creates the user on first verify (`status ACTIVE`). If `isNewUser` is `true`, the
  FE asks for `displayName` (ME-2).

### AUTH-3 · `POST /auth/refresh`

- **Role**: PUBLIC (cookie `lb_rt`)
- **Request**: an empty body
- **200**: `{ "data": { "accessToken": "jwt", "accessTokenExpiresAt": "…" } }`, plus a rotated
  `Set-Cookie: lb_rt`
- **Errors**: `401 REFRESH_INVALID` (missing, expired, revoked or reused; reuse also revokes the
  family), `403 ACCOUNT_SUSPENDED`

### AUTH-4 · `POST /auth/logout`

- **Role**: PUBLIC (cookie `lb_rt`)
- **Request**: `{ "allDevices"?: boolean }`. `allDevices` needs a Bearer token.
- **204**: It revokes the refresh family and clears the cookie. It is idempotent.

### AUTH-5 · `POST /auth/google` (behind the flag `GOOGLE_LOGIN_ENABLED`)

- **Role**: PUBLIC
- **Request**: `{ "idToken": "google-id-token" }`
- **200**: Same as AUTH-2.
- **Errors**: `403 FEATURE_DISABLED`, `401 GOOGLE_TOKEN_INVALID`, `403 ACCOUNT_SUSPENDED`

---

## 4. Me (account)

### ME-1 · `GET /me`

- **Role**: USER
- **200**: `{ "data": Me }`

### ME-2 · `PATCH /me`

- **Role**: USER
- **Request** (all fields optional):
  `{ "displayName": "2–40 chars", "avatarImageId": "uuid|null", "notificationPrefs": { "push": true, … } }`
- **200**: `{ "data": Me }`
- **Errors**: `400 VALIDATION_FAILED`, `404 IMAGE_NOT_FOUND`
- **Notes**: Phone and email cannot be changed in v1. To change them, the user deletes the account
  and re-registers.

### ME-3 · `DELETE /me`

- **Role**: USER
- **Request**: `{ "confirm": "XOA TAI KHOAN" }`
- **204**: The account is soft-deleted, and personal data is anonymised: phone, email and avatar are
  set to null, and the name becomes "Người dùng đã xóa". It revokes all tokens and removes push
  subscriptions, saved items and staff memberships. An owned store with no other members is set to
  `SUSPENDED` with the note "owner deleted account". Anonymised reservations, waste logs and
  incidents are kept for research.
- **Errors**: `409 ACCOUNT_HAS_ACTIVE_ITEMS`, with
  `details: { activeReservations, activeListings, storeHasOtherMembers }`. The user must cancel or
  finish them first.

---

## 5. Stores (seller profile)

### STORE-1 · `POST /stores`

- **Role**: USER (one owned store per user)
- **Request**:

```json
{ "name": "Tiệm bánh Mây", "type": "BAKERY", "description": null,
  "address": "12 Ngô Thì Sĩ, Mỹ An, Ngũ Hành Sơn", "area": "Mỹ An, Đà Nẵng",
  "lat": 16.0478, "lng": 108.2431, "pickupInstructions": "Lấy tại quầy thu ngân",
  "contactPhone": "+84…", "coverImageId": null }
```

- **201**: `{ "data": StoreOwnerView }` with `verificationStatus: PENDING`
- **Errors**: `400 VALIDATION_FAILED`, `409 STORE_ALREADY_EXISTS`
- **State**: — → `PENDING`. This notifies admins.

### STORE-2 · `GET /stores/mine`

- **Role**: USER
- **200**: `{ "data": StoreOwnerView[] }`, listing the stores where the user is OWNER or STAFF (empty
  if none)

### STORE-3 · `GET /stores/{storeId}`

- **Role**: PUBLIC. MEMBER or ADMIN get `StoreOwnerView`.
- **200**: `{ "data": StoreProfile }`. Stores that are not `VERIFIED` return 404 to the public.
- **Errors**: `404 STORE_NOT_FOUND`

### STORE-4 · `PATCH /stores/{storeId}`

- **Role**: OWNER
- **Request**: any STORE-1 field
- **200**: `{ "data": StoreOwnerView }`
- **Errors**: `400 VALIDATION_FAILED`, `403 FORBIDDEN`, `403 STORE_SUSPENDED`
- **State**: Changing `name`, `type`, `address`, `lat` or `lng` on a `VERIFIED` store sets it back to
  `PENDING` (re-verification). It notifies admins. Published batches stay live, but no new publish is
  allowed until the store is re-verified.

### STORE-5 · `GET /stores/{storeId}/batches`

- **Role**: PUBLIC sees `PUBLISHED`, unpaused, `BatchCard[]` only. MEMBER sees everything as
  `BatchSellerView[]` (V1/29).
- **Query**: `tab=active|done` (MEMBER only; `active` = DRAFT, SAFETY_CHECKED and PUBLISHED;
  `done` = terminal), `cursor`, `limit`
- **200**: a list

### STORE-6 · `GET /stores/{storeId}/reviews`

- **Role**: PUBLIC
- **Query**: `cursor`, `limit`
- **200**: `{ "data": Review[], "page": … }`. `authorName` is the first name only (privacy).

### STORE-7 · `GET /stores/{storeId}/members`

- **Role**: OWNER
- **200**: `{ "data": [{ "userId", "displayName", "role", "createdAt" }] }`. Phone and email are not
  included.

### STORE-8 · `POST /stores/{storeId}/members`

- **Role**: OWNER
- **Request**: `{ "identifier": "+849… | email" }`. The person must already have an account.
- **201**: `{ "data": { "userId", "displayName", "role": "STAFF", "createdAt" } }`
- **Errors**: `404 MEMBER_USER_NOT_FOUND`, `409 MEMBER_ALREADY_EXISTS`, `422 MEMBER_LIMIT` (5 staff)

### STORE-9 · `DELETE /stores/{storeId}/members/{userId}`

- **Role**: OWNER, or the member removing themselves
- **204**
- **Errors**: `409 CANNOT_REMOVE_OWNER`

---

## 6. Images

### IMG-1 · `POST /images`

- **Role**: USER
- **Request**: `multipart/form-data` with `file` (jpeg, png or webp, ≤ 5 MB) and
  `purpose=BATCH|STORE|INCIDENT|AVATAR|SAFETY_EVIDENCE`
- **201**: `{ "data": Image }`. The server re-encodes the image to webp (max 1600 px) and **strips
  EXIF/GPS**. An image that is not attached within 24 h is purged (JOB-6).
- **Errors**: `413 IMAGE_TOO_LARGE`, `415 IMAGE_TYPE_UNSUPPORTED`, `400 VALIDATION_FAILED`

### IMG-2 · `DELETE /images/{imageId}`

- **Role**: the image owner
- **204**
- **Errors**: `404 IMAGE_NOT_FOUND`, `409 IMAGE_IN_USE` (attached to a published batch or an
  incident)

---

## 7. Batches (surplus listings)

### BATCH-1 · `GET /batches`: search, list and map

- **Role**: PUBLIC. It returns only `PUBLISHED`, unpaused batches from `VERIFIED` stores whose
  `pickupEnd` is in the future.
- **Query**:

| Param | Type | Default | Notes |
|---|---|---|---|
| `lat`, `lng` | number | `config.defaultCenter` | Not stored and not logged at full precision |
| `radiusKm` | number | 3 | 0.5–10 (V1/12: 1, 3, 5) |
| `q` | string | — | Text search on title and store name (V1/03) |
| `category` | csv `Category` | all | V1/12 "Loại món" |
| `priceMax` | int VND | — | "Dưới 20k" means `priceMax=20000` |
| `free` | boolean | — | `true` means `rescuePrice = 0` (V1/14) |
| `excludeAllergens` | csv `Allergen` | — | Hides batches that declare any of these |
| `pickupDay` | `today\|tomorrow` | — | V1/12 "Thời gian lấy" |
| `includeSoldOut` | boolean | false | `true` keeps cards with `soldOut` |
| `sort` | `distance\|pickupSoon\|priceAsc\|newest` | `distance` | |
| `view` | `list\|map` | `list` | `map` returns `MapPin[]` (≤ 200, no cursor) |
| `cursor`, `limit` | | | `list` only |

- **200**: `{ "data": BatchCard[] | MapPin[], "page": … }`. An empty array drives V1/37.
- **Errors**: `400 VALIDATION_FAILED`

### BATCH-2 · `GET /batches/{batchId}`

- **Role**: PUBLIC for `PUBLISHED` batches, including sold-out and paused ones. A paused batch shows
  `isPaused`. MEMBER or ADMIN get `BatchSellerView` for any status.
- **200**: `{ "data": BatchDetail | BatchSellerView }`
- **Errors**: `404 BATCH_NOT_FOUND`. A non-member asking for a non-public status also gets 404.
- **Notes**: Terminal batches still return to the public (status shown) if the caller has a
  reservation on them.

### BATCH-3 · `POST /batches`: create a draft

- **Role**: MEMBER of `storeId`
- **Request**: `BatchInput`. Partial data is allowed for a draft: `storeId`, `title` and `category`
  are required, and the other fields can be filled later. An optional
  `productId` reuses a product template. Otherwise, the product is upserted by `(storeId, title)`.
- **201**: `{ "data": BatchSellerView }` with `status: DRAFT`
- **Errors**: `400 VALIDATION_FAILED`, `403 FORBIDDEN`, `403 STORE_SUSPENDED`, `409 STORE_REJECTED`
- **Transition**: — → `DRAFT`

### BATCH-4 · `PATCH /batches/{batchId}`

- **Role**: MEMBER
- **Request**: any subset of `BatchInput` (except `storeId`)
- **200**: `{ "data": BatchSellerView }`
- **Errors**: `400 VALIDATION_FAILED`, `409 FIELD_LOCKED` (`details.fields`), `409 QUANTITY_BELOW_RESERVED`,
  `409 PRICE_INCREASE_NOT_ALLOWED`, `409 PICKUP_WINDOW_EXTENSION_NOT_ALLOWED`, `409 INVALID_STATE_TRANSITION` (terminal)
- **Transition**: On `SAFETY_CHECKED`, a change to a safety-relevant field (category, allergens,
  ingredients, storage, preparedAt, bestBefore, pickupStart or pickupEnd) sends the batch
  back to `DRAFT`. On `PUBLISHED`, only the D§3 editable fields can change, and the status does not
  change. Increasing `quantityTotal` also raises `quantityAvailable` by the same amount atomically.

### BATCH-5 · `DELETE /batches/{batchId}`

- **Role**: MEMBER
- **204**: `DRAFT` only (hard delete)
- **Errors**: `409 INVALID_STATE_TRANSITION`

### BATCH-6 · `POST /batches/{batchId}/safety-check`

- **Role**: MEMBER
- **Request**:

```json
{ "items": { "NOT_EXPIRED": true, "STORED_PROPERLY": true, "NO_SPOILAGE": true,
             "NOT_CUSTOMER_LEFTOVERS": true, "ALLERGENS_DECLARED": true, "PICKUP_WINDOW_SAFE": true },
  "note": "Nhiệt độ tủ 4°C", "evidenceImageIds": [] }
```

- **200**: `{ "data": BatchSellerView }` with `status: SAFETY_CHECKED` and `safetyCheck` set
- **Errors**: `422 SAFETY_CHECK_FAILED`, with `details: { "failedItems": SafetyItemKey[], "failedSystemChecks": SystemCheckKey[] }`.
  Any `false` item or failed system check fails the request (`STORE_VERIFIED` is evaluated at
  publish only). `422 BATCH_INCOMPLETE` (`details.fields`, the required fields still missing).
  `409 INVALID_STATE_TRANSITION`.
- **Transition**: `DRAFT` → `SAFETY_CHECKED`. It writes an immutable `safety_checks` row (D§5). A
  failed attempt is audit-logged and counted for KPI 7.

### BATCH-7 · `GET /batches/{batchId}/safety-check`

- **Role**: MEMBER or ADMIN
- **200**: `{ "data": SafetyCheck[] }`, the history, newest first
- **Errors**: `404 BATCH_NOT_FOUND`

### BATCH-8 · `POST /batches/{batchId}/publish`

- **Role**: MEMBER
- **Request**: an empty body
- **200**: `{ "data": BatchSellerView }` with `status: PUBLISHED` (V1/28)
- **Errors**: `409 STORE_NOT_VERIFIED`, `409 SAFETY_CHECK_STALE` (older than
  `SAFETY_CHECK_TTL_MIN`; re-run BATCH-6), `422 SAFETY_CHECK_FAILED` (the system checks are re-run),
  `409 INVALID_STATE_TRANSITION`, `422 PICKUP_WINDOW_INVALID` (`pickupEnd` has passed)
- **Transition**: `SAFETY_CHECKED` → `PUBLISHED`. It sets `quantityAvailable = quantityTotal` and
  `publishedAt`, and audit-logs the time-to-publish (KPI 4).

### BATCH-9 · `POST /batches/{batchId}/pause`

- **Role**: MEMBER
- **Request**: an empty body
- **200**: `{ "data": BatchSellerView }` with `isPaused: true` and `pauseReason: SELLER`
- **Errors**: `409 INVALID_STATE_TRANSITION` (the batch is not `PUBLISHED`)
- **Transition**: none (sets the pause flag). It is hidden from BATCH-1 and blocks new reservations.
  Existing reservations are kept.

### BATCH-10 · `POST /batches/{batchId}/resume`

- **Role**: MEMBER. ADMIN only when `pauseReason = INCIDENT`; see ADM-8.
- **200**: `{ "data": BatchSellerView }`
- **Errors**: `409 PAUSED_BY_INCIDENT`, `422 PICKUP_WINDOW_INVALID`, `409 INVALID_STATE_TRANSITION`

### BATCH-11 · `POST /batches/{batchId}/cancel`

- **Role**: MEMBER
- **Request**: `{ "reason": "optional text ≤ 200" }`
- **200**: `{ "data": BatchSellerView }` with `status: CANCELLED`
- **Errors**: `409 INVALID_STATE_TRANSITION` (terminal)
- **Transition**: `DRAFT|SAFETY_CHECKED|PUBLISHED` → `CANCELLED`. Active reservations become
  `CANCELLED` (`SELLER_CANCELLED`). It sends `RESERVATION_CANCELLED` to buyers and sets
  `REFUND_DUE` on any payments.

### BATCH-12 · `POST /batches/{batchId}/remove-unsafe`

- **Role**: MEMBER or ADMIN
- **Request**: `{ "reason": "required, 5–300 chars", "incidentId": "uuid|null" }`
- **200**: `{ "data": BatchSellerView }` with `status: REMOVED_UNSAFE`
- **Errors**: `400 VALIDATION_FAILED`, `409 INVALID_STATE_TRANSITION`
- **Transition**: `SAFETY_CHECKED|PUBLISHED` → `REMOVED_UNSAFE`. Active reservations become
  `CANCELLED` (`BATCH_REMOVED_UNSAFE`). It sends `BATCH_REMOVED` to buyers, sets `REFUND_DUE`, and
  counts the batch in KPI 7. The batch can never be republished.

---

## 8. Reservations and pickup

### RES-1 · `POST /reservations`: reserve atomically

- **Role**: USER. The header `Idempotency-Key` is required.
- **Request**: `{ "batchId": "uuid", "quantity": 1, "paymentMode": "AT_COUNTER" | "DEPOSIT" | "FULL", "paymentMethod": "BANK_TRANSFER" | "VIETQR" | null }`.
  With the payment flag off, only `AT_COUNTER` is accepted. Free items always use `AT_COUNTER`.
- **201**: `{ "data": Reservation }` with `status: RESERVED`, or `PENDING_PAYMENT` when it is
  prepaid and the flag is on (`payment.holdExpiresAt` is set).
- **Errors**:
  - `409 BATCH_SOLD_OUT` (`details.quantityAvailable`; V1/38)
  - `409 BATCH_NOT_AVAILABLE` (not published, paused or the window has ended)
  - `422 QUANTITY_LIMIT_EXCEEDED`
  - `409 ACTIVE_RESERVATION_LIMIT`
  - `409 ALREADY_RESERVED` (`details.reservationId`)
  - `403 OWN_STORE_RESERVATION`
  - `403 FEATURE_DISABLED` (a prepaid mode while the flag is off)
  - `422 IDEMPOTENCY_KEY_REUSED`
  - `403 ACCOUNT_SUSPENDED`
- **Transition**: — → `RESERVED` | `PENDING_PAYMENT`. `quantityAvailable −= quantity` in **one
  conditional UPDATE inside a transaction** (D§6). It sends `RESERVATION_CREATED` to the store.

### RES-2 · `GET /reservations/mine`

- **Role**: USER
- **Query**: `tab=upcoming|history` (`upcoming` = `PENDING_PAYMENT|RESERVED`, sorted by pickupStart
  ascending; `history` = terminal, newest first), `cursor`, `limit`
- **200**: `{ "data": Reservation[], "page": … }` (V1/17)

### RES-3 · `GET /reservations/{reservationId}`

- **Role**: BUYER, MEMBER of its store, or ADMIN. `pickup` is returned only to the BUYER, and
  `buyer` only to MEMBER or ADMIN.
- **200**: `{ "data": Reservation }` (V1/06, V1/18, V1/22)
- **Errors**: `404 RESERVATION_NOT_FOUND` (also returned when the caller is not allowed)

### RES-4 · `POST /reservations/{reservationId}/cancel`

- **Role**: BUYER
- **Request**: `{ "reason": "BUYER_LATE" | "BUYER_WRONG_QTY" | "BUYER_CHANGED_PLAN" | "BUYER_OTHER", "note": "≤ 200|null" }`
- **200**: `{ "data": Reservation }` with `status: CANCELLED`. When a payment exists,
  `payment.status` becomes `REFUND_DUE` or `FORFEITED` (D§8; V1/39 shows which before the user
  confirms, using `GET` + `config.limits.freeCancelBeforeMin`).
- **Errors**: `409 RESERVATION_NOT_ACTIVE`, `409 CANCEL_WINDOW_CLOSED` (`now ≥ pickupEnd`)
- **Transition**: `PENDING_PAYMENT|RESERVED` → `CANCELLED`. The stock is released atomically if the
  batch is still `PUBLISHED`. It sends `RESERVATION_CANCELLED` to the store.

### RES-5 · `GET /stores/{storeId}/reservations`: the seller's pending list

- **Role**: MEMBER
- **Query**: `status` (csv, default `PENDING_PAYMENT,RESERVED`), `date` (`YYYY-MM-DD`, default today),
  `batchId`, `cursor`, `limit`
- **200**: `{ "data": Reservation[], "page": … }`, sorted by `pickupStart` ascending (V1/30)

### RES-6 · `POST /stores/{storeId}/pickups/lookup`

- **Role**: MEMBER
- **Request**: `{ "qrPayload": "LB1:<reservationId>:<code>" }` **or** `{ "code": "4281" }`. `LB–`,
  dashes and spaces are accepted and stripped.
- **200**: `{ "data": { "reservation": Reservation, "canConfirm": true, "blockingReason": null } }`.
  This does **not** change state. `blockingReason` is one of `TOO_EARLY`, `WINDOW_CLOSED`,
  `PENDING_PAYMENT`, `NOT_ACTIVE` or `BATCH_REMOVED_UNSAFE`.
- **Errors**: `422 PICKUP_CODE_INVALID` (unknown code, or a QR for another store), `429 RATE_LIMITED`

### RES-7 · `POST /stores/{storeId}/pickups/confirm`

- **Role**: MEMBER
- **Request**: `{ "reservationId": "uuid", "qrPayload": "…" }` **or**
  `{ "reservationId": "uuid", "code": "4281" }`. The code must match again.
- **200**: `{ "data": { "reservation": Reservation, "batchRemaining": 1 } }` (V1/32 "Còn lại 1 suất")
- **Errors**:
  - `422 PICKUP_CODE_INVALID`
  - `409 RESERVATION_NOT_ACTIVE`
  - `409 PICKUP_TOO_EARLY`
  - `409 PICKUP_WINDOW_CLOSED`
  - `409 PAYMENT_PENDING`
  - `409 BATCH_REMOVED_UNSAFE`
- **Transition**: `RESERVED` → `PICKED_UP`. It writes a `pickup_event` (method `QR` or `SHORT_CODE`)
  and sends `PICKED_UP` to the buyer. **This confirms pickup only. It is not a safety
  certification.**

### RES-8 · `POST /reservations/{reservationId}/no-show`

- **Role**: MEMBER
- **Request**: an empty body
- **200**: `{ "data": Reservation }` with `status: NO_SHOW`
- **Errors**: `409 NO_SHOW_TOO_EARLY` (`now < pickupEnd`), `409 RESERVATION_NOT_ACTIVE`
- **Transition**: `RESERVED` → `NO_SHOW` (JOB-2 does the same automatically after the grace period).
  A deposit becomes `FORFEITED`, and the buyer gets `NO_SHOW`.

### Jobs (no HTTP endpoint)

JOB-1 to JOB-6 are listed in D§7. They change state in the same way as the endpoints above and send
the same notifications.

---

## 9. Payments (all endpoints are behind `PAYMENTS_ENABLED`; when it is off they return `403 FEATURE_DISABLED`)

### PAY-1 · `GET /reservations/{reservationId}/payment`

- **Role**: BUYER or MEMBER
- **200**: `{ "data": Payment }`. `vietQr` is returned to the BUYER only (V1/21).
- **Errors**: `404 PAYMENT_NOT_FOUND`

### PAY-2 · `POST /reservations/{reservationId}/payment/mark-sent`

- **Role**: BUYER
- **200**: `{ "data": Payment }` with `status: SENT`, and the store gets `PAYMENT_SENT`. The hold
  timer is extended once by `PAYMENT_HOLD_MIN`.
- **Errors**: `409 PAYMENT_NOT_PENDING`

### PAY-3 · `POST /reservations/{reservationId}/payment/confirm`

- **Role**: MEMBER
- **200**: `{ "data": Reservation }` with `status: RESERVED` and `payment.status: CONFIRMED`. The
  buyer gets `PAYMENT_CONFIRMED`.
- **Errors**: `409 PAYMENT_NOT_PENDING`, `409 RESERVATION_NOT_ACTIVE`
- **Transition**: `PENDING_PAYMENT` → `RESERVED`

### PAY-4 · `POST /reservations/{reservationId}/payment/refund`

- **Role**: MEMBER or ADMIN
- **Request**: `{ "note": "Đã hoàn qua chuyển khoản" }`
- **200**: `{ "data": Payment }` with `status: REFUNDED`
- **Errors**: `409 REFUND_NOT_DUE`

### PAY-5 · `PUT /stores/{storeId}/payout-account`

- **Role**: OWNER
- **Request**: `{ "bankBin": "970436", "accountNumber": "…", "accountName": "NGUYEN VAN A" }`.
  `accountNumber` is stored encrypted and returned masked.
- **200**: `{ "data": StoreOwnerView }`
- **Errors**: `400 VALIDATION_FAILED`

---

## 10. Waste logs (research data, spec §7, §10)

### WASTE-1 · `POST /stores/{storeId}/waste-logs`

- **Role**: MEMBER
- **Request**:
  `{ "date": "2026-11-23", "batchId": "uuid|null", "category": "BAKERY", "eligibleSurplus": 10, "listed": 6, "pickedUp": 5, "discarded": 3, "discardedWeightGrams": 450, "reason": "Hết giờ nhận" }`.
  If `batchId` is set, `listed` and `pickedUp` are pre-filled by the server from the batch and the
  client values are ignored.
- **201**: `{ "data": WasteLog }`
- **Errors**: `400 VALIDATION_FAILED`, `409 WASTE_LOG_EXISTS` (one log per batch)

### WASTE-2 · `GET /stores/{storeId}/waste-logs`

- **Role**: MEMBER
- **Query**: `from`, `to` (dates), `cursor`, `limit`
- **200**: `{ "data": WasteLog[], "page": … }`

### WASTE-3 · `PATCH /stores/{storeId}/waste-logs/{wasteLogId}`

- **Role**: MEMBER
- **Request**: any WASTE-1 numeric field, or `reason`
- **200**: `{ "data": WasteLog }`
- **Errors**: `409 WASTE_LOG_LOCKED` (editable for 7 days after `date`)

---

## 11. Saved items

### SAVE-1 · `GET /me/saved`

- **Role**: USER
- **Query**: `type=BATCH|STORE` (default `BATCH`), `cursor`, `limit`
- **200**: `{ "data": (BatchCard | StoreSummary)[], "page": … }` (V1/15). Saved batches that are no
  longer published are returned with `soldOut: true` or a terminal status, so the FE can grey them
  out.

### SAVE-2 · `PUT /me/saved/{targetType}/{targetId}`

- **Role**: USER
- **204**: idempotent
- **Errors**: `404 NOT_FOUND`

### SAVE-3 · `DELETE /me/saved/{targetType}/{targetId}`

- **Role**: USER
- **204**: idempotent

---

## 12. Notifications and web push

### NOTI-1 · `GET /me/notifications`

- **Role**: USER
- **Query**: `unreadOnly`, `cursor`, `limit`
- **200**: `{ "data": Notification[], "page": …, "meta": { "unreadCount": 3 } }` (V1/34)

### NOTI-2 · `POST /me/notifications/read`

- **Role**: USER
- **Request**: `{ "ids": ["uuid"] }` or `{ "all": true }`
- **204**

### NOTI-3 · `POST /me/push-subscriptions`

- **Role**: USER
- **Request**: `{ "endpoint": "https://…", "keys": { "p256dh": "…", "auth": "…" } }`. This is the
  browser `PushSubscription.toJSON()`. The VAPID key comes from SYS-2.
- **201**: `{ "data": { "id": "uuid" } }`. It upserts by `endpoint`.

### NOTI-4 · `DELETE /me/push-subscriptions/{subscriptionId}`

- **Role**: USER
- **204**

Notification copy rule: be factual and never use fake scarcity (spec §6.1). For example, "Sắp tới giờ
nhận rồi" is fine, and "Chỉ còn 1 suất, nhanh lên!" is **not allowed**.

---

## 13. Reservation chat, reviews and incidents

### CHAT-1 · `GET /reservations/{reservationId}/messages`

- **Role**: BUYER or MEMBER
- **Query**: `after` (messageId, for polling every 10 s while the chat is open), `limit` (≤ 100)
- **200**: `{ "data": ChatMessage[], "meta": { "open": true } }`, oldest first. It marks the
  returned messages read.
- **Errors**: `404 RESERVATION_NOT_FOUND`

### CHAT-2 · `POST /reservations/{reservationId}/messages`

- **Role**: BUYER or MEMBER
- **Request**: `{ "body": "1–1000 chars" }`
- **201**: `{ "data": ChatMessage }`. The other side gets `NEW_MESSAGE`.
- **Errors**: `409 CHAT_CLOSED` (the chat is open while the reservation is active and for 24 h after
  it closes), `429 RATE_LIMITED`
- **Notes**: Phone numbers and emails are not auto-revealed. Messages are purged 30 days after the
  reservation closes.

### REV-1 · `POST /reservations/{reservationId}/review`

- **Role**: BUYER
- **Request**: `{ "rating": 5, "comment": "≤ 500|null" }`
- **201**: `{ "data": Review }`
- **Errors**: `409 REVIEW_NOT_ALLOWED` (the status is not `PICKED_UP`, or more than 7 days have
  passed), `409 REVIEW_EXISTS`

### INC-1 · `POST /incidents`

- **Role**: USER
- **Request**:
  `{ "type": "UNSAFE_FOOD", "reservationId": "uuid|null", "batchId": "uuid|null", "storeId": "uuid|null", "description": "10–1000 chars", "imageIds": [] }`.
  At least one target is required, and the server derives the store. A `NOT_RECEIVED` or
  `SELLER_ABSENT` incident requires a `reservationId` owned by the caller.
- **201**: `{ "data": Incident }` (V1/23)
- **Errors**: `400 VALIDATION_FAILED`, `422 INCIDENT_TARGET_INVALID`, `429 RATE_LIMITED`
- **Side effects**: `UNSAFE_FOOD` with a batch **immediately pauses** that batch (`pauseReason
  INCIDENT`) and notifies the store and admins. Other types notify only.

### INC-2 · `GET /incidents/mine`

- **Role**: USER
- **200**: `{ "data": Incident[], "page": … }`

### INC-3 · `GET /incidents/{incidentId}`

- **Role**: the reporter, a MEMBER of the store (`reporter` hidden), or ADMIN
- **200**: `{ "data": Incident }`
- **Errors**: `404 INCIDENT_NOT_FOUND`

---

## 14. Admin (operations dashboard, spec §6.3)

These endpoints are ADMIN only. Every action is audit-logged.

### ADM-1 · `GET /admin/stores`

- **Query**: `status` (csv `StoreVerification`), `q`, `cursor`, `limit`
- **200**: `{ "data": StoreOwnerView[] (+ owner: { id, displayName, phone, email }), "page": … }`.
  Contact data is visible to admins only (spec §6.3).

### ADM-2 · `POST /admin/stores/{storeId}/verify`

- **Request**: `{ "note": "Đã kiểm tra giấy phép ATTP" }`
- **200**: StoreOwnerView. Transition `PENDING|SUSPENDED` → `VERIFIED`. The owner gets
  `STORE_VERIFIED`.
- **Errors**: `409 INVALID_STATE_TRANSITION`

### ADM-3 · `POST /admin/stores/{storeId}/reject`

- **Request**: `{ "note": "required" }`
- **200**: Transition `PENDING` → `REJECTED`, and the owner gets `STORE_REJECTED`.
- **Errors**: `409 INVALID_STATE_TRANSITION`

### ADM-4 · `POST /admin/stores/{storeId}/suspend`

- **Request**: `{ "note": "required", "cancelActiveBatches": true }`
- **200**: Transition `VERIFIED|PENDING` → `SUSPENDED`. If `cancelActiveBatches` is set, its
  `PUBLISHED` batches are cancelled as in BATCH-11 with the reason `ADMIN`. The owner gets
  `STORE_SUSPENDED`.

### ADM-5 · `GET /admin/batches`

- **Query**: `status`, `storeId`, `from`, `to`, `cursor`, `limit`
- **200**: `BatchSellerView[]`

### ADM-6 · `GET /admin/reservations`

- **Query**: `status`, `storeId`, `from`, `to`, `cursor`, `limit`
- **200**: `Reservation[]` (with `buyer.displayName`, never `pickup`)

### ADM-7 · `GET /admin/incidents`

- **Query**: `status`, `type`, `storeId`, `cursor`, `limit`
- **200**: `Incident[]`

### ADM-8 · `PATCH /admin/incidents/{incidentId}`

- **Request**: `{ "status": "INVESTIGATING" | "RESOLVED" | "DISMISSED", "resolution": "text|null", "batchAction": "NONE" | "UNPAUSE" }`.
  To remove a batch, use BATCH-12 with the ADMIN role.
- **200**: `Incident`. The reporter gets `INCIDENT_UPDATED`.

### ADM-9 · `POST /admin/users/{userId}/status`

- **Request**: `{ "status": "ACTIVE" | "SUSPENDED", "reason": "required" }`
- **200**: `{ "data": { "id", "status" } }`. Suspending revokes all of the user's refresh tokens.

### ADM-10 · `GET /admin/metrics`

- **Query**: `from`, `to`, `storeId?`
- **200**: These are the KPIs from spec §10, computed exactly as defined there:

```json
{ "data": {
  "reservations": { "valid": 40, "pickedUp": 31, "cancelled": 5, "noShow": 4 },
  "pickupRate": 0.775, "noShowRate": 0.1,
  "portions": { "eligiblePosted": 60, "pickedUp": 31 }, "rescueRate": 0.517,
  "discardedGrams": 1200, "recoveredRevenueVnd": 512000,
  "avgTimeToPublishSec": 52, "safety": { "checked": 25, "rejected": 2, "removedUnsafe": 1, "unsafeRate": 0.12 }
} }
```

### ADM-11 · `GET /admin/exports/{dataset}.csv`

- **Path**: `dataset` = `batches|reservations|waste_logs|incidents|pickups`
- **Query**: `from`, `to`, `storeId?`
- **200**: `text/csv; charset=utf-8` (with a UTF-8 BOM, so Excel opens it). The data is
  **anonymised**:
  - no names, phones, emails, free-text chat or incident descriptions;
  - user IDs are replaced by a per-export salted hash;
  - coordinates are rounded to 2 decimals;
  - timestamps are kept to the minute.

  Columns follow spec Appendix B.

---

## 15. Error code catalogue

| HTTP | Code | When |
|---|---|---|
| 400 | `VALIDATION_FAILED` | Body or query schema errors (`details.fields`) |
| 400 | `OTP_INVALID` / `OTP_EXPIRED` | AUTH-2 |
| 401 | `UNAUTHENTICATED` | Missing or invalid access token |
| 401 | `TOKEN_EXPIRED` | Access token expired, so the FE calls AUTH-3 and retries once |
| 401 | `REFRESH_INVALID` / `GOOGLE_TOKEN_INVALID` | AUTH-3 / AUTH-5 |
| 403 | `FORBIDDEN` | The role or store scope is not allowed |
| 403 | `ACCOUNT_SUSPENDED` / `STORE_SUSPENDED` | |
| 403 | `FEATURE_DISABLED` | A flagged feature is off |
| 403 | `OWN_STORE_RESERVATION` | RES-1 |
| 404 | `NOT_FOUND`, `STORE_NOT_FOUND`, `BATCH_NOT_FOUND`, `RESERVATION_NOT_FOUND`, `IMAGE_NOT_FOUND`, `INCIDENT_NOT_FOUND`, `PAYMENT_NOT_FOUND`, `MEMBER_USER_NOT_FOUND` | Also used to hide resources from callers without access |
| 409 | `INVALID_STATE_TRANSITION` | `details: { from, action }` |
| 409 | `STORE_ALREADY_EXISTS`, `STORE_NOT_VERIFIED`, `STORE_REJECTED`, `MEMBER_ALREADY_EXISTS`, `CANNOT_REMOVE_OWNER` | Stores |
| 409 | `FIELD_LOCKED`, `QUANTITY_BELOW_RESERVED`, `PRICE_INCREASE_NOT_ALLOWED`, `PICKUP_WINDOW_EXTENSION_NOT_ALLOWED`, `SAFETY_CHECK_STALE`, `PAUSED_BY_INCIDENT` | Batches |
| 409 | `BATCH_SOLD_OUT`, `BATCH_NOT_AVAILABLE`, `ACTIVE_RESERVATION_LIMIT`, `ALREADY_RESERVED` | RES-1 |
| 409 | `RESERVATION_NOT_ACTIVE`, `CANCEL_WINDOW_CLOSED`, `PICKUP_TOO_EARLY`, `PICKUP_WINDOW_CLOSED`, `PAYMENT_PENDING`, `BATCH_REMOVED_UNSAFE`, `NO_SHOW_TOO_EARLY` | Reservation lifecycle |
| 409 | `PAYMENT_NOT_PENDING`, `REFUND_NOT_DUE` | Payments |
| 409 | `CHAT_CLOSED`, `REVIEW_NOT_ALLOWED`, `REVIEW_EXISTS`, `WASTE_LOG_EXISTS`, `WASTE_LOG_LOCKED`, `IMAGE_IN_USE`, `ACCOUNT_HAS_ACTIVE_ITEMS` | |
| 413 | `IMAGE_TOO_LARGE` | |
| 415 | `IMAGE_TYPE_UNSUPPORTED` | |
| 422 | `SAFETY_CHECK_FAILED`, `BATCH_INCOMPLETE`, `PICKUP_WINDOW_INVALID`, `QUANTITY_LIMIT_EXCEEDED`, `PICKUP_CODE_INVALID`, `INCIDENT_TARGET_INVALID`, `IDEMPOTENCY_KEY_REUSED`, `MEMBER_LIMIT` | Business rule failures |
| 429 | `RATE_LIMITED`, `OTP_TOO_MANY_ATTEMPTS` | With `Retry-After` |
| 500 | `INTERNAL` | Never leaks a stack trace |

---

## 16. Endpoint index (73)

| Group | IDs | Count |
|---|---|---|
| System | SYS-1…2 | 2 |
| Auth | AUTH-1…5 | 5 |
| Me | ME-1…3 | 3 |
| Stores | STORE-1…9 | 9 |
| Images | IMG-1…2 | 2 |
| Batches | BATCH-1…12 | 12 |
| Reservations | RES-1…8 | 8 |
| Payments (flag) | PAY-1…5 | 5 |
| Waste logs | WASTE-1…3 | 3 |
| Saved | SAVE-1…3 | 3 |
| Notifications | NOTI-1…4 | 4 |
| Chat / reviews / incidents | CHAT-1…2, REV-1, INC-1…3 | 6 |
| Admin | ADM-1…11 | 11 |
| **Total** | | **73** |

---

## 17. Figma V1 screen → endpoint map

Figma file `yi47xwMJLLdMuiNEVh5Tna`, page `0:1` "V1 · Lưu trữ thiết kế cũ". The user chose V1 as the
UI source of truth on 2026-11-23. Page `19:23` (V2) is now reference only. The design system is
frame `13:48` "41 · LASTBITE Design System · Foundation". Node IDs are in brackets.

| Screen | Endpoints used |
|---|---|
| V1/01 Bản đồ khám phá [2:2] | SYS-2, BATCH-1 (`view=map`), BATCH-1 (`free=true`, "Miễn phí gần bạn" sheet with "12 món đang chờ được cứu") |
| V1/02 Bottom sheet mở rộng [2:97] | BATCH-1 (`view=list`; chips Tất cả / Miễn phí / Giá rẻ = `priceMax`) |
| V1/03 Tìm kiếm [2:188] | SYS-2 (`popularSearches`), BATCH-1 (`q`, `sort=distance`) |
| V1/04 Chi tiết món [2:237] | BATCH-2, SAVE-2 / SAVE-3 (♡), STORE-3 (link) |
| V1/05 Xác nhận đặt giữ [2:266] | BATCH-2, SYS-2 (`maxQtyPerReservation` for the quantity stepper), RES-1 |
| V1/06 Nhận mã QR [2:293] | RES-3 (`pickup.code`, `pickup.qrPayload`). "Xem đường đi" opens a maps link from `store.lat/lng` (no API). |
| V1/07 Đăng pass món [2:324] | STORE-2 (no store → STORE-1 onboarding), IMG-1, BATCH-3 |
| V1/08 Tài khoản mua & bán [2:350] | ME-1 (`stats`, `stores`), RES-2, STORE-5 |
| V1/09 Onboarding / Welcome [7:2] | none (static) |
| V1/10 Sign in / Sign up [7:19] | AUTH-1, AUTH-5 (flag) |
| V1/11 Location permission [7:37] | none: browser geolocation or a manual pick, kept client-side (privacy), then BATCH-1 |
| V1/12 Advanced filters [7:54] | SYS-2 (enums, radii), BATCH-1 (filters; "Xem 12 kết quả" uses the list length) |
| V1/13 Pin selected / mini-sheet [7:96] | BATCH-1 (`view=map`), BATCH-2 (card) |
| V1/14 Free food list [7:122] | BATCH-1 (`free=true&pickupDay=today&sort=distance`) |
| V1/15 Saved listings [7:168] | SAVE-1, SAVE-3 |
| V1/16 Seller or store profile [7:204] | STORE-3 (`description` = "Về người đăng"), STORE-5, STORE-6, SAVE-2 (`STORE`) |
| V1/17 Đơn của tôi [8:2] | RES-2 (`tab=upcoming` = "Đang nhận", `history` = "Lịch sử") |
| V1/18 Chi tiết đơn / pickup [8:43] | RES-3; it links to RES-4, CHAT-1, INC-1, REV-1 |
| V1/19 Checkout món có phí / cọc [8:73] | SYS-2 (`features.payments`, `depositAmount`); the choice is sent in RES-1 (flag) |
| V1/20 Chọn phương thức thanh toán [8:99] | RES-1 (`paymentMode`, `paymentMethod`; flag) |
| V1/21 QR chuyển khoản / cọc [8:124] | PAY-1, PAY-2 ("Tôi đã thanh toán"; flag) |
| V1/22 Thanh toán thành công [8:335] | RES-3 |
| V1/23 Báo cáo chất lượng [8:351] | IMG-1 (`INCIDENT`), INC-1 (the 5 options map to `IncidentType`) |
| V1/24 Trò chuyện P2P [8:375] | CHAT-1, CHAT-2 (reservation-scoped, D§9 D7) |
| V1/25 Đăng món · giờ nhận & bảo quản [9:181] | BATCH-4 |
| V1/26 Checklist an toàn thực phẩm [9:210] | BATCH-6 (IMG-1 `SAFETY_EVIDENCE` optional) |
| V1/27 Xem trước tin đăng [9:254] | BATCH-2 (seller view), BATCH-8 |
| V1/28 Đăng thành công [9:274] | BATCH-8 response |
| V1/29 Tin đang đăng & quản lý [10:2] | STORE-5 (`tab=active|done`), BATCH-9, BATCH-10 |
| V1/30 Đơn đang chờ người nhận [10:43] | RES-5 (`buyer.displayName` = "Người nhận"), RES-8, PAY-3 (flag), CHAT-1 |
| V1/31 Quét QR và nhập mã [10:68] | RES-6, RES-7 ("Nhập mã thủ công" → RES-6 with `code`) |
| V1/32 Xác nhận đã giao thành công [10:88] | RES-7 response (`batchRemaining`) |
| V1/33 Chỉnh sửa & tạm dừng tin [11:2] | BATCH-2, BATCH-4, BATCH-9, BATCH-11, BATCH-12 ("Tạm dừng / gỡ tin này") |
| V1/34 Thông báo [11:33] | NOTI-1, NOTI-2 |
| V1/35 Trung tâm tài khoản 2 vai trò [11:84] | ME-1, STORE-2, RES-2, STORE-5; "Tin nhắn" see the gaps below |
| V1/36 Cài đặt & PWA [11:135] | ME-2 (`notificationPrefs`), NOTI-3, NOTI-4, AUTH-4, ME-3 |
| V1/37 Không có món gần đây [11:186] | BATCH-1 (empty result; "Mở rộng bán kính" = larger `radiusKm`) |
| V1/38 Hết suất / Tin quá hạn [11:201] | BATCH-2 (`soldOut` or terminal status), RES-1 → `BATCH_SOLD_OUT`, BATCH-1 (suggestions) |
| V1/39 Hủy đơn & lưu ý hoàn cọc [11:220] | RES-3, RES-4 |
| V1/40 Xác minh OTP [11:243] | AUTH-2, AUTH-1 (resend) |

**V1 screen elements with no endpoint yet.** These are open questions. They are not contract
changes until they are decided.

- **V1/35 "Tin nhắn"** (a chat inbox across the buyer and seller roles). For now the FE composes it
  from RES-2 (buyer) and RES-5 (seller) using `chat.unreadCount`. A dedicated
  `GET /me/conversations` would be a contract change.
- **V1/36 "Chỉnh sửa thông tin liên hệ".** Phone and email cannot be changed in v1 (ME-2). Only
  `displayName` and the avatar are editable for now.
- **V1/36 "Khu vực mặc định".** This is stored client-side only (privacy). There is no server field.
- **V1/24 "Thường trả lời trong ngày".** This is static copy. There is no response-time metric.

**Endpoints with no Figma screen yet.** The FE builds these from the V1 design system (frame
`13:48`):

- Store onboarding and editing: STORE-1, STORE-4, STORE-7 to STORE-9, and PAY-5.
- Waste-log entry: WASTE-1 to WASTE-3, triggered by `BATCH_EXPIRED_LOG_WASTE`.
- Incident status: INC-2 and INC-3.
- The whole admin area: ADM-1 to ADM-11.
- Showing reviews: STORE-6. Writing one (REV-1) is reached from V1/18.
- BATCH-5, BATCH-7, IMG-2, PAY-4 and SYS-1.
