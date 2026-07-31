import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { canModifySettings, SETTINGS_REFUSAL } from "../admin/access.ts";
import { applySettingsChange } from "./service.ts";
import { type AuditEntry, OFFICE_POLICY_CHANGED } from "./audit.ts";
import {
  AUDIT_SECTION,
  PROVISIONAL_RULES_CHANGED,
  SCORING_CHANGED,
  SETTINGS_SECTIONS,
  TASK_RULES_CHANGED,
  WORKFLOW_ROUTING_CHANGED,
} from "./sections.ts";
import {
  DEFAULT_TASK_RULES,
  readTaskRules,
  validateTaskRules,
  writeTaskRules,
  type TaskRules,
} from "./taskRules.ts";
import {
  DEFAULT_WORKFLOW_ROUTING,
  readWorkflowRouting,
  validateWorkflowRouting,
  writeWorkflowRouting,
  type WorkflowRouting,
} from "./workflowRouting.ts";
import {
  DEFAULT_SCORING_SETTINGS,
  readScoringSettings,
  validateScoringSettings,
  writeScoringSettings,
  type ScoringSettings,
} from "./scoringSettings.ts";
import {
  readRuleOverrides,
  validateRuleOverrides,
  writeRuleOverrides,
  type RuleOverrides,
} from "./ruleOverrides.ts";
import {
  readOfficePolicy,
  validateOfficePolicy,
  writeOfficePolicy,
  type OfficePolicy,
} from "../../legacy/officePolicy.ts";

/**
 * The admin settings console, end to end.
 *
 * Nine requirements, in order: who may open `/admin/settings` and who may not,
 * that the API refuses a non-admin mutation, that each section persists, and that
 * the audit log records both values.
 *
 * ## Why persistence is asserted against the fixture
 *
 * The production path writes Firestore, which a unit test cannot exercise. Both
 * paths call the same `applySettingsChange` in the same order — write, then log —
 * so what is asserted here is the shared rule rather than a re-implementation of
 * it. The parts that are specific to the legacy path (the archetype check, the
 * single `setDoc`, the MongoDB mirror) are asserted on its source in
 * `officeAudit.test.ts` and below.
 */

const code = (p: string) =>
  readFileSync(p, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

/* ── 1/2/3 · Who may open the console ─────────────────────────────────────── */

test("system_admin can access /admin/settings", () => {
  assert.equal(canModifySettings({ archetype: "system_admin" }), true);

  /* And the route's own gate is the one that decides, server-side, before the
     page ships. Asserted on the layout because a predicate returning true is
     worth nothing if no route asks it. */
  const layout = code("app/admin/settings/layout.tsx");
  assert.match(layout, /await adminConsoleAccess\(\)/);
  assert.match(layout, /if \(!mayModifySettings\) redirect/);
  assert.equal(layout.includes('"use client"'), false);
});

test("an employee cannot access /admin/settings", () => {
  assert.equal(canModifySettings({ archetype: "employee" }), false);
  /* The outer layout refuses first, so an employee never reaches the settings
     subtree at all. */
  assert.match(
    code("app/admin/layout.tsx"),
    /if \(!mayOpenConsole\) redirect\("\/home\?denied=admin"\)/,
  );
});

test("a manager cannot access /admin/settings", () => {
  assert.equal(canModifySettings({ archetype: "manager" }), false);
  /* Nor a skip-level manager, nor people-ops. Managers reach their reports
     through the reporting tree; administering the system is a different power and
     is granted separately. */
  for (const archetype of ["manager", "skip_level", "people_ops"] as const) {
    assert.equal(
      canModifySettings({ archetype }),
      false,
      `${archetype} may change settings`,
    );
  }
});

/* ── 4 · The API refuses a non-admin mutation ─────────────────────────────── */

test("the API rejects non-admin mutations", () => {
  const route = code("app/api/admin/settings/route.ts");

  /* The archetype is resolved SERVER-side, from the request, never read out of a
     header or a body a caller controls. */
  assert.match(route, /await adminConsoleAccess\(\)/);
  assert.doesNotMatch(route, /request\.headers\.get\("x-/);

  /* POST is the mutation surface, and it refuses before it does anything. */
  const post = route.slice(route.indexOf("export async function POST"));
  assert.match(post, /if \(!mayModifySettings\) \{/);
  assert.match(post, /message: SETTINGS_REFUSAL/);
  assert.match(post, /status: 403/);

  /* 401 and 403 stay distinct: nobody verifiable behind the request versus a
     verified person without the archetype. Collapsing them tells an ordinary
     employee to sign in again, which they cannot fix by doing. */
  assert.match(post, /status: 401/);

  /* And the refusal comes BEFORE the body is parsed, so a malformed payload from
     a non-admin still gets the permission answer rather than a 400 that implies
     a correct payload would have worked. */
  assert.ok(
    post.indexOf("mayModifySettings") < post.indexOf("request.json()"),
    "the API parses the body before checking permission",
  );

  /* An unrecognised section is refused too. The log is append-only, so a row
     filed under a section nothing reads cannot be corrected afterwards. */
  assert.match(post, /!\(section in AUDIT_SECTION\)/);
});

/* ── 5–8 · Every section persists, and every save is recorded ─────────────── */

/**
 * One in-memory settings store, driven through the real write path.
 *
 * **Not the mock repository.** That module imports through the `@/` alias, which
 * `node --test` does not resolve, so it cannot be loaded as a value here. That
 * turns out to be the better test anyway: this exercises `applySettingsChange`
 * with each section's OWN `read` / `validate` / `write` functions — the same three
 * the repository supplies — so a section whose document shape does not survive a
 * round trip fails here rather than in production.
 *
 * `document` starts as null, which is a workspace that has never opened the
 * console. `merge` mirrors Firestore's `setDoc(..., { merge: true })`.
 */
function store<T>(config: {
  read: (doc: Record<string, unknown> | null) => T;
  validate: (value: T) => string | null;
  write: (value: T, updatedBy: string) => Record<string, unknown>;
  section: string;
  type: string;
}) {
  let document: Record<string, unknown> | null = null;
  const log: AuditEntry[] = [];
  let nextId = 1;

  return {
    log,
    current: () => config.read(document),
    save: async (value: T, actor = "GR0000", reason?: string) => {
      const refusal = config.validate(value);
      if (refusal) return { ok: false as const, message: refusal };
      const result = await applySettingsChange<T>({
        section: config.section,
        type: config.type,
        changedById: actor,
        changedAt: "2026-07-30T09:00:00.000Z",
        before: config.read(document),
        after: value,
        reason: reason ?? null,
        newId: () => `sa_${nextId++}`,
        write: async (next) => {
          document = { ...(document ?? {}), ...config.write(next, actor) };
          return { ok: true };
        },
        log: async (entry) => {
          log.push(entry);
        },
      });
      return result.ok
        ? { ok: true as const, entry: result.entry }
        : { ok: false as const, message: result.error ?? "failed" };
    },
  };
}

const officeStore = () =>
  store<OfficePolicy>({
    read: readOfficePolicy,
    validate: validateOfficePolicy,
    write: writeOfficePolicy,
    section: AUDIT_SECTION["office-policy"],
    type: OFFICE_POLICY_CHANGED,
  });

test("office policy changes create audit entries", async () => {
  const office = officeStore();
  const before = office.current();

  const result = await office.save(
    {
      ...before,
      schedule: {
        ...before.schedule,
        monday: { ...before.schedule.monday, inTime: "10:00" },
      },
    },
    "GR0045",
  );
  assert.equal(result.ok, true, result.ok ? "" : result.message);
  assert.equal(office.log.length, 1);

  const entry = office.log[0];
  assert.equal(entry.section, AUDIT_SECTION["office-policy"]);
  assert.equal(entry.type, "OFFICE_POLICY_CHANGED");
  /* WHO — the employee id, never a display name. Names change and ids do not. */
  assert.equal(entry.changedById, "GR0045");
  /* WHEN. */
  assert.equal(entry.changedAt, "2026-07-30T09:00:00.000Z");
  /* And the consequence, STORED rather than derived at read time: the paths that
     feed the deadline chain can change, and a row must keep saying what it meant
     when it was written. */
  assert.equal(entry.affectsDeadlines, true);

  /* The value is in force. */
  assert.equal(office.current().schedule.monday.inTime, "10:00");
});

test("priority and scoring changes persist", async () => {
  const scoring = store<ScoringSettings>({
    read: readScoringSettings,
    validate: validateScoringSettings,
    write: (value, actor) => writeScoringSettings(value, actor, actor),
    section: AUDIT_SECTION["priority-scoring"],
    type: SCORING_CHANGED,
  });

  const before = scoring.current();
  /* The ENGINE's default, not ours. `c1Service.js` falls back to 0.5 while
     `PROVISIONAL_RULES` says 0.2 and legacy's own sync route says 0.2 again —
     three numbers for one rule, and only the first is the function that computes
     a score. Reading a default from the wrong one would show an administrator a
     figure the engine has never used. */
  assert.equal(before.c1DeadlineDeduction, 0.5);
  assert.equal(
    before.c1DeadlineDeduction,
    DEFAULT_SCORING_SETTINGS.c1DeadlineDeduction,
  );

  const result = await scoring.save({
    ...before,
    c1DeadlineDeduction: 0.35,
    timerSopEnabled: false,
  });
  assert.equal(result.ok, true, result.ok ? "" : result.message);

  const after = scoring.current();
  assert.equal(after.c1DeadlineDeduction, 0.35);
  /* The kill switch survives the round trip. An explicit `false` must not read
     back as the absent-field default, which is enabled — that would silently
     resume cutting points for everybody. */
  assert.equal(after.timerSopEnabled, false);

  assert.equal(scoring.log.length, 1);
  assert.equal(
    scoring.log[0].affectsDeadlines,
    false,
    "a scoring change must not claim to have moved deadlines",
  );
});

test("a zero deduction survives, because zero is how a rule is switched off", async () => {
  const scoring = store<ScoringSettings>({
    read: readScoringSettings,
    validate: validateScoringSettings,
    write: (value, actor) => writeScoringSettings(value, actor, actor),
    section: AUDIT_SECTION["priority-scoring"],
    type: SCORING_CHANGED,
  });
  await scoring.save({ ...scoring.current(), c1ExtensionDeduction: 0 });
  /* `Number(d.x) || fallback` — which is what legacy writes — would restore 0.2
     here and silently keep deducting for a rule an administrator turned off. */
  assert.equal(scoring.current().c1ExtensionDeduction, 0);
});

test("a deduction larger than the base score is refused", async () => {
  const scoring = store<ScoringSettings>({
    read: readScoringSettings,
    validate: validateScoringSettings,
    write: (value, actor) => writeScoringSettings(value, actor, actor),
    section: AUDIT_SECTION["priority-scoring"],
    type: SCORING_CHANGED,
  });
  const refused = await scoring.save({
    ...scoring.current(),
    c1BaseScore: 1,
    c1DeadlineDeduction: 2,
  });
  assert.equal(refused.ok, false);
  /* And a negative one, which would ADD points for the thing it penalises. */
  const negative = await scoring.save({
    ...scoring.current(),
    c1ReworkDeduction: -1,
  });
  assert.equal(negative.ok, false);
  assert.equal(scoring.log.length, 0);
});

test("workflow routing changes persist", async () => {
  const routing = store<WorkflowRouting>({
    read: readWorkflowRouting,
    validate: validateWorkflowRouting,
    write: writeWorkflowRouting,
    section: AUDIT_SECTION["workflow-routing"],
    type: WORKFLOW_ROUTING_CHANGED,
  });

  assert.deepEqual(routing.current(), DEFAULT_WORKFLOW_ROUTING);

  const result = await routing.save({
    ...routing.current(),
    budgetApproverWhenNoManager: "block",
    infeasibleBudget: "allow_override",
    stuckAfterHours: 24,
  });
  assert.equal(result.ok, true, result.ok ? "" : result.message);

  const after = routing.current();
  assert.equal(after.budgetApproverWhenNoManager, "block");
  assert.equal(after.infeasibleBudget, "allow_override");
  assert.equal(after.stuckAfterHours, 24);
  assert.equal(routing.log.length, 1);
});

test("a fallback approver nobody named is refused", async () => {
  const routing = store<WorkflowRouting>({
    read: readWorkflowRouting,
    validate: validateWorkflowRouting,
    write: writeWorkflowRouting,
    section: AUDIT_SECTION["workflow-routing"],
    type: WORKFLOW_ROUTING_CHANGED,
  });
  /* A request routed to nobody looks exactly like one waiting on somebody who
     will never answer, and only the first is fixable by an administrator. */
  const refused = await routing.save({
    ...routing.current(),
    budgetApproverWhenNoManager: "named_fallback",
    fallbackApproverId: null,
  });
  assert.equal(refused.ok, false);
  assert.match(
    refused.ok ? "" : refused.message,
    /Name a fallback approver/,
  );
  assert.equal(routing.log.length, 0);
});

test("task rules changes persist", async () => {
  const rules = store<TaskRules>({
    read: readTaskRules,
    validate: validateTaskRules,
    write: writeTaskRules,
    section: AUDIT_SECTION["task-rules"],
    type: TASK_RULES_CHANGED,
  });

  assert.deepEqual(rules.current(), DEFAULT_TASK_RULES);

  const result = await rules.save({
    ...rules.current(),
    timerBeforeSubmit: "require",
    submissionNote: "required",
    proposalExpiryHours: 0,
  });
  assert.equal(result.ok, true, result.ok ? "" : result.message);

  const after = rules.current();
  assert.equal(after.timerBeforeSubmit, "require");
  assert.equal(after.submissionNote, "required");
  /* Zero means "never lapses" and has to survive as zero, not fall back to 48. */
  assert.equal(after.proposalExpiryHours, 0);
  assert.equal(rules.log.length, 1);
});

test("provisional rules persist", async () => {
  const overrides = store<RuleOverrides>({
    read: readRuleOverrides,
    validate: validateRuleOverrides,
    write: writeRuleOverrides,
    section: AUDIT_SECTION["provisional-rules"],
    type: PROVISIONAL_RULES_CHANGED,
  });

  assert.deepEqual(overrides.current(), {});

  const result = await overrides.save({ deadlineMissDeduction: 0.45 });
  assert.equal(result.ok, true, result.ok ? "" : result.message);

  const after = overrides.current();
  assert.equal(after.deadlineMissDeduction, 0.45);
  /* An unpublished rule stays ABSENT rather than being written back at its
     placeholder value. "An administrator chose 0.2" and "nobody has decided, and
     the placeholder is 0.2" are different facts, and the Resolved badge is how a
     reader tells them apart. */
  assert.equal("rejectionDeduction" in after, false);
  assert.equal(overrides.log.length, 1);
});

test("an override of the wrong type, or an unknown rule, is refused", async () => {
  const overrides = store<RuleOverrides>({
    read: readRuleOverrides,
    validate: validateRuleOverrides,
    write: writeRuleOverrides,
    section: AUDIT_SECTION["provisional-rules"],
    type: PROVISIONAL_RULES_CHANGED,
  });
  /* `ruleValue` throws on an unknown key — deliberately, because a typo silently
     scoring everybody at zero is the bug that layer exists to prevent. Refusing
     here means the throw never happens inside a score calculation. */
  const unknown = await overrides.save({ notARule: 1 } as RuleOverrides);
  assert.equal(unknown.ok, false);
  /* And an enumerated rule only accepts its own listed values. */
  const wrong = await overrides.save({ cancellationTreatment: "maybe" });
  assert.equal(wrong.ok, false);
  assert.equal(overrides.log.length, 0);
});

test("a failed write records nothing", async () => {
  /* The order is fixed: write first, log second. The reverse would record changes
     that then failed to save, and a log claiming a change nobody can see is worse
     than a missing entry because somebody would trust it. */
  const log: AuditEntry[] = [];
  const result = await applySettingsChange<{ a: number }>({
    section: "office",
    type: OFFICE_POLICY_CHANGED,
    changedById: "GR0000",
    changedAt: "2026-07-30T09:00:00.000Z",
    before: { a: 1 },
    after: { a: 2 },
    newId: () => "sa_1",
    write: async () => ({ ok: false, message: "Firestore refused it." }),
    log: async (entry) => {
      log.push(entry);
    },
  });
  assert.equal(result.ok, false);
  assert.equal(log.length, 0);
});

test("a landed write with a failed log is reported, not swallowed", async () => {
  /* A change with no record is the thing this module exists to prevent, so
     somebody has to be told it happened. */
  let written = false;
  const result = await applySettingsChange<{ a: number }>({
    section: "office",
    type: OFFICE_POLICY_CHANGED,
    changedById: "GR0000",
    changedAt: "2026-07-30T09:00:00.000Z",
    before: { a: 1 },
    after: { a: 2 },
    newId: () => "sa_1",
    write: async () => {
      written = true;
      return { ok: true };
    },
    log: async () => {
      throw new Error("the audit collection refused it");
    },
  });
  assert.equal(written, true);
  assert.equal(result.ok, true);
  assert.equal(result.unlogged, true);
  assert.equal(result.entry, null);
});

test("saving without editing records nothing", async () => {
  const office = officeStore();
  const result = await office.save(office.current());
  /* Not an error, and not a row. Pressing Save without editing is ordinary, and a
     log full of "changed nothing" is a log nobody reads. */
  assert.equal(result.ok, true);
  assert.equal(office.log.length, 0);
});

/* ── 9 · The record shows both values ─────────────────────────────────────── */

test("audit entries carry the old AND new value for every changed field", async () => {
  const office = officeStore();
  const before = office.current();

  await office.save({
    ...before,
    schedule: {
      ...before.schedule,
      tuesday: { ...before.schedule.tuesday, outTime: "19:15" },
    },
    maxTaskActionGapMinutes: 90,
  });

  const entry = office.log[0];
  assert.ok(entry);

  const paths = entry.fields.map((f) => f.path);
  /* Dotted LEAF paths, not whole documents. Recording the entire policy on every
     save makes "who changed Tuesday's closing time" a diffing exercise for
     whoever reads the log. */
  assert.ok(
    paths.includes("schedule.tuesday.outTime"),
    `dotted leaf paths expected, got ${paths.join(", ")}`,
  );
  assert.ok(paths.includes("maxTaskActionGapMinutes"));

  const day = entry.fields.find((f) => f.path === "schedule.tuesday.outTime");
  assert.ok(day);
  assert.equal(day.oldValue, before.schedule.tuesday.outTime);
  assert.equal(day.newValue, "19:15");

  const gap = entry.fields.find((f) => f.path === "maxTaskActionGapMinutes");
  assert.ok(gap);
  assert.equal(gap.oldValue, before.maxTaskActionGapMinutes);
  assert.equal(gap.newValue, 90);
});

test("the reason a person typed is carried onto the record", async () => {
  const office = officeStore();
  const before = office.current();
  await office.save(
    { ...before, maxBreakMinutesPerDay: 45 },
    "GR0000",
    "Board approved the revised allowance",
  );
  assert.equal(office.log[0].reason, "Board approved the revised allowance");
});

test("the repository refuses a non-admin write, below any route", () => {
  /* Asserted on the source because the check lives in the private shared writer,
     which a test cannot call directly — and that is the point: it is private so
     that no section can be added without it. */
  const repo = code("lib/repositories/legacy/index.ts");
  const at = repo.indexOf("async #writeSettingsSection<T>(");
  assert.ok(at > 0, "#writeSettingsSection not found");
  const writer = repo.slice(at, repo.indexOf("async setOfficePolicy(", at));
  assert.match(
    writer,
    /if \(!maySettings\(\{ archetype: this\.#ctx\.archetype \?\? null \}\)\) \{/,
  );
  assert.match(writer, /message: SETTINGS_REFUSAL/);
  /* Validation comes FIRST, so a refusal for invalid input does not read like a
     security answer. */
  assert.ok(
    writer.indexOf("input.refusal") < writer.indexOf("maySettings"),
    "the permission check runs before validation",
  );
  assert.ok(SETTINGS_REFUSAL.length > 0);
});

test("the scoring write mirrors into MongoDB, or reports that it did not", () => {
  /* `BandConfig.globalSettings.c1.*` is a second copy of these numbers, read by
     band resolution, while the engine's `getC1Config` reads the Firestore copy.
     Writing one and not the other leaves a score computed from one figure and
     explained from another with nothing reporting it. */
  const repo = code("lib/repositories/legacy/index.ts");
  const at = repo.indexOf("async setScoringSettings(");
  assert.ok(at > 0);
  const body = repo.slice(at, repo.indexOf("async getRuleOverrides(", at));
  assert.match(body, /mirror: async \(value\) => \{/);
  assert.match(body, /"\/cowork\/sop\/settings\/sync"/);
  assert.match(body, /scoringSyncBody\(value\)/);
  assert.match(body, /if \(!result\.ok\) throw new Error/);

  /* And a mirror failure is surfaced rather than swallowed. */
  const writer = repo.slice(
    repo.indexOf("async #writeSettingsSection<T>("),
    repo.indexOf("async setOfficePolicy("),
  );
  assert.match(writer, /if \(mirrorFailed\) \{/);
  assert.match(writer, /The two now disagree/);
});

/* ── The settings the product actually reads ──────────────────────────────── */

test("the routing settings reach the request that uses them", () => {
  /* A persisted value nothing reads is the fake state this work exists to
     remove. `budgetApproverId` and `mayApproveBudget` were exported from
     `extensionRouting.ts` and called from NOWHERE in the product — the
     repository resolved the approver inline with `?? null`. */
  const repo = code("lib/repositories/legacy/index.ts");
  assert.match(repo, /routedBudgetApproverId\(\{/);
  assert.match(repo, /routedDeadlineApproverId\(\{/);
  /* And a request with nobody to decide it is refused by name rather than
     created with a null approver, which on screen is indistinguishable from
     waiting on somebody who will never answer. */
  assert.match(repo, /routingRefusal\(\{ routing, primaryManagerId, assigneeId: me \}\)/);
});

test("the task rules reach the submission they gate", () => {
  const repo = code("lib/repositories/legacy/index.ts");
  const submit = repo.slice(
    repo.indexOf("async submitCompletion("),
    repo.indexOf("async reviewSubmission("),
  );
  assert.match(submit, /await this\.getTaskRules\(\)/);
  assert.match(submit, /submissionRefusal\(\{/);
  assert.match(submit, /code: "validation_failed", message: refusal/);

  /* The gate reads the DERIVED completion state off the view rather than
     recomputing it, so the detail page and this cannot disagree about whether a
     task may be submitted. */
  assert.match(submit, /view\?\.completion\.outstanding/);

  /* And the extra read happens only when a rule needs it, so the defaults add no
     request to a path every submission takes. */
  assert.match(submit, /const needsView =/);
});

test("defaults change nothing, which is what makes them safe to ship", () => {
  /* Every default reproduces today's behaviour. A default that differed by one
     field would turn the existing rule tests into assertions about a document
     nobody wrote.

     Exception, deliberately: acceptance criteria default to `off` — reference
     for the reviewer, never a checklist that gates submission. They are ticked
     nowhere in the submit flow and only read (for rework) in `ReviewPanel`. An
     org may still opt into `block`/`warn`. */
  assert.equal(DEFAULT_TASK_RULES.requirementsBeforeSubmit, "off");
  assert.equal(DEFAULT_TASK_RULES.timerBeforeSubmit, "allow");
  assert.equal(DEFAULT_TASK_RULES.submissionNote, "optional");
  assert.equal(DEFAULT_TASK_RULES.afterRejection, "allow_resubmit");
  /* Deliberately NOT "self": a person cannot approve their own extension, so
     when no manager is on file the request is refused, not routed back to the
     requester (who would otherwise see the "accept" over their own ask). */
  assert.equal(DEFAULT_WORKFLOW_ROUTING.budgetApproverWhenNoManager, "block");
  assert.equal(DEFAULT_WORKFLOW_ROUTING.deadlineApproverWhenNoAssignor, "block");
  assert.equal(DEFAULT_WORKFLOW_ROUTING.infeasibleBudget, "escalate");
  assert.equal(DEFAULT_WORKFLOW_ROUTING.stuckAfterHours, 0);
  /* An absent document reads as the defaults, so a workspace that has never
     opened the console behaves exactly as it did before it existed. */
  assert.deepEqual(readRuleOverrides(null), {});
});

test("every section names a store and an enforcement class", () => {
  /* The fact an administrator cannot get from a form: who reads this value once
     it is saved. A section without it would present a value the Express engine
     computes scores from and a value only this UI enforces at the same weight. */
  for (const section of SETTINGS_SECTIONS) {
    assert.ok(section.store.length > 0, `${section.id} names no store`);
    assert.ok(
      ["both", "engine", "cowork_ui"].includes(section.enforcement),
      `${section.id} has no enforcement class`,
    );
    assert.ok(section.summary.length > 0, `${section.id} has no summary`);
  }
  /* Exactly one section reaches the scoring engine, and it is the one whose
     values `getC1Config` reads. */
  const engine = SETTINGS_SECTIONS.filter((s) => s.enforcement === "engine");
  assert.deepEqual(engine.map((s) => s.id), ["priority-scoring"]);
  assert.match(engine[0].store, /cowork_sop_settings\/task_events/);
});
