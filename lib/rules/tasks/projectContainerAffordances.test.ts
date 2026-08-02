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

test("every negotiation and acceptance card in the overview tab is gated on !isContainer", () => {
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
    assert.ok(
      before.includes("!isContainer"),
      `<${component}> is rendered without \`!isContainer\` guarding it nearby — a project would offer this action again`,
    );
  }
});

test("NextActionCard is gated on !isContainer, not only on whose turn it is", () => {
  const before = textBeforeTag(detail, "NextActionCard", 700);
  assert.ok(
    before.includes("!isContainer"),
    "NextActionCard must not fire for a container — action.actor alone does not know about projects",
  );
});

test("FactsRail receives isContainer and gates Priority, Expected completion, Scored against and Time budget on it", () => {
  assert.match(
    detail,
    /<FactsRail[\s\S]{0,120}isContainer=\{isContainer\}/,
    "FactsRail must be told the task is a container — it cannot infer it from `view` alone",
  );
  const railStart = detail.indexOf("function FactsRail(");
  assert.ok(railStart > 0, "FactsRail is missing");
  const railEnd = detail.indexOf("function Fact(", railStart);
  const rail = detail.slice(railStart, railEnd);
  for (const label of [
    '"Priority"',
    '"Expected completion"',
    '"Scored against"',
    '"Time budget"',
  ]) {
    const at = rail.indexOf(`<Fact label=${label}`);
    assert.ok(at > 0, `Fact label=${label} is missing from FactsRail`);
    const before = rail.slice(Math.max(0, at - 400), at);
    assert.ok(
      before.includes("!isContainer") || before.includes("isContainer &&"),
      `Fact label=${label} is not gated on isContainer — a project's facts rail would show a stale figure`,
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
