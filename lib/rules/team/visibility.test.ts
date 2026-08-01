import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { managesAnyone, peopleUnder, teamRefusal } from "./visibility.ts";
import type { Viewer } from "../../domain/identity.ts";

const viewer = (over: Partial<Viewer> = {}): Viewer =>
  ({
    employeeId: "ME",
    roles: [],
    hierarchyIds: [],
    directReportIds: [],
    ...over,
  }) as Viewer;

test("somebody with nobody under them manages nobody", () => {
  assert.equal(managesAnyone(viewer()), false);
  assert.match(teamRefusal(viewer()) ?? "", /reporting to them/i);
});

test("a direct report is enough", () => {
  assert.equal(managesAnyone(viewer({ directReportIds: ["A"] })), true);
  assert.equal(teamRefusal(viewer({ directReportIds: ["A"] })), null);
});

test("an indirect report counts too", () => {
  /* A manager whose only reports sit under a vacant intermediate role still
     manages people — which is why this reads the closure, not direct reports. */
  assert.equal(managesAnyone(viewer({ hierarchyIds: ["A", "B"] })), true);
});

test("managing yourself is never managing somebody", () => {
  /* The closure includes the viewer in some responses and not others. If self
     counted, EVERYBODY would see the team surfaces. */
  assert.equal(managesAnyone(viewer({ hierarchyIds: ["ME"] })), false);
  assert.equal(managesAnyone(viewer({ directReportIds: ["ME"] })), false);
  assert.deepEqual(peopleUnder(viewer({ hierarchyIds: ["ME"] })), []);
});

test("self is excluded but the others are kept", () => {
  assert.deepEqual(
    peopleUnder(viewer({ hierarchyIds: ["ME", "A"], directReportIds: ["A", "B"] })).sort(),
    ["A", "B"],
  );
});

test("no viewer is not a manager, and is not refused either", () => {
  /* A viewer that has not loaded is not evidence of having no team — the gate
     waits rather than accusing. */
  assert.equal(managesAnyone(null), false);
  assert.equal(teamRefusal(null), null);
});

test("a role is never what grants this", () => {
  /* A "TL" with an empty team manages nobody. The tree knows; the title does
     not — and reading roles here is how that gets it wrong. */
  const titled = viewer({ roles: [{ id: "tl" }] as unknown as Viewer["roles"] });
  assert.equal(managesAnyone(titled), false);

  const source = readFileSync("lib/rules/team/visibility.ts", "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
  assert.doesNotMatch(source, /\broles\b/, "visibility reads roles");
});

test("the Team nav entry is withheld from somebody who manages nobody", () => {
  const nav = readFileSync("lib/utils/nav.ts", "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
  assert.match(nav, /managesAnyone/, "visibleNavItems ignores the reporting tree");
  assert.match(nav, /href !== "\/team"/, "the Team entry is not filtered");
});

test("every team route is covered by the layout, not per page", () => {
  /* A new team view must inherit the rule by living in the folder rather than
     by somebody remembering to add a check. */
  const layout = readFileSync("app/team/layout.tsx", "utf8");
  assert.match(layout, /TeamGate/);
});
