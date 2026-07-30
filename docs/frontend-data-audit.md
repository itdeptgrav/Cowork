# Frontend Data Audit

Every screen, where its data comes from today, and which `cowork-old-backend`
endpoint should supply it.

No code was changed to produce this.

## Architecture check — where we already stand

The migrated path is **already** the architecture you specified:

```
Component → useQuery → LegacyRepository → legacyFetch
          → https://grav-cms-backend.onrender.com/cowork/*
```

No Next.js backend in that path. `lib/legacy/http.ts` calls the old backend
directly with the Firebase ID token. Seven repository methods work this way
today.

**One thing I built does not match**, and it should be recorded rather than
quietly kept: `app/api/legacy/firestore-health/route.ts`, a Next route that
reads Firestore server-side with the Admin SDK. It exists only to answer "can
the proxy reach Firestore" on the health page. Under this decision the proxy
plan it was built for is cancelled, so the route has no future — it is a
diagnostic with nothing left to diagnose. **Recommend deleting it.**

The other 19 `/api/*` routes pre-date this migration and belong to features
built for the standalone product — Gmail, LiveKit, meetings tokens, music,
help, and the local auth system. They are a separate question from this
migration and are listed at the end.

## Scale

| | |
|---|---|
| Product routes | **58** |
| Distinct repository methods called | **~146** |
| Connected to the old backend | **7** |
| Explicitly unavailable | ~12 |
| Unmapped (throw as unavailable) | ~127 |

## Per-screen

**Source**: `backend` real · `mock` mockRepository/seed · `n/a` no legacy source

### Connected or nearly

| Route | Component | Source | Old backend endpoint | Status |
|---|---|---|---|---|
| `/`, `/home` | `Home` | **backend** (7 of 8 cards) | `/cowork/me`, `/task/list-hierarchy`, `/pmp/:id/dashboard`, `/employee/list`, `/notifications`, `/schedule-meet/list` | ✅ ~85% |
| `/signin` | `SignInForm` | **backend** | Firebase Auth → `/cowork/me` | ✅ done |
| `/people`, `/people/[id]` | `TeamArea` | mock | `/cowork/employee/list`, `/employee/:id`, `/employee/my-managers/:id` | Phase 1 |
| `/team`, `/team/[id]` | `TeamArea` | mock | same + `/pmp/:id/dashboard` | Phase 1 |
| `/profile` | `UserAreas` | mock | `/cowork/me`, `/employee/:id` | Phase 1 |
| `/tasks`, `/tasks/[id]` | `TasksArea`, `TaskDetail` | mock | `/cowork/task/list-hierarchy`, `/task/:id/details`, `/task/:id/full` | Phase 1 |
| `/score`, `/score/c1`–`c4`, `/score/history` | `ScoreArea` | mock | `/cowork/pmp/:id/dashboard`, `/pmp/:id/c1`, `/c2`, `/c1/config` | Phase 1 |
| `/notifications` | `WorkAreas` | mock | `/cowork/notifications` | Phase 2 — **mapper ready** |
| `/meetings`, `/meetings/[id]` | `MeetingsArea` | mock | `/cowork/schedule-meet/list`, `/:meetId` | Phase 2 — **mapper ready** |

### Reachable but unvalidated

| Route | Component | Old backend endpoint | Note |
|---|---|---|---|
| `/goals`, `/goals/[id]` | `WorkAreas` | `/cowork/task/:id/goal-activities` | Endpoint exists; never exercised — no goal task on the test account. **Feeds C2, so must not be mapped from the route file** |
| `/messages`, `/groups` | `MessagesArea`, `CollabAreas` | `/cowork/direct-message/*`, `/group/*` | ~13 endpoints, none validated |
| `/attendance`, `/attendance/history` | `WorkAreas` | `/api/employee/attendance/today`, `/monthly` | **Different auth** — HR JWT, not Firebase |
| `/admin/*` (6 routes) | `AdminArea` | `/cowork/employee/create`, `/change-role`, `/sop/*`, `/band-config` | 39 methods. Mostly writes |
| `/tasks/new` | `NewTaskForm` | `POST /cowork/task/create` | 26-field body |
| `/manager` | `MonitoringArea` | Firestore + LiveKit | Needs the service account |

### No old-backend equivalent — keep unavailable

| Feature | Routes | Finding |
|---|---|---|
| **Projects, milestones** | `/tasks/projects`, `/projects/[id]`, `/projects/new` | **No collection, no endpoint, no model in `cowork-old-backend`.** The new product has projects, members, milestones, activity and task links; legacy has none of it |
| **Workload flow graph** | `SignatureGraph` on `/home` | `/cowork/workload/summary` returns a per-employee table. The graph needs weekly arrivals-vs-departures, which legacy never records |
| **Break budget, timers, presence** | `StatusButton`, `NowCard` | Firestore-only in legacy, written from the browser. **No REST endpoint exists** |
| **Monitoring** | `/manager`, `/team/[id]` | LiveKit + Firestore, no REST |
| **Roles as entities** | `/admin/roles` | Legacy has three strings compared inline. There is nothing to list |
| Music, `/yt` | `/music`, `/yt` | New-product features. Never had a legacy source |
| Mail | `/mail` | Gmail OAuth, built new. Legacy's `cowork_mails` is Firestore-only |

## Mock and seed usage

| Location | What | Runtime reachable? |
|---|---|---|
| `lib/seed/seed.ts` | 64 KB, 33 fixtures — 48 tasks, 6 projects, employees (Maya Ferreira, Tobias Lund), goals, meetings, notifications | **No** |
| `lib/repositories/mock/` | 320 KB, 8 files, localStorage store | **No** — replaced by `setRepository()` at sign-in |
| `lib/repositories/mock/monitoring.ts` | Hardcoded strings: *"Rework rate rose 4 points"*, *"22 minutes idle before the crit"* | **No** |
| Seed imports in components | **Removed.** `MailArea`, `TaskTable`, `MessagesArea` imported the seed's frozen clock; now `useNow()` | — |

**Nothing fake reaches a signed-in user.** `setRepository()` installs
`LegacyRepository` when the session resolves, and no component imports mock data.
What remains is unconnected, not faked.

Both directories still back **686 tests** and should be the last thing removed.

## Recommended order

Your phases, with two adjustments and the reasons.

**Phase 1** — `/profile`, `/people`, `/team`, `/tasks`, `/score`.
All five read methods already connected or one mapper away. `/tasks/[taskId]`
needs `/task/:id/details`, whose envelope key `task` is still **inferred** —
worth validating in the same pass.

**Phase 2** — `/notifications` and `/meetings` are ready now; the mappers exist
and are tested. **Workload cannot be connected** — see above. **Goals should be
validated before mapping**, not after: they carry points feeding C2.

**Phase 3** — remove mock and seed **last**, after the test suite is re-pointed.
Deleting them today costs 686 passing tests and gains nothing at runtime, since
neither is reachable.

## Two decisions I need from you

1. **`app/api/legacy/firestore-health`** — delete it? It was built for the proxy
   plan this decision cancels. Deleting it also removes the health page's
   Firestore check, which would then always read "not checked".

2. **Attendance needs the second credential.** `/api/hr/*` uses a self-issued JWT
   (cookie `auth_token`), not Firebase. Connecting `/attendance` means the
   frontend holding two credentials at once. That is legacy's own design, not
   something this migration introduced — but it is a real decision, and until it
   is made, attendance stays unavailable.

## Pre-existing Next API routes

Not part of this migration; listed so the boundary is explicit.

`/api/auth/*` (8) — the local scrypt system, now vestigial after the Firebase
migration and callable by nothing except `ResetPasswordForm`.
`/api/mail/*` (6) — Gmail OAuth, holds refresh tokens server-side because a
browser must not.
`/api/livekit/token`, `/api/meetings/token` — mint LiveKit tokens; the API
secret cannot reach a browser.
`/api/music/*` (2), `/api/help` — new-product features.

Of these, only `/api/auth/*` is a candidate for removal, and only once
`ResetPasswordForm` is re-pointed at Firebase.
