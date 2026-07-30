# Project Structure

Where things live, and where new things go.

## Tree

```
cowork/
├── app/                    ROUTING ONLY — Next.js App Router
│   ├── api/                route handlers (server)
│   ├── <route>/page.tsx    thin: imports one feature component
│   ├── layout.tsx  globals.css
│
├── components/
│   ├── ui/                 REUSABLE primitives — Panel, Button, Chip, Avatar, Icons
│   ├── layout/             app chrome, used on every route
│   │   ├── shell/          TopBar, AppShell, ThemeToggle, ProfileSwitcher
│   │   └── help/           help assistant, guided tour
│   └── features/           BUSINESS FEATURES — one folder per product area
│       ├── admin/ auth/ dashboard/ mail/ meetings/ messages/
│       ├── monitoring/ music/ notifications/ projects/ score/
│       └── settings/ status/ tasks/ team/
│
├── lib/                    INFRASTRUCTURE AND PLATFORM
│   ├── domain/             shared types only — no logic, no imports upward
│   ├── rules/              PURE business rules (tasks/ meetings/ scoring/)
│   ├── repositories/       types.ts = interface · mock/ = implementation
│   ├── server/             SERVER-ONLY — sessions, identity store, crypto
│   ├── integrations/       external services (livekit/ mail/)
│   ├── auth/               capabilities, hierarchy, permission predicates
│   ├── config/ hooks/ utils/ status/ help/ music/
│   └── seed/               fixture data
│
├── docs/
│   ├── architecture/       living decisions — DESIGN, PRODUCT, MIGRATION_DECISIONS
│   ├── specs/              behaviour specs — TASK_LOGIC, SCORING_LOGIC, PERMISSIONS
│   └── history/            point-in-time reports; not maintained
│
├── scripts/  public/  middleware.ts
└── README.md  CLAUDE.md  package.json  tsconfig.json  next.config.ts
```

## Boundaries

| Folder | Contains | Never contains |
|---|---|---|
| `app/` | routes, API handlers | business logic, UI implementation |
| `components/ui/` | primitives used by 2+ features | anything feature-specific |
| `components/layout/` | chrome present on every route | page content |
| `components/features/` | one product area's UI | reusable primitives, infrastructure |
| `lib/domain/` | types | logic, side effects |
| `lib/rules/` | pure functions, fully testable | I/O, React, repositories |
| `lib/repositories/` | the data seam | UI, business rules |
| `lib/server/` | `import "server-only"` modules | anything a client component imports |
| `lib/integrations/` | third-party service clients | product rules |

## Where new code goes

**A new page** → `app/<route>/page.tsx` (3 lines, imports a feature component) + `components/features/<feature>/`.

**A new business rule** → `lib/rules/<area>/`. Pure function, test beside it. Never inside a component — the rule must be callable from a future server.

**A new external service** → `lib/integrations/<service>/`. Server-side if it holds credentials.

**Data access** → extend `CoworkRepository` in `lib/repositories/types.ts`, then implement in `mock/`. Components never touch the store.

**A shared UI primitive** → `components/ui/`, only once a second feature needs it. Until then it lives with its feature.

## Naming

- folders: lowercase, one word where possible
- React components: `PascalCase.tsx`
- hooks: `useSomething.ts`
- tests: beside the code — `hierarchy.ts` → `hierarchy.test.ts`
- server-only modules start with `import "server-only";`

## Two rules that matter most

**Business rules are pure and live in `lib/rules/`.** They are enforced today in the repository and will be re-run server-side after the database migration. A rule embedded in a component cannot make that move.

**`lib/server/` never reaches a client component.** Those modules hold session secrets and encryption keys. `import "server-only"` makes a violation a build error.
