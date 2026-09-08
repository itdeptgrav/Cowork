import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";

/**
 * Why Leave sometimes did not leave: an unstable `onError` reconnected the
 * room out from under it.
 *
 * ## The mechanism
 *
 * `@livekit/components-react`'s `LiveKitRoom` runs an effect that calls
 * `room.connect(url, token, connectOptions)` whenever `connect` is true, keyed
 * on `[connect, token, JSON.stringify(connectOptions), room, onError, serverUrl,
 * simulateParticipants]` — see `node_modules/@livekit/components-react/dist/
 * room-BC_ml4G1.mjs`. Every dependency there is stable across a render EXCEPT
 * `onError`, which every one of these three rooms passed as
 * `onError={(e) => setError(e.message)}` — a new function every render, with
 * no `JSON.stringify`-style guard the way `connectOptions` gets. `connect`
 * never toggles false, so every re-render of the room re-ran that effect and
 * called `room.connect()` again.
 *
 * While the room stayed connected this was an invisible no-op — LiveKit does
 * not renegotiate a connection it already holds. It stopped being invisible
 * the moment a person pressed Leave: `room.disconnect()` is asynchronous, and
 * for as long as it is in flight the component is still mounted with `connect`
 * still true. Any UNRELATED re-render in that window — a chat message
 * arriving, a reaction, a participant joining, the floating window's drag
 * position moving — handed `LiveKitRoom` a fresh `onError` closure, re-ran the
 * connect effect, and reconnected the room that had just been told to hang up.
 * The result was the report: the docked stage the page was drawing on went
 * blank (the session had already started closing on the ORIGINAL disconnect),
 * while the reconnected room carried on live in the floating presentation,
 * looking exactly like the meeting nobody had left.
 *
 * ## The fix
 *
 * `useCallback` with no dependencies, so the reference is the same for the
 * life of the component and the connect effect only re-fires when the
 * connection itself — the token, the server, the room instance — actually
 * changes.
 */

function code(path: string): string {
  return readFileSync(path, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

const ROOMS = [
  "components/features/meetings/MeetingRoom.tsx",
  "components/features/meetings/TaskRoom.tsx",
  "components/features/meetings/GuestRoom.tsx",
];

test("no room hands LiveKitRoom a fresh onError closure on every render", () => {
  for (const path of ROOMS) {
    const src = code(path);
    assert.doesNotMatch(
      src,
      /onError=\{\(e\)\s*=>\s*setError\(/,
      `${path} passes an inline onError, which reconnects the room on every unrelated re-render`,
    );
  }
});

test("every room's onError is a useCallback with no dependencies", () => {
  for (const path of ROOMS) {
    const src = code(path);
    assert.match(
      src,
      /const onRoomError = useCallback\(\(e: Error\) => setError\(e\.message\), \[\]\);/,
      `${path} does not memoise onError, so LiveKitRoom's connect effect still re-fires on every render`,
    );
    assert.match(
      src,
      /onError=\{onRoomError\}/,
      `${path} does not pass the memoised handler to LiveKitRoom`,
    );
  }
});

test("the instability really does sit in LiveKit's own connect effect", () => {
  /* Pinned against the library's actual source so this test stops meaning
     anything the moment an upgrade changes the dependency array, rather than
     silently protecting against a mechanism that no longer exists. */
  const lib = readFileSync(
    "node_modules/@livekit/components-react/dist/room-BC_ml4G1.mjs",
    "utf8",
  );
  const start = lib.indexOf('l.debug("disconnecting because connect is false")');
  assert.ok(start !== -1, "the disconnect-when-connect-is-false branch is gone");
  /* The connect call and its dependency array sit within a short distance of
     that branch; slicing around it avoids depending on exact brace-matching
     through a minified file. */
  const region = lib.slice(start - 400, start + 400);
  assert.match(region, /s\.connect\(t, e, f\)/, "connect no longer calls room.connect");
  /* What matters is that `onError` (bound locally as `m`) still rides the SAME
     dependency array as `connect` (`c`), with nothing normalising its identity
     the way `JSON.stringify(f)` normalises connectOptions — that gap is
     exactly what makes memoising `onError` in our own components necessary. */
  assert.match(
    region,
    /\[\s*c,\s*e,\s*JSON\.stringify\(f\),\s*s,\s*m,/,
    "onError (m) no longer shares the connect effect's dependency array — this fix may no longer be needed, or may need to move to a different prop",
  );
});
