import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  getRepositoryVersion,
  refreshEverything,
  subscribeToPurgeAll,
  subscribeToRepository,
} from "@/lib/repositories/events";

/**
 * Sync — re-read everything without reloading the page.
 *
 * Most of the workspace is live, but not all of it: several reads carry a
 * `staleTime`, a Firestore listener refused by rules goes quiet, and a change
 * made in the CMS reaches Cowork only on the next read. The only way to be sure
 * was a full reload, which re-runs the whole sign-in ladder, re-mounts every
 * provider and loses scroll position and any open panel.
 *
 * Two things decide whether the button is honest, and both are easy to get
 * subtly wrong:
 *
 *  · it must drop the TTL cache, or the reads with a `staleTime` answer from
 *    their own copy and the question being asked goes unanswered;
 *  · the spinner must be driven by the work rather than a timer, or it reports
 *    "up to date" while requests are still running.
 */

/* ── The signal ───────────────────────────────────────────────────────────── */

test("refreshEverything purges every cached read", () => {
  let purged = 0;
  const stop = subscribeToPurgeAll(() => {
    purged += 1;
  });
  try {
    refreshEverything();
  } finally {
    stop();
  }
  assert.equal(purged, 1);
});

test("refreshEverything also bumps the version, so live queries re-run", () => {
  /* Purging alone would empty the caches and leave every mounted query sitting
     on the answer it already had. */
  const before = getRepositoryVersion();
  let woke = 0;
  const stop = subscribeToRepository(() => {
    woke += 1;
  });
  try {
    refreshEverything();
  } finally {
    stop();
  }
  assert.equal(getRepositoryVersion(), before + 1);
  assert.equal(woke, 1);
});

test("the purge happens BEFORE the bump", () => {
  /* A query woken by the bump re-reads immediately. A cache emptied after that
     would be emptied behind it, and the stale answer would be served once
     more — which is the one press somebody would not repeat. */
  const order: string[] = [];
  const stopPurge = subscribeToPurgeAll(() => order.push("purge"));
  const stopBump = subscribeToRepository(() => order.push("bump"));
  try {
    refreshEverything();
  } finally {
    stopPurge();
    stopBump();
  }
  assert.deepEqual(order, ["purge", "bump"]);
});

/* ── The wiring ───────────────────────────────────────────────────────────── */

const TOP_BAR = "components/layout/shell/TopBar.tsx";
const HOOK = "lib/hooks/useRepository.ts";

function code(path: string): string {
  return readFileSync(path, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[^\S\n]*\/\/.*$/gm, "");
}

test("the query cache clears BOTH of its caches on a purge", () => {
  /* The preload cache too: a hand-off from a mutation is exactly the kind of
     stale answer somebody pressing Sync is trying to get past. */
  const src = code(HOOK);
  const at = src.indexOf("subscribeToPurgeAll(");
  assert.ok(at > 0, "the query cache does not listen for a full purge");
  const body = src.slice(at, at + 200);
  assert.match(body, /staleResultCache\.clear\(\)/);
  assert.match(body, /preloadCache\.clear\(\)/);
});

test("the button triggers the refresh", () => {
  const src = code(TOP_BAR);
  const at = src.indexOf("function SyncButton()");
  assert.ok(at > 0, "SyncButton not found");
  const body = src.slice(at, src.indexOf("\n}", src.indexOf("</button>", at)));
  assert.match(body, /refreshEverything\(\)/);
});

test("the spinner is driven by work in flight, not by a timer", () => {
  /* A fixed-duration spinner is a claim about something it never measured. */
  const src = code(TOP_BAR);
  const at = src.indexOf("function SyncButton()");
  const body = src.slice(at, src.indexOf("</button>", at));
  assert.match(body, /subscribeToInflight/);
  assert.match(body, /getInflightCount/);
  assert.match(body, /const spinning = syncing \|\| inflight > 0;/);
});

test("in-flight changes are announced on both edges", () => {
  /* Requests do not start until effects run, so a Sync pressed before any had
     begun would read zero in flight. Without the rising edge the spinner would
     flash and stop while the work was still being scheduled. */
  const src = code(HOOK);
  const at = src.indexOf("inflightCache.set(dedupKey, p);");
  assert.ok(at > 0, "the inflight dedup block moved");
  const body = src.slice(at, at + 400);
  assert.match(body, /announceInflight\(\);/);
  assert.match(body, /inflightCache\.delete\(dedupKey\);\s*announceInflight\(\);/);
});

test("the button cannot be pressed while it is already syncing", () => {
  const src = code(TOP_BAR);
  const at = src.indexOf("function SyncButton()");
  const body = src.slice(at, src.indexOf("</button>", at));
  assert.match(body, /disabled=\{spinning\}/);
});

test("the rotation is dropped for reduced motion", () => {
  /* The disabled state and the label still report what is happening, so
     nothing is lost by not spinning. */
  const src = code(TOP_BAR);
  const at = src.indexOf("function SyncButton()");
  const body = src.slice(at, src.indexOf("</button>", at));
  assert.match(body, /motion-safe:animate-spin/);
});

test("both states are named for a screen reader", () => {
  const src = code(TOP_BAR);
  const at = src.indexOf("function SyncButton()");
  const body = src.slice(at, src.indexOf("</button>", at));
  assert.match(body, /aria-label=\{spinning \? "Syncing" : "Sync — check for the latest"\}/);
});

/* ── The turn has to be visible ───────────────────────────────────────────── */

test("the spin lasts at least one full rotation", () => {
  /* Against a local backend the reads settle in tens of milliseconds, so a
     spinner that stopped the moment they did turned about a quarter of a turn
     and snapped back — which reads as a twitch, or as a button that did
     nothing. */
  const src = code(TOP_BAR);
  assert.match(src, /const FULL_ROTATION_MS = 1000;/);
  const at = src.indexOf("function SyncButton()");
  const body = src.slice(at, src.indexOf("</button>", at));
  assert.match(body, /const remaining = Math\.max\(250, FULL_ROTATION_MS - elapsed\);/);
  assert.match(body, /startedAtRef\.current = Date\.now\(\);/);
});

test("the floor never stops the spin EARLY", () => {
  /* `inflight > 0` returns before any of the timing, so slow work still spins
     for as long as it takes. The floor only prevents the spin ending before the
     eye can register it — it never claims finished when it is not. */
  const src = code(TOP_BAR);
  const at = src.indexOf("function SyncButton()");
  const body = src.slice(at, src.indexOf("</button>", at));
  const guard = body.indexOf("if (!syncing || inflight > 0) return;");
  const timing = body.indexOf("FULL_ROTATION_MS - elapsed");
  assert.ok(guard > 0 && timing > guard, "the in-flight guard must come first");
});

test("the rotation period and the floor are the same number", () => {
  /* Tailwind's `animate-spin` is `spin 1s linear infinite`. A floor shorter
     than the period stops the icon mid-turn at whatever angle it reached; a
     longer one leaves it turning past the point the work finished. */
  const src = code(TOP_BAR);
  assert.match(src, /animate-spin/);
  assert.match(src, /FULL_ROTATION_MS = 1000/);
});

/* ── A failed sync stops the spin and says so ─────────────────────────────── */

/**
 * `refreshEverything` cannot fail — it empties two caches and increments a
 * number. What CAN fail is the reads it sets off, and each of those reports
 * only into its own screen. So the failure is counted centrally and read as a
 * difference across the press.
 */

test("failures are counted so a difference across the press can be read", () => {
  /* A monotonic counter rather than a flag: the question is "did anything fail
     SINCE I pressed", and a boolean cannot answer that without somebody
     clearing it — a race against the very failures it should catch. */
  const src = code(HOOK);
  assert.match(src, /export function getQueryFailureCount\(\): number \{\s*return queryFailures;/);
  assert.match(
    src,
    /function noteQueryFailure\(methodName: string, cause: unknown\): void \{\s*queryFailures \+= 1;/,
  );
});

test("the failing read names itself in the console", () => {
  /* The toast stays plain — a method name means nothing to a reader and there
     is nothing they could do with it. Somebody DIAGNOSING it needs exactly that
     name, or "sync failed" is a report with no next step and the cause has to
     be guessed at across forty reads. */
  const src = code(HOOK);
  assert.match(src, /\[cowork\] read failed: \$\{methodName \|\| "\(unnamed query\)"\} — \$\{message\}/);
  assert.match(src, /console\.warn\(/, "a handled failure must not be logged as an error");
});

test("a failure is counted even if the component has gone away", () => {
  /* The `cancelled` guard means "do not write state into an unmounted
     component" — a different question from "did anything go wrong". Counting
     inside it would let a navigation mid-refresh hide the failure. */
  const src = code(HOOK);
  const at = src.indexOf(".catch((e: unknown) => {");
  assert.ok(at > 0, "the query error path moved");
  const body = src.slice(at, at + 600);
  assert.ok(
    body.indexOf("noteQueryFailure(") < body.indexOf("if (!cancelled)"),
    "the failure is counted inside the cancelled guard",
  );
});

test("an unimplemented method is not counted as a sync failure", () => {
  /* `unavailable` is a method the backend does not implement, which the UI
     already renders as "unavailable". Counting it would flag a permanent,
     known gap as a transient fault on every single press. */
  assert.match(code(HOOK), /if \(!unavailable\) noteQueryFailure\(methodName, e\);/);
});

test("the button compares the count against a baseline taken at the press", () => {
  const src = code(TOP_BAR);
  const at = src.indexOf("function SyncButton()");
  const body = src.slice(at, src.indexOf("</button>", at));
  assert.match(body, /failuresAtStartRef\.current = getQueryFailureCount\(\);/);
  assert.match(body, /if \(getQueryFailureCount\(\) > failuresAtStartRef\.current\)/);
});

test("the spin stops BEFORE the failure is reported", () => {
  /* A spinner still turning beside a failure notice is the two halves of the
     interface disagreeing about whether the work finished. */
  const src = code(TOP_BAR);
  const at = src.indexOf("function SyncButton()");
  const body = src.slice(at, src.indexOf("</button>", at));
  assert.ok(
    body.indexOf("setSyncing(false)") < body.indexOf("getQueryFailureCount() >"),
    "the failure is reported before the rotation stops",
  );
});

test("the failure uses the toast surface the product already has", () => {
  /* The message has to say what to do, and the top bar has room for an icon. */
  const src = code(TOP_BAR);
  assert.match(src, /new CustomEvent\("cowork:notification"/);
  assert.match(src, /type: "sync_failed"/);
  assert.match(src, /title: "Some information could not be refreshed"/);
});

test("repeated failed presses replace the notice rather than stacking it", () => {
  /* `addToast` de-duplicates on id, and `toastFrom` takes the id from `tag`. */
  const src = code(TOP_BAR);
  assert.match(src, /tag: "sync-failed"/);
});

test("a sync failure reads as a warning, not as information", () => {
  /* Kept out of `COSTLY`, which is about a score being reduced — a refresh that
     could not complete cost nobody anything. Both are warnings; only one is
     about points. */
  const src = code("lib/rules/notifications/toastStack.ts");
  assert.match(src, /const FAILURES = new Set\(\["sync_failed"\]\);/);
  assert.match(src, /if \(FAILURES\.has\(t\) \|\| COSTLY\.has\(t\)\) return "warn";/);
});

test("the failure notice says nothing was lost", () => {
  /* The likeliest next thought after "could not refresh" is "have I lost what I
     was writing" — and Sync only reads, so the answer is no. */
  assert.match(code(TOP_BAR), /Nothing you have typed or attached has been lost/);
});
