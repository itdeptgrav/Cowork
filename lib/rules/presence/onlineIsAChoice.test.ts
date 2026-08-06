import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { test } from "node:test";

/**
 * Online is something you CHOOSE — OWNER DECISION, and a reversal of the rule
 * this whole module was built on.
 *
 * It used to be a consequence of a live whole-screen share, and nothing a
 * person said could assert it. Pressing Online opened the browser's capture
 * picker; cancelling left you offline. That requirement has been removed at the
 * owner's instruction.
 *
 * These guard the two halves that are easy to reintroduce by accident: the
 * button reaching for the picker again, and sharing being deleted rather than
 * merely unhooked.
 */

const STORE = "lib/status/employeeStatus.ts";
const BUTTON = "components/features/status/StatusButton.tsx";

function code(path: string): string {
  return readFileSync(path, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

test("going online asks for nothing", () => {
  const src = code(STORE);
  const at = src.indexOf("export function goOnline");
  assert.ok(at > 0, "goOnline is gone");
  const body = src.slice(at, src.indexOf("\nexport ", at + 10));

  for (const asked of ["requestScreenShare", "fetchCredentials(", "nativeStartScreenShare"]) {
    assert.ok(
      !body.includes(asked),
      `goOnline reaches for ${asked} — pressing Online must not prompt for anything`,
    );
  }
  assert.match(body, /manual: "online"/, "goOnline no longer records the choice");
});

test("the status menu goes online without a confirmation step", () => {
  const src = code(BUTTON);
  const at = src.indexOf('if (id === "online")');
  assert.ok(at > 0, "the online branch is gone");
  const branch = src.slice(at, src.indexOf('if (id === "break")', at));

  assert.match(branch, /goOnline\(\)/);
  assert.ok(
    !/setConfirming\(true\)/.test(branch),
    "the online branch reopens a share-confirmation panel",
  );
  assert.ok(
    !/startScreenShare|fetchRoomCredentials/.test(branch),
    "the online branch still starts a screen share",
  );
});

test("a chosen online is a manual state, ranked below break and emergency", () => {
  /* Both are claims about the person. Choosing online must not become a way to
     stay online through a break. */
  const src = code(STORE);
  assert.match(src, /export type ManualStatus =[^;]*"online"/);

  const at = src.indexOf("export function derive");
  const body = src.slice(at, src.indexOf("\nconst INITIAL", at));
  const emergency = body.indexOf('manual === "emergency"');
  const brk = body.indexOf('manual === "break"');
  const online = body.indexOf('manual === "online"');
  assert.ok(emergency > 0 && brk > 0 && online > 0, "a manual branch is missing");
  assert.ok(emergency < online, "a chosen online outranks an emergency");
  assert.ok(brk < online, "a chosen online outranks a break");
});

test("screen sharing was unhooked, not deleted", () => {
  /* Monitoring still runs on it, and the whole-screen rule still applies to it.
     Removing the requirement must not remove the capability. */
  const src = code(STORE);
  assert.match(src, /export async function startScreenShare/);
  assert.match(src, /requestScreenShare\(\)/);
  assert.match(src, /ScreenShareWrongSurface/, "the whole-screen check is gone");

  /* And a live share still reports online by itself. */
  const at = src.indexOf("export function derive");
  const body = src.slice(at, src.indexOf("\nconst INITIAL", at));
  assert.match(body, /share\.sharing && share\.connected/);
});
