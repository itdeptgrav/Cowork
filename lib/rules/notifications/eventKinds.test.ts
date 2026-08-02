import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";

/**
 * Every event kind the app announces must exist on the engine.
 *
 * `#announce` is fire-and-forget by design — the write it describes is already
 * committed, so a failure is swallowed rather than shown. That is right for a
 * network error and terrible for a typo: `group_reanmed` would compile, ship,
 * return 400 into a `catch {}`, and the only symptom would be a notification
 * that never arrives. Nobody would look for it in this repository, because the
 * mistake is a string.
 *
 * So the two lists are compared directly. The backend lives outside this repo,
 * which is why this skips rather than fails when it is not checked out beside
 * us — a CI box with only this repository must not fail on a file it was never
 * given.
 */

const BACKEND =
  "D:/GRAV_Project/grav-cms-backend/routes/task_routes/coworkEvents.routes.js";

function kindsSent(): string[] {
  const src = readFileSync("lib/repositories/legacy/index.ts", "utf8");
  return [
    ...new Set([...src.matchAll(/#announce\(\s*"([a-z_]+)"/g)].map((m) => m[1])),
  ].sort();
}

function kindsHandled(): string[] {
  const src = readFileSync(BACKEND, "utf8");
  const block = /const EVENTS = \{([\s\S]*?)\n\};/.exec(src);
  assert.ok(block, "EVENTS map not found in coworkEvents.routes.js");
  return [...block[1].matchAll(/^ {2}([a-z_]+):\s*\{/gm)].map((m) => m[1]).sort();
}

test("every announced event kind is handled by the engine", (t) => {
  if (!existsSync(BACKEND)) {
    t.skip("grav-cms-backend is not checked out beside this repository");
    return;
  }
  const handled = kindsHandled();
  for (const kind of kindsSent()) {
    assert.ok(
      handled.includes(kind),
      `"${kind}" is announced but the engine has no case for it — it would 400 into a swallowed catch and the notification would simply never arrive`,
    );
  }
});

test("the engine handles nothing the app never sends", (t) => {
  if (!existsSync(BACKEND)) {
    t.skip("grav-cms-backend is not checked out beside this repository");
    return;
  }
  /* Not a correctness failure so much as a signal: an unreachable case is
     either a call site that was removed, or one that was never written. */
  const sent = kindsSent();
  const orphans = kindsHandled().filter((k) => !sent.includes(k));
  assert.deepEqual(
    orphans,
    [],
    `the engine handles ${orphans.join(", ")} but nothing announces it`,
  );
});

test("announcements never carry their own wording", () => {
  /* The safety property of the whole design: the client says WHAT happened and
     to which record, never who to tell or what to say. A `title` or `body` in
     an announce payload would mean the browser could put arbitrary text in
     somebody else's inbox, which is the reason this goes through the engine at
     all rather than being written straight to Firestore like the record it
     describes. */
  const src = readFileSync("lib/repositories/legacy/index.ts", "utf8");
  for (const call of src.matchAll(/#announce\("[a-z_]+",\s*\{([^}]*)\}/g)) {
    const payload = call[1];
    for (const forbidden of ["title:", "body:", "recipientIds:", "recipients:"]) {
      assert.ok(
        !payload.includes(forbidden),
        `an announce payload carries ${forbidden} — the engine composes the words, the client never supplies them`,
      );
    }
  }
});
