# CLAUDE.md — rules for every Claude session in this repo

**SaveMeal** is a map-first mobile PWA marketplace. Shops and individuals post surplus food that is
still safe, at a discount. Buyers nearby reserve portions, pay the seller directly at pickup, and
confirm the handover by QR. Use the name "SaveMeal" everywhere; "LastFood" is only the title of the
competition paper. No delivery, no hardware, and no AI in the MVP. These rules are **mandatory**. If a task conflicts with them, stop
and ask the user. Do not work around them.

## 1. Sources of truth (in priority order)

1. `docs/API_CONTRACT.md`: every endpoint, payload, error code and state transition.
2. `docs/DOMAIN.md`: entities, state machines, the atomic reservation rule and the safety checklist.
3. Figma **V1** page `0:1` "V1 · Lưu trữ thiết kế cũ" (file `yi47xwMJLLdMuiNEVh5Tna`) is the UI
   source of truth. That means screens `01`–`40` and the design system frame `13:48`
   ("41 · LASTBITE Design System · Foundation"). The user chose it on 2026-11-23. Page `19:23` (V2,
   "Sắc màu & Liquid Glass") is reference only. Do not build from it unless the user says so.
4. The product spec is the competition dossier (Google Doc
   `1iDYFYzvzIvq0EYeW5WbR5xJkG2lH2isRLgfXXHuFeP4`). It sets the MVP vs Later scope (§2.3), the data
   model (§3), safety (§5) and KPIs (§6.1). The older concept paper
   (`1ATLucNflZVs9cqfspVfIaZFR6b5d_toVrAcym4XqBlw`) applies only where the dossier is silent, for
   example the §13 privacy rules.

If two sources disagree, do not guess. Follow the decision recorded in `docs/DOMAIN.md` §9
("Decisions"). If there is no recorded decision, ask the user.

## 2. Git: no AI attribution, ever

- Never add Claude/AI attribution anywhere in git. That means no `Co-Authored-By: Claude …`, no
  "Generated with Claude Code", no 🤖 footer and no `noreply@anthropic.com`. This applies to commit
  messages, PR titles and bodies, branch names, tags, release notes and code comments.
- Commits are authored by the human user's configured git identity. Never change `user.name` or
  `user.email`, and never pass `--author`.
- `.claude/settings.json` turns attribution off, and `.githooks/commit-msg` rejects it. Never use
  `--no-verify` to get around a hook.

## 3. Git workflow

- **Conventional Commits**: `type(scope): summary`. Types are `feat`, `fix`, `docs`, `style`,
  `refactor`, `perf`, `test`, `build`, `ci`, `chore`, `revert`. Scopes are `api`, `web`, `shared`,
  `contract`, `domain`, `infra` or `deps`. Write the summary in English, in the imperative mood,
  with at most 72 characters.
- Keep commits small: one logical change per commit.
- **Branches**: `feat/be-<topic>` (backend), `feat/fe-<topic>` (frontend), `fix/be-…`, `fix/fe-…`,
  `docs/<topic>`, `chore/<topic>`. Use lowercase kebab-case.
- **Never commit to `main` directly, and never force-push `main`.** Everything reaches `main` through
  a PR that the user merges. Force-pushing your own feature branch is allowed only with
  `--force-with-lease`.
- Never rewrite history that someone else has pushed. Never use `git stash`, `git reset --hard` or
  switch branches in another session's worktree.

## 4. Sessions, folders and worktrees

- A **BE** session works only in `apps/api/**` (plus `packages/shared/**` when the contract requires
  it). A **FE** session works only in `apps/web/**` (plus reading `packages/shared/**`).
- Each FE/BE session uses **its own git worktree** on its own branch, for example
  `git worktree add ../SaveMeal-be feat/be-auth`. Never edit files in another session's worktree.
- Changes outside your folder (root config, `docs/**`, `packages/shared/**`) go in a separate
  `chore/…` or `docs/…` branch, or are agreed with the lead first.

## 5. Contract-first

- **Any API change goes into `docs/API_CONTRACT.md` first, in its own commit**
  (`docs(contract): …`), before code on either side. Do not bundle contract changes with
  implementation commits.
- `packages/shared` types and enums must mirror the contract exactly. If the code and the contract
  disagree, the contract wins. Fix the code, or propose a contract change.
- Never ship an endpoint, field, status or error code that is not in the contract.

## 6. Food safety and money rules (dossier §2.3, §3.3, §5). These are product rules, not options.

- **No publish without the required-info checklist and all 6 seller declarations**
  (`docs/DOMAIN.md` §5). Do not build shortcuts, admin overrides or "skip" buttons. Expired food,
  spoiled food, food of unclear origin and leftovers already served to customers are never listed.
- **Never extend** a pickup window after publishing. Listings auto-hide when they expire, sell out or
  are withdrawn.
- **The pickup QR is a random, time-limited, single-use token with no personal data**
  (`docs/DOMAIN.md` §6). It only confirms the handover. It is not a payment QR and not a safety
  certificate, and UI copy must never suggest otherwise (no "an toàn 100%", "đã kiểm định" or
  similar).
- **No money flow in the MVP.** The buyer pays the seller directly at pickup. SaveMeal holds no
  money and promises no refunds. Deposits and online payment are Later only.
- **No AI or image-based logic judges food quality or safety.** It also never edits times and never
  generates allergen information. The seller is responsible for the food. The platform enforces the
  rules, handles reports and blocks content.
- An `UNSAFE_FOOD` report hides the listing immediately until an admin acts. Blocking or
  withdrawing a listing cancels its active reservations.
- No fake scarcity or pressure tactics in the UI.

## 7. Privacy rules (dossier §3.3 and concept paper §13)

- Collect only what pickup needs: phone or email, and a display name. Do not ask for birthdays,
  student IDs or addresses.
- **The buyer's location is chosen by the buyer and is never stored server-side.** It is sent per
  request and must not be logged at full precision (round to 2 decimals in logs).
- Owner-scoped access: a seller sees only the reservations on their own listings. They see the
  buyer's display name and order code, but never the buyer's phone or email.
- Never share a buyer's purchase history with other sellers or partners.
- Account deletion must work (`DELETE /me`), and it anonymises personal data.
- Research exports and public stats are **aggregated and anonymised**. They never contain names,
  phones, emails, exact coordinates or raw user IDs.
- Strip EXIF/GPS metadata from every uploaded image.

## 8. Secrets and config

- No secrets in git. Commit only `.env.example` files, with placeholder values. `.env*` is
  git-ignored.
- Feature flags (`PAYMENTS_ENABLED`, `GOOGLE_LOGIN_ENABLED`) default to **off**, and both features
  are Later. Build only the endpoints tagged **[MVP]** in `docs/API_CONTRACT.md`.

## 9. UI copy

- UI copy is in Vietnamese and matches Figma V1 wording. Code, comments, commits and docs are in
  English.
- Show money as `18.000đ` (VND integers, no decimals), times as `17:30–18:30`, and order codes as
  `SM–4281`.

## 10. Definition of done

A change is done only when all of the following are true:

- `npm run lint`, `npm run typecheck` and `npm test` pass for the affected workspace(s).
- The behaviour matches `docs/API_CONTRACT.md` and `docs/DOMAIN.md`. State transitions have tests,
  and the atomic reservation path has a concurrency test.
- The UI matches Figma V1 (FE). Empty, loading and error states are handled.
- There are no secrets, no AI attribution and no unrelated changes. The PR template checklist is
  filled in.
