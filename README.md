# SaveMeal: LASTBITE

*Give good food a second chance.* LASTBITE is a map-first mobile PWA. Verified cafés, bakeries,
canteens and individual sellers post surplus food that is still safe. Students reserve a portion and
pick it up at the counter with a QR code. There is no delivery, no hardware and no AI in the MVP. It
is piloting near a university in Đà Nẵng (Smart Campus 2026).

| Doc | Purpose |
|---|---|
| [CLAUDE.md](CLAUDE.md) | Mandatory working rules: git, contract-first, food safety, privacy |
| [CONTRIBUTING.md](CONTRIBUTING.md) | Setup, branches, commits, PR checklist |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Monorepo layout, runtime and local dev |
| [docs/DOMAIN.md](docs/DOMAIN.md) | Entities, state machines, safety checklist, decisions |
| [docs/API_CONTRACT.md](docs/API_CONTRACT.md) | REST `/api/v1` contract and Figma screen map |

## Quick start

```bash
git config core.hooksPath .githooks
cp .env.example .env
docker compose up -d db
npm install
```

The apps (`apps/web` Next.js, `apps/api` NestJS + Prisma) are scaffolded in follow-up branches.
