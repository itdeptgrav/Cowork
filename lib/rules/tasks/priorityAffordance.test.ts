import assert from "node:assert/strict";
import { test } from "node:test";
import { reorderableAssignees } from "./priorityAffordance.ts";
import type { Employee } from "../../domain/index.ts";

/**
 * Which subjects a viewer may be offered on a given task.
 *
 * Both halves of the rule have to hold together — the capability decides reach,
 * and "not your own" decides self. Testing them combined is the point: each
 * alone was already true before this change, and the bug they exist to prevent
 * is a control that appears and is then refused.
 */

function emp(id: string): Employee {
  return {
    organisationId: "org-test",
    id,
    isFounder: false,
    userId: `u-${id}`,
    employeeCode: id,
    firstName: id,
    lastName: "X",
    displayName: id,
    initials: "XX",
    hue: 0,
    email: null,
    departmentId: null,
    departmentName: null,
    designation: null,
    roleIds: [],
    timezone: "UTC",
    workCalendarId: "cal-standard",
    joinedAt: "2026-01-01",
    exitedAt: null,
  };
}

const TASK = [emp("rakesh"), emp("soumya")];

test("a managed employee is offered nobody, including themselves", () => {
  const out = reorderableAssignees({
    assignees: TASK,
    actorId: "soumya",
    actorHasManager: true,
    canReorder: (id) => id === "soumya", // `self` scope
  });
  assert.deepEqual(out, []);
});

test("a manager is offered their report but not themselves", () => {
  const out = reorderableAssignees({
    assignees: TASK,
    actorId: "rakesh",
    actorHasManager: true,
    canReorder: (id) => ["rakesh", "soumya"].includes(id), // direct_reports + self-reach
  });
  assert.deepEqual(out.map((e) => e.id), ["soumya"]);
});

test("an unmanaged administrator is offered everyone, themselves included", () => {
  const out = reorderableAssignees({
    assignees: TASK,
    actorId: "rakesh",
    actorHasManager: false,
    canReorder: () => true, // organisation scope
  });
  assert.deepEqual(out.map((e) => e.id), ["rakesh", "soumya"]);
});

test("the capability still bounds reach when there is no manager", () => {
  /* No manager lifts the self-restriction ONLY. It must not turn into reach
     over people the capability never granted. */
  const out = reorderableAssignees({
    assignees: TASK,
    actorId: "rakesh",
    actorHasManager: false,
    canReorder: (id) => id === "rakesh",
  });
  assert.deepEqual(out.map((e) => e.id), ["rakesh"]);
});

test("an unassigned task offers nobody", () => {
  assert.deepEqual(
    reorderableAssignees({
      assignees: [],
      actorId: "rakesh",
      actorHasManager: false,
      canReorder: () => true,
    }),
    [],
  );
});
