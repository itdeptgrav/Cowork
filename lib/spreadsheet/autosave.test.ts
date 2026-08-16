import assert from "node:assert/strict";
import { test, mock } from "node:test";
import { Autosaver } from "@/lib/spreadsheet/autosave";

/** Let the async save chain settle after a mocked timer fires. */
const settle = () => new Promise((r) => setImmediate(r));

test("a burst of changes debounces into ONE save of the last state", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  const saved: number[] = [];
  const auto = new Autosaver<{ n: number }>({
    delayMs: 1000,
    save: async (d) => {
      saved.push(d.n);
    },
  });

  auto.push({ n: 1 });
  auto.push({ n: 2 });
  auto.push({ n: 3 }); // each reschedules the single timer
  assert.deepEqual(saved, [], "nothing saved before the debounce elapses");

  mock.timers.tick(1000);
  await settle();
  assert.deepEqual(saved, [3], "one save, of the last state in the burst");
  mock.timers.reset();
});

test("an unchanged state is not saved (dedupe)", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  const save = mock.fn(async () => {});
  const auto = new Autosaver<{ n: number }>({ delayMs: 1000, save });

  auto.setBaseline({ n: 1 });
  assert.equal(auto.push({ n: 1 }), false, "push returns false when nothing changed");
  mock.timers.tick(1000);
  await settle();
  assert.equal(save.mock.callCount(), 0, "no save scheduled or run");
  mock.timers.reset();
});

test("flush saves immediately, cancelling the debounce", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  const saved: number[] = [];
  const auto = new Autosaver<{ n: number }>({
    delayMs: 1000,
    save: async (d) => {
      saved.push(d.n);
    },
  });
  auto.push({ n: 7 });
  await auto.flush();
  assert.deepEqual(saved, [7]);
  // The debounced timer must not fire a second save.
  mock.timers.tick(1000);
  await settle();
  assert.deepEqual(saved, [7], "flush cancelled the pending timer");
  mock.timers.reset();
});

test("a failed save reports the error and stays dirty for a retry", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  const errors: unknown[] = [];
  let failNext = true;
  const saved: number[] = [];
  const auto = new Autosaver<{ n: number }>({
    delayMs: 1000,
    save: async (d) => {
      if (failNext) throw new Error("network");
      saved.push(d.n);
    },
    onError: (e) => errors.push(e),
  });

  auto.push({ n: 1 });
  mock.timers.tick(1000);
  await settle();
  assert.equal(errors.length, 1, "the failure was reported");
  assert.deepEqual(saved, []);

  // The change is still dirty, so a flush retries it — and now succeeds.
  failNext = false;
  await auto.flush();
  assert.deepEqual(saved, [1], "the retry saved the still-pending change");
  mock.timers.reset();
});
