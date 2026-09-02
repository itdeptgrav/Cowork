import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";

/**
 * The blank disc in the People column.
 *
 * Reported as "no people is there": beside the owner and the arrow, the second
 * monogram was an empty grey circle on row after row.
 *
 * The cause is a shape the engine states plainly where it filters the queue —
 * "a cross-department task waiting at the gate keeps its person in
 * `pendingAssigneeId` with an EMPTY `assigneeIds`". So on precisely the tasks
 * that sit in a list waiting for something — a budget to be set, a department
 * to decide — `assignees` is empty and `pendingAssignees` holds the person. The
 * cell read only the first.
 *
 * That made the column blankest on the rows a reader opens it for: the ones
 * waiting on somebody. `signals.ts` already folded the two together for the
 * dashboard with a comment naming this same case; the table never did.
 */

function code(path: string): string {
  return readFileSync(path, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

const TABLE = "components/features/tasks/TaskTable.tsx";

test("the people cell falls back to whoever the task is offered to", () => {
  const src = code(TABLE);
  assert.match(
    src,
    /const holder = view\.assignees\[0\] \?\? view\.pendingAssignees\[0\] \?\? null;/,
  );
  assert.doesNotMatch(
    src,
    /\{view\.assignees\[0\] \? \(/,
    "the cell reads assignees alone again, so a gated task shows nobody",
  );
});

test("an accepted assignee always wins over a pending one", () => {
  /**
   * Order matters and is not cosmetic. `pendingAssignees` is a stand-in for a
   * seat nobody has taken; putting it first would let a stale pending record
   * mask the person actually doing the work.
   *
   * The dashboard reads them the other way round deliberately — it is
   * answering "who is this waiting on", not "who holds this" — so the two are
   * allowed to differ, and this pins which one the TABLE is.
   */
  const src = code(TABLE);
  const at = src.indexOf("const holder =");
  const line = src.slice(at, src.indexOf(";", at));
  assert.ok(
    line.indexOf("view.assignees[0]") < line.indexOf("view.pendingAssignees[0]"),
    "pendingAssignees is consulted before assignees",
  );
});

test("a pending holder is drawn as not having accepted", () => {
  /* A plain monogram would say the work was handed over. It has been offered.
     The distinction is the whole content of these rows. */
  const src = code(TABLE);
  assert.match(
    src,
    /const holderIsPending = !view\.assignees\[0\] && Boolean\(view\.pendingAssignees\[0\]\)/,
  );
  assert.match(src, /outline-dashed/);
  assert.match(src, /has not accepted yet/);
});

test("a task with nobody on either list still shows the empty disc", () => {
  /* An unassigned task genuinely has nobody on the right of the arrow, and
     inventing a monogram for it would be worse than the blank. */
  const src = code(TABLE);
  assert.match(
    src,
    /\) : \(\s*<span className="h-7 w-7 shrink-0 rounded-full bg-\[var\(--control\)\]" \/>/,
  );
});

test("the engine still keeps a gated person out of assigneeIds", () => {
  /* The premise of the fix. If this ever changes — a gated person written
     straight into `assigneeIds` — the fallback becomes dead code rather than
     wrong, but the comment above it would be a lie. */
  const legacy = readFileSync("lib/repositories/legacy/index.ts", "utf8");
  assert.match(
    legacy,
    /the gate keeps its person in `pendingAssigneeId` with an EMPTY/,
  );
});

/* ─────────────────────────── the name on hover ──────────────────────────── */

test("an avatar names the person on hover", () => {
  /**
   * A monogram is a two-letter guess and a 28px photograph is barely one. In a
   * column of them, side by side, telling colleagues apart is the whole reason
   * a reader looks at that cell — and the name was already in the markup for
   * screen readers while everybody else got nothing.
   *
   * On `Avatar` rather than on the cell, so every avatar in the product answers
   * the same question the same way.
   */
  const src = code("components/ui/Avatar.tsx");
  assert.match(src, /title=\{name \|\| undefined\}/);
});

test("the hover name does not become the accessible name", () => {
  /* `aria-label` still wins, so a screen reader is not made to read the person
     out twice. Losing it would also drop the word "avatar", which is what tells
     a listener the image is a person rather than decoration. */
  const src = code("components/ui/Avatar.tsx");
  assert.match(src, /aria-label=\{name \? `\$\{name\} avatar` : undefined\}/);
});

test("an avatar with nobody behind it stays silent", () => {
  /* `name` absent means the avatar is decorative — it is `aria-hidden` for the
     same reason — and a tooltip reading "undefined" on hover would be worse
     than no tooltip. */
  const src = code("components/ui/Avatar.tsx");
  assert.match(src, /aria-hidden=\{name \? undefined : true\}/);
  assert.doesNotMatch(src, /title=\{name\}/, "an absent name would render empty");
});
