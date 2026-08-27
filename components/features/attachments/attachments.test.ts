import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import {
  fileGlyph,
  formatBytes,
  isPdf,
  isPreviewableImage,
  localRefusal,
} from "./attachmentRules.ts";

/**
 * The reusable attachment layer.
 *
 * The rule everything here serves: a Cowork file is reachable only through the
 * engine's authenticated route. No component may construct a storage URL, and
 * no preview may skip the permission check a download performs.
 */

const code = (p: string) =>
  readFileSync(p, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

const COMPONENTS = "components/features/attachments/Attachments.tsx";
const RULES = "components/features/attachments/attachmentRules.ts";
const WIRE = "lib/legacy/attachments.ts";

function file(name: string, size: number, type = ""): File {
  return { name, size, type } as File;
}

/* ── Local validation, before a round trip ────────────────────────────────── */

test("there is no size cap — a large file is not refused", () => {
  /* The 50 MB cap was withdrawn on the owner's instruction, on this side and in
     the engine together. Asserted rather than merely deleted: a client check
     that outlived the server's would refuse a file the product accepts, with no
     error to read and nothing to appeal to. */
  assert.equal(localRefusal(file("ok.pdf", 49 * 1024 * 1024)), null);
  assert.equal(localRefusal(file("big.pdf", 51 * 1024 * 1024)), null);
  assert.equal(localRefusal(file("huge.pdf", 2 * 1024 * 1024 * 1024)), null);
});

test("an empty file is refused", () => {
  assert.match(localRefusal(file("empty.pdf", 0))!, /empty/);
});

test("the local check is not the authority", () => {
  /* It cannot be: it sees a name and a size, and the engine reads the bytes.
     A comment saying so is not enough — this asserts the component sends every
     accepted file to the engine rather than deciding types itself. */
  const src = code(COMPONENTS);
  assert.equal(
    /sniff|magic/.test(code(RULES)),
    false,
    "the component is deciding a file's real type",
  );
  assert.match(src, /repo\.uploadAttachment\(/);
});

/* ── Presentation helpers ─────────────────────────────────────────────────── */

test("a file's kind is shown from its type, then its name", () => {
  assert.equal(fileGlyph("image/png"), "🖼");
  assert.equal(fileGlyph("application/pdf"), "📄");
  assert.equal(fileGlyph("", "quarterly.xlsx"), "📊");
  assert.equal(fileGlyph("", "deck.pptx"), "📽");
  assert.equal(fileGlyph("", "notes.docx"), "📝");
  assert.equal(fileGlyph("application/x-thing", "unknown.bin"), "📎");

  /* Video, audio and archives fell through to the paperclip, so a submission
     holding a clip, a recording and a zip showed three identical rows. */
  assert.equal(fileGlyph("video/mp4", "clip.mp4"), "🎬");
  assert.equal(fileGlyph("", "recording.mov"), "🎬");
  assert.equal(fileGlyph("", "screen.webm"), "🎬");
  assert.equal(fileGlyph("audio/mpeg", "track.mp3"), "🎵");
  assert.equal(fileGlyph("", "note.m4a"), "🎵");
  assert.equal(fileGlyph("application/zip", "deliverable.zip"), "🗜");
  assert.equal(fileGlyph("", "source.7z"), "🗜");

  /* A video must not be mistaken for a document because "mpeg" and "mpg"
     share letters with nothing here, but `.m4v` and `.m4a` differ by one. */
  assert.equal(fileGlyph("", "movie.m4v"), "🎬");
  assert.equal(fileGlyph("", "song.m4a"), "🎵");
});

test("only formats a browser can render inline are previewed", () => {
  for (const t of ["image/png", "image/jpeg", "image/webp"]) {
    assert.equal(isPreviewableImage(t), true, t);
  }
  /* SVG is deliberately absent: it can carry script, and it is not on the
     engine's allow-list either. */
  for (const t of ["image/svg+xml", "application/pdf", "text/html"]) {
    assert.equal(isPreviewableImage(t), false, t);
  }
  assert.equal(isPdf("application/pdf"), true);
});

test("sizes read as sizes, and nothing is shown for an unknown one", () => {
  assert.equal(formatBytes(512), "512 B");
  assert.equal(formatBytes(2048), "2 KB");
  assert.equal(formatBytes(5 * 1024 * 1024), "5.0 MB");
  assert.equal(formatBytes(0), "");
  assert.equal(formatBytes(Number.NaN), "");
});

/* ── The security properties ──────────────────────────────────────────────── */

test("no component ever builds a storage URL", () => {
  /* The whole point. A Drive link on screen is a way to the file with none of
     the checks the route performs. */
  const src = code(COMPONENTS);
  for (const leak of ["drive.google", "googleusercontent", "webViewLink", "storageFileId"]) {
    assert.equal(src.includes(leak), false, `a storage URL leaked: ${leak}`);
  }
});

test("bytes reach the page only as a blob from the repository", () => {
  const src = code(COMPONENTS);
  assert.match(src, /repo\.downloadAttachment\(/);
  assert.match(src, /URL\.createObjectURL\(/);
  /* And no raw fetch: a component calling the API directly would bypass the
     repository seam and the token it holds. */
  assert.equal(/\bfetch\(/.test(src), false, "a component is calling fetch");
});

test("every object URL is revoked", () => {
  /* Otherwise each previewed image leaks a live handle for the tab's lifetime,
     and a leaked handle is a shareable one. */
  const src = code(COMPONENTS);
  assert.equal(
    (src.match(/URL\.revokeObjectURL\(/g) ?? []).length,
    (src.match(/URL\.createObjectURL\(/g) ?? []).length,
  );
});

test("a preview is fetched through the same checked path as a download", () => {
  /* A thumbnail that skipped the check would be the leak this system exists to
     prevent — which is also why `next/image` is disabled here: it re-fetches
     the src from its own server, with no viewer token. */
  const src = readFileSync(COMPONENTS, "utf8");
  assert.match(src, /no-img-element/);
  assert.match(src, /cannot carry the viewer's\s*\n?\s*token/);
});

test("an unauthorised download surfaces the engine's refusal", () => {
  const src = code(COMPONENTS);
  assert.match(src, /if \(!r\.ok\) \{[\s\S]{0,120}setError\(r\.message\)/);
});

/* ── The wire ─────────────────────────────────────────────────────────────── */

test("upload and download both carry the bearer token", () => {
  const src = code(WIRE);
  assert.equal((src.match(/Authorization/g) ?? []).length, 4);
});

test("a refusal is not offered a retry, a dropped connection is", () => {
  const src = code(WIRE);
  assert.match(src, /status === 403\s*\n?\s*\?\s*"permission"/);
  assert.match(src, /status === 0\s*\n?\s*\?\s*"network"/);
});

test("progress is reported, because a silent upload looks hung", () => {
  const src = code(WIRE);
  assert.match(src, /xhr\.upload\.onprogress/);
  assert.match(src, /e\.loaded \/ e\.total/);
});

test("the review sends attachment IDs, never bytes", () => {
  /* The file is stored and permission-checked before the review request is
     made, so that request cannot become a second upload path. */
  const panel = code("components/features/tasks/ReviewPanel.tsx");
  assert.match(panel, /reworkAttachmentIds: decision === "rework" \? files\.map\(\(f\) => f\.id\) : \[\]/);
  assert.match(panel, /<FileUploader/);
  /* And the shared component, not a rework-specific one. */
  assert.equal(/ReworkUploader|TaskUploader/.test(panel), false);
});

test("the employee reads files through the authenticated component", () => {
  const panel = code("components/features/tasks/ReworkPanel.tsx");
  /* `rework`, not `task` — correction files are a separate group now, which is
     the fix this assertion was updated for. */
  assert.match(panel, /<EntityAttachments entityType="rework"/);
});

/* ── Integration: creation, details, rework ───────────────────────────────── */

const NEW_TASK = "components/features/tasks/NewTaskForm.tsx";
const FILES = "components/features/tasks/TaskFilesPanel.tsx";

test("every origin a file can arrive through is asked for", () => {
  /*
   * ASSERTION CHANGED ON PURPOSE — was "the three kinds of file are never mixed
   * into one list", asserting three separately-titled `EntityAttachments`
   * groups in `TaskFiles.tsx` (now deleted).
   *
   * What that test protected was the DISTINCTION between reference material,
   * deliverables and corrections — "what am I working from", "what did they
   * hand in", "what has to change". The distinction is kept; the three lists
   * are not. It now travels as `source` on every row, with a filter chip per
   * source, because three lists could only ever hold the three origins the
   * ENGINE separates by entityType — and two more real ones (files sent in the
   * chat, files on a daily report) had no list at all and were reachable only
   * by scrolling the surface that carried them.
   *
   * So the check moved from "these are three lists" to "all five origins are
   * read", which is the property that actually breaks a search for a file.
   */
  const src = code(FILES);
  for (const call of [
    'getAttachments("task"',
    'getAttachments("rework"',
    'getAttachments("submission"',
    "listSubmissions(",
    "listDailyReports(",
    'listTaskChat(taskId, "chat")',
    'listTaskChat(taskId, "draft")',
  ]) {
    assert.ok(src.includes(call), `the Files tab never reads ${call}`);
  }
});

test("one origin failing does not take the others down with it", () => {
  /* `Promise.all` here would mean a chat read that rejects blanks the reference
     files that loaded — and the reader would conclude the file is gone rather
     than that one list did not arrive. Each failure is named instead. */
  const src = code(FILES);
  assert.match(src, /allSettled/);
  assert.equal(
    /await Promise\.all\(/.test(src),
    false,
    "a single rejection would blank every other origin",
  );
  assert.match(src, /problems\.push/);
});

test("the private/public distinction survives the pooling", () => {
  /* Reference, submitted and correction files are served by the engine behind a
     permission check. Chat and report files are public media — anybody with the
     URL can open one. Both were already true; putting them in one list is what
     makes it worth saying on screen, and a row that did not say so would teach
     the reader that every file here is guarded. */
  const rules = code("lib/rules/tasks/taskFiles.ts");
  assert.match(rules, /access: "private"/);
  assert.match(rules, /access: "link"/);
  const src = code(FILES);
  assert.match(src, /access === "link"/);
});

test("rework files are attached as rework, not as task reference files", () => {
  /* This was wrong when first shipped: correction screenshots landed in the
     creator's own reference list. */
  const panel = code("components/features/tasks/ReviewPanel.tsx");
  assert.match(panel, /entityType="rework"/);
  assert.equal(
    /<FileUploader\s+entityType="task"/.test(panel),
    false,
    "correction files are mixing into the task's reference list",
  );
});

test("an untitled empty group renders nothing at all", () => {
  /* An untitled group is embedded in somebody else's layout and stays silent
     when it has nothing. A TITLED one now says "No files attached" instead —
     the reader asked for that group by name and deserves an answer. */
  const src = code(COMPONENTS);
  const fn = src.slice(src.indexOf("export function EntityAttachments("));
  assert.match(fn.slice(0, 2600), /if \(!title\) return null;/);
  assert.match(fn.slice(0, 2600), /No files attached/);
});

test("loading, empty and error are three distinct states", () => {
  /* Before this, a section still loading and a section with nothing looked
     identical, so a slow response read as "no files". */
  const fn = code(COMPONENTS).slice(
    code(COMPONENTS).indexOf("export function EntityAttachments("),
  );
  assert.match(fn.slice(0, 2600), /if \(!settled\) \{/);
  assert.match(fn.slice(0, 2600), /Unable to load files/);
  assert.match(fn.slice(0, 2600), /No files attached/);
});

test("a previous entity's files never show under a new one", () => {
  /* The state is keyed, so switching task shows ITS loading state rather than
     the last task's list. */
  const fn = code(COMPONENTS).slice(
    code(COMPONENTS).indexOf("export function EntityAttachments("),
  );
  assert.match(fn.slice(0, 2600), /state\?\.key === key \? state : null/);
});

test("task creation stages files and uploads AFTER the task exists", () => {
  /* The engine checks permission against the task, so an upload before there
     is one has nothing to check. That inverts the obvious order and is the
     only order the permission model allows. */
  const src = code(NEW_TASK);
  assert.match(src, /entityId=\{null\}/);
  const handler = src.slice(src.indexOf("const r = await create()"));
  const createAt = handler.indexOf("create()");
  const uploadAt = handler.indexOf("repo.uploadAttachment");
  assert.ok(createAt >= 0 && uploadAt > createAt, "files upload before create");
  assert.match(handler.slice(0, 900), /entityId: r\.data\.id/);
});

test("a failed upload does not discard the created task", () => {
  /* The task is already real; throwing it away would lose the work. The person
     is told which files did not make it. */
  const src = code(NEW_TASK);
  assert.match(src, /setUploadFailures\(failed\)/);
  assert.match(src, /did not upload/);
});

test("staging reuses the shared uploader rather than a second one", () => {
  const src = code(NEW_TASK);
  assert.match(src, /<FileUploader/);
  assert.equal(/TaskUploader|CreateUploader/.test(src), false);
});

test("staged files are refused locally before the task is even created", () => {
  /* So an oversized file is caught while it can still be swapped, not after a
     task has been made for it. */
  const src = code(COMPONENTS);
  const fn = src.slice(src.indexOf("if (isStaging) {"));
  assert.match(fn.slice(0, 900), /localRefusal\(file\)/);
});

/* ── Submissions ──────────────────────────────────────────────────────────── */

const SUBMISSION = "components/features/tasks/SubmissionPanel.tsx";

test("submission files are staged, then uploaded once the submission exists", () => {
  /* Same ordering constraint as task creation: nothing to attach to until the
     record is made. */
  const src = code(SUBMISSION);
  assert.match(src, /entityId=\{null\}/);
  const handler = src.slice(src.indexOf("const r = await submit()"));
  assert.ok(
    handler.indexOf("submit()") < handler.indexOf("repo.uploadAttachment"),
    "files upload before the submission exists",
  );
});

test("each attempt's files hang off THAT submission, not the task", () => {
  /* Pooling them on the task would merge every attempt into one list and lose
     the trail rework depends on: "#1 had the old document, #2 the corrected". */
  const src = code(SUBMISSION);
  assert.match(src, /entityType: "submission",\s*\n?\s*entityId: target/);
  assert.match(src, /repo\.listSubmissions\(taskId\)/);
  assert.equal(
    /entityType: "submission",\s*\n?\s*entityId: taskId/.test(src),
    false,
    "submission files are pooled on the task",
  );
});

test("the submission id is read back, never assumed", () => {
  /* The engine assigns it. */
  const src = code(SUBMISSION);
  assert.match(src, /const fresh = await repo\.listSubmissions\(taskId\)/);
  assert.match(src, /fresh\[0\]\?\.id \?\? null/);
});

test("a failed upload does not retract the submission", () => {
  /* The work is already with the reviewer; retracting it would be worse than a
     missing file the person can still add. */
  const src = code(SUBMISSION);
  assert.match(src, /did not upload/);
  assert.match(src, /setUploadFailures\(failed\)/);
});

test("submitting without files still works", () => {
  /* The upload block is skipped entirely, so an empty submission takes no extra
     round trip and cannot fail on attachments. */
  const src = code(SUBMISSION);
  assert.match(src, /if \(staged\.length > 0\)/);
});

test("the reviewer sees each attempt separately, and in a defined order", () => {
  /**
   * **What matters is the audit trail, not the syntax that produces it.**
   *
   * This asserted `attempt ${i + 1}` and `.reverse()` — two implementation
   * details that have both been improved out of existence, so it was failing
   * for code that does the job better than the code it was written against.
   *
   * `i + 1` was the array INDEX. The label now comes from `submissionContext`,
   * which reads the submission's own `attempt` number — so a list that is
   * filtered or partially loaded cannot mislabel attempt 3 as attempt 1.
   *
   * `.reverse()` was replaced by `sortTaskFiles`, which orders newest-first and
   * puts undated files LAST rather than first; reversing an array only orders
   * it correctly if it arrived sorted, which is an assumption about a caller.
   */
  const src = code(FILES);
  /* One read per attempt — pooling files under the task id would lose which
     version of the work each belongs to, which is the whole trail after a
     rework. */
  assert.match(src, /listSubmissions\(taskId\)/);
  assert.match(src, /r\.getAttachments\("submission", sub\.id\)/);
  /* Labelled from the submission's own attempt number. */
  assert.match(src, /submissionContext\(sub\)/);
  /* Ordered by the shared rule rather than by array position. */
  assert.match(src, /sortTaskFiles\(files\)/);
});

test("composite entity ids resolve to their task for the permission check", (t) => {
  /* `T634#submission-2` must gate against T634. Without this the per-submission
     id would 404 and every submitted file would be unreachable. */
  const backend = "/Users/risheeray/Documents/cowork-old-backend/routes/task_routes/coworkAttachments.js";
  let src: string;
  try {
    src = code(backend);
  } catch {
    return t.skip("backend not present");
  }
  const fn = src.slice(src.indexOf("function taskIdFor("));
  assert.match(fn.slice(0, 800), /raw\.indexOf\("#"\)/);
  assert.match(fn.slice(0, 800), /raw\.slice\(0, at\)/);
});

/* ── Why nothing is visible yet ───────────────────────────────────────────── */

test("the assignee is granted access by the SERVER, not by the client", () => {
  /* The permission question is settled in `mayViewTask`, which lists the
     assignee first. No component filters attachments, so a "creator sees them,
     assignee does not" split cannot originate in the UI. */
  const backend =
    "/Users/risheeray/Documents/cowork-old-backend/routes/task_routes/coworkAttachments.js";
  let src: string;
  try {
    src = code(backend);
  } catch {
    return;
  }
  const fn = src.slice(src.indexOf("async function mayViewTask("));
  assert.match(fn.slice(0, 1200), /task\.assigneeIds \|\| \[\]/);
  /* And the same gate serves upload, download and list — one rule, so the three
     cannot disagree about one person. */
  assert.equal((src.match(/mayViewTask\(/g) ?? []).length, 5);
});

test("no component filters attachments by viewer", () => {
  /* A client-side filter would be both a second permission model and a way for
     the two to drift. The engine returns what the viewer may see; the UI shows
     all of it. */
  for (const path of [
    COMPONENTS,
    "components/features/tasks/TaskFilesPanel.tsx",
    "components/features/tasks/ReworkPanel.tsx",
  ]) {
    const src = code(path);
    assert.equal(
      /viewerId|uploadedBy ===|\.filter\(\(a\) => a\.uploadedBy/.test(src),
      false,
      `${path} filters attachments client-side`,
    );
  }
});

test("the files surface is mounted for every viewer of a task", () => {
  /* Not behind a role check, so an assignee opening a task runs the same fetch
     a creator does.

     ASSERTION CHANGED ON PURPOSE — it used to look for `<TaskFiles view={view}
     />` inside `Overview`. Files are their own tab now, so the mount moved; the
     property being protected did not, and it is the only one this test was ever
     about. The tab is offered on a project too, which the four work tabs are
     not: a project's reference material and its chat are real even though
     nobody works the task itself. */
  const detail = code("components/features/tasks/TaskDetail.tsx");
  assert.match(detail, /tab === "files" && <TaskFilesPanel view=\{v\} \/>/);
  const at = detail.indexOf("<TaskFilesPanel");
  const before = detail.slice(Math.max(0, at - 400), at);
  assert.equal(
    /isCreator|isManager|role ===|can\(/.test(before),
    false,
    "the files section is gated by role",
  );
  /* And the tab itself is not conditioned on the container check the work tabs
     use — `isContainer ? [] : [...]` must not contain it. */
  /**
   * To the END of the tabs array, not to the first `return (`.
   *
   * That boundary was searched from the start of the FILE, and this component
   * has an earlier `return (` — an early-out above the tab list. So the slice
   * ran backwards and came out EMPTY, every `indexOf` below answered -1, and
   * `-1 > -1` failed. The assertion reported "Files is inside the tabs list"
   * about a file where it plainly is. A slice boundary is not a fact about the
   * code, and this is the second time that has bitten in this suite.
   */
  const tabsAt = detail.indexOf("const tabs = [");
  const bar = detail.slice(tabsAt, detail.indexOf("];", tabsAt));
  const filesEntry = bar.indexOf('id: "files"');
  assert.ok(filesEntry > 0, "Files is missing from the tabs list");
  /* **The property, not the position.**
     These two used to assert Files came AFTER the container exclusion and
     after Chat, as a proxy for "Files is not inside the exclusion". Files and
     Reports were later swapped in the bar; the proxy broke and the property it
     stood for did not. Read the spread and check Files is not in it, which is
     the thing that actually matters — a project must keep its files. */
  const spreadAt = bar.indexOf("...(isContainer");
  const exclusion =
    spreadAt < 0 ? "" : bar.slice(spreadAt, bar.indexOf("]),", spreadAt));
  assert.equal(
    exclusion.includes('id: "files"'),
    false,
    "Files is inside the project-only exclusion — a project would lose it",
  );
});

test("a failed list is reported, never flattened to an empty array", () => {
  /* Reversed deliberately. This used to assert `r.ok ? r.data : []` — and that
     flattening is exactly what made a storage outage look like a task with no
     files, so the fault was chased through the UI for two rounds before anyone
     read the collection. */
  const repo = code("lib/repositories/legacy/index.ts");
  const fn = repo.slice(repo.indexOf("async getAttachments("));
  assert.equal(/return r\.ok \? r\.data : \[\]/.test(fn.slice(0, 900)), false);
  assert.match(fn.slice(0, 900), /if \(!r\.ok\) \{/);
});

test("the UI shows the failure rather than rendering nothing", () => {
  const src = code(COMPONENTS);
  assert.match(src, /Unable to load files — \{error\}/);
  /* And an empty section still means genuinely zero files. */
  assert.match(src, /if \(files\.length === 0\) \{/);
});
