# Domain model: SaveMeal (v1.3.1)

This file covers the entities, state machines and invariants. `docs/API_CONTRACT.md` (v1.3.1) defines
how they are exposed. When the code disagrees with this file, the code is wrong.

**Product spec (source of truth since v1.1):** the competition dossier
(Google Doc `1iDYFYzvzIvq0EYeW5WbR5xJkG2lH2isRLgfXXHuFeP4`; "LastFood" is only the paper's title,
and **the product is SaveMeal**). It outranks the older concept paper
(`1ATLucNflZVs9cqfspVfIaZFR6b5d_toVrAcym4XqBlw`) wherever they conflict. References below like
"spec §3.3" point to the dossier. The UI is Figma **V1** (page `0:1`) plus V2.1 P2P payment screens
(`25b`, `21`, `30b`, `06b`).

## 0. Scope: MVP vs Later (spec §2.3, updated in v1.3)

| MVP (build now) | Later (designed, not built; behind flags or not started) |
|---|---|
| Phone/email OTP login; one account that both buys and sells; map, search and filters (price, food type, distance, pickup time); posting a listing with the required-info checklist; portions; pickup window; atomic reservation; P2P direct bank QR payment + buyer transfer proof upload + seller manual confirm/reject + Resend email notifications (feature-flagged via `PAYMENTS_ENABLED`); QR handover; order status; violation reports; admin block/suspend; KPIs | Automated payment gateway webhooks (SePay/PayOS), platform fee & refund/payout ledger, chat, push and in-app notifications, store dashboard and staff accounts, scheduled promotions, saved items, feedback/ratings, waste logs, Google login, CSV export, pause/resume of listings |

**Payment modes (D2, v1.3).** P2P direct bank QR payment is controlled by `PAYMENTS_ENABLED`
(default `false` in env/tests until FE finishes wiring screens `25b`, `21`, `30b`, `06b`).
- SaveMeal holds **no money** and charges **no platform fee** in v1.3 (`platform_fee = 0`,
  `payable_amount = total_price`, `amount = total_price`). Automated gateway webhooks
  (SePay/PayOS) and platform fees are deferred to Later.
- When `PAYMENTS_ENABLED=false` (or for free listings where `total_price = 0`), the buyer skips
  `PENDING_PAYMENT` and enters `RESERVED` immediately with a `pickupToken`; for paid items the buyer
  pays the seller directly at pickup.
- When `PAYMENTS_ENABLED=true` and `total_price > 0`, the seller uploads their own bank QR image
  (`bank_qr_image_id` on account default or per listing). The buyer transfers `total_price` directly
  to the seller, uploads a transfer receipt screenshot (`PAYMENT_PROOF`), and the seller manually
  confirms or rejects the payment (with Resend email notifications on proof submission, confirmation
  and rejection).
- In both modes, the **pickup QR** confirms handover only. It is not a payment QR, and it is not a
  safety certificate.

## 1. Actors and roles

| Role | Who | How it is granted |
|---|---|---|
| `GUEST` | Not signed in | Can browse published listings and public seller profiles |
| `USER` | Any signed-in, `ACTIVE` account | OTP login. **The same account buys and sells.** Individuals can sell (spec §1.3). |
| `SELLER` | The `USER` who owns a listing | Ownership is per listing (`food_listings.seller_id`). There is no separate store entity in the MVP (D1). |
| `BUYER` | The `USER` who made a reservation | Per reservation |
| `ADMIN` | The pilot operations team | Set in the DB or seed only |
| `SYSTEM` | Scheduled jobs | §7 |

## 2. Entities (spec §3.1–3.2 names)

The table names are snake_case and the Prisma models PascalCase (`FoodListing` → `food_listings`).

| Table | Key fields |
|---|---|
| **accounts** | id, phone? (E.164, unique), email? (unique), display_name, avatar_image_id?, role `USER\|ADMIN`, status `ACTIVE\|SUSPENDED\|DELETED`, suspended_reason?, **seller fields** (all optional): seller_name, seller_type `INDIVIDUAL\|SHOP\|CAFE\|BAKERY\|CANTEEN`, seller_verified_at?, seller_verified_by?, default_pickup_address?, default_pickup_lat?, default_pickup_lng?, bank_qr_image_id? (default seller bank QR image), **nearby alert fields** (opt-in, D15): nearby_alerts_enabled (bool, default `false`), nearby_alert_lat? (float, rounded to 2 decimals), nearby_alert_lng? (float, rounded to 2 decimals), nearby_alert_radius_km (int, default `3`), nearby_alert_last_sent_at? (timestamptz), created_at, deleted_at? |
| otp_requests, refresh_tokens | Auth support tables (hashed codes and tokens; see the contract §0) |
| **food_listings** | id, seller_id → accounts, title, description?, category, origin (nguồn gốc, required), prepared_at (chế biến/đóng gói, required), storage `ROOM_TEMP\|CHILLED\|FROZEN`, storage_note?, ingredients?, allergens[] (optional info), original_price? (reference price, optional), price (sale price ≥ 0), quantity_total, quantity_available, pickup_start, pickup_end, pickup_address, pickup_lat, pickup_lng, bank_qr_image_id? (defaults to `accounts.bank_qr_image_id`), declaration (json of the 6 seller attestations), declared_at?, status, under_review (bool), published_at?, closed_at?, close_reason?, blocked_reason?, created_at |
| **listing_images** | id, listing_id? (null until attached), uploader_id, purpose `LISTING\|REPORT\|AVATAR\|PAYMENT_QR\|PAYMENT_PROOF`, storage_key, width, height, bytes, position, created_at. EXIF/GPS is stripped on upload. |
| **reservations** | id, listing_id, buyer_id, seller_id, quantity, unit_price, total_price, platform_fee (0 in v1.3), payable_amount (= total_price), code (4 digits, unique among the seller's active reservations, shown as `SM–4281`), code_hash, status (`PENDING_PAYMENT\|AWAITING_SELLER_CONFIRM\|RESERVED\|COMPLETED\|CANCELLED\|EXPIRED`), payment_expires_at?, cancel_reason?, created_at, completed_at?, closed_at?, idempotency_key |
| **payments** | id, reservation_id (unique → reservations), status (`UNPAID\|PROOF_SUBMITTED\|CONFIRMED\|REJECTED\|EXPIRED`), amount (= total_price), seller_qr_image_id? (snapshot of listing/seller bank QR), proof_image_id? (buyer transfer receipt screenshot), expires_at, proof_submitted_at?, confirmed_at?, rejected_at?, reject_reason?, created_at, updated_at |
| **pickup_tokens** | id, reservation_id, token_hash (SHA-256), expires_at, used_at?, revoked_at?, created_at. The token is random and carries **no personal data** (spec §3.3). |
| **reports** | id, reporter_id, type, listing_id?, reservation_id?, reported_account_id, description, image_ids[], status `OPEN\|IN_REVIEW\|RESOLVED\|DISMISSED`, action `NONE\|WARNING\|LISTING_BLOCKED\|ACCOUNT_SUSPENDED`?, resolution?, handled_by?, handled_at?, created_at |
| **event_logs** | id, actor_id?, actor_type `USER\|ADMIN\|SYSTEM`, event (e.g. `LISTING_PUBLISHED`, `RESERVATION_COMPLETED`), entity_type, entity_id, data (json), at. This is append-only, and every state transition writes one. |
| **feedback** (Later) | id, reservation_id (unique), author_id, seller_id, rating 1–5, comment?, created_at |
| **transaction_metrics** | (date, seller_id) primary key: listings_published, listings_expired_with_stock, portions_listed, portions_reserved, portions_handed_over, reservations_created, reservations_completed, reservations_cancelled, reservations_expired, discount_rate_sum, discount_samples. JOB-4 rebuilds it nightly from `event_logs`. |

### Enums

- `Category` (food type, V1/12): `BAKERY` (Bánh), `MEAL` (Cơm / đồ mặn), `DRINK` (Đồ uống),
  `PACKAGED` (Đóng gói), `OTHER` (Khác).
- `Storage`: `ROOM_TEMP` (Nhiệt độ phòng), `CHILLED` (Ngăn mát), `FROZEN` (Ngăn đông). `storage_note`
  holds details.
- `Allergen` (optional, informational only, never a filter or a gate): `GLUTEN`, `MILK`, `EGG`,
  `PEANUT`, `TREE_NUT`, `SOY`, `FISH`, `SHELLFISH`, `SESAME`.
- `ReportType` (V1/23): `WRONG_INFO`, `UNSAFE_FOOD`, `NOT_RECEIVED`, `SELLER_ABSENT`, `OTHER`.
- `ImagePurpose`: `LISTING`, `REPORT`, `AVATAR`, `PAYMENT_QR`, `PAYMENT_PROOF`.
- `PaymentStatus`: `UNPAID`, `PROOF_SUBMITTED`, `CONFIRMED`, `REJECTED`, `EXPIRED`.

## 3. Listing state machine

```
 POST /listings          PATCH (any field)
 ─────────────► DRAFT ◄──────────┐
                 │  publish (checklist complete + 6 declarations true)
                 ▼
             PUBLISHED ── now ≥ pickup_end (JOB-1) ─────────► EXPIRED
                 │  ── owner withdraws (any reason, e.g. storage no longer OK) ─► WITHDRAWN
                 │  ── admin blocks ───────────────────────────────────────────► BLOCKED
   visible on map only while PUBLISHED, quantity_available > 0, now < pickup_end,
   under_review = false and the seller is ACTIVE ("auto-hide", spec §2.2 and §3.3)
```

| From → To | Trigger | Actor | Guards | Side effects |
|---|---|---|---|---|
| — → `DRAFT` | `POST /listings` | USER | The account is `ACTIVE`. The seller has at most `MAX_ACTIVE_LISTINGS` (5) non-terminal listings. | event_log |
| `DRAFT` → `DRAFT` | `PATCH` | Owner | — | — |
| `DRAFT` → `PUBLISHED` | `POST /listings/:id/publish` | Owner | **Required-info checklist** (§5) complete. All 6 declarations `true`. Window valid (§5). | Sets `quantity_available = quantity_total`, `published_at` and `declared_at`, writes an event_log (which serves as evidence), and sends best-effort Resend email alerts to eligible opted-in nearby `ACTIVE` users (D15) |
| `PUBLISHED` → `PUBLISHED` | `PATCH` (restricted, below) | Owner | — | — |
| `PUBLISHED` → `EXPIRED` | JOB-1 at `pickup_end` | SYSTEM | — | `closed_at`. Remaining `RESERVED` orders are handled by JOB-2. |
| `DRAFT\|PUBLISHED` → `WITHDRAWN` | `POST /listings/:id/withdraw` | Owner | — | Every `PENDING_PAYMENT`, `AWAITING_SELLER_CONFIRM`, or `RESERVED` order → `CANCELLED` (`SELLER_WITHDREW`), its pickup tokens are revoked, and `UNPAID` / `PROOF_SUBMITTED` payments → `EXPIRED` |
| `PUBLISHED\|EXPIRED` → `BLOCKED` | `POST /admin/listings/:id/block`, or a report action | ADMIN | A reason is required | As for withdraw, but the reason is `LISTING_BLOCKED`. It counts in the safety KPI. |
| `PUBLISHED` (`under_review` flag) | An `UNSAFE_FOOD` report | SYSTEM | — | The listing is hidden immediately and new reservations are refused. Existing ones stay valid. Only an admin clears it (ADM-2), or blocks the listing. |

`DRAFT` can be hard-deleted. Terminal states are `EXPIRED`, `WITHDRAWN` and `BLOCKED`. "Sold out"
is **derived** (`quantity_available = 0`) and is not a status; a cancellation can bring stock back.

**Editing a `PUBLISHED` listing** (V1/33):

- **Editable:**
  - `title`, `description`, `images`;
  - `quantity_total`, never below the reserved count (spec: the seller "updates portions");
  - `price`, which can only go down;
  - `pickup_end`, which can only move earlier, and never before now.
- **Locked:** `category`, `origin`, `prepared_at`, `storage`, `storage_note`, `ingredients`,
  `allergens`, `pickup_start` and the pickup location. To change these, withdraw the listing and
  post a new one.

## 4. Reservation state machine

```
 POST /reservations (free OR PAYMENTS_ENABLED=false) ──────────────────────────────────────────────┐
                                                                                                   ▼
 POST /reservations (paid & PAYMENTS_ENABLED=true) ──► PENDING_PAYMENT ──► AWAITING_SELLER_CONFIRM ──► RESERVED ──► COMPLETED ("Hoàn tất")
                                                         │   │  │  (buyer submits proof)  │  │  │       │  │  │  (seller scans QR / enters code)
                                                         │   │  │                         │  │  │       │  │  │
                                 seller confirm (direct) ├───┼──┼─────────────────────────┼──┼──┘       │  │  └── now ≥ pickup_end + NO_SHOW_GRACE_MIN
                                 seller reject ──────────┤   │  │  seller confirm ────────┘  │          │  │      (JOB-2) ──► EXPIRED ("Hết giờ")
                                 buyer cancel /          │   │  │  seller reject ────────────┤          │  │
                                 withdraw / block ───────┘   │     (→ CANCELLED,             │          │  └── listing withdrawn / blocked ──► CANCELLED
                                 ──► CANCELLED               │      PAYMENT_REJECTED,        │          │
                                     (payment: EXPIRED /     │      stock released)          │          └── buyer cancels (before pickup_end) ──► CANCELLED
                                      REJECTED)              │                               │
                                                             │ now ≥ payment_expires_at      └── now ≥ pickup_end + NO_SHOW_GRACE_MIN
                                                             │ (lazy / JOB-2)                    (JOB-2) ──► EXPIRED
                                                             ▼
                                                          EXPIRED
                                                          (stock released,
                                                           payment: EXPIRED)
```

| From → To | Trigger | Actor | Guards | Stock & payment side effects |
|---|---|---|---|---|
| — → `PENDING_PAYMENT` | `POST /reservations` | USER (not the seller) | `PAYMENTS_ENABLED=true`, `total_price > 0`, `payment_expires_at ≤ pickup_end`, §6 | `quantity_available −= q` atomically. Creates `payments` row (`status = UNPAID`, `amount = total_price`, `seller_qr_image_id`). `pickup_token` is `null`. |
| — → `RESERVED` | `POST /reservations` | USER (not the seller) | `PAYMENTS_ENABLED=false` **or** `total_price = 0`, §6 | `quantity_available −= q` atomically. Issues the first pickup token. `payment` is `null`. Sends best-effort Resend transactional emails to the seller (if `seller.email` is set) and buyer (if `buyer.email` is set). |
| `PENDING_PAYMENT` → `AWAITING_SELLER_CONFIRM` | `POST /reservations/:id/payment-proof` | BUYER | `reservation.status = PENDING_PAYMENT`, `payment.status = UNPAID`, valid `proofImageId` (`purpose = PAYMENT_PROOF`) | Marks `payment.status = PROOF_SUBMITTED`, sets `proof_image_id` & `proof_submitted_at`. Writes `PAYMENT_PROOF_SUBMITTED`. Sends Resend email to seller. Hold timer no longer auto-expires this order. |
| `PENDING_PAYMENT\|AWAITING_SELLER_CONFIRM` → `RESERVED` | `POST /reservations/:id/payment/confirm` | SELLER | `reservation.status IN (PENDING_PAYMENT, AWAITING_SELLER_CONFIRM)` | Atomically marks `payment.status = CONFIRMED` (`confirmed_at = now`). Issues the first pickup token. Writes `PAYMENT_CONFIRMED` + `RESERVATION_PAID`. Sends Resend email to buyer. |
| `PENDING_PAYMENT\|AWAITING_SELLER_CONFIRM` → `CANCELLED` | `POST /reservations/:id/payment/reject` | SELLER | `reservation.status IN (PENDING_PAYMENT, AWAITING_SELLER_CONFIRM)`, `reason` (3–300 chars) | `+= q` atomically if the listing is still `PUBLISHED` and `now < pickup_end`. Sets `cancel_reason = PAYMENT_REJECTED`, `payment.status = REJECTED` (`rejected_at = now`, `reject_reason`). Writes `PAYMENT_REJECTED` + `RESERVATION_CANCELLED`. Sends Resend email to buyer. |
| `PENDING_PAYMENT\|AWAITING_SELLER_CONFIRM` → `CANCELLED` | `POST /reservations/:id/cancel` or listing withdrawn/blocked | BUYER / SYSTEM | `now < pickup_end` (for buyer cancel) | `+= q` if the listing is still `PUBLISHED` and `now < pickup_end`. Marks `payment.status = EXPIRED`. |
| `PENDING_PAYMENT` → `EXPIRED` | Lazy-expiry (§6) or JOB-2 | SYSTEM | `now ≥ payment_expires_at` | `+= q` if the listing is still `PUBLISHED` and `now < pickup_end`. Marks `payment.status = EXPIRED`. |
| `AWAITING_SELLER_CONFIRM` → `EXPIRED` | JOB-2 | SYSTEM | `now ≥ pickup_end + NO_SHOW_GRACE_MIN` | None. Marks `payment.status = EXPIRED`. |
| `RESERVED` → `COMPLETED` | `POST /pickups/confirm` | The SELLER of the listing | The token is valid, unexpired and unused, **or** the code matches. `pickup_start − EARLY_PICKUP_MIN ≤ now ≤ pickup_end + NO_SHOW_GRACE_MIN`. The listing is not `BLOCKED`. | Sets `used_at` on the token, records the event, adds quantity to handed-over count. |
| `RESERVED` → `CANCELLED` | `POST /reservations/:id/cancel` | BUYER | `now < pickup_end` | `+= q` if the listing is still `PUBLISHED` and `now < pickup_end`. Revokes tokens. |
| `RESERVED` → `CANCELLED` | Listing withdrawn or blocked | SYSTEM | — | None (the listing is closed). Revokes tokens. |
| `RESERVED` → `EXPIRED` | JOB-2 | SYSTEM | `now ≥ pickup_end + NO_SHOW_GRACE_MIN` | None. Revokes tokens. |

`cancel_reason` is one of `BUYER_LATE`, `BUYER_WRONG_QTY`, `BUYER_CHANGED_PLAN`, `BUYER_OTHER`
(V1/39), `PAYMENT_REJECTED`, `SELLER_WITHDREW`, `LISTING_BLOCKED` or `ADMIN`.

**"Xác nhận đơn" (spec §2.1) = handover confirmation (D8).** Reservations are accepted atomically
on `POST /reservations`. When `PAYMENTS_ENABLED=true` and `price > 0`, the seller verifies receipt
of the buyer's direct bank transfer (`PAY-3` / `PAY-4`) to unlock the pickup QR (`RESERVED`). At
handover, the seller scans the buyer's QR (or enters the code), moving the order to `COMPLETED`.
When `payment.status === "CONFIRMED"` (or the item is free), `amountToCollect = 0`; otherwise
`amountToCollect = totalPrice`.

## 5. Listing checklist and seller declarations (spec §2.1, §2.2, §5)

**Required info.** `publish` fails with `LISTING_INCOMPLETE` and `details.missing[]` unless every
item is present:

| Key | Field(s) | Note |
|---|---|---|
| `PHOTO` | ≥ 1 listing image | A real photo. The platform does **not** judge food quality from images (spec §3.4). |
| `NAME` | `title` | 3–80 characters |
| `PRICE` | `price` | ≥ 0. If `original_price` is set, then `price ≤ original_price`. |
| `PORTIONS` | `quantity_total` | 1–50 |
| `ORIGIN` | `origin` | Free text, e.g. "Làm tại tiệm sáng nay" |
| `PREPARED_AT` | `prepared_at` | In the past |
| `STORAGE` | `storage` (+ `storage_note` optional) | |
| `PICKUP_WINDOW` | `pickup_start`, `pickup_end` | `pickup_start < pickup_end`, `pickup_end > now`, `pickup_end − pickup_start ≤ MAX_WINDOW_HOURS` (4) |
| `PICKUP_LOCATION` | `pickup_address`, `pickup_lat`, `pickup_lng` | Defaults to the account's default pickup location |
| `PAYMENT_QR` *(conditional)* | `bank_qr_image_id` | Required to publish **only** when `PAYMENTS_ENABLED=true` and `price > 0` (defaults to `accounts.bank_qr_image_id`; free listings with `price = 0` do not require one) |

**Seller declarations.** The seller ticks all six in V1/26. They are sent with `publish` and stored
in `declaration`:

| Key | UI label (V1/26) |
|---|---|
| `NOT_EXPIRED` | Món còn trong thời hạn sử dụng |
| `STORED_PROPERLY` | Bảo quản đúng điều kiện |
| `NOT_SPOILED` | Không hư hỏng hoặc biến chất |
| `NOT_SERVED_LEFTOVERS` | Không phải thức ăn khách đã ăn dở |
| `INFO_DECLARED` | Đã khai báo thành phần, dị ứng (khi có) |
| `PICKUP_WINDOW_OK` | Khung giờ nhận vẫn phù hợp |

Any `false` returns `DECLARATION_INCOMPLETE`. There is also a platform sanity limit:
`pickup_end − prepared_at ≤ MAX_LISTING_AGE_HOURS[category]` (default 24 h, and 72 h for
`PACKAGED`). It exists to stop obvious mistakes, and **it is not a safety threshold**. Spec §5
forbids using one time or temperature threshold to call food safe. The seller remains responsible
for the food. SaveMeal sets listing rules, handles reports and removes content, but issues no
safety certificate. **No AI or image-based quality judgment, ever.**

## 6. Atomic reservation rule (spec §2.2 step 3, §3.3)

`POST /reservations` runs in **one DB transaction**:

```sql
UPDATE food_listings
   SET quantity_available = quantity_available - $q
 WHERE id = $listingId AND status = 'PUBLISHED' AND under_review = false
   AND quantity_available >= $q AND now() < pickup_end
   AND seller_id <> $buyerId
RETURNING quantity_available;
-- 0 rows → roll back; respond 409 LISTING_SOLD_OUT or LISTING_NOT_AVAILABLE (re-read to tell which)
INSERT INTO reservations (...);  INSERT INTO pickup_tokens (...);  INSERT INTO event_logs (...);
```

- There is no read-then-write. A CHECK constraint enforces
  `0 ≤ quantity_available ≤ quantity_total`.
- Limits:
  - `MAX_QTY_PER_RESERVATION` = 2;
  - `MAX_ACTIVE_RESERVATIONS_PER_ACCOUNT` = 3 (counts `PENDING_PAYMENT`, `AWAITING_SELLER_CONFIRM`, and `RESERVED`);
  - one active reservation (`PENDING_PAYMENT`, `AWAITING_SELLER_CONFIRM`, or `RESERVED`) per account per listing.
- The `Idempotency-Key` header is required. A repeat within 24 h replays the first result.

**P2P Direct QR pricing & fees (v1.3):**

- No platform fee in v1.3: `platform_fee = 0`, `payable_amount = total_price`, `amount = total_price`.
- Free items (`total_price = 0`): skip `PENDING_PAYMENT` and enter `RESERVED` immediately with a
  `pickupToken` (`payment = null`). No `bank_qr_image_id` is required on the listing.
- Paid items (`total_price > 0`) when `PAYMENTS_ENABLED=false`: `platform_fee = 0`,
  `payable_amount = total_price`, `payment = null`. Enters `RESERVED` immediately (offline payment
  at pickup).
- Paid items (`total_price > 0`) when `PAYMENTS_ENABLED=true`: enters `PENDING_PAYMENT` with a
  `payments` row (`status = UNPAID`, `amount = total_price`, `seller_qr_image_id` copied from
  listing or account default). Buyer pays the seller directly via the seller's bank QR image,
  uploads a transfer receipt screenshot (`PAYMENT_PROOF`), and the seller manually confirms or
  rejects the transfer (`PAY-3` / `PAY-4`).

**Hold duration (`holdMinutes`) & lazy-expiry (v1.3):**

- When `PAYMENTS_ENABLED=true` and `total_price > 0`, the buyer may pass `holdMinutes` (integer,
  ≥ `MIN_PAYMENT_HOLD_MIN` = `5`, default `DEFAULT_PAYMENT_HOLD_MIN` = `10`).
- `payment_expires_at = now + holdMinutes` must satisfy `payment_expires_at ≤ listing.pickup_end`;
  otherwise the request fails with `422 PAYMENT_HOLD_INVALID`.
- While `PENDING_PAYMENT` or `AWAITING_SELLER_CONFIRM`, stock is already decremented atomically
  (`quantity_available −= q`) and `pickupToken` is `null`.
- **Lazy-expiry (serverless-safe):** before listing search (`LIST-1` / `LIST-2`), reservation
  creation (`RES-1`), and reservation read (`RES-2` / `RES-3` / `PAY-1`), expired `PENDING_PAYMENT`
  orders (`now ≥ payment_expires_at`) are atomically transitioned to `EXPIRED` (`payment.status =
  EXPIRED`) and their stock is released back (`quantity_available += q`) if the listing is still
  `PUBLISHED` and `now < pickup_end`. `JOB-2` also sweeps them.
- **No hold-timer expiry after proof submission:** lazy-expiry does **not** expire
  `AWAITING_SELLER_CONFIRM` reservations on `payment_expires_at`. Once the buyer submits payment
  proof, the order waits for seller confirmation (`PAY-3`) or rejection (`PAY-4`), or expires via
  `JOB-2` after `pickup_end + NO_SHOW_GRACE_MIN`.

**Pickup QR (spec §3.3):**

- **Token.** `token = base64url(32 random bytes)`, and the QR payload is `SM1.<token>`. Only
  SHA-256(token) is stored.
- **Time limit.** `expires_at = min(now + PICKUP_TOKEN_TTL_MIN (10), pickup_end + NO_SHOW_GRACE_MIN)`.
- **Rotation.** The buyer's app requests a fresh token (RES-6) before expiry. Issuing a new token
  revokes the older unused ones.
- **Single use.** `used_at` is set atomically on confirm. A used, revoked or expired token is
  rejected with its own error code.
- **No personal data.** The QR holds no IDs, names or phone numbers.
- **Manual fallback.** The 4-digit order code is entered by the seller (V1/31 "Nhập mã thủ công").
  It only matches among that seller's `RESERVED` orders, and it is rate-limited to 5 tries per
  minute.

## 7. Scheduled jobs (SYSTEM)

| Job | Every | Does |
|---|---|---|
| JOB-1 listing expiry | 1 min | `PUBLISHED` and `now ≥ pickup_end` → `EXPIRED` |
| JOB-2 reservation expiry | 1 min | `PENDING_PAYMENT` and `now ≥ payment_expires_at` → `EXPIRED` (releases stock if listing is `PUBLISHED` and `now < pickup_end`, marks payment `EXPIRED`); `AWAITING_SELLER_CONFIRM` and `now ≥ pickup_end + NO_SHOW_GRACE_MIN` → `EXPIRED` (marks payment `EXPIRED`; does not expire on hold timer); `RESERVED` and `now ≥ pickup_end + NO_SHOW_GRACE_MIN` → `EXPIRED` (revokes tokens). |
| JOB-3 cleanup | daily | Purges expired OTPs, refresh tokens and pickup tokens older than 7 days. Deletes images not attached within 24 h. |
| JOB-4 metrics | nightly + on demand | Rebuilds `transaction_metrics` from `event_logs` |

All jobs are idempotent (conditional updates) and write event_logs.

## 8. KPIs (spec §6.1). Baseline waste data is collected outside the app.

| KPI | Definition |
|---|---|
| Handed-over portions | Σ quantity of `COMPLETED` reservations |
| Completion rate | `COMPLETED` reservations / reservations created (cancelled and expired ones are also shown separately) |
| Listing-expired rate | Listings that reached `EXPIRED` with `quantity_available > 0` / listings published |
| Actual discount | Mean of `(original_price − price) / original_price` over completed reservations **whose listing has an `original_price`**. The sample size is reported. |
| Reports / safety | The count by type, by status and by action, the median handling time (`handled_at − created_at`), and the number of listings blocked |

A handed-over portion is **not** reported as "waste avoided" (spec §2.2 step 5, §6.2).

## 9. Decisions

| # | Topic | Decision | Status |
|---|---|---|---|
| D1 | Seller model | **No store entity in the MVP.** The spec's data model has none, and individuals sell (spec §1.3). Seller identity (name, type, default pickup location, verified badge) lives on `accounts`, and pickup location is per listing. Staff accounts and the store dashboard are Later. | Decided (v1.1) |
| D2 | Payments | **v1.3 P2P Direct Bank QR + Transfer Proof + Resend Email.** SaveMeal holds no money and charges no platform fee (`platformFee = 0`, `payableAmount = totalPrice`, `amount = totalPrice`). Sellers upload their own bank QR image (`bankQrImageId` on account default or per listing; required to publish paid listings when `PAYMENTS_ENABLED=true`, optional for free items). Buyers transfer directly to the seller, upload a transfer receipt screenshot (`PAYMENT_PROOF`), and sellers manually confirm (`PAY-3` → `RESERVED` + `pickupToken`) or reject (`PAY-4` → `CANCELLED` + stock released). Resend emails notify the seller on proof submission and the buyer on confirmation or rejection. Automated gateway webhooks (SePay/PayOS) and platform fees are deferred to Later. Feature flag `PAYMENTS_ENABLED` stays `false` until FE finishes wiring screens `25b`, `21`, `30b`, `06b`. | Decided (v1.3) |
| D3 | Login | OTP via SMS (primary) or email. Google is Later. | Decided |
| D4 | Moderation | **Admin verification is NOT required to publish in the MVP.** Moderation instead = the required-info checklist, the seller declarations, reports, admin block and suspend, and spam limits. A **"Đã xác minh" badge** marks sellers an admin has checked. | **Pending user confirmation** |
| D5 | Allergens | Optional information only. They are not a required check and not a search filter. | **Pending user confirmation** |
| D6 | Pause | Pause/resume is Later. In the MVP, V1/29 and V1/33 "Tạm dừng / gỡ tin" maps to **withdraw**. | Decided (v1.1) |
| D7 | Chat | Later (spec §2.3). The V1/24 screen is not built in the MVP. | Decided |
| D8 | "Xác nhận đơn" | Reservations are instant and atomic. The seller confirms at **handover** by scanning the QR, which makes the order `COMPLETED`. There is no seller approval step. | **Pending user confirmation** |
| D9 | Notifications | Push and the in-app list are both **Later**. An in-app list is not trivial (it needs a table and writers on every event). In the MVP, order status is shown on the order screens. The seller's pending list (RES-5) and the buyer's order detail poll every 30 s while open. | Decided (v1.1) |
| D10 | Free items | `price` may be 0 ("FREE" in V1). The `free` filter stays. | Decided |
| D11 | Stack | NestJS + Prisma + PostgreSQL API, and a Next.js PWA. The map uses MapLibre with OpenStreetMap-based tiles (spec §3.1). | Decided |
| D12 | UI source | Figma V1 (page `0:1`), chosen by the user on 2026-11-23 | Decided |
| D13 | Name | The product is **SaveMeal** everywhere (code, docs, UI). "LastFood" is only the competition paper's title. The order-code prefix is `SM–`. | Decided (user) |
| D14 | Pickup window vs demo | Confirm is allowed from `pickup_start − EARLY_PICKUP_MIN` (default 30). Demos set the window around the demo time. | Decided |
| D15 | Opt-in nearby listing alerts | Search coordinates on `GET /listings` are **never** stored. Separately, a user may explicitly opt in to nearby-listing email alerts via `PATCH /me` (`nearbyAlerts`). When enabled, the server stores the user's chosen area rounded to **2 decimal places** (~1.1 km precision, never exact GPS) plus `radiusKm` (`1`, `3`, or `5`, default `3`). Turning `nearbyAlerts.enabled = false` or deleting the account (`DELETE /me`) immediately clears the stored area coordinates (`null`). | Decided (v1.3.1) |

## 10. MVP demo slice (spec §7.3). Build this first.

1. **Seller posts.** The listing is "5 phần bánh còn nguyên", original price 25.000đ, price
   15.000đ, pickup 17:00–18:00, with a photo, origin, prepared time and storage. Flow: login
   AUTH-1/2 → (optional) seller name and default pickup via ME-2 → IMG-1 → LIST-3 draft → LIST-4
   (step 2: time and storage) → LIST-6 publish with the declarations.
2. **Buyer finds it.** On the map, the buyer filters price < 20k (`priceMax=20000`) and reads the
   detail. Endpoints: SYS-2, LIST-1 (`view=map` and `list`), LIST-2.
3. **Buyer reserves 1.** Stock goes 5 → 4 and a QR is generated. RES-1 returns the reservation plus
   the first pickup token. RES-3 and RES-6 show and refresh the QR. The seller sees 4 left on
   LIST-8 and the order on RES-5.
4. **Handover.** The buyer pays the seller offline. The seller scans with RES-7 (lookup), then RES-8
   (confirm), and the order becomes `COMPLETED`. The buyer sees "Hoàn tất" via RES-3 and RES-2.
5. **Cancel case.** The buyer cancels with RES-4, and stock returns 4 → 5.
6. **Expired case.** The listing's window passes, so JOB-1 sets the listing `EXPIRED` and JOB-2 sets
   the unclaimed order `EXPIRED` (shown as "Hết giờ"). Using a QR afterwards returns
   `PICKUP_WINDOW_CLOSED` or `PICKUP_TOKEN_EXPIRED`.

**Endpoint IDs for the slice:** SYS-2, AUTH-1, AUTH-2, AUTH-3, ME-1, ME-2, IMG-1, LIST-1, LIST-2,
LIST-3, LIST-4, LIST-6, LIST-8, RES-1, RES-2, RES-3, RES-4, RES-5, RES-6, RES-7, RES-8, plus JOB-1
and JOB-2. That is **21 endpoints and 2 jobs**.

## 11. Config defaults (env)

`MAX_ACTIVE_LISTINGS=5`, `MAX_WINDOW_HOURS=4`, `MAX_LISTING_AGE_HOURS={default:24,PACKAGED:72}`,
`MAX_QTY_PER_RESERVATION=2`, `MAX_ACTIVE_RESERVATIONS_PER_ACCOUNT=3`, `EARLY_PICKUP_MIN=30`,
`NO_SHOW_GRACE_MIN=15`, `PICKUP_TOKEN_TTL_MIN=10`, `OTP_TTL_SEC=300`, `OTP_RESEND_SEC=60`,
`OTP_MAX_ATTEMPTS=5`, `ACCESS_TOKEN_TTL=15m`, `REFRESH_TOKEN_TTL=30d`,
`PAYMENTS_ENABLED=false` (remains `false` until FE finishes wiring screens `25b`, `21`, `30b`, `06b`),
`MIN_PAYMENT_HOLD_MIN=5`, `DEFAULT_PAYMENT_HOLD_MIN=10`,
`RESEND_API_KEY`, `EMAIL_FROM` (for P2P payment emails, instant-`RESERVED` order emails, and opt-in nearby-listing alerts),
`GOOGLE_LOGIN_ENABLED=false` (Later). Automated gateway env vars (SePay/PayOS) are Later.
