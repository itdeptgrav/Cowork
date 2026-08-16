import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

/**
 * Nothing happens on a project — asserted against the actual JSX.
 *
 * The reported symptom: a broken-down task's own detail page still showed a
 * time budget, a proposed duration and an "Accept 05:00:00" button, and its
 * row in the task table still showed a deadline, a time-budget figure, a
 * timer control and "→ Accept or discuss the time". All of that is state the
 * ENGINE wrote to the document back when it was an ordinary task, before it
 * had any subtasks — nothing rewrites or clears it the moment a task is
 * broken down, so every card and cell that reads it blindly kept offering an
 * action on a document nobody is meant to act on any more.
 *
 * `isProjectContainer`/`isContainer` already existed and correctly hid the
 * Time panel, the Deadline/Submission/Review tabs and the priority cell — this
 * is what was missed: every negotiation and acceptance CARD in the overview
 * tab, four more facts in the details rail, and three more cells in the table
 * row. Each is real component behaviour, not a pure function, so it is
 * asserted the same way `subtaskWire.test.ts` asserts the wire body: read as
 * text, checked for the guard.
 */

const detail = readFileSync(
  new URL(
    "../../../components/features/tasks/TaskDetail.tsx",
    import.meta.url,
  ),
  "utf8",
);
const table = readFileSync(
  new URL(
    "../../../components/features/tasks/TaskTable.tsx",
    import.meta.url,
  ),
  "utf8",
);

/** The text just before a component's first tag, so a guard can be required nearby. */
function textBeforeTag(source: string, component: string, window = 400): string {
  const at = source.indexOf(`<${component}`);
  assert.ok(at > 0, `${component} is missing from the file entirely`);
  return source.slice(Math.max(0, at - window), at);
}

/**
 * **REVERSED — OWNER DECISION, 16 Aug 2026.**
 *
 * These three tests asserted the opposite: that a container loses its
 * negotiation cards, its next action, its deadline and its facts. The owner's
 * model is that a parent is real work that was DIVIDED, not an empty folder —
 * it keeps the deadline it was given, and that deadline is the cap every
 * subtask sits under, so it must be visible and negotiable.
 *
 * **Exactly one thing is still withheld: the Play/Pause timer.** That one is
 * unchanged and load-bearing — a Start button on a parent would bank time
 * against work somebody else is doing on a subtask, counting it twice.
 */

test("a project keeps every negotiation and acceptance card", () => {
  for (const component of [
    "AssignmentConfirmationCard",
    "ExtensionDecisionCard",
    "DeadlineRevisionCard",
    "CounterDeadlineCard",
    "BudgetConfirmationCard",
    "BudgetNegotiationCard",
    "ExtensionTimeline",
    "ReworkPanel",
    "ApprovalActionCard",
    "TaskFlowSection",
    "RelationshipNote",
  ]) {
    const before = textBeforeTag(detail, component);
    assert.equal(
      before.includes("!isContainer"),
      false,
      `<${component}> is gated on !isContainer again — a project must keep its extension and approval flow`,
    );
  }
});

test("NextActionCard fires on a project too", () => {
  const before = textBeforeTag(detail, "NextActionCard", 700);
  assert.equal(
    before.includes("!isContainer"),
    false,
    "NextActionCard is gated on !isContainer again — a project's own move would be hidden",
  );
});

test("the timer is the ONE thing a project still loses", () => {
  /* The whole of the reversal, stated as one assertion: Play/Pause stays
     gated, and nothing else in the overview is. */
  assert.match(
    detail,
    /\{tab === "overview" && !isContainer && <TimePanel view=\{v\} \/>\}/,
    "the Play/Pause timer is no longer withheld from a project — time would be banked twice",
  );
});

test("a project shows its deadline and still withholds its time budget", () => {
  /**
   * The deadline is the cap its subtasks sit under, so it has to be on the
   * parent's own page — a cap nobody can see is a cap nobody can plan against.
   *
   * The time budget stays hidden, per the owner: the figure matters while the
   * task is ordinary work, and once the work is divided the parent does not
   * need it. Nothing can be spent against it anyway, because there is no timer.
   */
  assert.match(
    detail,
    /<FactsRail[\s\S]{0,120}isContainer=\{isContainer\}/,
    "FactsRail must still be told — the time budget and priority gates read it",
  );
  const railStart = detail.indexOf("function FactsRail(");
  assert.ok(railStart > 0, "FactsRail is missing");
  const rail = detail.slice(railStart, detail.indexOf("function Fact(", railStart));

  const deadlineAt = rail.indexOf('<Fact label="Deadline"');
  assert.ok(deadlineAt > 0, "the Deadline fact is missing");
  assert.equal(
    rail.slice(Math.max(0, deadlineAt - 400), deadlineAt).includes("!isContainer"),
    false,
    "the deadline is hidden on a project again — its subtasks are capped by a date nobody can see",
  );

  for (const label of ['"Priority"', '"Time budget"']) {
    const at = rail.indexOf(`<Fact label=${label}`);
    assert.ok(at > 0, `Fact label=${label} is missing from FactsRail`);
    assert.ok(
      rail.slice(Math.max(0, at - 400), at).includes("!isContainer"),
      `Fact label=${label} is no longer withheld from a project`,
    );
  }
});

test("a project keeps Deadline, Submission and Review tabs, but not Reports", () => {
  /* Reports is the exception: a daily report is written against time a timer
     measured, and a project has no timer. Its days belong to the subtasks. */
  const at = detail.indexOf("id: \"reports\"");
  assert.ok(at > 0, "the Reports tab is gone entirely");
  assert.ok(
    detail.slice(Math.max(0, at - 300), at).includes("isContainer"),
    "Reports is offered on a project — there is no timer behind it to report on",
  );
  for (const id of ['id: "deadline"', 'id: "submission"', 'id: "review"']) {
    const tabAt = detail.indexOf(id);
    assert.ok(tabAt > 0, `${id} tab is missing`);
    assert.equal(
      detail.slice(Math.max(0, tabAt - 200), tabAt).includes("isContainer\n      ? []"),
      false,
      `${id} is withheld from a project again`,
    );
  }
});

test("the container gets its own explanatory panel in the overview tab", () => {
  assert.match(
    detail,
    /tab === "overview" && isContainer &&[\s\S]{0,80}<Panel>/,
    "a project should read as a deliberate state, not an overview tab that quietly went empty",
  );
});

test("the table row hides the deadline and time-budget figures on a container", () => {
  const rowStart = table.indexOf("function Row({");
  assert.ok(rowStart > 0, "Row is missing from TaskTable.tsx");
  const row = table.slice(rowStart);
  assert.match(
    row,
    /isContainer\s*\?\s*"—"/,
    'the deadline cell must read "—" for a container rather than the document\'s stale date',
  );
});

test("TimerControl is not rendered for a container row", () => {
  const rowStart = table.indexOf("function Row({");
  const row = table.slice(rowStart);
  const timerAt = row.indexOf("<TimerControl");
  assert.ok(timerAt > 0, "TimerControl is missing from Row entirely");
  const before = row.slice(Math.max(0, timerAt - 300), timerAt);
  assert.ok(
    before.includes("isContainer ?"),
    "TimerControl is rendered without an isContainer branch — a project row would offer a Start button",
  );
});

test("the table row's next-action text is replaced, not just re-tinted, on a container", () => {
  const rowStart = table.indexOf("function Row({");
  const row = table.slice(rowStart);
  assert.match(
    row,
    /isContainer\s*\n?\s*\?\s*"Project — see its subtasks"/,
    "a container's row must not say “→ Accept or discuss the time” or any other live next-action text",
  );
});
