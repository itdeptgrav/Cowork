import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";

import { sendFailureReason } from "@/lib/rules/meetings/chatSendFailure.ts";

/**
 * The meeting-chat send that failed silently.
 *
 * Reported as "real-time messaging is not working properly". It was not the
 * realtime layer: `send()` was called as `void send(text)` with the draft
 * cleared on the very next line, so a rejected send threw into nothing while
 * the box emptied. The message was gone with no trace on screen, in the
 * console, or anywhere else.
 *
 * And it rejects for a reason that is guaranteed to bite this team:
 * `livekit-client` mints the outgoing stream id with `crypto.randomUUID()`,
 * which is SECURE-CONTEXT ONLY. `package.json`'s dev script binds `-H 0.0.0.0`,
 * so a colleague opening `http://<lan-ip>:3000` is on plain http and every
 * single send throws — while the developer on `localhost` sees it work,
 * because localhost is a secure context.
 *
 * These run the real exported function and read the real component, because the
 * failure being tested is the ABSENCE of error handling.
 */

/** Source with comments stripped, the way every source-text test here reads a
    file: this module DOCUMENTS the old `void send(text)` and the Firestore
    question in prose, and an assertion that the bad shape is gone must not be
    satisfied — or defeated — by the paragraph explaining it. */
function code(path: string): string {
  return readFileSync(path, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

const CHAT = code("components/features/meetings/MeetingChat.tsx");

/* ── The reason a person is shown ────────────────────────────────────────── */

test("plain http is named as the cause, not reported as a mystery", () => {
  /* Detected by capability rather than by matching a thrown message, which
     differs between browsers and would break on a library upgrade. */
  const original = globalThis.window;
  (globalThis as { window?: unknown }).window = { isSecureContext: false };
  try {
    const reason = sendFailureReason(new Error("crypto.randomUUID is not a function"));
    assert.match(reason, /secure connection/i);
    assert.match(reason, /https/);
  } finally {
    (globalThis as { window?: unknown }).window = original;
  }
});

test("on a secure page the real error is carried through, not swallowed", () => {
  const original = globalThis.window;
  (globalThis as { window?: unknown }).window = { isSecureContext: true };
  try {
    const reason = sendFailureReason(new Error("data channel closed"));
    assert.match(reason, /did not send/);
    assert.match(reason, /data channel closed/, "the real cause was hidden");
    assert.match(reason, /still in the box/, "must say the text was kept");
  } finally {
    (globalThis as { window?: unknown }).window = original;
  }
});

test("a non-Error rejection still produces a sentence", () => {
  const original = globalThis.window;
  (globalThis as { window?: unknown }).window = { isSecureContext: true };
  try {
    for (const thrown of [undefined, null, "boom", 42, {}]) {
      const reason = sendFailureReason(thrown);
      assert.match(reason, /did not send/, `${String(thrown)} produced nothing`);
    }
  } finally {
    (globalThis as { window?: unknown }).window = original;
  }
});

/* ── The component actually handles it ───────────────────────────────────── */

test("the send is awaited and caught, never fired into the void", () => {
  assert.match(CHAT, /await send\(text\)/, "the send is not awaited");
  assert.match(CHAT, /catch \(err\)/, "a rejected send has nowhere to go");
  assert.doesNotMatch(
    CHAT,
    /void send\(/,
    "the unhandled fire-and-forget send is back",
  );
});

test("the draft is cleared only after the send resolves", () => {
  /**
   * The heart of it. Clearing first made a failure indistinguishable from a
   * success — the box emptied either way, so the only signal a person got was
   * their message not appearing, which reads as somebody else's problem.
   */
  const submit = CHAT.slice(CHAT.indexOf("const submit ="));
  const body = submit.slice(0, submit.indexOf("};"));
  assert.ok(
    body.indexOf("await send(text)") < body.indexOf('setDraft("")'),
    "the draft is still cleared before the send is known to have worked",
  );
});

test("the failure is shown, and announced", () => {
  assert.match(CHAT, /setSendError\(sendFailureReason\(err\)\)/);
  assert.match(CHAT, /role="alert"/, "a silent failure is the original bug");
});

test("the failure is shown OUTSIDE the message list", () => {
  /* The message never became a message. Putting the failure where messages go
     would imply it had — and LiveKit's array, which is what the list renders,
     a failed send never reaches. */
  const alertAt = CHAT.indexOf('role="alert"');
  const listAt = CHAT.indexOf('aria-label="Meeting chat"');
  assert.ok(alertAt > listAt, "the error was rendered inside the transcript");
});

/* ── and the transport is unchanged ──────────────────────────────────────── */

test("chat still rides the data channel, with the hook called bare", () => {
  /**
   * `roomParity.test.ts` already asserts `useChat()`. This adds the other half:
   * `useChat({...})` would ALSO break that regex — and worse, `options` sits in
   * the hook's memo dependency array, so passing an inline object resets
   * `chatMessages` to [] on every render.
   */
  assert.match(CHAT, /useChat\(\)/);
  assert.doesNotMatch(
    CHAT,
    /useChat\(\{/,
    "an inline options object empties the message list on every render",
  );
});

test("the panel now persists through the ledger", () => {
  /**
   * Persistence has since shipped (owner-approved): the panel writes each sent
   * message to the durable ledger and reads history back, MERGING it with the
   * live channel so a refresh does not lose the conversation and a late joiner
   * can read it. This is the assertion that flipped when it did — the "not
   * saved" copy is now conditional on a room that cannot persist (a task room),
   * and the help article says meeting chat is saved.
   *
   * Delivery is UNCHANGED — still LiveKit's data channel (test above) — so a
   * ledger that is down leaves live chat working exactly as before.
   */
  assert.match(CHAT, /mergeChat\(/, "the live and stored copies are no longer merged");
  assert.match(CHAT, /ledger\.record\(/, "a sent message is not written to the ledger");
  assert.match(CHAT, /ledger\.list\(/, "history is never read back");
  assert.match(
    CHAT,
    /isPersistableMeetId|canPersist/,
    "a task room, whose id the ledger refuses, is not kept ephemeral",
  );
});

test("a file can be attached and shared", () => {
  /* File sharing rides the ledger, not the data channel (attachments never went
     over LiveKit). The panel uploads through the ledger and renders the result
     with the shared attachment component. */
  assert.match(CHAT, /ledger\.upload\(/, "no file is uploaded");
  assert.match(CHAT, /MessageAttachments/, "attachments are not rendered");
  assert.match(CHAT, /canUpload/, "the attach control is not gated on the ability to upload");
});
