// public/firebase-messaging-sw.js
//
// Background push for Cowork.
//
// ## No Firebase SDK, and that is the point
//
// This used to begin with two `importScripts` calls to `gstatic.com` and let
// `firebase-messaging-compat` render the notification. Three problems, and the
// first is why it did not work in every browser:
//
//  1. **A service worker that fails to evaluate registers NO handlers.** If
//     either fetch is blocked — Edge's tracking prevention, a corporate proxy,
//     an offline cold start, a CDN blip — the whole file throws at line one and
//     the browser is left with a worker that handles nothing. There is no
//     partial success and nothing on screen says so.
//  2. **It put a network round trip on the notification hot path.** Every push
//     wakes the worker, which re-runs this file top to bottom before anything
//     can be shown.
//  3. **Two things wanted to render the same push.** The SDK's own listener and
//     the one below, which is how an empty "Cowork" notification ended up
//     stacked on top of the real one.
//
// A push is a `push` event carrying JSON. Displaying it needs no SDK, so this
// file has no dependencies, no network, and one code path for both senders.
//
// **`getToken()` still works.** The Firebase SDK on the PAGE takes this
// registration and calls `pushManager.subscribe()` on it — what the worker
// imports is irrelevant to that. The only thing given up is foreground
// `onMessage`, which this product deliberately ignores anyway: the bell reads
// the same Firestore row the push was built from, so rendering a system
// notification over an app that is already showing it is the double this
// avoids.

// ── Version ──────────────────────────────────────────────────────────────────
//
// Bumped by hand when this file changes in a way that must invalidate the
// caches below. The browser already reinstalls the worker on any byte change;
// this is what decides whether the OLD caches survive that reinstall, and it is
// also what `/settings` reports as the installed version.
// 1.1.0 — the bump is the RECOVERY, not bookkeeping. v1.0.0 cache-first'd
// `/_next/static/` on dev hosts and pinned stale chunks in Cache Storage; the
// activate handler below deletes every `cowork-*` cache that is not in `keep`,
// so installing this version is what evicts the poisoned copies. Without the
// bump the fix would ship and the bad bytes would stay.
const SW_VERSION = "1.2.0";
const STATIC_CACHE = `cowork-static-v${SW_VERSION}`;
const ASSET_CACHE = `cowork-assets-v${SW_VERSION}`;
const OFFLINE_URL = "/offline";

/* Precached on install: the one page that must render when the network is
   gone, and the icons it and every notification refer to. Deliberately short —
   a precache listing app routes would go stale on every deploy. */
const PRECACHE = [
  OFFLINE_URL,
  "/icon-192.png",
  "/icon-512.png",
  "/icon-maskable-512.png",
  "/manifest.json",
];

// ── Take over immediately on change ──────────────────────────────────────────
//
// Without these two, a changed worker installs and then sits in `waiting` until
// every tab on this origin is closed — not reloaded, CLOSED. The previous
// version keeps handling pushes in the meantime, so a fix to this file appears
// to do nothing, which is exactly what happened to the empty-notification fix
// below: it shipped, the page was reloaded, and the old worker was still the
// one rendering.
//
// `skipWaiting` promotes the new worker as soon as it installs; `clients.claim`
// puts already-open pages under it rather than leaving them with the old one
// until they navigate.
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches
            .open(STATIC_CACHE)
            // `reload` bypasses the HTTP cache, so a reinstall genuinely refetches
            // rather than precaching whatever the browser already held.
            .then((cache) => cache.addAll(PRECACHE.map((u) => new Request(u, { cache: 'reload' }))))
            // A precache miss must not abort the install. Push and navigation
            // still work without the offline page; refusing to install would
            // leave the previous worker in charge of everything.
            .catch((e) => console.warn('[SW] precache incomplete:', e && e.message))
            .then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        (async () => {
            // Drop caches from previous versions. Without this every deploy
            // leaves its own copy behind and storage grows without bound.
            const keep = new Set([STATIC_CACHE, ASSET_CACHE]);
            const names = await caches.keys();
            await Promise.all(
                names.filter((n) => n.startsWith('cowork-') && !keep.has(n)).map((n) => caches.delete(n))
            );
            // Navigation preload lets the browser start the network request in
            // parallel with booting this worker, which removes the startup cost
            // this file would otherwise add to every navigation.
            if (self.registration.navigationPreload) {
                await self.registration.navigationPreload.enable().catch(() => {});
            }
            await self.clients.claim();
        })()
    );
});

/**
 * Whether this is a development server.
 *
 * A worker has no build-time environment — it is a static file served as-is —
 * so the host is the only signal available at runtime. These three are the ones
 * `next dev` binds, and a production deployment is never reached at any of them.
 */
const DEV_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);
function isDevHost() {
    return DEV_HOSTS.has(self.location.hostname);
}

/**
 * Whether the server has promised this URL's bytes will never change.
 *
 * The only condition under which cache-first is correct. `immutable`, or a
 * max-age long enough that it can only mean a content-addressed asset — Next
 * sends `max-age=31536000, immutable` for real build output, and `no-store` or
 * a short max-age for anything it may re-emit.
 */
function isImmutable(res) {
    const cc = res.headers.get('Cache-Control') || '';
    if (/no-store|no-cache/i.test(cc)) return false;
    if (/immutable/i.test(cc)) return true;
    const maxAge = /max-age\s*=\s*(\d+)/i.exec(cc);
    return maxAge ? Number(maxAge[1]) >= 86400 : false;
}

// ── Fetch ────────────────────────────────────────────────────────────────────
//
// **What is deliberately NOT cached, and why it matters more than what is.**
//
// Every page in this product is behind a session, and a cached HTML response is
// a document rendered for whoever fetched it. Serving that from cache on a
// shared desk would show one person another person's workspace. So navigations
// are network-first and their responses are never stored — the only fallback is
// the offline page, which contains nobody's data.
//
// API and auth responses are not cached for the same reason, and neither is
// anything cross-origin: Firestore and the engine both answer per-identity and
// a stale answer there is worse than no answer.
//
// What IS cached is content-addressed or public: Next's hashed build output,
// which cannot change under a given URL, and the icons and fonts in /public.
self.addEventListener('fetch', (event) => {
    const request = event.request;
    if (request.method !== 'GET') return;

    const url = new URL(request.url);
    if (url.origin !== self.location.origin) return;
    // Never intercept the auth or API surface, nor the worker itself.
    if (url.pathname.startsWith('/api/')) return;
    if (url.pathname === '/firebase-messaging-sw.js') return;

    // ── Navigations: network first, offline page as the floor ────────────────
    if (request.mode === 'navigate') {
        event.respondWith(
            (async () => {
                // **A failed preload is not "offline".**
                //
                // `preloadResponse` REJECTS when the browser's parallel request
                // fails, and it can fail for reasons the ordinary fetch would
                // survive — a redirect it will not follow, a connection reused
                // at the wrong moment, preload racing the worker's own startup.
                // Catching it together with `fetch` below meant any of those
                // showed the offline page to somebody with a working
                // connection. It is caught separately and discarded, so a
                // preload that did not work costs nothing but the parallelism.
                const preloaded = await Promise.resolve(event.preloadResponse).catch(
                    () => null
                );
                if (preloaded) return preloaded;

                try {
                    return await fetch(request);
                } catch (_) {
                    // Offline. Show our own page rather than the browser's
                    // dinosaur, which tells somebody nothing about whether their
                    // work was saved.
                    const cached = await caches.match(OFFLINE_URL);
                    return (
                        cached ||
                        new Response('<h1>Offline</h1>', {
                            status: 503,
                            headers: { 'Content-Type': 'text/html; charset=utf-8' },
                        })
                    );
                }
            })()
        );
        return;
    }

    // ── Build output ─────────────────────────────────────────────────────────
    //
    // **Cache-first here is only safe because the URL is content-addressed —
    // and in development it is NOT.**
    //
    // This branch used to be unconditionally cache-first, justified by "the URL
    // contains the hash, so it cannot change". That is true of `next build`, and
    // false of `next dev`: Turbopack reuses stable chunk names
    // (`components_1h3b84h._.js`) across edits, so one URL serves different
    // bytes every time a file is saved. Cache-first pinned whichever version the
    // browser saw FIRST, and served it forever.
    //
    // The result was a tab running code that existed in no build: the source was
    // correct, the dev server was serving correct bytes, and the browser threw
    // `useRepo is not defined` from a module that had not called it in days.
    // Nothing fixed it, because the stale copy was in Cache Storage — it
    // survived reloads, a deleted `.next`, and server restarts alike.
    //
    // So development is left entirely alone: no `respondWith`, so the browser
    // fetches normally and nothing is stored. There is nothing to gain by
    // caching dev output anyway — the server is on this machine.
    if (url.pathname.startsWith('/_next/static/')) {
        if (isDevHost()) return;
        event.respondWith(
            caches.match(request).then(
                (hit) =>
                    hit ||
                    fetch(request).then((res) => {
                        // Stored only when the SERVER says the URL is immutable.
                        // Belt and braces with the host check above: an asset
                        // that is not content-addressed must never be pinned,
                        // whatever host is serving it.
                        if (res.ok && isImmutable(res)) {
                            const copy = res.clone();
                            caches.open(ASSET_CACHE).then((c) => c.put(request, copy));
                        }
                        return res;
                    })
            )
        );
        return;
    }

    // ── Public assets: serve cached, refresh in the background ───────────────
    if (/\.(png|jpe?g|svg|gif|webp|ico|woff2?|ttf|otf)$/i.test(url.pathname)) {
        event.respondWith(
            caches.match(request).then((hit) => {
                const network = fetch(request)
                    .then((res) => {
                        if (res.ok) {
                            const copy = res.clone();
                            caches.open(ASSET_CACHE).then((c) => c.put(request, copy));
                        }
                        return res;
                    })
                    .catch(() => hit);
                // Cached first when there is one: an icon that is one deploy old
                // is not worth a blocking round trip.
                return hit || network;
            })
        );
    }
});

// ── Messages from the page ───────────────────────────────────────────────────
//
// The Settings screen drives the worker through these rather than reaching into
// `caches` itself, so the naming scheme lives in exactly one file.
self.addEventListener('message', (event) => {
    const data = event.data || {};
    if (data.type === 'SKIP_WAITING') {
        self.skipWaiting();
        return;
    }
    if (data.type === 'GET_VERSION') {
        event.ports[0] && event.ports[0].postMessage({ version: SW_VERSION });
        return;
    }
    if (data.type === 'CLEAR_CACHES') {
        event.waitUntil(
            caches
                .keys()
                .then((names) =>
                    Promise.all(names.filter((n) => n.startsWith('cowork-')).map((n) => caches.delete(n)))
                )
                .then(() => {
                    event.ports[0] && event.ports[0].postMessage({ cleared: true });
                })
                .catch(() => {
                    event.ports[0] && event.ports[0].postMessage({ cleared: false });
                })
        );
    }
});

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

// ── Push — BOTH senders, one handler ─────────────────────────────────────────
//
// The two backends deliver different shapes and this is now the only thing
// rendering either, so both are unwrapped here:
//
//   FCM  (admin.messaging)   { notification: { title, body }, data: {…} }
//   raw  (web-push, iOS)     { title, body, data: {…} }
//
// Reading `payload.title` off an FCM envelope yields `undefined`. When the SDK
// was still loaded and also rendering, that produced a second notification
// titled "Cowork" with an empty body stacked on the real one — the "+1
// notifications, no content" in the Windows tray. Unwrapping both shapes is
// what makes one handler correct for both.
self.addEventListener('push', (event) => {
    if (!event.data) return;

    let payload = null;
    try {
        payload = event.data.json();
    } catch (_) {
        return; // Not JSON. Nothing here can render it honestly.
    }
    if (!payload || typeof payload !== 'object') return;

    // FCM nests it; web-push does not. `data` carries the ids either way.
    const notification = payload.notification || payload;
    const data = { ...(payload.data || {}), ...(payload.fcmOptions || {}) };

    const title = notification.title;
    const body = notification.body || '';
    // No title means nothing worth showing. An empty notification is worse
    // than a missing one: it interrupts and says nothing.
    if (!title) return;

    event.waitUntil(
        self.registration.showNotification(title, {
            body,
            icon: '/icon-192.png',
            badge: '/icon-192.png',
            tag: 'cowork-' + (data.type || 'notif'),
            renotify: true,
            data,
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
