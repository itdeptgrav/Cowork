import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";

/**
 * Saving a file was only ever possible for images.
 *
 * `Thumbnail` has had its own download button since it was written. `FileRow` —
 * the card every PDF, spreadsheet, Word document and unrecognised file lands on
 * — had none. The whole row was a link to Drive's viewer, so the only way to
 * "download" was whatever that page happened to offer, and for a `.docx` or an
 * `.xlsx` Drive offers a CONVERTED preview. The file somebody was sent never
 * reached their machine in the form it was sent.
 *
 * This is the shared renderer, so the fix lands in task chat, direct messages
 * and group threads at once.
 */

function code(path: string): string {
  return readFileSync(path, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

const ATT = "components/features/messages/MessageAttachments.tsx";

test("a document card offers a download", () => {
  const src = code(ATT);
  const row = src.slice(src.indexOf("function FileRow("), src.indexOf("export function MessageAttachments"));
  assert.match(row, /aria-label=\{saving \? `Downloading \$\{name\}` : `Download \$\{name\}`\}/);
  assert.match(row, /<Icon\.download/);
});

test("it downloads the BYTES, not Drive's viewer page", () => {
  /* `mediaOpenUrl` is Drive's own page. Saving that is what once produced an
     HTML viewer with a `.pdf` name — a file that opens to nothing. */
  const src = code(ATT);
  const row = src.slice(src.indexOf("function FileRow("), src.indexOf("export function MessageAttachments"));
  assert.match(row, /downloadFile\(mediaUrl\(a\), name, mediaProxyUrl\(a\)\)/);
  assert.doesNotMatch(
    row,
    /downloadFile\(mediaOpenUrl/,
    "the download saves Drive's viewer page rather than the file",
  );
});

test("the row still opens the file to read it", () => {
  /* Two gestures on one card, as a thumbnail has always had: the row opens, the
     button saves. Opening a PDF to read it is the common case and Drive renders
     one better than a raw stream. */
  const src = code(ATT);
  const row = src.slice(src.indexOf("function FileRow("), src.indexOf("export function MessageAttachments"));
  assert.match(row, /href=\{mediaOpenUrl\(a\)\}/);
  assert.match(row, /target="_blank"/);
});

test("the original name and extension are kept", () => {
  /* `downloadFile` sets `a.download = filename`, so this is the whole of the
     "keeps its extension" requirement — provided the name passed is the real
     one rather than something invented per type. */
  const src = code(ATT);
  const row = src.slice(src.indexOf("function FileRow("), src.indexOf("export function MessageAttachments"));
  assert.match(row, /const name = a\.name \?\?/);
  const dl = code("components/ui/ImageLightbox.tsx");
  assert.match(dl, /a\.download = filename/);
});

test("a large file shows that something is happening", () => {
  /* A spinner rather than a percentage, deliberately: `downloadFile` reads the
     body through `res.blob()`, which reports nothing until it is finished. A
     made-up figure would be worse than honest motion. */
  const src = code(ATT);
  const row = src.slice(src.indexOf("function FileRow("), src.indexOf("export function MessageAttachments"));
  assert.match(row, /const \[saving, setSaving\] = useState\(false\)/);
  assert.match(row, /aria-busy=\{saving\}/);
  assert.match(row, /animate-spin/);
  assert.match(row, /disabled=\{saving\}/, "a second click starts a second download");
});

test("a failure is shown, not swallowed", () => {
  const src = code(ATT);
  const row = src.slice(src.indexOf("function FileRow("), src.indexOf("export function MessageAttachments"));
  assert.match(row, /const \[error, setError\] = useState<string \| null>\(null\)/);
  assert.match(row, /role="alert"/);
  assert.match(row, /setSaving\(false\)/, "the spinner never stops after a failure");
});

test("the proxy is the fallback, so a blocked direct fetch still saves", () => {
  /* Drive refuses a cross-origin fetch for some files. Without the second
     route those are simply undownloadable. */
  const dl = code("components/ui/ImageLightbox.tsx");
  assert.match(dl, /if \(proxyUrl && proxyUrl !== url\)/);
  assert.match(dl, /throw new Error\(/, "a failed download navigates somewhere instead of reporting");
});

test("task chat renders through this shared component", () => {
  /* The reason one fix covers task chat, direct messages and groups. The props
     may grow (an image-gallery hook was added), so this pins the shared
     component and its two load-bearing props, not the exact tag formatting. */
  const src = code("components/features/tasks/ChatPanel.tsx");
  assert.match(src, /<MessageAttachments/);
  assert.match(src, /items=\{attachments\}/);
  assert.match(src, /mine=\{mine\}/);
});

test("images and video keep the route they already had", () => {
  /* Not regressed by giving documents one: a thumbnail has its own button, and
     a video card opens a lightbox that carries one. */
  const src = code(ATT);
  const thumb = src.slice(src.indexOf("function Thumbnail("), src.indexOf("function playingId("));
  assert.match(thumb, /downloadFile\(mediaUrl\(a\), name, mediaProxyUrl\(a\)\)/);
  assert.match(code("components/ui/VideoLightbox.tsx"), /Download \$\{name\}/);
});

/* ── Large files stream to the browser instead of buffering in memory ─────── */

test("a Drive file's download URL asks the proxy to stream as an attachment", () => {
  const src = code(ATT);
  assert.match(src, /export function mediaDownloadUrl/);
  assert.match(src, /\$\{proxy\}\?download=1/);
});

test("the file card hands a Drive download to the browser, not a Blob", () => {
  /* The reported 380 MB PDF: with a streaming URL it saves via the browser
     (no whole-file-in-memory Blob); only a non-Drive file falls back to the
     Blob download. */
  const src = code(ATT);
  const row = src.slice(src.indexOf("async function save()"), src.indexOf("async function save()") + 700);
  assert.match(row, /const stream = mediaDownloadUrl\(a\);/);
  assert.match(row, /browserDownload\(stream, name\);/);
  /* The Blob path is still there for the non-Drive fallback. */
  assert.match(row, /downloadFile\(mediaUrl\(a\), name, mediaProxyUrl\(a\)\)/);
});

test("the thumbnail download streams a Drive file too", () => {
  const src = code(ATT);
  const thumb = src.slice(src.indexOf("function Thumbnail("), src.indexOf("function playingId("));
  assert.match(thumb, /const stream = mediaDownloadUrl\(a\);/);
  assert.match(thumb, /browserDownload\(stream, name\);/);
});

test("browserDownload hands a URL to the browser via an anchor", () => {
  const util = code("lib/utils/browserDownload.ts");
  assert.match(util, /createElement\("a"\)/);
  assert.match(util, /a\.click\(\)/);
  /* It does NOT fetch the bytes itself — that is the whole point. */
  assert.doesNotMatch(util, /fetch\(/);
});
