# Task parity — final report

Follows `TASK_PARITY_REPORT.md`. Verify: **exit 0, 671 tests**.

| # | Feature | Old implementation | New implementation | Status | Evidence |
|---|---|---|---|---|---|
| 1 | Live updates | `onSnapshot` × 22 (`page.js`) | `onSnapshot` on the same 3 role-scoped queries → `notifyRepositoryChanged()` | ✅ Fixed | `taskWatch.ts` |
| 2 | Assigned to Me | `page.js:6016` | matching predicate | ✅ Fixed | `taskParity.test.ts` |
| 3 | Created by Me | `page.js:6033` | matching predicate + `tlHoursSetBy` | ✅ Fixed | `taskParity.test.ts` |
| 4 | Self Tasks | `page.js:6040` | `isSelfAssigned && assignees∋me` | ✅ Added | `taskScopes.test.ts` |
| 5 | Submitted | `page.js:1015` | 6-stage lifecycle + 5 reviewer clauses + CEO | ✅ Added | `taskScopes.test.ts` |
| 6 | Per-person rank | `assigneePriorities[me] ?? priority` | same | ✅ Fixed | `taskParity.test.ts` |
| 7 | Status vocabulary | 7 real statuses | all mapped | ✅ Fixed | `taskParity.test.ts` |
| 8 | Lifecycle fields | `taskForward.service.js` | read-only, mapped | ✅ Verified live | probe below |
| 9 | Timer | `cowork_task_timers` + `cowork_timer_events` | verbatim port | ⚠️ Not executed | — |
| 10 | Root-only filtering | role-dependent | absent | ❌ Outstanding | — |
| 11 | Write path | `POST /cowork/task/*` | throws `NotConnectedError` | ❌ Outstanding | — |

---

## 1 · Real-time sync — fixed

New Cowork now attaches `onSnapshot` to the same three role-scoped queries it
reads (`taskWatch.ts`), and each push calls `notifyRepositoryChanged()` —
the invalidation signal `lib/repositories/events.ts` already defines, and which
that file explicitly anticipates being satisfied "from a socket or a poll".

**Every tab becomes live at once**, because they are all `useQuery` calls over
the same repository: Assigned to Me, Created by Me, Self Tasks, Submitted,
status changes and assignment changes all re-run on any push. No component,
hook or query was modified.

Rejected alternative: turning `listTasks` into a subscription. That means a
second data path beside `useQuery`, every task surface rewritten, and the
promise-based contract broken for one caller — same result, far more moving
parts.

Two details that matter:

- **First delivery is skipped.** Firestore sends current contents on attach;
  invalidating there would re-run every task query once per listener for data
  just read.
- **Listeners are stopped before sign-out**, and any previous watch is stopped
  before a new one starts. A leaked listener keeps a permission-denied query
  retrying and holds the previous person's employee id at a shared desk.

## 2 · Tabs — a correction to the brief

You asked for six tabs. **Old Cowork has four** (`page.js:7075-7078`):
Assigned to Me · Created by Me · Self Tasks · Submitted. The other two are a
different axis, and making them tabs would have been new logic:

- **Drafts** is a collapsible *section inside* Assigned and Created
  (`page.js:8069`, `:8123`), holding `senderTimerWindowSecs > 0 &&
  !deadlineWindowSecs && status ∈ {open, not_started}` (`page.js:8051`) — a
  sender-proposed timer window the receiver has not yet agreed. It has nothing
  to do with a `draft` status, which the engine never writes.
- **Completed** is a value of the separate `viewFilter` axis — `status ===
  "done"` (`page.js:6102`) — already expressible as `status: ["completed"]` on
  any scope. A scope would give two ways to ask one question.

So: four scopes implemented, and the other two left on the axis they belong to.
Say the word if you want Drafts surfaced as a section.

**Mock leak closed.** Adding two scopes to the union made both fall past the
mock's `if/else` chain and return *every task in the organisation* — the exact
leak the `all` branch was written to close. They now return empty.

## 3 · Lifecycle — executed against production, then cleaned up

One task, GR0045 → GR0045, walked through every transition and deleted.
Self-assignment was deliberate: `_notifyMany` emails recipients, and with
assigner and assignee the same person the only notification went to your own
account. Log confirms `to 1 recipient(s): [GR0045]`; cleanup confirms
`task doc exists after delete = false`.

| Step | `status` | `completionStatus` | Other field changes |
|---|---|---|---|
| created | `open` | absent | `progressPercent: 0`, `confirmedBy: []` |
| confirmed | `open` | absent | `confirmedBy: ["GR0045"]` |
| started | `open` | absent | `startedAt` set |
| progress 60% | `open` | absent | `progressPercent: 60` |
| submitted | `open` | `submitted` | `completionSubmission.submittedBy` |
| approved | `done` | `tl_final_approved` | `progressPercent: 100`, `tlReview.approved: true` |

**`status` stays `open` through the entire review cycle** — only
`completionStatus` moves. This is exactly why `toTaskStatus` consults
`completionStatus` first, and the run confirms that ordering is required, not
merely defensive.

Three findings from the run:

1. **`assignedByRole` is not stable.** I passed `"employee"`; the document
   holds `"tl"`. `_reviewFlow` (`taskForward.service.js:1160-1172`) self-heals
   — it reads the assigner's real role from `cowork_employees` and writes it
   back over `assignedByRole`, `rootCreatedByRole`, `createdByTl`,
   `createdByCeo` on first review. Anything caching the creation-time role will
   disagree after the first review. **GR0045 is a TL**, which is also why the
   TL query pair applies to your session.
2. **`hoursCompleted` is dead on the task document.** Written once as `0`
   (`:307`) and updated *nowhere* in the backend — a whole-repo grep returns
   that single line. Hours live in `cowork_task_timers`. Any UI reading
   `hoursCompleted` shows a permanent zero in both apps.
3. **`assigneePriorities` was `{}` and `priority` was the service default 5.**
   Not a defect — my probe called the *service*, bypassing the *route* that
   computes them (`taskForward.js:296-303`). **Scope limit: this run validates
   the service-level lifecycle, not route-level creation** — the approval
   gates, `initialStatus` computation and per-assignee priority map were not
   exercised.

## 4 · Timer — NOT executed

`useTaskTimer` writes to `cowork_task_timers/{employeeId}/sessions` and
`cowork_timer_events/{employeeId}/logs` — Firestore directly, never the task
document. The hook is a verbatim port, so the write shapes match by
construction.

I did not run start/pause/resume/stop. Unlike the lifecycle probe these writes
land in *your own* attendance and duty-status record, which feeds C4 and
therefore your score — the number we spent the previous session getting
correct. A scripted timer session would move it. Run it in the UI and I will
verify both sides, or say so and I will script it.

## Outstanding

1. **Root-only filtering and descendant matching** — subtasks surface as
   top-level rows; parents of my subtasks are missing (`page.js:6010-6031`).
2. **`pending_department_approval` tasks are unreachable** — created with empty
   `assigneeIds`, so no current query finds them. Old Cowork runs a dedicated
   listener (`page.js:3596`).
3. **No write path** — every task mutation throws `NotConnectedError`. Must go
   through `POST /cowork/task/*`; a direct Firestore write would skip the
   approval gates, priority computation, server `taskId` and notification
   fan-out.
4. **Folder-parent backfill** — employees lose folder structure
   (`page.js:3872`).
