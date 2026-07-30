# Migration Status

Complete mapping of `CoworkRepository` against `cowork-old-backend`.

No code changed to produce this.

## Totals

| | Count | Implemented |
|---|---:|---:|
| Interface methods | **187** | 27 |
| **Reads** (`list*`, `get*`) | **93** | **18** |
| **Writes** | 94 | 9 |

**Reads are what make a screen blank; writes are what make a button fail.** So
reads come first throughout — a screen that displays real data and cannot yet be
edited is useful, and the reverse is not.

## The finding that shapes the plan

**75 unimplemented reads. Roughly a third of them have no backend to connect
to.** They are not blocked on effort; they are features `cowork-old-backend` does
not have.

| Feature | Unimpl. reads | Backend exists? |
|---|---:|---|
| Tasks | 16 | Partly — 1 list endpoint; detail/chat/approvals unvalidated |
| Other/infra | 15 | Mixed |
| Admin | 11 | Partly — SOP and band config yes; workflows/rules **no** |
| Collab | 8 | Yes — `/direct-message/*`, `/group/*`, unvalidated |
| Score | 7 | Partly — dashboard yes; history/units/ledger unvalidated |
| Attendance | 6 | Yes, but **HR JWT**, a second credential |
| Meetings | 4 | Yes — `/schedule-meet/*` |
| People | 4 | Yes — `/employee/*` |
| Projects | 2 | **No. No collection, model or route** |
| Music | 2 | **No. New-product feature** |

## Per-feature mapping

### ✅ Connected (18 reads, 9 writes)

| Method | Backend route | Source |
|---|---|---|
| `getViewer` | `GET /cowork/me` | Firestore `cowork_employees` |
| `listEmployees`, `getEmployee`, `getCurrentEmployee` | `GET /cowork/employee/list` | Firestore `cowork_employees` |
| `getScoreOverview` | `GET /cowork/pmp/:id/dashboard` | Mongo, via `pmpService` |
| `listTasks` | `GET /cowork/task/list-hierarchy` | Firestore `cowork_tasks` |
| `listNotifications` | `GET /cowork/notifications` | Firestore |
| `listMeetings` | `GET /cowork/schedule-meet/list` | Firestore |
| `listWorkloadRows` | `GET /cowork/workload/summary` | Mongo |
| `listRoles`, `listProjects`, `listReviewQueue`, `listPriorityConflicts`, `getWorkloadFlow`, `getActiveTimer`, `listPendingAcknowledgements`, music ×8, demo ×2 | — | **empty by design** — see below |

Also live, **bypassing the repository entirely** (ported Firestore listeners):

| Component | Hook | Collection |
|---|---|---|
| `TopBar` bell | `useCoworkNotifications` | `cowork_notifications` |
| `StatusButton` | `useDutyStatus` | `cowork_duty_status` |
| *(copied, unwired)* | `useTaskTimer`, `useCoworkTaskList` | `cowork_task_timers`, `cowork_tasks` |

### Home — highest value, nearly done

| Card | Method | Route | Status |
|---|---|---|---|
| Greeting, Stats | `getViewer`, `getCurrentEmployee` | `/cowork/me` | ✅ |
| ScoreStat | `getScoreOverview` | `/cowork/pmp/:id/dashboard` | ✅ |
| WorkMix, NowCard, TeamLoad | `listTasks` | `/cowork/task/list-hierarchy` | ✅ |
| AttentionCard | `listNotifications` | `/cowork/notifications` | ✅ |
| NextCard | `listMeetings` | `/cowork/schedule-meet/list` | ✅ |
| SignatureGraph | `getWorkloadFlow` | **none** | ✗ legacy records no weekly flow |
| NowCard timer | `getActiveTimer` | **none** | ⚠ Firestore-only — **ported hook exists** |

**7 of 8 cards connected.** Highest remaining value: wire `useTaskTimer` so the
timer works.

### Tasks — 16 unimplemented reads

| Method | Route | Status |
|---|---|---|
| `listTasks` | `GET /cowork/task/list-hierarchy` | ✅ |
| `getTask` | `GET /cowork/task/:id/details` | envelope key `task` **inferred** |
| `listTaskChat` | `GET /cowork/task/:id/chat` | unvalidated |
| `listApprovals`, `listSubmissions`, `listProposals` | `/task/:id/full` | unvalidated |
| `getActiveTimer`, `listWorkCommits` | Firestore only | **ported hook** |
| `listPendingAcknowledgements` | **none** | ✅ empty — no legacy concept |
| Writes: create, confirm, start, submit, review, rework, deadline ×10 | `taskForward.js` — all exist | not wired |

**Every task write already has an endpoint.** `taskForward.js` covers 56 routes.

### People — 4 unimplemented reads, all served

| Method | Route |
|---|---|
| `listEmployees`, `getEmployee` | ✅ `GET /cowork/employee/list`, `/employee/:id` |
| `listReportingRelationships` | `GET /cowork/employee/my-managers/:id` — **N+1**, one call per person |
| `listDepartments` | `GET /api/hr/departments` — **HR JWT** |
| `listRoles` | **none** — legacy has three strings, no entities |

### Score — 7 unimplemented reads

| Method | Route | Status |
|---|---|---|
| `getScoreOverview` | `GET /cowork/pmp/:id/dashboard` | ✅ |
| `listScoreUnits`, `listLedger`, `listScoreHistory` | `/pmp/:id/c1`, `/c2`, `/c1/config` | **unvalidated** |
| `listConductEvents` | `GET /cowork/sop/bleach/:employeeId` | mapper written, unwired |
| `listGoals` | `/cowork/task/:id/goal-activities` | **never exercised** — feeds C2 |

⚠ **Never recompute a score.** `pmpService` owns every formula and cites
`CW-DEV-PMP-01 v1.0`, which is in neither repository.

### Notifications / Meetings — mappers ready

`listNotifications` and `listMeetings` are connected and tested.
`markNotificationRead` → `PATCH /cowork/notifications/read-all` exists, unwired.

### Attendance — blocked on a credential

All 6 reads exist behind `/api/hr/*` and `/api/employee/attendance/*` — which use
a **self-issued JWT** (cookie `auth_token`), not Firebase. Connecting them means
the frontend holding two credentials. Legacy's own design; a decision, not a task.

The exception: `GET /cowork/deadline-availability/blocked-dates` takes the
**Firebase** token and returns holidays plus approved leave. Connectable today.

### Admin — 11 unimplemented reads

| Have a backend | No backend |
|---|---|
| SOP rules, folders, ledger, bands (`/cowork/sop/*`, `/band-config`) | Approval workflows |
| Policies (`/api/hr/policy`, HR JWT) | Scoring rules |
| Employee admin (`/employee/create`, `/change-role`) | Organisation settings |

### Genuinely new — no backend, keep unavailable

| Feature | Methods | Finding |
|---|---:|---|
| **Projects, milestones** | 9 | No collection, model or route anywhere |
| **Music** | 11 | New-product feature |
| **Priority acknowledgements** | 2 | Only `acknowledge` in legacy is the Accountant module |
| **Workload flow graph** | 1 | Legacy has no weekly arrival/departure counts |
| **Demo tooling** | 2 | Prototype-only |
| **Break budget, monitoring** | ~8 | Firestore-only, no REST |

**~33 methods will never connect** without backend work that is out of scope.

## Plan, in priority order

**1 · Home — finish it.** Wire `useTaskTimer` (already copied). 8/8 cards.

**2 · Tasks — the largest win.** Wire `useCoworkTaskList` (already copied) into
`TasksArea`. Validate `/task/:id/details` for the detail page. Then task writes,
which all have endpoints.

**3 · People.** `listEmployees` connected; add `listReportingRelationships`
knowing it is N+1.

**4 · Score.** Validate `/pmp/:id/c1` and `/c2` **before** mapping — these feed
appraisals.

**5 · Notifications & meetings.** Mappers exist; wire the screens.

## Two rules to hold

**Reads before writes.** A read shows real data; a write that half-works
corrupts it.

**Validate before mapping, for anything touching a score.** Eleven envelope keys
were inferred from route files, and a wrong one renders an empty screen with no
error. Every score mapping must be written against a real response.
