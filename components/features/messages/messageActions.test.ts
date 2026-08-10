import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { test } from "node:test";

/**
 * The message menu, and the one rule inside it that is not obvious.
 *
 * **Reply, Forward and Copy are the same act whoever wrote the message**, so
 * they are offered on both sides of the thread with nothing conditional about
 * them. **Delete is not**: the engine refuses another sender's message, and the
 * decision recorded here is that the item is still SHOWN on both sides — greyed,
 * with the sentence the engine itself returns. An option that vanishes on
 * somebody else's message reads as a fault; one that explains itself reads as a
 * rule.
 *
 * Read from source rather than rendered: what is being protected is which items
 * exist and what gates them, and that survives a component being restyled.
 */

const AREA = "components/features/messages/MessagesArea.tsx";
const MENU = "components/features/messages/MessageContextMenu.tsx";
const FORWARD = "components/features/messages/ForwardDialog.tsx";

function code(path: string): string {
  return readFileSync(path, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

/** The `menuFor` body — where every item and every gate lives. */
function menuBody(): string {
  const src = code(AREA);
  const at = src.indexOf("function menuFor(");
  assert.ok(at > 0, "menuFor is gone — the menu has no items");
  return src.slice(at, src.indexOf("\n  }", at));
}

test("the menu offers all four actions", () => {
  const body = menuBody();
  for (const id of ["reply", "forward", "copy", "delete"]) {
    assert.match(body, new RegExp(`id: "${id}"`), `${id} is missing`);
  }
});

test("reply, forward and copy are offered on BOTH sides", () => {
  /* None of the three may be gated on `mine`. Only their own emptiness or a
     tombstone can disable them. */
  const body = menuBody();
  /* The three item objects themselves, not the surrounding function — `mine` is
     legitimately declared above them and legitimately gates Edit below. */
  const three = body.slice(body.indexOf('id: "reply"'), body.indexOf('...(mine'));
  assert.ok(
    three.includes('id: "forward"') && three.includes('id: "copy"'),
    "the three are no longer declared together — this slice is wrong",
  );
  assert.ok(
    !/\bmine\b/.test(three),
    "one of reply/forward/copy is conditional on who sent the message",
  );
});

test("delete is present on both sides, and disabled with a reason on one", () => {
  const body = menuBody();
  const del = body.slice(body.indexOf('id: "delete"'));
  assert.match(del, /disabled: !mine \|\| deleted/);
  assert.match(
    del,
    /You can only delete your own messages\./,
    "the refusal no longer quotes the sentence the engine returns",
  );
  assert.ok(
    !/mine \?\s*\[[\s\S]*id: "delete"/.test(body),
    "delete is hidden on the receiver's side again",
  );
});

test("a disabled item says why, rather than sitting there dead", () => {
  const menu = code(MENU);
  assert.match(menu, /item\.disabled && item\.reason/);
  assert.match(menu, /disabled=\{item\.disabled\}/);
});

test("the menu is opened by right-click, on the whole row", () => {
  /* On the row rather than the bubble: a menu that only opens on the coloured
     rectangle is one people think is broken when they aim slightly wide. */
  const src = code(AREA);
  assert.match(src, /onContextMenu=\{\(e\) => \{\s*e\.preventDefault\(\);/);
  assert.match(src, /onContextMenu\(m, e\.clientX, e\.clientY\)/);
});

test("the hover row keeps the keyboard path to the same actions", () => {
  /* A context menu cannot be reached by tabbing. Removing these as duplicates
     would take the actions away from anybody not using a mouse. */
  const src = code(AREA);
  assert.match(src, /focus-within:opacity-100/);
  assert.match(src, /onClick=\{\(\) => onReply\(m\)\}/);
  assert.match(src, /onClick=\{\(\) => onForward\(m\)\}/);
});

test("forwarding sends a copy, with its attachments, and never moves it", () => {
  const fwd = code(FORWARD);
  assert.match(fwd, /sendMessage\(\s*target\.id,\s*message\.text,\s*message\.attachments \?\? \[\]/);
  assert.ok(
    !/deleteMessage/.test(fwd),
    "forwarding removes the original — it is a copy, not a move",
  );
  assert.match(
    fwd,
    /c\.id !== fromConversationId/,
    "the thread it came from is offered as a destination",
  );
});

test("copying an empty message is refused rather than silently done", () => {
  /* `writeText("")` succeeds and replaces whatever was on the clipboard, which
     is worse than the action being unavailable. */
  const body = menuBody();
  const copy = body.slice(body.indexOf('id: "copy"'), body.indexOf('id: "edit"'));
  assert.match(copy, /!m\.text/);
});
