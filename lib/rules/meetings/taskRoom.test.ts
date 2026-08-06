import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  MEETING_ROOM_PREFIX,
  isTaskParty,
  taskIdFromRoomName,
  taskJoinRefusal,
  taskMeetingRoomName,
} from "./taskRoom.ts";

/**
 * The bug these hold shut: `joinTaskMeeting` built `task-<id>`, the token route
 * requires `meet-`, and every Join meeting press returned "The meeting room
 * could not be joined." Two modules agreed with themselves and not with each
 * other, and nothing typed could notice — both sides are strings.
 *
 * So the route is READ, not restated. A test asserting `"meet-" === "meet-"`
 * would have passed throughout the outage.
 */

const ROUTE = "app/api/meetings/token/route.ts";
const route = readFileSync(ROUTE, "utf8");

/** The prefix the route actually enforces, taken from its source. */
function routePrefix(): string {
  const m = route.match(/const ROOM_PREFIX = "([^"]+)"/);
  assert.ok(
    m,
    `${ROUTE} no longer declares ROOM_PREFIX. If the room rule moved, move this ` +
      `test with it — do not delete it: the rule it guards is what keeps a ` +
      `meeting token out of a screen-monitoring room.`,
  );
  return m![1];
}

test("the prefix matches the one the token route enforces", () => {
  assert.equal(MEETING_ROOM_PREFIX, routePrefix());
});

test("a task room passes the route's own check", () => {
  const room = taskMeetingRoomName("task-9174");
  const prefix = routePrefix();

  /* Both halves of the route's condition, in its own terms. */
  assert.ok(room.startsWith(prefix));
  assert.ok(room.length > prefix.length);
});

test("the route still refuses the shape that caused the outage", () => {
  const prefix = routePrefix();
  assert.ok(
    !"task-9174".startsWith(prefix),
    "The old room name would now be accepted, which means the check that " +
      "separates meetings from screen monitoring has been loosened.",
  );
});

test("the room is stable for a task and distinct between tasks", () => {
  assert.equal(taskMeetingRoomName("t1"), taskMeetingRoomName("t1"));
  assert.notEqual(taskMeetingRoomName("t1"), taskMeetingRoomName("t2"));
});

test("a monitoring room cannot be reached by round-tripping", () => {
  assert.equal(taskIdFromRoomName("cowork-demo"), null);
  assert.equal(taskIdFromRoomName("meet-standup"), null);
  assert.equal(taskIdFromRoomName(taskMeetingRoomName("t7")), "t7");
});

test("both repositories build the room through this helper", () => {
  for (const file of [
    "lib/repositories/legacy/index.ts",
    "lib/repositories/mock/index.ts",
  ]) {
    const src = readFileSync(file, "utf8");
    assert.ok(
      src.includes("taskMeetingRoomName("),
      `${file} builds a meeting room name by hand. That is how the prefix ` +
        `drifted out of step with the route the first time.`,
    );
    assert.ok(
      !/`task-\$\{/.test(src.replace(/`task-\$\{taskId\}`\s*=>/g, "")),
      `${file} still contains a hand-built \`task-\${...}\` room name.`,
    );
  }
});

/* ── Who may enter ──────────────────────────────────────────────────────────
 *
 * The room name is derived from the task id, so it is guessable by anybody who
 * can see a task id. Membership is the only thing between an authenticated
 * employee and every task conversation in the organisation.
 */

const TASK = {
  createdById: "rakesh",
  assigneeIds: ["pramod"],
  pendingAssigneeIds: [] as string[],
};

test("both sides of the work may enter", () => {
  assert.equal(taskJoinRefusal(TASK, "rakesh"), null);
  assert.equal(taskJoinRefusal(TASK, "pramod"), null);
});

test("a self task is one person on both sides", () => {
  const self = { createdById: "pramod", assigneeIds: ["pramod"] };
  assert.equal(taskJoinRefusal(self, "pramod"), null);
});

test("SELF TASK: the approving manager may enter — the reported break", () => {
  /* The engine makes the assignee's primary manager the assigner OF RECORD on a
     self task, because nobody negotiates a budget with, sets the priority of, or
     reviews their own work. `createdById` is the assignee, so a rule reading it
     alone admitted exactly one person and told the manager "This meeting is for
     the people this task is between" — about a task they are the approver of.
     They ARE one of the people it is between; they are the only other one. */
  const selfTask = {
    createdById: "pramod",
    assignedById: "rakesh",
    assigneeIds: ["pramod"],
  };
  assert.equal(taskJoinRefusal(selfTask, "pramod"), null);
  assert.equal(
    taskJoinRefusal(selfTask, "rakesh"),
    null,
    "the manager the self task is assigned by was refused entry to it",
  );
  /* And it stays closed to everybody else. */
  assert.notEqual(taskJoinRefusal(selfTask, "a-colleague"), null);
});

test("an ordinary task is unchanged — creator and assigner are one person", () => {
  const ordinary = {
    createdById: "rakesh",
    assignedById: "rakesh",
    assigneeIds: ["pramod"],
  };
  assert.equal(taskJoinRefusal(ordinary, "rakesh"), null);
  assert.equal(taskJoinRefusal(ordinary, "pramod"), null);
  assert.notEqual(taskJoinRefusal(ordinary, "outsider"), null);
});

test("whoever must set the hours may join the meeting that settles them", () => {
  /* `pending_tl_hours`: the task names an approver who has to decide the budget.
     Holding the kickoff without them is holding it without the person who has to
     answer. */
  const awaitingHours = {
    createdById: "rakesh",
    assigneeIds: ["pramod"],
    approverIds: ["the-tl"],
  };
  assert.equal(taskJoinRefusal(awaitingHours, "the-tl"), null);
});

test("cross-department approvers may join the task they are gating", () => {
  const gated = {
    createdById: "rakesh",
    assigneeIds: [] as string[],
    pendingAssigneeIds: ["pramod"],
    approverIds: ["hod-sender", "hod-receiver"],
  };
  for (const id of ["rakesh", "pramod", "hod-sender", "hod-receiver"]) {
    assert.equal(taskJoinRefusal(gated, id), null, `${id} was refused`);
  }
  assert.notEqual(taskJoinRefusal(gated, "unrelated"), null);
});

test("a null or absent approver never admits anybody", () => {
  /* `approverId` is null on most tasks and arrives in the list as-is. A loose
     comparison would make "no approver" match a caller with no id. */
  const t = {
    createdById: "rakesh",
    assigneeIds: ["pramod"],
    approverIds: [null, undefined] as (string | null | undefined)[],
  };
  assert.notEqual(taskJoinRefusal(t, ""), null);
  assert.notEqual(taskJoinRefusal(t, "outsider"), null);
});

test("somebody else is refused, and told why", () => {
  assert.equal(
    taskJoinRefusal(TASK, "outsider"),
    "This meeting is for the people this task is between.",
  );
});

test("seeing a task is not being in the conversation about it", () => {
  /* The precedent is `joinRefusal` in ./access.ts: a manager who can SEE their
     report's meeting does not walk into it, and neither does an administrator.
     There is no seniority parameter here BECAUSE there is no seniority rule —
     if one is ever added, this test should be the thing that argues with it.

     Note what this does NOT contradict: the people admitted alongside the two
     sides are admitted because the TASK NAMES THEM as owing it a decision, not
     because of where they sit. A manager with nothing recorded against this task
     is still refused, however senior. */
  for (const senior of ["their-manager", "the-hod", "an-administrator"]) {
    assert.notEqual(
      taskJoinRefusal(TASK, senior),
      null,
      `${senior} was let into a task meeting they are not part of.`,
    );
  }
});

test("CROSS-DEPARTMENT: the pending assignee may enter their own kickoff", () => {
  /* The assignee is NOT in `assigneeIds` until the hours are agreed — and the
     meeting that agrees them is this one. Reading `assigneeIds` alone locks the
     one person the meeting is for out of it. */
  const gated = {
    createdById: "rakesh",
    assigneeIds: [] as string[],
    pendingAssigneeIds: ["pramod"],
  };
  assert.equal(taskJoinRefusal(gated, "pramod"), null);
  assert.equal(taskJoinRefusal(gated, "rakesh"), null);
  assert.notEqual(taskJoinRefusal(gated, "outsider"), null);
});

test("an empty or missing identity is never a party", () => {
  assert.notEqual(taskJoinRefusal(TASK, ""), null);
  assert.equal(isTaskParty({ createdById: null, assigneeIds: [] }, ""), false);
  /* A task with no creator recorded must not admit everyone by matching null. */
  assert.equal(
    isTaskParty({ createdById: null, assigneeIds: [] }, "anybody"),
    false,
  );
});

test("both repositories refuse before they ask for a token", () => {
  for (const file of [
    "lib/repositories/legacy/index.ts",
    "lib/repositories/mock/index.ts",
  ]) {
    const src = readFileSync(file, "utf8");
    const join = src.slice(src.indexOf("async joinTaskMeeting"));
    const body = join.slice(0, join.indexOf("async leaveTaskMeeting"));
    assert.ok(
      body.includes("taskJoinRefusal("),
      `${file} joins a task meeting without checking membership.`,
    );
    if (body.includes("/api/meetings/token")) {
      assert.ok(
        body.indexOf("taskJoinRefusal(") < body.indexOf("/api/meetings/token"),
        `${file} asks for a seat before it checks whether the caller may have ` +
          `one. A refusal should cost a read, not a minted token.`,
      );
    }
  }
});

test("the token route is called as it is declared", () => {
  const legacy = readFileSync("lib/repositories/legacy/index.ts", "utf8");
  const call = legacy.slice(legacy.indexOf("async joinTaskMeeting"));
  const body = call.slice(0, call.indexOf("\n  async leaveTaskMeeting"));

  assert.ok(
    /"\/api\/meetings\/token"/.test(body),
    "The token route is no longer called by that path.",
  );
  assert.ok(
    /method:\s*"POST"/.test(body),
    'The route exports POST only. A GET returns 405 and the join fails with a ' +
      "message that names nothing.",
  );
  assert.ok(
    !/\/api\/meetings\/token\?/.test(body),
    "The route reads `room` from the JSON body; a query string is ignored and " +
      "the room arrives empty.",
  );
  assert.ok(
    route.includes("export async function POST"),
    `${ROUTE} no longer exports POST — the caller above must change with it.`,
  );
  assert.ok(
    !/export async function GET/.test(route),
    `${ROUTE} grew a GET. Check the caller is asking for the one that is ` +
      "authenticated the way it expects.",
  );
});
