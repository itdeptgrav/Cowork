import assert from "node:assert/strict";
import { test } from "node:test";
import { uploadAll } from "./uploadAll.ts";

/**
 * The batch uploader that replaced two identical serial loops.
 *
 * What matters is not that it is faster in the abstract — it is that a person
 * attaching four files to a new task waits for the slowest of them rather than
 * for the sum of all four, and that everything the serial loop promised about
 * failures still holds exactly.
 */

const file = (name: string) => ({ name });

/** An upload that takes a tick, so overlap is observable. */
const settle = <T,>(value: T): Promise<T> =>
  new Promise((resolve) => setTimeout(() => resolve(value), 5));

test("nothing staged is no work at all", async () => {
  let calls = 0;
  const failed = await uploadAll([], async () => {
    calls++;
    return { ok: true };
  });
  assert.deepEqual(failed, []);
  assert.equal(calls, 0);
});

test("every file is sent, exactly once", async () => {
  const sent: string[] = [];
  const failed = await uploadAll(
    [file("a"), file("b"), file("c"), file("d"), file("e")],
    async (f) => {
      sent.push(f.name);
      return settle({ ok: true });
    },
  );
  assert.deepEqual(failed, []);
  assert.deepEqual(sent.slice().sort(), ["a", "b", "c", "d", "e"]);
});

test("they overlap — that is the whole point", async () => {
  /* The serial loop this replaced never had two in flight at once, so a
     concurrency of 1 would be the bug coming back silently. */
  let open = 0;
  let peak = 0;
  await uploadAll([file("a"), file("b"), file("c")], async () => {
    open++;
    peak = Math.max(peak, open);
    const r = await settle({ ok: true });
    open--;
    return r;
  });
  assert.ok(peak > 1, `only ${peak} upload was ever in flight`);
});

test("but not all at once — the pool is bounded", async () => {
  /* Attachments have no size cap here, so ten large files opening ten sockets
     is slower than the loop it replaced, not faster. */
  let open = 0;
  let peak = 0;
  await uploadAll(
    Array.from({ length: 9 }, (_, i) => file(`f${i}`)),
    async () => {
      open++;
      peak = Math.max(peak, open);
      const r = await settle({ ok: true });
      open--;
      return r;
    },
    3,
  );
  assert.equal(peak, 3);
});

test("failures come back in staging order, not finishing order", async () => {
  /* The message names them, and it has to read in the order they appear on
     screen. With a pool, completion order genuinely differs. */
  const delays: Record<string, number> = { a: 30, b: 1, c: 15 };
  const failed = await uploadAll(
    [file("a"), file("b"), file("c")],
    (f) =>
      new Promise((resolve) =>
        setTimeout(() => resolve({ ok: false }), delays[f.name]),
      ),
    3,
  );
  assert.deepEqual(failed, ["a", "b", "c"]);
});

test("only what actually failed is named", async () => {
  const failed = await uploadAll(
    [file("good"), file("bad"), file("also good")],
    async (f) => settle({ ok: f.name !== "bad" }),
  );
  assert.deepEqual(failed, ["bad"]);
});

test("a thrown upload is a failed upload, not a crash", async () => {
  /* A rejection and an `ok: false` mean the same thing to the reader: that
     file is not on the record. */
  const failed = await uploadAll([file("a"), file("boom"), file("c")], async (f) => {
    if (f.name === "boom") throw new Error("network");
    return settle({ ok: true });
  });
  assert.deepEqual(failed, ["boom"]);
});

test("one bad file does not strand the rest", async () => {
  /* The record already exists and the others belong on it. Stopping at the
     first failure would lose files that would have gone up fine. */
  const sent: string[] = [];
  const failed = await uploadAll(
    [file("boom"), file("b"), file("c"), file("d")],
    async (f) => {
      sent.push(f.name);
      if (f.name === "boom") throw new Error("network");
      return settle({ ok: true });
    },
    1,
  );
  assert.deepEqual(sent, ["boom", "b", "c", "d"]);
  assert.deepEqual(failed, ["boom"]);
});
