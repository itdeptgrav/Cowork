import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";

const form = readFileSync("components/features/tasks/NewTaskForm.tsx", "utf8");
const code = form.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\s+/g, " ");

test("a task inside a project is NOT treated as a subtask", () => {
  /**
   * OWNER DECISION, 18 Aug 2026. Both arrive with a parent id, but they are
   * different things: breaking work out of a task delegates one area of it and
   * claims one of its completion requirements; a task in a project is ordinary
   * work that merely lives in a folder.
   *
   * Getting this wrong put "Break out a subtask", "You stay responsible for
   * …" and a requirements picker in front of somebody who only wanted a task
   * in a folder — and on a folder there are no requirements to pick, so the
   * panel could only ever say there was nothing to choose.
   */
  assert.match(
    code,
    /const isSubtask = !!presetParentTaskId && parent\?\.task\.isFolder !== true;/,
  );
});

test("the subtask chrome is all behind that one flag", () => {
  for (const marker of [
    "Break out a subtask",
    "You stay responsible for",
    "Which completion requirements does this satisfy?",
  ]) {
    assert.ok(form.includes(marker), `${marker} is missing entirely`);
  }
  /* Each sits inside an `isSubtask` branch, so none can reach a project task. */
  assert.match(code, /\{isSubtask \? "Break out a subtask" : "New task"\}/);
  assert.match(code, /\{isSubtask && \( <p[^>]*> You stay responsible for/);
  assert.match(code, /\{isSubtask && \( <Panel> <h2[^>]*> Which completion requirements/);
});

test("the task still lands inside the project", () => {
  /* The plain `createTask` branch carries the parent, which is what puts the
     task in the folder and what the project's deadline is derived from. */
  assert.match(code, /parentTaskId: parentTaskId \|\| null,/);
});
