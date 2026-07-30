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

  /* `splice` IS allowed — rearranging a list of ids is what a drag is, and the
     result goes straight back to the engine. What is banned is deciding what
     an order MEANS. So the line is drawn at the two reorder helpers: splice
     anywhere else would be the card doing queue logic of its own. */
  const splices = (src.match(/\.splice\(/g) ?? []).length;
  assert.equal(splices, 4, "splice moved outside the two reorder helpers");
  for (const helper of ["const commitDrag", "const moveSubjectTo"]) {
    const at = src.indexOf(helper);
    assert.ok(at !== -1, `${helper} is gone`);
    const body = src.slice(at, src.indexOf("\n  };", at));
    assert.equal((body.match(/\.splice\(/g) ?? []).length, 2);
  }
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

test("changing the budget re-asks rather than showing the old verdict", () => {
  /* A verdict computed for four hours must never sit beside a dropdown reading
     twelve. The answer carries the question it answers. */
  const src = code(CARD);
  /* Keyed on the PREVIEWED position, which may be one being tried rather than
     the saved one. */
  assert.match(src, /const key = `\$\{employeeId\}\|\$\{position\}\|\$\{estimatedWorkSeconds\}/);
  assert.match(src, /answer\?\.key === key \? answer\.result : null/);
  assert.match(src, /Checking deadline impact/);
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
  const src = code(CARD);
  assert.match(src, /draggable=\{reorderable\}/);
  assert.match(src, /onDragStart=/);
  assert.match(src, /onDrop=/);
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
  /* The gap index counts the dragged row while it is still in place. Off by
     one here means every downward drag silently lands too high. */
  assert.match(code(CARD), /const to = overIndex > from \? overIndex - 1 : overIndex;/);
});

test("dragging never writes a priority", () => {
  const src = code(CARD);
  /* The drop handler sets local state and nothing else. */
  assert.match(src, /const commitDrag = \(\) => \{/);
  assert.match(src, /setOrder\(next\)/);
  /* `reorderPriorities` appears exactly once, and it is the button's. */
  assert.equal(
    (src.match(/reorderPriorities/g) ?? []).length,
    1,
    "more than one path writes an order",
  );
  const call = src.slice(src.indexOf("reorderPriorities"));
  assert.equal(
    /onDrop|onDragEnd|commitDrag/.test(call.slice(0, 200)),
    false,
    "a drag reaches the write",
  );
});

test("applying is explicit, reasoned, and refuses an empty reason", () => {
  const src = code(CARD);
  assert.match(src, /Apply this priority/);
  assert.match(src, /disabled=\{applying \|\| reason\.trim\(\)\.length === 0\}/);
  /* Same rule as every other priority change: the person whose queue moved is
     told who moved it and why. Reordering from a planner is not exempt. */
  assert.match(src, /reorderPriorities\(employeeId \?\? "", applyIds, reason\.trim\(\)\)/);
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
  assert.match(src, /const reorderable = selectable && result\.simulatedQueue\.length > 1;/);
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
