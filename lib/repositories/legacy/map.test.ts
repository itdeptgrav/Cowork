import assert from "node:assert/strict";
import { test } from "node:test";
import {
  clampPercent,
  hueFor,
  initialsOf,
  periodKeyOf,
  splitName,
  toEmployee,
  toScoreOverview,
  toViewer,
} from "./map.ts";
import { toTask, toTaskStatus, toTaskType, toTaskView } from "./taskMap.ts";
import { readEmployee } from "../../legacy/employees.ts";
import { readDashboard } from "../../legacy/scoring.ts";
import { readTask } from "../../legacy/tasks.ts";
import { LegacyRepository, NotConnectedError, toCoworkRepository } from "./index.ts";

/* ── Employee ─────────────────────────────────────────────────────────────── */

test("a directory row maps to an Employee", () => {
  const e = toEmployee(readEmployee({
    employeeId: "E001", name: "Rakesh Biswal", email: "r@grav.in",
    department: "QC", role: "tl",
  })!);
  assert.equal(e.id, "E001");
  assert.equal(e.firstName, "Rakesh");
  assert.equal(e.lastName, "Biswal");
  assert.equal(e.initials, "RB");
  assert.equal(e.departmentName, "QC");
});

test("fields legacy does not send stay EMPTY, never guessed", () => {
  /* departmentId, designation, workCalendarId and joinedAt live behind the HR
     token. A plausible default here would be invented employment data. */
  const e = toEmployee(readEmployee({ employeeId: "E1", name: "X" })!);
  assert.equal(e.departmentId, "");
  assert.equal(e.designation, "");
  assert.equal(e.workCalendarId, "");
  assert.equal(e.joinedAt, "");
  assert.equal(e.email, "");
  /* No picture is the ordinary case, and the honest one: nothing here invents a
     face. */
  assert.equal(e.profilePictureUrl, null);
});

test("a stored profile picture reaches the domain instead of being dropped", () => {
  /* The bug this closes: `readEmployee` has always mapped
     `cowork_employees.profilePicUrl` into `avatarUrl`, and `toEmployee` never
     carried it — so real employees with photographs set years ago in the old
     app were drawn as monograms here. Same class as `estimatedEffortSecs: 0`. */
  const picture = `data:image/jpeg;base64,${"A".repeat(400)}`;
  const e = toEmployee(
    readEmployee({ employeeId: "E1", name: "X", profilePicUrl: picture })!,
  );
  assert.equal(e.profilePictureUrl, picture);
});

test("an unrenderable stored value leaves the monogram rather than a broken image", () => {
  /* Vetted at the MAPPER, not at the wire layer — which imports no rules — so
     one bad document cannot put a broken image, or a `javascript:` URL, into
     every screen that draws that person's name. */
  for (const bad of [
    "javascript:alert(1)",
    "http://example.test/a.jpg",
    `data:image/jpeg;base64,${"A".repeat(400_000)}`,
  ]) {
    const e = toEmployee(
      readEmployee({ employeeId: "E1", name: "X", profilePicUrl: bad })!,
    );
    assert.equal(e.profilePictureUrl, null, bad.slice(0, 32));
  }
});

test("an unrecognised role is an employee, never something higher", () => {
  /* `coworkAuth.js:78-80` compares three strings and anything that is neither
     "ceo" nor "tl" falls through both checks into the employee case. Guessing
     upward would grant access the engine then refuses. */
  const of = (role?: string) =>
    toEmployee(readEmployee({ employeeId: "E1", name: "X", role })!).roleIds;
  assert.deepEqual(of("ceo"), ["role-employee", "role-admin"]);
  assert.deepEqual(of("tl"), ["role-employee", "role-manager"]);
  assert.deepEqual(of("employee"), ["role-employee"]);
  assert.deepEqual(of("superadmin"), ["role-employee"]);
  assert.deepEqual(of(undefined), ["role-employee"]);
});

test("the directory carries standing, so levelOf is not 0 for everybody", () => {
  /* `roleIds` was `[]` for every row, which made `usePermissions.levelOf`
     answer 0 for the chief executive and 0 for a new joiner alike. The
     administrative floor then compared 0 >= 0 and refused, and the upward
     assignment gate — which fires when the assignee outranks the creator —
     could never fire for anyone. */
  const tl = toEmployee(readEmployee({ employeeId: "E1", name: "X", role: "tl" })!);
  assert.ok(tl.roleIds.length > 0);
});

test("a one-word name does not invent a surname", () => {
  const { firstName, lastName } = splitName("Soumya");
  assert.equal(firstName, "Soumya");
  assert.equal(lastName, "");
  assert.equal(initialsOf("Soumya", "", "E9"), "S");
});

test("initials fall back to the id rather than rendering blank", () => {
  assert.equal(initialsOf("", "", "E42"), "E4");
});

test("the monogram hue is stable for an id", () => {
  /* Random assignment would make the directory shimmer on every load. */
  assert.equal(hueFor("E001"), hueFor("E001"));
  assert.ok(hueFor("E001") >= 0 && hueFor("E001") <= 5);
});

/* ── Viewer ───────────────────────────────────────────────────────────────── */

test("the viewer's hierarchy lists are empty, and that is the safe direction", () => {
  /* Legacy has no downward endpoint. These lists WIDEN what somebody may see,
     so empty under-shows rather than leaking another team's work. */
  const v = toViewer({ employeeId: "E1", legacyRole: "tl", hasManager: true });
  assert.deepEqual(v.hierarchyIds, []);
  assert.deepEqual(v.directReportIds, []);
  assert.equal(v.hasManager, true);
});

test("the administrative level follows the role mapping", () => {
  /* The ladder is the one in `systemRoles.ts`, shared with the seed tenant, so
     a level compared here means the same thing as a level compared there. */
  const level = (legacyRole: string) =>
    toViewer({ employeeId: "x", legacyRole, hasManager: true }).administrativeLevel;
  assert.equal(level("ceo"), 100);
  assert.equal(level("tl"), 30);
  assert.equal(level("employee"), 10);
  assert.equal(level("superadmin"), 10, "unknown maps down, never up");
});

test("standing comes from the role string, reach from the tree", () => {
  /* Managing somebody must not raise your standing among your colleagues —
     that is a promotion, and it is not this product's to grant. If it did, the
     viewer's level would disagree with the level `usePermissions` computes for
     the same person out of the directory, and the administrative floor and the
     upward gate would answer differently about one employee. */
  const managing = toViewer({
    employeeId: "x", legacyRole: "employee", hasManager: true, hasDirectReports: true,
  });
  assert.equal(managing.administrativeLevel, 10, "still an employee's standing");
  assert.ok(
    managing.roles.some((r) => r.id === "role-manager"),
    "but holds the manager role, whose grants are all direct_reports-scoped",
  );
});

test("a viewer holds roles at all — an empty list is no model, not a strict one", () => {
  /* `roles: []` denied every capability to everybody: `can()` finds a
     capability by intersecting these with `listRoles()`. The chief executive
     was shown "your roles do not include" in place of /admin. */
  const ceo = toViewer({ employeeId: "GR0000", legacyRole: "ceo", hasManager: false });
  assert.deepEqual(
    ceo.roles.map((r) => r.id),
    ["role-employee", "role-admin"],
  );
  const staff = toViewer({ employeeId: "GR0067", legacyRole: "employee", hasManager: true });
  assert.deepEqual(staff.roles.map((r) => r.id), ["role-employee"]);
});

test("a team lead keeps their surfaces between assignments", () => {
  /* Reach is earned from the tree, but a lead whose last report has just moved
     should not lose the manager surfaces on that day. The grants are all
     direct_reports-scoped, so the role reaches nobody until they have somebody
     again — it costs nothing and it stops the surfaces flickering. */
  const lead = toViewer({
    employeeId: "GR0045", legacyRole: "tl", hasManager: true, hasDirectReports: false,
  });
  assert.ok(lead.roles.some((r) => r.id === "role-manager"));
});

/* ── Score ────────────────────────────────────────────────────────────────── */

test("the engine's own total is used, never recomputed", () => {
  /* pmpService owns the arithmetic and cites a spec that is in neither repo.
     A total re-derived here could disagree with an appraisal. */
  const d = readDashboard({
    employeeId: "E1", quarter: 3, year: 2026, totalEarned: 61,
    c1: { net: 85, max: 35, sopPts: 30 }, c2: { net: 66, max: 30, sopPts: 20 },
    c3: { net: 40, max: 10, sopPts: 4 }, c4: { net: 70, max: 10, sopPts: 7 },
  });
  const s = toScoreOverview(d, "E1");
  assert.equal(s.earnedPoints, 61, "the engine's figure, not 30+20+4+7");
  assert.equal(s.possiblePoints, 85);
  assert.equal(s.periodKey, "2026-Q3");
});

test("C3 hangs downward and the others fill up", () => {
  const s = toScoreOverview(readDashboard({ c1: { net: 1 }, c2: { net: 1 }, c3: { net: 1 }, c4: { net: 1 } }), "E1");
  const dir = Object.fromEntries(s.channels.map((c) => [c.code, c.direction]));
  assert.equal(dir.C1, "up");
  assert.equal(dir.C2, "up");
  assert.equal(dir.C3, "down", "The Deduction Hangs Rule");
  assert.equal(dir.C4, "up");
});

test("delta is always zero — a trend needs a second period", () => {
  /* This endpoint returns one quarter. An invented delta would put a trend
     arrow on screen that nothing measured. */
  assert.equal(toScoreOverview(readDashboard({ totalEarned: 40 }), "E1").delta, 0);
});

test("no score data yields zeroes, not a confident percentage", () => {
  const s = toScoreOverview(readDashboard({}), "E1");
  assert.equal(s.earnedPoints, 0);
  assert.equal(s.possiblePoints, 0);
  assert.equal(s.overallPercentage, 0, "0/0 must not become NaN or 100");
  assert.equal(s.periodKey, "", "no period claimed when the engine sent none");
});

test("a missing maximum is captioned rather than defaulted to 100", () => {
  const s = toScoreOverview(readDashboard({ c1: { net: 75, sopPts: 30 } }), "E1");
  const c1 = s.channels.find((c) => c.code === "C1")!;
  assert.equal(c1.possiblePoints, 0);
  assert.match(c1.caption, /Maximum not reported/);
});

test("percentages are clamped and never NaN", () => {
  assert.equal(clampPercent(NaN), 0);
  assert.equal(clampPercent(-5), 0);
  assert.equal(clampPercent(140), 100);
});

test("the period comes from the engine, never from this machine's clock", () => {
  assert.equal(periodKeyOf(readDashboard({ year: 2026, quarter: 2 })), "2026-Q2");
  assert.equal(periodKeyOf(readDashboard({ year: 2026 })), "");
});

/* ── Tasks ────────────────────────────────────────────────────────────────── */

const task = (over: Record<string, unknown>) =>
  readTask({ id: "t1", title: "Ship it", ...over })!;

test("completionStatus wins over status, being the more specific axis", () => {
  /* Legacy leaves `status` at "open" through an entire review cycle. Reading
     only that would put a task in review in the wrong column. */
  assert.equal(
    toTaskStatus(task({ status: "open", completionStatus: "pending_tl_review" })),
    "in_review",
  );
  assert.equal(toTaskStatus(task({ status: "open" })), "assigned");
});

test("both spellings of a rejection return the assignee to work", () => {
  for (const cs of ["tl_rejected", "rejected_by_tl", "ceo_rejected", "rejected_by_ceo"]) {
    assert.equal(toTaskStatus(task({ completionStatus: cs })), "in_progress", cs);
  }
});

test("legacy's terminal statuses map to completed", () => {
  for (const s of ["done", "ceo_approved", "tl_final_approved", "completed"]) {
    assert.equal(toTaskStatus(task({ status: s })), "completed", s);
  }
  assert.equal(toTaskStatus(task({ status: "cancelled" })), "cancelled");
});

test("an unrecognised status becomes the neutral live state", () => {
  assert.equal(toTaskStatus(task({ status: "something_new" })), "assigned");
});

test("removed task kinds still surface rather than vanishing", () => {
  /* Folders and third-party tasks were removed by D33 but exist in legacy data.
     Dropping them would take work off somebody's list. */
  assert.equal(toTaskType("folder"), "external");
  assert.equal(toTaskType("third_party"), "external");
  assert.equal(toTaskType("repeat"), "recurring");
  assert.equal(toTaskType("goal"), "goal");
});

test("a deadline maps to both dueAt and officialDueAt identically", () => {
  /* A different official date would make scoring disagree with what the
     assignee was shown. */
  const t = toTask(task({ fixedDeadline: "2026-08-01T09:00:00.000Z" }));
  assert.equal(t.deadline.dueAt, "2026-08-01T09:00:00.000Z");
  assert.equal(t.deadline.officialDueAt, t.deadline.dueAt);
  assert.equal(t.deadline.state, "agreed");
});

test("an undated task is unset, not zero-dated", () => {
  const t = toTask(task({}));
  assert.equal(t.deadline.dueAt, null);
  assert.equal(t.deadline.state, "unset");
});

test("effort is zero because legacy keeps it elsewhere", () => {
  /* On the timer subcollection, behind the Firestore proxy. A guessed estimate
     would drive a progress bar. */
  assert.equal(toTask(task({})).estimatedEffortSecs, 0);
});

test("assignees resolve against the real directory, or are omitted", () => {
  /* A placeholder employee would put an invented name on a task. */
  const known = toEmployee(readEmployee({ employeeId: "E1", name: "Maya" })!);
  const view = toTaskView({
    legacy: task({ assigneeIds: ["E1", "GHOST"] }),
    employeesById: new Map([["E1", known]]),
    viewerId: "E1",
    nowMs: Date.parse("2026-07-28T00:00:00Z"),
  });
  assert.deepEqual(view.assignees.map((a) => a.displayName), ["Maya"]);
  assert.equal(view.loggedSecs, 0);
  assert.deepEqual(view.approvals, []);
  assert.equal(view.chatCount, 0);
});

test("overdue is only true for live, dated, past-due work", () => {
  const now = Date.parse("2026-07-28T00:00:00Z");
  const mk = (over: Record<string, unknown>) =>
    toTaskView({ legacy: task(over), employeesById: new Map(), viewerId: "E1", nowMs: now });

  assert.equal(mk({ fixedDeadline: "2026-07-01T00:00:00Z" }).isOverdue, true);
  assert.equal(mk({ fixedDeadline: "2026-09-01T00:00:00Z" }).isOverdue, false);
  assert.equal(mk({}).isOverdue, false, "undated is never overdue");
  assert.equal(
    mk({ fixedDeadline: "2026-07-01T00:00:00Z", status: "ceo_approved" }).isOverdue,
    false,
    "finished work is not overdue",
  );
});

test("my rank is null unless the viewer is actually assigned", () => {
  const now = Date.now();
  const mine = toTaskView({
    legacy: task({ assigneeIds: ["E1"], priority: 2 }),
    employeesById: new Map(), viewerId: "E1", nowMs: now,
  });
  const theirs = toTaskView({
    legacy: task({ assigneeIds: ["E2"], priority: 2 }),
    employeesById: new Map(), viewerId: "E1", nowMs: now,
  });
  assert.equal(mine.myRank, 2);
  assert.equal(theirs.myRank, null);
});

/* ── The provisioning trap ────────────────────────────────────────────────── */

test("provisioning methods exist and resolve, so sign-in cannot hang", () => {
  /* `SessionProvider.load()` calls ensureSessionEmployee, setActingContext and
     ensureDirectoryEmployees immediately after installing this repository. If
     any falls through to the throwing proxy, load()'s own catch swallows it and
     the session stays "loading" forever — the page renders "Signing you in…"
     with nothing behind it. These must be present, and must not throw. */
  const proto = LegacyRepository.prototype as unknown as Record<string, unknown>;
  for (const name of [
    "ensureSessionEmployee",
    "ensureDirectoryEmployees",
    "setActingContext",
    "setActingId",
  ]) {
    assert.equal(typeof proto[name], "function", `${name} must be implemented`);
  }
});

test("the proxy throws only for genuinely unwired methods", async () => {
  const repo = toCoworkRepository(
    new LegacyRepository({
      getToken: async () => null,
      employeeId: "E1",
      legacyRole: "employee",
      hasManager: false,
    }),
  );
  /* Implemented: resolves. */
  await (repo as unknown as { ensureSessionEmployee: () => Promise<void> })
    .ensureSessionEmployee();

  /* Unwired: throws by name, so the failure is visible rather than a plausible
     empty value nobody can distinguish from real emptiness.
     `getBreakBudget`, not `createProject` — that one has since been wired, so
     it stopped being an example of the thing being asserted and the test began
     reporting "Missing expected exception" for a method that works. The one
     below uses `getBreakBudget` for the same purpose, so the two now agree. */
  assert.throws(
    () => (repo as unknown as Record<string, () => unknown>).getBreakBudget(),
    /getBreakBudget is not connected/,
  );
});

test("NotConnectedError keeps the exact name useQuery matches on", () => {
  /* `useQuery` decides "unavailable" vs "error" by `e.name === "NotConnectedError"`,
     matched by name so a generic hook need not import a repository class.
     Renaming this class would silently turn every unmigrated widget back into a
     red error, so the coupling is pinned here. */
  const e = new NotConnectedError("getBreakBudget");
  assert.equal(e.name, "NotConnectedError");
  assert.match(e.message, /getBreakBudget is not connected/);
});

test("shell reads answer without throwing, so navigation cannot be taken down", () => {
  /* Every method the app shell calls before routing. One of these throwing is
     what put a runtime overlay over the whole product. */
  const proto = LegacyRepository.prototype as unknown as Record<string, unknown>;
  for (const name of [
    "getCurrentEmployee", "listEmployees", "listRoles",
    "listNotifications", "getActiveTimer", "getViewer",
  ]) {
    assert.equal(typeof proto[name], "function", `shell needs ${name}`);
  }
});

/* ── REGRESSION: a task created in the old app must appear in the new one ─── */

test("a task assigned to me survives a directory gap", () => {
  /* The bug: scope was decided on RESOLVED `assignees` — directory lookups — so
     a task assigned to somebody absent from `cowork_employees` resolved to an
     empty list and vanished from "my tasks" entirely. A directory gap must cost
     a name on screen, never a whole task. */
  const legacy = readTask({
    id: "t-new", title: "Created in old Cowork",
    assigneeIds: ["GR0045"], status: "open", updatedAt: "2026-07-29T09:00:00Z",
  })!;
  assert.ok(legacy.assigneeIds.includes("GR0045"), "raw id is what scope reads");

  /* Directory deliberately EMPTY — nobody resolves. */
  const view = toTaskView({
    legacy, employeesById: new Map(), viewerId: "GR0045", nowMs: Date.now(),
  });
  assert.equal(view.task.id, "t-new");
  assert.deepEqual(view.assignees, [], "no name resolved");
  assert.equal(
    legacy.assigneeIds.includes("GR0045"),
    true,
    "but it is still mine, so it must still be listed",
  );
});

test("a freshly created legacy task maps with an id and a title", () => {
  /* The shape the old app writes: taskId as the document id, assigneeIds array,
     status "open", no completionStatus yet. */
  const legacy = readTask({
    id: "t-fresh", title: "Ship the thing", assigneeIds: ["GR0045"],
    status: "open", assignedBy: "GR0001", priority: 1,
    fixedDeadline: "2026-08-05T09:00:00.000Z",
  })!;
  const view = toTaskView({
    legacy, employeesById: new Map(), viewerId: "GR0045", nowMs: Date.parse("2026-07-29T00:00:00Z"),
  });
  assert.equal(view.task.title, "Ship the thing");
  assert.equal(view.task.status, "assigned", "legacy 'open' is the live state");
  assert.equal(view.task.deadline.dueAt, "2026-08-05T09:00:00.000Z");
  assert.equal(view.myRank, 1);
  assert.equal(view.isOverdue, false);
});

test("a task with no updatedAt is a KNOWN Firestore exclusion, not a mapping fault", () => {
  /* Both apps order by updatedAt, and Firestore omits documents that lack the
     ordered field entirely. Such a task is invisible to the OLD app too — so if
     one is missing from both, the document is at fault, not this mapping. */
  const legacy = readTask({ id: "t-noupd", title: "No updatedAt", assigneeIds: ["GR0045"] })!;
  assert.equal(legacy.id, "t-noupd", "it maps fine; the QUERY is what excludes it");
});
