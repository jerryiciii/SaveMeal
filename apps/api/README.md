# apps/api: LASTBITE REST API (backend)

This folder will hold the NestJS (TypeScript) + Prisma + PostgreSQL API, served under `/api/v1` on
port 4000. It is **not scaffolded yet**. The BE orchestrator session creates it on a `feat/be-…`
branch in its own worktree.

## What goes here

- Every endpoint in `docs/API_CONTRACT.md` (73 in v1.0), with the exact error envelope and codes.
- The Prisma schema and migrations for the entities in `docs/DOMAIN.md` §2.
- OTP auth (with a `console` provider in dev), JWT access tokens and a rotating refresh cookie.
  RBAC with store scoping.
- The **atomic reservation** transaction (DOMAIN §6), with a parallel-request test.
- Batch and reservation state machines (DOMAIN §3–4). The safety checklist and system checks
  (DOMAIN §5).
- Scheduled jobs JOB-1 to JOB-6 (DOMAIN §7). Notifications and web push (VAPID). Image upload with
  EXIF stripping.
- Anonymised CSV export and KPI metrics (spec §10).
- `apps/api/.env.example`, with placeholders only.

## Rules

- This folder only (plus `packages/shared` when the contract requires it). Read `CLAUDE.md` first.
- Contract-first: change `docs/API_CONTRACT.md` in its own commit before the code.
- Payments stay behind `PAYMENTS_ENABLED=false`, and Google login behind
  `GOOGLE_LOGIN_ENABLED=false`.
- Required scripts: `dev`, `build`, `lint`, `typecheck`, `test`, `prisma:migrate`, `prisma:seed`.
