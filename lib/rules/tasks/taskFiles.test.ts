import assert from "node:assert/strict";
import { test } from "node:test";
import {
  NO_FILTER,
  countBySource,
  countByKind,
  fileKind,
  fileNameFrom,
  filterTaskFiles,
  fromAttachments,
  fromChat,
  fromReports,
  sortTaskFiles,
  submissionContext,
  totalSize,
  type TaskFile,
} from "./taskFiles.ts";
import type { DailyReport, TaskChatMessage } from "../../domain/index.ts";
import type { AttachmentMeta } from "../../legacy/attachments.ts";

/* ── Classification ───────────────────────────────────────────────────────── */

test("the mime type decides, and the name only fills a gap", () => {
  assert.equal(fileKind("image/png", "a.png"), "image");
  assert.equal(fileKind("application/pdf", "spec"), "pdf");
  assert.equal(
    fileKind("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "q3"),
    "sheet",
  );
  assert.equal(fileKind("text/csv", "export"), "sheet");
  assert.equal(fileKind("audio/mpeg", "note"), "voice");
  /* No type at all — chat media carries none. */
  assert.equal(fileKind(null, "brief.docx"), "document");
  assert.equal(fileKind("", "photo.HEIC"), "image");
  assert.equal(fileKind(null, "something"), "other");
});

test("a wrong generic mime type does not beat a clear extension", () => {
  /* Browsers send `application/octet-stream` for plenty of ordinary files. It
     carries no information, so the name is the better evidence. */
  assert.equal(fileKind("application/octet-stream", "design.png"), "image");
  assert.equal(fileKind("application/octet-stream", "budget.xlsx"), "sheet");
});

test("a file with no recorded name is named from its URL, not 'Untitled'", () => {
  assert.equal(
    fileNameFrom(null, "https://drive.example/x/Screenshot%202026.png?v=2", "image"),
    "Screenshot 2026.png",
  );
  assert.equal(fileNameFrom("  ", "https://x/y/", "voice"), "Voice note");
  assert.equal(fileNameFrom(null, "https://x/y/nodot", "other"), "Untitled file");
  assert.equal(fileNameFrom("Spec v2.pdf", "https://x/whatever.bin", "pdf"), "Spec v2.pdf");
});

/* ── Normalising each origin ──────────────────────────────────────────────── */

const META = (over: Partial<AttachmentMeta> = {}): AttachmentMeta => ({
  id: "a1",
  name: "brief.pdf",
  type: "application/pdf",
  size: 2048,
  uploadedBy: "GR0045",
  uploadedAt: "2026-08-01T09:00:00.000Z",
  ...over,
});

test("private files are marked private and carry their id, never a URL", () => {
  const [f] = fromAttachments([META()], "reference", "Supplied with the task");
  assert.equal(f.access, "private");
  assert.equal(f.handle.via, "attachment");
  assert.equal(f.source, "reference");
  assert.equal(f.kind, "pdf");
  assert.equal(f.sizeBytes, 2048);
  /* No `url` anywhere on a private file: a URL here would be a second way to
     the bytes with none of the engine's permission checks. */
  assert.equal(JSON.stringify(f).includes("http"), false);
});

const CHAT = (over: Partial<TaskChatMessage> = {}): TaskChatMessage => ({
  id: "m1",
  taskId: "T1",
  thread: "chat",
  senderId: "GR0045",
  senderName: "Rakesh Biswal",
  text: "here",
  attachmentIds: [],
  messageType: "attachment",
  createdAt: "2026-08-02T10:00:00.000Z",
  ...over,
});

test("chat files are marked as link access — they are public media", () => {
  /* This is the distinction the tab exists to keep visible. Chat uploads go
     through `uploadDriveFile`, which makes them readable by anybody holding
     the URL; the private route is a different method for a reason. */
  const files = fromChat([
    CHAT({
      attachments: [
        { url: "https://d/1", kind: "image", name: "shot.png", sizeBytes: 100, durationSecs: null, fileId: "d1" },
      ],
    }),
  ]);
  assert.equal(files.length, 1);
  assert.equal(files[0].access, "link");
  assert.equal(files[0].handle.via, "media");
  assert.equal(files[0].uploadedBy, "Rakesh Biswal");
});

test("the negotiation thread is named as itself, not merged into Chat", () => {
  /* Two threads, and which one a file was sent in is part of what it means:
     the draft thread is where the terms were argued, the working thread is
     where the work happened. */
  const [a] = fromChat([CHAT({ thread: "draft", attachments: [{ url: "u", kind: "file", name: "t.txt", sizeBytes: null, durationSecs: null, fileId: null }] })]);
  assert.equal(a.context, "Negotiation chat");
  const [b] = fromChat([CHAT({ attachments: [{ url: "u", kind: "file", name: "t.txt", sizeBytes: null, durationSecs: null, fileId: null }] })]);
  assert.equal(b.context, "Chat");
  /* Both are still `source: "chat"` — one chip, because "it was in the chat"
     is how somebody looks for it. */
  assert.equal(a.source, "chat");
  assert.equal(b.source, "chat");
});

test("a voice note keeps its kind even with no name and no type", () => {
  const [f] = fromChat([
    CHAT({
      attachments: [
        { url: "https://c/v.webm", kind: "voice", name: null, sizeBytes: null, durationSecs: 12, fileId: null },
      ],
    }),
  ]);
  assert.equal(f.kind, "voice");
  assert.equal(f.name, "v.webm");
});

test("a message with no attachments contributes nothing", () => {
  assert.deepEqual(fromChat([CHAT({ attachments: undefined }), CHAT({ attachments: [] })]), []);
});

const REPORT = (over: Partial<DailyReport> = {}): DailyReport => ({
  id: "r1",
  taskId: "T1",
  employeeId: "GR0067",
  reportDate: "2026-07-30",
  message: "progress",
  progressPercent: 40,
  attachmentIds: [],
  attachments: [],
  documentId: null,
  documentTitle: null,
  createdAt: "2026-07-30T12:00:00.000Z",
  ...over,
});

test("a report's files are labelled by its DATE, which is how people refer to it", () => {
  const [f] = fromReports([
    REPORT({ attachments: [{ url: "https://d/2", name: "day3.png", mimeType: "image/png" }] }),
  ]);
  assert.equal(f.context, "Report · 2026-07-30");
  assert.equal(f.source, "report");
  assert.equal(f.access, "link");
});

test("a report's DOCUMENT is not listed as a file", () => {
  /* It is a Cowork document — editable, shareable, living in `cowork_documents`
     — not a stored file, and listing it beside downloads would offer a Download
     for something that has no bytes to download. */
  const files = fromReports([REPORT({ documentId: "doc1", documentTitle: "Week 3" })]);
  assert.deepEqual(files, []);
});

test("attempts are numbered from the submission, not from list position", () => {
  /* A superseded attempt still holds its own number; renumbering by index would
     make attempt 2 read as attempt 1 once an earlier one is filtered out. */
  assert.equal(submissionContext({ attempt: 3 }), "Attempt 3");
});

/* ── Ordering ─────────────────────────────────────────────────────────────── */

const F = (over: Partial<TaskFile>): TaskFile => ({
  key: "k",
  name: "n",
  kind: "other",
  source: "chat",
  context: "Chat",
  sizeBytes: null,
  uploadedAt: null,
  uploadedBy: null,
  access: "link",
  handle: { via: "url", url: "u" },
  ...over,
});

test("newest first, and an undated file sorts LAST rather than first", () => {
  const sorted = sortTaskFiles([
    F({ key: "old", name: "old", uploadedAt: "2026-07-01T00:00:00.000Z" }),
    F({ key: "none", name: "none", uploadedAt: null }),
    F({ key: "new", name: "new", uploadedAt: "2026-08-01T00:00:00.000Z" }),
  ]);
  assert.deepEqual(sorted.map((f) => f.key), ["new", "old", "none"]);
});

test("an unparseable date is treated as no date, not as 1970", () => {
  const sorted = sortTaskFiles([
    F({ key: "bad", name: "bad", uploadedAt: "not a date" }),
    F({ key: "good", name: "good", uploadedAt: "2026-01-01T00:00:00.000Z" }),
  ]);
  assert.deepEqual(sorted.map((f) => f.key), ["good", "bad"]);
});

test("the order is stable for files that share a timestamp", () => {
  const at = "2026-08-01T00:00:00.000Z";
  const sorted = sortTaskFiles([
    F({ key: "b", name: "b.png", uploadedAt: at }),
    F({ key: "a", name: "a.png", uploadedAt: at }),
  ]);
  assert.deepEqual(sorted.map((f) => f.key), ["a", "b"]);
});

/* ── Filtering ────────────────────────────────────────────────────────────── */

const SET: TaskFile[] = [
  F({ key: "1", name: "brief.pdf", kind: "pdf", source: "reference", context: "Supplied with the task" }),
  F({ key: "2", name: "shot.png", kind: "image", source: "chat", context: "Chat", uploadedBy: "Rakesh Biswal" }),
  F({ key: "3", name: "day3.png", kind: "image", source: "report", context: "Report · 2026-07-30" }),
  F({ key: "4", name: "final.docx", kind: "document", source: "submission", context: "Attempt 2" }),
];

test("an empty filter is not a refusal — it means everything", () => {
  /* The obvious wrong reading: `sources: []` as "no source selected, show
     nothing", which would open the tab on an empty list. */
  assert.equal(filterTaskFiles(SET, NO_FILTER).length, 4);
});

test("source and kind narrow together, not separately", () => {
  assert.deepEqual(
    filterTaskFiles(SET, { ...NO_FILTER, sources: ["chat", "report"], kinds: ["image"] }).map((f) => f.key),
    ["2", "3"],
  );
  assert.deepEqual(
    filterTaskFiles(SET, { ...NO_FILTER, sources: ["chat"], kinds: ["pdf"] }).map((f) => f.key),
    [],
  );
});

test("search reads the name, where it came from, and who sent it", () => {
  assert.deepEqual(filterTaskFiles(SET, { ...NO_FILTER, query: "PNG" }).map((f) => f.key), ["2", "3"]);
  assert.deepEqual(filterTaskFiles(SET, { ...NO_FILTER, query: "attempt" }).map((f) => f.key), ["4"]);
  assert.deepEqual(filterTaskFiles(SET, { ...NO_FILTER, query: "rakesh" }).map((f) => f.key), ["2"]);
  assert.deepEqual(filterTaskFiles(SET, { ...NO_FILTER, query: "   " }).map((f) => f.key), ["1", "2", "3", "4"]);
});

/* ── Counting ─────────────────────────────────────────────────────────────── */

test("counts cover every source and kind, including the empty ones", () => {
  /* A chip has to be able to say "0", which means the record needs the key.
     Building it from the files present would silently drop a whole filter. */
  const s = countBySource(SET);
  assert.deepEqual(s, { reference: 1, submission: 1, correction: 0, report: 1, chat: 1 });
  const k = countByKind(SET);
  assert.equal(k.image, 2);
  assert.equal(k.voice, 0);
  assert.equal(k.video, 0);
  assert.equal(Object.keys(k).length, 9);
});

test("a video is its own kind rather than “other”", () => {
  /* Once any file type can be attached, a submitted clip landing in "Other"
     alongside unrecognised binaries makes the filter useless for finding it. */
  assert.equal(fileKind("video/mp4", "clip.mp4"), "video");
  assert.equal(fileKind(null, "recording.mov"), "video");
  assert.equal(fileKind("", "screen.mkv"), "video");
  assert.equal(fileKind("application/octet-stream", "capture.avi"), "video");
});

test("a bare .webm is a video, not a voice note", () => {
  /* It can carry either, but audio-only webm arrives as `audio/webm` and is
     caught by the mime branch first — so an extension with no type behind it
     is far more often a clip. It used to classify as voice. */
  assert.equal(fileKind(null, "clip.webm"), "video");
  assert.equal(fileKind("audio/webm", "note.webm"), "voice");
});

test("audio files other than voice notes are still the voice kind", () => {
  /* The name is historical and written into stored documents; the chip that
     labels it now says "Audio", which is what people are actually sending. */
  assert.equal(fileKind("audio/mpeg", "track.mp3"), "voice");
  assert.equal(fileKind(null, "interview.flac"), "voice");
});

test("archives are recognised from the extension alone", () => {
  assert.equal(fileKind(null, "deliverable.zip"), "archive");
  assert.equal(fileKind("", "source.7z"), "archive");
});

test("a total size says how many files it actually covers", () => {
  /* Chat and report files record no size at all. "3 MB" over nine files when
     four carry a figure reads as the whole and is not — the same pair
     `committedEffort` returns for time. */
  const sized = totalSize([
    F({ key: "a", sizeBytes: 1000 }),
    F({ key: "b", sizeBytes: null }),
    F({ key: "c", sizeBytes: 24 }),
  ]);
  assert.deepEqual(sized, { bytes: 1024, covered: 2, total: 3 });
});
