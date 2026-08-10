import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { test } from "node:test";

/**
 * **Which field says a room is over — and it is not the one you would reach for.**
 *
 * Measured twice, because the answer CHANGED with the release that added screen
 * rooms, and each answer was load-bearing:
 *
 *  · **Before**: emptying a room ended it for good. `live` went false, rejoining
 *    was refused with "Room does not exist", and `endedAt` stayed `null`. Reusing
 *    a room on `!endedAt` handed out dead rooms, which cost a day.
 *  · **Now**: a fresh room is `live: false` with nobody in it, `live: true` while
 *    somebody is joined, back to `live: false` when they leave — **and it is
 *    joined again without complaint**. `live` is a STATUS; `endedAt` is the
 *    lifecycle.
 *
 * Filtering on `live` today would create a room per session and, worse, send a
 * manager somewhere other than where their report is sharing.
 *
 * The module cannot be imported here — it is `server-only`, and importing it
 * outside Next throws — so the rule is read from the source. That is the same
 * trade the other flow tests make, and it is worth it for a rule whose whole
 * value is that nobody edits it back.
 */

const STREAM = readFileSync("lib/integrations/grav/stream.ts", "utf8");

function code(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

test("a room is reused until it has ENDED, not while it is busy", () => {
  const src = code(STREAM);
  assert.match(src, /r\.name === name &&\s*!r\.endedAt/);
  assert.ok(
    !/r\.live === true/.test(src),
    "an empty room is treated as gone again — every session would get its own, and the manager would land in a different one from their report",
  );
});

test("the room is created for screen monitoring, with the surface rule on", () => {
  /* Both are properties of the ROOM, fixed at creation: `screen` is what stops
     the embed asking for a camera and a microphone, and `requireEntireScreen`
     is what makes their SFU refuse a window or a browser tab. */
  const src = code(STREAM);
  assert.match(src, /mode: "screen"/);
  assert.match(src, /requireEntireScreen: true/);
});

test("no room id is remembered between calls", () => {
  /* A cached id outlives the room it names — the room dies the moment the person
     stops sharing — so the next session was handed a seat in a room that no
     longer existed, and only a server restart cleared it. */
  const src = code(STREAM);
  assert.ok(
    !/new Map<string, string>\(\)/.test(src),
    "a name → room id cache is back",
  );
  assert.ok(!/roomIds/.test(src), "a name → room id cache is back");
});

test("a room emptied mid-flight is resolved again, once", () => {
  /* The listing and the mint are two requests, and a room can empty between
     them. One retry turns that into a fresh room rather than a refusal. */
  const src = code(STREAM);
  assert.match(src, /error\.status !== 404/);
  assert.match(src, /const fresh = await ensureRoom\(roomName\)/);
});

test("presence asks whether THIS person has a screen live", () => {
  /* A head count is not the fact. Nor is "in the room": somebody can be
     connected with the picker dismissed, and Online must not mean that. */
  const route = code(readFileSync("app/api/stream/presence/route.ts", "utf8"));
  assert.match(route, /p\.identity === identity/);
  assert.match(
    route,
    /sharing: them\?\.screen != null/,
    "Online is decided on presence in the room again, not on a live screen",
  );
});

test("a room in the wrong MODE is never reused", () => {
  /**
   * **This shipped, and it looked like four different bugs.** A room's mode is
   * fixed when it is created. Rooms made before screen mode existed are
   * `mode: "meeting"`, they never end on their own, and matching on the name
   * alone handed one back every session: the embed loaded, reported `ready` with
   * `mode: "meeting"`, and the picker never opened — one account had four
   * meeting rooms under the same person's name.
   *
   * `requireEntireScreen` is checked with it, because a screen room created
   * without it does not enforce the rule this product states.
   */
  const src = code(STREAM);
  assert.match(src, /r\.mode === "screen"/);
  assert.match(src, /r\.requireEntireScreen === true/);
});
