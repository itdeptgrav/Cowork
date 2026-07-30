import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { readTask } from "./tasks.ts";

/**
 * Rework has to name what is wrong with the work.
 *
 * A reviewer could send a task back with prose alone, leaving the assignee to
 * infer which acceptance criterion had failed. The criteria are already on the
 * task, so the reviewer points at them instead.
 *
 * The rule is enforced in the ENGINE — the endpoint is reachable directly, and
 * a rule enforced in one client is not a rule.
 */

const BACKEND = "/Users/risheeray/Documents/cowork-old-backend";
const SERVICE = join(BACKEND, "services/taskForward.service.js");
const ROUTE = join(BACKEND, "routes/task_routes/taskForward.js");
const available = () => {
  try {
    return statSync(SERVICE).isFile();
  } catch {
    return false;
  }
};
const code = (p: string) =>
  readFileSync(p, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

function doc(over: Record<string, unknown> = {}) {
  return { id: "T634", taskId: "T634", title: "t", status: "open", ...over } as never;
}

/* ── The read path ────────────────────────────────────────────────────────── */

test("the criteria a reviewer marked failed are read back", () => {
  const t = readTask(
    doc({
      requirements: ["Match brand", "Add images", "Fix spacing"],
      completionRequirementsFailed: ["Add images", "Fix spacing"],
    }),
  );
  assert.deepEqual(t!.completionRequirementsFailed, ["Add images", "Fix spacing"]);
});

test("a task never sent back reports none, which is not the same as none named", () => {
  const t = readTask(doc({ requirements: ["Match brand"] }));
  assert.deepEqual(t!.completionRequirementsFailed, []);
});

test("malformed entries are dropped rather than shown as blanks", () => {
  const t = readTask(
    doc({ completionRequirementsFailed: ["real", "", "  ", null, 7] }),
  );
  assert.deepEqual(t!.completionRequirementsFailed, ["real"]);
});

/* ── The engine ───────────────────────────────────────────────────────────── */

test("rework with nothing selected is refused by the engine", (t) => {
  if (!available()) return t.skip("backend not present");
  const src = code(SERVICE);
  const fn = src.slice(src.indexOf("function validateReworkRequirements("));
  assert.match(fn.slice(0, 1600), /if \(valid\.length === 0\)/);
  assert.match(
    fn.slice(0, 1600),
    /Select at least one completion requirement that needs changes/,
  );
});

test("only criteria belonging to the task can be recorded", (t) => {
  if (!available()) return t.skip("backend not present");
  /* Otherwise a caller could write arbitrary text into a task's history under
     the reviewer's name. */
  const src = code(SERVICE);
  const fn = src.slice(src.indexOf("function validateReworkRequirements("));
  assert.match(fn.slice(0, 1600), /available\.includes\(r\)/);
});

test("a task with no criteria can still be sent back", (t) => {
  if (!available()) return t.skip("backend not present");
  /* Requiring a selection where there is nothing to select would strand the
     reviewer with no way to return the work at all. */
  const src = code(SERVICE);
  const fn = src.slice(src.indexOf("function validateReworkRequirements("));
  assert.match(fn.slice(0, 1600), /if \(available\.length === 0\) return \[\]/);
});

test("every rework path is guarded, not just the one the UI uses", (t) => {
  if (!available()) return t.skip("backend not present");
  /* Four branches send work back — TL review, CEO review, the standalone
     rework route and its service. Guarding one leaves three ways round it. */
  assert.equal(
    (code(SERVICE).match(/validateReworkRequirements\(task, reworkRequirements\)/g) ?? [])
      .length,
    4,
  );
});

test("the selection and its history are persisted", (t) => {
  if (!available()) return t.skip("backend not present");
  const src = code(SERVICE);
  assert.equal(
    (src.match(/completionRequirementsFailed: _reworkReqs/g) ?? []).length,
    4,
  );
  assert.match(src, /function reworkHistoryEntry\(/);
  /* Appended, never overwritten — a second rework must not erase the first. */
  const hist = src.slice(src.indexOf("function reworkHistoryEntry("));
  assert.match(hist.slice(0, 900), /\.\.\.\(Array\.isArray\(task\.reworkHistory\)/);
  assert.match(hist.slice(0, 900), /reviewerName,/);
  assert.match(hist.slice(0, 900), /requestedAt:/);
});

test("the routes forward the selection rather than dropping it", (t) => {
  if (!available()) return t.skip("backend not present");
  const route = code(ROUTE);
  /* The destructure now also takes the note and attachments, so this matches
     the field rather than its position at the end of the list. */
  assert.match(route, /reworkRequirements, reworkNote, reworkAttachments, reworkAttachmentIds \} = req\.body/);
  /* The forwarded expression now also carries the note and attachments, so the
     match is on the field rather than the whole literal. */
  assert.match(route, /reworkRequirements: reworkRequirements \|\| \[\]/);
  assert.match(route, /reworkNote: reworkNote \|\| ""/);
  assert.match(route, /reworkAttachments: reworkAttachments \|\| \[\]/);
});

test("approving sends no selection, so it cannot be refused for lacking one", () => {
  const repo = code("lib/repositories/legacy/index.ts");
  assert.match(repo, /reworkRequirements: approved \? \[\] : \(input\.reworkRequirements/);
});

test("the reviewer picks from the task's OWN criteria, not a new checklist", () => {
  const panel = code("components/features/tasks/ReviewPanel.tsx");
  assert.match(panel, /view\.completion\.requirements/);
  assert.match(panel, /r\.requirement\.text/);
});

test("the submit button refuses before the engine has to", () => {
  /* A round trip to be told to pick something is worse than not being able to
     press the button. */
  const panel = code("components/features/tasks/ReviewPanel.tsx");
  assert.match(
    panel,
    /decision === "rework" &&\s*requirements\.length > 0 &&\s*failed\.length === 0/,
  );
});

test("approve and reject are untouched by the requirement", () => {
  const panel = code("components/features/tasks/ReviewPanel.tsx");
  assert.match(panel, /decision === "rework" \? failed : \[\]/);
  /* The checklist renders only for rework. */
  assert.match(panel, /decision === "rework" && requirements\.length > 0/);
});

/* ── Correction notes and attachments ─────────────────────────────────────── */

test("the optional note is stored beside the required reason, not merged", (t) => {
  if (!available()) return t.skip("backend not present");
  /* They answer different questions — why the work came back, and what to do
     about it. Merging them would make the required one optional in practice. */
  const src = code(SERVICE);
  const fn = src.slice(src.indexOf("function reworkHistoryEntry("));
  assert.match(fn.slice(0, 1200), /reason: \(reason \|\| ""\)\.trim\(\)/);
  assert.match(fn.slice(0, 1200), /note: typeof note === "string" \? note\.trim\(\) : ""/);
});

test("attachments reuse the shape task chat already stores", (t) => {
  if (!available()) return t.skip("backend not present");
  /* Not a second document system: chat has always taken
     `{ url, name, type, downloadUrl }` for something already uploaded. */
  const src = code(SERVICE);
  const fn = src.slice(src.indexOf("function readReworkAttachments("));
  for (const field of ["url:", "name:", "type:", "downloadUrl:"]) {
    assert.ok(fn.slice(0, 1200).includes(field), `missing ${field}`);
  }
});

test("only those four fields survive, so nothing arbitrary enters the history", (t) => {
  if (!available()) return t.skip("backend not present");
  /* A rework record is permanent and carries a reviewer's name; a client must
     not be able to smuggle structure into it. */
  const src = code(SERVICE);
  const fn = src.slice(src.indexOf("function readReworkAttachments("));
  assert.match(fn.slice(0, 1200), /\.map\(\(f\) => \(\{/);
  assert.match(fn.slice(0, 1200), /typeof f\.url === "string"/);
  assert.match(fn.slice(0, 1200), /\.slice\(0, 10\)/);
});

test("an entry without a usable url is dropped rather than stored empty", (t) => {
  if (!available()) return t.skip("backend not present");
  const src = code(SERVICE);
  const fn = src.slice(src.indexOf("function readReworkAttachments("));
  assert.match(fn.slice(0, 1200), /\.filter\(\(f\) =>/);
});

test("every rework round appends, so earlier rounds survive", (t) => {
  if (!available()) return t.skip("backend not present");
  /* Rework #1's issues, note and files must still be readable after #2. */
  const src = code(SERVICE);
  const fn = src.slice(src.indexOf("function reworkHistoryEntry("));
  assert.match(fn.slice(0, 1200), /attempt: \(Array\.isArray\(task\.reworkHistory\)/);
  assert.match(fn.slice(0, 1200), /\.\.\.\(Array\.isArray\(task\.reworkHistory\) \? task\.reworkHistory : \[\]\)/);
});

test("the note is sent only with a rework", () => {
  /* An approval carries none, so it cannot be refused for lacking one. */
  const repo = code("lib/repositories/legacy/index.ts");
  assert.match(repo, /reworkNote: approved \? "" : \(input\.reworkNote/);
  const panel = code("components/features/tasks/ReviewPanel.tsx");
  assert.match(panel, /reworkNote: decision === "rework" \? correction : ""/);
});

test("the correction note is optional and does not gate the button", () => {
  /* Only the requirement selection is mandatory. */
  const panel = code("components/features/tasks/ReviewPanel.tsx");
  assert.equal(
    /correction\.trim\(\) === ""/.test(panel),
    false,
    "an optional field is blocking submission",
  );
  assert.match(panel, /failed\.length === 0/);
});
