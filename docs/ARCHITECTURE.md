# Architecture

## Monorepo layout (npm workspaces, Node ≥ 22)

```
SaveMeal/
├─ apps/
│  ├─ web/            Next.js (App Router) mobile-first PWA, the buyer + seller UI (FE)
│  └─ api/            NestJS + Prisma + PostgreSQL REST API under /api/v1 (BE)
├─ packages/
│  └─ shared/         TS enums, DTO types and constants that mirror docs/API_CONTRACT.md
├─ docs/
│  ├─ API_CONTRACT.md the source of truth for every endpoint (contract-first)
│  ├─ DOMAIN.md       entities, state machines, safety + reservation rules, decisions
│  └─ ARCHITECTURE.md this file
├─ .githooks/         commit-msg (no AI attribution, Conventional Commits) and pre-push (no main)
├─ docker-compose.yml local PostgreSQL
└─ package.json       workspaces + root scripts (lint, typecheck, test, build)
```

## Responsibilities

| Workspace | Owns | Must not |
|---|---|---|
| `apps/api` | Auth (OTP and JWT), RBAC with owner scoping, the atomic reservation transaction, single-use pickup tokens, state machines, background jobs, image processing (EXIF strip), moderation and KPIs (MVP scope: API_CONTRACT tags) | Contain UI, or trust client-side safety or price data |
| `apps/web` | Screens from Figma V1 (page `0:1`), PWA manifest and service worker, geolocation (client-only), QR display (rotating pickup token) and camera scan; web push is Later | Hold business rules beyond UX validation, or store the buyer's location server-side |
| `packages/shared` | Enums (`ListingStatus`, `ReservationStatus`, `Category`, `ReportType`, …), request/response types, error codes, money and time helpers | Import from `apps/*`, or contain runtime dependencies beyond zod (optional) |

The shared package is a mirror: `docs/API_CONTRACT.md` changes first, then `packages/shared`, then the
code in the apps.

## Runtime picture

```
Browser (PWA, apps/web :3000)
   │  same-origin /api/v1/*  (Next.js rewrite → API, so the refresh cookie is first-party)
   ▼
NestJS API (apps/api :4000) ──► PostgreSQL 16 (docker :5432)
   │                         └─► local disk uploads (dev) / S3-compatible bucket (later)
   ├─ scheduler (in-process @nestjs/schedule): listing/reservation expiry, cleanup and metrics jobs (DOMAIN §7)
   ├─ OTP sender: `console` provider in dev; an SMS/email provider in prod (env-selected)
   └─ (Later) Web Push (VAPID)
```

- **Time**: store UTC (`timestamptz`) and render in `Asia/Ho_Chi_Minh`. "Today" means the local date
  in Đà Nẵng.
- **Money**: integer VND (`18000`). There is no decimal or float money anywhere.
- **Geo**: each listing keeps its pickup `lat` and `lng`. The map is MapLibre with OpenStreetMap-based tiles. Radius search uses a bounding box plus a
  haversine filter in SQL (no PostGIS needed for the pilot). A buyer's coordinates exist only in the
  request.
- **IDs**: UUID v4 strings. The human order code (`SM–4281`) is separate from the ID. The QR carries only a random pickup token (`SM1.<token>`).
- **Concurrency**: reservations use a single conditional `UPDATE … WHERE quantity_available >= :q`
  inside a transaction (DOMAIN §6), and are covered by a parallel-requests test.

## Local development

```bash
cp .env.example .env
docker compose up -d db          # postgres://savemeal:savemeal@localhost:5432/savemeal
npm install
npm run dev -w apps/api          # once BE scaffolds it
npm run dev -w apps/web          # once FE scaffolds it
```

`.env.example` (root) holds the compose variables and documents shared flags. Each app adds its own
`apps/<app>/.env.example` when it is scaffolded.

## Feature flags (all default OFF for the pilot)

| Flag | Effect when on |
|---|---|
| `PAYMENTS_ENABLED` | **Later only.** Deposit or online payment (API_CONTRACT §10). In the MVP the buyer pays the seller directly at pickup, and SaveMeal holds no money. |
| `GOOGLE_LOGIN_ENABLED` | `POST /auth/google` is accepted. When off, login is OTP only. |

The flags are exposed to the FE through `GET /api/v1/config`.

## Quality gates

Each workspace defines `lint`, `typecheck`, `test` and `build` scripts. Root scripts run them across
all workspaces (`--workspaces --if-present`). CI (to be added) runs the same scripts on every PR.
