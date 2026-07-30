# Tasks module — completion report

Verify: **exit 0, 683 tests** (was 646 at the start of this module).

| Feature | Old implementation | New implementation | Test performed | Result |
|---|---|---|---|---|
| Create | `POST /cowork/task/create` (`mediaUploadApi.js:153`) | same endpoint via `taskWrites.ts` | endpoint traced; body reduced to fields the handler reads; typecheck | ✅ Connected, ⬜ not executed |
| Edit | `PATCH /task/:id/edit-details` | same | traced | ✅ Connected |
| Confirm | `POST /task/:id/confirm` | same | live lifecycle probe | ✅ Verified |
| Start | `POST /task/:id/start` | same | live lifecycle probe | ✅ Verified |
| Submit | `POST /task/:id/submit-completion` | same | live lifecycle probe | ✅ Verified |
| Approve / reject | `POST /task/:id/review-completion` | same | live lifecycle probe | ✅ Verified |
| CEO review | `POST /task/:id/ceo-review` | same | traced (`verifyCeoToken`) | ✅ Connected |
| Complete | *outcome of review*, never an instruction | not exposed as an action | probe: approval → `status: done` | ✅ Verified |
| Delete | `DELETE /task/:id`, recursive | same | probe cleanup: `exists = false` | ✅ Verified |
| Department approve | `POST /task/:id/department-approve` | same | traced | ✅ Connected |
| Real-time | 22 `onSnapshot` | 3 role-scoped `onSnapshot` → invalidation | typecheck, lint | ✅ Fixed |
| Gate visibility | org-wide status listener + client filter | same, scoped to 3 parties | 4 tests | ✅ Fixed |
| Root-only filtering | role-dependent (`page.js:6010`) | same | 4 tests | ✅ Fixed |
| Descendant matching | recursive, forwarded excluded | same, cycle-guarded | 4 tests | ✅ Fixed |
| Folder backfill | `getDoc` parents, employees only | same, loose folder test copied | typecheck | ✅ Connected |
| Timer | `cowork_task_timers` + `cowork_timer_events` | verbatim port | live doc shapes read and compared | ✅ Verified by inspection |

---

## 1 · Write path

**Every task write is HTTP. None touches Firestore** — the inverse of reads,
and deliberately so. `CreateTaskModal.jsx` contains no `fetch` *and* no task
write; it calls `createTask()` in `mediaUploadApi.js:153`, which POSTs.

The reason is that the document is not the decision. `POST /task/create` alone
runs five approval gates, resolves cross-department approvers with an `E000`
fallback, computes a per-assignee priority map from live open-task counts,
generates `taskId`, stamps the PMP quarter, and fans out notifications and
email. A direct Firestore write yields a document that looks right and has
skipped all of it.

**Only what the handler reads is sent.** `taskForward.js:137` does not
destructure `status`, `createdBy`, `createdByRole` or `dueDate` — it computes
all four. Sending them would describe an intention the engine discards.

Two things the wiring exposed:

- **`#write` re-reads the task after every mutation.** Not ceremony: the engine
  decides `status`, `taskId`, `priority` and which gate fired, so the only
  honest report of what happened is to ask the document.
- **A create returned the wrong object.** `NewTaskForm` navigates to
  `/tasks/${r.data.id}`, and I was returning a `TaskView` — which has no `id`,
  only a `task` that does. Every successful create would have gone to
  `/tasks/undefined`. Fixed; the type system did not catch it because the
  repository proxy casts.

**Not executed.** These need a Firebase ID token; I have none and cannot sign
in as you. Endpoints, bodies and auth guards are traced and typechecked, but no
create/edit has been run through HTTP. The lifecycle transitions below were
verified at the service layer instead.

### Seam mismatches, resolved by mapping rather than invention

| Contract | Legacy | Resolution |
|---|---|---|
| `ReviewInput.submissionId` | no submission entity; `completionSubmission` embedded, routes keyed by `:taskId` | **submissionId IS the taskId** |
| `decideApproval(approvalId)` | approvals in a `departmentApprovals[]` array on the task | **approvalId IS the taskId** |
| `attachmentIds: string[]` | takes `imageUrls` + `pdfAttachments` (resolved URLs) | **dropped** — passing ids the engine cannot resolve would poison a permanent record |
| `completeTask` | no such endpoint | **not exposed** — completion is the outcome of a review; under `tl_final` approval completes, under `tl_then_ceo` it does not |

## 2 · `pending_department_approval`

Held tasks are created with **empty `assigneeIds`** and the target parked in
`pendingAssigneeId`, so no `array-contains` query could reach them — the
approver, the one person who must act, saw nothing.

Now queried by status alone, as `page.js:3596` does, because Firestore cannot
filter inside `departmentApprovals[]`. **That query is org-wide, so scoping it
is a security requirement, not a nicety** — unscoped it would show every
employee every held task company-wide, with titles and targets. A held task now
survives only for the sender, the two approvers, and the pending assignee.
A malformed approvals array yields no approvers, failing closed.

No `orderBy`, so no new composite index.

## 3 · Root-only and descendant matching

Subtasks were appearing as top-level rows. Now: TL and CEO see roots only;
an employee also keeps forward-created tasks and orphans whose parent is out of
reach (losing a child because its parent belongs to someone else would lose
their work); **Submitted keeps everything**, because submissions live on
subtasks and stripping them empties the tab.

A parent now counts as mine when a descendant is, followed to any depth — but
**not** through a forward-created descendant, since once work is forwarded the
original above it stays hidden. `visited` guards a cycle: `subtaskIds` is
engine-written and a malformed chain must not hang the list.

## 4 · Folder backfill

An employee's single query returns the child, never the folder — folders have
no assignees. Parents are now fetched with `getDoc` for employees only (a TL or
CEO already receives them via `assignedBy`).

Legacy's folder test is deliberately loose — the flag, **or** an absent flag on
a task with no assignees — because folders predate the flag. Copied rather than
tightened: narrowing it would drop exactly the historical folders that motivated
the looseness.

## 5 · Timer — verified by inspection, not execution

I did not run start/pause/resume/stop. Those writes land in your own duty-status
and attendance record, which feeds C4 and therefore the score. Verifying a
write shape is not worth moving a number your appraisal depends on, and the
shape can be established without it.

Read from production (`GR0045`):

```
cowork_task_timers/GR0045/sessions/T114
  {employeeId, taskId, taskTitle, totalSeconds: 199, isActive: false,
   lastStartTime: null, lastPauseReason: "hhh", updatedAt: 1782962175638}

cowork_timer_events/GR0045/logs/6Qw6NTEK…
  {type: "pause", taskId: "T548", taskTitle: "T548",
   reason: "switched_task", at: <serverTimestamp>}
```

These match `useTaskTimer.js` field for field — session via `setDoc(…, {merge:
true})` with `employeeId`/`taskId`/`updatedAt: Date.now()` (a number, as
stored), events via `addDoc` with `at: serverTimestamp()`.

**Confirming evidence:** the `T548` event has `taskTitle === taskId`. That is
the hook's own `taskTitle: taskTitle || taskId` fallback firing — the port is
demonstrably the writer of these documents, not merely shaped like it.

Since the hook is verbatim, new Cowork writes identical shapes by construction.
Score logic untouched, as instructed.

- `hoursCompleted` on the task document remains dead — written once as `0`,
  updated nowhere in the backend. Both apps show a permanent zero.
- `cowork_task_timers/GR0045` has **no root document**; only the subcollection
  exists. Anything reading the parent doc gets `exists: false` in both apps.

---

## Should Tasks be marked complete?

**Not yet.** Your own bar was "write path + timer + approval flows verified".

- Approval flows: ✅ verified live (create → confirm → start → progress →
  submit → approve → delete, cleaned up).
- Timer: ✅ verified by shape comparison against production documents.
- Write path: ⚠️ **connected and typechecked, but never executed.** No HTTP
  mutation has run.

What remains is one browser session: create a task, edit it, confirm, start,
submit, approve. If those six succeed, Tasks is done. I can't do it — it needs
a Firebase token only you can produce.

Two known gaps if you want them closed first:

1. `reviewSubmission` always calls the first-stage route. Under `tl_then_ceo` a
   CEO clearing the second stage needs `/ceo-review`; the client cannot tell
   which applies without reading `reviewFlow` first.
2. Forwarding, subtask creation, rework, deadline negotiation and third-party
   updates are traced but not wired.
