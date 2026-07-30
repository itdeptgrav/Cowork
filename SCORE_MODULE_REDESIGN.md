# Score module — redesign, and the plan for the rest

**Verify:** lint · tsc · **1046 tests, 0 failed** · production build · secrets clean.
**Scope this pass** (agreed): Overview and C1 to a finished standard. C2, C3, C4
and History keep working as they are; each has a written plan below.

---

## The audit, before any design

Every number on this module was traced to its source first, because two of the
requested features turned out to have no data behind them and one had better
data than the UI was using.

| Requested | Data reality |
|---|---|
| Overall score | ✅ engine's own figure |
| **Trend / change** | ⚠️ `ScoreOverview.delta` is **documented as always zero** — but the same response carries the annual strip, so a real trend is two reported figures subtracted |
| Per-task "why" | ✅ **richer than the UI used**: `deadlinesMissed`, `extensionsFiled`, `reworksReceived`, `c1Status`, `isRejected` arrive per task |
| C2 goals | ⚠️ totals plus a per-activity array |
| C3 conduct | ✅ SOP entries carry name, description, points, date, who applied them |
| **C4 detail** | ❌ **no path.** Attendance sits behind the HR token this repository does not hold (`index.ts:3420`) |
| **History reasons** | ❌ per-quarter scores are real; *why* a quarter moved is computed nowhere |

---

## What shipped

### Overview

- **A real trend replaces a fabricated one.** The header rendered
  `delta >= 0 ? "↑" : "↓"` against a field hardcoded to zero — so every score,
  for everybody, always showed **"↑0 since last quarter"**. That is a claim
  about a comparison nobody made. It now derives from the annual strip and is
  **absent entirely** in a first measured quarter, where an arrow would compare
  against a period that does not exist.
- **Channels say what they measure.** Each card carries a plain sentence —
  *"Moves when your tasks are approved. Missed deadlines, rework and rejections
  reduce it."* — with no channel codes or field names in the explanation.
- **Contributing and awaiting are separated**, and the awaiting ones are
  **named**: *"Nothing measured yet in C2, C3."* A channel silently missing is
  indistinguishable from one the reader forgot exists.
- **No confident zero.** An unscored channel reads "Not scored yet", never 0%.

### C1 Task Execution

- **"Scoring units" → "Tasks contributing to your score."**
- **Each task is now a card that explains itself**, built from the counters the
  engine already sends:

  ```
  Fabric catalogue numbering              +0.80 pts
  Completed cleanly
   · Completed before the deadline
   · Approved on the first submission
   · Finished without asking for more time
  ```

- **Good news first, deliberately.** A list that opens with a penalty reads as
  an accusation whatever follows it.
- **A rejected task stops the story** — it is out of the quality rate, so its
  counters describe work that no longer counts and listing them would imply
  otherwise.
- **The outcome is a fact, never a grade.** "Completed cleanly" is derived from
  the counters; "Excellent" would be a judgement the engine did not make, and
  that is the kind of claim that follows somebody into a review.
- **Empty state**: *"Tasks appear here once they are approved. Work in progress
  is not scored until it is reviewed."*

### C4

States its real percentage plus one line: attendance detail lives in the HR
system and is not available here. The gap is visible rather than a blank panel.

---

## Not shipped, and why

**History reasons.** `listScoreHistory` is wired and returns real per-quarter
scores, so *"Q2 91% → Q3 95%"* is buildable. *"Reason: 3 tasks completed
successfully"* is not — no per-period reason is recorded anywhere, and deriving
one by guessing which events fell in a window would put a fabricated cause on a
performance record.

**C4 detail.** Late arrivals and absences need the HR JWT. That is an auth
change, not a design one.

---

## Plan for the remaining surfaces

**C2 Goal Attainment.** The endpoint sends `ptsEarned`, `ptsPastDeadline`,
`hitRate` and a per-activity array. Apply the C1 treatment: one card per goal
activity, its own points, and a why-line from `ptsPastDeadline` — "completed on
time" against "completed after the target date". "Active vs completed goals"
needs a status the C2 response does not carry; check `listGoals` before
promising it.

**C3 Conduct & Policy.** The SOP ledger already carries everything a readable
timeline needs — `name`, `description`, `date`, `appliedByName`. Two cautions:
the vocabulary is inverted at the wire (legacy calls a violation a "credit", and
`positive` means **penalty**), and this is the one channel where tone matters
most. Lead with the description, never the point value.

**C4 Attendance.** Blocked until the HR token is available. When it is,
`fetchMonthly` returns `lateMinutes`, `earlyDepartureMinutes` and
`isExpectedWorkingDay` per day — enough for reliability without inventing a
trend.

**History.** Ship the real timeline — quarter, score, movement — and leave the
reason line out until something records one.

---

## Not verified

None of this has been seen rendering. I have no authenticated session, so this
is types, tests and contracts only. Specifically unverified: the trend against a
real annual strip, and the task cards against a real C1 response — the mapper is
pinned to the engine's shape by tests, but the shape came from reading
`pmpService.js`, not from a live payload.
