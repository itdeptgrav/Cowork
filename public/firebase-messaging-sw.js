// public/firebase-messaging-sw.js
//
// Background push for Cowork. Ported from the old app's service worker, with
// one deliberate difference — see ROUTING below.
//
// ## Why this file hard-codes the Firebase config
//
// A service worker is served as a static file and never sees `process.env`, so
// there is nothing to interpolate at runtime. These are the same six values as
// `NEXT_PUBLIC_FIREBASE_*` in `.env.local`, verified identical, and every one of
// them is public by design: the Firebase web `apiKey` identifies a project, it
// does not authorise anything. Access is decided by the ID token the app sends
// and by Firestore rules, neither of which is here.

importScripts('https://www.gstatic.com/firebasejs/10.7.1/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.7.1/firebase-messaging-compat.js');

firebase.initializeApp({
    apiKey: "AIzaSyDpswQ3pSlbxtmc-yWDgJD2GQWjfpK3ZXs",
    authDomain: "grav-cms-38f45.firebaseapp.com",
    projectId: "grav-cms-38f45",
    storageBucket: "grav-cms-38f45.firebasestorage.app",
    messagingSenderId: "51268280312",
    appId: "1:51268280312:web:1667f085583f9fe4b6c00d",
    databaseURL: "https://grav-cms-38f45-default-rtdb.firebaseio.com",
});

const messaging = firebase.messaging();

// ── ROUTING ──────────────────────────────────────────────────────────────────
//
// **`data.url` is deliberately ignored, and that is the difference from the old
// app.** `fcmPush.service.js` builds every payload with `url: "/coworking"` as a
// default that no caller overrides, and sets `webpush.fcmOptions.link` to the
// same. That is the OLD app's route. It does not exist here, so obeying either
// would land every push on a 404.
//
// So the destination is computed from `type` and the ids the engine already
// writes into `data` — the same inputs, in the same precedence, as
// `lib/rules/notifications/target.ts`. That duplication is real and cannot be
// removed: a service worker cannot import from `lib/`. It is pinned instead —
// `lib/rules/notifications/serviceWorkerParity.test.ts` fails the build if a
// type handled there is not handled here.

// Types that resolve to a surface rather than to a record of their own.
// Checked BEFORE the id fields, because a score event carries the id of the
// task it came from and opening that task answers the wrong question.
const TYPE_URLS = {
    emergency_requested: '/tasks?view=approvals',
    emergency_request: '/tasks?view=approvals',
    sop_bleach_applied: '/score/c3',
    sop_goal_credit: '/score/c3',
    sop_recheck_requested: '/score/c3',
    sop_recheck_confirmed: '/score/c3',
    sop_recheck_rejected: '/score/c3',
};

// Id fields in the order a person would want them opened. `topTaskId` before
// `taskId` because a priority reorder carries no `taskId` and the thing worth
// opening is whatever is now first in the queue.
const ID_ROUTES = [
    ['taskId', '/tasks/'],
    ['topTaskId', '/tasks/'],
    ['meetId', '/meetings/'],
    ['meetingId', '/meetings/'],
    ['documentId', '/workspace?doc='],
    ['conversationId', '/messages/'],
    ['groupId', '/groups/'],
];

function urlFor(data) {
    const d = data || {};
    const byType = TYPE_URLS[d.type];
    if (byType) return byType;

    for (const [field, prefix] of ID_ROUTES) {
        const raw = d[field];
        // Every value arrives String()'d by the sender, so "" and "undefined"
        // are both real possibilities and neither is an id.
        if (typeof raw === 'string' && raw.trim() && raw !== 'undefined' && raw !== 'null') {
            return prefix + encodeURIComponent(raw.trim());
        }
    }
    // The durable record exists whatever else is missing, so this is never a
    // dead end — unlike the old app's `/coworking` fallback.
    return '/notifications';
}

// ── Background message (FCM path — Chrome, Firefox, Edge, Android) ───────────
//
// Deliberately empty, and it has to stay that way. `fcmPush.service.js` sets
// `webpush.notification`, so Chrome renders the notification itself. Calling
// `showNotification` here as well is how you get every push twice.
messaging.onBackgroundMessage(() => { });

// ── Raw Web Push (iOS/iPadOS Safari, installed to Home Screen) ───────────────
//
// **This is a separate delivery path and FCM never sees it.** iOS subscriptions
// are `PushSubscription` JSON, and `fcmPush.service.js` splits them out of the
// token list and sends them through `web-push` — signed with the VAPID pair,
// not through Firebase. `onBackgroundMessage` above is an FCM SDK callback and
// does not fire for these, so without this handler an iPhone receives the push
// and displays nothing.
//
// Unlike the FCM path, nothing renders it for us: `web-push` delivers a raw
// payload, so `showNotification` here is required rather than a double.
self.addEventListener('push', (event) => {
    if (!event.data) return;

    let payload = {};
    try {
        payload = event.data.json();
    } catch (_) {
        payload = { title: 'Cowork', body: event.data.text() };
    }

    // `sendIOSWebPush` sends the flat `dataPayload`, which carries `title`,
    // `body`, `type` and whatever ids the notification was built with.
    const title = payload.title || 'Cowork';
    const body = payload.body || '';

    event.waitUntil(
        self.registration.showNotification(title, {
            body,
            icon: '/icon-192.png',
            badge: '/icon-192.png',
            tag: 'cowork-' + (payload.type || 'notif'),
            renotify: true,
            data: payload,
        })
    );
});

// ── Click ────────────────────────────────────────────────────────────────────
self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    const url = urlFor(event.notification.data);
    const fullUrl = self.location.origin + url;

    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
            const exact = list.find((c) => c.url === fullUrl);
            if (exact) return exact.focus();
            const anyTab = list.find((c) => c.url.startsWith(self.location.origin));
            if (anyTab) return anyTab.navigate(fullUrl).then((c) => c && c.focus());
            if (clients.openWindow) return clients.openWindow(fullUrl);
        })
    );
});
