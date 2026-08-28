import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { describePushFailure } from "./useFCMToken";

/**
 * "Registration failed - push service error" is Chrome's sentence, not ours.
 *
 * It was shown to people verbatim, in Settings and in the notifications area,
 * where it reads as a fault in Cowork. It is not one: it comes from inside the
 * browser before any key or endpoint of ours is involved, and it means the
 * browser could not reach Google's push service — on an office network, nearly
 * always the network blocking it.
 *
 * The second fault was structural. `pushManager.subscribe` REJECTS rather than
 * returning null, and that rejection flew past the block that knew both routes
 * had been tried, landing in an outer catch that knew only the raw string. So
 * the carefully-worded message existed for a case that does not happen.
 */

function code(path: string): string {
  return readFileSync(path, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

const HOOK = "lib/hooks/useFCMToken.ts";

test("a blocked push service is explained, not quoted at the reader", () => {
  const msg = describePushFailure(null, "Registration failed - push service error");
  assert.match(msg, /could not reach the notification service/i);
  /* The reassurance matters as much as the cause: nothing else is broken. */
  assert.match(msg, /still arrives in Cowork/i);
  assert.match(msg, /network/i);
});

test("the browser's own words survive inside the explanation", () => {
  /* An administrator searches for the original string. A tidier message that
     hides it costs somebody an afternoon. */
  const raw = "Registration failed - push service error";
  assert.ok(describePushFailure(null, raw).includes(raw));
});

test("a refusal is told apart from a blocked service", () => {
  /* Different cause, different remedy: one is the network, the other is a
     permission only the browser's own settings can restore. */
  const msg = describePushFailure(null, "NotAllowedError: permission denied");
  assert.match(msg, /site settings/i);
  assert.doesNotMatch(msg, /network blocking/i);
});

test("an unrecognised failure names both routes when both were tried", () => {
  const msg = describePushFailure("token-unsubscribe-failed", "something odd");
  assert.match(msg, /token-unsubscribe-failed/);
  assert.match(msg, /something odd/);
});

test("nothing to report is still a sentence", () => {
  assert.equal(
    describePushFailure(null, null),
    "Neither messaging nor Web Push could register this device.",
  );
});

test("a thrown fallback is caught where the context still exists", () => {
  /* The whole defect: `subscribe` rejects, and the outer catch has no idea an
     FCM attempt preceded it. */
  const src = code(HOOK);
  const block = src.slice(src.indexOf('if ("PushManager" in window)'));
  const body = block.slice(0, block.indexOf("describePushFailure"));
  assert.match(body, /try\s*\{/, "the fallback is not wrapped, so a throw escapes");
  assert.match(body, /webPushFailure =/, "the fallback's own error is discarded");
});

test("the failure path reports through the shared explanation", () => {
  const src = code(HOOK);
  assert.match(src, /detail: describePushFailure\(fcmFailure, webPushFailure\)/);
});
