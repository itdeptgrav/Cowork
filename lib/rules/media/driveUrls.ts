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
 * Drive's own page for a file — where "open this" should actually go.
 *
 * ## Why this exists alongside the proxy
 *
 * The proxy streams BYTES, which is what an `<img>`, an `<audio>` and a download
 * need. Opening a document in a new tab is a different job: the person wants to
 * READ a PDF, and Drive's viewer does that better than a raw byte stream — it
 * paginates, it has a thumbnail rail, print and download, and it is the page
 * they already recognise. Sending them to `backend.grav.in/cowork/media/view/<id>`
 * instead shows the same bytes under a URL that looks like the file is stored on
 * our server, which is the thing this product had to keep explaining.
 *
 * **Only for files that are public.** `finalizeDriveFile` grants
 * `role: reader, type: anyone` to chat and message attachments, document images
 * and mind-map pictures, so this link works for the people who can already see
 * the record. **Task attachments are stored privately with no grant at all** —
 * handing one of those to this function produces a link that shows Google's
 * "you need access" page, so those keep streaming through the authenticated
 * proxy. The same boundary `driveImageSrc` observes, for the same reason.
 */
export function driveViewUrl(fileId: string): string {
  return `https://drive.google.com/file/d/${fileId}/view`;
}

/**
 * Drive's own player, for embedding in an `<iframe>`.
 *
 * ## Why a video is not simply given to `<video src>`
 *
 * Our byte proxy cannot stream. `GET /cowork/media/view/:fileId` fetches the
 * whole file from Drive and pipes it: it never reads the `Range` request
 * header, never answers `206`, and never sets `Accept-Ranges`. A native player
 * pointed at it therefore cannot SEEK, downloads the entire file to show three
 * seconds of it, and on Safari — which requires byte-range support for media
 * and probes with `Range: bytes=0-1` — commonly refuses to play at all. With no
 * size cap on what may be sent, that is not a corner case.
 *
 * Drive already solves this. It streams with ranges, makes lower-resolution
 * renditions, and costs this deployment nothing: the bytes go from Google to
 * the viewer without passing through our backend, which a range-capable proxy
 * of our own would not — one 500 MB clip watched five times would be 2.5 GB of
 * egress through a server whose whole design is to never touch file bytes.
 *
 * The trade is Google's player chrome rather than ours, and a few minutes of
 * processing after upload before a fresh video will preview.
 *
 * **Only for files that are public**, exactly as `driveViewUrl` — chat and
 * message attachments are granted `role: reader, type: anyone` by
 * `finalizeDriveFile`. **Task attachments are private and must not use this**;
 * they would show Google's "you need access" page inside the frame.
 */
export function drivePreviewUrl(fileId: string): string {
  return `https://drive.google.com/file/d/${fileId}/preview`;
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

/**
 * Any stored image address, turned into one an `<img>` can actually draw.
 *
 * **Applied at RENDER, which is the point.** Fixing the address at the moment
 * of upload only helps images uploaded afterwards — an image already sitting in
 * a document keeps whatever was written into it and stays broken for ever.
 * Reported 17 Aug 2026: a document image showed a broken icon, the insert path
 * was corrected, and the same image was still broken because the correction
 * could not reach backwards into markup already saved.
 *
 * So every render normalises. A `drive.google.com/file/d/<id>/view` written last
 * month draws today, a document imported from anywhere else draws, and an
 * address this rule does not recognise — a Cloudinary asset from the old
 * application, a plain https image, a `data:` URI — is returned untouched
 * rather than guessed at.
 *
 * Idempotent: a CDN address already in the right shape comes back unchanged,
 * so normalising twice costs nothing and cannot corrupt a good link.
 */
export function renderableImageSrc(
  url: string | null | undefined,
  width: number = DEFAULT_IMAGE_WIDTH,
): string {
  const raw = String(url ?? "");
  if (!raw) return "";

  /* Already the CDN. Left exactly as it is — re-deriving would drop a size
     parameter somebody chose deliberately. */
  if (raw.startsWith(`${DRIVE_IMAGE_CDN}/`)) return raw;

  /* Anything that is not a Drive address is somebody else's URL, and rewriting
     it would break the one case this rule cannot improve. */
  if (!/drive\.google\.com/i.test(raw) && !/\/media\/view\//i.test(raw)) {
    return raw;
  }

  const fileId = driveFileIdFrom(raw);
  return fileId ? driveImageSrc(fileId, width) : raw;
}
