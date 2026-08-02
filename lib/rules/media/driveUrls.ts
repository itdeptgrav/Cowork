/**
 * Where a Google Drive file is drawn from, and why it is not Drive's own URL.
 *
 * ## The problem this exists to solve
 *
 * **Drive will not render its own files in an `<img>`.** `drive.google.com/uc`,
 * `/file/d/<id>/view` and `webContentLink` all answer with an HTML page, a
 * redirect chain, or a virus-scan interstitial depending on file size — none of
 * which is image bytes. Point an `<img src>` at any of them and you get a broken
 * icon on a file that is sitting in Drive, intact, exactly where it was put.
 *
 * `lh3.googleusercontent.com/d/<fileId>` is the CDN Google Photos serves from,
 * and it streams a **public** Drive file as bytes with an image content type. It
 * is the only Drive URL an `<img>` can use, which is why the old application
 * settled on it (`lib/mediaUploadApi.js` — "Images → Google Drive (rendered via
 * lh3.googleusercontent.com)") and why this product does the same.
 *
 * ## The fallback is not optional
 *
 * A file uploaded a second ago can 404 on the CDN until Google indexes it, and
 * a file that was never made public never appears there at all. So every render
 * has a second source: `/cowork/media/view/:fileId` on the backend, which streams
 * the bytes through the service account and always resolves. First the CDN,
 * because it is Google's bandwidth and not ours; then the proxy, because it
 * works.
 *
 * ## Public, and only for things that are public
 *
 * These URLs are for media the engine deliberately publishes — chat and message
 * attachments, document images, mind-map pictures — which
 * `finalizeDriveFile` marks `role: reader, type: anyone`. **Task attachments are
 * NOT among them**: they are stored privately by `coworkAttachment.service.js`
 * with no permission grant at all, and are read as authenticated blobs. Handing
 * one of those to `driveImageSrc` would produce a link that either does not load
 * or, worse, works for anyone who copies it.
 */

/** Google's image CDN. The one host that renders a Drive file inline. */
export const DRIVE_IMAGE_CDN = "https://lh3.googleusercontent.com";

/**
 * A sensible delivered width.
 *
 * The CDN resizes server-side, so asking for a width is what stops a 12 MP
 * phone photograph being sent down the wire to fill a 260px bubble. 1600 is
 * generous enough for a full-width document image on a retina display.
 */
export const DEFAULT_IMAGE_WIDTH = 1600;

/**
 * Where an image is drawn from, given a Drive file id.
 *
 * `=w<n>` is the CDN's size parameter, not a query string — it is appended to
 * the path, and a `?` there is silently ignored.
 */
export function driveImageSrc(
  fileId: string,
  width: number = DEFAULT_IMAGE_WIDTH,
): string {
  return `${DRIVE_IMAGE_CDN}/d/${fileId}=w${width}`;
}

/**
 * The backend's byte proxy — the fallback, and the way non-image files load.
 *
 * Returns null without a base URL rather than a relative path: a relative
 * `/cowork/media/view/...` would resolve against the Next app, which has no such
 * route, and produce a 404 that looks like a missing file rather than a missing
 * configuration.
 */
export function driveProxySrc(
  apiBase: string | undefined | null,
  fileId: string,
): string | null {
  if (!apiBase) return null;
  return `${apiBase.replace(/\/+$/, "")}/cowork/media/view/${fileId}`;
}

/**
 * The Drive file id inside a URL, or null.
 *
 * Every shape the two systems have ever stored, because the field they are read
 * from is a decade of different writers:
 *
 * · `lh3.googleusercontent.com/d/<id>=w1600`  — what this product writes
 * · `drive.google.com/file/d/<id>/view`       — `webViewLink`
 * · `drive.google.com/uc?export=download&id=` — `directDownloadUrl`
 * · `drive.google.com/thumbnail?id=<id>&sz=`  — `finalizeDriveFile`'s `url`
 * · `.../cowork/media/view/<id>`              — our own proxy
 *
 * Deliberately conservative: an id it cannot recognise comes back null, and the
 * caller falls back to the stored URL. Guessing at a substring would produce a
 * plausible-looking CDN link to nothing.
 */
export function driveFileIdFrom(url: string | null | undefined): string | null {
  if (!url) return null;

  for (const pattern of [
    /\/d\/([a-zA-Z0-9_-]{10,})/,
    /[?&]id=([a-zA-Z0-9_-]{10,})/,
    /\/media\/view\/([a-zA-Z0-9_-]{10,})/,
  ]) {
    const m = url.match(pattern);
    if (m?.[1]) return m[1];
  }
  return null;
}

/**
 * The two sources for one image, in the order they should be tried.
 *
 * Returned as a list rather than as a component so the ordering is one fact,
 * testable without a DOM, and shared by every surface that draws Drive media.
 * A file with no recognisable id falls back to whatever URL was stored — a
 * Cloudinary asset from the old application is exactly that case.
 */
export function driveImageSources(input: {
  fileId?: string | null;
  url?: string | null;
  apiBase?: string | null;
  width?: number;
}): string[] {
  const fileId = input.fileId || driveFileIdFrom(input.url);
  const out: string[] = [];

  if (fileId) {
    out.push(driveImageSrc(fileId, input.width));
    const proxy = driveProxySrc(input.apiBase, fileId);
    if (proxy) out.push(proxy);
  }
  if (input.url && !out.includes(input.url)) out.push(input.url);

  return out;
}
