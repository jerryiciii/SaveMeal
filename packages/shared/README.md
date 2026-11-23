# packages/shared: contract types

This package holds TypeScript enums, request/response types, error codes and small pure helpers
(money and time formatting) shared by `apps/web` and `apps/api`.

## What goes here

- The enums from `docs/API_CONTRACT.md` §1 and `docs/DOMAIN.md`: `BatchStatus`,
  `ReservationStatus`, `Category`, `Allergen`, `Storage`, `StoreType`, `StoreVerification`,
  `CancelReason`, `IncidentType`, `NotificationType`, `SafetyItemKey`, `SystemCheckKey`.
- DTO types such as `BatchCard`, `BatchDetail`, `Reservation`, `Me` and `ApiError`, plus the
  `ErrorCode` union.
- Optional zod schemas for request bodies, so both sides validate the same way.
- Helpers: `formatVnd(18000) → "18.000đ"`, `formatOrderCode("4281") → "LB–4281"`, and time-window
  formatting in `Asia/Ho_Chi_Minh`.

## Rules

- **This package mirrors the contract. It is not the source of truth.** Change
  `docs/API_CONTRACT.md` first (in its own commit), then update this package.
- Imports nothing from `apps/*`. No runtime dependencies other than zod.
- Not scaffolded yet. The first BE contract PR adds `package.json` scripts, `tsconfig` and
  `src/index.ts`.
