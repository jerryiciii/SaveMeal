# apps/api: SaveMeal REST API (backend)

This folder will hold the NestJS (TypeScript) + Prisma + PostgreSQL API, served under `/api/v1` on
port 4000. It is **not scaffolded yet**. The BE orchestrator session creates it on a `feat/be-…`
branch in its own worktree.

## What goes here

- Every endpoint in `docs/API_CONTRACT.md` (v1.1: build the **[MVP]**-tagged endpoints only, starting with the demo slice in DOMAIN §10), with the exact error envelope and codes.
- The Prisma schema and migrations for the entities in `docs/DOMAIN.md` §2.
- OTP auth (with a `console` provider in dev), JWT access tokens and a rotating refresh cookie.
  RBAC with owner scoping, single-use pickup tokens (DOMAIN §6).
- The **atomic reservation** transaction (DOMAIN §6), with a parallel-request test.
- Listing and reservation state machines (DOMAIN §3–4). The required-info checklist and seller declarations
  (DOMAIN §5).
- Scheduled jobs JOB-1 to JOB-4 (DOMAIN §7). Image upload with EXIF stripping.
- Moderation (reports, block, suspend) and KPI metrics (DOMAIN §8). CSV export is Later.
- `apps/api/.env.example`, with placeholders only.

## Rules

- This folder only (plus `packages/shared` when the contract requires it). Read `CLAUDE.md` first.
- Contract-first: change `docs/API_CONTRACT.md` in its own commit before the code.
- Payments, chat, notifications and the other **[LATER]** items are not built in the MVP. Google login stays behind
  `GOOGLE_LOGIN_ENABLED=false`.
- Required scripts: `dev`, `build`, `lint`, `typecheck`, `test`, `prisma:migrate`, `prisma:seed`.
