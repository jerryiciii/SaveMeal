# Domain model

This file covers the entities, state machines and invariants. `docs/API_CONTRACT.md` defines how
they are exposed. When the code disagrees with this file, the code is wrong.

## 1. Actors and roles

| Role | Who | How it is granted |
|---|---|---|
| `GUEST` | Not signed in | Can browse published batches, store profiles and config |
| `USER` | Any signed-in account | Phone or email OTP. **One account both buys and sells** (Figma V2/10, V2/35). |
| `STORE_OWNER` | A user who created a store (seller profile) | `POST /stores`. A user owns at most **1** store in the MVP. |
| `STORE_STAFF` | A user the owner added to the store | Can verify pickups, see the store's reservations and manage batches, but cannot edit the store or its members |
| `ADMIN` | The pilot operations team | Set in the DB or seed only. There is no endpoint to grant it. |
| `SYSTEM` | Scheduled jobs | DOMAIN §7 |

"Store member" means `STORE_OWNER` or `STORE_STAFF` of that specific store. All seller permissions
are **store-scoped**.

## 2. Entities

Fields are listed by meaning. Names in Prisma use camelCase, and the tables use snake_case
(`@@map`).

| Entity | Key fields |
|---|---|
| **users** | id, phone? (E.164, unique), email? (unique), displayName, avatarImageId?, role `USER\|ADMIN`, status `ACTIVE\|SUSPENDED\|DELETED`, notificationPrefs (json), createdAt, deletedAt? |
| **otp_requests** | id, channel `SMS\|EMAIL`, identifierHash, codeHash, attempts, expiresAt, consumedAt? |
| **refresh_tokens** | id, userId, tokenHash, familyId, expiresAt, revokedAt?, userAgent? |
| **stores** (= seller profile) | id, ownerId, name, type `CAFE\|BAKERY\|CANTEEN\|RESTAURANT\|INDIVIDUAL`, description?, address, area (ward/district text), lat, lng, pickupInstructions?, contactPhone? (private), coverImageId?, verificationStatus `PENDING\|VERIFIED\|REJECTED\|SUSPENDED`, verificationNote?, verifiedAt?, verifiedBy? |
| **store_members** | storeId, userId, role `OWNER\|STAFF`, createdAt |
| **products** | id, storeId, name, category, allergens[], ingredients?, storage. This is a store-level template that `POST /batches` reuses or creates. |
| **surplus_batches** | id, storeId, productId, title, description?, category, imageIds[], allergens[], ingredients?, storage `ROOM_TEMP\|CHILLED`, preparedAt, bestBefore, quantityTotal, quantityAvailable, originalPrice, rescuePrice (0 = free), pickupStart, pickupEnd, status, pausedAt?, pauseReason? `SELLER\|INCIDENT`, safetyCheckId?, publishedAt?, closedAt?, closeReason?, createdBy |
| **safety_checks** | id, batchId, items (json: 6 seller items → boolean), systemChecks (json), note?, evidenceImageIds[], checkedBy, checkedAt. **Immutable** once written (it is the spec §8 item 7 evidence). |
| **reservations** | id, batchId, storeId, userId, quantity, unitPrice, totalPrice, code (display `LB–NNNN`), pickupCodeHash, status, paymentMode `AT_COUNTER\|DEPOSIT\|FULL`, cancelReason?, cancelledBy?, createdAt, reservedAt?, pickedUpAt?, closedAt?, idempotencyKey |
| **pickup_events** | id, reservationId, storeId, verifiedBy, method `QR\|SHORT_CODE`, quantity, at |
| **payments** (flag) | id, reservationId, type `DEPOSIT\|FULL`, method `BANK_TRANSFER\|VIETQR`, amount, transferContent, status `PENDING\|SENT\|CONFIRMED\|REFUND_DUE\|REFUNDED\|FORFEITED\|EXPIRED`, confirmedBy?, confirmedAt? |
| **waste_logs** | id, storeId, batchId?, date (local), category, eligibleSurplus, listed, pickedUp, discarded, discardedWeightGrams?, reason?, createdBy |
| **incidents** | id, reporterId, storeId, batchId?, reservationId?, type `WRONG_INFO\|UNSAFE_FOOD\|NOT_RECEIVED\|SELLER_ABSENT\|OTHER`, description, imageIds[], status `OPEN\|INVESTIGATING\|RESOLVED\|DISMISSED`, resolution?, handledBy?, createdAt |
| **reviews** | id, reservationId (unique), storeId, userId, rating 1–5, comment?, createdAt |
| **saved_items** | userId, targetType `BATCH\|STORE`, targetId, createdAt (pk = all three) |
| **chat_messages** | id, reservationId, senderId, senderSide `BUYER\|STORE`, body (≤ 1000 chars), createdAt, readAt? |
| **notifications** | id, userId, type, title, body, data (json), readAt?, createdAt |
| **push_subscriptions** | id, userId, endpoint (unique), p256dh, auth, createdAt |
| **images** | id, ownerId, purpose `BATCH\|STORE\|INCIDENT\|AVATAR\|SAFETY_EVIDENCE`, storageKey, width, height, bytes, createdAt |
| **audit_logs** | id, actorId?, action, entityType, entityId, data (json), at. This records every state transition and admin action. |

### Enums

- `Category`: `BAKERY` (Bánh), `SAVORY` (Đồ mặn), `DRINK` (Đồ uống), `PACKAGED` (Đóng gói), `OTHER`.
- `Allergen`: `GLUTEN`, `MILK`, `EGG`, `PEANUT`, `TREE_NUT`, `SOY`, `FISH`, `SHELLFISH`, `SESAME`.
  Use `ingredients` free text for anything else.
- `Storage`: `ROOM_TEMP` (Nhiệt độ phòng), `CHILLED` (Ngăn mát). Frozen or complex cold-chain food
  is out of scope (spec §3).

## 3. Batch state machine

```
            PATCH (any field)            PATCH safety-relevant field
   ┌────────────┐   safety-check   ┌────────────────┐ ───────────────► back to DRAFT
   │   DRAFT    │ ───────────────► │ SAFETY_CHECKED │
   └────────────┘                  └────────────────┘
     │ cancel/delete                  │ publish (check ≤ 60 min old, system checks pass)
     ▼                                ▼
  CANCELLED                     ┌───────────┐ ── now ≥ pickupEnd (job) ──► EXPIRED
                                │ PUBLISHED │ ── seller cancel ─────────► CANCELLED
                                └───────────┘ ── remove-unsafe ─────────► REMOVED_UNSAFE
                                  pause/resume is a flag (pausedAt), not a state
```

| From → To | Trigger | Actor | Guards | Side effects |
|---|---|---|---|---|
| — → `DRAFT` | `POST /batches` | Store member | The store exists and is not `SUSPENDED` or `REJECTED` (a `PENDING` store may draft) | Audit |
| `DRAFT` → `DRAFT` | `PATCH` | Store member | — | — |
| `DRAFT` → `SAFETY_CHECKED` | `POST /batches/:id/safety-check` | Store member | All 6 seller items are `true`. The required fields are present. The system checks pass (§5). | Write an immutable `safety_checks` row |
| `SAFETY_CHECKED` → `DRAFT` | `PATCH` of a safety-relevant field | Store member | — | The safety check is invalidated |
| `SAFETY_CHECKED` → `PUBLISHED` | `POST /batches/:id/publish` | Store member | The store is `VERIFIED`. The check is ≤ `SAFETY_CHECK_TTL_MIN` old. The system checks are re-run and pass. `pickupEnd` is in the future. | `quantityAvailable = quantityTotal`, publishedAt, audit |
| `PUBLISHED` (pause flag) | `/pause`, `/resume` | Store member (pause by `INCIDENT` is cleared only by an admin) | Resume requires `now < pickupEnd` | A paused batch is hidden from search and cannot be reserved. Existing reservations stay valid. |
| `PUBLISHED` → `EXPIRED` | JOB-1, when `now ≥ pickupEnd` | System | — | closedAt. Remaining reservations are handled by JOB-2. The seller is asked for a waste log. |
| `DRAFT\|SAFETY_CHECKED\|PUBLISHED` → `CANCELLED` | `POST /batches/:id/cancel` | Store member | — | Every `PENDING_PAYMENT\|RESERVED` reservation → `CANCELLED` (`SELLER_CANCELLED`), with a notification and refund handling |
| `SAFETY_CHECKED\|PUBLISHED` → `REMOVED_UNSAFE` | `POST /batches/:id/remove-unsafe` | Store member or admin | A reason is required | As for cancel, but the reason is `BATCH_REMOVED_UNSAFE`. It is counted in KPI 7. If it came from an incident, the incident is linked. |

`DRAFT` batches can be deleted (`DELETE`). Terminal states are `EXPIRED`, `CANCELLED` and
`REMOVED_UNSAFE`. "Sold out" is **derived** (`PUBLISHED && quantityAvailable == 0`) and is not a
status.

**Editing a `PUBLISHED` batch** (Figma V2/33) is restricted, because safety facts cannot change
after the check:

- These fields are editable: `title`, `description`, `imageIds`, `quantityTotal` (never below
  `quantityTotal − quantityAvailable`, the reserved count), `rescuePrice` (it can only go down),
  and `pickupEnd` (it can only move earlier, and never before `now`).
- These fields are locked: `category`, `allergens`, `ingredients`, `storage`, `preparedAt`,
  `bestBefore` and `pickupStart`. To change them, the seller cancels the batch and posts a new one.

## 4. Reservation state machine

```
 POST /reservations ──► PENDING_PAYMENT ──(payment confirmed)──► RESERVED ──(pickup verified)──► PICKED_UP
     (flag on and prepay)      │ hold timeout (JOB-3) → EXPIRED              │ buyer/seller cancel → CANCELLED
                               │ buyer cancel → CANCELLED                    │ now ≥ pickupEnd + grace (JOB-2) or seller → NO_SHOW
 POST /reservations ───────────────────────────────────────────► RESERVED (flag off, or AT_COUNTER, or a free item)
```

| From → To | Trigger | Actor | Guards | Stock effect |
|---|---|---|---|---|
| — → `RESERVED` / `PENDING_PAYMENT` | `POST /reservations` | User (not a member of the store) | §6 | `quantityAvailable −= q` atomically |
| `PENDING_PAYMENT` → `RESERVED` | `POST /reservations/:id/payment/confirm` | Store member | The payment is `SENT` or `PENDING` | — |
| `PENDING_PAYMENT` → `EXPIRED` | JOB-3 after `PAYMENT_HOLD_MIN` | System | — | `+= q` |
| `PENDING_PAYMENT\|RESERVED` → `CANCELLED` | `POST /reservations/:id/cancel` | Buyer | `now < pickupEnd` | `+= q` if the batch is still `PUBLISHED` |
| `PENDING_PAYMENT\|RESERVED` → `CANCELLED` | Batch cancel or remove-unsafe | System | — | None (the batch is closed) |
| `RESERVED` → `PICKED_UP` | `POST /stores/:id/pickups/confirm` | Store member | The code matches. `pickupStart − EARLY_PICKUP_MIN ≤ now ≤ pickupEnd + NO_SHOW_GRACE_MIN`. Pickup is allowed even if the batch is `EXPIRED` but still within the grace period; it is never allowed if the batch is `REMOVED_UNSAFE`. | Write a pickup_event |
| `RESERVED` → `NO_SHOW` | `POST /reservations/:id/no-show` (store member, `now ≥ pickupEnd`) or JOB-2 at `pickupEnd + NO_SHOW_GRACE_MIN` | Store member or system | — | None |

The terminal states are `PICKED_UP`, `CANCELLED`, `NO_SHOW` and `EXPIRED`. `cancelReason` is one of
`BUYER_LATE`, `BUYER_WRONG_QTY`, `BUYER_CHANGED_PLAN`, `BUYER_OTHER` (V2/39), `SELLER_CANCELLED`,
`BATCH_REMOVED_UNSAFE` or `ADMIN`.

## 5. Safety checklist (spec §8): mandatory before publishing

The seller confirms every item in Figma V2/26. All six must be `true`:

| Key | Vietnamese UI label | Spec §8 item |
|---|---|---|
| `NOT_EXPIRED` | Món còn hạn sử dụng | (3) |
| `STORED_PROPERLY` | Được bảo quản đúng cách | (3) |
| `NO_SPOILAGE` | Không có dấu hiệu hư hỏng | §8 text |
| `NOT_CUSTOMER_LEFTOVERS` | Không phải thức ăn thừa của khách | (6) |
| `ALLERGENS_DECLARED` | Đã khai báo dị ứng / thành phần | (4) |
| `PICKUP_WINDOW_SAFE` | Giờ nhận phù hợp với món | (5) |

The server checks these at both safety-check time and publish time. Any failure blocks the
transition with `SAFETY_CHECK_FAILED` and `details.failed[]`:

| Key | Rule | Spec item |
|---|---|---|
| `STORE_VERIFIED` | `store.verificationStatus == VERIFIED`. This is checked at publish only, so a `PENDING` store can practise drafting. | (1) |
| `CATEGORY_ALLOWED` | `category ∈ ALLOWED_CATEGORIES[store.type]` (ops config) | (2) |
| `NOT_EXPIRED_AT_PICKUP` | `bestBefore > pickupEnd` | (3) |
| `WINDOW_WITHIN_LIMIT` | `pickupEnd − preparedAt ≤ MAX_HOLD_HOURS[category][storage]` and `pickupEnd − pickupStart ≤ MAX_WINDOW_HOURS` | (5) |
| `ALLERGENS_PRESENT` | `allergens` is set (an empty list is allowed only if `ingredients` is filled in) | (4) |
| `EVIDENCE_RECORDED` | The `safety_checks` row is written (who, when, items, optional note or photo) | (7) |

The rules are absolute. **No AI and no automation marks food as safe.** There is no admin override.
The QR is not a safety certificate.

## 6. Atomic reservation rule

`POST /reservations` runs in **one DB transaction**:

```sql
UPDATE surplus_batches
   SET quantity_available = quantity_available - $q, updated_at = now()
 WHERE id = $batchId
   AND status = 'PUBLISHED' AND paused_at IS NULL
   AND quantity_available >= $q
   AND now() < pickup_end
RETURNING quantity_available;
-- 0 rows → roll back; respond 409 with BATCH_SOLD_OUT / BATCH_NOT_AVAILABLE (re-read to tell which)
INSERT INTO reservations (...);
```

There is no read-then-write in application code. Stock is released by the same conditional
`UPDATE` (`+ q`), and only while the batch is `PUBLISHED`. `0 ≤ quantityAvailable ≤ quantityTotal`
is enforced by a CHECK constraint.

Limits (configurable):

- `MAX_QTY_PER_RESERVATION` = 2.
- `MAX_ACTIVE_RESERVATIONS_PER_USER` = 3.
- A user can have only one active reservation per batch.
- Store members cannot reserve their own store's batches.
- A user who is `SUSPENDED` cannot reserve.
- Requests use an `Idempotency-Key` header. A repeat of the same key within 24 h returns the
  original result.

Pickup code: a 4-digit numeric code, unique among the store's active reservations, displayed as
`LB–4281`. Only its hash is stored. The plaintext is derived on demand as
`HMAC(PICKUP_CODE_SECRET, reservationId)` with a collision counter, so the buyer can view it again.
The QR payload is `LB1:<reservationId>:<code>`. Verifying requires store scope, and 5 failed attempts
per minute per store member are rate-limited.

## 7. Scheduled jobs (SYSTEM)

| Job | Every | Does |
|---|---|---|
| JOB-1 batch expiry | 1 min | `PUBLISHED` and `now ≥ pickupEnd` → `EXPIRED`. Notifies the seller to log waste. |
| JOB-2 no-show | 5 min | `RESERVED` and `now ≥ pickupEnd + NO_SHOW_GRACE_MIN` → `NO_SHOW` |
| JOB-3 payment hold | 1 min | `PENDING_PAYMENT` older than `PAYMENT_HOLD_MIN` → `EXPIRED`, and releases the stock |
| JOB-4 pickup reminder | 5 min | Sends `PICKUP_REMINDER` 30 min before `pickupStart` (once) |
| JOB-5 listing ending | 5 min | Sends `BATCH_ENDING` to the store 30 min before `pickupEnd` if stock is left |
| JOB-6 cleanup | daily | Purges expired OTPs and refresh tokens. Deletes chat messages 30 days after the reservation closes. Deletes orphan images after 24 h. |

All jobs are idempotent and use the same conditional-update pattern. Every transition writes an
audit_log.

## 8. Payments (behind `PAYMENTS_ENABLED`, default OFF)

- When the flag is off, every reservation is `AT_COUNTER`: it goes straight to `RESERVED`, and the
  buyer pays at the counter.
- When the flag is on, a priced item can be `DEPOSIT` (`DEPOSIT_AMOUNT`, default 5.000đ) or `FULL`
  (V2/19). The method is `BANK_TRANSFER` or `VIETQR` (V2/20). The reservation stays
  `PENDING_PAYMENT` until a store member confirms receipt. **There is no bank integration**: the QR
  is generated from the store's bank info (V2/21 says it is illustrative).
- Free items (`rescuePrice == 0`) never take payment.
- Cancel refunds: a buyer cancelling ≥ `FREE_CANCEL_BEFORE_MIN` (30) before `pickupStart` →
  `REFUND_DUE`. Later than that, or a no-show, → the deposit is `FORFEITED`. Seller cancel or
  remove-unsafe → always `REFUND_DUE`. The refund is recorded manually
  (`POST …/payment/refund`).

## 9. Decisions: where the spec and Figma disagree

| # | Conflict | Decision |
|---|---|---|
| D1 | The spec is B2C (stores) and Figma V2 is P2P with one shared buy/sell account | One user account. Selling requires creating a **store (seller profile)** with a `type`, which includes `INDIVIDUAL`. Every store, individuals included, must be admin-`VERIFIED` before publishing (spec §8 item 1). `ALLOWED_CATEGORIES[INDIVIDUAL]` defaults to `BAKERY, PACKAGED`. |
| D2 | Figma has deposit, full payment and transfer QR, while the spec pilot is reserve-and-pay-at-counter | Payments are behind `PAYMENTS_ENABLED=false`. The pilot pays at the counter. Even when the flag is on, confirmation is manual (no bank API). |
| D3 | Figma login offers "Email hoặc số điện thoại" plus Google, while the task says phone OTP | OTP login with `channel: SMS` (primary) or `EMAIL`, one endpoint pair. Google sign-in is behind `GOOGLE_LOGIN_ENABLED=false`. |
| D4 | Figma V2/26 lists 6 checks and spec §8 has 7 items | The 6 seller-confirmed items plus system checks for items (1), (2), (5) and (7) (§5). |
| D5 | Spec §6.4 mixes batch and order states in one chain | Split into a batch machine (§3) and a reservation machine (§4). `PENDING_PAYMENT` is added (flag only). |
| D6 | Figma V2/29 and V2/33 have "Tạm dừng" (pause), which is not in the spec states | Pause is a flag (`pausedAt`) on `PUBLISHED`, not a status. An `UNSAFE_FOOD` incident auto-pauses the batch (spec §8 incident process). |
| D7 | The V2/24 chat sample reads like a pre-order question | Chat exists **only inside a reservation** (privacy and anti-spam). Pre-order questions use the store's `pickupInstructions`. |
| D8 | Figma has free food (0đ, "Tặng nhau"), and the spec talks about discounted sales | `rescuePrice` may be `0`. The `free=true` filter. Free items never take payment. |
| D9 | V2/12 has a "Ngày mai" pickup filter, and the spec says "today" | Pickup can be today or tomorrow, but only within `MAX_HOLD_HOURS` (§5). |
| D10 | Reviews, waste-log entry and admin pages have no Figma frames | The contract includes them. The FE builds waste-log and admin pages from the V2 UI kit. Reviews are shown on the store profile (V2/16) once designed. |
| D11 | The spec suggests Supabase or Vercel | Per the user: NestJS + Prisma + PostgreSQL API, and a Next.js PWA. Hosting is undecided. |

## 10. Config defaults (env, all overridable)

`SAFETY_CHECK_TTL_MIN=60`, `MAX_WINDOW_HOURS=4`,
`MAX_HOLD_HOURS={BAKERY:{ROOM_TEMP:24,CHILLED:48},SAVORY:{ROOM_TEMP:4,CHILLED:12},DRINK:{ROOM_TEMP:4,CHILLED:24},PACKAGED:{ROOM_TEMP:72,CHILLED:72},OTHER:{ROOM_TEMP:4,CHILLED:12}}`,
`MAX_QTY_PER_RESERVATION=2`, `MAX_ACTIVE_RESERVATIONS_PER_USER=3`, `EARLY_PICKUP_MIN=0`,
`NO_SHOW_GRACE_MIN=15`, `PAYMENT_HOLD_MIN=15`, `DEPOSIT_AMOUNT=5000`, `FREE_CANCEL_BEFORE_MIN=30`,
`OTP_TTL_SEC=300`, `OTP_RESEND_SEC=60`, `OTP_MAX_ATTEMPTS=5`, `ACCESS_TOKEN_TTL=15m`,
`REFRESH_TOKEN_TTL=30d`.

The `MAX_HOLD_HOURS` values are **placeholders**. The pilot's Operations/Safety owner must confirm
them before launch (spec §8: an expert decides, not the software).
