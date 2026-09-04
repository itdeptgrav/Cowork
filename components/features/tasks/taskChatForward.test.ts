import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";

/**
 * Forward in the task chat. It reuses the Messages `ForwardDialog` wholesale —
 * the message is passed on to a conversation as a fresh copy — so the wiring to
 * protect is: the dialog is opened from the menu AND the image viewer, it is
 * handed a task-chat message, and the dialog's prop is widened to accept one.
 */

const strip = (p: string) =>
  readFileSync(p, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

const CHAT = strip("components/features/tasks/ChatPanel.tsx");
const DIALOG = strip("components/features/messages/ForwardDialog.tsx");

test("ForwardDialog accepts any message-shaped value, not only a conversation Message", () => {
  /* Widened from `message: Message` so a TaskChatMessage — which also carries
     text and attachments — satisfies it. */
  assert.match(DIALOG, /message: Pick<Message, "text" \| "attachments">;/);
  /* And it only ever forwards those two fields. */
  assert.match(DIALOG, /message\.text,\s*\n\s*message\.attachments \?\? \[\],/);
});

test("the task chat opens ForwardDialog for the message being forwarded", () => {
  assert.match(CHAT, /import \{ ForwardDialog \} from "@\/components\/features\/messages\/ForwardDialog";/);
  assert.match(CHAT, /const \[forwarding, setForwarding\] = useState<TaskChatMessage \| null>\(null\)/);
  /* A menu item, and the same action from the image viewer. */
  assert.match(CHAT, /id: "forward"/);
  assert.match(CHAT, /run: \(\) => \{\s*setMenu\(null\);\s*setForwarding\(m\);/);
  assert.match(CHAT, /onForward: \(\) => \{\s*setForwarding\(m\);\s*setGalleryIndex\(null\)/);
  /* Rendered with "" for the from-conversation, which hides nothing from the
     picker because a task is not itself a conversation. */
  assert.match(CHAT, /<ForwardDialog[\s\S]*?message=\{forwarding\}[\s\S]*?fromConversationId=""/);
});
