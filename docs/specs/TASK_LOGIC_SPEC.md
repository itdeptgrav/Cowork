# Task Logic Spec — Cowork

**Date:** 2026-07-25
**Scope:** Complete reverse-engineered task behaviour from the *reachable* legacy code path (`routes/task_routes/taskForward.js` + `services/taskForward.service.js`), plus `app/coworking/tasks/page.js` (10,794 lines) on the frontend.

All `taskForward.js:N` references are the route file; `service:N` references are `services/taskForward.service.js`; `page.js:N` is `app/coworking/tasks/page.js`.

---

## 1. Task Creation — Every Path

All creation paths funnel through **`POST /cowork/task/create`** (`taskForward.js:135`) → **`svc.createTask`** (`service:224`), except subtasks and forwards, which have their own routes that also call `createTask`.

### 1.0 Universal creation facts

| Fact | Evidence |
|---|---|
| **`dueDate` is ALWAYS `null` at creation.** `taskForward.js:138` hard-codes `const dueDate = null;` with the comment "Deadline is always set by employee after assignment". The `dueDate` in the request body is ignored. | `taskForward.js:138`, `:340` |
| **Priority is auto-assigned per assignee** as `(count of that person's non-done, non-cancelled tasks) + 1` | `taskForward.js:295-314` |
| Both a shared `priority` and a per-person `assigneePriorities{}` map are written | `taskForward.js:341-342` |
| `title` is the only universally required field | `taskForward.js:140` |
| `assigneeIds` required unless `isFolder` | `taskForward.js:143` |
| Boolean flags accept `true` or the string `"true"` | `taskForward.js:142,159,161,162` |
| Task ID generated from `cowork_meta/counters.taskSeq` | `service:194` |
| `quarter` and `year` stamped at creation — this is what makes C1 quarterly | `service:224-425` |
| Any of `ceo`, `tl`, `employee` may create | `taskForward.js:146` |

### 1.1 Normal assigned task

| Aspect | Behaviour |
|---|---|
| **Who can create** | `ceo`, `tl`, `employee` |
| **Who can receive** | Any employee |
| **Required** | `title`, `assigneeIds[]` |
| **Optional** | `description`, `notes`, `requirements[]`, `priority`, `parentTaskId`, `groupId`, `hasTimer`, `fixedDeadline`, `senderTimerWindowSecs`, `etcHours` |
| **Creator of record** | `assignedBy` = requester |
| **Initial status** | `open` — unless a gate below intervenes |
| **Initial priority** | `openTaskCount + 1` per assignee |
| **Initial deadline** | None. `dueDate: null`. Timer window may be preset via `senderTimerWindowSecs` |
| **Score eligibility** | Yes, on approval or rejection |
| **Notification** | `task_assigned` → assignees (app + socket `new_task` + FCM + email), `service:395` |
| **Validation errors** | 400 `"title required"`, 400 `"assigneeIds required"`, 403 `"Not authorized to create tasks."` |

**Gate A — Employee assigns to a TL.** If the requester is an `employee` and *any* assignee has role `tl`, initial status becomes `pending_tl_approval` (`taskForward.js:152-157`). The TL must call `POST /task/:taskId/approve` to release it to `open`.

**Gate B — Cross-department (non-CEO requester).** Applies only when: requester ≠ ceo, not folder/repeat/third-party/goal, no `parentTaskId`, **exactly one assignee** (`taskForward.js:166-167`). If assigner's department ≠ target's department **and** the assigner is not already the target's `primaryManager`, a two-stage gate is created:

```
departmentApprovals = [
  { side: "sender",   approverId: <assigner's dept TL or primaryManager>, status: "pending" },
  { side: "receiver", approverId: <target's dept TL or primaryManager>,   status: "waiting" }
]
status = "pending_department_approval"
assigneeIds = []          ← assignee is NOT added yet; task is invisible to them
pendingAssigneeId = <target>
```
Approver resolution (`resolveDepartmentApprover`, `taskForward.js:86`): if the person is a `tl`, use their HR `primaryManager`; else the first `tl` in their department; else their `primaryManager`. If either side resolves to nothing, both fall back to **`E000`** (`taskForward.js:198-206`). If `E000` does not exist, hard 400.

**Gate C — CEO assignment.** Same preconditions but requester = ceo (`taskForward.js:224-262`). Single receiver-side approval, skipped entirely if the CEO is already the target's `primaryManager`.

**Gate D — Deadline-mode cross-department.** If `hasTimer === false`, single assignee, no other gate fired, status still `open`, and it is cross-department to a non-TL target: status becomes `pending_tl_hours` and the target's department TL is asked to set real ETC hours (`taskForward.js:266-287`).

*All four gates: CONFIRMED WORKING.*

### 1.2 Self-assigned task

| Aspect | Behaviour |
|---|---|
| **Trigger** | `isSelfAssigned: true` + `approverId` in the create body |
| **Creator of record** | **The approver, not the employee.** `assignedBy` is rewritten to `approverId` (`taskForward.js:321-332`) |
| **Visibility** | `visibleTo[]` includes `approverId` |
| **Initial status** | `open` (the gate is `selfAssignApproved`, not a status) |
| **Approval** | `POST /task/:taskId/self-assign-approve` `{approved, rejectionReason}` (`taskForward.js:554`) |
| **On approve** | `selfAssignApproved: true`, `status: "confirmed"`, `confirmedBy` gains `assigneeIds[0]` — **skips the confirm step entirely** |
| **On reject** | `status: "cancelled"`, `selfAssignRejectionReason` stored |
| **Guards** | Must be `isSelfAssigned`; caller must be `task.approverId`; cannot re-approve |
| **Notification** | `self_assign_pending` at creation → approver; `self_assign_approved` / `self_assign_rejected` → assignees |

*CONFIRMED WORKING.* Note the effect on scoring: because `assignedBy` becomes the approver, `_reviewFlow` reads the **approver's** role, so a self-assigned task approved by a TL follows `tl_final`.

### 1.3 Folder

`isFolder: true`. Bypasses the `assigneeIds` requirement (`taskForward.js:143`) and every approval gate. Purely a container: other tasks point at it via `parentTaskId`, and it tracks `subtaskIds[]`. Folders cannot be nested inside folders (`taskForward.js:1397`). *CONFIRMED WORKING.*

### 1.4 Subtask

`POST /task/:taskId/subtask` (`taskForward.js:1199`).

| Aspect | Behaviour |
|---|---|
| **Who can create** | `ceo`, `tl`, **any assignee of the parent**, or the parent's `assignedBy` (`:1210-1213`) |
| **Required** | `title`, `assigneeIds[]` |
| **Depth** | Unbounded — subtasks may have subtasks |
| **Priority** | Same per-person auto-assign |
| **Gates** | **None.** Subtasks bypass all four approval gates because `parentTaskId` is set |
| **Side effect** | System chat message posted to the parent (`:1251`) |
| **TL-created subtasks** | `createdByTl: true` — historically hid them from the CEO tree |

*CONFIRMED WORKING.* Also reachable via `POST /task/create` with `parentTaskId` set, which posts a parent chat message only when the requester is a TL (`taskForward.js:374-381`) — an inconsistency between the two subtask paths.

### 1.5 Repeat task

| Aspect | Behaviour |
|---|---|
| **Trigger** | `isRepeat: true` + `repeatConfig` |
| **Initial status** | **Forced to `repeat_pending_confirmation`**, overriding any gate (`taskForward.js:159-160`) |
| **Confirm** | `POST /task/:taskId/repeat-confirm` → `repeat_active`; unlocks chat + daily submissions (`:625`) |
| **Submit a slot** | `POST /task/:taskId/repeat-submit` `{date, slotIndex, comment, files}` (`:671`) |
| **Storage** | `repeatSubmissions.{YYYY-MM-DD}.slot_{N}` via dot-notation |
| **Duplicate guard** | 400 `"Already submitted for this slot today"` (`:691`) |
| **Score** | **No C1 path.** Repeat tasks never reach `submit-completion`, so they never score |

*CONFIRMED WORKING.* **OWNER DECISION REQUIRED:** repeat tasks generate work but no measurement. Is that intended?

### 1.6 Third-party / vendor task

`isThirdParty: true` + `thirdPartyConfig`. Progress is logged as `vendorUpdates[]` via `POST /task/:taskId/third-party-update` with a type that maps to a `thirdPartyStatus`:

| Update type | `thirdPartyStatus` |
|---|---|
| `vendor_contacted` | `waiting_vendor` |
| `vendor_replied`, `quote_received`, `order_dispatched` | `vendor_responded` |
| `follow_up` | `in_follow_up` |
| `delay_reported` | `delayed` |
| `payment_request` | unchanged |
| `resolved` | `completed_pending_review` + sets `completionStatus: "submitted"` |

Completion: `POST /task/:taskId/third-party-complete` (CEO/TL only) requires `completionStatus === "submitted"`, sets `status: "done"`, `completionStatus: "approved"`.

**Payment sub-flow:** a `payment_request` update carries `amount` + `paymentNote` + `paymentStatus: null`; `POST /task/:taskId/third-party-payment-action` (CEO/TL) sets it to `approved`/`rejected`.

*CONFIRMED WORKING.* Note `completionStatus: "approved"` is a value used **only** by this path — every other flow uses `tl_final_approved`/`ceo_approved`. Third-party tasks therefore **never fire C1** (`reviewCompletion` is not involved).

### 1.7 Goal task (progress-tracked)

`isGoal: true` + `goalConfig{targetValue, unit, goalType}`. `POST /task/:taskId/goal-update` `{addedValue, currentValue, note}` appends to `goalUpdates[]`, accumulates `goalAchieved`, recomputes `progressPercent = min(round(achieved/target*100), 100)`. Validation: `addedValue` must parse as a number ≥ 0. *CONFIRMED WORKING.*

### 1.8 Gold task (the C2 vehicle)

| Aspect | Behaviour |
|---|---|
| **Trigger** | `isGoldTask: true` + `c2Config{weightagePercent, taskMaxPoints, globalMaxPointsAtCreation}` |
| **Pre-creation validation** | Frontend calls `POST /cowork/c2/validate-weightage`; **hard block** if the sum of all active gold-task weightages would exceed 100% (`c2Band.routes.js:189`) |
| **Components** | `goalActivities[]` — each `{id, heading, points, deadline, status, lateSubmission, perUserStatus{}}` |
| **Save components** | `POST /task/:taskId/goal-activities` `{activities, submitted, submittedAt}` — assignee or CEO/TL |
| **Per-component report request** | `POST /task/:taskId/goal-activity/:activityId/request-report` (CEO/TL) |
| **Per-component report submit** | `POST /task/:taskId/goal-activity/:activityId/submit-report` → sets component `status: "pending_approval"` |
| **Multi-user** | `isMultiUserGold` + `perUserStatus[employeeId]` |
| **Score** | C2 written on **full approval** via `reviewCompletion` → `pmpSvc.writeC2ScoreOnComplete` (`service:1351`) |

*CONFIRMED WORKING*, except the `request-report` email block — **INTENDED BUT BROKEN** (`taskForward.js:2222` references undefined `submitterName`, `text`, `files`).

### 1.9 Group task

`groupId` is carried on the task document and `GroupTaskManager.jsx` renders group-scoped views. There is **no group-specific creation rule, permission, or state** in the reachable backend — `groupId` is metadata only. *CONFIRMED WORKING (as a label, not a mechanism).*

### 1.10 Forwarded task

`POST /task/:taskId/forward` `{assignments[]}` → `svc.forwardTask` (`service:519`). Covered in full at §9.

---

## 2. Priority Logic — Complete

This section states only what the code does. Where the code is silent or self-contradictory, it says so.

### 2.1 Priority values and meaning

| Property | Value |
|---|---|
| **Type** | Integer, **not** an enum |
| **Range** | Clamped to **1–10** by `handleUpdatePriority` (`page.js:1769`: `Math.max(1, Math.min(10, Number(newPriority)))`) |
| **Ordering** | **Lower number = higher priority.** `1` is highest |
| **Default when unresolvable** | `99` in sort comparators (`service:2210`), `999` in frontend comparators (`page.js:1643`) — **inconsistent sentinels** |
| **Labels** | Only three are named: `P1 — Highest`, `P2 — High`, `P10 — Lowest`. Everything from P3–P9 renders as `P{n} — Medium` (`page.js:1773`) |

**The clamp is frontend-only.** The backend auto-assigns `openTaskCount + 1` with no upper bound (`taskForward.js:303`), so an employee with 15 open tasks receives **P16** — outside the range the UI can express. **FE/BE CONTRADICTION.**

### 2.2 Is priority per task, per employee, or both? — Both

Two fields are written on every change:

| Field | Meaning |
|---|---|
| `priority` | A single shared number on the task |
| `assigneePriorities{employeeId: number}` | Per-person rank |

Reads prefer `assigneePriorities[employeeId]` and fall back to `priority`, then `order` (`page.js:1619-1624`, `service:2208-2210`).

`order` is a third field, `(rank) * 1000`, written by drag-reorder as a secondary sort key (`page.js:1701`) and explicitly cleared (`order: undefined`) by direct priority set (`page.js:1783`). Three fields express one concept.

### 2.3 Can one employee hold multiple P1 tasks? — Yes

Nothing prevents it.

- Auto-assign gives `count+1`, so the *first* task is always P1; a person with zero open tasks who receives two tasks in the same second gets two P1s (the count query is not transactional).
- `handleUpdatePriority` sets any task to any 1–10 value with **no uniqueness check** (`page.js:1768-1816`).
- Drag-reorder renumbers contiguously, which *incidentally* produces uniqueness within one parent+assignee group — but only within that group. Tasks under different parents are renumbered independently, so P1 can exist many times across groups.

*CONFIRMED WORKING.* **OWNER DECISION REQUIRED:** should P1 be exclusive per employee?

### 2.4 Who can change priority — and the hole

**Nobody is checked.** Priority changes never reach the backend:

```
page.js:1810   updateDoc(doc(firebaseDb, "cowork_tasks", taskId), { priority, assigneePriorities.* })
page.js:1761   batch.update(doc(firebaseDb, "cowork_tasks", u.taskId), fields)
```

Both write **client-side, directly to Firestore**. There is no route, no service, no server validation, no role check, and no audit record of *who* changed a priority. The only server involvement is the *consequence* (`p1-conflict-check`), fired afterwards.

**FE/BE CONTRADICTION** and a security gap: authorisation depends entirely on Firestore security rules, which are **not in the repository** and could not be audited.

### 2.5 The two priority UIs contradict each other

| | Drag-reorder (`executeDrop`, `page.js:1658`) | `PrioritySwapPanel.jsx` |
|---|---|---|
| **Renumbering** | Contiguous `1,2,3…` — `priority: idx + 1` (`:1700`) | **Preserves the existing set of numbers**, reassigned to the new order (`PrioritySwapPanel.jsx:20`) |
| **Direction** | **Upward only** — dragging down is silently rejected (`:1633-1635`) | Both directions |
| **Reason** | **Mandatory** — confirm button disabled without it (`page.js:5728`) | **Not collected** |
| **P1 cascade** | Fired 500 ms later (`page.js:5744-5766`) | Not fired |
| **Due-date recalc** | Yes, after the cascade | Yes, via `onRecalcDueDate` |
| **Scope** | Siblings sharing a parent *and* an assignee | "forwarded tasks with a priority" |

So the same conceptual action produces different numbering, different audit, and different downstream effects depending on which control the user touches. **FE/BE CONTRADICTION** (strictly, FE/FE).

### 2.6 Which tasks participate in renumbering

`executeDrop` sibling set (`page.js:1669-1678`) requires all of:
- same `parentTaskId` (null-normalised)
- `status ∉ {done, cancelled}`
- shares at least one assignee with the dragged task
- **is not a "draft sibling"** — excluded when `senderTimerWindowSecs > 0 && !deadlineWindowSecs && status ∈ {open, not_started}` (`:1673-1676`)

That last exclusion means a task still negotiating its timer is invisible to priority ordering. `not_started` appears **only here** — it is not a status any backend path writes. Dead condition.

### 2.7 Acknowledgement

Acknowledgement is **not** attached to the priority change. It is attached to the **deadline shift the change caused**.

- `checkAndExtendForP1` appends to each affected task's `deadlineAutoExtendedHistory[]` with `acknowledgedByEmployee: false` (`service:2301`).
- `PriorityChangeAckModal.jsx` scans the live task array for any entry with `acknowledgedByEmployee === false` on a task assigned to the current user (`:85-113`).
- Entries sharing `shiftedByTaskId` + `at` are grouped into **one** modal.
- The modal is **blocking and non-dismissable**: no Cancel, no X, no backdrop click (`:16-17`, `:167`).
- It plays a two-tone chime once per group (`:32-53`).
- **Confirm** pauses any running timer with `autoReason: "priority_change_ack"`, then writes `acknowledgedByEmployee: true` back to each entry — **client-side, directly to Firestore** (`:140-154`).

**Acknowledgement cannot be rejected.** Confirm is the only action. *CONFIRMED WORKING.*

**Consequences:** acknowledgement is purely a receipt. It gates nothing, blocks no state transition, and has no server-side record of when or whether it happened beyond the boolean. A user who never opens the tasks page never acknowledges, and nothing escalates.

### 2.8 Does a priority change shift other tasks? — Yes, cascading

`checkAndExtendForP1` (`service:2123`) is the engine. Full trace:

1. **Compute the promoted task's remaining time** (`:2132-2166`)
   - If it has `fixedDeadline`/`dueDate`: `remaining = deadline − now`
   - Else if `hasTimer !== false`: window = `deadlineWindowSecs || senderTimerWindowSecs || etcHours*3600`; read worked seconds from `cowork_task_timers/{emp}/sessions/{task}` (`totalSeconds` + live elapsed if `isActive`); `remaining = (window − worked) * 1000`
   - Else return null. If already expired, return null.

2. **Stamp the estimate** — `cascadeEstimatedDueDate`, `cascadeEstimatedAtMs` on the promoted task (`:2177-2185`).

3. **Collect qualifying tasks** — every task with the employee in `assigneeIds`, excluding:
   - the promoted task itself
   - terminal statuses `{done, cancelled, tl_final_approved, ceo_approved}` (`:2200`)
   - tasks whose priority is **not strictly lower** than the promoted one (`:2211`)
   - tasks with neither a deadline nor a timer window
   - tasks already extended by this same `shiftedByTaskId` **within the last 2 minutes** — dedup (`:2231-2234`)

4. **Sort ascending by priority** and walk with a running `cumulativeWaitMs`, seeded from the promoted task's remaining time (`:2266-2267`).

5. **Per task:**
   - *Timer task:* `newWindow = max(oldWindow, oldWindow + cumulativeWait − worked)`; then `cumulativeWaitMs += (oldWindow − worked) * 1000`
   - *Deadline task:* `newDue = max(P1FinishTime + (window − worked), oldDeadline)` — a **safety floor** so a deadline never moves earlier; then `cumulativeWaitMs += (window − worked) * 1000`
   - Appends a `deadlineAutoExtendedHistory[]` entry with `oldPriority`, `newPriority`, `oldDeadline`, `newDeadline`, `reason`, `changedByName`, `trigger: "p1_conflict_check"`, `acknowledgedByEmployee: false`
   - Sets `autoExtendedDueToP1: true`, `cascadeAssumedP1FinishMs`

6. **Notify** — one `deadline_auto_extended` to **`assignedBy` only** (`:2364`). The employee whose deadlines just moved is not notified; they discover it through the blocking modal.

*CONFIRMED WORKING.*

### 2.9 Two independent cascade triggers

| Trigger | Path | Delay |
|---|---|---|
| **Task created at priority 1** | `createTask` fires `checkAndExtendForP1` in `setImmediate` when `Number(priority) === 1` **and** the task has a time budget (`service:406-417`) | immediate |
| **Drag-reorder confirmed** | `page.js:5744` `setTimeout(..., 500)` → `POST /cowork/task/p1-conflict-check` per assignee | **500 ms** |

The 500 ms delay is a race workaround: `executeDrop` writes priorities client-side and the server may not see them yet. The workaround is to send `oldPriorities` and `newPriorities` maps in the request body so the service can prefer client values over Firestore (`service:2206-2210`). *CONFIRMED WORKING, but structurally fragile* — if the Firestore batch takes >500 ms the server still gets the right answer only because the client also sent it.

The play-button path referenced in comments as a third trigger is **not present** in the reachable code — `markTaskStarted` (`service:465`) does not call `checkAndExtendForP1`.

### 2.10 Priority side effects

| Question | Answer | Evidence |
|---|---|---|
| Does priority affect **score**? | **No.** No C1/C2/C3/C4 path reads `priority` | grep across `c1Service.js`, `pmpService.js` |
| Does priority affect **deadline**? | **Yes** — via the cascade in §2.8 | `service:2123` |
| Does priority affect **workload**? | Only as a sort key in workload/calendar views | `workloadroutes.js` |
| Does it affect **siblings**? | Yes — contiguous renumbering on drag | `page.js:1697` |
| Is there **history/audit**? | Only indirectly, inside `deadlineAutoExtendedHistory[]`. There is **no priority-change audit record** | — |
| **Race conditions** | (a) auto-assign count query is not transactional → duplicate ranks; (b) the 500 ms window; (c) an 8-second client-side live-listener suppression (`page.js:1711`) during which remote priority changes are discarded | — |

### 2.11 Priority state-transition table

| Current | Triggering action | Actor | Validations | Resulting | Ack required | Notifications | DB changes |
|---|---|---|---|---|---|---|---|
| — (new task) | Create task | ceo/tl/employee | Task counted per assignee | `openCount+1` per assignee | No | `task_assigned` | `priority`, `assigneePriorities{}` |
| — (new subtask) | Create subtask | ceo/tl/parent assignee/parent creator | Same | `openCount+1` | No | `task_assigned` | same |
| — (forwarded) | Forward | ceo/tl/assignee/creator | Same | `openCount+1` | No | `task_assigned` | same |
| `P{n}` | Drag onto a higher-ranked sibling | **Unchecked** (client write) | Upward only; same parent; shared assignee; not done/cancelled; not a draft sibling; **reason mandatory** | Contiguous `1..k` across the sibling set | **Yes** — for every task whose *deadline* moved | none for the priority itself; `deadline_auto_extended` → manager | `priority`, `assigneePriorities.{emp}`, `order`; then cascade fields |
| `P{n}` | Drag downward | — | **Silently rejected** (`page.js:1635`) | unchanged | — | none | none |
| `P{n}` | `handleUpdatePriority` (direct set) | **Unchecked** (client write) | Clamp 1–10 only | `P{clamped}` | No | none | `priority`, `assigneePriorities.*` for **all** assignees, `order: undefined` |
| `P{n}` | `PrioritySwapPanel` drag | **Unchecked** (client write) | none | Existing number set, reordered | No | none | `priority` per changed task, then due-date recalc |
| `P1` | Task created at P1 with a time budget | system | Task must have deadline/timer/ETC | unchanged | Yes, on affected tasks | `deadline_auto_extended` → `assignedBy` | cascade fields on lower-priority tasks |
| any | Task reaches `done`/`cancelled` | system | — | Excluded from future sibling renumbering | — | — | — |

**OWNER DECISION REQUIRED (priority):**
1. Should P1 be exclusive per employee?
2. Is downward re-prioritisation legitimate? Legacy silently blocks it in drag but allows it in the direct setter.
3. Should priority changes be server-mediated, permission-checked, and audited? (Strong recommendation: yes.)
4. Which renumbering semantic is correct — contiguous, or preserve-the-set?
5. Should the employee be notified when their deadlines cascade, rather than only shown a blocking modal?
6. Should acknowledgement be rejectable, or gate anything?
7. What is the priority range, and what do P3–P9 mean? Today they are unlabelled.

---

## 3. Deadline Negotiation — Complete Sequence

### 3.1 Deadline modes

A task is in exactly one mode, decided at creation:

| Mode | Condition | Deadline field | Notes |
|---|---|---|---|
| **Timer** | `hasTimer !== false` | `dueDate`, derived from `deadlineWindowSecs` | The common case |
| **Fixed deadline** | `hasTimer === false` | `fixedDeadline`, set by creator | Skips proposal |
| **Sender-preset timer** | `senderTimerWindowSecs > 0` | `dueDate` on acceptance | Creator suggests a duration |

### 3.2 The full sequence

```
CREATE (dueDate always null)
  │
  ├─ senderTimerWindowSecs > 0 ──► employee reviews the preset
  │      ├─ POST /task/:id/approve-sender-timer  → status: deadline_approved
  │      │     dueDate = office-hours walk of senderTimerWindowSecs from now
  │      └─ POST /task/:id/reject-sender-timer   → status stays "open"
  │            requires `reason`; sets senderTimerRejected: true
  │            employee then proposes their own ↓
  │
  ├─ POST /task/:id/propose-deadline {proposedDate, windowSecs}
  │      status → pending_deadline_approval
  │      stores prevStatusBeforeDeadlineProposal, deadlineWindowSecsBeforeProposal
  │      if task was in_progress → socket "timer_blocked"
  │
  ├─ CREATOR ONLY: POST /task/:id/approve-deadline {approved, rejectionReason}
  │      approve → status restored to prevStatus if ∈{in_progress,confirmed}, else deadline_approved
  │                dueDate = max(stored proposedDeadline, office-hours walk from now)
  │      reject  → deadlineProposalRejected: true, window rolled back
  │
  ├─ POST /task/:id/tl-counter-deadline {counterDate, counterWindowSecs, message}
  │      └─ POST /task/:id/respond-tl-counter {accepted, rejectMessage}
  │
  ├─ POST /task/:id/confirm  → status: confirmed
  ├─ POST /task/:id/start    → status: in_progress, startedAt
  │
  └─ EXTENSION (two distinct mechanisms — see §3.5)
```

### 3.3 Timestamps and fields

| Concept | Field |
|---|---|
| Original negotiated window | `originalWindowSecs` (set on first approval only) |
| Current total window | `deadlineWindowSecs` |
| Window before this proposal | `deadlineWindowSecsBeforeProposal` (rollback anchor) |
| Current deadline | `dueDate` (timer mode) / `fixedDeadline` (fixed mode) |
| **Official scored deadline** | **`c1.officialDeadline`** — the only field C1 reads |
| Proposal | `proposedDeadline`, `proposedDeadlineBy`, `proposedDeadlineByName`, `proposedDeadlineAt` |
| Approval | `deadlineApprovedBy`, `deadlineApprovedByName`, `deadlineApprovedAt` |
| Extension audit | `extensions[{addedSecs, prevWindowSecs, newWindowSecs, approvedBy, approvedByName, approvedAt}]` |
| Pending extension | `pendingExtensionSecs`, `pendingExtensionPrevWindowSecs`, `awaitingExtensionStart`, `lastExtensionSecs` |
| CEO edits | `deadlineHistory[{oldDueDate, newDueDate, reason, editedBy, editedByName, editedAt}]` |
| Cascade | `deadlineAutoExtendedHistory[]` |

**The official scored deadline is separate from the displayed deadline.** `c1.officialDeadline` is written only by the extension-deduction endpoint (`taskForward.js:1542,1553`). C1 reads `c1.officialDeadline || dueDate || fixedDeadline` (`c1Service.js:201`). So a task can display a new deadline while still being scored against the old one — until `extension-deduction` runs.

### 3.4 First proposal vs extension — the additive rule

`proposeDeadline` (`service:1526`) branches on status:

```js
isExtension = status ∈ {in_progress, confirmed}
extensionSecs = windowSecs (explicit from FE)  ||  floor((proposedDate − now)/1000)
deadlineWindowSecs = isExtension ? existingWindow + extensionSecs : extensionSecs
```

Extensions are **additive**, producing an auditable chain `30m + 20m + 10m = 60m`. The explicit `windowSecs` from the frontend is preferred because the frontend computes `proposedDate` office-hours-aware; deriving from wall-clock inflates it badly ("3h typed on Sunday evening → ~19h derived", `service:1557-1562`). *CONFIRMED WORKING.*

On approval of an extension, the deadline is **not** computed from approval time. `awaitingExtensionStart: true` and `lastExtensionSecs` are set, `dueDate` is left deliberately stale, and the frontend overwrites it when the employee next presses Start (`service:1795-1805`). **FE/BE CONTRADICTION risk:** if the employee never presses Start, `dueDate` stays wrong indefinitely.

### 3.5 Two extension mechanisms — a real duplication

| | Mechanism A — negotiation | Mechanism B — request |
|---|---|---|
| **Endpoint** | `POST /task/:id/propose-deadline` while `in_progress`/`confirmed` | `POST /task/:id/request-deadline-extension` |
| **Applies to** | Timer tasks in the negotiation flow | "all task types with fixedDeadline OR any standard task" (`:1899`) |
| **Approval** | `POST /task/:id/approve-deadline` — **creator only** | `POST /task/:id/review-deadline-extension` — **any CEO/TL** |
| **Actions** | approve / reject | approve / reject / **counter** |
| **Writes** | `deadlineWindowSecs`, `extensions[]` | `deadlineExtRequest{}`, `fixedDeadline` |
| **Penalty** | Via a separate `extension-deduction` call | Auto-computed `isPenaltyWaived` at request time |

They write different fields and are approved by different people. **Duplicate implementation.**

### 3.6 The penalty-waiver rule

`request-deadline-extension` computes an elapsed percentage against the task's own window, **office-hours-aware** on both numerator and denominator so nights, breaks and off-days move neither (`taskForward.js:1913-1936`), with a wall-clock fallback.

```
Zone 1 (0–50%)  : frontend disables the button; if forced, no penalty
Zone 2 (50–70%) : no penalty
Zone 3 (70%+)   : penalty applies
isPenaltyWaived = elapsedPercent < 70
```

The reviewer's decision is applied by `POST /task/:id/extension-deduction`:

- **Waived** → `c1.officialDeadline = newDeadline`. No counter incremented. The new deadline becomes the scored one.
- **Charged** → `c1.extensionsFiled += 1`, `c1.officialDeadline = newDeadline`, **and** `writeExtensionDeduction` writes a −0.2 entry to the MongoDB SOP ledger immediately.

If the reviewer sends no explicit `waiveDeduction`, the stored `deadlineExtRequest.isPenaltyWaived` is used (`taskForward.js:1531-1536`).

**Critical:** `c1.extensionsFiled` is incremented, but `calculateTaskScore` multiplies the extension term by **zero** (`c1Service.js:63`). So the counter rises, the ledger entry is written, and the task score is unaffected. See [SCORING_LOGIC_SPEC.md](SCORING_LOGIC_SPEC.md) §3.1. **INTENDED BUT BROKEN.**

**OWNER DECISION REQUIRED:** is the 50%/70% zone model a real product rule, or an artefact? It is hard-coded and undocumented outside the code.

### 3.7 Office-hours, blocked dates, weekends

`_addWorkingSecsIST` (`taskForward.js:1622`, duplicated at `service:1645`) walks a duration through the office schedule:

- Reads `cowork_settings/office` → `schedule[day].{inTime, outTime, isOff}` and `breaks[{start, end}]`
- Skips off-days, clamps into working hours, skips breaks
- Guard of 3,660 iterations
- **Hard-codes IST** (`5.5 * 3600000`)
- On failure, falls back to `now + windowSecs + 6h` — the "**BRANDED PROBE**" marker (`:1625`, `:1707`). A silent six-hour shift used as a debugging beacon, in production.

`_snapToNextWorkingMoment` (`service:33`) is used on rework/rejection to move the re-granted deadline to the next working moment.

**Blocked dates** are a *separate*, advisory system: `GET /cowork/scheduling/blocked-dates` queries MongoDB `CompanyHoliday` and `LeaveApplication` (statuses `hr_approved`, `withdraw_pending`) and returns a map. It informs the date picker; **it is not enforced** on any write path. A duplicate endpoint exists at `/cowork/deadline-availability/blocked-dates`.

### 3.8 Repeated negotiation and unanswered proposals

- **Repeated negotiation:** unbounded. Each cycle appends to `extensions[]`. No cap.
- **Unanswered proposals: no timeout, no escalation, no expiry.** A task can sit in `pending_deadline_approval` forever. The employee's timer is blocked (advisory socket event only). **OWNER DECISION REQUIRED.**
- **Rejected proposal:** `deadlineWindowSecs` rolls back to `deadlineWindowSecsBeforeProposal` — a fix for extensions leaving the window permanently inflated (`service:1578-1581`).
- **Only the creator can approve** a proposal (`service:1717`) — but **any** CEO/TL can review an *extension request* (`taskForward.js:1989`). Asymmetric.

---

## 4. Task Start and Execution

| Step | Endpoint / mechanism | Rules |
|---|---|---|
| **Confirm receipt** | `POST /task/:id/confirm` → `confirmTaskReceipt` (`service:426`) | Must be an assignee; not already confirmed. **Deadline gate:** skipped for repeat/third-party/goal tasks and whenever `hasTimer` is explicitly `true` or `false`; enforced only when `hasTimer === undefined` (legacy tasks). Adds to `confirmedBy[]`, sets `status: "confirmed"` |
| **Start** | `POST /task/:id/start` → `markTaskStarted` (`service:465`) | Must be an assignee **and** in `confirmedBy[]`. Sets `status: "in_progress"`, `startedAt` |
| **Timer start/pause** | **Client-side only** — `hooks/useTaskTimer.js` → `cowork_task_timers/{employeeId}/sessions/{taskId}` | Fields `totalSeconds`, `isActive`, `lastStartTime`. No backend endpoint |
| **Auto-pause on switch** | `page.js:1104` pauses the running task with `autoReason: "switched_task"` before starting another | One active timer per employee, client-enforced |
| **Auto-pause on priority ack** | `PriorityChangeAckModal` confirm pauses with `autoReason: "priority_change_ack"` | |
| **Work commit** | Client writes `cowork_work_commits/{employeeId}/logs` (`page.js:1889`, `:10279`) | Optional message + attachments. Feeds the timer-SOP engine |
| **Daily report** | `POST /task/:id/daily-report` `{message, imageUrls, pdfAttachments, progressPercent, reportDate}` | `message` and `progressPercent` both **required** (`taskForward.js:1268-1269`). Stored in the `dailyReports` subcollection |
| **Task chat** | `POST/GET /task/:id/chat` → `chat` subcollection | Updates `chatMessageCount`, `lastChatAt`, `lastChatPreview` |
| **Draft chat** | `POST/GET /task/:id/draft-chat` → `draft_chat` subcollection | The **pre-start negotiation thread** — deadline proposals, timer approvals/rejections post here |
| **Attachments** | Cloudinary + Google Drive; `imageUrls[]`, `pdfAttachments[{url, name, embedUrl, downloadUrl}]` | |
| **Multiple assignees** | `assigneeIds[]`, `confirmedBy[]` per person | **But scoring uses `assigneeIds[0]` only** — see §7 |
| **Parent progress** | `_syncParentProgress` (`service:686`), or `PATCH /task/:id/parent-progress` | Rolls child completion up |
| **Goal activity progress** | `POST /task/:id/goal-activities`, per-component report request/submit | |
| **Repeat cycle** | `repeat_pending_confirmation` → `repeat_active` → per-slot submissions | Never terminates |
| **Cancellation** | **No first-class endpoint exists.** `status: "cancelled"` is written only by self-assign rejection (`taskForward.js:602`) | **Gap** |
| **Reset to draft** | `POST /task/:id/reset-to-draft` | Sender only; only from `{confirmed, in_progress, done, submitted, tl_approved, tl_final_approved, ceo_approved}`. Clears `deadlineWindowSecs`, `deadlineApprovedBy`; sets `status: "open"`. **Deliberately does not touch timers, chat, or activity logs** (`:1472-1475`) |
| **Inactivity / timeout** | **None.** No staleness sweep for tasks. (`isStale` exists but only on third-party vendor updates) | Gap |

---

## 5. Submission Logic

`POST /task/:taskId/submit-completion` → `submitCompletionRequest` (`service:1190`).

| Question | Answer |
|---|---|
| **Who may submit** | Anyone in `assigneeIds` (`service:1195`) |
| **Allowed source states** | **Any**, except when `completionStatus ∈ {tl_approved, ceo_approved, tl_final_approved}` (`service:1196`). There is **no check on `status`** — a task in `open` can be submitted without ever being confirmed or started |
| **Required message** | **No.** `message` defaults to `""` (`taskForward.js:1493`) |
| **Images / PDFs / attachments** | All optional. `imageUrls[]`, `pdfAttachments[]` |
| **Completion timestamp** | `completionSubmission.submittedAt` = `new Date().toISOString()` — **client-independent, server clock** |
| **Late-submission logic** | **Not computed at submission.** Lateness is decided later, at review, by comparing `submittedAt` against `c1.officialDeadline` (`c1Service.js:208`) |
| **Timer stopping** | **Not stopped by the backend.** The frontend has an "auto-pause-on-submit-for-review" path (`timerSop.service.js:8`) but nothing server-side enforces it |
| **Status after submission** | `completionStatus: "submitted"`. **`status` is unchanged** — the two axes are independent |
| **Reviewer selection** | `reviewFlow` computed by `_reviewFlow(task)` and **stored on the task** at submission |
| **Notification** | `completion_submitted` to flow-dependent recipients + socket `task_completion_submitted` |
| **Score event timing** | **None at submission.** C1 fires only at review |
| **Duplicate prevention** | Only the "already approved" guard. **Re-submitting while `completionStatus === "submitted"` silently overwrites** the previous submission |
| **Resubmission after rework** | Yes — rework sets `completionStatus: null`, so the guard passes |
| **Resubmission after rejection** | **Yes** — `completionStatus: "tl_rejected"` is not in the blocked set. Rejection is therefore **not final** |
| **Multi-assignee submission** | Any one assignee submits for the whole task. No per-assignee submission |
| **Repeat-task submission** | Separate path (`repeat-submit`); never reaches this endpoint |
| **Third-party completion** | Separate path; sets `completionStatus: "submitted"` via `third-party-update` type `resolved` |
| **Gold-task submission** | Same endpoint; C2 written on approval |
| **Goal-activity submission** | Per-component, separate endpoint; sets component `status: "pending_approval"` |
| **Parent-task submission** | Same endpoint. No check that children are complete |

### 5.1 Review flow resolution — `_reviewFlow` (`service:1137`)

```
rootRole = task.rootCreatedByRole || task.assignedByRole

rootRole === "tl"                                → "tl_final"      (TL approves, done)
rootRole === "ceo" && !parentTaskId && !forwardedBy → "ceo_direct"  (CEO approves, done)
rootRole === "ceo" && (parentTaskId || forwardedBy) → "tl_then_ceo" (TL, then CEO)
otherwise → legacy flags → Firestore lookup of assignedBy's role (self-healing write-back)
fallback → "tl_then_ceo"
```

`rootCreatedByRole` is inherited down forward chains (`service:604`), so a task forwarded three levels deep still routes to the original creator's flow. *CONFIRMED WORKING.*

---

## 6. Review, Approval, Rework, Rejection, CEO Review

### 6.0 The permission hole

`POST /task/:taskId/review-completion` is guarded only by `verifyCoworkToken, verifyEmployeeToken` (`taskForward.js:1576`) — i.e. *any authenticated employee*. `svc.reviewCompletion` performs **no role check, no creator check, no assignee check** (`service:1245-1372`).

**Any employee can approve or reject any task's completion**, including their own, and that approval fires the C1 score. **CONFIRMED WORKING — and it is a critical authorisation defect.**

By contrast, `/rework` does check (`role === "employee"` → 403, `taskForward.js:1503`) and `/ceo-review` uses `verifyCeoToken`. The hole is specific to `review-completion`.

### 6.1 Approval

| Aspect | Behaviour |
|---|---|
| **Who approves** | *Should be* TL or CEO per flow. **Actually: anyone** (§6.0) |
| **Source state** | `completionStatus === "submitted"` (`service:1250`) |
| **Destination** | `tl_final` → `completionStatus: "tl_final_approved"`, `status: "done"`, `progressPercent: 100`<br>`ceo_direct` → `completionStatus: "ceo_approved"`, `status: "done"`, `progressPercent: 100`<br>`tl_then_ceo` → `completionStatus: "tl_approved"`, **`status` unchanged**; awaits CEO |
| **Review record** | `tlReview{reviewedBy, reviewedByName, approved, reviewedAt}` or `ceoReview{}` |
| **Score event** | C1 fires on `tl_final_approved` / `ceo_approved` only — **not** on the intermediate `tl_approved` (`service:1331`) |
| **C2** | If `isGoldTask` and fully approved → `writeC2ScoreOnComplete` |
| **Notification** | `completion_ceo_approved` → assignees + `assignedBy` + submitter; socket `task_completed`. For `tl_then_ceo`: `completion_tl_approved` → CEO **and** submitter |
| **Timer impact** | **None** — the backend never stops the timer |
| **Parent progress** | `_syncParentProgress(parentTaskId)` on final approval |
| **Repeat cycle** | Not applicable |
| **CEO review trigger** | Only when `reviewFlow === "tl_then_ceo"` |

### 6.2 Rework

`POST /task/:taskId/rework` → `reworkTask` (`service:1380`).

| Aspect | Behaviour |
|---|---|
| **Who can request** | Any non-`employee` role (`taskForward.js:1503`) |
| **Required reason** | **No** — `reworkReason` defaults to `""` and the chat message reads "No reason given" (`service:1421`) |
| **Source state** | `completionStatus === "submitted"` (`service:1385`) |
| **Destination** | `completionStatus: null`, `status: "in_progress"` |
| **Returns to in progress** | **Yes** |
| **Original submission** | **Preserved** in `completionSubmission` — not cleared |
| **Fresh submission required** | Yes, to progress |
| **Timers restart** | **No** — timer state is untouched |
| **Deadline** | **Extended.** `leftover = oldDeadline − submittedAt`; `newDeadline = snapToNextWorkingMoment(now) + leftover`. The employee is re-granted exactly the time they had left when they submitted (`service:1393-1399`) |
| **Extension still available** | Yes |
| **Notification** | `task_rework` → submitter only, app + email |
| **Score effect** | `c1.reworksReceived += 1`; **and** `writeReworkDeduction` writes a **−0.2** entry to the MongoDB SOP ledger immediately — **unless `waiveDeduction` is true** (`service:1439`) |
| **History** | `reworkHistory[{reworkNumber, reason, sentBackBy, sentBackByName, sentBackAt, previousDeadline, newDeadline}]` |
| **Multiple reworks** | Unbounded; counter increments each time |

**OWNER-CONFIRMED NEW RULE (supersedes legacy):**
> Every completed scoring unit starts at **1.0**. Each rework deducts **0.2**. 1 rework → 0.8 (80%). 2 reworks → 0.6 (60%). A score can never fall below 0.

Legacy already implements exactly this arithmetic for rework (`c1Service.js:23-30,58-67`), so rework is the one legacy deduction that **matches** the confirmed model. Legacy's `waiveDeduction` escape hatch is **not** part of the confirmed rule — see decision below.

**OWNER DECISION REQUIRED:** does rework-waiver survive? If yes, who may waive, and must a reason be recorded? Legacy allows silent waiving by any non-employee with no audit entry.

### 6.3 Rejection

| Aspect | Behaviour |
|---|---|
| **Difference from rework** | Rework returns the task to work with a −0.2 deduction and no verdict recorded on the review. Rejection records an adverse review **and zeroes the whole task's C1 score** |
| **Who can reject** | Same hole as approval — **anyone** (§6.0) |
| **Required reason** | **Yes** — `"Rejection reason required."` (`service:1303`) |
| **Source state** | `completionStatus === "submitted"` |
| **Destination** | `completionStatus: "tl_rejected"`, `status: "in_progress"` |
| **Is it final?** | **No.** The task returns to `in_progress` and `tl_rejected` is not in the resubmission block-list, so the employee can resubmit freely |
| **Resubmission allowed** | Yes, silently |
| **Can CEO reverse it?** | Not directly. `ceoReviewCompletion` requires `completionStatus === "tl_approved"` (`service:1470`), so a CEO cannot overturn a TL rejection through that endpoint |
| **Deadline** | Same leftover-time re-grant as rework |
| **Notification** | `completion_rejected` → submitter; socket `task_completion_rejected` |
| **Score impact** | `computeAndStoreTaskScore({isRejected: true})` fires → `taskScore = c1RejectScore` (**default 0**), `c1.rejectionsReceived += 1`, `c1.c1Status = "rejected"` |
| **Audit** | `tlReview{approved: false, rejectionReason, reviewedAt}` |

**The rejection score is transient.** If the task is later resubmitted and approved, `computeAndStoreTaskScore` runs again and overwrites `taskScore`. But `_writeC1BleachEntries` also runs again, so the **MongoDB SOP ledger accumulates a second entry** for the same task. Ledger and score diverge. **INTENDED BUT BROKEN.**

**OWNER DECISION REQUIRED (explicitly flagged by the owner):** the legacy rejection deduction — zeroing the entire scoring unit — is **not approved**. The score effect of rejection must be decided. Options include: treat as N reworks; a fixed deduction; exclude the unit; or zero it as legacy does.

### 6.4 CEO review

`POST /task/:taskId/ceo-review` → `ceoReviewCompletion` (`service:1459`). Guarded by `verifyCeoToken`.

| Aspect | Behaviour |
|---|---|
| **When** | Only for `reviewFlow === "tl_then_ceo"`. Throws for `tl_final` ("CEO review not needed") and `ceo_direct` ("use that endpoint") |
| **Who sends it there** | The TL's approval, which sets `completionStatus: "tl_approved"` |
| **Precondition** | `completionStatus === "tl_approved"` |
| **Actions** | approve / reject (reason required on reject) |
| **On approve** | `completionStatus: "ceo_approved"`, `status: "done"`, `progressPercent: 100`, `ceoReview{}` |
| **On reject** | `completionStatus: "ceo_rejected"`, `status: "in_progress"`, `ceoReview{approved:false, rejectionReason}` |
| **Previous review visible** | **Yes** — `tlReview` is never cleared; both coexist |
| **Score timing** | C1 fires **only on approve** (`service:1496`). **CEO rejection produces no score event at all** — asymmetric with TL rejection |
| **Notification** | `completion_ceo_approved` / `completion_ceo_rejected` → assignees + submitter (+ `assignedBy` on approve) |
| **Reversal** | None. No endpoint reverses a completed task |
| **Deadline on CEO reject** | **Not re-granted** — unlike TL rejection and rework, no leftover-time restoration. Third inconsistency in the same family |

---

## 7. Multi-Assignee Scoring

Every C1 and C2 write uses `const primaryEmployee = (task.assigneeIds || [])[0]` (`service:1337`, `:1352`, `:1497`; `taskForward.js:1557`).

On a task with three assignees, **only the first receives any score**, positive or negative. The other two do the work and are measured on nothing. *CONFIRMED WORKING.* **OWNER DECISION REQUIRED:** split, duplicate, or weight?

---

## 8. Task Forwarding

`POST /task/:taskId/forward` `{assignments[]}` → `forwardTask` (`service:519`).

| Aspect | Behaviour |
|---|---|
| **Who can forward** | `ceo`, `tl`, **any assignee of the parent**, or the parent's `assignedBy` (`service:528-529`) |
| **Who can receive** | Any employee, one per assignment entry |
| **Required per assignment** | `employeeId`, `notes`, `senderTimerWindowSecs > 0` — **duration is mandatory** (`service:534`) |
| **Assignments missing `employeeId` or `notes`** | **Silently skipped** in the creation loop (`service:573`) while still counted in validation. A malformed entry vanishes without error |
| **Forward budget** | `parentTotal = parent.deadlineWindowSecs \|\| parent.senderTimerWindowSecs`; `alreadyForwarded = Σ(deadlineWindowSecs \|\| senderTimerWindowSecs)` over children with `isForwardedTask`; `remaining = parentTotal − alreadyForwarded` |
| **Budget enforcement** | If `thisBatch > remaining` → throw with the remaining time in the message. **Skipped entirely when `parentTotal === 0`** (fixed-deadline parents, folders, `hasTimer:false`) |
| **Budget preview** | `GET /task/:taskId/forward-budget` → `{hasBudget, totalSecs, alreadyForwardedSecs, remainingSecs}`. **Deliberately duplicated logic** so a preview bug cannot change enforcement (`service:490-492`) |
| **Ownership** | **Unchanged.** The parent keeps its `assignedBy` and `assigneeIds` |
| **Creates a child task** | **Yes** — one new task per assignment, `parentTaskId` = the forwarded task, `isForwardedTask: true` |
| **Original creator responsibility** | Retained. Parent `status` is forced to `in_progress` (`service:621`) |
| **Deadline inheritance** | **None.** Each child gets its own `senderTimerWindowSecs` and negotiates independently. `dueDate: null` |
| **Priority inheritance** | **None.** Each child gets the receiver's own `openCount + 1` |
| **Score ownership** | Each child scores independently to its own `assigneeIds[0]`. The parent scores separately |
| **Review flow** | `rootCreatedByRole` inherited so the chain routes to the original creator's flow |
| **Repeated forwarding** | Unbounded. Children can be forwarded again, consuming their own budget |
| **Rejection/approval of a forward** | **None.** The receiver cannot decline. Deadline negotiation is the only lever |
| **Notification** | `task_assigned` per child + a system chat message on the parent |
| **Duplicate endpoints** | `GET /task/:taskId/forward-budget` registered twice (`:1184`, `:1191`); second unreachable |
| **Unreachable variant** | `taskTree.routes.js` has its own `/forward` with no budget logic — **UNREACHABLE (SHADOWED)** |

---

## 9. Editing, Cancellation, Deletion

### 9.1 Editable fields by status

`EDIT_PASSED_DRAFT_STATUSES = ["confirmed", "in_progress", "done", "submitted", "tl_approved", "tl_final_approved", "ceo_approved"]` (`taskForward.js:1420`) — deliberately mirroring the frontend's `isConfirmed`/`isStarted` gate.

| Endpoint | Fields | Who |
|---|---|---|
| `PATCH /task/:id/edit-details` | `title`, `description`, `requirements[]` | **Before** draft passed: CEO/TL. **After**: only `task.assignedBy` (`:1432-1437`) |
| `PATCH /task/:id/deadline` | `dueDate` + mandatory `reason` | **CEO only** (`verifyCeoToken`). Appends to `deadlineHistory[]` |
| `POST /task/:id/move-to-folder` | `parentTaskId` | CEO/TL. Target must be `isFolder`; source must not be; no self-move |
| `POST /task/:id/reset-to-draft` | `status → open`; deletes `deadlineWindowSecs`, `deadlineApprovedBy` | **Sender only**, and only once past draft |
| `PATCH /task/:id/update-vendor-config` | `thirdPartyConfig` | CEO/TL or any assignee |
| **Priority** | `priority`, `assigneePriorities`, `order` | **Client-side Firestore write — no endpoint, no check** |
| **Assignees** | — | **No endpoint exists.** Assignees cannot be changed after creation |

### 9.2 Cancellation

There is **no cancellation endpoint**. `status: "cancelled"` is written in exactly one reachable place: self-assign rejection (`taskForward.js:602`).

Yet `cancelled` is treated as a terminal state throughout — excluded from priority auto-count (`:301`), from sibling renumbering (`page.js:1672`), from the P1 cascade (`service:2200`), and from C2 aggregation (`pmpService.js:160`). And `c1Service.markTaskCancelled` exists (`c1Service.js:327`) to set `c1.isExcluded`, `c1.c1Status: "cancelled"`, `taskScore: null` — **but nothing calls it.**

**INTENDED BUT BROKEN.** Cancellation is designed for and consumed everywhere, but cannot be triggered.

### 9.3 Deletion

`DELETE /task/:taskId` → `deleteTask` (`service:1071`). Route allows **CEO or TL** (`taskForward.js:1373`) despite the comment saying CEO-only.

| Effect | Detail |
|---|---|
| **Recursion** | Depth-first through `subtaskIds[]`, no cycle guard |
| **Subcollections** | `chat` and `dailyReports` batch-deleted |
| **Task document** | **Hard-deleted** |
| **Parent** | `subtaskIds` arrayRemove |
| **Score** | **Untouched.** MongoDB `sopPoints` entries referencing the deleted `taskId` survive as orphans, and `cowork_c1_scores` caches are not recalculated |
| **Attachments** | **Not deleted** from Cloudinary or Drive — orphaned |
| **`draft_chat` subcollection** | **Not deleted** — orphaned |
| **Notification** | `task_deleted` → assignees + socket |
| **Audit** | None. No tombstone |

**Not idempotent, not recoverable, and leaves the score ledger referencing tasks that no longer exist.** This is the strongest argument for soft-delete in the new system.

---

## 10. Canonical Task State Machine

### 10.1 Two independent axes

Legacy runs **two orthogonal state fields**, which is the single largest source of confusion:

- **`status`** — workflow position
- **`completionStatus`** — review position

A task can be `status: "in_progress"` with `completionStatus: "submitted"` (submitted, awaiting review) or `status: "done"` with `completionStatus: "ceo_approved"`. They are not synchronised and neither implies the other.

### 10.2 `status` values

| Value | Meaning | Entered by | Actors | Next | FE | BE | Reachable | Recommendation |
|---|---|---|---|---|---|---|---|---|
| `open` | Assigned, not confirmed | Default; TL approval; dept approval; hours set; reset-to-draft | assignee, creator | `pending_deadline_approval`, `deadline_approved`, `confirmed` | ✅ | ✅ | ✅ | **Preserve** as `assigned` |
| `pending_tl_approval` | Employee assigned to a TL | Create by employee → TL assignee | that TL | `open` | ✅ | ✅ | ✅ | **Preserve** — merge into a generic `pending_approval` with a typed reason |
| `pending_department_approval` | Cross-dept or CEO gate | Gates B/C | named approvers | `open`, `pending_tl_hours`, `rejected` | ✅ | ✅ | ✅ | **Preserve** — same merge |
| `pending_tl_hours` | Receiving TL must set ETC | Gate D; dept approval with `hasTimer:false` | receiving dept TL | `open` | ✅ | ✅ | ✅ | **Preserve** — same merge |
| `pending_deadline_approval` | Employee proposed a deadline | `proposeDeadline` | creator | `deadline_approved`, `in_progress`, `confirmed` | ✅ | ✅ | ✅ | **Preserve** |
| `deadline_approved` | Deadline settled, not confirmed | `approveDeadline`, `approve-sender-timer` | assignee | `confirmed` | ✅ | ✅ | ✅ | **Merge** into `assigned` + a `deadline` sub-object |
| `confirmed` | Assignee acknowledged | `confirmTaskReceipt`, self-assign approve | assignee | `in_progress` | ✅ | ✅ | ✅ | **Preserve** |
| `in_progress` | Work under way | `markTaskStarted`; also on rework/rejection; also on forward (parent) | assignee | submission | ✅ | ✅ | ✅ | **Preserve** |
| `done` | Complete | Final approval; third-party complete | — | terminal | ✅ | ✅ | ✅ | **Preserve** as `completed` |
| `cancelled` | Cancelled | **Only** self-assign rejection | — | terminal | ✅ | ✅ | ⚠️ barely | **Preserve** — needs a real endpoint |
| `rejected` | Dept approval rejected | `department-approve` reject | — | terminal | ✅ | ✅ | ✅ | **Rename** → `assignment_rejected`, to stop colliding with review rejection |
| `repeat_pending_confirmation` | Repeat awaiting acceptance | Create with `isRepeat` | assignee | `repeat_active` | ✅ | ✅ | ✅ | **Merge** into `pending_approval` |
| `repeat_active` | Repeat running | `repeat-confirm` | assignee | never terminates | ✅ | ✅ | ✅ | **Preserve** as a recurrence flag, not a status |
| `pending` | — | — | — | — | ✅ string literal | ✅ string literal | ❌ | **Drop** — never assigned to `status` by any reachable path |
| `submitted` | — | — | — | — | ✅ | ✅ | ❌ as `status` | **Drop** — lives on `completionStatus` |
| `approved` | — | — | — | — | ✅ | ✅ | ❌ as `status` | **Drop** — lives on `completionStatus` |
| `pending_approval` | Goal **component** state | `submit-report` | CEO/TL | component done | ✅ | ✅ | ✅ (component-level) | **Preserve** at component level only |
| `pending_tl_review` / `pending_ceo_review` | — | — | — | — | ✅ | grep-only | ❌ | **Drop** — dead literals |
| `not_started` | — | Referenced in one FE filter (`page.js:1675`) | — | — | ✅ | ❌ | ❌ | **Drop** |

### 10.3 `completionStatus` values

| Value | Meaning | Set by | Terminal |
|---|---|---|---|
| `null` | No open submission | rework | no |
| `submitted` | Awaiting review | `submitCompletionRequest`; third-party `resolved` | no |
| `tl_approved` | TL approved, CEO pending | `reviewCompletion` (`tl_then_ceo`) | no |
| `tl_final_approved` | TL was final approver | `reviewCompletion` (`tl_final`) | **yes** |
| `ceo_approved` | CEO approved | `reviewCompletion` (`ceo_direct`) / `ceoReviewCompletion` | **yes** |
| `tl_rejected` | Rejected at TL stage | `reviewCompletion` reject | no — resubmittable |
| `ceo_rejected` | Rejected at CEO stage | `ceoReviewCompletion` reject | no |
| `approved` | **Third-party only** | `third-party-complete` | **yes** |

### 10.4 Proposed canonical state machine

One `status` field. Review position becomes a typed `submission` sub-object, not a parallel enum. Repeat becomes a recurrence flag.

```
                    ┌──────────┐
                    │  draft   │  (creator still editing)
                    └────┬─────┘
                         │ assign
                         ▼
              ┌────────────────────┐   reject
              │ pending_approval   │──────────► assignment_rejected ●
              │  reason:           │
              │   tl_assignment    │
              │   cross_department │
              │   ceo_assignment   │
              │   effort_estimate  │
              │   self_assignment  │
              │   recurrence       │
              └────────┬───────────┘
                       │ all approvals in
                       ▼
                 ┌───────────┐  propose ┌──────────────────────┐
                 │ assigned  │◄────────►│ deadline_negotiation │
                 │ deadline: │          │ (proposal/counter)   │
                 │  {…}      │          └──────────────────────┘
                 └─────┬─────┘
                       │ confirm
                       ▼
                 ┌───────────┐
                 │ confirmed │
                 └─────┬─────┘
                       │ start
                       ▼
              ┌─────────────────┐
              │   in_progress   │◄──────────────┐
              └────────┬────────┘               │
                       │ submit                 │ rework / reject
                       ▼                        │
              ┌─────────────────┐               │
              │   in_review     │───────────────┘
              │ stage: tl|ceo   │
              └────────┬────────┘
                       │ final approval
                       ▼
                 ┌───────────┐
                 │ completed │ ●
                 └───────────┘

              cancelled ●   (reachable from every non-terminal state)
```

**What this preserves:** every approval gate (as a typed reason rather than five statuses), the deadline negotiation, the confirm/start distinction, the two-stage review, rework and rejection returning to `in_progress`, and cancellation.

**What it fixes:** one status axis instead of two; five near-identical `pending_*` statuses collapsed to one with a reason; `rejected` disambiguated from review rejection; `deadline_approved` demoted from a status to a deadline sub-state; dead literals removed; cancellation made reachable.

---

## 11. Task Logic — Owner Decisions Required

| # | Decision | Legacy behaviour | Why it must be decided |
|---|---|---|---|
| T1 | Should P1 be exclusive per employee? | No constraint | Determines whether the cascade is a queue or advisory |
| T2 | Is downward re-prioritisation allowed? | Blocked in drag, allowed in the direct setter | FE/FE contradiction |
| T3 | Server-mediated, audited priority changes? | Client-only Firestore write, no audit | Security and traceability |
| T4 | Renumber contiguously, or preserve the number set? | Both, in different UIs | Two contradictory implementations |
| T5 | Notify the employee on cascade? | Manager only | Employee learns via a blocking modal |
| T6 | Can acknowledgement be rejected, or gate anything? | No; receipt only | |
| T7 | Priority range and P3–P9 meaning | 1–10 clamp on FE, unbounded on BE, only 3 labels | |
| T8 | Are the 50%/70% extension zones a real rule? | Hard-coded | Undocumented anywhere but code |
| T9 | Timeout/escalation for unanswered proposals? | None — indefinite | Tasks can stall forever |
| T10 | Who may approve an extension? | Creator (mechanism A) vs any CEO/TL (mechanism B) | Two mechanisms disagree |
| T11 | Multi-assignee scoring | `assigneeIds[0]` only | Others are unmeasured |
| T12 | Does rework-waiver survive? Who, and audited? | Any non-employee, silent, no audit | |
| T13 | **Rejection score effect** | Zeroes the unit | **Explicitly not approved by owner** |
| T14 | Is rejection final? | No — silently resubmittable | |
| T15 | Should CEO rejection re-grant time and fire a score event? | Neither | Asymmetric with TL rejection |
| T16 | Should submission require confirm/start first? | No check on `status` | |
| T17 | Should a completion message be mandatory? | No | |
| T18 | Should re-submission while pending be blocked? | Silently overwrites | |
| T19 | Repeat tasks: should they score? | Never score | Work with no measurement |
| T20 | Third-party tasks: in scope, and should they score? | Never score | |
| T21 | Can a forward be declined? | No | |
| T22 | Should assignees be editable after creation? | No endpoint | |
| T23 | Cancellation semantics and who may cancel | No endpoint exists | |
| T24 | Soft-delete with tombstones? | Hard recursive delete | Orphans score ledger and files |
| T25 | Parent completion gating on children | None | A parent can complete with open children |
