import assert from "node:assert/strict";
import { test } from "node:test";
import { settledWithin } from "./writeTimeout.ts";

/**
 * The guard that stops a hung write killing the play/pause button.
 *
 * A Firestore write does NOT reject when the client is offline — it queues
 * locally and its promise stays pending until connectivity returns. `toggle`
 * released its re-entrancy guard in a `finally` and expired its optimistic flip
 * by comparing against the server, and both of those assume the promise settles.
 * When it did not, the button silently dropped every press for the rest of the
 * page's life while the display went on claiming "Paused" — with the top-bar
 * pill, which reads the server, still counting.
 */

test("a write that never settles resolves null rather than hanging", () => {
  /* The whole bug in one line: this promise is the offline Firestore write. */
  const never = new Promise<never>(() => {});
  return settledWithin(never, 10).then((r: unknown) => assert.equal(r, null));
});

test("a write that lands in time is passed straight through", async () => {
  assert.equal(await settledWithin(Promise.resolve("ok"), 1_000), "ok");
});

test("a rejection is still a rejection — it is not swallowed as a stall", async () => {
  /* A refusal and a stall need different handling: one puts the button back and
     shows the engine's reason, the other reverts to server truth. */
  await assert.rejects(
    () => settledWithin(Promise.reject(new Error("refused")), 1_000),
    /refused/,
  );
});

test("a slow write that beats the clock still wins", async () => {
  const slow = new Promise((resolve) => setTimeout(() => resolve("late"), 20));
  assert.equal(await settledWithin(slow, 500), "late");
});

test("the timer is cleared, so a settled write leaves nothing pending", async () => {
  /* Without the `finally`, every press would hold a 12-second timer alive and
     keep the event loop busy long after the write returned. */
  const before = process.getActiveResourcesInfo?.().length ?? 0;
  await settledWithin(Promise.resolve(1), 60_000);
  const after = process.getActiveResourcesInfo?.().length ?? 0;
  assert.ok(after <= before, `left ${after - before} handle(s) pending`);
});
