import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import {
  SHARE_LOST_DETAIL,
  SHARE_LOST_TITLE,
  shareLostHere,
} from "./shareLost.ts";

/**
 * **Online after a reload, with nothing actually going out.**
 *
 * A browser always drops a screen share on reload — no page can restart one
 * without a fresh click. The durable claim survives it, deliberately: nothing
 * takes a status away from the person who chose it. So every refresh produces a
 * person who is online with no capture, and the danger is not the status, it is
 * the BELIEF: they think their manager can see them and the manager's panel is
 * blank, and neither of them finds out.
 *
 * These fix who gets interrupted about it, and who must not be.
 */

const ONLINE_NO_SHARE = {
  hydrated: true,
  accountOnline: true,
  sharingHere: false,
  claimedHere: true,
  starting: false,
};

test("the device that was sharing is warned", () => {
  assert.equal(shareLostHere(ONLINE_NO_SHARE), true);
});

test("a device that never shared is NOT warned", () => {
  /**
   * **The phone in somebody's pocket.** Presence belongs to a person, not a
   * browser: their laptop is sharing, the account is online, and reading Cowork
   * on a phone is not a fault. Warning there would be an alarm about a share
   * that is running perfectly well three feet away — and the phone cannot fix
   * it even if it were broken.
   */
  assert.equal(
    shareLostHere({ ...ONLINE_NO_SHARE, claimedHere: false }),
    false,
  );
});

test("a live share is not a lost one", () => {
  assert.equal(shareLostHere({ ...ONLINE_NO_SHARE, sharingHere: true }), false);
});

test("nothing is claimed before the account has been read", () => {
  /* The store initialises offline and `hydrated` false. Warning from that guess
     would fire on every page load, for everybody, before anything was known. */
  assert.equal(shareLostHere({ ...ONLINE_NO_SHARE, hydrated: false }), false);
});

test("an offline account has nothing to warn about", () => {
  assert.equal(
    shareLostHere({ ...ONLINE_NO_SHARE, accountOnline: false }),
    false,
  );
});

test("a share being started right now is not a share that is missing", () => {
  /* The seconds between pressing Go online and the capture arriving are a gap
     by design — the picker is open. Alerting into it would interrupt the very
     act that closes it. */
  assert.equal(shareLostHere({ ...ONLINE_NO_SHARE, starting: true }), false);
});

/* ── The alert itself ─────────────────────────────────────────────────────── */

test("the warning is raised, sounded, and changes no status", () => {
  /**
   * The owner's requirement, in four parts: stay Online, play a sound, show
   * "Your screen is not being shared.", and leave it to the person to resolve.
   * The last one is the one a future change is most likely to break — a
   * `goOffline()` added here would look like tidying up.
   */
  const button = readFileSync(
    "components/features/status/StatusButton.tsx",
    "utf8",
  );
  assert.match(button, /shareLostHere\(\{/);
  assert.match(button, /soundShareLost\(\);/);
  assert.match(button, /<ShareLostDialog/);

  const dialog = readFileSync(
    "components/features/status/ShareLostDialog.tsx",
    "utf8",
  );
  assert.ok(
    !/goOffline|endSession|clearManual|setDutyMode/.test(dialog),
    "the warning changes somebody's status — it is a warning, not a transition",
  );
  /* Read by a screen reader as an interruption rather than announced quietly,
     because it is asking for an action. */
  assert.match(dialog, /role="alertdialog"/);
  assert.match(dialog, /Share my screen/);
  assert.match(dialog, /Not now/);
});

test("the words are written once and shared", () => {
  /* The dialog, the pill and the help article all describe the same warning. A
     help article that words a refusal differently from the refusal is hard to
     match against the screen — CLAUDE.md's rule, and the reason these are
     constants rather than three string literals. */
  assert.equal(SHARE_LOST_TITLE, "Your screen is not being shared.");
  /* Both causes say the status is safe — that is the reflex the warning has to
     answer — and each names what actually happened. Telling somebody a reload
     ended their share when their connection dropped sends them looking for a
     mistake they did not make. */
  assert.match(SHARE_LOST_DETAIL.reload, /still Online/);
  assert.match(SHARE_LOST_DETAIL.reload, /Reloading a page/);
  assert.match(SHARE_LOST_DETAIL.dropped, /still Online/);
  assert.match(SHARE_LOST_DETAIL.dropped, /connection to the screen-sharing service dropped/);

  const knowledge = readFileSync("lib/help/knowledge.ts", "utf8");
  assert.ok(
    knowledge.includes(SHARE_LOST_TITLE),
    "the help corpus does not quote the warning people actually see",
  );
});

test("the tone waits for a gesture rather than being lost to autoplay policy", () => {
  /**
   * **A reloaded tab has had no interaction, so the browser refuses audio** —
   * which is precisely the situation this alert exists for. A tone that is
   * simply dropped there satisfies nothing: the requirement is that the person
   * is alerted, and half the time they would not be.
   *
   * So a refused tone is armed against the next gesture the page receives — but
   * not a gesture INSIDE the dialog. `pointerdown` fires before `click`, so
   * dismissing the warning would otherwise sound the alarm about it on the way
   * out, which is startling and explains nothing.
   */
  const alarm = readFileSync("lib/status/shareAlarm.ts", "utf8");
  assert.match(alarm, /audio\.state === "suspended"/);
  assert.match(alarm, /armOnNextGesture\(\)/);
  assert.match(alarm, /closest\('\[role="alertdialog"\]'\)/);
  assert.match(alarm, /export function cancelShareLostSound/);

  /* And it is called off once the warning has been dealt with. */
  const button = readFileSync(
    "components/features/status/StatusButton.tsx",
    "utf8",
  );
  const at = button.indexOf("<ShareLostDialog");
  assert.ok(at > 0, "the dialog is no longer rendered");
  const mount = button.slice(at, button.indexOf("/>", at));
  assert.equal(
    (mount.match(/cancelShareLostSound\(\)/g) ?? []).length,
    2,
    "both ways out of the dialog must call the pending tone off",
  );
});

test("a dropped connection does NOT take anybody offline; a real stop does", () => {
  /**
   * **Reported as: it switches me to offline and stops my screen share, by
   * itself, while I am working.**
   *
   * Their SDK has one `ended` event for two unrelated events — their words:
   * *"fires when the user stops from the browser's own bar or the connection
   * drops."* Cowork called `endSession()` for both, so a network blip, a proxy
   * closing an idle socket or a service restart marked somebody offline and
   * killed the capture they were in the middle of.
   *
   * The two are told apart by the CAPTURE, not the session: a MediaStreamTrack
   * fires `ended` when its source goes away — the Stop sharing bar, a display
   * unplugged — and never when a transport drops. Their SDK does not hand the
   * track back, so the call that creates it is intercepted for the length of
   * one `share()` and the track listened to directly.
   */
  const publisher = readFileSync("lib/integrations/grav/publisher.ts", "utf8");
  assert.match(publisher, /export type ShareEnd = "stopped" \| "dropped";/);
  assert.match(publisher, /getDisplayMedia = async/, "the capture is not observed");
  assert.match(publisher, /captureEnded \? "stopped" : "dropped"/);
  /* Our own teardown ends the session too, and must not be reported as either. */
  assert.match(publisher, /if \(stoppingHere\) return;/);

  const button = readFileSync(
    "components/features/status/StatusButton.tsx",
    "utf8",
  );
  const at = button.indexOf("onEnded: (reason) => {");
  assert.ok(at > 0, "the two endings are handled as one again");
  const handler = button.slice(at, button.indexOf("},", at));
  assert.match(handler, /if \(reason === "stopped"\) \{\s*endSession\(\);/);
  /* The drop goes to `onShareDropped`, which puts the share back where it can
     and warns where it cannot — its own test is below. What must never appear
     here is a second `endSession`. */
  assert.match(handler, /onShareDropped\(\);/);
  assert.equal(
    (handler.match(/endSession\(\)/g) ?? []).length,
    1,
    "a dropped session ends the person's presence — nothing may do that but them",
  );

  /* And `shareInterrupted` is the one teardown that keeps the claim: DutySync
     publishes nothing while `reconnecting`, so the durable document is neither
     renewed nor revoked. */
  const store = readFileSync("lib/status/employeeStatus.ts", "utf8");
  const fn = store.slice(
    store.indexOf("export function shareInterrupted"),
    store.indexOf("\n}", store.indexOf("export function shareInterrupted")),
  );
  assert.match(fn, /reconnecting: true/);
  assert.ok(!/manual: null/.test(fn), "a drop clears a break or an emergency");
  assert.match(
    readFileSync("components/features/status/DutySync.tsx", "utf8"),
    /if \(reconnecting\) return;/,
  );
});

test("a dropped session is put back without asking, when the screen is still in hand", () => {
  /**
   * **The fault is in THEIR SDK, and this is the mitigation.** From their own
   * source, `web/sdk/index.js`:
   *
   *     ws.onclose = () => {
   *       if (session.active) {
   *         session.active = false;
   *         session._stream?.getTracks().forEach((t) => t.stop());
   *         session._emit("ended", { reason: "disconnected" });
   *       }
   *     };
   *
   * There is no reconnect anywhere in that file. Any WebSocket close — a wifi
   * blip, a laptop waking, a proxy hiccup, one of their deploys — stops the
   * capture and ends the share for good. That is "screen sharing turns off
   * after a while", and no amount of care on this side prevents it happening.
   *
   * What this side CAN do is put it back. A `MediaStreamTrack` clone shares the
   * original's SOURCE and survives the original being stopped, so the spare is
   * a live picture of the same screen with nothing to prompt for — and their
   * `share()` takes it because the call that would have prompted is
   * intercepted. A capture prompt needs a click; reusing one already granted
   * does not.
   *
   * **When the person really stopped, there is nothing to resume**: the source
   * ends, the clone ends with it, and they are asked. That is the difference
   * this must never lose.
   */
  const publisher = readFileSync("lib/integrations/grav/publisher.ts", "utf8");
  assert.match(publisher, /spareStream = stream\.clone\(\);/);
  assert.match(publisher, /export function canResumeSilently\(\): boolean \{/);
  assert.match(publisher, /export async function resumePublishing\(/);
  /* The interception hands the spare over instead of prompting. */
  assert.match(publisher, /if \(resumeStream\) \{[\s\S]{0,200}return reused;/);

  /* And a deliberate stop drops it. A live clone would keep the browser's
     "sharing your screen" bar up over somebody who has gone offline, which is
     the most alarming possible way to be wrong about this. */
  const stop = publisher.slice(
    publisher.indexOf("export function stopPublishing"),
    publisher.indexOf("export function isPublishing"),
  );
  assert.match(stop, /dropSpare\(\);/);

  const button = readFileSync(
    "components/features/status/StatusButton.tsx",
    "utf8",
  );
  const dropped = button.slice(
    button.indexOf("function onShareDropped()"),
    button.indexOf("function warnShareLost()"),
  );
  assert.match(dropped, /shareInterrupted\(\);/, "a drop moves the status");
  assert.match(dropped, /canResumeSilently\(\)/);
  assert.match(dropped, /resumePublishing\(/);
  assert.match(
    dropped,
    /warnShareLost\(\)/,
    "a resume that fails leaves the person with nothing said",
  );
});
