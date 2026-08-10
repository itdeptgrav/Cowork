import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { test, beforeEach } from "node:test";
import {
  HEARTBEAT_INTERVAL_MS,
  PRESENCE_STALE_AFTER_MS,
  dutyTransition,
  heartbeatPatch,
  ownsClaim,
  readDutyMode,
  readDutySnapshot,
  type DutyDocument,
} from "./duty.ts";
import {
  applyRemotePresence,
  getSnapshot,
  goOffline,
  reportShare,
  resetStatus,
  startBreak,
} from "../../status/employeeStatus.ts";

/** A live, entire-screen track — the only thing that makes anybody online. */
const SHARING = {
  sharing: true,
  connected: true,
  surface: "entire_screen" as const,
  detail: "Sharing your entire screen.",
};

/**
 * **Online stays online until the person says otherwise — OWNER DECISION.**
 *
 * Reported as "it automatically goes offline", and it did, by two separate
 * routes that both needed nobody to do anything:
 *
 *  1. **The reload.** The store re-initialises with no manual state. The first
 *     snapshot after a reload carries `onlineElsewhere: true`, because the claim
 *     is stamped with the OLD tab's connection id, so the pill was green. Then
 *     the heartbeat adopted the quiet claim and re-stamped it with THIS tab's
 *     id — and the next snapshot was `online` with `onlineElsewhere: false`,
 *     which meant no manual state and no remote claim either. That derives to
 *     offline. The pill went grey and `DutySync` published it.
 *  2. **The staleness window.** A heartbeat quiet for ten minutes resolved to
 *     offline for everybody. Backgrounded tabs have clamped timers, laptops
 *     sleep, writes get refused for a minute — all of which look exactly like
 *     going home from here.
 *
 * These fail if either route is reopened.
 */

const NOW = 1_760_000_000_000;

const account = (over: Partial<Parameters<typeof applyRemotePresence>[0]> = {}) =>
  applyRemotePresence({
    mode: "online",
    breakStartedAtMs: null,
    emergencyStartedAtMs: null,
    onlineElsewhere: false,
    ...over,
  });

beforeEach(() => resetStatus());

/* ── The reload ───────────────────────────────────────────────────────────── */

test("a reload, then this tab taking its own claim back, stays online", () => {
  /* The exact sequence, in the order the two snapshots actually arrive. */
  account({ onlineElsewhere: true }); // claim still stamped with the old tab
  assert.equal(getSnapshot().status, "online");

  account({ onlineElsewhere: false }); // the heartbeat adopted it: now it is ours
  assert.equal(
    getSnapshot().status,
    "online",
    "the pill went grey on a page reload, and then published that offline",
  );
});

test("a device that pressed nothing follows the account", () => {
  /* A phone opened while the laptop is online. Presence describes a person, and
     `mode: "online"` in their document IS that person saying they are online. */
  account({ onlineElsewhere: true });
  assert.equal(getSnapshot().status, "online");
});

test("the account's own word survives every echo of it", () => {
  /* The subscription fires on every snapshot, not once. */
  for (let i = 0; i < 5; i += 1) account({ onlineElsewhere: i % 2 === 0 });
  assert.equal(getSnapshot().status, "online");
});

test("a sharing device needs no manual flag, and does not get one", () => {
  /* The track says online on its own; a manual flag would outlive it. */
  reportShare(SHARING);
  account({ onlineElsewhere: false });
  assert.equal(getSnapshot().status, "online");
  assert.equal(getSnapshot().manual, null);
});

test("something known counts as knowing the status", () => {
  /* `hydrated` gates the publish so no device announces its initial `offline`
     guess. A subscription that never delivers would otherwise leave this device
     unable to publish anything — including a live share in front of us, or a
     choice the person just made. */
  assert.equal(getSnapshot().hydrated, false, "a fresh store knows nothing");
  reportShare(SHARING);
  assert.equal(getSnapshot().hydrated, true, "a live track settles nothing");
  for (const act of [startBreak, goOffline]) {
    resetStatus();
    act();
    assert.equal(getSnapshot().hydrated, true, `${act.name} did not settle it`);
  }
});

test("the person choosing Offline is still the person choosing Offline", () => {
  reportShare(SHARING);
  assert.equal(getSnapshot().status, "online");
  goOffline();
  assert.equal(getSnapshot().status, "offline");
  /* And the account agreeing does not put them back. */
  account({ mode: "offline" });
  assert.equal(getSnapshot().status, "offline");
});

test("a break, once the account carries it, holds on every device", () => {
  /* The account is what every device follows, so a break reaches them all
     through the same door an online claim does. In the moment between pressing
     Break here and that write landing, a snapshot still saying `online` reads as
     online — unchanged from before this fix, and corrected by the person's own
     write a moment later rather than left to drift. */
  startBreak();
  account({ mode: "break", breakStartedAtMs: NOW - 60_000 });
  assert.equal(getSnapshot().status, "break");
  assert.equal(getSnapshot().breakStartedAt, NOW - 60_000);
});

/* ── The window ───────────────────────────────────────────────────────────── */

test("no length of silence turns an online claim offline", () => {
  const quiet: DutyDocument = {
    mode: "online",
    heartbeatAt: NOW - PRESENCE_STALE_AFTER_MS * 50,
    presenceConnectionId: "a-tab-that-is-long-gone",
  };
  assert.equal(readDutyMode(quiet, NOW), "online");
  assert.equal(readDutySnapshot(quiet, NOW).mode, "online");
});

test("a quiet claim is still adoptable, which is a different question", () => {
  /* What lets a reloaded tab take its own claim back rather than two tabs
     writing over each other. It changes who may WRITE, never what is read. */
  const quiet: DutyDocument = {
    mode: "online",
    heartbeatAt: NOW - 3 * HEARTBEAT_INTERVAL_MS,
    presenceConnectionId: "the-tab-before-the-reload",
  };
  assert.equal(ownsClaim(quiet, "this-tab", NOW), true);
  assert.equal(
    ownsClaim({ ...quiet, heartbeatAt: NOW }, "this-tab", NOW),
    false,
    "a live tab's claim is still not takeable",
  );
});

/* ── The whole sequence, through the real rules ───────────────────────────── */

test("go online, reload, adopt, wait an hour — still online at every step", () => {
  /**
   * The reported journey end to end, composed from the same functions the
   * repositories and `DutySync` call: the document is built by `dutyTransition`,
   * the adoption is `ownsClaim` + `heartbeatPatch`, and every snapshot is fed
   * through `applyRemotePresence` exactly as the watcher feeds it.
   */
  const tabOne = "tab-before-the-reload";
  const tabTwo = "tab-after-the-reload";

  /* Pressing Go online. */
  const { patch } = dutyTransition({
    previous: null,
    next: "online",
    nowMs: NOW,
    connectionId: tabOne,
  });
  let stored: DutyDocument = patch;

  const emit = (atMs: number) => {
    const snap = readDutySnapshot(stored, atMs);
    applyRemotePresence({
      mode: snap.mode,
      breakStartedAtMs: snap.breakStartedAtMs,
      emergencyStartedAtMs: snap.emergencyStartedAtMs,
      /* `DutySync`'s own line: the claim is somebody else's connection. */
      onlineElsewhere:
        snap.mode === "online" && snap.presenceConnectionId !== tabTwo,
    });
    return getSnapshot().status;
  };

  assert.equal(emit(NOW + 1_000), "online", "the moment after going online");

  /* The reload. The store is empty again and the claim still names tab one. */
  resetStatus();
  assert.equal(emit(NOW + 5_000), "online", "the first snapshot after a reload");

  /* Tab two's first beats are refused while tab one's claim is fresh… */
  const soon = NOW + HEARTBEAT_INTERVAL_MS;
  assert.equal(ownsClaim(stored, tabTwo, soon), false);
  assert.equal(emit(soon), "online");

  /* …and adopted once it has gone quiet, which re-stamps the holder. THIS is
     the step that used to flip the pill grey and publish it. */
  const later = NOW + 3 * HEARTBEAT_INTERVAL_MS;
  assert.equal(ownsClaim(stored, tabTwo, later), true);
  stored = { ...stored, ...heartbeatPatch(later, tabTwo) };
  assert.equal(emit(later), "online", "the reload flipped them offline here");

  /* And an hour of nothing at all — a tab left in the background, a laptop
     asleep — changes none of it. */
  assert.equal(emit(later + 3_600_000), "online");
  assert.equal(readDutyMode(stored, later + 3_600_000), "online");
});

/* ── Nothing on a timer, and nothing unheard ──────────────────────────────── */

function code(path: string): string {
  return readFileSync(path, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

test("a device publishes nothing until it has heard what its status is", () => {
  /**
   * The store initialises to `offline` and the publish effect runs on mount —
   * before the subscription has heard anything, because that is a round trip and
   * this is not. So every page load announced `offline` for somebody who was
   * online, and `ownsClaim` was the only thing in front of it: refused while the
   * previous tab's beat was recent, accepted once it was not.
   */
  const src = code("components/features/status/DutySync.tsx");
  const at = src.indexOf("setDutyMode({");
  assert.ok(at > 0, "the publish effect is gone");
  const effect = src.slice(0, at);
  assert.match(
    effect,
    /if \(!hydrated\) return;/,
    "the publish effect can announce a guess again",
  );
  assert.match(
    src,
    /\}, \[status, session, viewerId, reconnecting, hydrated\]\);/,
    "hydrated is not in the dependency list, so the first real status never publishes",
  );
});

test("nothing in the presence path sets somebody offline on a timer", () => {
  /* Both duty watchers used to re-emit on an interval so a claim could expire
     without anybody writing anything. Nothing expires now, so a timed
     re-emission has nothing to say — and saying it anyway is how a snapshot from
     before somebody's own choice arrives after it and undoes it. */
  for (const path of [
    "lib/repositories/legacy/index.ts",
    "lib/repositories/mock/index.ts",
  ]) {
    const src = code(path);
    for (const watcher of ["watchDutyModes", "watchDutyStatus"]) {
      const at = src.indexOf(`${watcher}(`);
      assert.ok(at > 0, `${path} has no ${watcher}`);
      const body = src.slice(at, src.indexOf("\n  }", at));
      assert.ok(
        !body.includes("setInterval"),
        `${path} ${watcher} sweeps on a timer again`,
      );
    }
  }
});

test("the store has no way to take somebody's online away", () => {
  const src = code("lib/status/employeeStatus.ts");
  assert.ok(
    !/export function claimLapsed/.test(src),
    "a lapse function is back in the store",
  );
  const at = src.indexOf("export function derive");
  const body = src.slice(at, src.indexOf("\nconst INITIAL", at));
  assert.match(
    body,
    /if \(share\.sharing && share\.connected\) return "online";/,
    "the track no longer decides",
  );
});
