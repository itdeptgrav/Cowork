import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";

/**
 * Pasting a file into the meeting chat.
 *
 * The Messages thread and the task discussion both accept a pasted file — a
 * document copied from a folder, or a screenshot sitting on the clipboard —
 * and the meeting chat did not, so Ctrl+V in a meeting did nothing at all
 * with a file. It now takes the SAME helper and the SAME upload path as a
 * dropped or picked file: one parser for what counts as a pasted file, one
 * `handleFiles`, one ledger.
 */

function code(path: string): string {
  return readFileSync(path, "utf8")
    .replace(/\r\n/g, "\n")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

const CHAT = code("components/features/meetings/MeetingChat.tsx");

/** The message box's JSX, from its id to the end of the element. */
function box(): string {
  const i = CHAT.indexOf('id="meeting-chat-input"');
  assert.ok(i > 0, "the meeting chat box lost its id");
  return CHAT.slice(i, CHAT.indexOf("/>", i));
}

test("the message box accepts a pasted file", () => {
  const b = box();
  assert.match(b, /onPaste=\{/);
  assert.match(b, /filesFromClipboard\(e\.clipboardData\)/);
  assert.match(b, /void handleFiles\(pasted\)/, "a pasted file does not take the upload path");
});

test("it is the shared clipboard helper, not a second parser", () => {
  /* What counts as a pasted file is decided in one place for every chat, so
     a fix there (a browser that reports a screenshot oddly, say) reaches the
     meeting too. */
  assert.match(
    CHAT,
    /filesFromClipboard,\s*\} from "@\/components\/features\/messages\/MessageAttachments"/,
  );
  const messages = code("components/features/messages/MessagesArea.tsx");
  assert.match(messages, /filesFromClipboard\(e\.clipboardData\)/);
  assert.doesNotMatch(
    CHAT,
    /clipboardData\.(items|files)/,
    "the meeting chat parses the clipboard itself",
  );
});

test("a text paste is left alone", () => {
  /* `preventDefault` only once a file was found; otherwise the paste types
     into the box as it always did — a link, a snippet, a name. */
  const b = box();
  const i = b.indexOf("if (pasted.length)");
  assert.ok(i > 0, "the file check is gone");
  assert.match(b.slice(i, i + 120), /e\.preventDefault\(\)/);
  assert.doesNotMatch(
    b.slice(b.indexOf("onPaste"), i),
    /preventDefault/,
    "a text paste is swallowed too",
  );
});

test("it obeys the ledger's canUpload, like the drop zone and the paperclip", () => {
  /* A task room's chat is live-only and cannot hold a file; there the paste
     must type, not upload into nothing. */
  assert.match(box(), /if \(!ledger\.canUpload\) return;/);
  assert.match(CHAT, /<FileDropZone\s+canUpload=\{ledger\.canUpload\}/);
  assert.match(
    CHAT,
    /const handleFiles = async \(files: File\[\]\) => \{\s*if \(!ledger\.canUpload \|\| files\.length === 0\) return;/,
    "handleFiles no longer checks canUpload itself",
  );
});

test("a guest can paste too, because the guest ledger uploads", () => {
  const ledger = code("lib/legacy-ui/meetingChatLedger.ts");
  const guest = ledger.slice(ledger.indexOf("export function guestLedger"));
  assert.match(guest.slice(0, 600), /canUpload: persistable/);
});

test("the help article says so, per CLAUDE.md", () => {
  const help = readFileSync("lib/help/knowledge.ts", "utf8");
  assert.match(help, /paste one — a file copied from a folder, or a screenshot on the clipboard/);
  assert.match(help, /"paste a screenshot in a meeting"/);
  assert.match(help, /Can I paste a screenshot into the meeting chat\?/);
});
