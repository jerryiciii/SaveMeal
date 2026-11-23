# apps/web: SaveMeal PWA (frontend)

This folder will hold the Next.js (App Router, TypeScript) mobile-first PWA for buyers and sellers.
It is **not scaffolded yet**. The FE orchestrator session creates it on a `feat/fe-…` branch in its
own worktree.

## What goes here

- The screens from **Figma V1** (page `0:1`, screens `01` to `40`), built with the design system
  frame `13:48` ("41 · LASTBITE Design System · Foundation": dark map palette and Inter).
- The PWA manifest, service worker and install prompt (V1/36), and the web push subscription.
- Map discovery with the buyer's location kept **client-side only**, QR display (V1/06) and a camera
  QR scanner (V1/31).
- An API client typed with `@savemeal/shared`, calling `/api/v1` same-origin (Next.js rewrite to
  the API).
- Admin pages (`/admin`) and waste-log entry, built from the V1 design system (no Figma frames exist).

## Rules

- This folder only. Read `CLAUDE.md`, `docs/API_CONTRACT.md` and `docs/DOMAIN.md` first.
- Use no endpoint, field or status that is not in the contract.
- UI copy is Vietnamese and matches Figma. It never implies the QR is a safety certificate, and it
  uses no fake scarcity.
- Required scripts: `dev`, `build`, `lint`, `typecheck`, `test`.
