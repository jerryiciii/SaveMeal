# Contributing to SaveMeal (LASTBITE)

Read [`CLAUDE.md`](CLAUDE.md) first. Its rules apply to people and AI sessions alike.

## One-time setup

```bash
git config user.name  "<your name>"
git config user.email "<your email>"
git config core.hooksPath .githooks   # enables commit-msg + pre-push hooks
npm install                           # Node >= 22
cp .env.example .env                  # then fill local values; never commit .env
docker compose up -d db               # PostgreSQL 16 on localhost:5432
```

On Windows, run the hooks from Git Bash or let Git for Windows run them. They are POSIX `sh`
scripts.

The hooks do the following:

- `commit-msg` rejects AI attribution (`Co-Authored-By: Claude`, "Generated with Claude Code" and
  similar) and subjects that are not Conventional Commits.
- `pre-push` rejects any push to `main`.

## Workflow

1. Sync: `git fetch origin && git switch main && git pull --ff-only`.
2. Branch from `main`: `feat/be-<topic>`, `feat/fe-<topic>`, `fix/…`, `docs/…`, `chore/…`.
3. FE and BE sessions each work in their own worktree:
   ```bash
   git worktree add ../SaveMeal-be -b feat/be-auth origin/main
   git worktree add ../SaveMeal-fe -b feat/fe-map origin/main
   ```
4. **Contract first.** If the API changes, commit the change to `docs/API_CONTRACT.md` first, on
   its own (`docs(contract): add …`), then implement it.
5. Make small commits, run lint, typecheck and tests, then push your branch
   (`git push -u origin <branch>`).
6. Open a PR into `main` on GitHub and fill in the template. The repo owner reviews and merges.
   Never push to `main`, and never force-push `main`.

## Commit messages

```
type(scope): imperative summary (≤ 72 chars)

Optional body: why, not what.
```

- Types: `feat` `fix` `docs` `style` `refactor` `perf` `test` `build` `ci` `chore` `revert`.
- Scopes: `api` `web` `shared` `contract` `domain` `infra` `deps`.
- Examples: `feat(api): reserve batch portions atomically`, `docs(contract): add pickup lookup`.
- Do not add trailers that credit AI tools.

## PR checklist

The PR checklist is in [`.github/pull_request_template.md`](.github/pull_request_template.md).
Summary:

- [ ] The branch name and commits follow the rules, with no AI attribution.
- [ ] Any contract change is its own earlier commit, and the code matches the contract.
- [ ] `npm run lint`, `npm run typecheck` and `npm test` pass.
- [ ] Safety rules (checklist before publishing, QR is not a safety certificate) and privacy rules
      are respected.
- [ ] UI matches Figma V2 (FE). Screenshots are attached for UI changes.
- [ ] No secrets, and no unrelated changes.

## Recommended GitHub settings (repo owner)

- Protect `main`: require a PR, block force pushes and deletions.
- Squash-merge or rebase-merge. Make sure the PR title follows Conventional Commits.
