import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";

/**
 * Reactions that only the sender could see.
 *
 * Reported as "emoji reaction in meeting should work — reaction not shows other
 * side". The sender saw their own because it is echoed locally on purpose,
 * which made them the one person who could not tell it had never left.
 *
 * The cause is a memo dependency. `useDataChannel(topic, onMessage)` builds its
 * whole data-channel setup inside
 *
 *     useMemo(() => setupDataMessageHandler(room, topic, onMessage), [room, topic, onMessage])
 *
 * so an INLINE arrow as `onMessage` is a new identity on every render and the
 * handler is torn down and rebuilt each time. This provider re-renders
 * constantly — a raised hand and every arriving reaction are its own state — so
 * an incoming message can land in the gap while the subscription is being
 * rebuilt, and an outgoing `send` can belong to a handler already being
 * replaced. `publish` swallows a throw, so nothing was ever reported.
 *
 * The refs were already there for this. The file's own comment says the handler
 * "is registered once". It was not.
 */

function code(path: string): string {
  return readFileSync(path, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

const SIGNALS = code("components/features/meetings/RoomSignals.tsx");

/* ── The handler is registered once ──────────────────────────────────────── */

test("the message handler is memoised, not rebuilt every render", () => {
  assert.match(SIGNALS, /const onSignal = useCallback\(/);
  assert.match(SIGNALS, /useDataChannel\(TOPIC, onSignal\)/);
});

test("it has no dependencies, so it is built exactly once", () => {
  /* Every value it reads is a ref or a setState — both stable. A dependency
     here would put the churn straight back. */
  const cb = SIGNALS.slice(SIGNALS.indexOf("const onSignal = useCallback("));
  const end = cb.indexOf("useDataChannel(TOPIC, onSignal)");
  assert.match(cb.slice(0, end), /\}, \[\]\);/, "the handler has dependencies again");
});

test("no inline arrow is passed to useDataChannel", () => {
  /* The exact shape that caused it. */
  assert.doesNotMatch(
    SIGNALS,
    /useDataChannel\(TOPIC, \(/,
    "an inline handler is back — it is a new identity on every render",
  );
});

/* ── The circularity that made it hard ───────────────────────────────────── */

test("send is reached through a ref, which is what breaks the circle", () => {
  /**
   * The handler needs `send` for one thing — answering a newcomer's `sync` with
   * a raised hand — and `send` comes out of the very hook the handler is passed
   * to. That circle is why it was written inline in the first place.
   */
  assert.match(SIGNALS, /const sendRef = useRef<SendData>/);
  assert.match(SIGNALS, /publish\(sendRef\.current, \{ kind: "hand", up: true \}\)/);
});

test("the ref is assigned after commit, not during render", () => {
  /* A render can be thrown away or replayed; writing a ref during one is a side
     effect on a pass that may never commit. */
  assert.match(SIGNALS, /useEffect\(\(\) => \{\s*sendRef\.current = send;\s*\}, \[send\]\)/);
});

test("an absent send is refused rather than thrown on", () => {
  /* True on the first render and for a tick after the room is replaced. The
     guard existed; the type did not admit it. */
  assert.match(SIGNALS, /function publish\(send: SendData \| undefined/);
  assert.match(SIGNALS, /if \(!send\) return;/);
});

/* ── What must not change ────────────────────────────────────────────────── */

test("the local echo stays, because LiveKit does not echo your own data", () => {
  /* Without it your own reaction is the one nobody sees you send — including
     you. It is also what disguised this bug. */
  const send = SIGNALS.slice(SIGNALS.indexOf("const sendRef"));
  const fn = send.slice(send.indexOf("const sendReaction"));
  assert.match(fn.slice(0, 900), /name: "You"/);
});

test("hands and reactions still share one topic, differing by kind", () => {
  assert.match(SIGNALS, /const TOPIC = "cowork-room-signal"/);
  assert.match(SIGNALS, /kind: "reaction"/);
  assert.match(SIGNALS, /kind: "hand"/);
  assert.match(SIGNALS, /kind: "sync"/);
});

test("signals are sent reliably", () => {
  /* A hand going up is a state change; an unreliable one that is dropped
     leaves somebody raised for the whole room with no way to correct it. */
  assert.match(SIGNALS, /\{ reliable: true \}/);
});

test("both rooms mount the provider, so a guest reacts too", () => {
  for (const path of [
    "components/features/meetings/RoomInterior.tsx",
    "components/features/meetings/GuestRoom.tsx",
  ]) {
    assert.match(code(path), /<RoomSignalsProvider/, `${path} lost reactions`);
  }
});
