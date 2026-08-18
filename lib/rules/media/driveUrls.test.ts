import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import {
  DRIVE_IMAGE_CDN,
  driveFileIdFrom,
  driveImageSources,
  driveImageSrc,
  driveProxySrc,
  renderableImageSrc,
} from "./driveUrls.ts";

const ID = "1AbCdEfGhIjKlMnOpQrStUvWxYz0123456";
const API = "https://api.example.com";

/* ── The CDN URL ───────────────────────────────────────────────────────── */

test("an image is drawn from lh3, not from drive.google.com", () => {
  /* Drive's own URLs answer with an HTML page or an interstitial, so an <img>
     pointed at one shows a broken icon over a file that is sitting in Drive
     intact. lh3 is the only host that streams the bytes. */
  const src = driveImageSrc(ID);
  assert.match(src, /^https:\/\/lh3\.googleusercontent\.com\/d\//);
  assert.doesNotMatch(src, /drive\.google\.com/);
});

test("the delivered width is part of the path, not a query string", () => {
  /* `?w=1600` is silently ignored by the CDN — the size directive is appended
     to the id with `=`. Getting this wrong sends a 12MP photograph down the
     wire to fill a 260px bubble. */
  assert.equal(driveImageSrc(ID, 800), `https://lh3.googleusercontent.com/d/${ID}=w800`);
  assert.doesNotMatch(driveImageSrc(ID, 800), /\?/);
});

test("a width is always asked for, even when none is given", () => {
  assert.match(driveImageSrc(ID), /=w1600$/);
});

/* ── The proxy fallback ────────────────────────────────────────────────── */

test("the proxy points at the backend's byte route", () => {
  assert.equal(driveProxySrc(API, ID), `${API}/cowork/media/view/${ID}`);
});

test("a trailing slash on the base does not double up", () => {
  assert.equal(driveProxySrc(`${API}/`, ID), `${API}/cowork/media/view/${ID}`);
});

test("no configured backend yields no proxy, rather than a relative path", () => {
  /* A relative `/cowork/media/view/...` resolves against the Next app, which
     has no such route — a 404 that reads as a missing FILE rather than as a
     missing configuration. */
  assert.equal(driveProxySrc(undefined, ID), null);
  assert.equal(driveProxySrc("", ID), null);
});

/* ── Reading an id back out ────────────────────────────────────────────── */

test("every Drive URL shape the two systems have stored yields its id", () => {
  const shapes = [
    `https://lh3.googleusercontent.com/d/${ID}=w1600`,
    `https://drive.google.com/file/d/${ID}/view`,
    `https://drive.google.com/uc?export=download&id=${ID}`,
    `https://drive.google.com/thumbnail?id=${ID}&sz=w2000`,
    `${API}/cowork/media/view/${ID}`,
  ];
  for (const url of shapes) {
    assert.equal(driveFileIdFrom(url), ID, url);
  }
});

test("a URL with no Drive id reads as null rather than as a guess", () => {
  /* A Cloudinary asset from the old application is exactly this case, and a
     plausible-looking substring would produce a CDN link to nothing. */
  assert.equal(driveFileIdFrom("https://res.cloudinary.com/x/image/upload/a.png"), null);
  assert.equal(driveFileIdFrom(""), null);
  assert.equal(driveFileIdFrom(null), null);
  assert.equal(driveFileIdFrom(undefined), null);
});

/* ── The ordered source list ───────────────────────────────────────────── */

test("the CDN is tried first and the proxy second", () => {
  /* Order matters: the CDN is Google's bandwidth, the proxy is ours. */
  assert.deepEqual(driveImageSources({ fileId: ID, apiBase: API }), [
    `https://lh3.googleusercontent.com/d/${ID}=w1600`,
    `${API}/cowork/media/view/${ID}`,
  ]);
});

test("a freshly uploaded file still has somewhere to fall back to", () => {
  /* The CDN 404s until Google indexes the file, which can be seconds after the
     upload returns. Without the proxy the image is broken for exactly as long
     as the person is looking at the message they just sent. */
  const sources = driveImageSources({ fileId: ID, apiBase: API });
  assert.equal(sources.length, 2);
  assert.notEqual(sources[0], sources[1]);
});

test("an id is recovered from the stored URL when none was recorded", () => {
  /* Older messages stored a Drive URL and no `fileId` field at all. */
  const sources = driveImageSources({
    url: `https://drive.google.com/uc?export=download&id=${ID}`,
    apiBase: API,
  });
  assert.equal(sources[0], `https://lh3.googleusercontent.com/d/${ID}=w1600`);
});

test("a non-Drive image keeps its own URL and nothing is invented", () => {
  const url = "https://res.cloudinary.com/x/image/upload/a.png";
  assert.deepEqual(driveImageSources({ url, apiBase: API }), [url]);
});

test("the stored URL is a last resort, never a duplicate", () => {
  const url = `${API}/cowork/media/view/${ID}`;
  const sources = driveImageSources({ fileId: ID, url, apiBase: API });
  assert.equal(new Set(sources).size, sources.length);
});

test("nothing to draw yields no sources rather than a broken one", () => {
  assert.deepEqual(driveImageSources({ apiBase: API }), []);
});

/* ── Repairing an address at render time ─────────────────────────────────── */

test("a Drive URL already in a document is repaired when it is drawn", () => {
  /**
   * **Reported twice, 17 Aug 2026.** The insert path was corrected to write the
   * CDN address, and the same image was still broken — because nothing rewrites
   * markup that is already saved. An image inserted last week keeps whatever
   * was written into it for ever unless the repair happens at RENDER.
   */
  const id = "1AbCdEfGhIjKlMnOpQrStUvWxYz012345";
  for (const stored of [
    `https://drive.google.com/file/d/${id}/view?usp=sharing`,
    `https://drive.google.com/uc?export=view&id=${id}`,
    `https://drive.google.com/uc?export=download&id=${id}`,
    `https://drive.google.com/open?id=${id}`,
    `https://drive.google.com/thumbnail?id=${id}&sz=w1000`,
  ]) {
    assert.equal(
      renderableImageSrc(stored),
      driveImageSrc(id),
      `${stored} was not repaired`,
    );
  }
});

test("an address already on the CDN is left exactly alone", () => {
  /* Idempotent, so normalising twice costs nothing — and re-deriving would
     drop a size somebody chose deliberately. */
  const already = `${DRIVE_IMAGE_CDN}/d/1AbCdEfGhIjKlMnOpQrStUvWxYz012345=w800`;
  assert.equal(renderableImageSrc(already), already);
  assert.equal(renderableImageSrc(renderableImageSrc(already)), already);
});

test("somebody else's URL is never rewritten", () => {
  /* The one case this rule cannot improve, and the one it could break. A
     Cloudinary asset from the old application is exactly this. */
  for (const other of [
    "https://res.cloudinary.com/demo/image/upload/sample.jpg",
    "https://example.com/photo.png?id=1AbCdEfGhIjKlMnOpQrStUvWxYz012345",
    "data:image/png;base64,iVBORw0KGgo=",
    "/local/asset.png",
  ]) {
    assert.equal(renderableImageSrc(other), other, `${other} was rewritten`);
  }
});

test("an unrecognisable Drive address keeps what was stored", () => {
  /* Conservative by design: guessing at a substring would produce a
     plausible-looking CDN link to nothing. */
  const odd = "https://drive.google.com/drive/my-drive";
  assert.equal(renderableImageSrc(odd), odd);
});

test("nothing in, empty string out", () => {
  assert.equal(renderableImageSrc(null), "");
  assert.equal(renderableImageSrc(undefined), "");
  assert.equal(renderableImageSrc(""), "");
});

test("the document image draws AND saves through the repair", () => {
  /* Both ends: the node view paints it, and the saved markup carries it, so a
     document exported or printed shows the image too. */
  const src = readFileSync(
    "components/features/workspace/docs/ResizableImage.ts",
    "utf8",
  );
  /* Through the chain now: normalised first, the byte proxy behind it. */
  assert.match(src, /const first = renderableImageSrc\(src as string\)/);
  assert.match(src, /const nextSources = imageSources\(n\.attrs\.src\)/);
  assert.match(src, /src: renderableImageSrc\(HTMLAttributes\.src as string\)/);
});
