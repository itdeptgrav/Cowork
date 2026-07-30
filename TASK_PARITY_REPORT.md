# Task parity — old Cowork vs new Cowork

Traced 2026-07-29 by reading call sites in both repositories, not type
declarations. Every row cites the file and line the behaviour was read from.

## The architectural finding that reframes everything

**Task reads and task writes use different systems.**

| Direction | System | Evidence |
|---|---|---|
| Reads | Firestore listeners, direct from the browser | `app/coworking/tasks/page.js` runs 22 `onSnapshot` calls |
| Writes | Backend REST API | `lib/mediaUploadApi.js:154` — `POST /cowork/task/create`; **zero** `fetch` calls and zero task writes in `CreateTaskModal.jsx` |

The earlier characterisation of legacy as "primarily a Firestore client" holds
for reads and is wrong for task writes. Anything the new app writes must go
through the API — a direct Firestore write would skip the approval gates,
the per-assignee priority computation, the server-generated `taskId`, and the
notification fan-out, all of which live in the route handler and its service.

**A second finding of the same kind:** two files register `POST /task/create`.
`server.js:1301` mounts `taskForward.js`, `server.js:1315` mounts
`taskTree.routes.js`. Express takes the first, so **`taskTree.routes.js:95` is
shadowed dead code**. Reading it would have produced a schema the running
system does not use.

**Third:** the old task page does **not** use `useCoworkTaskList`. That hook —
which I ported verbatim and built `listTasks` on — belongs to a different
surface. The page has its own loader (`page.js:3856`) and its own tab
predicates. The base queries happen to agree; the tab semantics did not.

---

## 1 · Task listing

### Queries — MATCH

| Role | Old (`page.js:3860-3868`, `4031-4037`, `3915-3927`) | New (`index.ts:425-433`) | Match |
|---|---|---|---|
| Employee | `assigneeIds array-contains me` | same | ✅ |
| TL | `assignedBy == me` + `assigneeIds array-contains me` | same | ✅ |
| CEO | `assignedBy == me` + `assigneeIds array-contains me` + `approverId == me` | same | ✅ |
| Order | `orderBy updatedAt desc, limit(100)` on each | same | ✅ |
| Collection | `cowork_tasks` | same | ✅ |
| Employee id | raw `employeeId` string | raw, before directory resolution | ✅ |

### Tab predicates — FOUR MISMATCHES, ALL FIXED

| Tab | Old (`page.js:6016-6040`) | New before | Match | Fixed |
|---|---|---|---|---|
| Assigned to Me | self-assigned → `assignees∋me && assignedBy==me`; else `assignees∋me && assignedBy!=me` | `status!=="draft" && assignees∋me` | ❌ | ✅ |
| Created by Me | self-assigned → `approverId==me \|\| visibleTo∋me`; else `assignedBy==me`; **or** `tlHoursSetBy==me` | `createdById==me && !assignees∋me` | ❌ | ✅ |
| Self Tasks | `isSelfAssigned && assignees∋me` | **absent** | ❌ | ⬜ not built |
| Submitted | `SUBMITTED_LIFECYCLE` + six-way reviewer check (`page.js:1015`) | **absent** | ❌ | ⬜ not built |

Three specific defects behind those rows:

- **`status !== "draft"` filtered nothing.** The engine has never written a
  `draft` status. Its held states are `pending_tl_approval`,
  `pending_department_approval`, `pending_tl_hours`,
  `repeat_pending_confirmation` — none was excluded. A no-op that read as a
  safeguard.
- **`assigned_out` required `!assignedToMe`**, so a task you created *and* work
  on disappeared from Created. Legacy excludes only self-assigned tasks there.
- **`tlHoursSetBy` was not read at all**, so a TL who set the hours never saw
  the task under Created.

### Still divergent — not yet fixed

| Behaviour | Old | New | Impact |
|---|---|---|---|
| Root-only filtering | employees see roots + forwarded + orphans; TL/CEO see roots only (`page.js:6010-6012`) | no filtering | subtasks appear as top-level rows |
| Descendant match | a parent counts as mine if a non-forwarded descendant is (`page.js:6021-6031`) | absent | parents of my subtasks missing |
| Folder-parent backfill | employees `getDoc` absent parents (`page.js:3872-3910`) | absent | folder structure missing |
| Pagination | 100 per listener, no cursor | `limit(100)` then client slice | equivalent for <100 |

### Sorting — MISMATCH, FIXED

Old orders by `assigneePriorities[me] ?? priority ?? 999` (`page.js:1643`).
New read `priority` alone — the **first assignee's** rank. On a shared task
this ordered your list by a colleague's queue position.

---

## 2 · Task creation — schema

`POST /cowork/task/create` → `taskForward.js:135` → `taskForward.service.js:224`.
The document is ~70 fields. What matters for parity:

| Field | Source of truth | Note |
|---|---|---|
| `taskId` | `_generateTaskId()`, server | never client-supplied |
| `assignedBy` | `req.coworkUser.employeeId`, from the verified token | **client `createdBy` is ignored** — not even destructured |
| `status` | computed `initialStatus` | **client-sent `status` is ignored** |
| `dueDate` | forced `null` (`taskForward.js:138`) | "deadline is always set by employee after assignment" |
| `priority` | per-assignee open-task count + 1 | `assigneePriorities` map, one entry per assignee |
| `assigneeIds` | `[]` when a department gate fires | target held in `pendingAssigneeId` |
| `createdAt` | `serverTimestamp()` + `createdAtISO` | two fields |
| `quarter` / `year` | server clock | feeds PMP |
| `etcHours` | client, coerced `Number()` | |
| `c1` | zeroed sub-document | scoring scaffold |

**Consequence for listing:** a task held at `pending_department_approval` has
**empty `assigneeIds`**, so `assigneeIds array-contains me` cannot find it. The
old page runs a dedicated listener for it (`page.js:3596`). New Cowork has
none, so cross-department tasks awaiting approval are invisible.

**Status vocabulary — MISMATCH, FIXED.** Seven real statuses were absent from
`toTaskStatus` and fell through to `assigned`, which tells the assignee to
start work on something nobody approved:

| Legacy status | Was | Now | Old app's grouping |
|---|---|---|---|
| `pending_tl_approval` | assigned | pending_approval | held |
| `pending_department_approval` | assigned | pending_approval | held |
| `pending_tl_hours` | assigned | pending_approval | held |
| `repeat_pending_confirmation` | assigned | pending_approval | held |
| `confirmed` | assigned | in_progress | In Progress tab (`page.js:6053`) |
| `pending_deadline_approval` | assigned | assigned | Open tab (`page.js:6052`) |
| `deadline_approved` | assigned | assigned | Open tab |

Four branches in that switch — `draft`, `pending`, `approved`, `rejected` — are
statuses legacy never writes. Dead vocabulary from the mock era.

---

## 3 · Assignment flow — READ-ONLY AUDIT

Approval gates in `taskForward.js:164-286`, all server-side:

1. **Employee → TL assignee** ⇒ `pending_tl_approval`
2. **Cross-department** (non-CEO, single assignee, no parent) ⇒ resolves an
   approver on each side; falls back to `E000`; ⇒ `pending_department_approval`
3. **CEO → employee** ⇒ receiver-side approver unless the CEO is their manager
4. **Repeat tasks** ⇒ `repeat_pending_confirmation`
5. **Deadline-based to another team** ⇒ `pending_tl_hours`

Gates 1–5 are unimplemented in new Cowork: it has no write path at all.
Verified: the new repository throws `NotConnectedError` for every task
mutation. **No silent fallback, no mock write.**

---

## 4-7 · Lifecycle, timer, notifications, real-time — NOT EXECUTED

These require an authenticated session as GR0045 in both apps simultaneously.
I hold no Firebase token and cannot sign in as you.

I can drive them from the backend the way I captured the score payload, but
unlike `getDashboardData` these are **writes to production**, and
`svc.createTask` calls `_notifyMany`, which **sends notification emails to real
employees** (`taskForward.service.js:373`). I have not run them. Say the word
and I will, or run them in the UI yourself and I will verify both sides.

What is already verifiable statically:

- **Notifications source — MATCH.** Both read `cowork_notifications` where
  `recipientEmployeeId == me`, `orderBy createdAt desc`, `limit(50)`. New
  Cowork previously used `GET /cowork/notifications` for the list while the
  bell used the Firestore listener — two sources for one fact. Now one, matching
  legacy.
- **Timer** — `useTaskTimer` is a verbatim port; writes go to the same
  endpoints.
- **Real-time** — new Cowork's `listTasks` is one-shot `getDocs`, not
  `onSnapshot`. Old Cowork updates live; new Cowork updates on query
  invalidation. **This is a genuine behavioural difference** and will show up
  in any two-window test as "new Cowork didn't update".

---

## 8 · Hidden mock or fallback data

Searched the task path for fallbacks that could mask a failure.

| Check | Result |
|---|---|
| Fabricated task rows | none |
| `catch` swallowing query errors | none — `#taskDocuments` raises, deliberately, so a missing composite index surfaces |
| Placeholder assignees | none — an unresolved assignee is omitted, the task still shows |
| Invented statuses | **found**: `draft`/`pending`/`approved`/`rejected` branches legacy never writes |
| Invented denominators | none |
| Mock repository still wired | no — `SessionProvider` installs `LegacyRepository` |

---

## Fixes applied

| # | Fix | File |
|---|---|---|
| 1 | Per-person rank `assigneePriorities[me] ?? priority` | `taskMap.ts:195` |
| 2 | Seven real statuses mapped; `confirmed` → in_progress | `taskMap.ts:53` |
| 3 | `mine` matches the old Assigned predicate | `index.ts` |
| 4 | `assigned_out` matches the old Created predicate | `index.ts` |
| 5 | `assigneePriorities`, `tlHoursSetBy`, `isSelfAssigned`, `visibleTo` read off the wire | `tasks.ts` |

10 regression tests in `taskParity.test.ts`, each citing its legacy line.

## Outstanding, in priority order

1. **Live-update parity** — `listTasks` is one-shot; old Cowork is push.
2. **Root-only filtering + descendant match** — subtask rows surface wrongly.
3. **Submitted and Self Tasks tabs** — absent.
4. **`pending_department_approval` listener** — those tasks have no assignees
   and are unreachable by the current queries.
5. **Write path** — no task mutation is connected.
6. **Folder-parent backfill** — employees lose folder structure.
