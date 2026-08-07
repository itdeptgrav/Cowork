import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";

/**
 * Why pressing Leave in a scheduled meeting put you straight back in the call.
 *
 * `MeetingRoom` renders a `LiveKitRoom` with `connect` set, and calls `onLeave`
 * from its `onDisconnected` handler. The detail area's `onLeave` refetched the
 * participant list and nothing else — it never stopped RENDERING the room. So
 * LiveKit disconnected and, still mounted and still told to connect, made
 * another connection. The same interface came back, which read as Leave not
 * working.
 *
 * The guest view never had this: its `onLeave` moves to a lobby phase, so the
 * room unmounts. These pin the same property on the signed-in view — leaving
 * has to take the room off the screen, not merely be noticed.
 */

function code(path: string): string {
  return readFileSync(path, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

const DETAIL = "components/features/meetings/MeetingDetailArea.tsx";
const GUEST = "components/features/meetings/GuestMeetingArea.tsx";
const ROOM = "components/features/meetings/MeetingRoom.tsx";

test("leaving records that you are out, rather than only refetching", () => {
  const src = code(DETAIL);
  const handler = /onLeave=\{\(\) => \{([\s\S]*?)\}\}/.exec(src)?.[1] ?? "";
  assert.notEqual(handler, "", "onLeave is no longer a block body");
  assert.match(handler, /setLeft\(true\)/, "leaving does not record that you left");
});

test("the room is not rendered once you have left", () => {
  const src = code(DETAIL);
  /* The room must sit behind the `left` check. Were it rendered regardless,
     `setLeft` would be state nothing reads and LiveKit would reconnect. */
  const gate = src.indexOf("left ?");
  const room = src.indexOf("<MeetingRoom");
  assert.notEqual(gate, -1, "no branch on having left");
  assert.ok(gate < room, "MeetingRoom is not gated behind the left branch");
});

test("there is a way back in", () => {
  /* Leaving a meeting that is still running must not be one-way: the branch
     that replaces the room has to offer a rejoin, or a misclick ends your
     participation until a reload. */
  const src = code(DETAIL);
  assert.match(src, /setLeft\(false\)/, "nothing clears the left state");
  assert.match(src, /Rejoin/, "no rejoin control");
});

test("the guest view still unmounts its room on leave", () => {
  /* This one was always right — it is here so a later tidy-up cannot quietly
     give the guest view the bug the signed-in view just lost. */
  const src = code(GUEST);
  const handler = /onLeave=\{\(\) =>([\s\S]*?)\n      \}/.exec(src)?.[1] ?? "";
  assert.match(handler, /setPhase\(/, "guest leave no longer changes phase");
});

test("MeetingRoom still reports its own disconnect", () => {
  /* The fix above is only reached if the room keeps calling `onLeave` when
     LiveKit disconnects — including a disconnect the person did not ask for. */
  const src = code(ROOM);
  assert.match(src, /onDisconnected=\{/, "no disconnect handler");
  assert.match(src, /onLeave\(\)/, "disconnect no longer notifies the parent");
});
