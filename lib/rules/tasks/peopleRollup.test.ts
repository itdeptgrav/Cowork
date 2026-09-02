import assert from "node:assert/strict";
import { test } from "node:test";
import { buildPeopleRollup } from "./peopleRollup.ts";
import type { TaskView } from "@/lib/repositories/types";
import type { Employee } from "@/lib/domain/identity";

/**
 * The Person-wise roll-up. It reads only `task.id`, `assignees` and
 * `pendingAssignees`, so the fixtures carry only those — everything else on a
 * TaskView is irrelevant to who-carries-what.
 */

const emp = (id: string, displayName: string): Employee =>
  ({ id, displayName }) as unknown as Employee;

const view = (
  id: string,
  assignees: Employee[],
  pendingAssignees: Employee[] = [],
): TaskView =>
  ({ task: { id }, assignees, pendingAssignees }) as unknown as TaskView;

const ann = emp("e1", "Ann");
const bob = emp("e2", "Bob");
const cal = emp("e3", "Cal");

test("each person gets a bucket carrying their tasks", () => {
  const roll = buildPeopleRollup([
    view("t1", [ann]),
    view("t2", [bob]),
    view("t3", [ann]),
  ]);
  const byId = new Map(roll.map((b) => [b.id, b]));
  assert.equal(byId.get("e1")?.tasks.length, 2);
  assert.equal(byId.get("e2")?.tasks.length, 1);
  assert.equal(byId.get("e1")?.name, "Ann");
});

test("a shared task counts under every person on it", () => {
  const roll = buildPeopleRollup([view("t1", [ann, bob])]);
  const byId = new Map(roll.map((b) => [b.id, b]));
  assert.equal(byId.get("e1")?.tasks.length, 1);
  assert.equal(byId.get("e2")?.tasks.length, 1);
});

test("pending assignees count, and a person named twice on one task counts once", () => {
  // Cal is both an accepted AND pending seat on t1 — still one task for Cal.
  const roll = buildPeopleRollup([view("t1", [cal], [cal]), view("t2", [], [cal])]);
  const calBucket = roll.find((b) => b.id === "e3");
  assert.equal(calBucket?.tasks.length, 2);
});

test("a task with nobody on it falls into a single Unassigned bucket, placed last", () => {
  const roll = buildPeopleRollup([
    view("t1", []),
    view("t2", [ann]),
    view("t3", []),
  ]);
  const last = roll[roll.length - 1];
  assert.equal(last.id, "");
  assert.equal(last.name, "Unassigned");
  assert.equal(last.person, null);
  assert.equal(last.tasks.length, 2);
});

test("the busiest person is first, ties broken by name", () => {
  const roll = buildPeopleRollup([
    view("t1", [bob]),
    view("t2", [ann]),
    view("t3", [ann]),
    view("t4", [cal]),
  ]);
  // Ann has 2, Bob and Cal have 1 each → Ann first, then Bob before Cal by name.
  assert.deepEqual(
    roll.filter((b) => b.id !== "").map((b) => b.name),
    ["Ann", "Bob", "Cal"],
  );
});

test("an empty list rolls up to nothing", () => {
  assert.deepEqual(buildPeopleRollup([]), []);
});
