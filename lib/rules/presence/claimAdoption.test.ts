import assert from "node:assert/strict";
import { test } from "node:test";
import {
  HEARTBEAT_INTERVAL_MS,
  PRESENCE_STALE_AFTER_MS,
  ownsClaim,
  readDutyMode,
  type DutyDocument,
} from "./duty.ts";

/**
 * A reload must not strand somebody online-but-dying.
 *
 * `connectionId()` is fresh on every page load by design — it identifies a tab,
 * and a reload is a new tab as far as ownership goes. The presence document
 * records WHICH connection claimed online, and only that connection may renew
 * it.
 *
 * So after a refresh: the account still said online, the pill was right, and
 * every beat this connection sent was refused **in silence**. Nothing renewed
 * the claim; ten minutes later the staleness window marked the person offline,
 * and because the heartbeat only runs while online it never recovered.
 *
 * It never bit while online MEANT a live screen share — a reload killed the
 * share, the person was honestly offline, and going online again re-stamped the
 * claim. The reload always re-claimed. Nothing re-claims now.
 */

const NOW = Date.UTC(2026, 7, 7, 6, 0, 0);
const online = (over: Partial<DutyDocument> = {}): DutyDocument => ({
  mode: "online",
  heartbeatAt: NOW,
  presenceConnectionId: "tab-A",
  ...over,
});

test("the owner keeps its own claim", () => {
  assert.equal(ownsClaim(online(), "tab-A", NOW), true);
});

test("a live owner's claim is not taken from it", () => {
  /* Two tabs both open. The one beating holds it; the other must not steal it,
     or they would take turns re-stamping on every beat. */
  assert.equal(ownsClaim(online({ heartbeatAt: NOW - 10_000 }), "tab-B", NOW), false);
  assert.equal(
    ownsClaim(online({ heartbeatAt: NOW - HEARTBEAT_INTERVAL_MS }), "tab-B", NOW),
    false,
    "one missed beat is not evidence the owner is gone",
  );
});

test("AFTER A RELOAD the new connection adopts the quiet claim", () => {
  /* The reported fault. The old tab is gone and its beats stopped; this one has
     a fresh id and was being refused. Two beats of silence is enough. */
  const quiet = online({ heartbeatAt: NOW - 2 * HEARTBEAT_INTERVAL_MS - 1_000 });
  assert.equal(ownsClaim(quiet, "tab-B", NOW), true);
});

test("adoption happens long before the claim would lapse", () => {
  /* The whole point: recovery in a minute and a half rather than never. */
  assert.ok(
    2 * HEARTBEAT_INTERVAL_MS < PRESENCE_STALE_AFTER_MS,
    "a claim goes stale before anybody may adopt it, so the lapse still wins",
  );
  const justBeforeLapse = online({
    heartbeatAt: NOW - PRESENCE_STALE_AFTER_MS + 1_000,
  });
  assert.equal(readDutyMode(justBeforeLapse, NOW), "online", "not stale yet");
  assert.equal(
    ownsClaim(justBeforeLapse, "tab-B", NOW),
    true,
    "still un-adoptable while the person is being marked online",
  );
});

test("a claim with no heartbeat at all is adoptable", () => {
  /* Written by an older client, or a half-written document. */
  assert.equal(ownsClaim(online({ heartbeatAt: null }), "tab-B", NOW), true);
});

test("nothing here loosens the other modes", () => {
  /* `ownsClaim` also gates who may write a break or an offline. A non-online
     document was always freely writable and still is. */
  assert.equal(ownsClaim({ mode: "break" }, "tab-B", NOW), true);
  assert.equal(ownsClaim(null, "tab-B", NOW), false);
  assert.equal(ownsClaim(online(), null, NOW), false, "an unidentified caller owns nothing");
});
