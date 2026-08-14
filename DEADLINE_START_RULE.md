# When a task's deadline starts counting

**Agreed with the owner, 14 Aug 2026.** This is the specification; it is not
implemented yet. Written down because it was settled across a long conversation
and the reasoning is worth more than the conclusion.

## The principle

**Whoever causes the delay bears it.**

A deadline is `start + budget`, laid through office hours. The only question this
document answers is what `start` is — and it depends on who was holding things
up between the task being created and the work being able to begin.

| Case | Who is waiting on whom | Clock starts |
|---|---|---|
| **Cross-department** | The assignee can do nothing — their manager has not set the hours yet | When the hours are **granted** |
| **Normal task** | The assignee already has the task and the proposed hours | When the assignee **first comes online** after it was given |

### Why they differ

On a cross-department task the assignee is genuinely blocked: no hours exist, so
there is nothing to start. Charging that wait to them would shorten the time they
were given by however long their manager took. That half is already implemented —
`acceptBudgetProposal` anchors at `tlHoursSetAtMs`.

On a normal task nothing blocks them. The task and its proposed hours are both
there. Counting from *acceptance* therefore rewards delay: the longer somebody
sits on a task before accepting, the later their deadline. T019 is the worked
example — given 10:41:54, accepted 12:01:42, and the 1h 20m of sitting was handed
back as 1h 20m of extra deadline.

### Why "first comes online" and not "when given"

Of T019's 1h 20m, the first 15 minutes were before Umung was even online (task
10:41:54, online 10:56:20). He could not have accepted in that window, so it is
not his delay to bear. The remaining 1h 05m was his.

Counting from first-online is also consistent with how the rest of the product
already reasons: office hours, breaks, holidays and offline spans are excluded
from deadline arithmetic everywhere else. Charging somebody for minutes they were
logged out is the same error as charging them for a lunch break.

**T019 under this rule:** online 10:56:20 + 2h = **deadline 12:56:20**.

## One number, stored and shown

**The stored deadline and the displayed figure must be the same value.** Storing
one and showing another is what produced four separate rounds of "why does the
database say 14:01 and the page say 12:41".

Today the page shows *Expected completion* — a live projection, never stored —
as a date, and hides the real deadline inside the sentence beneath it
(`TaskDetail.tsx:1083` deliberately suppresses it). The two are computed from
different start points, so they disagree, and the difference surfaces as a
"✓ Finishes 01:19:48 before the requested deadline" that is not slack at all: it
is exactly the acceptance delay, reappearing as a reward.

Once both use the start point above, they agree, and the phantom slack vanishes
on its own.

## Scope of the problem today

Measured across all 11 tasks on 14 Aug 2026: **10 carry phantom slack, 25 hours
in total, average 2h 30m each.** Worst is T014 at 16h 39m — created 17:50, hours
agreed 10:29 the next morning, so its projection assumes a night's work.

## Somebody who never comes online — already handled, nothing to add

Until the assignee accepts the hours the negotiation sits in
`WAITING_FOR_ASSIGNEE` and the task reads *"Waiting for {name} to accept"*
(`lib/rules/tasks/budgetNegotiation.ts:170`). No deadline exists yet, and the
task is visibly parked against that person rather than quietly carrying none.

So a task given on Friday to somebody off until Wednesday needs no special case:
it is not charged to them, and it does not disappear. The start point simply does
not exist yet, which is the truthful state.

## What implementing this touches

1. **The stored deadline** — the accept path already anchors correctly for
   cross-department. It needs the normal-task branch: first-online-after-given
   rather than acceptance.
2. **The projection** — `#chainQueue`'s anchor must use the same start, so the
   two figures cannot disagree.
3. **The display** — show the deadline as a date rather than only as a gap.
4. **Backfill** — tasks whose hours were agreed before this lands hold the wrong
   start, and some (T017) hold no deadline at all.

## A deadline in the past is a real answer

**Decided by the owner: no floor.** If somebody comes online, leaves the task
sitting, and the budget is short, the deadline lands in the past and the task
reads **Overdue** immediately.

That is the rule working, not failing. They were online and able to start; the
time was theirs to use and they did not use it. Moving the deadline forward to
avoid an uncomfortable figure would be the same mistake as counting from
acceptance — it would quietly return the delay to whoever caused it.

Umung, had he accepted at 13:00 instead of 12:01: online 10:56 + 2h = 12:56,
already gone, task Overdue on arrival. Correct.

**Consequence for implementation:** never clamp the computed deadline to `now`,
and never substitute the current time when the result is in the past. The same
mistake was already made once on the projection side — `#chainQueue` used to
floor its answer at `now`, which made the figure track the wall clock — and it
was removed for exactly this reason.
