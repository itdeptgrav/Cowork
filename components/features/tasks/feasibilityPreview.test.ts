import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";

/**
 * The preview renders; it does not calculate.
 *
 * The whole risk in adding a UI to a rule this involved is that the component
 * grows its own version of the arithmetic — a buffer worked out here, a queue
 * sorted there — and then the preview and the engine quietly disagree.
 */

const code = (p: string) =>
  readFileSync(p, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

const CARD = "components/features/tasks/FeasibilityPreview.tsx";
const DIALOG = "components/features/tasks/PriorityDialog.tsx";
const CONFIRM = "components/features/tasks/PriorityConfirmDialog.tsx";

test("the component only calls the repository", () => {
  const src = code(CARD);
  /* The formatter splits the call across lines, so match the member access
     rather than the whole expression. */
  assert.match(src, /previewDeadlineFeasibility\(\{/);
  assert.match(src, /repo\s*\n?\s*\.previewDeadlineFeasibility|repo\.previewDeadlineFeasibility/);
  for (const own of [
    "chainDeadlines", "addWorkingSecs", "calculateDeadlineFeasibility",
    "isActivePriorityTask", ".sort(",
  ]) {
    assert.equal(src.includes(own), false, `the card computes "${own}" itself`);
  }

  /* CHANGED ON PURPOSE — was 4 splices in two helpers.
     The drag's own arithmetic (which gap the pointer is over, and the
     off-by-one when a row moves downward past its own place) moved OUT of this
     component into `lib/rules/ui/dragReorder.ts`, where it is tested against
     inputs instead of asserted against this file's text. Two splices are left,
     both in `moveSubjectTo`, which rearranges a list of ids in response to a
     chip — still a drag by other means, still not deciding what an order MEANS.
     Splice anywhere else would be the card doing queue logic of its own. */
  const splices = (src.match(/\.splice\(/g) ?? []).length;
  assert.equal(splices, 2, "splice moved outside moveSubjectTo");
  const helperAt = src.indexOf("const moveSubjectTo");
  assert.ok(helperAt !== -1, "moveSubjectTo is gone");
  const body = src.slice(helperAt, src.indexOf("\n  };", helperAt));
  assert.equal((body.match(/\.splice\(/g) ?? []).length, 2);
});

test("no arithmetic on the result beyond flipping a sign for display", () => {
  /* Rendering `-buffer` as "over" is presentation. Deriving a buffer would not
     be. */
  const src = code(CARD);
  assert.equal(/Date\.parse\(/.test(src), false, "the card is doing date maths");
  assert.match(src, /buffer >= 0/);
});

test("the queue measured is the assignee's, not the viewer's", () => {
  /* Two mount points, both passing the person who will DO the work: the
     priority dialog passes the subject; the budget form passes the pending
     assignee, who on a held cross-department task is not yet in `assignees`. */
  const dialog = code(DIALOG);
  assert.match(dialog, /employeeId=\{subject\?\.id \?\? null\}/);
  const detail = code("components/features/tasks/TaskDetail.tsx");
  assert.match(detail, /view\.pendingAssignees\[0\]\?\.id \?\? view\.assignees\[0\]\?\.id/);
  for (const src of [dialog, detail]) {
    assert.equal(
      /employeeId=\{me\}/.test(src),
      false,
      "the viewer's own workload is being measured",
    );
  }
});

test("the budget form shows the preview between the number and the button", () => {
  /* Where the question "is this enough time?" actually arises. */
  const detail = code("components/features/tasks/TaskDetail.tsx");
  const form = detail.slice(detail.indexOf("function EffortEstimateForm("));
  const previewAt = form.indexOf("<FeasibilityPreview");
  const buttonAt = form.indexOf("Set hours");
  assert.ok(previewAt > 0 && buttonAt > previewAt, "the preview is not before the commit");
  assert.match(form.slice(0, 2600), /estimatedWorkSeconds=\{hours \* 3600\}/);
});

test("a figure is never shown as an answer to a question it does not answer", () => {
  /* CHANGED ON PURPOSE — this used to pin `answer?.key === key ? answer.result
     : null`, i.e. the whole card emptying itself the instant any input changed.
     That was the largest part of the reported drag lag: every drop replaced the
     verdict, the dates, the queue, the chips and the reason field with one line
     of text for the settle delay plus a four-way Firestore read, and it
     destroyed the DOM nodes a reorder animation needs.

     The RULE has not changed — a verdict computed for four hours must never sit
     beside a dropdown reading twelve. What changed is how it is kept: the card
     holds the last answer and marks it `stale`, and every figure the pending
     input invalidates is dimmed under an explicit label. Restoring the blanking
     would be a regression, which is why this assertion is worded as the rule
     rather than as the expression. */
  const src = code(CARD);
  /* Keyed on the PREVIEWED position, which may be one being tried rather than
     the saved one. */
  assert.match(src, /const key = `\$\{employeeId\}\|\$\{position\}\|\$\{estimatedWorkSeconds\}/);
  assert.match(src, /const stale = answer !== null && answer\.key !== key;/);
  /* The first load still has nothing to show, and says so. */
  assert.match(src, /Checking deadline impact/);
  /* And the recomputing state is named rather than left as a silent dimming. */
  assert.match(src, /Recomputing the dates for this order/);
  /* Every order-dependent figure carries the mark. */
  assert.ok(
    (src.match(/stale \? "opacity-45" : ""/g) ?? []).length >= 2,
    "a date or a delay is shown at full strength while it is being recomputed",
  );
});

test("the assignee is named on the card", () => {
  /* On a cross-department task the reader is a manager elsewhere, and "based on
     the workload" without a name invites them to assume it is their own. */
  const src = code(CARD);
  assert.match(src, /Based on \{employeeName/);
});

test("setting hours is never blocked by a risky verdict", () => {
  /* Advisory. The button's only condition is a positive number. */
  const detail = code("components/features/tasks/TaskDetail.tsx");
  const form = detail.slice(detail.indexOf("function EffortEstimateForm("));
  assert.match(form.slice(0, 2600), /disabled=\{state\.isPending \|\| !\(hours > 0\)\}/);
  assert.equal(
    /feasible/.test(form.slice(0, 2600)),
    false,
    "the verdict is gating the commit",
  );
});

test("it re-asks as the priority moves, but not on every intermediate step", () => {
  /* Dragging through five positions should not fire five queries, and an answer
     for a position somebody passed through would render the wrong verdict. */
  const src = code(CARD);
  assert.match(src, /SETTLE_MS/);
  assert.match(src, /setTimeout\(/);
  assert.match(src, /clearTimeout\(timer\)/);
  assert.match(src, /cancelled = true/);
});

test("a failed preview does not block the form", () => {
  /* It is an aid, not a gate. A spinner that never resolves would be worse than
     saying so. */
  const src = code(CARD);
  assert.match(src, /deadline preview is unavailable/);
  assert.match(src, /You can still set the priority/);
});

test("nothing renders when there is nothing to measure", () => {
  /* No assignee, or no estimated time, means no question to answer — showing an
     empty verdict would imply one. */
  const src = code(CARD);
  assert.match(src, /if \(!employeeId \|\| estimatedWorkSeconds <= 0\) return null;/);
});

test("affected tasks are named, not counted", () => {
  /* "3 tasks move later" is a statistic; "Client report +4h" is a consequence
     somebody can weigh. The naming now lives in the sentence beneath the queue,
     with the figure also marked on the row it applies to. */
  const src = code(CARD);
  assert.match(src, /result\.affectedTasks\s*\n?\s*\.slice\(0, 3\)|result\.affectedTasks\.slice\(0, 3\)/);
  assert.match(src, /\$\{t\.title\} \+\$\{formatDurationTimer\(t\.movedLaterSeconds\)\}/);
});

test("advice appears only where the placement misses", () => {
  /* Offering suggestions on a feasible placement implies something is wrong
     with it. */
  assert.match(code(CARD), /!result\.feasible && result\.suggestions\.length > 0/);
});

test("the working is available but not in the way", () => {
  const src = code(CARD);
  assert.match(src, /"Why\?"/);
  assert.match(src, /result\.calculationTrace\.map/);
});

test("times render through the shared IST formatter", () => {
  const src = code(CARD);
  assert.match(src, /formatStamp\(/);
  assert.equal(/toLocale/.test(src), false, "a device clock is being read");
});

/* ── The assignee's real queue ────────────────────────────────────────────── */

test("the queue rendered is the engine's, not one assembled here", () => {
  /* `simulatedQueue` is built from `assigneePriorities[employeeId]` through the
     same builder production sorts on. The component never sees a raw task, so
     it could not assemble a second list even if it tried. */
  const src = code(CARD);
  assert.match(src, /result\.simulatedQueue\.map/);
  assert.equal(
    /listTasks|getTasks|assigneePriorities/.test(src),
    false,
    "the card is fetching or sorting tasks itself",
  );
});

test("this task is marked in the queue", () => {
  /* "P3 ← this task" is the whole point of showing the list. */
  const src = code(CARD);
  assert.match(src, /const subjectId = taskId \?\? "__proposed__";/);
  assert.match(src, /const isThis = e\.taskId === subjectId;/);
  assert.match(src, /isThis \? "This task" : e\.title/);
});

test("the delay lands on the row it applies to AND is said in words", () => {
  /* A "+4h" marker is easy to miss while scanning; a sentence naming the tasks
     is what somebody weighing P1 against P3 actually reads. */
  const src = code(CARD);
  assert.match(src, /delayed \+\$\{formatDurationTimer\(e\.movedLaterSeconds\)\}/);
  assert.match(src, /delays\{" "\}/);

  /* Worded, not bare. The figure is wall-clock slip and can far exceed the
     budget that caused it — six extra hours can delay the next task by
     twenty-one when it spills overnight. Unlabelled, that reads as effort. */
  assert.match(src, /"delayed \+|delayed \+\$\{/);
  /* And the reassuring case is stated rather than left blank. */
  assert.match(src, /"no change"/);
});

test("positions can be tried without committing", () => {
  /* The card asks "what if". Pressing a position must not save one. */
  const src = code(CARD);
  assert.match(src, /moveSubjectTo\(p\)/);
  assert.equal(
    /changePriority|setEffortEstimate/.test(src),
    false,
    "trying a position writes something",
  );
  /* `reorderPriorities` is here now, deliberately — but only behind the button.
     Nothing that TRIES a position may reach it. */
  const tryPaths = ["const moveSubjectTo", "const commitDrag"];
  for (const p of tryPaths) {
    const at = src.indexOf(p);
    const body = src.slice(at, src.indexOf("\n  };", at));
    assert.equal(
      /reorderPriorities/.test(body),
      false,
      `${p} writes an order`,
    );
  }
});

test("the drag reorder is the priority dialog's control, and the detail panel's", () => {
  /* Changed by the drag-and-drop rework: the priority dialog's control USED to be
     a numeric field, and this panel was mounted read-only beside it. Now the
     dialog IS the drag — it mounts the panel `selectable`, the same one the
     detail page uses — so there is one reorder control, not a number and a drag
     fighting over the same value. */
  const detail = code("components/features/tasks/TaskDetail.tsx");
  const block = detail.slice(detail.indexOf("<FeasibilityPreview"));
  assert.match(block.slice(0, block.indexOf("/>")), /\n\s*selectable\n/);
  const dialog = code(DIALOG);
  assert.match(dialog, /selectable/, "the dialog lost its drag reorder control");
  /* And the old numeric control is gone — a second way to set the same value. */
  assert.equal(
    /changePriority|New rank/.test(dialog),
    false,
    "the numeric priority control was left behind",
  );
});

test("a real priority change still leads the preview", () => {
  /* `tryPosition ?? proposedPriority ?? null` — an exploration never outranks
     the actual value once it changes, and an ABSENT value stays absent rather
     than becoming 1. That last link is the T648 bug. */
  assert.match(
    code(CARD),
    /const position = tryPosition \?\? proposedPriority \?\? null;/,
  );
});

/* ── The planning panel ───────────────────────────────────────────────────── */

test("every queue row carries a date, not only a duration", () => {
  /* The engine has returned `completionTime` per row all along; the table
     showed budgets and omitted it, which is the one column a planner needs. */
  const src = code(CARD);
  assert.match(src, /e\.completionTime && \(/);
  assert.match(src, /formatStamp\(e\.completionTime\)/);
});

test("effort is drawn as well as printed", () => {
  const src = code(CARD);
  assert.match(src, /longest > 0 \? \(e\.estimatedDuration \/ longest\) \* 100 : 0/);
  /* Against the longest task, never the total — proportion to the sum makes
     every bar on a busy queue a sliver. */
  assert.match(src, /const longest = Math\.max\(/);
});

test("budget can be tried in the panel, but the parent still owns it", () => {
  const src = code(CARD);
  assert.match(src, /onBudgetChange\(h \* 3600\)/);
  /* Selected state reads the PROP, so the chips cannot drift from the
     dropdown — there is one number and two ways to reach it. */
  assert.match(src, /estimatedWorkSeconds === h \* 3600/);
  assert.equal(
    /useState.*[Bb]udget|setBudget|setHours/.test(src),
    false,
    "the panel is holding its own budget",
  );
});

test("the budget chips drive the same field the button submits", () => {
  const detail = code("components/features/tasks/TaskDetail.tsx");
  assert.match(detail, /onBudgetChange=\{\(secs\) => setHours\(secs \/ 3600\)\}/);
  /* Every chip must exist in the dropdown, or pressing one would leave the
     Select showing a value it has no option for. */
  const chips = code(CARD).match(/\[1, 2, 4, 8, 12, 16\]/);
  assert.ok(chips, "the chip set moved; re-check it against the dropdown");
  const opts = detail.match(/\[1, 2, 3, 4, 6, 8, 12, 16, 24, 40\]/);
  assert.ok(opts, "the dropdown option set moved; re-check it against the chips");
});

test("budget selection is offered only where the budget is being set", () => {
  /* The priority dialog changes an order, not an estimate. Chips there would
     offer to set a budget that control cannot save. */
  assert.equal(/onBudgetChange/.test(code(DIALOG)), false);
});

/* ── Drag and drop ────────────────────────────────────────────────────────── */

test("rows are draggable and the dragged order is what the engine is asked", () => {
  /* CHANGED ON PURPOSE — the handlers were per-row and inline; they now come
     from `useListReorder`. The drop moved to the LIST, which is a fix and not a
     refactor: with per-row handlers, releasing over the gap between two rows hit
     no handler at all and the reorder was silently discarded. */
  const src = code(CARD);
  assert.match(src, /\{\.\.\.itemProps\(e\.taskId\)\}/);
  assert.match(src, /\{\.\.\.dragListProps\}/);
  /* The list carries the drop. This is the pin on the lost-drop bug: with the
     handler on each row, releasing over the gap between two rows hit nothing and
     the reorder was discarded without a word. */
  assert.match(src, /ref=\{setListNode\}/);
  assert.match(src, /enabled: reorderable,/);
  /* No per-row drag handler survives — that is the pin on the lost drop. */
  assert.equal(
    /onDragOver=|onDragStart=|onDrop=/.test(src),
    false,
    "a drag handler is bound in the component again",
  );
  /* The order goes back INTO the engine. The component never turns a position
     into a date — that is the whole point of the override existing. */
  assert.match(src, /orderOverride: order/);
  assert.equal(
    /chainDeadlines|addWorkingSecs|calculateDeadlineFeasibility/.test(src),
    false,
    "the card is computing dates itself",
  );
});

test("a downward drop lands where the gap is, not one row short", () => {
  /* CHANGED ON PURPOSE — this was a regex reading this component for the
     expression `const to = overIndex > from ? overIndex - 1 : overIndex;`,
     because there was no function to test. There is now: `moveWithin` in
     `lib/rules/ui/dragReorder.ts`, and `dragReorder.test.ts` asserts the
     behaviour directly, including the case the regex could never reach — that a
     row can be dragged all the way to the BOTTOM.

     What is pinned here is that the component did not grow its own copy. */
  const src = code(CARD);
  assert.equal(
    /overIndex|const to = /.test(src),
    false,
    "the component is doing insertion arithmetic again",
  );
  assert.match(src, /useListReorder/);
});

test("dragging never writes a priority", () => {
  /* CHANGED ON PURPOSE — the drop handler was `commitDrag` in this file; it is
     now the hook's `onReorder` callback. The GUARANTEE is unchanged and is what
     this test is for: a drop rearranges local state and nothing reaches the
     repository until somebody confirms. */
  const src = code(CARD);
  assert.match(src, /onReorder: \(next\) => \{/);
  assert.match(src, /setOrder\(next\)/);
  /* `reorderPriorities` appears exactly once, and it is the button's. */
  assert.equal(
    (src.match(/reorderPriorities/g) ?? []).length,
    1,
    "more than one path writes an order",
  );
  const call = src.slice(src.indexOf("reorderPriorities"));
  assert.equal(
    /onDrop|onDragEnd|onReorder/.test(call.slice(0, 200)),
    false,
    "a drag reaches the write",
  );
});

test("applying is explicit, reasoned, and refuses an empty reason", () => {
  /* CHANGED ON PURPOSE — the reason field and the disabled expression used to
     sit on this card, and pressing "Apply this priority" wrote immediately.
     A confirmation now stands in front of the write, and the reason moved into
     it, which is where legacy put both.

     The RULE is unchanged and is what this test is for: nothing is written
     without an explicit press, and no priority change is made without a reason
     the person whose queue moved will be shown. */
  const src = code(CARD);
  const confirm = code(CONFIRM);

  assert.match(src, /Apply this priority/);
  /* The button OPENS the confirmation. It must not write. */
  assert.match(src, /onClick=\{\(\) => setConfirming\(true\)\}/);
  const applyAt = src.indexOf("Apply this priority");
  assert.ok(applyAt !== -1, "the apply button is gone");
  assert.equal(
    /reorderPriorities/.test(src.slice(applyAt - 700, applyAt)),
    false,
    "the apply button reaches the write without a confirmation",
  );

  /* The write is still this card's, and still exactly one call — moving it into
     the dialog would give the product a second path that writes an order. */
  assert.match(src, /reorderPriorities\(employeeId \?\? "", applyIds, reason\.trim\(\)\)/);
  assert.match(src, /onConfirm=\{async \(\) => \{/);

  /* And the refusal moved with the field. */
  assert.match(confirm, /const blank = reason\.trim\(\)\.length === 0;/);
  assert.match(confirm, /disabled=\{pending \|\| blank\}/);
});

test("the confirmation shows the whole queue, before and after, with dates", () => {
  /* The point of the dialog. A list of only the rows that moved — which is what
     legacy showed — cannot answer "what does my week look like after this",
     and a rank change with no date beside it cannot be weighed at all. */
  const confirm = code(CONFIRM);
  assert.match(confirm, /Now/);
  assert.match(confirm, /After this change/);
  assert.match(confirm, /diffQueues\(before, after\)/);
  /* Both halves come from ONE engine answer, so they share a clock. Two calls
     would stamp two different `Date.now()`s and every row would show a drift
     nobody caused. */
  const src = code(CARD);
  assert.match(src, /snapshotOf\(result\.baselineQueue, taskTitleFor\)/);
  assert.match(src, /snapshotOf\(rows, taskTitleFor\)/);
  /* And the dialog computes no dates of its own. */
  assert.equal(
    /chainDeadlines|addWorkingSecs|Date\.parse\(/.test(confirm),
    false,
    "the confirmation is computing dates itself",
  );
});

test("the confirmation can be cancelled; the employee's receipt cannot", () => {
  /* Two dialogs, two different situations. Before the write there is a decision
     to decline, so Cancel and Escape both exist. Afterwards the change has
     already happened and there is nothing to decline — the receipt has one
     action, and no cross, no backdrop dismissal and no Escape. */
  const confirm = code(CONFIRM);
  assert.match(confirm, /Cancel/);
  assert.match(confirm, /e\.key === "Escape" && !pending/);

  const gate = code("components/features/tasks/PriorityAckGate.tsx");
  assert.equal(/Cancel|Dismiss|onClose/.test(gate), false, "the receipt offers a way out");
  assert.equal(
    /addEventListener\("keydown"/.test(gate),
    false,
    "the receipt can be escaped",
  );
});

test("the unsaved state is stated, not implied", () => {
  const src = code(CARD);
  assert.match(src, /This order is a preview/);
  assert.match(src, /real\s*\n?\s*queue is unchanged until you apply it/);
  /* And the resting state says the handles do something. */
  assert.match(src, /Drag a row to try a different order/);
});

test("a task not yet in the employee's queue is not in the apply payload", () => {
  /* `reorderPriorities` reorders work that person HAS. Sending an id they were
     never assigned would either fail or, worse, be accepted. */
  assert.match(src_apply(), /\.filter\(\(id\) => id !== "__proposed__"\)/);
});
function src_apply() {
  return code(CARD);
}

test("the chips and the drag agree about where the task is", () => {
  /* Setting `tryPosition` alone is ignored once an override exists, so a chip
     would look broken the moment somebody had dragged anything. */
  const src = code(CARD);
  assert.match(src, /onClick=\{\(\) => moveSubjectTo\(p\)\}/);
  assert.match(src, /const moveSubjectTo = \(p: number\) => \{/);
  assert.match(src, /setTryPosition\(next\.indexOf\(subjectId\) \+ 1\)/);
});

test("reordering is offered only where a position can be tried, and never on one row", () => {
  const src = code(CARD);
  /* CHANGED ON PURPOSE — read from the rows ON SCREEN rather than from the
     engine's last answer, because the two differ for as long as a dragged order
     is being recomputed, and the handles must not disappear mid-gesture. */
  assert.match(src, /const reorderable = selectable && rowIds\.length > 1;/);
  /* The priority dialog now mounts THIS panel as its drag reorder control — it
     passes `selectable`, so the handles appear there and the write is this
     panel's `reorderPriorities`. One drag in the product, not two. */
  assert.match(code(DIALOG), /selectable/);
});

/* ── T648: no caller may invent a position ────────────────────────────────── */

test("no component substitutes a position it cannot know", () => {
  /* The T648 bug in one line: `myRank ?? myStoredRank ?? 1`. Both are null
     unless the VIEWER is an assignee, so a manager sizing a cross-department
     task previewed it at P1 — nothing ahead of it, starting now. */
  for (const f of [
    CARD,
    "components/features/tasks/TaskDetail.tsx",
    "components/features/tasks/ExpectedCompletion.tsx",
  ]) {
    const src = code(f);
    assert.equal(
      /proposedPriority[:=]\s*\{?\s*view\.myRank|myStoredRank \?\? 1|proposedPriority \?\? 1/.test(src),
      false,
      `${f} is inventing a queue position again`,
    );
  }
});

test("the panel passes an absence through rather than filling it in", () => {
  const src = code(CARD);
  assert.match(src, /const position = tryPosition \?\? proposedPriority \?\? null;/);
  assert.match(src, /proposedPriority\?: number \| null;/);
});

test("the chip lit is the engine's answer, not the caller's guess", () => {
  /* `position` is null until somebody chooses, so lighting from it would leave
     every chip dark on a task that plainly sits somewhere. */
  assert.match(code(CARD), /result\.simulatedPosition === p/);
});

test("the completion line asks where it is, it does not say", () => {
  const src = code("components/features/tasks/ExpectedCompletion.tsx");
  assert.equal(
    /proposedPriority/.test(src),
    false,
    "ExpectedCompletion is still supplying a position",
  );
  /* And it still measures the person who will DO the work. */
  assert.match(src, /view\.pendingAssignees\[0\]\?\.id \?\? view\.assignees\[0\]\?\.id/);
});
