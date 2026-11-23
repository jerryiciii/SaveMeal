# apps/api: SaveMeal REST API (backend)

NestJS 11 + Prisma 6 + PostgreSQL 16 API, served under `/api/v1` on port 4000. The source of truth
is `docs/API_CONTRACT.md` (endpoints, envelope, error codes) and `docs/DOMAIN.md` (entities, state
machines). Read `CLAUDE.md` first.

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

## Run locally

```bash
npm install                              # repo root; also runs `prisma generate`
cp apps/api/.env.example apps/api/.env   # placeholders only
npm run db:start -w @savemeal/api        # embedded PostgreSQL 16 on :5432 (keeps running)
npm run dev -w @savemeal/api             # http://localhost:4000/api/v1/health
```

`db:start` runs a real PostgreSQL 16 from the `embedded-postgres` dev dependency (no Docker or
admin rights; data in `apps/api/.data/pg`, git-ignored). It creates the `savemeal` and
`savemeal_test` databases. `db:stop` and `db:status` do what they say. If you prefer Docker,
`docker compose up -d db` at the repo root serves the same URL.

## Scripts

| Script | Does |
|---|---|
| `dev` | Watch mode (`nest start --watch`), builds `@savemeal/shared` first |
| `build` / `start` | Compile to `dist/` / run it |
| `lint`, `typecheck` | ESLint 9 (flat config), `tsc --noEmit` |
| `test` | `test:unit` then `test:e2e` |
| `test:unit` | Jest, `src/**/*.spec.ts`, no database |
| `test:e2e` | Jest + supertest against the real app and a real PostgreSQL test DB (`TEST_DATABASE_URL`, name must end in `_test`; dropped and re-created every run, local only). Starts the embedded server for the run if nothing is listening. |
| `prisma:migrate` / `prisma:deploy` | `prisma migrate dev` / `deploy` |
| `prisma:seed` | Seed demo data |
| `db:start` / `db:stop` / `db:status` | Embedded PostgreSQL 16 |

## Conventions

- Every response carries `X-Request-Id`. Every error uses the contract envelope
  `{ error: { code, message, details?, requestId } }`; throw `AppException(code, details?)`.
- Request bodies and queries are validated by the global `ValidationPipe` (strict whitelist);
  failures are `400 VALIDATION_FAILED` with `details.fields: { [path]: reason }`.
- Access logs never include bodies, headers or cookies, and round `lat`/`lng` query values to 2
  decimals (privacy).
- Feature flags `PAYMENTS_ENABLED` and `GOOGLE_LOGIN_ENABLED` default to off.
