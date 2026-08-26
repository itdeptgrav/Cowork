import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { test } from "node:test";

/**
 * The wiring behind the ticks.
 *
 * The rule itself is tested directly in `lib/rules/messages/messageStatus.test.ts`
 * — this holds the three decisions in the component that a correct rule cannot
 * protect on its own, each of which fails silently:
 *
 *  · ticks on somebody else's bubble, which would be telling them whether they
 *    have read a message they are visibly looking at;
 *  · a delivery stamp written from the open thread rather than from the list,
 *    which would leave every OTHER conversation on one tick for ever;
 *  · that write being made unconditionally, which loops against the watcher.
 */

const AREA = "components/features/messages/MessagesArea.tsx";
/* The component moved out of the thread so the task discussion could draw the
   same ticks — see MessageTicks.tsx. The three tests below read it there. */
const TICKS = "components/features/messages/MessageTicks.tsx";

function code(path: string = AREA): string {
  return readFileSync(path, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[^\S\n]*\/\/.*$/gm, "");
}

test("ticks are drawn only on the viewer's own messages", () => {
  /* `mine &&` is the whole guard. Without it every incoming bubble grows a tick
     reporting whether the reader has read what they are reading. */
  assert.match(
    code(),
    /\{mine && !deleted && \(\s*<MessageTicks/,
    "ticks are not gated on the message being the viewer's own",
  );
});

test("the tick status comes from the shared rule, not from a local guess", () => {
  const src = code();
  assert.match(src, /import \{[\s\S]*?messageStatus[\s\S]*?\} from "@\/lib\/rules\/messages\/messageStatus"/);
  assert.match(src, /status=\{messageStatus\(\{/);
});

test("recipients exclude the viewer", () => {
  /* Every message is written with `readBy: [senderId]`. Counting the sender as
     a recipient would make every message read the instant it was sent. */
  assert.match(
    code(),
    /const recipientIds = participants\s*\.map\(\(p\) => p\.id\)\s*\.filter\(\(id\) => id !== viewerId\)/,
    "the viewer is not excluded from their own message's recipients",
  );
});

test("delivery is stamped from the conversation LIST, not from the open thread", () => {
  /* Receiving is a property of the client being connected. Stamping only the
     open thread would leave the sender of every other conversation looking at
     a single tick indefinitely. The call must sit in `MessagesPage`, which
     holds every conversation, not in `Thread`. */
  const src = code();
  const page = src.indexOf("export function MessagesPage");
  const thread = src.indexOf("function Thread(");
  const call = src.indexOf("markConversationsDelivered");
  assert.ok(page >= 0 && thread > page, "component order changed");
  assert.ok(call > page && call < thread, "the delivery stamp is not in MessagesPage");
});

test("only the conversations that need a stamp are written", () => {
  /* The stamp lives on a document `watchConversations` is listening to, so an
     unconditional write is write -> snapshot -> refetch -> write. */
  assert.match(
    code(),
    /const need = conversationsNeedingDelivery\(all, viewerId\);\s*if \(need\.length === 0\) return;/,
    "delivery is stamped without narrowing to what changed — this loops",
  );
});

test("a backend with no delivery concept is tolerated", () => {
  /* `markConversationsDelivered` is optional on the repository. Calling it
     unguarded would throw NotConnectedError through the effect. */
  assert.match(code(), /if \(!viewerId \|\| !repo\.markConversationsDelivered\) return;/);
});

test("a failed stamp never surfaces as an error", () => {
  /* Nobody did anything wrong, and the cost is somebody else's tick staying
     grey for a few more seconds. */
  assert.match(code(), /markConversationsDelivered\(need\)\.catch\(\(\) => \{\}\)/);
});

test("the read tick uses the one token reserved for it", () => {
  /* The Four Channels Rule keeps saturated colour for score components. The
     read tick has its own token defined per theme rather than a raw hex, so it
     cannot drift from the palette or break in one theme. */
  assert.match(code(TICKS), /var\(--state-read\)/);
  const css = readFileSync("app/globals.css", "utf8");
  const light = css.match(/--state-read:\s*#[0-9a-f]{6}/gi) ?? [];
  assert.equal(light.length, 2, "--state-read must be defined once per theme");
});

test("delivered and sent are told apart by tick COUNT, not by colour", () => {
  /* Two greys against one grey is a difference of quantity, which reads without
     a legend. A second colour would make the reader learn a palette. */
  /* The whole file is the component now. */
  const body = code(TICKS);
  assert.match(body, /const read = status === "read"/);
  assert.match(body, /const double = status !== "sent"/);
  assert.match(body, /\{double && <path/, "the second tick is not conditional");
});

test("every tick state carries an accessible label", () => {
  /* A tick is meaningless to a screen reader without one, and this is the only
     place the message's status is expressed at all. */
  const body = code(TICKS);
  assert.match(body, /aria-label=\{said\}/);
  assert.match(body, /title=\{said\}/);
  /* The direct-message wording is the DEFAULT, not the only option: the task
     discussion draws the same ticks and supplies its own words, because
     "Delivered" is a claim about a device that a task thread cannot make. */
  assert.match(
    body,
    /status === "read" \? "Read" : status === "delivered" \? "Delivered" : "Sent"/,
  );
  assert.match(body, /label \?\?/, "the wording can no longer be overridden");
});
