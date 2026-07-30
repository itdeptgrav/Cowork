# Task Module — Receiver-Side UI Parity

What the person receiving a task actually sees, in each of the four cases.
Compared against `cowork-old-frontend`.

**Report only. No code changed.**

**Method caveat:** the Chrome extension has been unavailable for several turns,
so this is a **code read, not a visual inspection**. Every claim below is traced
to a specific component and condition; none is from a screenshot.

---

## The headline defect: the list contradicts the detail

`nextAction` (`statusMeta.ts:205`) has this branch **before** it ever looks at an
offered window:

```ts
if (task.deadline.state === "unset")
  return mine ? { label: "Propose a deadline", … } : …
```

A manager→report task sits at `status: "assigned"`, `deadline.state: "unset"`,
`currentWindowSecs: 14400`. So Maya's task row, board card, dashboard card and
"Your move" header all say **"Propose a deadline"** — while the Deadline tab
shows the card offering *"Accept 4h / Not enough time"*.

**Legacy did the opposite.** Its receiver-side card is headed **"Time Set by
Manager"** and its condition (`page.js:8818`) tests `senderSecs > 0 &&
!senderTimerRejected` *first*; "Propose your own duration" only appears when
there is no offer or the offer was refused.

So current tells the receiver to do the second thing before offering the first.
`nextAction` needs the same precedence the panel already has.

---

## Case 1 · Priya → Maya (manager → direct report)

| | LEGACY | CURRENT |
|---|---|---|
| **Screen / list** | Tasks list, "Mine" | Tasks list, "Mine" ✅ |
| **Badge** | "Not Started" (`STATUS.open`, amber) | "Assigned" ✅ equivalent |
| **Primary CTA** | "Time Set by Manager" card → modal with Accept / Propose / Reject | **"Propose a deadline"** ❌ wrong action |
| **Where the real action lives** | task detail body, prominent | **Deadline tab**, one click away ❌ |
| **Negotiation visible** | Draft Chat tab, always shown, badged **ACTIVE** | Chat tab → "Negotiation — agreeing the terms" ✅ but the tab is not badged and not surfaced from Overview ⚠️ |
| **Confirmation obvious** | Modal says *"You can now Confirm & Start"* after accepting | "Confirm receipt" appears once `state === "agreed"` ✅ |

**Verdict: mismatched at the point of first contact.** The state machine is
right; the receiver is pointed at the wrong door.

---

## Case 2 · Maya → Priya (employee → manager, upward)

| | LEGACY | CURRENT |
|---|---|---|
| **Screen / list** | Her own Tasks list | Tasks list **and** Approvals view ✅ better |
| **Badge** | "Pending TL Approval" (purple) | "Pending approval" ✅ |
| **Primary CTA** | Approve, in the task row | "Approve or reject" → `ApprovalTrail` with Approve/Reject ✅ |
| **Why it needs approving** | not explained | `ApprovalTrail` headline *"You assigned this to someone senior to you"* + expandable "Why is approval needed?" ✅ **better than legacy** |
| **Negotiation** | draft chat reachable but no window action until `open` | same — `windowOnOffer` requires `status === "assigned"` ✅ |
| **After approval** | → `open`, then case 1 | → `assigned`, then case 1 ✅ |

**Verdict: matching, and clearer than legacy** on the "why".

---

## Case 3 · Peer → peer (Tobias → Jonas)

| | LEGACY | CURRENT |
|---|---|---|
| **Screen / list** | Tasks list, immediately | Tasks list, immediately ✅ |
| **Badge** | "Not Started" | "Assigned" ✅ |
| **Primary CTA** | "Time Set by Manager" card, same as case 1 | **"Propose a deadline"**, and **no window card at all** ❌ |
| **Negotiation** | full accept/propose/reject | **propose only** |

**Why current differs:** C1. A peer is outside the reporting line, so the mode
resolves to `fixed` and no window is ever offered — `windowOnOffer` requires
`d.mode === "timer"`. Jonas receives a date he cannot negotiate.

This is the accepted C1 divergence showing up in the UI. It is the case where it
bites hardest, and the card header *"Time Set by Manager"* is wrong for peers in
legacy too — but legacy at least let them negotiate.

**Verdict: divergent by decision, not defect.** Recorded so the consequence is
visible rather than discovered.

---

## Case 4 · Cross department (Tobias → Idris)

| | LEGACY | CURRENT |
|---|---|---|
| **Receiver's screen** | **nothing** — not in `assigneeIds` | **nothing** — no assignment row ✅ verified |
| **Approvers' screen** | dedicated "Cross-Department Approval Needed" list | Approvals view, one list for all reasons ✅ |
| **Approver badge** | "Pending Dept. Approval" (amber) | "Pending approval" + `ApprovalTrail` ✅ |
| **Chain visible to approver** | flat list of `departmentApprovals` entries | ordered rail: creator → each approver → assignee, current step marked, "Stage 1 of 2" ✅ **better than legacy** |
| **After both approve** | appears with "Not Started" | appears, then case 1 ✅ |
| **Effort-estimate stage** | separate "Pending TL Hours" list, filtered by the viewer's department | `EffortEstimateForm` replaces Approve/Reject in the trail ✅ |

**Verdict: matching, with a materially better approver experience.**

---

## Summary

### Matching or better
1. Where the task appears, in all four cases
2. Cross-department invisibility until release — verified
3. Approval chain rendering — ordered rail with stage, beats legacy's flat list
4. "Why is approval needed?" — legacy explained nothing
5. Effort-estimate stage with its own control
6. Confirm → Start sequencing and gating

### Defects
| # | Issue | Cases | Severity |
|---|---|---|---|
| **U1** | `nextAction` says "Propose a deadline" when a window is on offer | 1 | **High.** Every list surface points at the wrong action; contradicts the detail panel |
| **U2** | The window card lives on the Deadline tab, not Overview | 1 | **Medium.** Legacy put it in the task body; the receiver's first action is one click from where they land |
| **U3** | Negotiation thread has no unread/active badge | 1, 2, 3 | **Low.** Legacy badged it **ACTIVE** and showed a message count |

### Accepted divergence
| # | Issue | Cases |
|---|---|---|
| **U4** | Peers get a fixed date, no window, no negotiation | 3 |

Consequence of C1, decided and permanent. Listed so it is not rediscovered as a
bug.

### Suggested order
1. **U1** — the fix is precedence: check for an offered window before the
   `state === "unset"` branch, and return an accept-flavoured action. One
   function, and it corrects every list at once.
2. **U2** — surface the window card on Overview, where legacy had it.
3. **U3** — badge the negotiation tab.

U1 and U2 are the same complaint from two directions: the receiver's first
action is neither named correctly nor placed where they land.
