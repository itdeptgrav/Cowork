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

test("the worker unwraps both payload shapes", () => {
  /* Two senders, two shapes:
       FCM  (admin.messaging) → { notification: { title, body }, data }
       raw  (web-push, iOS)   → { title, body, data }
     Reading `payload.title` off an FCM envelope yields undefined. This handler
     is now the only thing rendering either, so it has to unwrap the nested
     form — getting it wrong shows a notification titled "Cowork" with an empty
     body, which is the "+1 notifications, no content" in the Windows tray. */
  const code = SW.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  assert.match(
    code,
    /payload\.notification \|\| payload/,
    "the push handler does not unwrap FCM's nested notification, so an FCM push would render with no title or body",
  );
});

test("the worker has no third-party dependency", () => {
  /* A service worker that fails to evaluate registers NO handlers — there is
     no partial success. Fetching the Firebase SDK from gstatic at the top of
     this file meant a blocked request (Edge tracking prevention, a proxy, an
     offline cold start) left the browser with a worker that handled nothing,
     silently. Displaying a push needs no SDK. */
  const code = SW.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  assert.ok(
    !/importScripts/.test(code),
    "the worker imports a remote script — if that fetch fails it registers no handlers at all",
  );
  /* Matched on USE, not on the word. The worker's own filename is
     `firebase-messaging-sw.js` and it compares `url.pathname` against it to
     avoid intercepting itself, so a bare `/firebase/` test flags correct
     code. */
  assert.ok(
    !/firebase\.\w|\bmessaging\.\w|firebase\.initializeApp/.test(code),
    "the worker still calls into the Firebase SDK",
  );
});

test("the worker never shows a notification with no title", () => {
  const code = SW.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  assert.match(
    code,
    /if \(!title\) return;/,
    "a missing title must suppress the notification — an empty one interrupts and says nothing",
  );
  assert.ok(
    !/title\s*=\s*payload\.title\s*\|\|\s*['"]Cowork['"]/.test(code),
    "the handler falls back to a constant title, which is how a contentless notification gets shown",
  );
});

test("a changed worker takes over instead of waiting for every tab to close", () => {
  /* Without these, a new worker installs and sits in `waiting` until every tab
     on the origin is CLOSED — reloading is not enough. The previous version
     keeps handling pushes, so a fix to this file appears to do nothing. That is
     what made the empty-notification fix look like it had not worked. */
  const code = SW.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  assert.match(code, /skipWaiting\(\)/, "the worker never calls skipWaiting, so changes to it do not take effect until every tab is closed");
  assert.match(code, /clients\.claim\(\)/, "the worker never claims open pages, so they stay on the previous version");
});
