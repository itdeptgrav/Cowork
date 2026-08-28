import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { COPIED_NOTICE, copySourcesFor } from "./copyToClipboard.ts";

const SRC = readFileSync("lib/utils/copyToClipboard.ts", "utf8");
const MESSAGES = readFileSync(
  "components/features/messages/MessagesArea.tsx",
  "utf8",
);
const CHAT = readFileSync("components/features/tasks/ChatPanel.tsx", "utf8");

/* ── Where the bytes are fetched from ─────────────────────────────────────── */

test("the backend proxy is tried before Google's CDN", () => {
  /*
   * The reverse of the RENDER order, deliberately. `driveImageSources` puts the
   * CDN first so a drawn `<img>` spends Google's bandwidth rather than ours; a
   * `fetch` needs CORS instead, and the proxy is the route whose headers we
   * control and have allow-listed. One copy is not worth the bandwidth
   * argument.
   */
  const sources = copySourcesFor({
    fileId: "abc123",
    url: "https://drive.google.com/file/d/abc123/view",
    apiBase: "http://localhost:5000",
  });
  assert.ok(sources.length >= 2, "expected a fallback as well as the proxy");
  assert.match(sources[0], /\/cowork\/media\/view\/abc123$/);
  assert.ok(
    sources.some((s) => s.includes("googleusercontent.com")),
    "the CDN is gone as a fallback",
  );
});

test("a non-Drive image still yields its own URL", () => {
  /* Cloudinary assets from the old application have no fileId and serve their
     own bytes. Returning nothing here would make them uncopyable. */
  const sources = copySourcesFor({
    fileId: null,
    url: "https://res.cloudinary.com/x/image/upload/a.png",
    apiBase: "http://localhost:5000",
  });
  assert.deepEqual(sources, [
    "https://res.cloudinary.com/x/image/upload/a.png",
  ]);
});

test("no API base leaves the other sources intact", () => {
  /* `driveProxySrc` returns null without a base rather than a relative path —
     copying should fall back to the CDN, not break. */
  const sources = copySourcesFor({ fileId: "abc123", apiBase: null });
  assert.ok(sources.length >= 1);
  assert.ok(sources.every((s) => !s.includes("/cowork/media/view/")));
});

/* ── What the person is told ──────────────────────────────────────────────── */

test("the notice names which halves were copied", () => {
  /* A flat "Copied." would have somebody paste into a document and find the
     picture missing with nothing having said so. */
  assert.notEqual(COPIED_NOTICE.both, COPIED_NOTICE.text);
  assert.notEqual(COPIED_NOTICE.image, COPIED_NOTICE.text);
  assert.match(COPIED_NOTICE.both, /image/i);
  assert.match(COPIED_NOTICE.image, /image/i);
});

test("a picture that fails still copies the caption, and says so", () => {
  /* Losing the words as well because the bytes would not fetch is the worse
     outcome — the caption is what a plain-text paste wanted anyway. */
  assert.match(SRC, /Text copied — the image could not be\./);
  assert.match(SRC, /await navigator\.clipboard\.writeText\(text\)/);
});

/* ── Platform constraints this has to satisfy ─────────────────────────────── */

test("the clipboard item is built from a promise, not an awaited blob", () => {
  /* Safari refuses a `ClipboardItem` constructed after an await: the write is
     no longer inside the user gesture. Passing `Promise<Blob>` is the supported
     way round it, so the item is constructed synchronously. */
  assert.match(SRC, /const png = fetchImageBlob\(sources\)\.then\(asPng\)/);
  assert.equal(
    /const png = await fetchImageBlob/.test(SRC),
    false,
    "the bytes are awaited before the item is built — Safari will refuse it",
  );
});

test("everything that is not already PNG is converted", () => {
  /* Chrome's clipboard takes image/png and little else, so a JPEG straight off
     the wire is rejected. */
  assert.match(SRC, /if \(blob\.type === CLIPBOARD_IMAGE_TYPE\) return blob/);
  assert.match(SRC, /canvas\.toBlob\(resolve, CLIPBOARD_IMAGE_TYPE\)/);
});

test("a browser without the rich clipboard still copies text", () => {
  assert.match(SRC, /typeof ClipboardItem !== "undefined"/);
  assert.match(SRC, /navigator\.clipboard\?\.write === "function"/);
});

/* ── One rule, both threads ───────────────────────────────────────────────── */

test("Messages and Task Chat share the decision and the fetch", () => {
  /* They had grown two copies of the old rule — the same `!m.text` guard and
     the same sentence, written out twice. Sharing is what stops one of them
     being fixed and the other not. */
  for (const [name, src] of [
    ["MessagesArea", MESSAGES],
    ["ChatPanel", CHAT],
  ] as const) {
    assert.match(src, /copyPlan\(/, `${name} builds its own copy rule`);
    assert.match(src, /runCopyPlan\(copyPlan\(m\), MEDIA_BASE\)/, name);
    assert.match(src, /COPIED_NOTICE\[out\.copied\]/, name);
    assert.equal(
      /clipboard\.writeText\(m\.text\)/.test(src),
      false,
      `${name} still copies text only`,
    );
    assert.equal(
      /This message has no text to copy\./.test(src),
      false,
      `${name} still refuses a message that is only a picture`,
    );
  }
});
