import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import {
  creditedElsewhere,
  creditedToTask,
  totalCreditedToTask,
} from "./creditedToTask.ts";

/**
 * **Reported 17 Aug 2026, with real data.** T067 "CROSS DEPT 1" — Pramod
 * assigned it to Umung — listed three sessions under *"Time counted for your
 * deadline"*, totalling 00:07:05, on a task whose budget had gone from
 * 04:00:00 to 04:01:57. Two minutes of deadline, seven minutes of "counted".
 *
 * The engine was right throughout. Only the session where BOTH sides of the
 * work were present credited this task; the other two credited T063 and T066,
 * which are Pramod's own tasks and had nothing to do with Umung. The panel
 * printed each session's own `creditedSecs` and called it this task's.
 */

/** The three real sessions, exactly as stored. */
const withUmung = {
  creditedSecs: 117, // 01:57
  creditedTaskIds: ["T063", "T066", "T055", "T056", "T064", "T065", "T067"],
};
const withRakesh = { creditedSecs: 162, creditedTaskIds: ["T063", "T066"] }; // 02:42
const withRakeshAndRishee = {
  creditedSecs: 146, // 02:26
  creditedTaskIds: ["T063", "T066"],
};

test("only a session credited to this task shows a figure for it", () => {
  assert.equal(creditedToTask(withUmung as never, "T067"), 117);
  assert.equal(creditedToTask(withRakesh as never, "T067"), 0);
  assert.equal(creditedToTask(withRakeshAndRishee as never, "T067"), 0);
});

test("the same sessions still show their real figures on the tasks they DID credit", () => {
  /* Nothing is hidden — the time was earned, on somebody's task. */
  assert.equal(creditedToTask(withRakesh as never, "T063"), 162);
  assert.equal(creditedToTask(withRakeshAndRishee as never, "T066"), 146);
  assert.equal(creditedToTask(withUmung as never, "T055"), 117);
});

test("the total is the sum of the column, and matches the budget", () => {
  /**
   * The panel's own rule, which the old total broke: it must be the sum of the
   * figures beneath it. T067's budget moved 04:00:00 → 04:01:57, so the only
   * honest total is 117 seconds.
   */
  const sessions = [withUmung, withRakesh, withRakeshAndRishee] as never[];
  assert.equal(totalCreditedToTask(sessions, "T067"), 117);
  /* And the old behaviour, for contrast: 117 + 162 + 146 = 425 = 00:07:05. */
  assert.notEqual(totalCreditedToTask(sessions, "T067"), 425);
});

test("credited-elsewhere is distinct from credited-nowhere", () => {
  /**
   * Three states, and the screen must not collapse them. "Both sides were not
   * in the room together" said of a session two people plainly attended reads
   * as a defect in the product rather than a fact about this task.
   */
  assert.equal(creditedElsewhere(withRakesh as never, "T067"), true);
  assert.equal(creditedElsewhere(withUmung as never, "T067"), false, "it counted here");
  const nobody = { creditedSecs: 0, creditedTaskIds: [] };
  assert.equal(creditedElsewhere(nobody as never, "T067"), false, "it counted nowhere");
});

test("a malformed session is worth zero, not a crash", () => {
  assert.equal(
    creditedToTask({ creditedSecs: 90, creditedTaskIds: null } as never, "T067"),
    0,
  );
  assert.equal(
    creditedToTask({ creditedSecs: undefined, creditedTaskIds: ["T067"] } as never, "T067"),
    0,
  );
});

test("the panel asks per task, and no longer prints the raw figure", () => {
  /* The regression this exists to prevent: printing `creditedSecs` again puts
     somebody else's meeting on this task's record. */
  const src = readFileSync(
    "components/features/tasks/TaskMeetingPanel.tsx",
    "utf8",
  );
  assert.match(src, /creditedToTask\(s, taskId\)/);
  assert.match(src, /\{formatTimer\(creditedHere\(s\)\)\}/);
  assert.match(src, /n \+ creditedHere\(s\)/, "the total is not the sum of the column");
  assert.equal(
    /\{formatTimer\(s\.creditedSecs\)\}/.test(src),
    false,
    "a session's own figure is being shown as this task's again",
  );
});
