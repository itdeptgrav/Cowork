/**
 * Attachment presentation rules, with no JSX.
 *
 * Split from the components so they can be exercised by the test runner, which
 * reads `.ts` natively and cannot strip JSX from a `.tsx`. They are also the
 * part worth testing: what may be sent, what may be previewed inline, and how a
 * file is described.
 */

/**
 * What the file picker offers. **Everything** — the engine's allow-list was
 * withdrawn on the owner's instruction, so a list here would be the only thing
 * left refusing a file the server accepts.
 *
 * Empty string rather than a wildcard: an `accept` attribute set to the empty
 * string is treated as absent, which is exactly "no filter", whereas some
 * pickers treat a wildcard as a filter that happens to match everything and
 * still hide files without an extension.
 */
export const ACCEPT = "";
/**
 * No size cap — withdrawn on the owner's instruction.
 *
 * It was 50 MB, mirroring the engine's own. The engine's is gone too, so a
 * limit left here would refuse a file the server would happily take — a client
 * check that is stricter than the authority it mirrors is worse than none,
 * because there is no error to read and nothing to appeal to.
 *
 * `null` rather than a very large number, so "no cap" is a state a reader can
 * see rather than a threshold they have to recognise as unreachable.
 */
export const MAX_BYTES: number | null = null;

export function isPreviewableImage(type: string): boolean {
  return /^image\/(png|jpeg|webp)$/.test(type);
}

export function isPdf(type: string): boolean {
  return type === "application/pdf";
}

export function fileGlyph(type: string, name = ""): string {
  const t = `${type} ${name}`.toLowerCase();
  if (isPreviewableImage(type) || /(png|jpe?g|webp|gif)/.test(t)) return "🖼";
  if (isPdf(type) || /pdf/.test(t)) return "📄";
  if (/(sheet|excel|xlsx?|csv)/.test(t)) return "📊";
  if (/(presentation|powerpoint|pptx?)/.test(t)) return "📽";
  if (/(word|docx?)/.test(t)) return "📝";
  return "📎";
}

export function formatBytes(size: number): string {
  if (!Number.isFinite(size) || size <= 0) return "";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Why a file cannot be sent, before one is. Null when it is fine.
 *
 * Size is no longer one of the reasons. The empty check stays: a zero-byte file
 * is not a large file somebody chose to send, it is a file that failed to read,
 * and the engine refuses it anyway with "No file was received."
 */
export function localRefusal(file: File): string | null {
  if (MAX_BYTES !== null && file.size > MAX_BYTES) {
    return `${file.name} is larger than the ${Math.round(MAX_BYTES / (1024 * 1024))} MB limit.`;
  }
  if (file.size === 0) return `${file.name} is empty.`;
  return null;
}

