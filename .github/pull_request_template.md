## What & why

<!-- One or two sentences. Link the Figma V2 frame (V2 / NN) and/or contract section. -->

## Area

- [ ] `apps/api` (BE)
- [ ] `apps/web` (FE)
- [ ] `packages/shared`
- [ ] `docs/` (contract / domain / architecture)
- [ ] tooling / infra

## Checklist

- [ ] Branch is `feat/be-…`, `feat/fe-…`, `fix/…`, `docs/…` or `chore/…`, and targets `main`.
- [ ] Commits and this PR follow Conventional Commits and contain **no AI attribution**.
- [ ] API changes landed in `docs/API_CONTRACT.md` in an earlier, separate commit, and the code
      matches it.
- [ ] `npm run lint`, `npm run typecheck` and `npm test` pass.
- [ ] State transitions follow `docs/DOMAIN.md`, and new transitions are tested.
- [ ] Food safety: no publish without the safety checklist, no extended windows, and nothing
      implies that the QR is a safety certificate.
- [ ] Privacy: no new personal data beyond what is needed, nothing precise logged, and store
      scoping is respected.
- [ ] No secrets committed (`.env.example` only).
- [ ] FE: matches Figma V2 and handles empty, loading and error states. Screenshots are below.

## Screenshots / notes
