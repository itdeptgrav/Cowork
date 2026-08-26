import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import {
  acceptanceRefusal,
  budgetAcceptAlsoConfirms,
  getAssignmentActions,
  pendingAccepters,
  refuseTermsRefusal,
  NOT_YOURS_TO_ACCEPT,
  UNASSIGNED_ACCEPTANCE_NOTICE,
  type AssignmentActionType,
} from "./assignmentAcceptance.ts";
import type { TaskStatus } from "../../domain/tasks.ts";
import type { TaskView } from "../../repositories/types.ts";

/**
 * Accepting an assignment.
 *
 * The reported dead end: T651 said **"Waiting for Umung Arora — you"** and
 * **"The assignee has not accepted it yet."** with no control for Umung.
 *
 * Two defects in opposite directions, and both are pinned here — the control was
 * hidden from the one person who owed the action, AND offered to people the
 * engine would refuse.
 */

/**
 * Source with comments stripped.
 *
 * The codebase's convention, and load-bearing for the bans below: a doc comment
 * explaining WHY there is no "Decline task" button contains that phrase, and a
 * raw-text search would read the explanation as the defect.
 */
const code = (p: string) =>
  readFileSync(p, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "");

const UMUNG = "GR0002"; // assignee
const RISHEE = "GR0000"; // task creator
const STRANGER = "GR0114";

/** A task waiting to be accepted, in the shape the resolver reads. */
function view(over: {
  status?: TaskStatus;
  confirmedAt?: string | null;
  mode?: "timer" | "fixed";
  windowSecs?: number | null;
  assignees?: string[];
  pending?: string[];
  rejection?: unknown;
  budgetState?: string;
} = {}): TaskView {
  const assignees = over.assignees ?? [UMUNG];
  return {
    budgetNegotiation: over.budgetState
      ? { state: over.budgetState, waitingForId: null, currentSecs: 6 * 3600 }
      : null,
    task: {
      id: "T651",
      reference: "T651",
      title: "Token naming review",
      status: over.status ?? "assigned",
      estimatedEffortSecs: 6 * 3600,
      deadline: {
        mode: over.mode ?? "timer",
        state: "unset",
        dueAt: null,
        operationalDueAt: "2026-07-31T05:00:00.000Z",
        currentWindowSecs:
          over.windowSecs === undefined ? 6 * 3600 : over.windowSecs,
        assignorWindowRejection: over.rejection ?? null,
      },
    },
    assignments: assignees.map((employeeId) => ({
      employeeId,
      confirmedAt: over.confirmedAt ?? null,
    })),
    assignees: assignees.map((id) => ({ id, displayName: "Umung Arora" })),
    pendingAssignees: (over.pending ?? []).map((id) => ({
      id,
      displayName: "Umung Arora",
    })),
    owner: { id: RISHEE, displayName: "Rishee Ray" },
  } as unknown as TaskView;
}

/* ── 1 · The assignee sees Accept ─────────────────────────────────────────── */

test("1 · the assignee has a real action on an assigned task", () => {
  const actions = getAssignmentActions(UMUNG, view());
  assert.equal(actions.actionType, "accept_assignment");
  assert.equal(actions.canAccept, true);
  assert.equal(actions.nextActor, UMUNG);
  assert.equal(acceptanceRefusal({ viewerId: UMUNG, view: view() }), null);
});

test("1b · and on a task with NO agreed deadline, which is the reported case", () => {
  /* T651 is a budget task: `deadline.state` is `unset` because the window is
     still being agreed. The old inline condition required
     `deadline.state === "agreed"`, so the control vanished — while the engine's
     `confirmTaskReceipt` skips the deadline requirement entirely for a task
     carrying a time budget. Being stricter than the engine is what produced a
     "Your move" with no move. */
  const t = view();
  assert.equal(t.task.deadline.state, "unset");
  assert.equal(t.task.deadline.dueAt, null);
  assert.equal(
    getAssignmentActions(UMUNG, t).canAccept,
    true,
    "acceptance is hidden on exactly the task shape that was reported",
  );
});

test("1c · a pending cross-department assignee can accept too", () => {
  /* They hold the work and have no assignment row yet. The engine's own routes
     resolve `pendingAssigneeId || assigneeIds[0]`; reading the rows alone is the
     omission that has produced this class of bug four times. */
  const t = view({ assignees: [], pending: [UMUNG] });
  assert.deepEqual(pendingAccepters(t), [UMUNG]);
  assert.equal(getAssignmentActions(UMUNG, t).canAccept, true);
});

/* ── 1d · A budget still waiting on the OTHER side blocks acceptance ───────── */

test("1d · self task: assignee canNOT accept while the budget waits on the manager", () => {
  /* The self-task bug. Umung proposes the budget; it waits on his manager
     (`WAITING_FOR_ASSIGNOR`). Offering him "Accept task" let him take the work
     on at a figure his manager never approved — the exact bypass the flow
     exists to prevent. */
  const t = view({ budgetState: "WAITING_FOR_ASSIGNOR" });
  const actions = getAssignmentActions(UMUNG, t);
  assert.equal(actions.actionType, "none");
  assert.equal(actions.canAccept, false);
});

test("1e · once the manager settles it, the assignee can accept", () => {
  const t = view({ budgetState: "ACCEPTED" });
  assert.equal(getAssignmentActions(UMUNG, t).canAccept, true);
});

test("1f · an unsettled budget gates acceptance in BOTH directions", () => {
  /* **This assertion changed deliberately.** It previously required
     `WAITING_FOR_ASSIGNEE` to stay offered, on the reasoning that the
     assignor's opening figure is the standard "accept the terms" moment.

     On screen that put two cards in front of the assignee at once — "Accept
     task" directly above "Accept 00:10:00" — asking the same question twice
     with nothing to say that either leads to the same place. The budget card
     wins: it names the figure being agreed to, and its own copy already states
     that accepting settles the budget and moves the task forward.

     So while a budget is unsettled either way, the budget card owns the
     decision and this one shows the state without a duplicate control. */
  for (const state of ["WAITING_FOR_ASSIGNEE", "WAITING_FOR_ASSIGNOR"] as const) {
    const t = view({ budgetState: state });
    const actions = getAssignmentActions(UMUNG, t);
    assert.equal(actions.canAccept, false, `${state} still offers accept`);
    assert.equal(actions.canRefuseTerms, false, `${state} still offers terms`);
  }
});

test("1g · a task with no budget in play still offers acceptance", () => {
  /* The gate must not swallow the ordinary case: a fixed-deadline task has no
     budget card, so this card is the only place acceptance can happen. */
  for (const state of ["AGREED", "NONE"] as const) {
    const t = view({ budgetState: state });
    assert.equal(
      getAssignmentActions(UMUNG, t).canAccept,
      true,
      `${state} lost its accept`,
    );
  }
});

/* ── 2 · The creator does not ─────────────────────────────────────────────── */

test("2 · the creator sees no acceptance controls", () => {
  const actions = getAssignmentActions(RISHEE, view());
  assert.equal(actions.actionType, "await_assignee");
  assert.equal(actions.canAccept, false);
  assert.equal(actions.canRefuseTerms, false);
  /* But they ARE told whose move it is — a wait with a named owner is a real
     answer, unlike a wait with none. */
  assert.equal(actions.nextActor, UMUNG);
  assert.equal(
    acceptanceRefusal({ viewerId: RISHEE, view: view() }),
    NOT_YOURS_TO_ACCEPT,
  );
});

test("2b · the inline condition that offered it to everybody is gone", () => {
  /* It had NO viewer check: `status === "assigned" && deadline.state === "agreed"`
     rendered "Confirm receipt" for whoever was looking, including the creator, on
     a write `confirmTaskReceipt` 403s. */
  const src = code("components/features/tasks/TaskDetail.tsx");
  assert.equal(
    /v\.task\.status === "assigned" &&\s*\n\s*v\.task\.deadline\.state === "agreed"/.test(
      src,
    ),
    false,
    "the unguarded inline confirmation condition is back",
  );
  assert.equal(
    src.includes("Confirming…"),
    false,
    "TaskDetail still owns the confirmation button",
  );
  /* And the card is mounted instead. */
  assert.match(src, /<AssignmentConfirmationCard/);
});

/* ── 3/4 · The transitions ────────────────────────────────────────────────── */

test("3 · accepting is the engine's confirm, and nothing else", () => {
  const card = readFileSync(
    "components/features/tasks/AssignmentConfirmationCard.tsx",
    "utf8",
  );
  assert.match(card, /r\.confirmTask\(view\.task\.id\)/);
  /* No client-side status write. `confirmTaskReceipt` sets `status: "confirmed"`
     and appends to `confirmedBy`; writing either here would be a second answer. */
  assert.equal(/status\s*=\s*"confirmed"/.test(card), false);
});

test("4 · refusing the terms is named for what it does", () => {
  /* **There is no decline transition.** `assignment_rejected` maps from legacy's
     `"rejected"`, which is a cross-department APPROVER refusing a gate — not the
     assignee refusing the work. What the engine offers is `reject-sender-timer`:
     refuse the TERMS, with a required reason, which reopens the negotiation and
     leaves the task where it is.

     A button labelled "Decline task" over that write would promise an outcome
     nobody gets, so it is labelled for the write. */
  const card = code("components/features/tasks/AssignmentConfirmationCard.tsx");
  assert.match(card, /r\.rejectAssignorWindow\(view\.task\.id, reason\)/);
  assert.match(card, /Ask for different terms/);
  assert.equal(
    /Decline task/.test(card),
    false,
    "a Decline label promises a transition the engine does not have",
  );
  /* The reason is required, as the route requires it. */
  assert.match(card, /disabled=\{busy \|\| !reason\.trim\(\)\}/);
});

test("4b · the terms cannot be refused where there is nothing to refuse", () => {
  /* The route requires a `senderTimerWindowSecs` and 400s otherwise, so offering
     it on a fixed-date task would be a control that cannot land. */
  for (const t of [
    view({ mode: "fixed" }),
    view({ windowSecs: 0 }),
    view({ rejection: { byName: "Umung", reason: "too short" } }),
  ]) {
    const actions = getAssignmentActions(UMUNG, t);
    assert.equal(actions.canAccept, true, "accepting is still offered");
    assert.equal(actions.canRefuseTerms, false);
    assert.match(
      refuseTermsRefusal({ viewerId: UMUNG, view: t }) ?? "",
      /no proposed working time/,
    );
  }
});

/* ── 5 · The flow moves on ────────────────────────────────────────────────── */

test("5 · once accepted there is nothing outstanding", () => {
  /* Per ASSIGNMENT, not per task: on work given to three people, one accepting
     does not speak for the other two. */
  const accepted = view({ confirmedAt: "2026-07-30T05:00:00.000Z" });
  assert.deepEqual(pendingAccepters(accepted), []);
  assert.equal(getAssignmentActions(UMUNG, accepted).actionType, "none");

  const partly = {
    ...view({ assignees: [UMUNG, "GR0003"] }),
  } as TaskView;
  partly.assignments = [
    { employeeId: UMUNG, confirmedAt: "2026-07-30T05:00:00.000Z" },
    { employeeId: "GR0003", confirmedAt: null },
  ] as never;
  assert.deepEqual(
    pendingAccepters(partly),
    ["GR0003"],
    "one person accepting must not clear the wait for the others",
  );
  assert.equal(getAssignmentActions(UMUNG, partly).canAccept, false);
  assert.equal(getAssignmentActions("GR0003", partly).canAccept, true);
});

test("5b · no other status claims an acceptance step", () => {
  const statuses: TaskStatus[] = [
    "draft",
    "pending_approval",
    "deadline_negotiation",
    "confirmed",
    "in_progress",
    "in_review",
    "completed",
    "cancelled",
    "assignment_rejected",
  ];
  for (const status of statuses) {
    assert.equal(
      getAssignmentActions(UMUNG, view({ status })).actionType,
      "none",
      `${status} claims an acceptance turn it does not have`,
    );
  }
  /* `assigned` is the whole of it. */
  assert.equal(
    getAssignmentActions(UMUNG, view({ status: "assigned" })).actionType,
    "accept_assignment",
  );
});

/* ── 6 · Nobody accepts for anybody else ──────────────────────────────────── */

test("6 · no user can accept another person's assignment", () => {
  for (const who of [RISHEE, STRANGER, null]) {
    const actions = getAssignmentActions(who, view());
    assert.equal(actions.canAccept, false, `${who} could accept`);
    assert.ok(
      acceptanceRefusal({ viewerId: who, view: view() }),
      `${who} was not refused`,
    );
  }
  /* Including a manager who is not the assignee. Managing somebody is reach over
     their work, not consent on their behalf — accepting for them would record
     their agreement to a deadline they never saw. */
  const manager = getAssignmentActions("GR0045", view());
  assert.equal(manager.canAccept, false);
  assert.equal(manager.actionType, "await_assignee");
});

/* ── 7 · The screen and the write ask one question ────────────────────────── */

test("7 · backend and frontend action ownership match", () => {
  const card = readFileSync(
    "components/features/tasks/AssignmentConfirmationCard.tsx",
    "utf8",
  );
  assert.match(
    card,
    /getAssignmentActions\(viewerId, view\)/,
    "the card decides for itself instead of asking the resolver",
  );

  for (const [path, marker] of [
    ["lib/repositories/legacy/index.ts", /acceptanceRefusal\(\{/],
    ["lib/repositories/mock/index.ts", /NOT_YOURS_TO_ACCEPT/],
  ] as const) {
    const src = readFileSync(path, "utf8");
    const at = src.indexOf("async confirmTask(");
    assert.ok(at > 0, `${path} has no confirmTask`);
    assert.match(
      src.slice(at, at + 1600),
      marker,
      `${path} does not authorise through the shared resolver`,
    );
  }
});

test("7b · neither side re-checks the deadline the engine judges", () => {
  /* The precondition that hid the control. `confirmTaskReceipt` skips it for a
     task with a time budget, so duplicating it client-side made the screen
     stricter than the server — and where they differ, the assignee gets a prompt
     with nothing behind it. */
  const mock = code("lib/repositories/mock/index.ts");
  const at = mock.indexOf("async confirmTask(");
  const body = mock.slice(at, at + 1600);
  assert.equal(
    /deadline\.state !== "agreed"\)\s*\n?\s*return fail\("invalid_state", "Agree a deadline/.test(
      body,
    ),
    false,
    "the mock still refuses a budget task the engine would accept",
  );
  /* It still refuses a task with NEITHER a budget nor a date — there is genuinely
     nothing to agree to. */
  assert.match(body, /neither a time budget nor a deadline/);
});

/* ── The sweep · no "your move" without a move ────────────────────────────── */

test("every action type has a surface, and an unowned one is a fault", () => {
  const declared: AssignmentActionType[] = [
    "accept_assignment",
    "await_assignee",
    "unowned",
    "none",
  ];
  const card = readFileSync(
    "components/features/tasks/AssignmentConfirmationCard.tsx",
    "utf8",
  );
  const surfaces: Record<AssignmentActionType, RegExp | null> = {
    accept_assignment: /Accept task/,
    await_assignee: /Waiting for \{nameOf\(actions\.nextActor\)/,
    unowned: /UNASSIGNED_ACCEPTANCE_NOTICE/,
    none: null,
  };
  for (const kind of declared) {
    const present = surfaces[kind];
    if (!present) continue;
    assert.match(card, present, `nothing renders the "${kind}" state`);
  }

  /* And the notice names the cause and the fix rather than asking somebody to
     keep waiting for a task that cannot move. */
  assert.match(UNASSIGNED_ACCEPTANCE_NOTICE, /fault rather than a delay/);
  assert.match(UNASSIGNED_ACCEPTANCE_NOTICE, /assign somebody/);
});

test("no state reports actor 'you' without somewhere to act", () => {
  /* **The general guarantee**, not just for acceptance. `nextAction` is what the
     action card's eyebrow reads, and every `actor: "you"` branch must carry an
     `href` — because the card's fallback link renders on that and nothing else.
     A branch returning `you` with no href is a "Your move" with no move.

     Asserted on the source because `nextAction` needs a full view plus a duty
     mode, and the invariant is about the SHAPE of every return rather than about
     any one path through it. */
  const src = code("components/features/tasks/statusMeta.ts");
  const fn = src.slice(src.indexOf("export function nextAction("));
  const youBranches = [...fn.matchAll(/actor:\s*"you"/g)];
  assert.ok(youBranches.length >= 8, `expected the branches, found ${youBranches.length}`);

  for (const match of youBranches) {
    /* The href sits within a few lines of its actor, inside the same object
       literal. Bounded rather than searched globally, so a distant href cannot
       vouch for a branch that has none. */
    const window = fn.slice(match.index, match.index + 200);
    assert.match(
      window,
      /href:/,
      `an actor: "you" branch carries no href — that renders "Your move" with no control:\n${window.slice(0, 160)}`,
    );
  }
});

test("the fallback link is suppressed only where a specific control is certain", () => {
  /* The mechanism behind the reported bug. The generic link carried
     `status !== "assigned" && status !== "confirmed"`, while the `assigned`
     control had a second condition that could fail — so both were false at once.

     `confirmed` may stay excluded because its own button is gated on nothing but
     the status; `assigned` may not, and no longer is. */
  const src = code("components/features/tasks/TaskDetail.tsx");
  assert.equal(
    /action\.href &&[\s\S]{0,120}?v\.task\.status !== "assigned"/.test(src),
    false,
    "the fallback link excludes `assigned` again, which is what left it dead",
  );
  assert.match(src, /action\.href && !mineApproval && v\.task\.status !== "confirmed"/);
  /* And `confirmed`'s own button really is unconditional on the status. */
  assert.match(src, /\{v\.task\.status === "confirmed" && \(/);
});

test("no surface renders \"Waiting for X — you\"", () => {
  /* The exact sentence from the report. A person reading their own name after
     "Waiting for" is being told they ARE the delay — and it sat above a card that
     offered nothing. The `— you` suffix `nameOf` adds is what made it
     unmistakable, so the eyebrow now branches before it can be composed. */
  const src = code("components/features/tasks/TaskFlowSection.tsx");
  const at = src.indexOf("acceptanceIsViewers");
  assert.ok(at > 0, "the flow no longer knows whether the turn is the reader's");
  assert.match(src, /acceptanceIsViewers\s*\n?\s*\?\s*"Your move — accept this task"/);
  /* And the third-person branch is reached only when it is somebody else. */
  const eyebrow = src.slice(src.indexOf('"Your move — accept this task"'));
  assert.ok(
    eyebrow.indexOf("Waiting for ${flow.whoseTurn}") >
      eyebrow.indexOf('"Your move'),
    "the generic wait is still reachable before the reader's own branch",
  );
});

test("the acceptance sentence addresses whoever owes it", () => {
  /* "The assignee has not accepted it yet" is a third-person report, and reading
     it about yourself describes the delay instead of naming the move. */
  const flow = code("lib/rules/tasks/taskFlow.ts");
  assert.match(flow, /acceptanceIsViewers\s*\n?\s*\?\s*"You have not accepted it yet/);
  assert.match(flow, /: "The assignee has not accepted it yet\."/);
  /* Pointing at where the action is, not just stating the fact. */
  assert.match(flow, /accept it above to start work/);
});

/* ── Accepting a budget also accepts the assignment ───────────────────────── */

test("the assignee accepting a budget takes on the work in the same press", () => {
  /* The two-click complaint. Settling the budget and taking the work on are
     separate engine writes — `acceptBudgetProposal` touches neither `status`
     nor `confirmedBy` — so pressing "Accept 02:00:00" put "Accept task" on
     screen immediately after, asking what reads as the same question. */
  assert.equal(budgetAcceptAlsoConfirms(UMUNG, view()), true);
});

test("an assignor settling a budget accepts nothing on the assignee's behalf", () => {
  /* A counter hands the turn back to the assignor, so they are the one pressing
     Accept. Confirming there would take on work for somebody else. */
  assert.equal(budgetAcceptAlsoConfirms(RISHEE, view()), false);
});

test("a manager settling a self-task's budget accepts nothing either", () => {
  /* The self-assigned case: the assignee proposes, and their MANAGER settles
     it. The manager is not in `pendingAccepters`, so nothing is confirmed. */
  assert.equal(budgetAcceptAlsoConfirms(STRANGER, view()), false);
});

test("one of several assignees accepting speaks only for themselves", () => {
  /* `pendingAccepters` reads per assignment for exactly this reason. */
  const shared = view({ assignees: [UMUNG, STRANGER] });
  assert.equal(budgetAcceptAlsoConfirms(UMUNG, shared), true);
  assert.equal(budgetAcceptAlsoConfirms(STRANGER, shared), true);
  assert.equal(budgetAcceptAlsoConfirms(RISHEE, shared), false);
});

test("nothing is confirmed once acceptance is no longer the outstanding step", () => {
  /* A budget renegotiated after the work started must not re-confirm a task
     that is already confirmed, in progress or done. */
  for (const status of ["confirmed", "in_progress", "in_review", "completed"] as const)
    assert.equal(
      budgetAcceptAlsoConfirms(UMUNG, view({ status })),
      false,
      status,
    );
});

test("an assignee who has already accepted is not confirmed twice", () => {
  assert.equal(
    budgetAcceptAlsoConfirms(UMUNG, view({ confirmedAt: "2026-08-22T10:00:00Z" })),
    false,
  );
});

test("a signed-out viewer confirms nothing", () => {
  assert.equal(budgetAcceptAlsoConfirms(null, view()), false);
});

test("somebody still behind a cross-department gate is included", () => {
  /* They hold the work and have no assignment row yet — `pendingAccepters`
     covers them, and this must follow it rather than reading assignees alone. */
  const gated = view({ assignees: [], pending: [STRANGER] });
  assert.equal(budgetAcceptAlsoConfirms(STRANGER, gated), true);
});

test("the chain is wired into the budget card, and guarded", () => {
  /* An unconditional `confirmTask()` after every budget accept would take work
     on for other people. The predicate is what makes it safe, so its presence
     is asserted rather than assumed. */
  const card = code("components/features/tasks/BudgetNegotiationCard.tsx");
  assert.match(card, /budgetAcceptAlsoConfirms\(viewerId, view\)/);
  assert.match(card, /if \(alsoConfirm\) await confirmTask\(\)/);
  /* Read BEFORE the write: afterwards the view has moved on. */
  assert.ok(
    card.indexOf("budgetAcceptAlsoConfirms") < card.indexOf("await accept()"),
    "the predicate is read after the budget write, when the state has changed",
  );
});

test("the assignment card is held shut across the gap between the two writes", () => {
  /* **The flash.** `acceptBudget` calls `notifyRepositoryChanged()` the moment
     the budget write lands, so the view refetches BETWEEN the two writes. For
     the second or two the confirm is in flight the task reads "budget agreed,
     not yet accepted" — exactly what the assignment card exists to answer — so
     it appeared, offered "Accept task", and removed itself again.

     The flag closing that gap has to be raised BEFORE the first write and
     lowered AFTER the refetch, or it misses the frame it exists for. */
  const card = code("components/features/tasks/BudgetNegotiationCard.tsx");
  const raise = card.indexOf("onFinishingAcceptance?.(true)");
  const write = card.indexOf("await accept()");
  const change = card.indexOf("onChange();");
  const lower = card.lastIndexOf("onFinishingAcceptance?.(false)");

  assert.ok(raise > 0, "nothing tells the caller a chained confirm has started");
  assert.ok(raise < write, "the flag is raised after the write that reveals the card");
  assert.ok(change < lower, "the flag is lowered before the view has caught up");

  /* And a failed budget write must not leave it raised for ever. */
  assert.match(card, /if \(!r\.ok\) \{[\s\S]{0,120}onFinishingAcceptance\?\.\(false\)/);

  /* The caller actually suppresses the card, rather than merely receiving it. */
  const detail = code("components/features/tasks/TaskDetail.tsx");
  assert.match(detail, /finishingAcceptance \?/);
  assert.match(detail, /onFinishingAcceptance=\{setFinishingAcceptance\}/);
});
