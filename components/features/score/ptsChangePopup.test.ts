import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { test } from "node:test";

/**
 * The score-change notice: a popup + toast + sound on the user's next visit,
 * once per change. The which-changes logic is proven in
 * lib/rules/notifications/ptsChanges.test.ts; these pin the wiring.
 */

const code = (p: string) =>
  readFileSync(p, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

const POPUP = code("components/features/score/PtsChangePopup.tsx");
/* The shell is TWO modules since the workspace tree was split out of
   `ShellFrame.tsx` into `WorkspaceShell.tsx` — a bundle split, so that
   /signin stops downloading LiveKit. "Mounted in the shell" is still one
   claim, so both files are read as one text. */
const SHELL =
  code("components/layout/shell/ShellFrame.tsx") +
  code("components/layout/shell/WorkspaceShell.tsx");
const SOUND = code("lib/utils/ptsSound.ts");

test("it reads the ledger and shows only unseen recent changes", () => {
  assert.match(POPUP, /getRepository\(\)\s*\.listLedger\(employeeId\)/);
  assert.match(POPUP, /unseenPtsChanges\(ledger, readSeen\(\), Date\.now\(\)\)/);
  assert.match(POPUP, /if \(result\.changes\.length === 0\) return;/);
});

test("it plays a sound, and a different one for a credit", () => {
  assert.match(POPUP, /playPtsSound\(result\.hasDebit \? "debit" : "credit"\)/);
  /* The tone falls for a cut and rises for a credit. */
  assert.match(SOUND, /kind === "debit"/);
  assert.match(SOUND, /exponentialRampToValueAtTime/);
});

test("it raises a toast through the shell's existing pipeline", () => {
  assert.match(POPUP, /new CustomEvent\("cowork:notification"/);
  assert.match(POPUP, /pts deducted|pts credited/);
});

test("the popup closes after 10s, and on × / Escape / backdrop", () => {
  assert.match(POPUP, /const AUTO_MS = 10_000;/);
  assert.match(POPUP, /setTimeout\(dismiss, AUTO_MS\)/);
  assert.match(POPUP, /e\.key === "Escape"/);
  assert.match(POPUP, /aria-label="Dismiss"/);
  assert.match(POPUP, /aria-label="Close"[\s\S]*?onClick=\{dismiss\}/);
});

test("a shown change is remembered so it never repeats", () => {
  assert.match(POPUP, /const SEEN_KEY = "cowork\.ptscut\.announced\.v1";/);
  assert.match(POPUP, /writeSeen\(\[\.\.\.readSeen\(\), \.\.\.cur\.changes\.map\(\(c\) => c\.id\)\]\)/);
});

test("it is mounted once in the shell, beside the assignment gate", () => {
  assert.match(SHELL, /import \{ PtsChangePopup \}/);
  assert.match(SHELL, /<PtsChangePopup \/>/);
});
