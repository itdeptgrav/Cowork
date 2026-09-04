import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { TOKEN_TIMEOUT_MS } from "./firebase.ts";

/**
 * Restoring a session always terminates.
 *
 * **The reported fault.** The app sat on "Signing you in…" in a normal browser
 * and worked in incognito. That difference is the whole diagnosis: incognito
 * has no persisted Firebase session, and the normal browser does.
 *
 * Three waits stood between mount and a resolved session, and none of them was
 * bounded:
 *
 *  1. `onAuthStateChanged` firing at all. The SDK restores a persisted session
 *     asynchronously; if it wedges on a stale one it never fires, `load` is
 *     never called, and nothing rejects — so nothing retries.
 *  2. `getIdToken()`. Not a local read once the cached token has expired: it
 *     calls Google's token endpoint with the persisted refresh token, with no
 *     timeout of its own.
 *  3. `/cowork/me`. A transport failure here threw, and `load`'s catch
 *     deliberately swallowed it to avoid signing somebody out over a wifi
 *     blink — leaving the status at `loading` permanently.
 *
 * Each is now bounded, and each by the mechanism that can actually see it. The
 * source assertions below are the honest test available: reaching these paths
 * needs a wedged SDK and a browser, and what regresses is the wiring.
 */

const provider = readFileSync(
  "components/features/auth/SessionProvider.tsx",
  "utf8",
);
/* The shell is TWO modules since the workspace tree was split out of
   `ShellFrame.tsx` into `WorkspaceShell.tsx` — a bundle split, so that
   /signin stops downloading LiveKit. "Mounted in the shell" is still one
   claim, so both files are read as one text. */
const shell =
  readFileSync("components/layout/shell/ShellFrame.tsx", "utf8") +
  readFileSync("components/layout/shell/WorkspaceShell.tsx", "utf8");
const firebase = readFileSync("lib/legacy/firebase.ts", "utf8");

/* ── The token refresh ────────────────────────────────────────────────────── */

test("a token refresh cannot hang forever", () => {
  assert.ok(TOKEN_TIMEOUT_MS > 0);
  assert.ok(
    TOKEN_TIMEOUT_MS <= 15_000,
    "a bound nobody waits out is not a bound",
  );
  assert.match(firebase, /withTimeout\(user\.getIdToken\(\)/);
});

test("the timeout rejects rather than resolving null", () => {
  /* Every caller already handles a rejection — `readIdentityPayload` clears the
     cookie and reports not-authenticated, the repository catches to null. A
     silent null would be indistinguishable from "nobody is signed in" and would
     sign somebody out for a slow network. */
  const block = firebase.slice(firebase.indexOf("async function withTimeout"));
  assert.match(block, /reject\(/);
  assert.equal(
    /resolve\(null\)/.test(block),
    false,
    "a timeout must not masquerade as anonymity",
  );
});

test("the race timer is always cleared", () => {
  /* The losing promise keeps running — the SDK owns that fetch — but a dangling
     timer would hold the event loop behind it. */
  const block = firebase.slice(firebase.indexOf("async function withTimeout"));
  assert.match(block, /finally \{/);
  assert.match(block, /clearTimeout\(timer\)/);
});

/* ── The failure that rejects ─────────────────────────────────────────────── */

test("a failed resolution retries, then says so — it never stays loading", () => {
  /* The original catch was empty by design, with the status left at `loading`.
     That is the bug: correct about not signing anybody out, wrong about
     pretending to still be in progress. */
  assert.match(provider, /MAX_LOAD_ATTEMPTS/);
  assert.match(provider, /status: "stalled"/);
  const block = provider.slice(provider.indexOf("} catch (error) {"));
  assert.match(block.slice(0, 1400), /attempts\.current \+= 1/);
});

test("a failed resolution still never becomes anonymous", () => {
  /* The distinction the original comment drew, preserved. Signing somebody out
     because a request failed is the worse of the two bugs. */
  const start = provider.indexOf("} catch (error) {");
  const block = provider.slice(start, start + 1400);
  assert.equal(
    /status: "anonymous"/.test(block),
    false,
    "a transport failure must not sign anybody out",
  );
});

test("retries back off rather than hammering", () => {
  assert.match(provider, /RETRY_BASE_MS \* 2 \*\* \(attempts\.current - 1\)/);
});

test("a pending retry cannot outlive the provider", () => {
  assert.match(provider, /clearTimeout\(retryTimer\.current\)/);
});

/* ── The failure that never settles ───────────────────────────────────────── */

test("a resolution that never STARTS is caught by the watchdog", () => {
  /* The case the retry ladder cannot see, because nothing rejects: the SDK
     wedged on a persisted session, so `onAuthStateChanged` never fires. This is
     the one that distinguishes a normal browser from incognito. */
  assert.match(provider, /RESOLVE_WATCHDOG_MS/);
  assert.match(provider, /started\.current = true/);
});

test("the watchdog is UNCONDITIONAL — it is the only backstop for a hang", () => {
  /* The corrected invariant, and the reason the first attempt at this fix did
     not work. The watchdog used to skip when `load` had started, on the
     reasoning that the retry ladder owned the outcome from there. But the
     ladder only runs when something REJECTS, and the actual fault rejects
     nothing: a `load` that hangs mid-await — on a fetch with no timeout, on an
     SDK call that never settles — was caught by neither. `started` was true, so
     the watchdog stood down; nothing threw, so the ladder never ran. A
     permanent spinner, which is exactly what was reported.

     If a late attempt does succeed it simply replaces the stalled state with an
     authenticated one, so firing early costs nothing. */
  const start = provider.indexOf("const timer = setTimeout(() => {");
  const block = provider.slice(start, start + 1600);
  assert.equal(
    /if \(started\.current\) return;/.test(block),
    false,
    "the watchdog must not stand down once load has begun — that is the hole",
  );
});

test("the watchdog only ever replaces a loading state", () => {
  const start = provider.indexOf("const timer = setTimeout(() => {");
  const block = provider.slice(start, start + 1900);
  assert.match(block, /prev\.status === "loading"/);
});

test("the watchdog outlasts a healthy retry ladder", () => {
  /* Not a correctness requirement — a premature fire is self-correcting — but
     firing while a normal recovery is still in progress would show a failure
     screen to somebody whose session is about to resolve. */
  const watchdog = Number(
    /RESOLVE_WATCHDOG_MS = ([\d_]+)/.exec(provider)?.[1].replace(/_/g, "") ?? 0,
  );
  assert.ok(watchdog >= 30_000, `watchdog is only ${watchdog}ms`);
});

test("every engine request is bounded, so a hang becomes a rejection", () => {
  /* `fetch` has no timeout of its own. `legacyFetch` accepted a `signal` and
     nothing ever passed one, so `/cowork/me` — which signing in awaits before
     it can set any status — could stay pending for the life of the tab. */
  const http = readFileSync("lib/legacy/http.ts", "utf8");
  assert.match(http, /LEGACY_TIMEOUT_MS/);
  assert.match(http, /new AbortController\(\)/);
  assert.match(http, /clearTimeout\(timer\)/);
});

test("a timeout is reported as a timeout, not as a cancelled navigation", () => {
  /* They mean opposite things to a caller: a cancelled navigation must not
     raise a banner, a timed-out engine must — and must let a retry run. */
  const http = readFileSync("lib/legacy/http.ts", "utf8");
  assert.match(http, /timeoutController\.signal\.aborted/);
  assert.match(http, /did not answer within/);
});

test("a caller's own abort signal still wins", () => {
  /* A navigation cancelling its own request must not be overridden by the
     timeout machinery. */
  const http = readFileSync("lib/legacy/http.ts", "utf8");
  assert.match(http, /anySignal\(\[request\.signal, timeoutController\.signal\]\)/);
});

/* ── The way out ──────────────────────────────────────────────────────────── */

test("the stalled state renders a recovery screen, not a spinner", () => {
  assert.match(shell, /session\.status === "stalled"/);
  assert.match(shell, /Signing you in did not finish/);
});

test("recovery clears the saved session without asking anyone to clear cookies", () => {
  /* `signOut` drops the Firebase credential, the mirrored cookie and the
     per-browser identity keys. Telling somebody to clear their cookies to use
     their own workspace is not a fix. */
  assert.match(shell, /session\.signOut\(\)/);
  assert.match(shell, /Sign in again/);
  assert.match(shell, /session\.refresh\(\)/);
});

test("a manual retry gets a fresh allowance", () => {
  /* Otherwise "Try again" re-stalls instantly on the spent counter. Separate
     from `load` because `load` calls itself — resetting there would turn a
     bounded ladder into an unbounded loop. */
  assert.match(provider, /const retry = useCallback/);
  const start = provider.indexOf("const retry = useCallback");
  const block = provider.slice(start, start + 700);
  assert.match(block, /attempts\.current = 0/);
  assert.match(provider, /refresh: retry/);
});

test("a stalled session is not treated as signed out", () => {
  /* `anonymous` drives a hard redirect to /signin. If `stalled` counted as
     anonymous, the recovery screen would never render and the bounce would be
     back to where the user started. */
  assert.match(shell, /const anonymous = session\.status === "anonymous";/);
});
