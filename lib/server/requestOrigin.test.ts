import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { callbackOrigin } from "./requestOrigin.ts";

/**
 * Reported 17 Aug 2026: after Gmail consent the browser landed on
 * `http://0.0.0.0:3000/settings` — `ERR_ADDRESS_INVALID`. Both callers ran
 * `next dev -H 0.0.0.0`, and `request.url` reports the BIND address rather
 * than the host the browser used, so the callback's "return to the origin the
 * request arrived at" rule was fed the one origin no browser can reach.
 */

test("the browser's Host header is the origin, not the framework's URL", () => {
  /* The reported case exactly: bound to 0.0.0.0, browsed as localhost. */
  assert.equal(
    callbackOrigin({
      requestUrl: "http://0.0.0.0:3000/api/mail/gmail/callback?code=x",
      hostHeader: "localhost:3000",
    }),
    "http://localhost:3000",
  );
});

test("127.0.0.1 in the address bar stays 127.0.0.1", () => {
  /* The rule this preserves: localhost and 127.0.0.1 are DIFFERENT origins to
     the cookie jar, so the flow must land on whichever the person browsed
     under — never a canonical name that loses their session. */
  assert.equal(
    callbackOrigin({
      requestUrl: "http://0.0.0.0:3000/api/mail/gmail/callback",
      hostHeader: "127.0.0.1:3000",
    }),
    "http://127.0.0.1:3000",
  );
});

test("no Host header falls back to the redirect URI Google was given", () => {
  /* Google only ever redirected the browser to GOOGLE_REDIRECT_URI, so its
     origin is reachable by construction. */
  assert.equal(
    callbackOrigin({
      requestUrl: "http://0.0.0.0:3000/api/mail/gmail/callback",
      hostHeader: null,
      configuredRedirectUri: "http://localhost:3000/api/mail/gmail/callback",
    }),
    "http://localhost:3000",
  );
});

test("nothing configured still never sends a browser to a bind address", () => {
  assert.equal(
    callbackOrigin({
      requestUrl: "http://0.0.0.0:3000/x",
      hostHeader: null,
      configuredRedirectUri: null,
    }),
    "http://localhost:3000",
  );
  /* IPv6 any-address too. */
  assert.equal(
    callbackOrigin({ requestUrl: "http://[::]:3000/x", hostHeader: null }),
    "http://localhost:3000",
  );
});

test("a proxy's forwarded scheme wins over the internal one", () => {
  /* Behind TLS termination the internal hop is http; sending the browser to
     http would drop them out of the secure origin their cookie lives on. */
  assert.equal(
    callbackOrigin({
      requestUrl: "http://0.0.0.0:3000/x",
      hostHeader: "cowork.grav.in",
      forwardedProto: "https",
    }),
    "https://cowork.grav.in",
  );
});

test("an ordinary localhost request passes through untouched", () => {
  assert.equal(
    callbackOrigin({
      requestUrl: "http://localhost:3000/api/mail/gmail/callback",
      hostHeader: "localhost:3000",
    }),
    "http://localhost:3000",
  );
});

test("a reset link never carries a bind address to the person who receives it", () => {
  /**
   * The admin credential-link route builds a URL an ADMINISTRATOR copies and
   * sends. `http://0.0.0.0:3000/reset-password?token=…` is a dead link handed
   * to somebody with no way to diagnose it, so the fallback there is
   * `NEXT_PUBLIC_APP_URL` — the address the install is actually reached at.
   */
  const origin = callbackOrigin({
    requestUrl: "http://0.0.0.0:3000/api/auth/admin/credential-link",
    hostHeader: null,
    configuredRedirectUri: "http://127.0.0.1:3000",
  });
  assert.equal(origin, "http://127.0.0.1:3000");
  assert.equal(origin.includes("0.0.0.0"), false);
});

test("both callers use the helper rather than request.url", () => {
  /* The regression is one expression, and it reappeared in two routes
     independently. Pinned in both. */
  for (const route of [
    "app/api/mail/gmail/callback/route.ts",
    "app/api/auth/admin/credential-link/route.ts",
  ]) {
    const src = readFileSync(route, "utf8");
    assert.match(src, /callbackOrigin\(\{/, `${route} stopped using the helper`);
    assert.equal(
      /const origin = new URL\(request\.url\)\.origin/.test(src),
      false,
      `${route} reads the bind address again`,
    );
  }
});
