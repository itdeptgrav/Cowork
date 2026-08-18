/**
 * What kind of image some bytes actually are.
 *
 * **The bytes are better evidence than the header.** A server that labels a
 * PNG `application/octet-stream` is common — a plain static file server does it
 * by default, and a proxy that streams a file through without inspecting it
 * does it too. Trusting the label means an image the browser has already
 * DRAWN gets dropped from an export because a header was vague, which is the
 * worst kind of failure: the picture is plainly on the screen and plainly not
 * in the file.
 *
 * So the declared type is used only as a tie-breaker, after the magic number.
 */

/** The image types a document can embed, in the order they are tested. */
const SIGNATURES: readonly {
  mime: string;
  test: (b: Uint8Array) => boolean;
}[] = [
  {
    mime: "image/png",
    test: (b) =>
      b.length >= 8 &&
      b[0] === 0x89 &&
      b[1] === 0x50 &&
      b[2] === 0x4e &&
      b[3] === 0x47 &&
      b[4] === 0x0d &&
      b[5] === 0x0a &&
      b[6] === 0x1a &&
      b[7] === 0x0a,
  },
  {
    mime: "image/jpeg",
    test: (b) => b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  },
  {
    /* Both GIF87a and GIF89a start "GIF8". */
    mime: "image/gif",
    test: (b) =>
      b.length >= 6 &&
      b[0] === 0x47 &&
      b[1] === 0x49 &&
      b[2] === 0x46 &&
      b[3] === 0x38,
  },
  {
    /* A RIFF container whose form type is WEBP — the four bytes at 8 are what
       tell it apart from a RIFF wave file, which starts identically. */
    mime: "image/webp",
    test: (b) =>
      b.length >= 12 &&
      b[0] === 0x52 &&
      b[1] === 0x49 &&
      b[2] === 0x46 &&
      b[3] === 0x46 &&
      b[8] === 0x57 &&
      b[9] === 0x45 &&
      b[10] === 0x42 &&
      b[11] === 0x50,
  },
  {
    mime: "image/bmp",
    test: (b) => b.length >= 2 && b[0] === 0x42 && b[1] === 0x4d,
  },
  {
    /* SVG is text, so there is no magic number — only a shape. An XML
       declaration or a comment may come before the root element. */
    mime: "image/svg+xml",
    test: (b) => {
      const head = new TextDecoder()
        .decode(b.subarray(0, 512))
        .replace(/^﻿/, "")
        .trimStart();
      return head.startsWith("<?xml") || head.startsWith("<svg") || head.startsWith("<!--");
    },
  },
];

/**
 * The image type of these bytes, or null if they are not an image.
 *
 * `declared` is consulted only when the bytes say nothing — a `text/xml` label
 * on an SVG, for instance. It never overrides a magic number, because the
 * bytes cannot be wrong about themselves and a header can.
 */
export function sniffImageMime(
  bytes: Uint8Array,
  declared?: string,
): string | null {
  if (!bytes || bytes.length === 0) return null;

  for (const signature of SIGNATURES) {
    if (signature.test(bytes)) return signature.mime;
  }

  const label = String(declared ?? "").toLowerCase().split(";")[0]!.trim();
  return label.startsWith("image/") ? label : null;
}

/**
 * Should this be embedded as an image?
 *
 * The question a caller with a downloaded blob actually has. Kept beside the
 * sniffer so the two cannot disagree.
 */
export function isEmbeddableImage(
  bytes: Uint8Array,
  declared?: string,
): boolean {
  return sniffImageMime(bytes, declared) !== null;
}
