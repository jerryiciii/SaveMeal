# CLAUDE.md — rules for every Claude session in this repo

LASTBITE (repo: SaveMeal) is a map-first mobile PWA where verified sellers post surplus food that is
still safe, and students reserve portions and pick them up at the counter by QR. No delivery, no
hardware, and no AI in the MVP. These rules are **mandatory**. If a task conflicts with them, stop
and ask the user. Do not work around them.

## 1. Sources of truth (in priority order)

1. `docs/API_CONTRACT.md`: every endpoint, payload, error code and state transition.
2. `docs/DOMAIN.md`: entities, state machines, the atomic reservation rule and the safety checklist.
3. Figma **V2** page `19:23` "V2 · LASTBITE — Sắc màu & Liquid Glass" (file `yi47xwMJLLdMuiNEVh5Tna`)
   is the UI source of truth. Page `0:1` (V1) is archived. Do not build from it.
4. The concept paper (Google Doc `1ATLucNflZVs9cqfspVfIaZFR6b5d_toVrAcym4XqBlw`): product rules,
   §8 safety and §13 privacy.

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

## 6. Food safety rules (spec §8). These are product rules, not options.

- **No publish without the safety checklist.** A batch can reach `PUBLISHED` only from
  `SAFETY_CHECKED`, with every checklist item confirmed by a store member and the system checks
  passing (see `docs/DOMAIN.md` §5). Do not build shortcuts, admin overrides or "skip" buttons.
- Only **verified** stores can publish. Only allowed categories can be listed. Expired food, spoiled
  food, food kept outside its allowed storage conditions and leftovers from other customers are
  never listed.
- **Never extend** a pickup window, a best-before time or a safety window after publishing.
- **The QR or short code only confirms pickup. It is not a safety certificate.** UI copy must never
  suggest otherwise (no "an toàn 100%", "đã kiểm định" or similar).
- **No AI or automated logic decides whether food is safe.** It also never edits expiry times and
  never generates allergen information. Only the seller confirms safety. The platform only
  enforces the rules.
- An `UNSAFE_FOOD` incident pauses the batch immediately. `REMOVED_UNSAFE` cancels every active
  reservation and notifies the buyers.
- No fake scarcity or pressure tactics in notifications or UI (spec §6.1).

## 7. Privacy rules (spec §13)

- Collect only what pickup needs: phone or email, and a display name. Do not ask for birthdays,
  student IDs or addresses.
- **The buyer's location is chosen by the buyer and is never stored server-side.** It is sent per
  request and must not be logged at full precision (round to 2 decimals in logs).
- Store-scoped access: store members see only their own store's reservations. They see the buyer's
  display name and order code, but never the buyer's phone or email.
- Never share a student's purchase history with other stores or partners.
- Account deletion must work (`DELETE /me`), and it anonymises personal data.
- Research exports and public stats are **aggregated and anonymised**. They never contain names,
  phones, emails, exact coordinates or raw user IDs.
- Strip EXIF/GPS metadata from every uploaded image.

## 8. Secrets and config

- No secrets in git. Commit only `.env.example` files, with placeholder values. `.env*` is
  git-ignored.
- Feature flags (`PAYMENTS_ENABLED`, `GOOGLE_LOGIN_ENABLED`) default to **off**. The pilot uses
  pay-at-counter.

## 9. UI copy

- UI copy is in Vietnamese and matches Figma V2 wording. Code, comments, commits and docs are in
  English.
- Show money as `18.000đ` (VND integers, no decimals), times as `17:30–18:30`, and order codes as
  `LB–4281`.

## 10. Definition of done

A change is done only when all of the following are true:

- `npm run lint`, `npm run typecheck` and `npm test` pass for the affected workspace(s).
- The behaviour matches `docs/API_CONTRACT.md` and `docs/DOMAIN.md`. State transitions have tests,
  and the atomic reservation path has a concurrency test.
- The UI matches Figma V2 (FE). Empty, loading and error states are handled.
- There are no secrets, no AI attribution and no unrelated changes. The PR template checklist is
  filled in.
