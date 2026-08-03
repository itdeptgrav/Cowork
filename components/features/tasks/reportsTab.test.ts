import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

/**
 * Daily reports have a tab, and a project does not get one.
 *
 * Reports were a card at the bottom of the overview tab that rendered only
 * once at least one existed, so the place to look for them was invisible on
 * exactly the task where somebody was asking where they had gone. They are a
 * tab now — always present, with an empty state that says where reports come
 * from.
 *
 * Asserted against the source the same way `projectContainerAffordances.test.ts`
 * asserts the container guards: this is component wiring rather than a pure
 * function, and the thing worth holding is that the tab, the route and the
 * container guard stay in step with each other.
 */

const detail = readFileSync(
  new URL("./TaskDetail.tsx", import.meta.url),
  "utf8",
);
const panel = readFileSync(
  new URL("./ReportsPanel.tsx", import.meta.url),
  "utf8",
);
const route = readFileSync(
  new URL("../../../app/tasks/[taskId]/reports/page.tsx", import.meta.url),
  "utf8",
);

test("the Reports tab is declared and points at its own route", () => {
  assert.match(
    detail,
    /id: "reports",[\s\S]{0,120}label: "Reports"/,
    "the tab bar has no Reports entry",
  );
  assert.match(
    detail,
    /href: `\/tasks\/\$\{taskId\}\/reports`/,
    "the Reports tab does not link to /tasks/:id/reports",
  );
  assert.match(
    route,
    /tab="reports"/,
    "/tasks/:id/reports does not open the task on the reports tab",
  );
});

test('"reports" is a Tab, so the route cannot pass a value the detail rejects', () => {
  const at = detail.indexOf("type Tab =");
  assert.ok(at > 0, "the Tab union is missing");
  const union = detail.slice(at, detail.indexOf(";", at));
  assert.ok(union.includes('"reports"'), '"reports" is not part of the Tab union');
});

test("a project offers no Reports tab and no reports panel", () => {
  /* Same list, twice: the tab is dropped from the bar for a container, and the
     URL — which somebody can still hold open from before the task was broken
     down — is answered by the explanatory panel rather than an empty list. */
  const tabsAt = detail.indexOf("const tabs = [");
  const tabs = detail.slice(tabsAt, detail.indexOf("return (", tabsAt));
  const guardAt = tabs.indexOf("isContainer");
  const reportsAt = tabs.indexOf('id: "reports"');
  assert.ok(
    guardAt > 0 && reportsAt > guardAt,
    "the Reports tab is not inside the `isContainer ? [] : [...]` group",
  );

  assert.match(
    detail,
    /tab === "reports" && !isContainer && <ReportsPanel/,
    "ReportsPanel is rendered without `!isContainer` guarding it",
  );
  assert.match(
    detail,
    /tab === "reports" \|\|/,
    'the "This task has been broken down" panel does not cover the reports tab',
  );
});

test("the panel is always rendered, with an empty state rather than nothing", () => {
  assert.match(
    panel,
    /<EmptyState[\s\S]{0,200}No daily reports yet/,
    "an empty Reports tab must say there are none, not render an empty panel",
  );
  /* The one thing a reader cannot work out from the tab itself: where a report
     is written, given that nothing here writes one. */
  assert.match(
    panel,
    /go offline/,
    "the empty state must say where daily reports come from",
  );
});

test("the overview tab no longer carries its own copy of the reports list", () => {
  const overviewAt = detail.indexOf("function Overview(");
  assert.ok(overviewAt > 0, "Overview is missing");
  const overview = detail.slice(overviewAt);
  assert.ok(
    !overview.includes("listDailyReports"),
    "Overview still reads the daily reports — two lists of one thing is two places to keep right",
  );
});
