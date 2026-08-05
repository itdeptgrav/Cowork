import assert from "node:assert/strict";
import { test } from "node:test";
import { existsSync, readFileSync } from "node:fs";

/**
 * API routes accept the sign-in that real staff actually have.
 *
 * **The defect this pins.** The product has two sign-in systems — the
 * `cowork_session` record issued by `/api/auth/signup`, and the Firebase ID
 * token cookie written by `SignInForm`, which is the path every existing
 * employee uses. `middleware.ts` gates pages on the Firebase token, so those
 * employees could open every screen. `/api/livekit/token` asked
 * `currentSession()` alone, so it answered **401 to all of them**, and going
 * online was impossible for the whole company. It is in the dev log as
 * `GET /api/livekit/token?identity=employee-GR0000 401` for a signed-in CEO.
 *
 * It became load-bearing the moment task actions were gated on presence: no
 * token, no room; no room, never online; never online, unable to start a timer
 * or advance your own work. So this is not a convenience — it is the thing that
 * makes the offline restriction survivable.
 *
 * Source-read rather than executed: these are `server-only` modules that reach
 * for `next/headers` and Google's JWKS, neither of which exists under plain
 * `node --test`. What is asserted is that the check is wired in and fails
 * closed, which is what regressed.
 */

const apiAuth = readFileSync("lib/server/apiAuth.ts", "utf8");
const livekit = readFileSync("app/api/livekit/token/route.ts", "utf8");
const meetings = readFileSync("app/api/meetings/token/route.ts", "utf8");
/* Renamed from `middleware.ts` to `proxy.ts` (exporting `proxy`). The test
   reads whichever is present, so the rename does not silently stop this from
   guarding anything — a missing file here would pass as "no violations". */
const MIDDLEWARE_PATH = existsSync("proxy.ts") ? "proxy.ts" : "middleware.ts";
const middleware = readFileSync(MIDDLEWARE_PATH, "utf8");

test("both sign-in systems are accepted", () => {
  assert.match(apiAuth, /currentSession/, "the session record path is missing");
  assert.match(apiAuth, /readFirebaseCookie/, "the Firebase path is missing");
});

test("the Firebase branch verifies the SIGNATURE, not just the claims", () => {
  /* Reading claims alone is a token anybody can write, and it is the exact
     bypass that was closed in `middleware.ts` — where a forged unsigned token
     returned 200 on `/team`. Re-opening it in an API route would be the same
     hole through a different door. */
  assert.match(apiAuth, /verifyIdToken/);
  assert.match(
    middleware,
    /verifyIdToken/,
    "the middleware's own check moved — this test's premise needs rechecking",
  );
});

test("it fails closed on every path that cannot verify", () => {
  /* A missing project id means no way to check a signature. Treating that as
     "signed in" would turn a misconfigured deployment into an open door. */
  assert.match(apiAuth, /if \(!projectId\) return false;/);
  assert.match(apiAuth, /if \(!token\) return false;/);
  assert.match(apiAuth, /catch \{\s*return false;\s*\}/);
});

test("the presence token route uses it", () => {
  assert.match(livekit, /isSignedInRequest/);
  assert.equal(
    livekit.includes("currentSession"),
    false,
    "the route still has the one-system check that 401'd every employee",
  );
});

test("the seat split is untouched by the auth change", () => {
  /* Widening WHO may ask for a token must not widen what a token can do. A
     watcher still cannot publish and a publisher still cannot subscribe. */
  assert.match(livekit, /canPublish: isPublisher/);
  assert.match(livekit, /canSubscribe: isWatcher/);
  assert.match(livekit, /room: ROOM_NAME/, "the room is still pinned");
});

test("the meetings route resolves an identity instead of refusing", () => {
  /* **This test used to assert the opposite, and was wrong for as long as it
     did.** The route was once left deliberately unfixed: it mints a token AS a
     named person, and a verified Firebase token carries a uid rather than the
     workspace employee id — so refusing honestly beat guessing the mapping and
     putting somebody into a meeting under another person's name.
     `mailPrincipal` closed that by ASKING the engine: `/cowork/me` verifies the
     token and answers with the workspace id, so the mapping is looked up rather
     than guessed. The refusal this test was guarding no longer exists, and a
     test still describing it fails on every run while telling whoever reads it
     that meetings cannot authenticate. */
  assert.match(meetings, /mailPrincipal/);
  assert.match(
    meetings,
    /if \(!principal\)/,
    "the route no longer fails closed when the caller cannot be named",
  );
});

test("the seat is minted for the PRINCIPAL, never for whoever the body names", () => {
  /* The one thing that must not drift. The participant grid is how people know
     who is in the room, so a caller able to name its own identity could sit in
     a meeting under somebody else's name. `room`, `displayName` and
     `isOrganiser` are read from the body; `identity` must not be. */
  assert.match(meetings, /identity: principal\.employeeId/);
  assert.equal(
    /"identity" in body|body as \{ identity/.test(meetings),
    false,
    "the route reads an identity from the request body",
  );
});
