# apps/web: LASTBITE PWA (frontend)

This folder will hold the Next.js (App Router, TypeScript) mobile-first PWA for buyers and sellers.
It is **not scaffolded yet**. The FE orchestrator session creates it on a `feat/fe-…` branch in its
own worktree.

## What goes here

- The screens from **Figma V2** (page `19:23`, screens `V2 / 01` to `V2 / 40`) and the UI kit
  components (frame `30:342`: chip, food card, glass nav bar, map pin, buttons, inputs).
- The PWA manifest, service worker and install prompt (V2/36), and the web push subscription.
- Map discovery with the buyer's location kept **client-side only**, QR display (V2/07) and a camera
  QR scanner (V2/31).
- An API client typed with `@savemeal/shared`, calling `/api/v1` same-origin (Next.js rewrite to
  the API).
- Admin pages (`/admin`) and waste-log entry, built from the UI kit (no Figma frames exist).

## Rules

- This folder only. Read `CLAUDE.md`, `docs/API_CONTRACT.md` and `docs/DOMAIN.md` first.
- Use no endpoint, field or status that is not in the contract.
- UI copy is Vietnamese and matches Figma. It never implies the QR is a safety certificate, and it
  uses no fake scarcity.
- Required scripts: `dev`, `build`, `lint`, `typecheck`, `test`.
