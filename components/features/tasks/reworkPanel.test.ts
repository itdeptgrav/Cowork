import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { readTask } from "../../../lib/legacy/tasks.ts";

/**
 * The assignee's side of rework.
 *
 * Work used to come back with a status change and a note buried in the review
 * tab, leaving the person to work out which acceptance criterion had failed.
 * These pin that they are told exactly, and only, what the reviewer selected.
 */

const code = (p: string) =>
  readFileSync(p, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

const PANEL = "components/features/tasks/ReworkPanel.tsx";

function doc(over: Record<string, unknown> = {}) {
  return { id: "T634", taskId: "T634", title: "t", status: "open", ...over } as never;
}

/* ── The read path ────────────────────────────────────────────────────────── */

test("a rework round is read whole — issues, note, reason and files", () => {
  const t = readTask(
    doc({
      reworkHistory: [
        {
          attempt: 1,
          reviewerId: "GR0000",
          reviewerName: "Rishee Ray",
          requirements: ["Fix spacing", "Add missing images"],
          reason: "Not ready",
          note: "Please update according to the attached reference.",
          attachments: [
            { url: "https://x/ref.pdf", name: "Reference.pdf", type: "application/pdf" },
          ],
          requestedAt: "2026-07-29T09:15:00.000Z",
        },
      ],
    }),
  );
  const r = t!.reworkHistory[0];
  assert.deepEqual(r.requirements, ["Fix spacing", "Add missing images"]);
  assert.equal(r.note, "Please update according to the attached reference.");
  assert.equal(r.reviewerName, "Rishee Ray");
  assert.equal(r.attachments[0].name, "Reference.pdf");
  /* `downloadUrl` falls back to `url`, so a link always has somewhere to go. */
  assert.equal(r.attachments[0].downloadUrl, "https://x/ref.pdf");
});

test("every round is kept, oldest first", () => {
  const t = readTask(
    doc({
      reworkHistory: [
        { attempt: 1, requirements: ["A"] },
        { attempt: 2, requirements: ["B"] },
        { attempt: 3, requirements: ["C"] },
      ],
    }),
  );
  assert.deepEqual(
    t!.reworkHistory.map((r) => r.attempt),
    [1, 2, 3],
  );
});

test("an attachment without a url is dropped rather than linked nowhere", () => {
  const t = readTask(
    doc({
      reworkHistory: [
        { attempt: 1, attachments: [{ name: "broken" }, { url: "https://x/a.png" }] },
      ],
    }),
  );
  assert.equal(t!.reworkHistory[0].attachments.length, 1);
});

test("a task never sent back has no history and no outstanding issues", () => {
  const t = readTask(doc({}));
  assert.deepEqual(t!.reworkHistory, []);
  assert.deepEqual(t!.completionRequirementsFailed, []);
});

test("malformed history entries do not break the read", () => {
  const t = readTask(doc({ reworkHistory: [null, "x", 7, { attempt: 2 }] }));
  assert.equal(t!.reworkHistory.length, 1);
  assert.equal(t!.reworkHistory[0].attempt, 2);
});

/* ── What the panel renders ───────────────────────────────────────────────── */

test("only the selected criteria are shown, never the whole checklist", () => {
  /* Showing every requirement would bury the two that need fixing among the
     ones that were accepted — the state this replaces. */
  const src = code(PANEL);
  assert.match(src, /view\.reworkRequested/);
  assert.equal(
    /completion\.requirements/.test(src),
    false,
    "the full checklist is being rendered",
  );
});

test("a task that was never returned renders nothing at all", () => {
  /* Rather than an empty panel announcing a process that has not happened. */
  const src = code(PANEL);
  assert.match(
    src,
    /if \(active\.length === 0 && history\.length === 0\) return null;/,
  );
});

test("the note and files come from the round that raised them", () => {
  /* The bare criteria list carries neither. */
  const src = code(PANEL);
  assert.match(src, /history\[history\.length - 1\]/);
  assert.match(src, /latest\?\.note/);
  assert.match(src, /latest\.attachments\.length > 0/);
});

test("resubmitting clears the warning and keeps the record", () => {
  const src = code(PANEL);
  assert.match(src, /has since been\s*\n?\s*resubmitted/);
  assert.match(src, /history\.length > 0 &&/);
});

test("timestamps are IST, through the shared formatter", () => {
  const src = code(PANEL);
  assert.match(src, /formatStamp\(r\.requestedAt\)/);
  assert.equal(/toLocale/.test(src), false, "a device clock is being read");
});

test("reviewer-supplied links cannot reach back into the page", () => {
  /* These URLs come from a reviewer and open in a new tab. */
  const src = code(PANEL);
  assert.match(src, /rel="noopener noreferrer"/);
  assert.match(src, /target="_blank"/);
});

test("the panel only reads — it cannot change a task", () => {
  const src = code(PANEL);
  for (const call of ["useAction", "reviewSubmission(", "setDoc(", "fetch("]) {
    assert.equal(src.includes(call), false, `the panel performs "${call}"`);
  }
});
