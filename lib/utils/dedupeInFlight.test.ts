import assert from "node:assert/strict";
import { test } from "node:test";
import { dedupeInFlight } from "./dedupeInFlight.ts";

/**
 * The bug this pins: "Create task" (and every other action built on
 * `useAction`) could fire its mutation twice from two clicks that both landed
 * before React had disabled the button. See the header comment in
 * `dedupeInFlight.ts` for why `disabled={isPending}` alone cannot close that
 * gap.
 */

/**
 * A controllable async function: counts every call, resolves on command with
 * whatever value the TEST chooses — not with the arguments it was called
 * with, which stand in for a form's current field values and are irrelevant
 * to what the mutation is judged to have returned.
 */
function deferredCounter<T>() {
  let calls = 0;
  const resolvers: Array<(v: T) => void> = [];
  const fn = (..._args: unknown[]) => {
    calls++;
    return new Promise<T>((resolve) => resolvers.push(resolve));
  };
  return {
    fn,
    calls: () => calls,
    resolveNext: (v: T) => resolvers.shift()?.(v),
    resolveAll: (v: T) => {
      while (resolvers.length) resolvers.shift()?.(v);
    },
  };
}

test("two calls before the first resolves run the underlying function once", async () => {
  const { fn, calls, resolveAll } = deferredCounter<string>();
  const wrapped = dedupeInFlight(fn);

  /* Both fired synchronously, exactly as two clicks landing in the same
     render frame would — nothing here awaits between them. */
  const a = wrapped("task-args");
  const b = wrapped("task-args");

  assert.equal(calls(), 1, "the mutation ran more than once from two calls");

  resolveAll("created");
  assert.equal(await a, "created");
  assert.equal(await b, "created");
});

test("the second caller gets the SAME result, not a fabricated refusal", async () => {
  /* Silently dropping the second click is not enough — its caller (a second
     button, a keyboard Enter racing a click) must still learn what happened,
     and it must be the true outcome of the one request that actually ran. */
  const { fn, resolveAll } = deferredCounter<{ id: string }>();
  const wrapped = dedupeInFlight(fn);

  const a = wrapped();
  const b = wrapped();
  resolveAll({ id: "task-42" });

  const [ra, rb] = await Promise.all([a, b]);
  assert.equal(ra, rb, "the two callers were given different results");
  assert.equal(ra.id, "task-42");
});

test("it unlocks the instant the in-flight call settles, success or not", async () => {
  const { fn, calls, resolveNext } = deferredCounter<string>();
  const wrapped = dedupeInFlight(fn);

  const first = wrapped();
  resolveNext("ok");
  await first;

  /* A second, GENUINE submission afterwards — creating a second task on
     purpose — must not be mistaken for a duplicate of the first. This is not a
     lock; it excludes only for the length of one request. */
  wrapped();
  assert.equal(calls(), 2, "a real second submission was refused");
});

test("a throw releases the guard exactly like a resolution does", async () => {
  let calls = 0;
  const wrapped = dedupeInFlight(async () => {
    calls++;
    throw new Error("network dropped");
  });

  await assert.rejects(wrapped());
  /* If the guard only cleared on success, one failed submission would lock the
     button forever — the one outcome worse than a duplicate. */
  await assert.rejects(wrapped());
  assert.equal(calls, 2);
});

test("calls with different arguments still coalesce while one is in flight", () => {
  /* The guard is per WRAPPED FUNCTION (per useAction instance, in the real
     caller), not per argument list — two clicks on one Create button always
     mean "submit the form as it now stands", never "these are two different
     requests that happen to overlap". */
  const { fn, calls, resolveAll } = deferredCounter<number>();
  const wrapped = dedupeInFlight(fn);

  wrapped(1);
  wrapped(2);
  wrapped(3);

  assert.equal(calls(), 1);
  resolveAll(0);
});

test("two independent actions never block each other", async () => {
  /* Two different buttons — Create task and, say, Cancel — are two separate
     `useAction` instances and therefore two separate wrapped functions. One
     being in flight must never stall the other. */
  const create = deferredCounter<string>();
  const cancel = deferredCounter<string>();
  const wrappedCreate = dedupeInFlight(create.fn);
  const wrappedCancel = dedupeInFlight(cancel.fn);

  const p1 = wrappedCreate();
  const p2 = wrappedCancel();

  assert.equal(create.calls(), 1);
  assert.equal(cancel.calls(), 1);

  create.resolveAll("created");
  cancel.resolveAll("cancelled");
  assert.equal(await p1, "created");
  assert.equal(await p2, "cancelled");
});
