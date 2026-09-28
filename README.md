# SERENE MANAGEMENT

Web-based hotel property management system (PMS) for single- and multi-property hotel organizations.

**Status: Phase 10 (hardening).** Phases 1–9 are implemented; see [`docs/IMPLEMENTATION_ROADMAP.md`](docs/IMPLEMENTATION_ROADMAP.md). Production installation: [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md).

## Documentation

| Document                                                         | Purpose                                                           |
| ---------------------------------------------------------------- | ----------------------------------------------------------------- |
| [Development Guide](docs/SERENE_MANAGEMENT_DEVELOPMENT_GUIDE.md) | Engineering contract (source of truth)                            |
| [Architecture](docs/ARCHITECTURE.md)                             | Structure, layers, security, performance, testing, open questions |
| [Domain model](docs/DOMAIN_MODEL.md)                             | Entities, relationships, state machines                           |
| [Database design](docs/DATABASE_DESIGN.md)                       | PostgreSQL/Prisma conventions and integrity rules                 |
| [PMS workflows](docs/PMS_WORKFLOWS.md)                           | Every hotel workflow end to end                                   |
| [API conventions](docs/API_CONVENTIONS.md)                       | HTTP contract                                                     |
| [RBAC](docs/RBAC.md)                                             | Permissions and roles                                             |
| [Roadmap](docs/IMPLEMENTATION_ROADMAP.md)                        | Phases and exit criteria                                          |
| [Deployment](docs/DEPLOYMENT.md)                                 | Production install, environment, migrations, bootstrap, health    |
| [Operations](docs/OPERATIONS.md)                                 | Backups, restore drill, migration policy, retention, roles, CI    |

## Stack

Next.js 16 (App Router) · React 19 · TypeScript (strict) · Tailwind CSS v4 · PostgreSQL 18 · Prisma 7 · Redux Toolkit / RTK Query (server state) · Zustand (UI state) · Zod · Vitest.

## Getting started

Requirements: Node.js ≥ 22.12 and a native PostgreSQL 17+ installation (e.g. the Windows installer, service `postgresql-x64-18`, port 5432) including `psql`. Docker is not used.

```bash
npm install
```

```bash
cp .env.example .env
```

Edit `.env`: replace `change-me` in `DATABASE_URL` with a strong password for the app role (16+ characters) and fill in the auth secrets. Then create the role `serene` and the databases `serene_management` and `serene_management_test` (once; prompts for your `postgres` superuser password):

```bash
npm run db:setup
```

```bash
npm run db:deploy
```

```bash
npm run db:seed
```

`db:seed` loads reference data only. For the demo organization set `SEED_DEMO=true` and a strong `SEED_DEMO_PASSWORD` (16+ characters, never printed) in `.env` first; the demo seed is refused when `NODE_ENV=production`.

```bash
npm run dev
```

## Scripts

| Script                    | Does                                                                           |
| ------------------------- | ------------------------------------------------------------------------------ |
| `npm run dev` / `start`   | Next.js                                                                        |
| `npm run build`           | `next build` + compile the operational commands to `dist/ops`                  |
| `npm run typecheck`       | Route type generation + `tsc --noEmit`                                         |
| `npm run lint`            | ESLint (includes architectural import boundaries)                              |
| `npm run test`            | All Vitest suites (unit, database rules on PGlite, integration on the test DB) |
| `npm run verify`          | typecheck → lint → test → production build                                     |
| `npm run db:setup`        | Create/update the app role and databases on native PostgreSQL (run once)       |
| `npm run db:migrate`      | Create/apply a development migration                                           |
| `npm run db:deploy`       | Apply migrations                                                               |
| `npm run db:seed`         | Development seed: reference data, plus demo data with `SEED_DEMO=true`         |
| `npm run ops:seed`        | Production reference data (compiled; no dev dependencies)                      |
| `npm run ops:bootstrap`   | Production first organization + administrator (see docs/DEPLOYMENT.md)         |
| `npm run ops:backup`      | `create` / `verify` / `list` / `restore` database backups (docs/OPERATIONS.md) |
| `npm run ops:maintenance` | Prune expired sessions, tokens, idempotency keys, delivered outbox events      |
| `npm run ops:db-check`    | Database posture: roles, ledger guards, UTC session, migrations                |
| `npm run db:validate`     | Validate the Prisma schema                                                     |

CI (`.github/workflows/ci.yml`) runs format, typecheck, lint, all tests and the build on every push, against a natively installed PostgreSQL.

Scripts invoke tools through `node node_modules/...` on purpose: npm's Windows command shims fail when the project path contains `&`.
