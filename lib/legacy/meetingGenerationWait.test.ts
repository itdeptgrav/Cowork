import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { generationMayStillBeRunning } from "./meetingMedia.ts";
import { backendAvailable, backendSource } from "./backendSource.ts";

/**
 * **Reported 21 September 2026.** Generating the transcript for a 45–50 minute
 * meeting answered *Could not reach the Cowork server. Check your connection
 * and try again.* — on a transcript that had in fact been generated and saved.
 *
 * Both engine routes do the slow work first and answer last: Gemini runs, the
 * result is written to Firestore, and only then does the response go out. A
 * meeting long enough to push that past whatever sits in front of the engine
 * loses the ANSWER, not the work.
 *
 * So the client waits instead of reporting a failure.
 */

/* ── Which failures mean "keep waiting" ───────────────────────────────────── */

test("no HTTP response at all means the engine may still be working", () => {
  /* `legacyFetch` uses status 0 for both of the cases where nothing came back:
     its own 300-second abort, and a connection that broke underneath it. The
     reported screenshot was the second. */
  assert.equal(generationMayStillBeRunning({ status: 0 }), true);
});

test("429 is the engine's own lock, not a refusal", () => {
  /* The route answers 429 "Transcript generation already in progress" rather
     than starting a duplicate run — which is exactly what makes polling safe,
     and why a 429 must not be shown as an error. */
  assert.equal(generationMayStillBeRunning({ status: 429 }), true);
});

test("a real answer is reported, never waited out", () => {
  /* A suspended key, a missing meeting, a pipeline error. Waiting fifteen
     minutes on any of these would replace a clear message with a slow one. */
  for (const status of [400, 401, 403, 404, 409, 500, 502, 503]) {
    assert.equal(
      generationMayStillBeRunning({ status }),
      false,
      `${status} must be shown`,
    );
  }
});

/* ── What the panels do with it ───────────────────────────────────────────── */

const panel = (name: string) =>
  readFileSync(`components/features/meetings/${name}`, "utf8");

test("both panels wait rather than reporting a dropped connection", () => {
  for (const name of [
    "VerbatimTranscriptPanel.tsx",
    "MeetingSummaryPanel.tsx",
  ]) {
    const src = panel(name);
    assert.match(src, /generationMayStillBeRunning\(res\.error\)/, name);
    assert.match(src, /waitForMeeting(Transcript|Summary)\(/, name);
    /* And the wait has an end: a spinner nobody can stop is worse than an
       error. The message names what is still happening. */
    assert.match(src, /taking longer than usual/, name);
  }
});

test("regenerating is not satisfied by the record already on screen", () => {
  /**
   * The bug this guards: polling asks the GET route "is it there yet", and on
   * a **Regenerate** the previous transcript IS there — so the poll would
   * return instantly with the old one and the press would look like it worked.
   *
   * Both panels read `createdAtMs` BEFORE asking for the new one and require
   * something newer.
   */
  for (const name of [
    "VerbatimTranscriptPanel.tsx",
    "MeetingSummaryPanel.tsx",
  ]) {
    const src = panel(name);
    assert.match(src, /const newerThanMs = .*createdAtMs \?\? 0;/, name);
    assert.match(src, /newerThanMs,/, name);
    /* Read before the request goes out, not after it comes back. The CALL
       site, not the import line, which naturally comes first. */
    assert.ok(
      src.indexOf("const newerThanMs") <
        src.indexOf("generationMayStillBeRunning(res.error)"),
      `${name}: the baseline is read after the call`,
    );
  }
});

test(
  "the engine still stores the result before it answers",
  { skip: backendAvailable() ? false : "the engine checkout was not found" },
  () => {
    /**
     * The property the whole fix depends on. If a route ever answered first
     * and saved afterwards, polling would be waiting for something that is not
     * coming, and this would have to be reconsidered.
     */
    const routes = backendSource("routes/task_routes/meetingSummary.routes.js");
    const at = routes.search(
      /router\.post\(\s*"\/audio\/transcript\/:meetId"/,
    );
    assert.ok(at > 0, "the transcript POST route has moved");
    const post = routes.slice(at);
    const saved = post.indexOf("await ref.set(");
    const answered = post.indexOf("cached: false");
    assert.ok(saved > 0, "the transcript route no longer stores with ref.set");
    assert.ok(answered > 0, "the success answer has moved");
    assert.ok(saved < answered, "it must store before the answer that reports it");
  },
);
