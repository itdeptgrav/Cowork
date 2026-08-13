import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { test } from "node:test";

/**
 * Everyone in one room must be reading one session.
 *
 * ## What was reported
 *
 * Three people on screen in a cross-department meeting, and the panel saying
 * **"Counting 00:00:00 — Nothing is being added to yours, it counts only while
 * you are in the room with somebody else."** The reader was standing in the
 * room it claimed they were not in, and the third person's minutes reached
 * none of their tasks.
 *
 * ## Why
 *
 * A task has ONE video room — its name is derived from the task id — but its
 * attendance lives in sessions, and three places chose which open session to
 * use:
 *
 *   - the engine's join took `open.docs[0]` from an UNORDERED Firestore query;
 *   - the prototype's join took the first in insertion order, the OLDEST; and
 *   - the panel took the first of a list sorted NEWEST-first.
 *
 * With more than one session open — two people joining at once, or one left
 * open by a client that never closed it — a person's attendance row landed in
 * one session while the panel read another. Everybody was in the same call and
 * the records said otherwise: no window, no credit, no explanation on screen.
 *
 * Two rules close it. Every writer picks the NEWEST open session, so they
 * converge; and the panel prefers the session the reader actually joined over
 * any other, because that is the one describing what they are looking at.
 */

const PANEL = "components/features/tasks/TaskMeetingPanel.tsx";
const LEGACY = "lib/repositories/legacy/index.ts";
const MOCK = "lib/repositories/mock/index.ts";

test("the panel reads the session THIS person joined", () => {
  const src = readFileSync(PANEL, "utf8");
  const from = src.indexOf("const open =");
  assert.ok(from > 0, "the open-session choice was renamed");
  const body = src.slice(from, from + 400);

  assert.match(
    body,
    /joined && list\.find\(\(s\) => s\.id === joined\.sessionId\)/,
    "the panel picks an open session without preferring the reader's own, so " +
      "somebody in the room can be told they are not in it",
  );
  /* And still falls back, so a reader who has NOT joined still sees the room. */
  assert.match(body, /list\.find\(\(s\) => s\.endedAt === null\)/);
});

test("both repositories join the NEWEST open session", () => {
  /* Whichever one they pick, they have to pick the same one as each other and
     as the panel. Newest-first is the panel's order, so that is the rule. */
  const legacy = readFileSync(LEGACY, "utf8");
  const from = legacy.indexOf('where("endedAt", "==", null)');
  assert.ok(from > 0, "the engine's open-session query was renamed");
  const body = legacy.slice(from, from + 900);

  assert.ok(
    !/const existing = open\.docs\[0\]/.test(body),
    "the engine takes whatever an unordered query returned first, so two " +
      "people in one room can be recorded against two different sessions",
  );
  assert.match(
    body,
    /startedAt[\s\S]{0,120}localeCompare/,
    "the engine no longer orders the open sessions before choosing",
  );

  const mock = readFileSync(MOCK, "utf8");
  const mockFrom = mock.indexOf("let session = [...s.taskMeetingSessions]");
  assert.ok(
    mockFrom > 0,
    "the prototype takes the first in insertion order — the OLDEST — which is " +
      "the opposite end from the panel and the engine",
  );
  assert.match(
    mock.slice(mockFrom, mockFrom + 300),
    /b\.startedAt\.localeCompare\(a\.startedAt\)/,
  );
});

test("the sessions list is newest-first, which is what the others match", () => {
  /* The order everything else is now aligned to. If this flips, the two joins
     above start disagreeing with the panel again. */
  const legacy = readFileSync(LEGACY, "utf8");
  const from = legacy.indexOf("async listTaskMeetingSessions");
  assert.ok(from > 0, "the session list was renamed");
  assert.match(
    legacy.slice(from, from + 2600),
    /\.sort\(\(a, b\) => b\.startedAt\.localeCompare\(a\.startedAt\)\)/,
    "the list is no longer newest-first",
  );
});
