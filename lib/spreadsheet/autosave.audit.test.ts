/**
 * Autosaver audit — debounce, dedupe, dirty tracking and failure handling under
 * adversarial sequencing (undo-to-baseline mid-debounce, mixed push/pushLazy,
 * slow saves overlapping the next burst).
 *
 * Assertions state CORRECT behaviour; failures are tagged `// BUG(...)`.
 */

import assert from "node:assert/strict";
import { test, mock } from "node:test";
import { Autosaver } from "@/lib/spreadsheet/autosave";

/** Let the async save chain settle after a mocked timer fires. */
const settle = () => new Promise((r) => setImmediate(r));

test("AUDIT: pushing back to the BASELINE state cancels the pending save", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const saved: string[] = [];
    const auto = new Autosaver<{ v: string }>({
      delayMs: 1000,
      save: async (d) => {
        saved.push(d.v);
      },
    });
    auto.setBaseline({ v: "S0" });
    auto.push({ v: "S1" }); // an edit schedules a save
    auto.push({ v: "S0" }); // …then undo returns the document to the saved state
    mock.timers.tick(1000);
    await settle();
    // BUG(autosave-1): push() returns false for baseline-equal data but leaves
    // the PREVIOUS pending payload and its timer armed, so the debounce fires
    // and persists S1 — a state the user has already undone. The store ends
    // newer than the document while the UI says "Saved".
    assert.deepEqual(saved, [], "no save may fire once the state has returned to the baseline");
  } finally {
    mock.timers.reset();
  }
});

test("AUDIT: a push AFTER a pushLazy saves the pushed (newest) data", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const saved: string[] = [];
    const auto = new Autosaver<{ v: string }>({
      delayMs: 1000,
      save: async (d) => {
        saved.push(d.v);
      },
    });
    auto.pushLazy(() => ({ v: "older-lazy" }));
    auto.push({ v: "newer-pushed" });
    mock.timers.tick(1000);
    await settle();
    // BUG(autosave-2): push() sets `pending` but never clears `producer`, and
    // run() lets a producer overwrite `pending` — so the OLDER lazy payload
    // wins over the newer pushed one, violating last-write-wins.
    assert.deepEqual(saved, ["newer-pushed"], "the most recent state in the burst is what saves");
  } finally {
    mock.timers.reset();
  }
});

test("AUDIT: a pushLazy after a push wins (last write), and the producer runs once", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const saved: string[] = [];
    let produced = 0;
    const auto = new Autosaver<{ v: string }>({
      delayMs: 1000,
      save: async (d) => {
        saved.push(d.v);
      },
    });
    auto.push({ v: "older-pushed" });
    auto.pushLazy(() => {
      produced++;
      return { v: "newer-lazy" };
    });
    mock.timers.tick(1000);
    await settle();
    assert.deepEqual(saved, ["newer-lazy"]);
    assert.equal(produced, 1, "the deferred payload is built exactly once, at fire time");
  } finally {
    mock.timers.reset();
  }
});

test("AUDIT: a burst of pushLazy calls costs ONE production and ONE save", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const saved: number[] = [];
    let produced = 0;
    const auto = new Autosaver<{ n: number }>({
      delayMs: 1000,
      save: async (d) => {
        saved.push(d.n);
      },
    });
    for (let i = 1; i <= 50; i++) {
      auto.pushLazy(() => {
        produced++;
        return { n: i };
      });
      mock.timers.tick(500); // each keystroke lands inside the debounce window
    }
    mock.timers.tick(1000);
    await settle();
    assert.equal(produced, 1, "serialization is deferred to the settled burst");
    assert.deepEqual(saved, [50], "one save, of the final state");
  } finally {
    mock.timers.reset();
  }
});

test("AUDIT: a lazy no-change burst reports onNoChange and saves nothing", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    let noChange = 0;
    const save = mock.fn(async () => {});
    const auto = new Autosaver<{ v: string }>({
      delayMs: 1000,
      save,
      onNoChange: () => {
        noChange++;
      },
    });
    auto.setBaseline({ v: "same" });
    auto.pushLazy(() => ({ v: "same" })); // e.g. undo back to the loaded state
    mock.timers.tick(1000);
    await settle();
    assert.equal(save.mock.callCount(), 0);
    assert.equal(noChange, 1, "the caller can settle its 'Saving…' chip");
  } finally {
    mock.timers.reset();
  }
});

test("AUDIT: setBaseline disarms whatever was pending", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const save = mock.fn(async () => {});
    const auto = new Autosaver<{ v: string }>({ delayMs: 1000, save });
    auto.push({ v: "draft edit" });
    auto.setBaseline({ v: "loaded" }); // a load lands over the top
    mock.timers.tick(1000);
    await settle();
    assert.equal(save.mock.callCount(), 0, "nothing pending survives a new baseline");
  } finally {
    mock.timers.reset();
  }
});

test("AUDIT: a failed lazy save stays dirty and a later flush retries it", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const errors: unknown[] = [];
    const saved: string[] = [];
    let fail = true;
    const auto = new Autosaver<{ v: string }>({
      delayMs: 1000,
      save: async (d) => {
        if (fail) throw new Error("offline");
        saved.push(d.v);
      },
      onError: (e) => errors.push(e),
    });
    auto.pushLazy(() => ({ v: "x" }));
    mock.timers.tick(1000);
    await settle();
    assert.equal(errors.length, 1);
    assert.deepEqual(saved, []);

    fail = false;
    await auto.flush();
    assert.deepEqual(saved, ["x"], "the failed payload is retried, not lost");
  } finally {
    mock.timers.reset();
  }
});

test("AUDIT: a save does not start while the previous save is still in flight", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    let active = 0;
    let maxActive = 0;
    const resolvers: (() => void)[] = [];
    const auto = new Autosaver<{ n: number }>({
      delayMs: 1000,
      save: async () => {
        active++;
        maxActive = Math.max(maxActive, active);
        await new Promise<void>((r) => resolvers.push(r));
        active--;
      },
    });
    auto.push({ n: 1 });
    mock.timers.tick(1000); // save(1) starts and hangs (slow network)
    await settle();
    auto.push({ n: 2 });
    mock.timers.tick(1000); // the next debounce elapses while save(1) is in flight
    await settle();
    // Release both so the test ends cleanly whatever the outcome.
    resolvers.splice(0).forEach((r) => r());
    await settle();
    // BUG(autosave-3): the Autosaver keeps no in-flight state, so the second
    // run() starts a second save while the first is unresolved. Through
    // useWorkbookPersistence both saves read the SAME baseRevision, so the
    // second is refused 409 and the user is shown "Edited in another place" by
    // their own tab; out-of-order completions can also leave lastSavedJson
    // stale. Saves must be serialized (or coalesced) against the one in flight.
    assert.equal(maxActive, 1, "saves must never overlap");
  } finally {
    mock.timers.reset();
  }
});

test("AUDIT: flush with nothing pending does not save and does not throw", async () => {
  const save = mock.fn(async () => {});
  const auto = new Autosaver<{ v: string }>({ delayMs: 1000, save });
  await auto.flush();
  assert.equal(save.mock.callCount(), 0);
});

test("AUDIT: cancel drops the pending burst entirely", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const save = mock.fn(async () => {});
    const auto = new Autosaver<{ v: string }>({ delayMs: 1000, save });
    auto.push({ v: "doomed" });
    auto.cancel();
    mock.timers.tick(1000);
    await settle();
    assert.equal(save.mock.callCount(), 0, "unmount means no late save at a dead id");
  } finally {
    mock.timers.reset();
  }
});
