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
  assert.match(SHARE_LOST_DETAIL, /still Online/);

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
