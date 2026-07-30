# Task Module — Parity Fix Plan

Consolidates every disparity found in `TASK_MODULE_PARITY_REPORT.md` and
`TASK_ASSIGNMENT_LIFECYCLE_AUDIT.md` into one roadmap.

**Planning only. No code changed to produce this.**

## Classification key

| | Meaning |
|---|---|
| **A — Must match legacy** | Legacy behaviour is the specification. Divergence is a defect. |
| **B — Intentional product change** | Already decided in earlier work, or a legacy defect deliberately not reproduced. No action beyond keeping the record. |
| **C — Needs your decision** | Legacy and a prior explicit instruction of yours disagree. I will not choose. |

Current status of the module: **14 disparities. 3 fixed, 4 class A open,
7 class B settled, 0 class C blocked.**

> **Decisions taken (2026-07-27).**
> **C1 — resolved: keep current.** Budget vs deadline stays derived from the
> hierarchy relationship. Legacy's creator-chosen `hasTimer` control is NOT
> restored. This is now an accepted, permanent divergence.
> **C2 — resolved: restore legacy.** Only a DIRECT manager clears the
> cross-department gate. Implemented and verified.

---

# Class C — RESOLVED

Both decided on 2026-07-27. Kept here as the record of what was decided and why.

## C1 · Budget vs deadline: derived or chosen — **DECIDED: keep current**

**Legacy.** `hasTimer` arrives in the request body (`taskForward.js:137`). The
old UI renders it as two buttons labelled **"Own Department"** and **"Other
Department"**, with the hint *"ℹ️ Cross-department tasks only"*
(`CreateTaskModal.jsx:62`). The creator picks. No server-side derivation exists,
and no validation checks the choice against actual departments.

**Current.** Derived from the reporting relationship by
`assignmentRelationship`. No control is shown.

**Difference.** Who decides, and on what basis. Legacy: the creator, framed by
*department*. Current: the system, from the *reporting line*.

**Business impact.** Two effects, opposite in sign.

- *Against current:* a peer assigning to a peer can never offer a negotiable
  window — the relationship resolves outside the reporting line, so the receiver
  gets a fixed date. Between colleagues, which is the most common assignment
  shape in a flat team, legacy allowed a budget and Cowork does not.
- *For current:* legacy's control was mislabelled and unvalidated. A creator
  could mark a same-department task "Other Department" and impose a
  non-negotiable date on their own report with no check. The derivation cannot
  be gamed.

**Why this is yours.** You instructed, in the task-creation refinement:
*"Budget and Deadline are NOT user-selectable… automatically determined by
hierarchy relationship… Do not show dropdowns, radio buttons, toggles"*, and
confirmed it. You later instructed that a reporting line spanning a department
boundary must win. Reverting to legacy undoes both.

**Decision.** Option (a) — keep current. The divergence is accepted and
permanent. The peer-to-peer consequence stands: colleagues who do not report to
one another exchange fixed dates, not budgets.

## C2 · Cross-department skip breadth — **DECIDED: restore legacy. Done.**

**Legacy.** The gate is skipped when `assignerIsTargetsManager` — the assigner is
the target's **direct** `primaryManager` (`taskForward.js:180`). One level only.

**Current.** Skipped whenever the assignee is inside the assigner's **transitive
closure** — direct or any number of levels down.

**Difference.** A skip-level manager. Priya → Tobias (two levels, crossing two
departments): legacy gates it and asks two department heads; current does not.

**Business impact.** Current lets a senior manager route work anywhere beneath
them without departmental consent. Legacy required the heads to agree unless the
assigner was the immediate manager. Current is more permissive; whether that is
correct depends on whether authority in Cowork is meant to flow transitively.

**Decision.** Restore legacy. **Implemented.** `assignmentRelationship` now takes
`directReportIds` alongside `hierarchyIds`, and the two questions are answered
separately:

- **deadline model** — the full reporting line (C1 unchanged)
- **approval gate** — the direct manager only (C2, legacy)

They had the same answer only by accident. A skip-level manager assigning across
a department now gets a Budget *and* two approvers, which is coherent and was
expressible in legacy too.

Verified against the repository:

| Case | Gated? | Approvers | Mode | Assignee sees it |
|---|---|---|---|---|
| Priya → Maya (direct, diff dept) | no | — | Budget | yes |
| Priya → Tobias (skip-level, diff dept) | **yes** | Hanne, Maya | Budget | **no** |
| Maya → Tobias (direct, same dept) | no | — | Budget | yes |
| Tobias → Idris (no line, diff dept) | yes | Maya, Renata | Deadline | no |

---

# Class A — must match legacy

## A1 · Repeat task cycle *(the M1 you were about to start)*

**Legacy.** `isRepeat` at creation overrides every other gate → status
`repeat_pending_confirmation` (`taskForward.js:158`).
`POST /repeat-confirm` — guards: `isRepeat`, in `assigneeIds`, status must be
`repeat_pending_confirmation`, idempotent if already `repeat_active` — sets
`repeat_active`, which unlocks chat and daily submissions.
`POST /repeat-submit` — requires `date` and `slotIndex`, refuses duplicates
(*"Already submitted for this slot today"*), writes
`repeatSubmissions.{date}.{slotKey}`.
`hasTimer: isRepeat || isThirdParty || isGoal ? null : …` — repeat tasks carry
no timer and no `fixedDeadline`.

**Current.** `type: "recurring"` exists with `isScoreEligible: false`. No
confirmation state, no active state, no per-slot submission model, no
`repeatSubmissions` structure. A recurring task is created as an ordinary
`assigned` task and behaves like one.

**Difference.** The entire cycle is absent.

**Business impact.** Recurring work — the standing daily and weekly obligations —
has no mechanism at all. A repeating task cannot be accepted, cannot record a
per-slot submission, and cannot be distinguished from one-off work once created.
This is the largest functional gap in the module.

**Not yet audited:** `repeatConfig` shape (slots, cadence, days), how occurrences
relate to scoring, and what "unlocks chat" means concretely. **A1 needs its own
audit before implementation** — I know the state transitions, not the data model.

## A2 · Working-hours due-date arithmetic

**Legacy.** `_addWorkingSecsIST` reads schedule and breaks from
`cowork_settings/office` and consumes only working time. Its fallback is
deliberately branded (`+6h`) so the failure is visible in data.

**Current.** Wall-clock addition, marked `KNOWN DIVERGENCE` in
`acceptAssignorWindow`.

**Difference.** A 4-hour task accepted at 17:15 falls due at 21:15 tonight
instead of 11:15 tomorrow.

**Business impact.** Every budget task gets a wrong due date, and the error feeds
scoring — `deadlinesMissed` counts against C1. Overnight and weekend acceptances
are systematically penalised. Silent, and it compounds.

**Blocked on:** Cowork has no office-schedule model. `Employee.workCalendarId`
exists and nothing resolves it. This needs the calendar built first — which is
why I did not approximate it.

## A3 · C1 scoring arithmetic — unverified

**Legacy.** `taskScore = base − (deadlineDeduction × missed) −
(extensionDeduction × filed) − (reworkDeduction × reworks)`. Eligibility:
`taskScore != null && !isExcluded` (`c1Service.js:78`). **Every eligible task
counts as 1** — the `etcHours` weighting was removed and the comment says so.
`markTaskCancelled` sets `isExcluded: true`, `c1Status: "cancelled"`,
`taskScore: null`.

**Current.** `deadline.officialDueAt` correctly preserved as the scoring-only
field. The deduction arithmetic, the equal-weighting rule and the cancellation
exclusion path were **not checked** against `lib/scoring/engine.ts`.

**Business impact.** Unknown, which is the problem. Scoring errors are silent,
affect pay and standing, and compound monthly. Cheap to verify; expensive to
discover late.

## A4 · Notification coverage — unverified

**Legacy.** ~30 task-module types across four channels (Firestore bell, FCM,
email, socket), including `department_approval_your_turn`,
`department_draft_needs_hours`, `deadline_counter_rejected`,
`completion_ceo_approved`.

**Current.** `Notification.type` is an open `string` and channels are modelled,
so anything legacy emits *can* be emitted. Which types are *actually* emitted was
not enumerated.

**Business impact.** A missing notification is invisible by nature — the
approver simply never learns it is their turn, and the task stalls with nobody
at fault. Directly undermines the approval chains already built.

---

# Class B — settled, no action

| # | Item | Why closed |
|---|---|---|
| B1 | **Accept / refuse / set-effort had no UI** | **Fixed.** Wired into `DeadlinePanel` and `TaskDetail` |
| B2 | Approvals stored as records, not an embedded array | Same fields, same sequential behaviour, strictly more inspectable |
| B3 | Three approval lists collapsed into one | Legacy needed three because its statuses were three; one reason-typed list shows every pending decision in one place |
| B4 | Reject sets `assignment_rejected`, not `rejected` | Naming only |
| B5 | Upward gate keys on `administrativeLevel`, not literal `role === "tl"` | Closes a hole where a lead could put work on the CEO's list unannounced; also avoids hard-coding role names, which `PRODUCT.md` forbids |
| B6 | Approver resolved from named `hodEmployeeId`, not `where(role=="tl").limit(1)` | Legacy's was an unordered coin flip — a defect `LEGACY_AUDIT.md` records |
| B7 | Draft chat has no participation guard in legacy | **Deliberately not reproduced.** Any authenticated employee can read and post to any task's negotiation thread in legacy. Keep our guard |
| B8 | `status: "draft"` | Vestigial in legacy — never written by the task module. Correctly absent here |
| B9 | No `E000` default approver fallback | Legacy fell back to a magic employee id; current blocks with a named reason. The clear refusal is better than a silent reassignment |
| B10 | CEO exemption from the cross-department gate not reproduced | Legacy replaced it with a separate CEO gate; dropping both would let an administrator create ungated crossings |

---

# Outside the task module, found in passing

Not part of parity, but discovered while auditing and worth recording.

| # | Issue | Impact |
|---|---|---|
| X1 | `components/dashboard/signals.ts` has `const VIEWER = "e-01"` | `NowCard`, `Chrome`, `Stats`, `AttentionCard` all compute "is this my move" for one seeded person. Same defect class already fixed in the task cards and `DeadlinePanel` |
| X2 | `baseTask` in `lib/mock/seed.ts` ends with `as Task` | Silences missing-field errors. When `pendingAssigneeIds` was added, `tsc` passed while every fixture lacked it; it failed at runtime instead |
| X3 | `role-skip` has no `task.create`; `role-admin` has no `review.decide` | Priya can only create work for herself; Rishee cannot approve anything. One grant each in `/admin/roles` |

---

# Implementation order

**Phase 0 — unblock.** ✅ Complete. C1 and C2 decided and, where applicable,
implemented.

**Phase 1 — verification, no new behaviour.** Cheap, and both items are silent
failures that get more expensive the longer they run.

1. **A3** — verify C1 arithmetic against `lib/scoring/engine.ts`. Half a day.
   Scoring is the one thing that reaches people's standing.
2. **A4** — enumerate legacy's ~30 notification types against what current
   emits. A stalled approval nobody is told about defeats the chains already
   built.

**Phase 2 — the large build.**

3. **A1 — repeat cycle**, in two steps: audit `repeatConfig` and the submission
   model first, then implement. Do not start the implementation from the state
   transitions alone; I know those, not the data shape.

**Phase 3 — infrastructure.**

4. **A2** — office-schedule model, then working-time arithmetic. Larger than it
   looks: a calendar with breaks and non-working days, then rework every place a
   due date is computed. Sequenced last because the wrong due dates are
   consistent and understood, whereas a half-built calendar would be neither.

**Opportunistic.** X1 and X2 are small and independent; X2 in particular will
keep hiding real errors until removed.

**Recommendation:** answer C1 and C2, then let me run phase 1 — both items are
verification rather than construction, so they will either close cleanly or
surface something that changes the order of everything after them.
