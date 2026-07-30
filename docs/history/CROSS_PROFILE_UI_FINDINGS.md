# Cross-department flow — UI/backend mismatches

Found 2026-07-27 by walking the full cross-department lifecycle in Chrome across
three profiles, which became possible once the mock store persisted (see
`lib/config/mockPersistence.ts`).

**The flow itself passed.** Create → route → approve → set effort → release →
confirm → notify back all behaved correctly at the repository layer, and the
visibility gate held: a task pending approval is absent from the held-back
assignee's list and generates no notification for them until it clears. Nothing
below is a broken workflow. They are places where **what the screen says and
what the code does have come apart**, plus two defects in the seed fixture.

Nothing here is fixed. F1, F2 and F6 touch workflow behaviour, which this
session was told not to alter; F3–F5 are copy and presentation whose correct
wording depends on how F1 is resolved.

---

## F1 · "Both department heads approve" — the rule changed, the words did not

**Severity: high.** It is stated on five surfaces and in the help corpus, and it
is the single sentence a person reads to understand who is holding their work.

The cross-department chain used to route to `target_department_hod`. It was
changed to reporting managers — `lib/mock/seed.ts:418-426` defines the two
stages as "Sender's manager" (`reporting_manager`) and "Receiver's manager"
(`target_reporting_manager`), with a comment that says in as many words
*"Managers, not department heads."*

Observed: Maya (Product) → Hanne (Operations). Neither department head appears.
The one approver is **Priya Raman**, who is the reporting manager of both sides,
so the chain collapses to a single stage. Priya heads neither department.

Still saying otherwise:

| Where | Text |
|---|---|
| `components/tasks/relationshipCopy.ts:57` | "…and both department heads approve before the work reaches them." |
| `components/tasks/relationshipCopy.ts:59` | "…so the deadline is fixed and both department heads had to approve it." |
| `components/tasks/NewTaskForm.tsx:757` | "Both department heads approve before it reaches anyone." |
| `components/tasks/NewTaskForm.tsx:298` | "…the owning department decides whether the work needs two department heads to approve it" |
| `components/tasks/ApprovalTrail.tsx:64` | "Their department head is asked to accept it on their behalf." |
| `lib/repositories/mock/index.ts:1391` | Draft-chat system line: "Both department heads approved." |
| `lib/repositories/mock/index.ts:1203` | Refusal: "Only the head of the assignee's department can set the effort for this task." |
| `lib/repositories/mock/index.ts:1269` | Draft-chat: "…set the effort at 4h" attributed to "The department head" |

And in `lib/help/knowledge.ts`, at least five articles: lines 74, 99, 292, 320
and 386. Line 292 is the most detailed and therefore the most wrong — it
describes a two-stage head-to-head handshake ("your own department confirms it
is willing to make the request… only once that clears does it reach the
receiving head"), and tells the reader that a department with no head recorded
blocks creation. The chain now resolves through managers with a fallback.

This is precisely the failure `CLAUDE.md` says the coverage test cannot catch:
the vocabulary never changed, so nothing mechanical fired.

## F2 · A Deadline task is silently converted to a 4-hour budget

**Severity: high.** It discards a date the creator chose, and it contradicts a
decision recorded in `TASK_MODULE_FIX_PLAN.md`.

Maya created the task with a fixed due date of **1 Aug**. After Priya set the
effort estimate, the stored deadline was:

```
mode: "timer", originalWindowSecs: 14400, dueAt: null, officialDueAt: null,
state: "unset"
```

`lib/repositories/mock/index.ts:1216-1221` does this unconditionally, and the
stage that leads to it is raised *only* when `deadline.mode === "fixed"`
(`:1368`) — so the branch fires exactly on Deadline tasks and exactly on those
turns them into budget tasks. The creator's date is not preserved anywhere, and
the creator is not told it went.

What it contradicts:

- **C1, decided.** Budget vs deadline is derived from the hierarchy
  relationship. Maya→Hanne resolves to `cross_department` → Deadline. It ends up
  a timer.
- **The C2 verification table** in `TASK_MODULE_FIX_PLAN.md:101`, which records
  this exact assignment shape as Mode = **Deadline**.
- **The panel on the same screen.** Hanne sees "Accept 4h / Not enough time"
  directly above a panel reading "the deadline is fixed rather than negotiated."
- **`lib/help/knowledge.ts:292`** — "Neither the receiving head nor the assignee
  can change what was asked for or when it is due: the sending side owns those."
  The receiving side replaced the due date entirely.

Either the conversion is intended (in which case Deadline-mode copy, the C1
record and the help article are wrong) or it is not. It needs a decision, not a
patch.

## F3 · The creator is told a time they never proposed was accepted

`lib/repositories/mock/index.ts:1071-1078`. `acceptAssignorWindow` notifies
`t.createdById` with **"Your proposed time was accepted"**. On this flow the 4h
window was proposed by **Priya**, the approver; Maya proposed a fixed date and
had it replaced (F2). Maya's notification list ends up asserting she proposed
something she did not, and never mentions that her deadline was dropped.

## F4 · The Actionable badge ignores approvals

`components/tasks/TasksArea.tsx:95` — `count: reviews.data?.length ?? 0`, where
`reviews` is `listReviewQueue()`, which returns submission reviews only
(`lib/repositories/mock/index.ts:2943`).

Observed as Priya: the tab read **Actionable 1** while the panel below held two
items — one approval and one review. An approval waiting on you does not appear
in the count on the tab whose stated job is "what is waiting on me". This is the
same class as the fixed bug "Nobody was told their approval was needed."

## F5 · The due date shifts by the reader's UTC offset

`components/tasks/NewTaskForm.tsx:221` parses the `datetime-local` value with
`new Date(fixedDueAt)`, which JavaScript reads in the **browser's** zone.
`lib/format.ts:29` renders every timestamp in **UTC**, deliberately, to keep
server and client output identical.

Observed: typed **05:00 PM**, stored `2026-08-01T11:30:00.000Z` (correct for
IST), displayed **"1 Aug · 11:30"**. The creator sees their own deadline moved
by their offset — 5.5 hours here, and for anyone west of UTC it lands on the
previous day.

The two halves are each defensible; together they do not round-trip. Whichever
zone is chosen has to be used on both sides of the input.

## F6 · The seeded fixture `t-10` encodes two already-fixed defects

`t-10` "Quarterly goal rollover", status `pending_approval`, reason
`cross_department`:

- `pendingAssigneeIds: []` with an **assignment row for e-05 present**, so Hanne
  sees a task still awaiting approval on her own list. Fix #9 in
  `SESSION_HANDOFF.md` removed exactly this for newly created tasks.
- Stage 2's approver is **Hanne Vermeer — the assignee herself**. Fix #3
  replaced `target_department_hod` with `target_reporting_manager` specifically
  so a receiver is never in their own approval chain. The seed still has one.

The code is right and the fixture is stale, so the product demonstrates the old
behaviour to anyone who opens it. Confirmed against a task created live
(`t-1016`), which correctly carries `pendingAssigneeIds: ["e-05"]` and no
assignment row.

---

## What was verified clean

- Approval record written at creation, with `approval_requested` to the
  approver, at creation rather than on the next decision.
- The held-back assignee receives **no** notification and the task is **absent**
  from their list while pending — checked directly with a second task
  (`t-1016`) left unapproved.
- Assignment row and `task_assigned` are both created only at release.
- The approver retains visibility of a task they are not assigned and did not
  create.
- `ApprovalTrail` renders all four states correctly, including "— you" on the
  open stage and the receiver held at the end.
- `task_confirmed` reaches the sender.
- Priority reading `P2` for Hanne and `P—` for Maya is **correct**, not a
  mismatch: `myRank` is documented as the viewer's own rank and Maya is not an
  assignee.
