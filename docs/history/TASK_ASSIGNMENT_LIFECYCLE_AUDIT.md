# Task Assignment Lifecycle — Receiver-Side Audit

Scope: **what happens to the person receiving the task.** Four assignment
shapes, traced from `cowork-old-backend` and compared to current. Every legacy
claim cites the file and line it was read from.

**Audit only. No code changed.**

---

## 0. Correction before the cases: there is no draft *status*

`status: "draft"` is **never written by the task module.** A grep across
`routes/` and `services/` finds it only in `HrRoutes/Payroll_section.js`, an
unrelated module. It survives in the client's `STATUS` map
(`page.js:103`, label "Draft") and in one menu condition (`page.js:6647`), but
nothing produces it.

So "draft" in the task module means two other things, and they must not be
conflated:

| Term | What it actually is |
|---|---|
| `draft_chat` | A **subcollection** — the pre-start negotiation channel |
| "Draft" section | A **client-side bucket label** in the task list |
| `status: "draft"` | **Vestigial.** Never set |

**The negotiation phase is `status: "open"` plus a `draft_chat` thread.** It
begins the instant the task is created — there is no separate draft state to
enter or leave. Current models this the same way (`assigned` + `thread:
"draft"`), so the two agree; the risk was assuming a draft state existed in
legacy and building one.

### Draft chat has no participation guard

`POST /task/:taskId/draft-chat` and `GET .../draft-chat` are guarded by
`verifyCoworkToken, verifyEmployeeToken` only (`taskForward.js:2035`, `:2043`),
and neither `sendDraftChat` nor `getDraftChat` checks membership. **Any
authenticated employee can read and post to any task's negotiation thread**,
including tasks they are not on. This is a legacy authorisation defect of the
same family `LEGACY_AUDIT.md` records elsewhere — recorded here, not reproduced.

---

## Case 1 — Manager → direct report (Priya → Maya)

### LEGACY

**1. Creation.** Status `open`. `const dueDate = null` is hardcoded
(`taskForward.js:139`). `senderTimerWindowSecs` carries the proposed working
time. **Maya is in `assigneeIds` immediately.**

The cross-department gate does *not* fire even though Priya (Operations) and
Maya (Product) differ, because `assignerIsTargetsManager` is true — Priya is
Maya's `primaryManager` — and that check short-circuits the gate entirely
(`taskForward.js:180`).

- **Tasks list:** yes, immediately, labelled **"Not Started"** (`STATUS.open`).
- **Approval list:** no. This case never enters one.

**2. Negotiation.** Begins at creation. `draft_chat` is created **lazily** — on
the first message, system or human. Maya's actions:

| Action | Endpoint | Guard | Result |
|---|---|---|---|
| Accept the window | `/approve-sender-timer` | in `assigneeIds`; status `open`; window > 0 | → `deadline_approved`, `dueDate` computed from **working** time |
| Refuse it | `/reject-sender-timer` | reason required | **status unchanged**; records `senderTimerRejected` + reason; posts to `draft_chat` |
| Propose her own | `/propose-deadline` | in `assigneeIds` | → `pending_deadline_approval` |
| Discuss | `/draft-chat` | none (see §0) | message |

The assignor then decides via `/approve-deadline` — guard
`task.assignedBy !== approverId` → 403, so **only the creator**, never a manager.

**3. Confirmation.** `/confirm` → `confirmTaskReceipt`: must be in
`assigneeIds`, cannot confirm twice (`confirmedBy[]`). Timer and fixed tasks
confirm directly. Status → `confirmed`. Then `/start` → `in_progress`, gated on
`confirmedBy.includes(employeeId)`.

**4. Approval UI.** Absent by design.

### CURRENT

1. Status `assigned`, `deadline.state: "unset"`, `currentWindowSecs` set, no due
   date. Maya attached immediately. Gate skipped — but via the **transitive
   closure**, not legacy's direct-manager test. Same outcome here.
2. `thread: "draft"` exists from creation (not lazily). `ChatPanel` gates it
   active/read-only. Actions exist: `acceptAssignorWindow`,
   `rejectAssignorWindow`, `proposeDeadline`.
3. `confirmTask` → `confirmed`; `startTask` → `in_progress`, gated the same way.
4. Not in the approvals list. Matches.

### Difference

| | Legacy | Current |
|---|---|---|
| Accept / refuse window | reachable in the UI | **repository only — no UI** |
| Budget vs deadline | Priya's own `hasTimer` choice | derived from the reporting line |
| Due date on accept | working-time arithmetic | wall-clock (documented divergence) |

---

## Case 2 — Employee → manager (Tobias → Maya)

### LEGACY

**1. Creation.** `requesterRole === "employee"` and Maya's role is `tl`, so the
upward gate fires → **`pending_tl_approval`** (`taskForward.js:152`). Same
department, so the cross-department gate does not override it.

Critically: **the upward gate does not clear `assigneeIds`.** Only the
department gate does. Maya is on the task from creation.

- **Tasks list:** yes — hers, labelled **"Pending TL Approval"**.
- **Approval list:** legacy keeps a *separate* list per gate; this one surfaces
  through the task list's status, not the cross-department approvals query.

**2. Negotiation.** Blocked until approval: `/approve-sender-timer` requires
status `open`, and this task is `pending_tl_approval`. Draft chat is reachable
(no guard), but no window action is.

**3. Confirmation.** `POST /task/:taskId/approve` (`taskTree.routes.js:765`) —
guards: `requesterRole !== "tl"` → 403, **and** `assigneeIds.includes(employeeId)`
→ *"You are not assigned to this task."* So **the receiving manager approves her
own incoming work**, and status → `open`. Only then does Case 1's negotiation
begin.

**4. Approval UI.** Her own task row, acted on in place.

### CURRENT

1. Fires on `administrativeLevel` rather than the literal role `tl` — so it also
   covers manager → senior, which legacy left ungated. Status `pending_approval`,
   reason `tl_assignment`, one `Approval` record with Maya as approver. Maya is
   attached (only cross-department withholds).
2. Same block: `acceptAssignorWindow` requires status `assigned`.
3. `decideApproval` → `assigned`.
4. Appears in the approvals list **and** her task list.

### Difference

Legacy has no approval *records* — the status field is the state. Current writes
a record, which is what lets one approvals list serve every gate. Behaviourally
equivalent; the record is strictly more inspectable.

---

## Case 3 — Peer → peer (Tobias → Jonas, both Product, both report to Maya)

### LEGACY

**1. Creation.** Jonas's role is `employee`, not `tl`, so no upward gate. Same
department, so no department gate. Status **`open`**, Jonas in `assigneeIds`.

- **Tasks list:** yes, immediately, "Not Started".
- **Approval list:** no.

**2–3.** Identical to Case 1 — accept/refuse the window, propose, confirm, start.

**4.** No approval UI.

### CURRENT

Status `assigned`, no gate, Jonas attached. Matches.

### Difference

**Deadline mode.** Legacy: whatever Tobias chose. Current: `fixed`, because no
reporting line reaches a peer, so Jonas cannot negotiate a window at all — he
receives a date. That is a materially different receiver experience for the most
common assignment shape between colleagues.

---

## Case 4 — Cross department (Tobias, Product → Idris, Platform)

### LEGACY

**1. Creation.** Gate fires. Status **`pending_department_approval`**.
`assigneeIds: []`; `pendingAssigneeId` = Idris;
`departmentApprovals: [sender pending, receiver waiting]`.

- **Idris's tasks list:** **nothing.** He does not know the task exists.
- **Approval list:** the two approvers see it via
  `where("status","==","pending_department_approval")` filtered client-side for
  `departmentApprovals.find(a => a.approverId === me && a.status === "pending")`
  (`page.js:3596`). The comment explains the client-side filter: Firestore
  cannot query inside an array of objects.

**2. Negotiation.** None available to Idris — he is not on the task. Draft chat
is technically reachable by anyone (§0) but he has no route to the task.

**3. Confirmation.** Sender approves → receiver's entry flips `waiting` →
`pending`. Receiver approves →
`finalStatus = (task.hasTimer === false) ? "pending_tl_hours" : "open"`, and
`arrayUnion(finalAssigneeId)` runs **only** in the `open` branch
(`taskForward.js:1073`). If `pending_tl_hours`, the receiving department's TL
sets the effort via `/department-tl-set-hours`, which converts the task to
`hasTimer: true` and performs the `arrayUnion` itself.

**Only at that point does Idris see the task** — and he then enters Case 1's
negotiation from the start. Reject at any stage → status `rejected`.

**4. Approval UI.** A dedicated cross-department approvals list for approvers;
nothing for Idris until release.

### CURRENT

1. Same gate shape and eligibility. Status `pending_approval`, reason
   `cross_department`, two records, `pendingAssigneeIds` holds Idris, no
   assignment rows. **Verified**: while pending, the task does not appear on his
   list.
2. Nothing available to him. Matches.
3. Sequential flip verified. On completion: if mode is `fixed`, an
   `effort_estimate` approval is raised for the receiving department's head; on
   `setEffortEstimate` the task converts to `timer` and he is released. Verified
   end to end.
4. One approvals list serves all reasons.

### Difference

| | Legacy | Current |
|---|---|---|
| Approver resolution | `where(role=="tl").limit(1)` — unordered coin flip | department's named `hodEmployeeId` |
| No approver on file | falls back to default approver `E000` | hard block with a named reason |
| Reject status | `rejected` | `assignment_rejected` |

---

## Summary — receiver-side

| | Attached at creation? | Sees it when? | Can negotiate? | Approves own intake? |
|---|---|---|---|---|
| **1. Manager → report** | yes | immediately | yes, at once | no |
| **2. Employee → manager** | yes | immediately | after approving | **yes** |
| **3. Peer → peer** | yes | immediately | yes, at once | no |
| **4. Cross-department** | **no** | after all approvals (and effort, if fixed) | after release | no — heads decide |

Current matches all four on attachment, visibility timing and approval routing.

### Verified matching
1. Attachment timing in all four cases
2. Cross-department invisibility until release, including the effort stage
3. Upward gate approved by the receiving person themselves
4. Confirmation before start, one confirmation per assignee
5. Refusal of a window leaving status untouched
6. Negotiation blocked while a gate is open

### Differences that affect the receiver
| # | Issue | Cases | Severity |
|---|---|---|---|
| R1 | Accept / refuse window unreachable — no UI | 1, 3, 4 | **Blocking.** The receiver's first action in every ungated case cannot be performed |
| R2 | Deadline mode derived, not chosen | 1, 3 | Material — peers can never negotiate a window |
| R3 | Wall-clock due date on accept | all | Moderate — a 4h task accepted at 17:15 falls due at 21:15 |
| R4 | No `E000`-style fallback approver | 4 | Low — current blocks with a clear message |
| R5 | Draft chat participation guard | all | Legacy defect **not** reproduced. Current should keep its guard |

### Recommended order
1. **R1** — wire accept/refuse (and set-effort) into the UI. Until this exists,
   the receiver-side state machine is unreachable in three of four cases, and no
   other fix can be exercised by a real user.
2. **R3** — office calendar, then working-time arithmetic.
3. **R2** — product decision, not a defect to fix unilaterally.
4. **R4** — optional.
5. **R5** — no action; do not port the missing guard.
