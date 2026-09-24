# SERENE MANAGEMENT

Web-based hotel property management system (PMS) for single- and multi-property hotel organizations.

**Status: Phase 0 (architecture foundation).** No PMS modules are implemented yet. See [`docs/IMPLEMENTATION_ROADMAP.md`](docs/IMPLEMENTATION_ROADMAP.md).

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

## Stack

Next.js 16 (App Router) · React 19 · TypeScript (strict) · Tailwind CSS v4 · PostgreSQL 17 · Prisma 7 · Redux Toolkit / RTK Query (server state) · Zustand (UI state) · Zod · Vitest.

## Getting started

Requirements: Node.js ≥ 22.12, Docker (for PostgreSQL).

```bash
npm install
```

```bash
cp .env.example .env
```

```bash
docker compose up -d
```

```bash
npm run db:deploy
```

```bash
npm run db:seed
```

```bash
npm run dev
```

## Scripts

| Script                            | Does                                                                  |
| --------------------------------- | --------------------------------------------------------------------- |
| `npm run dev` / `build` / `start` | Next.js                                                               |
| `npm run typecheck`               | Route type generation + `tsc --noEmit`                                |
| `npm run lint`                    | ESLint (includes architectural import boundaries)                     |
| `npm run test`                    | All Vitest suites (unit + database rules on PGlite, no Docker needed) |
| `npm run verify`                  | typecheck → lint → test → production build                            |
| `npm run db:migrate`              | Create/apply a development migration                                  |
| `npm run db:deploy`               | Apply migrations                                                      |
| `npm run db:seed`                 | Reference data (currencies, permissions, role templates)              |
| `npm run db:validate`             | Validate the Prisma schema                                            |

Scripts invoke tools through `node node_modules/...` on purpose: npm's Windows command shims fail when the project path contains `&`.
