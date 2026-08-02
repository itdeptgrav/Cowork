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

import { useEffect } from "react";

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
 * Ported verbatim. Its purpose is that reinstalling or clearing the cache
 * OVERWRITES the previous token for the same device rather than adding a
 * second one — `tokens: arrayUnion(...)` alone only ever grows, so a person
 * changing browsers monthly accumulates dead tokens that every push then tries
 * and fails to deliver to.
 *
 * Alphanumeric only, because it is used as a Firestore FIELD name.
 */
function deviceKey(): string {
  const raw = `${navigator.userAgent}_${window.screen.width}x${window.screen.height}_${navigator.language}`;
  let hash = 0;
  for (let i = 0; i < raw.length; i++) {
    hash = (hash << 5) - hash + raw.charCodeAt(i);
    hash |= 0;
  }
  return `dev${Math.abs(hash).toString(36)}`;
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

  /* Reuse an existing subscription rather than creating a second one for the
     same device — `subscribe` with a different key would otherwise throw, and
     with the same key returns the existing one anyway. */
  const existing = await registration.pushManager.getSubscription();
  const subscription =
    existing ??
    (await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToBytes(body.publicKey),
    }));

  return JSON.stringify(subscription.toJSON());
}

async function saveToken(employeeId: string, token: string): Promise<void> {
  const { arrayUnion, doc, serverTimestamp, setDoc } = await import(
    "firebase/firestore"
  );
  const { legacyDb } = await import("../legacy/firebase.ts");
  await setDoc(
    doc(legacyDb(), "cowork_fcm_tokens", employeeId),
    {
      employeeId,
      [deviceKey()]: token,
      tokens: arrayUnion(token),
      latestToken: token,
      updatedAt: serverTimestamp(),
      platform: "web",
      userAgent: navigator.userAgent.slice(0, 100),
    },
    { merge: true },
  );
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

    if (!stored) {
      const subscription = await registration.pushManager
        .getSubscription()
        .catch(() => null);
      if (subscription) {
        stored = JSON.stringify(subscription.toJSON());
        await subscription.unsubscribe().catch(() => {});
      }
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

export function useFCMToken(employeeId: string | null): void {
  useEffect(() => {
    if (!employeeId) return;
    if (typeof window === "undefined") return;
    if (!("Notification" in window) || !("serviceWorker" in navigator)) return;
    /* Never re-ask somebody who has already said no. The browser would refuse
       anyway, and on some it counts against the origin permanently. */
    if (Notification.permission === "denied") return;

    let cancelled = false;

    void (async () => {
      try {
        if (Notification.permission !== "granted") {
          const permission = await Notification.requestPermission();
          if (permission !== "granted") return;
        }
        if (cancelled) return;

        const registration = await navigator.serviceWorker.register(
          "/firebase-messaging-sw.js",
          { scope: "/" },
        );
        await navigator.serviceWorker.ready;
        if (cancelled) return;

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
        const fcmSupported = await isSupported().catch(() => false);
        if (cancelled) return;

        if (!fcmSupported) {
          if (!("PushManager" in window)) return;
          const subscription = await subscribeWebPush(registration);
          if (!subscription || cancelled) return;
          await saveToken(employeeId, subscription);
          return;
        }

        /* Checked HERE rather than at the top of the effect: the Web Push path
           above fetches its key from the server and does not need this one, so
           an unset variable must not turn iOS off as well. */
        if (!VAPID_KEY) {
          console.warn(
            "[FCM] NEXT_PUBLIC_FIREBASE_VAPID_KEY is not set — push is off on this browser. In-app notifications are unaffected.",
          );
          return;
        }

        /* The SAME named app the rest of the product uses (`cowork-legacy`),
           not a second default one — messaging registered against a different
           app instance would carry a different sender and the token would be
           rejected by the project that sends the push. */
        const { legacyFirebase } = await import("../legacy/firebase.ts");
        const messaging = getMessaging(legacyFirebase().app);
        const token = await getToken(messaging, {
          vapidKey: VAPID_KEY,
          serviceWorkerRegistration: registration,
        });
        if (!token || cancelled) return;

        await saveToken(employeeId, token);

        /* Foreground messages are deliberately swallowed. The bell and the
           notifications page read the same Firestore row the push was built
           from, so rendering a system notification over an app that is already
           open and already showing it is the double-notification the old app's
           empty `onBackgroundMessage` exists to avoid. */
        onMessage(messaging, () => { });
      } catch (e) {
        /* Push is an enhancement. A failure here must never surface as an
           error in an app whose notifications work without it. */
        console.warn(
          "[FCM] Push registration failed:",
          e instanceof Error ? e.message : e,
        );
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [employeeId]);
}
