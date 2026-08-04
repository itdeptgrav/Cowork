import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

/**
 * The service worker must not pin development build output.
 *
 * ## The bug this exists to stop coming back
 *
 * `/_next/static/` was cached FIRST, justified by "the URL contains the hash, so
 * it cannot change". True of `next build`; false of `next dev`, where Turbopack
 * reuses stable chunk names (`components_1h3b84h._.js`) and one URL serves
 * different bytes on every save. Cache-first pinned whichever copy the browser
 * saw first and served it forever.
 *
 * What that looked like was not a caching problem. It looked like a code bug: a
 * tab throwing `useRepo is not defined` from a module whose source had not
 * called `useRepo` in days, while the dev server served correct bytes. It
 * survived reloads, a deleted `.next` and server restarts, because the stale
 * copy was in Cache Storage rather than on any disk.
 *
 * The worker is a static file with no bundler, so it is EXECUTED here — the real
 * file, against a fake `self` — rather than grepped. A previous test in this
 * repository matched comment prose and passed while the code disagreed with it;
 * running the thing is the only assertion that cannot do that.
 */

const SW = readFileSync("public/firebase-messaging-sw.js", "utf8");

interface FetchCall {
  respondWithCalled: boolean;
}

/**
 * Run the worker with a fake global and fire one `fetch` event at it.
 *
 * Returns whether the worker took over the request. Not taking over — no
 * `respondWith` — is how a worker says "let the browser do this normally",
 * which is exactly what development output needs.
 */
function dispatchFetch(hostname: string, pathname: string): FetchCall {
  const listeners: Record<string, ((e: unknown) => void)[]> = {};
  const call: FetchCall = { respondWithCalled: false };

  const self = {
    location: { hostname, origin: `http://${hostname}:3000` },
    addEventListener: (type: string, fn: (e: unknown) => void) => {
      (listeners[type] ??= []).push(fn);
    },
    skipWaiting: () => {},
    clients: { claim: () => {}, matchAll: async () => [], openWindow: async () => {} },
    registration: { showNotification: async () => {}, scope: `http://${hostname}:3000/` },
  };

  const caches = {
    match: async () => undefined,
    open: async () => ({ put: async () => {}, addAll: async () => {} }),
    keys: async () => [],
    delete: async () => true,
  };

  const fn = new Function(
    "self",
    "caches",
    "fetch",
    "Response",
    "URL",
    "console",
    SW,
  );
  fn(
    self,
    caches,
    async () => ({ ok: true, clone: () => ({}), headers: { get: () => "" } }),
    class {},
    URL,
    { log: () => {}, warn: () => {}, error: () => {} },
  );

  const event = {
    request: {
      method: "GET",
      url: `http://${hostname}:3000${pathname}`,
      mode: "no-cors",
    },
    respondWith: () => {
      call.respondWithCalled = true;
    },
    waitUntil: () => {},
  };
  for (const fire of listeners.fetch ?? []) fire(event);
  return call;
}

test("dev build output is left to the browser, never cached", () => {
  /* The whole bug in one assertion. If this fails, a dev chunk can be pinned in
     Cache Storage and the tab will run code that exists in no build. */
  const call = dispatchFetch("localhost", "/_next/static/chunks/components_1h3b84h._.js");
  assert.equal(
    call.respondWithCalled,
    false,
    "the worker took over a dev chunk — cache-first would pin it",
  );
});

test("127.0.0.1 and ::1 count as development too", () => {
  for (const host of ["127.0.0.1", "[::1]"]) {
    assert.equal(
      dispatchFetch(host, "/_next/static/chunks/x._.js").respondWithCalled,
      false,
      `${host} was treated as production`,
    );
  }
});

test("production build output is still served by the worker", () => {
  /* The offline story depends on this: a deployed build IS content-addressed,
     and caching it is the point of having a worker at all. */
  assert.equal(
    dispatchFetch("cowork.grav.in", "/_next/static/chunks/main-abc123.js")
      .respondWithCalled,
    true,
    "production build output is no longer cached — offline support is gone",
  );
});

test("the worker only stores what the server calls immutable", () => {
  /* Belt and braces with the host check: an asset that is not content-addressed
     must never be pinned, whatever host serves it. */
  const fn = new Function("return " + /function isImmutable[\s\S]*?\n}/.exec(SW)![0])();
  const cc = (value: string) => ({ headers: { get: () => value } });

  assert.equal(fn(cc("public, max-age=31536000, immutable")), true);
  assert.equal(fn(cc("no-store")), false);
  assert.equal(fn(cc("no-cache")), false);
  assert.equal(fn(cc("")), false, "no header at all must not be treated as immutable");
  assert.equal(fn(cc("max-age=60")), false, "a short max-age is not immutable");
  assert.equal(fn(cc("max-age=86400")), true);
});

test("the version was bumped, or the fix ships without evicting the bad cache", () => {
  /* The activate handler deletes every `cowork-*` cache not in `keep`, so the
     version bump IS the recovery. Shipping the fix at v1.0.0 would leave the
     poisoned chunks in place on every machine that already has them. */
  const version = /const SW_VERSION = "([^"]+)"/.exec(SW)?.[1];
  assert.ok(version, "SW_VERSION not found");
  assert.notEqual(
    version,
    "1.0.0",
    "still v1.0.0 — the caches that hold the stale chunks would survive",
  );
});
