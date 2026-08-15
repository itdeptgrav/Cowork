# Task-logic test cases

Owner's manual test checklist, 14 Aug 2026. Report failures by code (e.g. "D4
failed", "S2 wrong"). ✔ = verified by scripted runs against the real database
this session; browser confirmation still worthwhile.

Known-open going in: I1/J1 expected to fail (submission-attachment `#` bug,
fix approved but not written); S7 pending an owner decision (gate time);
Brevo email leg blocked by IP allowlist.

## A — Creating tasks

- **A1** ✔ Manager → direct report with budget → no department gate.
- **A2** ✔ To another department (not your report) → pending department
  approval; their manager notified; assignee cannot see or act yet.
- **A3** Fixed-deadline task (no timer) → no negotiation; assignor's date stands.
- **A4** Cross-dept with no budget → after approval, receiving manager must set
  hours before the assignee gets it.
- **A5** Assign to yourself → goes to your manager for self-assign approval.
- **A6** ✔ Two quick creates for one person → distinct queue ranks.

## B — Gates

- **B1** ✔ Accept while gated → refused.
- **B2** Gate rejected → assignee never sees it; creator sees the reason.
- **B3** Wrong person approving → refused, message names who can.
- **B4** ✔ Approval → open, assignee attached, offer standing.

## C — Budget negotiation

- **C1** ✔ Accept offer → ACCEPTED, deadline written immediately.
- **C2** Counter → goes to the ASSIGNEE'S MANAGER, not the sender.
- **C3** Manager accepts counter → new figure, deadline re-derived, same anchor.
- **C4** Manager counters back → returns to assignee; no reject button exists.
- **C5** Accept your own proposal → refused ("not your turn").
- **C6** Budget figure identical on Details, Deadline tab, and timer target.

## D — Deadline

- **D1** ✔ Online before creation → clock from creation.
- **D2** Came online after creation → clock from first online, never acceptance.
- **D3** Accept while not Online → clock from the press.
- **D4** Cross-dept grant → clock from the grant (hours_granted).
- **D5** ✔ Anchor after close → next working morning + budget.
- **D6** Late accept → deadline already past → Overdue immediately, no clamp.
- **D7** Screen deadline == stored deadline everywhere.
- **D8** ✔ Timer activity moves the deadline nothing.
- **D9** Weekend/holiday in the walk → skipped.

## E — Priority & queue

- **E1** ✔ Distinct stored ranks; UI orders by creation.
- **E2** Manager reorder → reason required; assignee gets blocking receipt.
- **E3** Change own priority → refused (unless no manager).
- **E4** Finish P1 → next becomes P1; done task reads "Was P1".
- **E5** Awaiting-acceptance tasks numbered separately ("to accept").
- **E6** Raising one task pushes others' expected completion later, never earlier.

## F — Timer

- **F1** ✔ Start → run → pause: banked == wall clock.
- **F2** ✔ Reload mid-run → keeps counting (verify with real F5 too).
- **F3** ✔ Resume adds; first run never re-banked.
- **F4** Start task B while A runs → A auto-pauses (task switch); one timer only.
- **F5** Break/Offline with timer running → pauses at once; return ≠ auto-restart.
- **F6** ✔ Sleep/background past 2 min → credit capped at last beat +2 min; run
  restarts alive; display never exceeds creditable (no backwards jump).
- **F7** Assignee page, manager view, top-bar pill: one figure.
- **F8** Left running 16 h → "requires attention", banked time kept.
- **F9** Work outside office hours counts in full (calendar affects deadlines,
  never logged work).

## G — Expected completion

- **G1** Re-read minutes apart, nobody working → does not move.
- **G2** Past time allowed → stays, Overdue chip explains.
- **G3** P2 lands after P1's remaining work, through office hours.
- **G4** Logging time moves it earlier, never later.

## H — Extensions

- **H1** Hours request → assignee's manager; form shows current + added = total.
- **H2** Granted → assignee confirms before it binds; shift = exactly granted.
- **H3** Declined → nothing changes.
- **H4** Date change → assignor only; hours and date are separate records.
- **H5** Queue behind shifts; History shows old → reason → new.

## I — Submission & files

- **I1** Attachments upload and show on Submission, Review, Files. (EXPECTED
  FAIL until the `#` fix lands.)
- **I2** Outstanding requirements block submit if rules say block.
- **I3** Resubmit → new attempt, old superseded.
- **I4** Files tab: five origins grouped, private vs link labels correct.

## J — Review / rework / rejection

- **J1** Reviewer sees message AND documents (same caveat as I1).
- **J2** Self-review → hard refusal.
- **J3** Rework → failed requirements named; deadline re-granted (time left at
  submission); counter increments.
- **J4** Two-stage chain: stage-1 approval passes on, does not complete.
- **J5** Final approval → done; scoring weight = etcHours (agreed budget).
- **J6** Reject → reason recorded; resubmission possible.

## K — Meetings on a task

- **K1** Join asks "Start a meeting on this task?"; Cancel writes nothing.
- **K2** Solo open-and-close → not listed as a meeting.
- **K3** Two people → listed with names, distinct count (rejoin ≠ new person).
- **K4** Credited minutes shift the deadline by exactly that amount.

## L — Reports & chat

- **L1** Daily report posts; counter increments.
- **L2** Chat attachment visible to the other side; badge updates.
- **L3** System messages appear at the right moments.

## M — Special types

- **M1** Broken into subtasks → parent is a container: no rank, no timer, no
  accept card.
- **M2** Forward → recorded; budget follows the new assignee's manager.
- **M3** Repeat → next occurrence per config.
- **M4** Goal → roadmap steps with per-step dates; target date unscored.
- **M5** Third-party → updates and payment flow work.

## N — Negative / permissions

- **N1** Outsider sees no action buttons.
- **N2** Every refusal names who CAN act.
- **N3** Direct URL to a task you may not see → blocked.

---

# Deadline-shift scenarios (S-cases)

DEADLINE moves only by credits and extensions. EXPECTED COMPLETION recalculates
freely. Every legitimate shift must be exact to the minute AND leave a History
row (old date → reason → new date); a silent shift is a bug even when the
number is right.

## Clock start (create → accept)

- **S1** Online at creation, accepts later → deadline = creation + budget.
  NO shift for sitting on it.
- **S2** Offline at creation, online 2 h later, accepts → deadline = came-online
  + budget. SHIFT by the offline wait — correct.
- **S3** Accepts while still offline → deadline = acceptance + budget.
- **S4** Online → offline → new session → accept → clock = new session start
  (the provable one).
- **S5** Cross-dept grant 14:30 → deadline = 14:30 + hours, presence irrelevant.
- **S6** Assignee offline at grant → still grant + hours.
- **S7** ⚠ Gated 10:00→15:00 while assignee online → current code charges from
  10:00. OWNER DECISION PENDING (F1).
- **S8** Late accept, computed deadline past → Overdue immediately, no clamp.
- **S9** ✔ Anchor after close → next morning 09:30 + budget.
- **S10** Anchor before weekend/holiday → lands on next working day.
- **S11** Renegotiated budget → re-derived from the SAME anchor + new hours;
  negotiation minutes never charged.

## After the deadline exists — MUST shift (credited on return)

- **S12** Break → +break minutes (inside allowance), credited on return.
- **S13** Offline mid-day → +working minutes missed.
- **S14** Overnight/weekend offline → only in-office minutes credit (~nothing).
- **S15** Approved emergency → +span.
- **S16** Task meeting (credit rule satisfied) → +credited minutes exactly.
- **S17** Extension granted and confirmed → +granted hours through office hours.
- **S18** Rework → re-granted the time left at submission.

## After the deadline exists — must NOT shift

- **S19** ✔ Timer start/pause/left running.
- **S20** Online but idle.
- **S21** Reload / reopen / watching.
- **S22** Solo meeting room.
- **S23** Extension declined.
- **S24** Priority reorder (committed date fixed; only projection moves).
- **S25** Other people's activity.
- **S26** Office-policy change (projection recalcs; commitment stays).
- **S27** Submitting / entering review.
