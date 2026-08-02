import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { notificationHref, notificationTarget } from "./target.ts";

/**
 * The service worker routes push clicks, and it cannot import this rule.
 *
 * `public/firebase-messaging-sw.js` is a static file with no bundler and no
 * module graph, so the type list and the id precedence exist twice. That is the
 * "two places stating one rule" CLAUDE.md warns about, and it cannot be removed
 * here — so it is pinned instead.
 *
 * What this catches: somebody adds a notification type with a destination,
 * updates `target.ts` because that is where the tests are, and ships a push
 * that opens the wrong page — or `/notifications` — for a type the in-app list
 * routes correctly. The two surfaces disagreeing is invisible without this,
 * because nothing in a normal test run ever opens the service worker.
 */

const SW = readFileSync("public/firebase-messaging-sw.js", "utf8");

/** Every type with a fixed destination, read out of the rule's own source. */
const TYPE_TARGET_SOURCE = readFileSync(
  "lib/rules/notifications/target.ts",
  "utf8",
);

function typesWithFixedDestination(): string[] {
  const block = /TYPE_TARGETS[^=]*=\s*\{([\s\S]*?)\n\};/.exec(TYPE_TARGET_SOURCE);
  assert.ok(block, "TYPE_TARGETS block not found in target.ts");
  return [...block[1].matchAll(/^\s*([a-z_0-9]+)\s*:/gm)].map((m) => m[1]);
}

test("every fixed-destination type the rule knows is handled by the worker", () => {
  for (const type of typesWithFixedDestination()) {
    assert.ok(
      SW.includes(`${type}:`),
      `${type} routes in target.ts but is missing from firebase-messaging-sw.js, so a push for it would open the wrong page`,
    );
  }
});

test("the worker sends those types to the same place the rule does", () => {
  for (const type of typesWithFixedDestination()) {
    const expected = notificationHref(notificationTarget(type, {}));
    assert.ok(expected, `${type} has no href in the rule`);
    const line = new RegExp(`${type}:\\s*'([^']+)'`).exec(SW);
    assert.ok(line, `${type} has no destination in the worker`);
    assert.equal(
      line[1],
      expected,
      `${type} opens ${line[1]} from a push but ${expected} in the app`,
    );
  }
});

test("the id fields are read in the same precedence on both sides", () => {
  /* `topTaskId` after `taskId`, `documentId` before `conversationId`: the
     order decides which id wins when a payload carries several, so the two
     lists agreeing on membership is not enough. */
  const swOrder = [...SW.matchAll(/\['([a-zA-Z]+)',\s*'\/[^']*'\]/g)].map(
    (m) => m[1],
  );
  const ruleOrder = [
    "taskId",
    "topTaskId",
    "meetId",
    "meetingId",
    "documentId",
    "conversationId",
    "groupId",
  ];
  assert.deepEqual(swOrder, ruleOrder);

  /* And the rule really does behave in that order — so the list above is
     checked against behaviour, not just against itself. */
  const both = notificationTarget("task_chat", { groupId: "G1", taskId: "T1" });
  assert.equal(both?.sourceId, "T1");
});

test("the worker never falls back to the old app's route", () => {
  /* `fcmPush.service.js` puts `url: "/coworking"` on every payload and sets
     `webpush.fcmOptions.link` to the same. That route does not exist here, so
     obeying either would 404 every push.

     Comments are stripped first. The worker EXPLAINS this rule in prose, and a
     check that could not tell an explanation from an instruction would forbid
     documenting the very thing it enforces. */
  const code = SW.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  assert.ok(
    !code.includes("/coworking"),
    "the worker routes to /coworking, which is the old app's route and 404s here",
  );
  assert.ok(
    !/data\.url|d\.url/.test(code),
    "the worker reads data.url, which the sender hard-codes to the old app's route",
  );
});
