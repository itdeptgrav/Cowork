# Task Module — Legacy Parity Report

Sources: `cowork-old-backend` (routes, services), `cowork-old-frontend`,
`LEGACY_AUDIT.md`. Every legacy claim below cites the file and line it was read
from. Nothing here is inferred from a name, a role label or a department.

Scope: the task module only — creation, assignment, approval, negotiation,
confirmation, repeat cycle, notifications and the scoring hand-off.

**Status: audit only. No code was changed to produce this report.**

---

## 0. The two structural facts everything else follows from

**Legacy restricts assignment to nobody.** `/task/create`
(`routes/task_routes/taskForward.js:135`) is guarded by `verifyEmployeeToken`,
which admits any authenticated user, and its only role test is
`["ceo","tl","employee"].includes(requesterRole)` — a list containing every role
the product has. The service performs no check. The old client
(`app/coworking/tasks/page.js:2168`) loads the whole employee collection into the
picker, commented *"Load for all roles so avatars show correctly"*.

**Legacy does not use the reporting hierarchy for authorisation.**
`LEGACY_AUDIT.md:485`: *"The manager hierarchy is not enforced. … Legacy has that
chain (`Employee.primaryManager`/`secondaryManager`) … but no scoring or task
authorisation uses it."* It is read for exactly two purposes: resolving a
fallback approver, and the `assignerIsTargetsManager` skip on the
cross-department gate.

Restriction is expressed as **consent**, not prohibition: anyone may raise work
for anyone, and gates hold it until the right person agrees.

---

## 1. Manager assigning to direct report

### LEGACY
- **Trigger** `POST /task/create` with one assignee. No special path — a manager
  uses the identical endpoint as anybody else.
- **Status** `open`. `const dueDate = null` is hardcoded, commented *"Deadline is
  always set by employee after assignment"* (`taskForward.js:139`).
- **Database** `cowork_tasks` doc; `assigneeIds` populated immediately;
  `senderTimerWindowSecs` holds the proposed working time; `c1{}` sub-object
  seeded with `taskScore: null, c1Status: "open", isExcluded: false`.
- **Who sees it** creator and assignee at once.
- **Actions** the assignee must accept or refuse the proposed window before the
  task has a deadline at all (§5).

### CURRENT
- Same endpoint shape via `createTask`. Status `assigned`, `deadline.state:
  "unset"`, `currentWindowSecs` set, no due date.
- Assignment rows created immediately; assignee sees it at once.
- `acceptAssignorWindow` / `rejectAssignorWindow` exist at the repository layer.

**Verdict: matching**, with one gap — the accept/refuse actions have no UI.

---

## 2. Employee assigning upward

### LEGACY
- **Trigger** `requesterRole === "employee"` and any assignee has
  `role === "tl"` (`taskForward.js:152`).
- **Status** `pending_tl_approval`.
- **Database** status only. **No approval record is written** — legacy has no
  approvals collection at all; the status field *is* the state.
- **Who sees it** creator and the TL assignee.
- **Actions** `POST /task/:taskId/approve` (`taskTree.routes.js:765`) — guarded
  by `requesterRole !== "tl"` → 403, and `task.assigneeIds.includes(employeeId)`
  → the **assignee themselves approves**. Sets status `open`.
- **Overwritten** if the cross-department gate also fires, it replaces this
  status. Cross-department wins.

### CURRENT
- Fires on `administrativeLevel` comparison rather than the literal role `tl`,
  so it also covers manager → senior, which legacy left ungated.
- Writes an `Approval` record of kind `assignment`, approver = the senior
  assignee. Status `pending_approval`, reason `tl_assignment`.
- Skipped when the cross-department chain runs — same precedence as legacy.

**Verdict: matching in effect, broader in scope.** The generalisation is
deliberate and was agreed; it closes a hole where a team lead could put work on
the CEO's list unannounced.

---

## 3. Peer assignment

### LEGACY
- **Trigger** same endpoint. Neither assignee is a TL and departments match.
- **Status** `open`. No gate of any kind.
- **Who sees it** both immediately.

### CURRENT
- Same: no gate, status `assigned`.
- Deadline model resolves to `fixed` because no reporting line reaches a peer.
  Legacy had no equivalent derivation (§5).

**Verdict: matching on approval. Divergent on deadline mode.**

---

## 4. Cross-department assignment

### LEGACY
- **Trigger** (`taskForward.js:164`), verbatim:
  `requesterRole !== "ceo" && !folderFlag && !repeatFlag && !thirdPartyFlag &&
  !goalFlag && !parentTaskId && assigneeIds?.length === 1`, plus
  `assignerDept !== targetDept`, plus **not** `assignerIsTargetsManager`
  (direct `primaryManager` only).
- **Status** `pending_department_approval`.
- **Database** `departmentApprovals[]` embedded on the task —
  `{approverId, approverName, side, source, status, respondedAt,
  rejectionReason}` — as `[sender pending, receiver waiting]`;
  `pendingAssigneeId` / `pendingAssigneeName` set; **`assigneeIds: []`**.
- **Who sees it** creator and the sender-side approver. **Not the assignee.**
- **Actions** `POST /task/:taskId/department-approve`. Sender approves →
  receiver flips `waiting` → `pending`. Both approved →
  `finalStatus = (task.hasTimer === false) ? "pending_tl_hours" : "open"`, and
  `arrayUnion(finalAssigneeId)` runs **only** in the `open` branch. Reject →
  status `rejected`.
- **Blocked case** no manager on file on either side → falls back to default
  approver `E000`; hard-fails only if `E000` is absent.

### CURRENT
- Gate eligibility now transcribed from `:164`, minus the CEO exclusion
  (deliberate: legacy replaced it with a separate CEO gate, and dropping both
  would let an administrator create ungated crossings).
- Skip is on the **transitive closure**, not the direct manager only.
- Approvals are separate records with a `stage` field, not an embedded array —
  same fields, same sequential behaviour.
- `pendingAssigneeIds` + no assignment rows; released on completion. Verified.
- Reject → `assignment_rejected` (naming differs, semantics identical).
- Unresolvable approver → **hard block** with a named reason. Legacy fell back to
  `E000`. Cowork has no equivalent default approver.

**Verdict: matching in shape.** Two divergences: skip breadth, and the missing
`E000` fallback.

---

## 5. Deadline / budget negotiation

### LEGACY
- **Budget vs deadline is a user choice, not a derivation.** `hasTimer` arrives
  in the request body (`taskForward.js:137`). The old UI renders it as two
  buttons labelled **"Own Department"** and **"Other Department"** with the hint
  *"ℹ️ Cross-department tasks only"* (`CreateTaskModal.jsx:62`). No server-side
  validation against actual departments.
- **Assignee accepts** `POST /approve-sender-timer` — guards: in `assigneeIds`,
  status `open`, window > 0. Status → `deadline_approved`; `dueDate` computed
  from **working time** via `_addWorkingSecsIST`, reading schedule and breaks
  from `cowork_settings/office`.
- **Assignee refuses** `POST /reject-sender-timer` — reason required. **Status
  unchanged.** Records `senderTimerRejected` + reason, posts to `draft_chat`.
- **Assignee proposes** `POST /propose-deadline` — allowed from `open`,
  `deadline_rejected`, `in_progress`, `confirmed`, `deadline_approved` →
  `pending_deadline_approval`.
- **Assignor decides** `POST /approve-deadline` — guard
  `task.assignedBy !== approverId` → 403. **Only the creator**, not a manager.
- **Counter** `/tl-counter-deadline` → `/respond-tl-counter`.

### CURRENT
- Mode is **derived** from the reporting relationship
  (`assignmentRelationship`), with no control shown.
- Accept/refuse implemented with legacy's guards; refusal leaves status
  unchanged, as legacy.
- Propose / decide / counter / respond all present.
- **Due date uses wall-clock**, marked `KNOWN DIVERGENCE` in code. Cowork has no
  office schedule; `workCalendarId` exists on `Employee` but nothing resolves it.

**Verdict: incorrect (by legacy's rule) on mode selection; matching on
negotiation mechanics; one documented divergence on due-date arithmetic.**

---

## 6. Draft chat negotiation

### LEGACY
- Separate subcollection `cowork_tasks/{id}/draft_chat`; counter
  `draftChatMessageCount`.
- `messageType: "text" | "system"`. System lines posted by the window flows
  (`taskForward.js:1730`, `:1802`).
- Participants = `assigneeIds` + `assignedBy`. **System messages are not
  notified** — the flow that posts them already notified. **The creator IS
  notified**, unlike task chat, because *"draft chat is a two-way negotiation
  and the creator's reply is required for the flow to advance."*
- UI (`page.js:9080`): Draft tab always visible, **ACTIVE** while status not in
  `[confirmed, in_progress, done]`, **read-only** after. The normal chat tab
  renders **only** post-confirmation.

### CURRENT
- Separate `thread: "chat" | "draft"` throughout domain, repository and UI.
- System lines now posted on accept, refuse, and both approval steps.
- Active/read-only gating and post-confirmation-only working tab implemented.

**Verdict: matching.**

---

## 7. Approval list behaviour

### LEGACY
`page.js:3596` — query `cowork_tasks where status == "pending_department_approval"`,
then filter client-side for
`departmentApprovals.find(a => a.approverId === me && a.status === "pending")`.
Its own comment explains why: *"Firestore can't query inside an array of objects
for 'my id + status=pending', so this fetches the (normally small) set of all
pending-approval tasks and filters client-side."* The upward gate
(`pending_tl_approval`) has a separate list; `pending_tl_hours` a third, filtered
by the viewer's department.

### CURRENT
`TasksArea.tsx:232` — `listTasks({ scope: "all", status: ["pending_approval"] })`
filtered by `pendingApprovals.some(a => a.approverId === me)`. One list covers
all reasons, because all reasons collapse into `pending_approval` + a typed
reason.

**Verdict: matching in behaviour, simpler in shape.** Legacy's three separate
lists are one list here. No behaviour is lost; a reader sees every kind of
pending decision in one place.

---

## 8. Assignee visibility timing

| Path | Legacy | Current |
|---|---|---|
| Same-department, no gate | visible at creation | visible at creation |
| Upward (`pending_tl_approval`) | visible — assignee is the approver | visible |
| Cross-department | **invisible** until both approve | **invisible** until both approve |
| Cross-department, deadline mode | invisible until the receiving TL sets hours | invisible until effort set |

**Verdict: matching.** This was a real defect until recently and is now verified
by direct check: while pending, the task does not appear on the assignee's list.

---

## 9. Confirmation workflow

### LEGACY
`confirmTaskReceipt` (`taskForward.service.js`): must be in `assigneeIds`; cannot
confirm twice (`confirmedBy` array); timer and fixed tasks confirm directly;
tasks with `hasTimer === undefined` (older records) must have a `dueDate` or be
`deadline_approved` first. Sets status `confirmed`, appends to `confirmedBy[]`,
notifies `assignedBy` and `originalAssignedBy`.
`markTaskStarted` then requires `confirmedBy.includes(employeeId)` → `in_progress`.

### CURRENT
`confirmTask` → `confirmed`; `startTask` → `in_progress`, gated on confirmation.

**Verdict: matching.** `confirmedBy[]` is per-assignee in legacy; current tracks
`confirmedAt` per assignment row, which is the same fact.

---

## 10. Repeat tasks

### LEGACY
- **Trigger** `isRepeat` at creation → status `repeat_pending_confirmation`,
  overriding any other gate (`taskForward.js:158`).
- **Confirm** `POST /repeat-confirm` — guards: `isRepeat`, in `assigneeIds`,
  status must be `repeat_pending_confirmation` (idempotent if already
  `repeat_active`). Sets `repeat_active`, which *unlocks chat and daily
  submissions*.
- **Submit** `POST /repeat-submit` — requires `date` and `slotIndex`; refuses a
  duplicate with *"Already submitted for this slot today"*; writes
  `repeatSubmissions.{date}.{slotKey}`.
- **Scoring** `hasTimer: isRepeat || isThirdParty || isGoal ? null : …`
  (`taskForward.service.js:321`) — repeat tasks carry no timer and no
  `fixedDeadline`.

### CURRENT
- `type: "recurring"` exists; `isScoreEligible: false` for it.
- **No `repeat_pending_confirmation` state, no `repeat_active` state, no
  per-slot submission model, no `repeatSubmissions` structure.** A recurring task
  is created as an ordinary `assigned` task.

**Verdict: missing.** This is the largest single gap in the module.

---

## 11. Notifications

Legacy emits ~30 task-module types, including `department_approval_request`,
`department_approval_your_turn`, `department_approval_rejected`,
`department_approval_completed`, `department_draft_needs_hours`,
`department_draft_activated`, `draft_chat`, `deadline_proposed`,
`deadline_counter_proposed`, `deadline_counter_rejected`,
`deadline_auto_extended`, `self_assign_pending`, `self_assign_approved`,
`completion_submitted`, `completion_tl_approved`, `completion_ceo_approved`,
`completion_rejected`.

Delivery is four-channel: Firestore bell doc + FCM push + email + socket.

### CURRENT
`Notification.type` is an open `string`, so any legacy type can be produced.
Channels are modelled (`in_app | push | email | socket`). Per-item `readAt`
improves on legacy's read-all.

**Verdict: infrastructure matching; coverage unaudited.** I did not enumerate
which of the ~30 types current actually emits. That is a discrete follow-up.

---

## 12. Task scoring impact

### LEGACY
- `c1{}` embedded on the task at creation: `deadlinesMissed`, `extensionsFiled`,
  `reworksReceived`, `taskScore`, `c1Status`, `isExcluded`, `isRejected`,
  `officialDeadline`, `scoreCalculatedAt`.
- Formula (`c1Service.js` header):
  `taskScore = base − (deadlineDeduction × missed) − (extensionDeduction × filed)
  − (reworkDeduction × reworks)`.
- Eligibility (`c1Service.js:78`): `taskScore != null && !isExcluded`. **Every
  eligible task counts as 1** — the old `etcHours` weighting was removed, and the
  comment says so.
- Cancellation `markTaskCancelled` sets `c1.isExcluded = true`,
  `c1Status = "cancelled"`, `taskScore = null`.
- `officialDeadline` is separate from `dueDate` — a waived extension moves the
  scored deadline, a charged one does not.

### CURRENT
- `isScoreEligible` set at creation from type only
  (`type !== "recurring" && type !== "external"`).
- `deadline.officialDueAt` preserved as the scoring-only field, with the same
  rationale documented.

**Verdict: partially audited.** The `officialDueAt` separation matches. I did
**not** verify the deduction arithmetic, the equal-weighting rule, or the
cancellation exclusion path against `lib/scoring/engine.ts`. Marked open.

---

## Summary

### Matching
1. Assignment permitted to anyone; gates rather than refusals
2. Upward gate, with the assignee as approver
3. Peer assignment ungated
4. Cross-department two-stage sequential chain
5. Assignee visibility withheld through both gated paths
6. `pending_tl_hours` / effort-estimate stage, including the deadline→budget conversion
7. Draft chat as a separate channel, with active/read-only gating
8. Accept / refuse / propose / counter negotiation mechanics
9. Confirmation before start
10. Approvals list resolution

### Missing
| # | Behaviour | Evidence |
|---|---|---|
| M1 | `repeat_pending_confirmation` → `repeat_active`, per-slot `repeatSubmissions` | §10 |
| M2 | UI for accept/refuse window, and for setting the effort estimate | §1, §4 |
| M3 | Working-hours due-date arithmetic (`_addWorkingSecsIST` + office schedule) | §5 |
| M4 | `E000`-style default approver fallback | §4 |
| M5 | Notification type coverage — unverified | §11 |
| M6 | C1 deduction arithmetic and cancellation exclusion — unverified | §12 |

### Incorrect
| # | Behaviour | Legacy | Current |
|---|---|---|---|
| I1 | Budget vs deadline selection | user choice via `hasTimer`, labelled by **department** | derived from **reporting hierarchy**, no control |
| I2 | Cross-department skip breadth | direct `primaryManager` only | transitive closure |

**I1 and I2 are flagged, not scheduled.** Both were introduced by explicit
instruction in earlier work — the derived deadline model was specified and
confirmed, and the closure-based skip was requested as a bug fix ("a skip-level
line is still a line"). They are genuine divergences from legacy and are recorded
here as such, but reversing them is a product decision, not a parity defect to
fix silently.

### Priority order

1. **M2 — wire the three unreachable actions into the UI.** Smallest, and three
   backend flows are currently unusable without it.
2. **M1 — repeat task cycle.** The largest missing behaviour; needs its own audit
   of `repeatConfig` (slots, cadence) before implementation.
3. **M6 — verify C1 arithmetic** against `lib/scoring/engine.ts`. Cheap to check,
   and scoring errors are silent and compounding.
4. **M5 — notification coverage audit.** Enumerate legacy's ~30 types against
   what current emits.
5. **M3 — working-hours calendar.** Needs an office-schedule model first; until
   then every budget due date is wall-clock.
6. **M4 — default approver fallback.** Only matters for departments with no head;
   current hard-blocks with a clear message, which is arguably better.
7. **I1 / I2 — await a decision.** No work until the product question is settled.
