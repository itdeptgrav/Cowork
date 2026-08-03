import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

/**
 * When FCM cannot mint a token, the device registers by raw Web Push instead.
 *
 * `getToken` is the link in the chain with the most ways to fail for reasons
 * that have nothing to do with the browser or the person — a restricted API
 * key, a blocked Installations call, an FCM outage. Without a fallback the
 * device is unreachable even though it is perfectly capable of receiving a
 * push, and `sendPushToEmployees` already handles the other shape.
 */

const SRC = readFileSync("lib/hooks/useFCMToken.ts", "utf8");
const CODE = SRC.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

test("a failed getToken falls back to Web Push rather than giving up", () => {
  assert.match(
    CODE,
    /catch[\s\S]{0,120}fcmFailure/,
    "getToken is not wrapped, so a throw would abort registration instead of falling back",
  );
  assert.match(
    CODE,
    /if \(!token\)[\s\S]{0,400}subscribeWebPush\(registration\)/,
    "no Web Push fallback when FCM yields no token",
  );
});

test("only ONE of the two is ever registered", () => {
  /* They address the same browser. Registering both would put two tokens in
     the array for one device and deliver every notification twice. */
  const start = CODE.indexOf("if (!token)");
  const fcmSave = CODE.indexOf("await saveToken(employeeId, token)");
  assert.ok(start > 0 && fcmSave > start, "the fallback block was not found");
  const fallback = CODE.slice(start, fcmSave);
  assert.match(
    fallback,
    /await saveToken\(employeeId, subscription\)/,
    "the fallback never stores the subscription",
  );
  assert.match(
    fallback,
    /return \{ state: "on"/,
    "the fallback does not return after saving, so the FCM path below could run too and register the same browser twice",
  );
});

test("a subscription signed with a different key is replaced, not reused", () => {
  /* On Chrome the Firebase SDK has usually already created the one push
     subscription a service worker gets — with FCM's application server key.
     Storing that and signing for it with VAPID_PRIVATE_KEY yields 403 on every
     send: a subscription that looks valid and can never receive anything. */
  assert.match(
    CODE,
    /sameKey\(existing\.options\?\.applicationServerKey, wanted\)/,
    "the existing subscription's key is not checked before reuse",
  );
  assert.match(
    CODE,
    /existing\.unsubscribe\(\)/,
    "a mismatched subscription is not dropped, so subscribe() would throw on it",
  );
});

test("the key comparison is byte-wise and treats absent as a mismatch", () => {
  assert.match(CODE, /function sameKey\(/, "sameKey is missing");
  assert.match(
    CODE,
    /if \(!current\) return false;/,
    "an absent applicationServerKey must count as a mismatch — it cannot be shown to match, and keeping it costs every notification",
  );
});

test("the automatic path never raises a browser permission prompt", () => {
  /* A permission request that no click asked for is the pattern browsers
     penalise: Chrome suppresses it on a low-engagement origin,
     `requestPermission()` resolves to `default` with nothing shown, and the
     person is left never having been asked while the app believes it asked and
     was refused. The in-app banner asks instead, and the browser prompt
     follows a real click. */
  assert.match(
    CODE,
    /if \(Notification\.permission !== "granted"\) return;/,
    "useFCMToken still registers when permission is not yet granted, which raises a prompt no click asked for",
  );
});

test("the first-run ask is remembered, so the product does not nag", () => {
  const prompt = readFileSync(
    "components/features/notifications/NotificationPrompt.tsx",
    "utf8",
  );
  /* `Notification.permission` stays "default" whether somebody was never asked
     or was asked and closed the banner, so it cannot carry this on its own. */
  assert.match(prompt, /hasBeenAskedForPush\(\)/, "the banner does not check whether it has asked before");
  assert.match(prompt, /rememberAskedForPush\(\)/, "the banner never records that it asked");
  assert.match(
    prompt,
    /Notification\.permission !== "default"/,
    "the banner does not skip somebody who has already answered the browser",
  );
});

test("a stale subscription is cleared and getToken retried once", () => {
  /* `messaging/token-unsubscribe-failed: The caller does not have permission`
     does not mean what it says. It is `getToken` finding a browser
     PushSubscription whose FCM registration has already been deleted, and being
     refused when it asks FCM to delete it again. Signing out left exactly that
     orphan, so the next sign-in could never register — the error aborted
     registration and nothing recovered. */
  assert.match(
    CODE,
    /registration\.pushManager[\s\S]{0,80}getSubscription\(\)[\s\S]{0,400}unsubscribe\(\)[\s\S]{0,300}getToken\(/,
    "getToken does not clear a stale subscription and retry, so a browser that signed out once stays unregisterable",
  );
});

test("sign-out removes the browser subscription, not only the FCM token", () => {
  /* `deleteToken` removes the record at FCM and leaves the local subscription
     in place. That mismatch IS the orphan above, so the cleanup has to drop
     both or it creates the failure the retry then has to recover from. */
  const unregister = CODE.slice(
    CODE.indexOf("export async function unregisterFCMToken"),
    CODE.indexOf("export function useFCMToken"),
  );
  assert.ok(unregister.length > 0, "unregisterFCMToken was not found");
  assert.match(
    unregister,
    /subscription\.unsubscribe\(\)/,
    "sign-out leaves the browser PushSubscription behind, which makes the next getToken fail",
  );
  assert.ok(
    !/if \(!stored\) \{[\s\S]{0,200}getSubscription/.test(unregister),
    "the subscription is only dropped on the web-push path — an FCM device would still leave an orphan",
  );
});
