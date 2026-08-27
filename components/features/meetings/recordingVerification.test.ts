import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";

/**
 * Being able to check that everybody's audio was saved.
 *
 * Each participant records their own microphone and uploads it independently —
 * the property that stops one bad connection costing the whole meeting. Its
 * cost is that nobody could see the result: three people finish a two-hour call
 * and there was no way to tell whether three files arrived or two, short of
 * opening Drive and counting.
 *
 * The engine has written a record per finished upload since recording existed
 * and exposed `GET /cowork/audio/recordings/:meetId` to read them back. The
 * wire function was there too. Nothing in the application ever called it.
 */

function code(path: string): string {
  return readFileSync(path, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

const PANEL = code("components/features/meetings/RecordingsPanel.tsx");
const DETAIL = code("components/features/meetings/MeetingDetailArea.tsx");
const TYPES = code("lib/repositories/types.ts");
const LEGACY = code("lib/repositories/legacy/index.ts");
const MOCK = code("lib/repositories/mock/index.ts");

test("the recordings endpoint is reachable from the application", () => {
  assert.match(TYPES, /listMeetingRecordings\(meetingId: string\)/);
  assert.match(LEGACY, /async listMeetingRecordings\(/);
  assert.match(MOCK, /async listMeetingRecordings\(/);
  assert.match(PANEL, /r\.listMeetingRecordings\(meetingId\)/);
  assert.match(DETAIL, /<RecordingsPanel\b/);
});

test("a missing recording is named, not merely absent", () => {
  /**
   * A list of files that arrived cannot be checked against a list nobody has.
   * Crossing the recordings against who was actually in the room is the whole
   * point — "no audio from X" is the fact that prompts action while recovery
   * is still possible.
   */
  assert.match(PANEL, /No audio from/);
  /* Only people who actually joined: somebody invited who never turned up has
     no audio to be missing. */
  assert.match(PANEL, /p\.joinedAt && !withAudio\.has/);
});

test("a second file for one person reads as a rejoin, not a duplicate", () => {
  /* Somebody whose tab reloaded, or whose host stopped and restarted, produces
     another segment. Two rows against one name otherwise reads as a fault. */
  assert.match(PANEL, /isRejoin/);
  assert.match(PANEL, /later segment/);
});

test("every row is verifiable by opening the file", () => {
  /* A row that says "uploaded" and cannot be opened proves nothing, which is
     the opposite of what this screen is for. */
  assert.match(PANEL, /Open in Drive/);
  assert.match(PANEL, /r\.viewUrl/);
});

test("the prototype lists nothing rather than inventing files", () => {
  /* Plausible rows on a screen whose purpose is confirming a real file exists
     would be worse than an empty one. */
  const method = MOCK.slice(
    MOCK.indexOf("async listMeetingRecordings("),
    MOCK.indexOf("async listMeetingRecordings(") + 400,
  );
  assert.match(method, /return delay\(\[\]\)/);
});

test("a name is resolved once, by the page that already knows it", () => {
  /* Two lookups is two answers to "what is this person called", which is how
     one screen comes to show two names for one person. */
  assert.match(PANEL, /nameFor: \(employeeId: string\) => string/);
  assert.match(DETAIL, /nameFor=\{\(id\) =>/);
});
