"use client";

/**
 * Register this device for push, so the notifications the engine already sends
 * can actually reach a phone.
 *
 * ## What was missing
 *
 * `_notify` and `_notifyMany` fan out three ways — a Firestore row, a socket
 * event, and an FCM push. The first two worked here from day one. The third
 * reached nothing: this app had no `firebase/messaging` import, no service
 * worker, and never called `POST /cowork/employee/fcm-token`. Every token in
 * `cowork_fcm_tokens` was put there by somebody using the OLD app, so anyone
 * who had only ever signed into this one had no token on any device and every
 * push addressed to them was dropped.
 *
 * Ported from `Coworking/hooks/useFCMToken.ts` rather than designed, matching
 * how the rest of this migration treats behaviour that already works. The
 * device-key scheme in particular is copied exactly: it is what stops a
 * reinstall leaving a dead token behind forever.
 *
 * ## Written straight to Firestore, not through the engine
 *
 * The same seam the old app uses, and `saveFCMToken` on the backend writes the
 * identical shape — `cowork_fcm_tokens/{employeeId}` with a per-device field,
 * a `tokens` array for backward compatibility, and `latestToken`.
 * `fcmPush.service.js` reads that collection and `cowork_employees.fcmTokens`,
 * merging both. A token is a claim about your OWN device, so unlike a
 * notification there is nothing here that a client could forge on somebody
 * else's behalf beyond what it could already do by signing in.
 */

import { useCallback, useEffect, useSyncExternalStore } from "react";

/**
 * The FCM Web Push certificate, not the store-side web-push pair.
 *
 * Two VAPID key pairs exist in this deployment and they are not
 * interchangeable: `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY` belong to
 * `NotificationService.js` on the store side, and passing that public key here
 * makes `getToken` fail with an unregistered-sender error that reads like a
 * network fault.
 */
const VAPID_KEY = process.env.NEXT_PUBLIC_FIREBASE_VAPID_KEY || "";

/**
 * A stable key for this device.
 *
 * Its purpose is that reinstalling or clearing the cache OVERWRITES the
 * previous token for the same device rather than adding a second one —
 * `tokens: arrayUnion(...)` alone only ever grows.
 *
 * ## The prefix is `device_`, and the old app's `dev` was a dead letter
 *
 * `fcmPush.service.js` collects per-device tokens with
 * `Object.keys(d).filter(k => k.startsWith("device_"))`. The old app writes
 * `dev<hash>` — no underscore — so **not one of those keys has ever been read
 * by the sender.** Verified against live data: one employee's document holds
 * 12 `dev*` fields and the backend collects 0 of them.
 *
 * The consequence is not that tokens were lost — `tokens[]` and `latestToken`
 * still carried them — but that the de-duplication the device key exists for
 * never happened. That array only ever grows, so the same browser
 * re-registering after every cache clear left a new entry each time: 9 live
 * registrations for one person, and every notification fanned out to all of
 * them.
 *
 * Alphanumeric after the prefix, because it is used as a Firestore FIELD name.
 */
function deviceKey(): string {
  const raw = `${navigator.userAgent}_${window.screen.width}x${window.screen.height}_${navigator.language}`;
  let hash = 0;
  for (let i = 0; i < raw.length; i++) {
    hash = (hash << 5) - hash + raw.charCodeAt(i);
    hash |= 0;
  }
  return `device_${Math.abs(hash).toString(36)}`;
}

/**
 * base64url VAPID key → the raw bytes `PushManager.subscribe` demands.
 *
 * Returns an `ArrayBuffer` rather than the `Uint8Array` the old app builds.
 * Both are accepted at runtime, but TypeScript's `BufferSource` rejects a
 * `Uint8Array<ArrayBufferLike>` — the view may be backed by a `SharedArrayBuffer`,
 * which the DOM type deliberately excludes. Handing over the buffer itself is
 * the same bytes without the cast that would hide the distinction.
 */
function urlBase64ToBytes(base64: string): ArrayBuffer {
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = window.atob(padded.replace(/-/g, "+").replace(/_/g, "/"));
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes.buffer;
}

/**
 * Which browser this is, in one word.
 *
 * Stored alongside the token because `userAgent` alone could not answer it. It
 * was recorded as `slice(0, 100)`, and on Windows every Chromium browser is
 * byte-identical for the first ~95 characters — the `Edg/`, `OPR/` or `Brave`
 * that names the browser comes AFTER the cut. So every registration in the
 * database read "Chrome", including the ones that were not, and "did Edge ever
 * register?" was unanswerable from the data.
 *
 * Order matters: Edge and Opera both contain `Chrome/` in their user agent, so
 * the specific tokens have to be tested before the generic one.
 */
function browserLabel(ua: string): string {
  if (/\bEdg[A-Z]?\//.test(ua)) return "Edge";
  if (/\bOPR\/|\bOpera\b/.test(ua)) return "Opera";
  if (/\bFirefox\//.test(ua)) return "Firefox";
  if (/\bSamsungBrowser\//.test(ua)) return "Samsung Internet";
  /* Safari identifies itself only by NOT being any of the above while carrying
     the AppleWebKit marker without `Chrome/`. */
  if (/\bChrome\//.test(ua)) return "Chrome";
  if (/\bSafari\//.test(ua)) return "Safari";
  return "Unknown";
}

/**
 * Whether an existing subscription was signed with the key we are about to use.
 *
 * `applicationServerKey` comes back as an `ArrayBuffer` of the raw P-256 point,
 * so this is a byte comparison — there is no string form to compare and no
 * equality operator that would do the right thing on two buffers.
 *
 * An absent key means the subscription predates the option or was made by
 * something that did not record one; either way it cannot be shown to match,
 * so it is treated as a mismatch and replaced. Replacing a subscription that
 * would have worked costs one round trip; keeping one that will not costs every
 * notification.
 */
function sameKey(
  current: ArrayBuffer | null | undefined,
  wanted: ArrayBuffer,
): boolean {
  if (!current) return false;
  const a = new Uint8Array(current);
  const b = new Uint8Array(wanted);
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/**
 * Subscribe an iOS/iPadOS device, which cannot use FCM.
 *
 * Safari has no Firebase Messaging support, so `getToken` is not an option.
 * It does implement the standard Web Push API, which is the path
 * `fcmPush.service.js` already handles: it splits any token that parses as
 * `{endpoint, keys}` out of the list and sends those through `web-push`,
 * signed with `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY`.
 *
 * ## The subscription is stored as a TOKEN, not through `/subscribe`
 *
 * `POST /api/cowork/notifications/subscribe` exists and looks like the right
 * endpoint. It is not, for this. It hands the subscription to
 * `NotificationService`, whose store is keyed by the Mongo `_id` and is read by
 * the STORE-side notifications only. `sendPushToEmployees` — which every Cowork
 * notification goes through — never looks there. A device subscribed that way
 * receives MRF store pushes and not one task, deadline or score notification.
 *
 * So the subscription JSON goes into the same `cowork_fcm_tokens` array as an
 * FCM token, which is exactly the shape the iOS branch of that function
 * expects.
 *
 * **The public key comes from the server**, because it must be the one the
 * server signs with. Hard-coding it here, or reusing the FCM key, produces a
 * subscription the push service rejects with a 403 — the two VAPID pairs in
 * this deployment are different keys, and the backend's own comment in
 * `fcmPush.service.js` records that trap.
 */
/**
 * What to tell somebody whose device would not register.
 *
 * The browser's own words are the wrong words. Chrome says **"Registration
 * failed - push service error"**, which reads as a fault in Cowork and is not
 * one: it comes from inside the browser, before any key or endpoint of ours is
 * involved, and it means the browser could not reach Google's push service at
 * all. On an office network that is nearly always the network — the push
 * endpoints are a different host from anything else the app talks to, so
 * everything else can work perfectly while this one thing is blocked.
 *
 * Both routes are named because both were tried. Somebody reporting this should
 * not have to discover that the fallback ran too.
 *
 * The browser's string is kept on the end rather than replaced. It is the only
 * part an administrator can search for, and a message that hides the original
 * error to sound tidier is a message that costs somebody an afternoon.
 */
export function describePushFailure(
  fcmFailure: string | null,
  webPushFailure: string | null,
): string {
  const raw = webPushFailure ?? fcmFailure;
  if (!raw) return "Neither messaging nor Web Push could register this device.";

  /* Chrome's wording for "I could not reach the push service." Firefox says
     its own thing, so this is a contains-check rather than an equality one. */
  if (/push service error|AbortError/i.test(raw)) {
    return `This browser could not reach the notification service, so pushes are off on this device. Everything still arrives in Cowork itself — the bell and the notifications page are unaffected. It is usually the network blocking Google's push service rather than anything about your account; a different network, or asking IT to allow it, is the fix. (${raw})`;
  }

  if (/denied|NotAllowedError/i.test(raw)) {
    return `This browser has blocked notifications for Cowork. Turn them back on in the browser's own site settings — the page cannot ask again once it has been refused. (${raw})`;
  }

  return fcmFailure && webPushFailure
    ? `Messaging refused this device (${fcmFailure}), and the Web Push fallback could not subscribe either (${webPushFailure}).`
    : `This device could not be registered for notifications. (${raw})`;
}

async function subscribeWebPush(
  registration: ServiceWorkerRegistration,
): Promise<string | null> {
  const base = process.env.NEXT_PUBLIC_LEGACY_API_URL;
  if (!base) return null;

  const { idToken } = await import("../legacy/firebase.ts");
  const token = await idToken();
  if (!token) return null;

  const res = await fetch(`${base}/api/cowork/notifications/vapid-public-key`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const body = (await res.json().catch(() => ({}))) as {
    success?: boolean;
    publicKey?: string;
  };
  if (!body.success || !body.publicKey) return null;

  const wanted = urlBase64ToBytes(body.publicKey);

  /* **Reuse an existing subscription only if it was signed with THIS key.**
   *
   * A browser has one push subscription per service worker, and on Chrome the
   * Firebase SDK has usually already created it — with FCM's own application
   * server key, not ours. Storing that and having the backend sign for it with
   * `VAPID_PRIVATE_KEY` produces a 403 from the push service on every send:
   * a subscription that looks perfectly valid and can never receive anything.
   *
   * So the key is compared, and a mismatched subscription is dropped and
   * replaced. `subscribe` with a different key on a live subscription throws
   * rather than replacing it, which is why the unsubscribe has to come first. */
  let existing = await registration.pushManager.getSubscription();
  if (existing && !sameKey(existing.options?.applicationServerKey, wanted)) {
    await existing.unsubscribe().catch(() => {});
    existing = null;
  }

  const subscription =
    existing ??
    (await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: wanted,
    }));

  return JSON.stringify(subscription.toJSON());
}

async function saveToken(employeeId: string, token: string): Promise<void> {
  const { arrayRemove, arrayUnion, doc, getDoc, serverTimestamp, setDoc } =
    await import("firebase/firestore");
  const { legacyDb } = await import("../legacy/firebase.ts");
  const key = deviceKey();
  const ref = doc(legacyDb(), "cowork_fcm_tokens", employeeId);

  /* **Retire this device's PREVIOUS token before recording the new one.**
   *
   * `arrayUnion` alone only ever grows, and FCM mints a fresh token whenever
   * the browser's storage is cleared or the registration is replaced. One
   * employee's array had accumulated nine entries — eight of which FCM still
   * accepts, because a token stays valid until its browser instance is gone —
   * so every notification fanned out to nine registrations for what is really
   * one or two machines.
   *
   * The device field is what makes the old one identifiable: same browser,
   * same key, whatever the token underneath. Read first so the removal names a
   * value rather than guessing.
   *
   * A failed read is not fatal — the write below still records the new token,
   * which is the part that matters. Only the tidying is skipped. */
  let previous: string | null = null;
  try {
    const snap = await getDoc(ref);
    const held = snap.exists()
      ? (snap.data() as Record<string, unknown>)[key]
      : null;
    if (typeof held === "string" && held && held !== token) previous = held;
  } catch {
    /* Tidying is best effort. */
  }

  await setDoc(
    ref,
    {
      employeeId,
      [key]: token,
      tokens: previous ? arrayRemove(previous) : arrayUnion(token),
      latestToken: token,
      updatedAt: serverTimestamp(),
      platform: "web",
      /* 240 rather than 100: the browser-identifying token sits at the END of a
         Chromium user agent, so the old cut removed the only part that
         distinguished Edge from Chrome. `browser` carries the answer directly,
         because nobody debugging this should have to parse a user agent. */
      userAgent: navigator.userAgent.slice(0, 240),
      browser: browserLabel(navigator.userAgent),
    },
    { merge: true },
  );

  /* Two writes when a token is being replaced: Firestore refuses `arrayRemove`
     and `arrayUnion` on the same field in one operation. The removal goes
     first so a failure between them leaves the NEW token recorded and an old
     one lingering, rather than the reverse — a stale extra costs a wasted push,
     a missing new one costs every notification. */
  if (previous) {
    await setDoc(ref, { tokens: arrayUnion(token) }, { merge: true });
  }
}

/**
 * Drop this device's push registration. Call on sign-out, before Firebase's.
 *
 * ## Two defects, one cause
 *
 * Signing out left the token where it was, filed under the person who had just
 * left.
 *
 * **The privacy one.** A token identifies a BROWSER, not an account. Left in
 * the previous person's array, every notification addressed to them kept
 * ringing on that machine — a shared desk where the next person signs in is
 * shown somebody else's task assignments, deadline decisions and score
 * deductions. Nothing in the app would ever reveal why.
 *
 * **The one that looks like a bug in saving.** FCM mints one token per browser
 * and returns the SAME value on every later `getToken`. So after a
 * sign-out/sign-in the token was already in the array, `arrayUnion` was a
 * no-op, and the document did not change — which reads exactly like "the token
 * was not stored", because from outside there is no way to tell a write that
 * was skipped from one that never happened.
 *
 * Deleting it at FCM as well as in Firestore is what makes the difference:
 * `deleteToken` invalidates the value, so the next sign-in mints a genuinely
 * new one and the write is real.
 *
 * **Order matters.** This must run BEFORE `firebaseSignOut()` — the Firestore
 * write is authorised by the session it is cleaning up, and after sign-out it
 * is refused.
 *
 * Never throws. A sign-out that fails because a token could not be tidied
 * would leave somebody signed in on a machine they are walking away from.
 */
export async function unregisterFCMToken(
  employeeId: string | null,
): Promise<void> {
  if (!employeeId) return;
  if (typeof window === "undefined") return;
  if (!("serviceWorker" in navigator)) return;

  try {
    const registration =
      await navigator.serviceWorker.getRegistration("/firebase-messaging-sw.js");
    if (!registration) return;

    /* Whichever path registered this device, read back the same value it
       stored so the right entry is removed. */
    let stored: string | null = null;
    try {
      const { getMessaging, getToken, deleteToken, isSupported } = await import(
        "firebase/messaging"
      );
      if (VAPID_KEY && (await isSupported().catch(() => false))) {
        const { legacyFirebase } = await import("../legacy/firebase.ts");
        const messaging = getMessaging(legacyFirebase().app);
        stored = await getToken(messaging, {
          vapidKey: VAPID_KEY,
          serviceWorkerRegistration: registration,
        }).catch(() => null);
        /* Invalidate at FCM too. Without this the same value comes back on the
           next sign-in and the re-registration writes nothing. */
        if (stored) await deleteToken(messaging).catch(() => {});
      }
    } catch {
      /* Not an FCM browser. The Web Push branch below still applies. */
    }

    /* **The browser subscription goes too, whichever path registered it.**
     *
     * `deleteToken` removes the registration at FCM and leaves the browser's
     * `PushSubscription` in place. The next `getToken` then finds an orphan —
     * a live local subscription whose FCM record no longer exists — tries to
     * reconcile the two, and fails with
     * `messaging/token-unsubscribe-failed: The caller does not have permission`,
     * because it is asking FCM to delete something already deleted.
     *
     * That error aborts registration entirely, so signing out once left the
     * browser unable to register again. Removing the subscription here is what
     * makes the next sign-in start from nothing. */
    const subscription = await registration.pushManager
      .getSubscription()
      .catch(() => null);
    if (subscription) {
      /* Only used as the stored value if the FCM path did not supply one — a
         web-push device stores the subscription JSON, an FCM device its token. */
      if (!stored) stored = JSON.stringify(subscription.toJSON());
      await subscription.unsubscribe().catch(() => {});
    }

    if (!stored) return;

    const { arrayRemove, deleteField, doc, updateDoc } = await import(
      "firebase/firestore"
    );
    const { legacyDb } = await import("../legacy/firebase.ts");
    await updateDoc(doc(legacyDb(), "cowork_fcm_tokens", employeeId), {
      tokens: arrayRemove(stored),
      /* The per-device field as well. Leaving it would keep a dead token
         pointing at this machine under the previous person's record. */
      [deviceKey()]: deleteField(),
    });
  } catch {
    /* Signing out must complete regardless. */
  }
}

/**
 * What happened when this device tried to register.
 *
 * A status rather than a boolean, because "push is off" has causes a person
 * can act on and causes they cannot, and telling them apart is the whole
 * difference between a setting and a fault.
 */
export type PushState =
  /** Not attempted yet. */
  | "idle"
  /** In flight. */
  | "working"
  /** Registered; this device will receive pushes. */
  | "on"
  /** The browser cannot do push at all — no Push API, or Safari below 16.4. */
  | "unsupported"
  /** The person blocked notifications for this site. Only they can undo it. */
  | "blocked"
  /** Asked and neither allowed nor blocked — a dismissed or suppressed prompt. */
  | "dismissed"
  /** Something went wrong. `detail` says what. */
  | "failed";

export interface PushResult {
  state: PushState;
  detail: string | null;
}

/**
 * Register this device, and say plainly what happened.
 *
 * ## Why this is a function and not only an effect
 *
 * The first version asked for permission automatically on load. Chrome's
 * "quieter permissions" suppresses a prompt that no click asked for on a
 * low-engagement origin — `localhost` above all — and when it does,
 * `requestPermission()` resolves to `"default"` without showing anything. The
 * hook then returned early, silently, and no token was ever written. Nothing
 * was broken and nothing was visible, which is the worst combination: the
 * symptom is "the token is not stored" and the cause is a prompt that never
 * appeared.
 *
 * A browser always honours a permission request made from a real click. So the
 * same logic is exported for a button to call, and the automatic attempt stays
 * as the path that works where it works.
 *
 * Returns rather than throws. Every failure here is something to display, not
 * something to crash a sign-in over.
 */
export async function registerPush(employeeId: string): Promise<PushResult> {
  if (typeof window === "undefined") return { state: "idle", detail: null };
  if (!("Notification" in window) || !("serviceWorker" in navigator)) {
    return {
      state: "unsupported",
      detail: "This browser cannot show notifications.",
    };
  }
  if (Notification.permission === "denied") {
    return {
      state: "blocked",
      detail:
        "Notifications are blocked for this site. Allow them in your browser's site settings, then try again.",
    };
  }

  try {
    if (Notification.permission !== "granted") {
      const permission = await Notification.requestPermission();
      if (permission === "denied") {
        return {
          state: "blocked",
          detail: "You chose to block notifications for this site.",
        };
      }
      if (permission !== "granted") {
        return {
          state: "dismissed",
          detail:
            "The permission request was dismissed, or your browser hid it. Try again, or allow notifications in site settings.",
        };
      }
    }

    const registration = await navigator.serviceWorker.register(
      "/firebase-messaging-sw.js",
      { scope: "/" },
    );
    await navigator.serviceWorker.ready;

    const { getMessaging, getToken, isSupported, onMessage } = await import(
      "firebase/messaging"
    );

        /* **Two delivery paths, and which one applies is the browser's
           decision, not ours.**

           Firebase Messaging does not support Safari, so on iOS and iPadOS —
           the devices that most need a push, because the app is not open in a
           tab all day — `isSupported()` is false and there is no FCM token to
           be had. Falling back to the standard Web Push API is what makes
           those devices reachable at all; without it this hook returned early
           on every iPhone and the whole feature was Android-and-desktop only.

           `PushManager` is checked separately because a browser can lack both,
           in which case there is nothing to register and that is fine. */
    /* **Two delivery paths, and which one applies is the browser's decision,
       not ours.**

       Firebase Messaging does not support Safari, so on iOS and iPadOS — the
       devices that most need a push, because the app is not open in a tab all
       day — `isSupported()` is false and there is no FCM token to be had.
       Falling back to the standard Web Push API is what makes those devices
       reachable at all. */
    const fcmSupported = await isSupported().catch(() => false);

    if (!fcmSupported) {
      if (!("PushManager" in window)) {
        return {
          state: "unsupported",
          detail:
            "This browser has no push support. On an iPhone, add Cowork to your Home Screen first.",
        };
      }
      const subscription = await subscribeWebPush(registration);
      if (!subscription) {
        return {
          state: "failed",
          detail:
            "The server did not return a push key, so this device could not subscribe.",
        };
      }
      await saveToken(employeeId, subscription);
      return { state: "on", detail: null };
    }

    /* Checked HERE and not earlier: the Web Push path above fetches its key
       from the server and does not need this one, so an unset variable must
       not turn iOS off as well. */
    if (!VAPID_KEY) {
      return {
        state: "failed",
        detail:
          "NEXT_PUBLIC_FIREBASE_VAPID_KEY is not set, so this browser cannot be registered.",
      };
    }

    /* The SAME named app the rest of the product uses (`cowork-legacy`), not a
       second default one — messaging registered against a different app
       instance would carry a different sender and the token would be rejected
       by the project that sends the push. */
    const { legacyFirebase } = await import("../legacy/firebase.ts");
    const messaging = getMessaging(legacyFirebase().app);

    /* **FCM first, raw Web Push as the fallback.**
     *
     * `getToken` is the part of this chain with the most ways to fail that are
     * nothing to do with the browser or the person: a restricted API key, a
     * blocked Installations call, an FCM outage. When it does, the device ends
     * up unreachable even though the browser is perfectly capable of receiving
     * a push.
     *
     * The standard Web Push API needs none of that — it takes the VAPID public
     * key from our own server and produces a subscription the backend already
     * knows how to send to, through `web-push` rather than `admin.messaging`.
     * `sendPushToEmployees` splits the two apart by shape, so one stored value
     * of either kind is all a device needs.
     *
     * **One or the other, never both.** They address the same browser, so
     * registering both would deliver every notification twice. The fallback
     * runs only where FCM produced nothing. */
    let token: string | null = null;
    let fcmFailure: string | null = null;
    try {
      token = await getToken(messaging, {
        vapidKey: VAPID_KEY,
        serviceWorkerRegistration: registration,
      });
    } catch (e) {
      fcmFailure = e instanceof Error ? e.message : String(e);

      /* **One retry, from a clean slate.**
       *
       * The failure this recovers from is `token-unsubscribe-failed` — "the
       * caller does not have permission". It does not mean what it says: it is
       * `getToken` finding a browser `PushSubscription` whose FCM registration
       * has already been deleted, and being refused when it asks FCM to delete
       * it again. A sign-out used to leave exactly that orphan behind, so the
       * next sign-in could never register.
       *
       * Dropping the local subscription removes the thing being reconciled,
       * and the second attempt starts from nothing. Once only — a second
       * failure is a real one, and the Web Push fallback below is the answer to
       * it rather than another retry. */
      const orphan = await registration.pushManager
        .getSubscription()
        .catch(() => null);
      if (orphan) {
        console.warn("[FCM] Clearing a stale subscription and retrying.", fcmFailure);
        await orphan.unsubscribe().catch(() => {});
        try {
          token = await getToken(messaging, {
            vapidKey: VAPID_KEY,
            serviceWorkerRegistration: registration,
          });
          if (token) fcmFailure = null;
        } catch (retryError) {
          fcmFailure =
            retryError instanceof Error ? retryError.message : String(retryError);
        }
      }
    }

    if (!token) {
      console.warn(
        "[FCM] No token — falling back to Web Push.",
        fcmFailure ?? "getToken returned nothing",
      );
      /**
       * **The fallback THROWS as often as it returns nothing.**
       *
       * `pushManager.subscribe` rejects when the browser cannot register with
       * the push service, and that rejection used to fly straight past this
       * block to the outer `catch` — which reports the raw browser string and
       * knows nothing about the FCM attempt that came before it. So the one
       * message written to explain that BOTH routes were tried was produced
       * only in the case where the fallback quietly returned null, and never in
       * the case that actually happens.
       */
      let webPushFailure: string | null = null;
      if ("PushManager" in window) {
        try {
          const subscription = await subscribeWebPush(registration);
          if (subscription) {
            await saveToken(employeeId, subscription);
            onMessage(messaging, () => { });
            return { state: "on", detail: null };
          }
        } catch (e) {
          webPushFailure = e instanceof Error ? e.message : String(e);
        }
      }
      return {
        state: "failed",
        detail: describePushFailure(fcmFailure, webPushFailure),
      };
    }

    await saveToken(employeeId, token);

    /* Foreground messages are deliberately swallowed. The bell and the
       notifications page read the same Firestore row the push was built from,
       so rendering a system notification over an app that is already open and
       already showing it is the double-notification the service worker's empty
       `onBackgroundMessage` exists to avoid. */
    onMessage(messaging, () => { });
    return { state: "on", detail: null };
  } catch (e) {
    /* Surfaced, not swallowed. The previous version logged this and returned,
       so a Firestore rule refusal or a service-worker failure looked exactly
       like "nothing happened". */
    const detail = e instanceof Error ? e.message : String(e);
    console.warn("[FCM] Push registration failed:", detail);
    return { state: "failed", detail };
  }
}

/**
 * The automatic attempt, on sign-in.
 *
 * Kept because it succeeds on any origin the person already uses — which is
 * every real deployment. Where the browser suppresses the prompt it now leaves
 * a reportable state behind instead of nothing, and `usePushRegistration`
 * renders the button that asks properly.
 */
export function useFCMToken(employeeId: string | null): void {
  useEffect(() => {
    if (!employeeId) return;
    if (typeof window === "undefined" || !("Notification" in window)) return;

    /* **Only ever silent. This never raises the browser's prompt.**
     *
     * It used to call `registerPush` regardless, which asks for permission when
     * none has been granted. A permission request that no click asked for is
     * the pattern browsers penalise: Chrome's quieter-permissions behaviour
     * suppresses it outright on a low-engagement origin, `requestPermission()`
     * resolves to `default` with nothing shown, and the person is left never
     * having been asked — while the app believes it asked and was refused.
     *
     * So the automatic path now runs for ONE case: permission is already
     * granted. That is the returning visitor, and re-registering them silently
     * on every sign-in is what keeps a device reachable after a token rotates
     * or a sign-out released it.
     *
     * Everybody else is asked by `NotificationPrompt`, in the app, and the
     * browser's own prompt follows their click — which browsers always honour. */
    if (Notification.permission !== "granted") return;

    let cancelled = false;
    void registerPush(employeeId).then((r) => {
      if (!cancelled) publish(r);
    });
    return () => {
      cancelled = true;
    };
  }, [employeeId]);
}

/**
 * Whether this browser has been asked in-app already.
 *
 * Kept in `localStorage` rather than derived from `Notification.permission`,
 * because "default" cannot distinguish *never asked* from *asked and closed the
 * banner*. Asking again on every page load would make the product nag.
 *
 * Per browser profile, which is the right grain: permission is per origin per
 * profile too, so a colleague signing in on the same machine is genuinely a
 * different answer to the same question.
 */
const ASKED_KEY = "cowork.push.asked";

export function hasBeenAskedForPush(): boolean {
  try {
    return window.localStorage.getItem(ASKED_KEY) === "1";
  } catch {
    /* Storage disabled. Treat as asked, so a browser that cannot remember the
       answer is not asked on every single navigation. */
    return true;
  }
}

export function rememberAskedForPush(): void {
  try {
    window.localStorage.setItem(ASKED_KEY, "1");
  } catch {
    /* Nothing to do — the banner simply reappears next time. */
  }
}

/* ── The registration, as a tiny external store ───────────────────────────────
 *
 * One browser has one registration however many components ask about it, so
 * this is module state with subscribers rather than context — the same shape
 * `useNow` uses, and for the same reason: `useSyncExternalStore` is the one API
 * that lets the server and the client render deliberately different things.
 *
 * The alternative — an effect that inspects `Notification.permission` and calls
 * `setState` — is what the first version did, and it trips
 * `react-hooks/set-state-in-effect`: a synchronous set inside an effect
 * cascades a second render on every mount. There are already three of those in
 * this codebase and they are lint errors; this must not become a fourth.
 *
 * Every snapshot returns a STABLE reference. A fresh object per call would make
 * `useSyncExternalStore` re-render forever.
 */

const IDLE: PushResult = { state: "idle", detail: null };
const UNSUPPORTED: PushResult = {
  state: "unsupported",
  detail: "This browser cannot show notifications.",
};
const BLOCKED: PushResult = {
  state: "blocked",
  detail:
    "Notifications are blocked for this site. Allow them in your browser's site settings, then try again.",
};

let lastResult: PushResult = IDLE;
const listeners = new Set<() => void>();

function publish(result: PushResult): void {
  lastResult = result;
  for (const l of listeners) l();
}

function subscribePush(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
  };
}

/**
 * What to show right now.
 *
 * An attempt that has run wins, because it knows more than the permission does:
 * "granted, and the write failed" and "granted, and it worked" are the same
 * permission and very different states. Only when nothing has been attempted
 * does the browser's own permission decide.
 */
function pushSnapshot(): PushResult {
  if (lastResult !== IDLE) return lastResult;
  if (typeof window === "undefined" || !("Notification" in window)) {
    return UNSUPPORTED;
  }
  if (Notification.permission === "denied") return BLOCKED;
  return IDLE;
}

/** The server has no browser to ask, and must not guess at one. */
function serverPushSnapshot(): PushResult {
  return IDLE;
}

/**
 * Push registration as something a person can see and switch on.
 *
 * The button is the point. A browser always honours a permission request that
 * came from a click, and silently ignores one that did not — so on any origin
 * where the automatic attempt is suppressed, this is the only thing that works.
 */
export function usePushRegistration(employeeId: string | null): {
  state: PushState;
  detail: string | null;
  enable: () => void;
} {
  const result = useSyncExternalStore(
    subscribePush,
    pushSnapshot,
    serverPushSnapshot,
  );

  /* An event handler, not an effect — which is both what makes the browser
     honour the permission request and what keeps this off the lint rule. */
  const enable = useCallback(() => {
    if (!employeeId) return;
    publish({ state: "working", detail: null });
    void registerPush(employeeId).then(publish);
  }, [employeeId]);

  return { state: result.state, detail: result.detail, enable };
}
