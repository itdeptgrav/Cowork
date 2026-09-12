import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

/**
 * Picking several files at once must keep all of them.
 *
 * ## The bug
 *
 * `FileUploader.send` is an async closure built during a render, and it loops
 * with an `await` per file. Every success did:
 *
 * ```ts
 * onChange([...attachments, r.data]);
 * ```
 *
 * `attachments` is a PROP, frozen in that closure at the render that created
 * it. So three files produced `[…, one]`, then `[…, two]`, then `[…, three]` —
 * each built from the same stale snapshot, each discarding the one before it.
 * Only the last survived.
 *
 * The files themselves uploaded fine and were recorded against the entity. They
 * simply had nothing in the interface pointing at them, which is worse than a
 * failure: a failure says so.
 *
 * ## What it cost
 *
 * · **The Files tab.** `TaskFilesPanel` merges `added` into the list so an
 *   upload shows immediately. Two of every three went missing from that merge,
 *   and nothing refetches on an upload — so they were invisible until something
 *   unrelated changed the task.
 * · **A reviewer's corrections.** `ReviewPanel` sends `files.map((f) => f.id)`
 *   as `reworkAttachmentIds`. Attaching three correction files sent ONE to the
 *   person being asked to redo the work.
 *
 * The note beside `setPending` in the same function already described this
 * exactly — "reading the prop here would drop every result but the last" — and
 * the progress list was correct because it used a functional update. A prop
 * cannot take one, which is why the current value is held in a ref instead.
 */

const code = (path: string): string =>
  readFileSync(path, "utf8")
    .replace(/\r\n/g, "\n")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/^[^\S\n]*\/\/.*$/gm, "");

const UPLOADER = code("components/features/attachments/Attachments.tsx");
const send = UPLOADER.slice(
  UPLOADER.indexOf("async function send("),
  UPLOADER.indexOf("return (", UPLOADER.indexOf("async function send(")),
);

test("the result is never built from the captured prop", () => {
  /* The exact line that lost files. */
  assert.ok(
    !/onChange\(\[\.\.\.attachments,/.test(send),
    "onChange is spreading the frozen `attachments` prop again",
  );
});

test("each success is built on what the previous one produced", () => {
  assert.match(send, /const next = \[\.\.\.latest\.current, r\.data\];/);
  assert.match(send, /latest\.current = next;/);
  assert.match(send, /onChange\(next\);/);
});

test("the running total is written before the caller is told", () => {
  /* The next iteration of the loop reads it immediately — long before the
     parent's re-render could reach this closure. */
  const write = send.indexOf("latest.current = next;");
  const tell = send.indexOf("onChange(next);");
  assert.ok(write > 0 && tell > write, "onChange runs before the total is updated");
});

test("an outside change to the list is still picked up", () => {
  /* The caller owns the list — it can remove a file, or replace it wholesale.
     The ref has to follow the prop, or a later upload would resurrect a file
     somebody deleted. */
  assert.match(UPLOADER, /const latest = useRef\(attachments\);/);
  assert.match(
    UPLOADER,
    /useEffect\(\(\) => \{\s*latest\.current = attachments;\s*\}, \[attachments\]\);/,
  );
});

test("the progress list keeps its functional update", () => {
  /* It was already right, and it is what proves the fault was understood at the
     time and applied to only half the problem. */
  assert.match(send, /setPending\(\(p\) => p\.filter\(\(x\) => x\.key !== key\)\)/);
});

test("a failure still names the file that failed", () => {
  /* Losing a file silently is the bug above; losing the REASON is its twin. */
  assert.match(send, /setPending\(\s*\(p\) =>\s*p\.map\(\(x\) => \(x\.key === key \? \{ \.\.\.x, error: r\.message \} : x\)\),?\s*\)/);
});

test("staging still accepts a whole batch at once", () => {
  /* The staging branch collects the batch and calls `onStagedChange` once, so
     it never had this fault — and must not grow it. */
  assert.match(send, /onStagedChange\?\.\(\[\.\.\.\(staged \?\? \[\]\), \.\.\.accepted\]\)/);
});

/* ── The two surfaces that were losing files ──────────────────────────────── */

test("the reviewer's corrections are the ids of every file attached", () => {
  const review = code("components/features/tasks/ReviewPanel.tsx");
  assert.match(review, /reworkAttachmentIds: decision === "rework" \? files\.map\(\(f\) => f\.id\) : \[\]/);
  assert.match(review, /attachments=\{files\}\s*\n?\s*onChange=\{setFiles\}/);
});

test("the Files tab shows an upload without waiting for a refetch", () => {
  /* Nothing refetches on an upload, so this merge IS how a new file appears. */
  const files = code("components/features/tasks/TaskFilesPanel.tsx");
  assert.match(files, /const fresh = fromAttachments\(added, "reference", "Supplied with the task"\);/);
  assert.match(files, /fresh\.filter\(\(f\) => !known\.has\(f\.key\)\)/);
  assert.match(files, /attachments=\{added\}\s*\n?\s*onChange=\{setAdded\}/);
});
