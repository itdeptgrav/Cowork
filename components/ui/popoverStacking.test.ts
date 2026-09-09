import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

/**
 * A popover cannot escape a transform.
 *
 * `Popover` draws its panel as `absolute z-50` inside a `relative` wrapper, and
 * that works right up until an ancestor creates a **stacking context** — at
 * which point `z-50` is a rank INSIDE that context and cannot outrank anything
 * beyond it. A `transform` creates one. So a sparkle button centred with
 * `top-1/2 -translate-y-1/2` trapped its own panel inside a 24px box, and the
 * next form field — an ordinary positioned sibling — painted straight over the
 * open popover. On the new-task form that was the AI panel on Title being cut
 * in half by the Description field underneath it.
 *
 * `inset-y-0` with flex centring puts the button in exactly the same place and
 * creates no context, so the panel is free again.
 *
 * These read the FORMS rather than `Popover` itself, because the fault is never
 * in the popover — it is in what somebody wrapped the trigger in.
 */

const code = (path: string): string =>
  readFileSync(path, "utf8")
    .replace(/\r\n/g, "\n")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/^[^\S\n]*\/\/.*$/gm, "");

/* Every file where a popover trigger sits in an absolutely-positioned wrapper
   inside a field. Add to this list, do not remove from it. */
const HOSTS = [
  "components/features/tasks/NewTaskForm.tsx",
  "components/features/mail/MailCompose.tsx",
];

test("no popover trigger is centred with a transform", () => {
  for (const path of HOSTS) {
    const src = code(path);
    assert.doesNotMatch(
      src,
      /-translate-y-1\/2">\s*<AiTextAssistButton/,
      `${path} centres an AI popover trigger with a transform, which traps its panel`,
    );
  }
});

test("they are centred the way that creates no stacking context", () => {
  for (const path of HOSTS) {
    const src = code(path);
    assert.match(
      src,
      /className="absolute inset-y-0 right-1\.5 flex items-center">\s*<AiTextAssistButton/,
      `${path} no longer centres its AI trigger with inset-y-0 + flex`,
    );
  }
});

test("the button is still where it was — the trailing edge of the field", () => {
  /* The fix must not have moved the control. `right-1.5` is the inset the
     field's own `pr-9` padding reserves for it. */
  for (const path of HOSTS) {
    const src = code(path);
    assert.match(src, /absolute inset-y-0 right-1\.5/);
    assert.match(src, /className="pr-9"/, `${path} no longer reserves room for the button`);
  }
});

test("the panel still asks for the z-index it needs", () => {
  /* If this ever drops, the fix above stops mattering. */
  const workspace = code("components/ui/Workspace.tsx");
  const at = workspace.indexOf("export function Popover(");
  assert.ok(at !== -1, "Popover moved");
  const fn = workspace.slice(at, at + 2600);
  assert.match(fn, /absolute top-\[calc\(100%\+6px\)\] z-50/);
});
