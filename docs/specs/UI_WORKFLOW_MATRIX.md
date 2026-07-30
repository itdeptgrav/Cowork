# UI Workflow Matrix

**Date:** 2026-07-25
**Format:** actor → trigger → UI state → repository action → resulting state → notification → score effect → project effect → error state

**UI column legend:** ✅ screen built · ⚙️ logic built, screen pending · ❌ neither

---

## 1. Task creation

| # | Actor | Trigger | UI state | Repository action | Resulting state | Notification | Score | Project | Error states | UI |
|---|---|---|---|---|---|---|---|---|---|---|
| 1.1 | Anyone | New task | Form | `createTask` | `assigned`, rank = open count + 1 per assignee | `task_assigned` → assignees | none | linked if `projectId` | title empty · no assignee | ⚙️ |
| 1.2 | Anyone | Self-assign with approver | Form + approver picker | `createTask` type `self_assigned` | `pending_approval`, reason `self_assignment` | approval request → approver | none | — | no approver chosen | ⚙️ |
| 1.3 | Anyone | Cross-department assign | Form | `createTask` | `pending_approval`, reason `cross_department`, two-stage gate | request → sender-side approver; receiver-side stays `waiting` | none | — | no approver resolvable | ⚙️ |
| 1.4 | Manager | Folder | Form | `createTask` type `folder` | `assigned`, no assignee required | none | none | — | name empty | ⚙️ |
| 1.5 | Anyone | Subtask | Detail → add | `createTask` with `parentTaskId` | `assigned` | `task_assigned` | none | inherits project | — | ⚙️ |
| 1.6 | Anyone | Recurring | Form + cadence | `createTask` type `recurring` | `assigned`, `isScoreEligible: false` | `task_assigned` | **never scores (O20)** | — | — | ⚙️ |
| 1.7 | Manager | Goal-linked | Form + goal picker | `createTask` type `goal` | `assigned` | `task_assigned` | C2 via activity | — | — | ⚙️ |

---

## 2. Approval gates

| # | Actor | Trigger | UI state | Repository action | Resulting state | Notification | Score | Error |
|---|---|---|---|---|---|---|---|---|
| 2.1 | Named approver | Approve | Pending badge | `decideApproval("approved")` | next `waiting` → `pending`, or task → `assigned` when all clear | your-turn → next approver, or completion → creator + assignee | none | not your approval · already decided | ⚙️ |
| 2.2 | Named approver | Reject | Pending badge | `decideApproval("rejected")` | `assignment_rejected` | rejection → creator | none | reason required | ⚙️ |

Sequential gate preserved from legacy: the receiver side is `waiting`, not `pending`, until the sender side approves — so no one can act out of order.

---

## 3. Priority

| # | Actor | Trigger | UI state | Repository action | Resulting state | Notification | Score | Error | UI |
|---|---|---|---|---|---|---|---|---|---|
| 3.1 | Manager / self | Change rank | Dialog, reason required | `changePriority` | contiguous renumber; lower-ranked deadlines cascade | `priority_cascade` → **affected person and manager** | **none** (T6) | reason empty · rank out of 1–10 | ✅ |
| 3.2 | System | Cascade fires | Preview in dialog | inside `changePriority` | each moved task gains a `CascadeEffect`; worked time credited; never moves earlier | as above | none | — | ✅ |
| 3.3 | Affected person | Cascade pending | **Blocking, non-dismissable modal** | `acknowledgeCascade` | acknowledged; optional timer pause | — | none | offline | ✅ |
| 3.4 | System | Duplicate rank | Banner + amber rank chip | `listPriorityConflicts` | **detected, not blocked** (O10) | — | none | — | ✅ |

Legacy comparison: the change now goes through the repository (was a client-side datastore write with no permission check and no audit), a reason is mandatory on every path (was required only in drag), the cascade runs inside the mutation (was a 500 ms timer racing its own write), and the affected person is notified (was manager-only).

---

## 4. Deadline negotiation

| # | Actor | Trigger | UI state | Repository action | Resulting state | Notification | Score | Error | UI |
|---|---|---|---|---|---|---|---|---|---|
| 4.1 | Assignee | Propose | Date + duration | `proposeDeadline` | `deadline_negotiation`, state `proposed`, expiry set | `deadline_proposed` → creator | none | blocked date (**enforced**) · zero duration | ⚙️ |
| 4.2 | Creator | Approve | Pending card | `decideProposal("approved")` | `dueAt` + `officialDueAt` set, state `agreed`, task → `assigned` | → proposer | none | already decided | ⚙️ |
| 4.3 | Creator | Reject | Pending card | `decideProposal("rejected")` | window rolled back to pre-proposal, state `unset` | → proposer | none | reason required | ⚙️ |
| 4.4 | Creator | Counter | Counter form | `counterProposal` | state `countered` | `deadline_countered` → proposer | none | — | ⚙️ |
| 4.5 | Assignee | Accept counter | Counter card | `respondToCounter(true)` | state `agreed` | — | none | — | ⚙️ |
| 4.6 | Assignee | Reject counter | Counter card | `respondToCounter(false)` | state `unset` | — | none | — | ⚙️ |
| 4.7 | Assignee | Request extension | Extension form | `requestExtension` | state `extension_pending`; additive window | `extension_requested` → creator | none | **below 50% elapsed (O14)** · reason required | ⚙️ |
| 4.8 | Manager | Approve + **waive** | Waiver choice | `decideExtension(waive: true)` | `dueAt` **and** `officialDueAt` move | → requester | **no deduction** | — | ⚙️ |
| 4.9 | Manager | Approve + **charge** | Waiver choice | `decideExtension(waive: false)` | `dueAt` moves, `officialDueAt` **stays** | → requester | **C1 deduction (provisional, O6)** | — | ⚙️ |
| 4.10 | Manager | Reject extension | — | `decideExtension("rejected")` | state back to `agreed` | → requester | none | — | ⚙️ |

The `dueAt` / `officialDueAt` split is the mechanism: a waived extension moves the scored deadline, a charged one does not.

---

## 5. Execution

| # | Actor | Trigger | UI state | Repository action | Resulting state | Score | Error | UI |
|---|---|---|---|---|---|---|---|---|
| 5.1 | Assignee | Confirm | Confirm button | `confirmTask` | `confirmed` | none | **deadline must be agreed** | ⚙️ |
| 5.2 | Assignee | Start | Start button | `startTask` | `in_progress` | none | must confirm first | ⚙️ |
| 5.3 | Assignee | Start timer | Running indicator | `startTimer` | active session; **any other timer auto-pauses** | none | offline | ⚙️ |
| 5.4 | Assignee | Pause timer | Commit form | `pauseTimer` | `WorkCommit` written | feeds cascade credit | no timer running | ⚙️ |
| 5.5 | Assignee | Daily report | Form | `submitDailyReport` | report stored | none | message required | ⚙️ |
| 5.6 | Anyone | Task chat | Thread | `sendTaskChat` | message added | none | empty message | ⚙️ |

---

## 6. Submission and review

| # | Actor | Trigger | UI state | Repository action | Resulting state | Notification | Score | Project | Error | UI |
|---|---|---|---|---|---|---|---|---|---|---|
| 6.1 | Assignee | Submit | Form + attachments | `submitCompletion` | `in_review`; new attempt supersedes prior; **timer stops server-side**; `wasLate` computed | `review_requested` → first reviewer | none yet | — | **must be started (T16)** · **message required (T17)** | ⚙️ |
| 6.2 | Reviewer | Approve (final) | Review screen | `reviewSubmission("approved")` | `completed` | `task_approved` → submitter | **C1 unit settles** | progress + health recompute | **cannot review own** · not in chain | ⚙️ |
| 6.3 | Reviewer | Approve (non-final) | Review screen | `reviewSubmission("approved")` | stays `in_review`, stage + 1 | → next reviewer | none yet | — | as above | ⚙️ |
| 6.4 | Reviewer | Rework | Reason required | `reviewSubmission("rework")` | `in_progress`; **leftover time re-granted**; occurrence + 1 | `rework_requested` → submitter | **−0.2 per occurrence (confirmed)** unless waived (O18) | — | reason required | ⚙️ |
| 6.5 | Reviewer | Reject | Reason required | `reviewSubmission("rejected")` | `in_progress`; **time re-granted symmetrically** | `rejected` → submitter | **OWNER DECISION REQUIRED (O4)** — provisional 0.4 | — | reason required | ⚙️ |
| 6.6 | Assignee | Resubmit | Form | `submitCompletion` | new attempt; prior superseded | → reviewer | prior rejection reversed on approval | — | — | ⚙️ |

Two legacy defects fixed here: `reviewSubmission` now checks that the reviewer is in the chain and is not the submitter (legacy had **no check at all**), and rejection re-grants time exactly as rework does (legacy did it for one and not the other).

---

## 7. Forwarding

| # | Actor | Trigger | UI state | Repository action | Resulting state | Notification | Score | Error | UI |
|---|---|---|---|---|---|---|---|---|---|
| 7.1 | Assignee / manager | Forward | Budget-aware form | `getForwardBudget` then `forwardTask` | child task per recipient, `parentTaskId` set | `task_assigned` per child | child scores to its own subject | **budget exceeded** · note required · duration required | ⚙️ |

No deadline or priority inheritance — each child negotiates its own and receives the recipient's own next rank. Ownership of the parent does not change.

---

## 8. Projects

| # | Actor | Trigger | UI state | Repository action | Resulting state | Project effect | Error | UI |
|---|---|---|---|---|---|---|---|---|
| 8.1 | Manager+ | Create project | Form | `createProject` | project + owner member + optional initial links | activity entry | name required | ⚙️ |
| 8.2 | Owner | Add member | Picker | `addProjectMember` | member added | activity entry | already a member | ⚙️ |
| 8.3 | Owner | Remove member | Confirm | `removeProjectMember` | member removed | activity entry | **cannot remove the owner** | ⚙️ |
| 8.4 | Member | Link task | Picker | `linkTask` | link created, `task.projectId` set | progress recompute | already linked | ⚙️ |
| 8.5 | Member | Unlink task | Confirm | `unlinkTask` | link removed, **task survives** | progress recompute | not linked | ⚙️ |
| 8.6 | Owner | Add milestone | Form | `addMilestone` | milestone added | progress recompute | title required | ⚙️ |
| 8.7 | Skip-level | Archive | Confirm | `archiveProject` | `archived` | activity entry | — | ⚙️ |
| 8.8 | System | Any task change | — | `computeProgress` | — | **derived** progress + health (provisional P1) | — | ✅ visible on `/` and `/tasks` |

Project progress is always derived from connected-task data. There is no writable progress field.

---

## 9. Scoring

| # | Trigger | Component | Unit | Deduction | Confirmed? |
|---|---|---|---|---|---|
| 9.1 | Task completed | C1 | one task, max 1.0 | — (credit 1.0) | ✅ |
| 9.2 | Rework applied | C1 | same unit | **0.2 per occurrence** | ✅ **confirmed** |
| 9.3 | Deadline missed | C1 | same unit | 0.2 | ❌ provisional O6 |
| 9.4 | Extension charged | C1 | same unit | 0.2 | ❌ provisional O6 |
| 9.5 | Rejection | C1 | same unit | 0.4 | ❌ **O4 — owner withheld approval** |
| 9.6 | Task cancelled | C1 | unit **excluded**, not zeroed | — | ❌ provisional O6 |
| 9.7 | Goal activity approved | C2 | one activity | — (credit) | ❌ provisional O8 |
| 9.8 | Goal activity late | C2 | same unit | full forfeit | ❌ provisional O8 |
| 9.9 | Conduct breach | C3 | one event | by severity | ❌ provisional O7 |
| 9.10 | Attendance day | C4 | one expected working day | — | denominator from **calendar**, not events |
| 9.11 | Late arrival | C4 | same unit | **proportional** `(late − grace) × rate` | ✅ proportional confirmed; ❌ rate O5 |
| 9.12 | Absence | C4 | same unit | 1.0 | ❌ provisional O5 |

Aggregation everywhere: `Σ earned ÷ Σ possible × 100`. Never an average of percentages. Every entry carries `ruleVersion` + `configSnapshot`, so a historical score reproduces after a rule change.

---

## 10. The end-to-end demo flow

The flow the brief asked for. **Logic status** is what the repository supports; **UI status** is what a person can actually click today.

| Step | Logic | UI |
|---|---|---|
| Open Tasks | ✅ | ✅ |
| Switch to Projects | ✅ | ❌ route missing |
| Create a project | ✅ | ❌ |
| Add members | ✅ | ❌ |
| Create or connect tasks | ✅ | ❌ |
| Open a task | ✅ | ❌ detail route missing |
| Encounter a P1 conflict | ✅ | ✅ **surfaced on `/` and in the table** |
| Resolve priority | ✅ | ✅ **dialog + cascade preview + blocking acknowledgement** |
| Negotiate deadline | ✅ | ❌ |
| Start work | ✅ | ❌ |
| Submit task | ✅ | ❌ |
| Manager requests rework | ✅ | ❌ (queue lists on Approvals tab) |
| Employee resubmits | ✅ | ❌ |
| Manager approves | ✅ | ❌ |
| Task score changes | ✅ | ⚠️ visible in the ambient pill and hero band |
| Project progress updates | ✅ | ✅ on `/` and `/tasks` |
| Score ledger updates | ✅ | ❌ no ledger view |

**Clickable end to end today: the priority segment only.** Everything else runs through the repository but has no screen.
