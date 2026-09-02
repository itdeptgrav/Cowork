import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { test } from "node:test";

/**
 * "Taskgoal" — a project may be marked as chasing a measurable objective.
 *
 * It is a DESCRIPTIVE label, built to the same standard as the Important tag on
 * a task: stored and displayed, reading nothing and deciding nothing. These
 * tests hold two things.
 *
 *  1. **The seams line up.** The tick on the form has to reach a stored field
 *     and come back out on the project's page, through the ordinary create
 *     path — no new route, no special casing.
 *
 *  2. **It never becomes the C2 goal task.** The product already has a scored
 *     Goal task (`isGoal` / `goalConfig` / a roadmap). This shares none of it,
 *     and the one thing that keeps them apart is that the Taskgoal code never
 *     names the C2 fields. That is asserted directly, because nothing mechanical
 *     else would catch the day someone "unified" them.
 */

const FORM = "components/features/projects/NewProjectForm.tsx";
const DETAIL = "components/features/projects/ProjectDetail.tsx";
const SLAB = "components/features/projects/ProjectSlab.tsx";
const RULE = "lib/rules/projects/goalBased.ts";
const LEGACY = "lib/repositories/legacy/index.ts";
const TASK_MAP = "lib/repositories/legacy/taskMap.ts";
const TYPES = "lib/repositories/types.ts";
const DOMAIN_PROJECT = "lib/domain/projects.ts";
const DOMAIN_TASK = "lib/domain/tasks.ts";

function code(path: string): string {
  return readFileSync(path, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[^\S\n]*\/\/.*$/gm, "");
}

/* ── The form asks, and does not insist ───────────────────────────────────── */

test("the form offers a Taskgoal tick", () => {
  const src = code(FORM);
  assert.match(src, /Mark as Taskgoal/, "no Taskgoal checkbox label");
  assert.match(src, /type="checkbox"/, "no checkbox on the form");
  assert.match(src, /setIsGoalBased/, "the tick is not wired to state");
});

test("the objective is the one required Taskgoal field", () => {
  /* `buildGoalBased` returns null without an objective, so an empty marker is
     never built — the whole design of the field. */
  assert.match(code(RULE), /const objective = trimmed\(input\.objective\);\s*if \(!objective\) return null;/);
});

test("the form builds the config with buildGoalBased and sends it only when marked", () => {
  const src = code(FORM);
  assert.match(src, /buildGoalBased\(\{/);
  /* Ticked-but-blank still sends nothing: `goalBased` is null unless the
     objective is there, and `isGoalBased` is derived from `goalBased != null`. */
  assert.match(src, /isGoalBased: goalBased != null,/);
  assert.match(src, /goalBased,/);
});

/* ── It fits any goal type, not only a numeric one ────────────────────────── */

test("the form offers a goal type, and defaults it to numeric", () => {
  const src = code(FORM);
  assert.match(src, /const \[goalType, setGoalType\] = useState\("numeric"\);/);
  assert.match(src, /<option value="milestone">/);
  assert.match(src, /<option value="qualitative">/);
  assert.match(src, /<option value="other">/);
});

test("the numeric fields show only for a numeric goal", () => {
  /* The whole point of the type selector: a qualitative goal is not asked for
     metric/unit/start/target. `numericGoal` gates that block. */
  const src = code(FORM);
  assert.match(src, /const numericGoal = goalType === "numeric";/);
  assert.match(src, /\{numericGoal && \(/, "the numeric block is not gated on the type");
});

test("every type is offered the fields that fit any goal", () => {
  /* Success criteria and current status carry a non-numeric goal, so they sit
     OUTSIDE the numeric-only block. */
  const src = code(FORM);
  assert.match(src, /setSuccessCriteria/);
  assert.match(src, /setCurrentStatus/);
});

test("the goal has no date of its own — the project deadline is the timeframe", () => {
  /* A second date field would duplicate the Deadline above it. The Taskgoal
     block carries no date; the project's own deadline is when it is due. */
  const src = code(FORM);
  assert.doesNotMatch(src, /goalTargetDate/, "the goal grew a redundant date field");
  assert.doesNotMatch(src, /Target date/, "a Target date field is back on the goal");
});

test("an unticked box is byte-for-byte the old create", () => {
  /* `goalBased` starts null (the box is off), so both fields are absent-shaped
     and the adapter sends nothing extra. */
  const src = code(FORM);
  assert.match(src, /const \[isGoalBased, setIsGoalBased\] = useState\(false\);/);
  assert.match(src, /const goalBased = isGoalBased\s*\?\s*buildGoalBased/);
});

/* ── The contract carries it ──────────────────────────────────────────────── */

test("CreateProjectInput declares the two optional fields", () => {
  const src = code(TYPES);
  assert.match(src, /isGoalBased\?: boolean;/);
  assert.match(src, /goalBased\?: GoalBasedConfig \| null;/);
});

test("the Project domain declares them, separate from the C2 goal task", () => {
  const src = code(DOMAIN_PROJECT);
  assert.match(src, /isGoalBased\?: boolean;/);
  assert.match(src, /goalBased\?: GoalBasedConfig \| null;/);
  assert.match(src, /export interface GoalBasedConfig \{/);
});

/* ── The adapter carries it through the ordinary path ─────────────────────── */

test("the create sends the marker into the task-create body, only when real", () => {
  const src = code(LEGACY);
  const at = src.indexOf("async createProject(input: CreateProjectInput)");
  assert.ok(at > 0, "createProject moved");
  const body = src.slice(at, at + 2600);
  /* Guarded on a real config, then spread into the SAME create body as
     everything else — no separate route. */
  assert.match(body, /input\?\.isGoalBased === true && input\?\.goalBased \? input\.goalBased : null/);
  assert.match(body, /\.\.\.\(goalBased \? \{ isGoalBased: true, goalBased \} : \{\}\)/);
});

test("the create echoes the marker back on the returned project", () => {
  /* So the project page shows the Taskgoal chip on its first render, before it
     refetches from the engine. */
  const src = code(LEGACY);
  const at = src.indexOf("async createProject(input: CreateProjectInput)");
  const body = src.slice(at, at + 4000);
  assert.match(body, /isGoalBased: goalBased != null,/);
});

/* ── The read path brings it back out ─────────────────────────────────────── */

test("taskMap reads and normalises the marker off the document", () => {
  const src = code(TASK_MAP);
  assert.match(src, /readGoalBased\(legacy\.goalBased\)/);
  assert.match(src, /goalBased: readGoalBased\(legacy\.goalBased\),/);
});

test("the project builder surfaces the marker from its folder task", () => {
  const src = code(LEGACY);
  const at = src.lastIndexOf("#projectFromContainer(");
  const body = src.slice(at, at + 3200);
  assert.match(body, /isGoalBased: t\.isGoalBased === true && !!t\.goalBased,/);
  assert.match(body, /goalBased: t\.goalBased \?\? null,/);
});

/* ── It is visible where projects are read ────────────────────────────────── */

test("the detail page shows a Taskgoal chip and the objective", () => {
  const src = code(DETAIL);
  assert.match(src, /<Chip title=\{p\.goalBased\.objective\}>Taskgoal<\/Chip>/);
  assert.match(src, /formatGoalTarget\(p\.goalBased\)/);
});

test("the detail page reads for any goal type, not only a number", () => {
  /* The goal type label, the success criteria and the current status all show,
     so a milestone or qualitative goal is not a bare objective on the page. */
  const src = code(DETAIL);
  assert.match(src, /GOAL_TYPE_LABEL\[p\.goalBased\.goalType\]/);
  assert.match(src, /p\.goalBased\.successCriteria/);
  assert.match(src, /p\.goalBased\.currentStatus/);
});

test("the project card shows the marker where projects are browsed", () => {
  assert.match(code(SLAB), /p\.isGoalBased && p\.goalBased && <SlabChip>Taskgoal<\/SlabChip>/);
});

/* ── The firewall: never the C2 goal task ─────────────────────────────────── */

test("the Taskgoal rule never touches the C2 goal fields", () => {
  /* The single guarantee that keeps the two concepts apart. `isGoal` and
     `goalConfig` are the scored Goal task; this file must not name them. The
     word "goal" appears in prose and in `goalBased`; these are the exact C2
     tokens, matched on a word boundary. */
  const src = code(RULE);
  assert.doesNotMatch(src, /\bisGoal\b/, "the Taskgoal rule referenced isGoal");
  assert.doesNotMatch(src, /\bgoalConfig\b/, "the Taskgoal rule referenced goalConfig");
  assert.doesNotMatch(src, /\bgoalStatement\b/);
  assert.doesNotMatch(src, /\bc2\w*/i, "the Taskgoal rule referenced C2 scoring");
});

test("the form never touches the C2 goal fields", () => {
  const src = code(FORM);
  assert.doesNotMatch(src, /\bisGoal\b/);
  assert.doesNotMatch(src, /\bgoalConfig\b/);
});

test("the marker rides its own Task field, distinct from isGoal", () => {
  /* On the base Task type the Taskgoal passthrough is `isGoalBased`/`goalBased`;
     the C2 goal task is not even on this type. If `isGoal`/`goalConfig` ever
     appear here, the two have been merged on the wrong shape. */
  const src = code(DOMAIN_TASK);
  assert.match(src, /isGoalBased\?: boolean;/);
  assert.match(src, /goalBased\?: GoalBasedConfig \| null;/);
});
