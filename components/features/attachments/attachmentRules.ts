/**
 * Attachment presentation rules, with no JSX.
 *
 * Split from the components so they can be exercised by the test runner, which
 * reads `.ts` natively and cannot strip JSX from a `.tsx`. They are also the
 * part worth testing: what may be sent, what may be previewed inline, and how a
 * file is described.
 */

/* Mirrors the engine's allow-list. Checked here to save a person a round trip
   on an obvious mistake; the ENGINE is still the authority, and it re-reads the
   file's real bytes rather than trusting any of this. */
export const ACCEPT =
  ".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.png,.jpg,.jpeg,.webp,.txt,.csv";
export const MAX_BYTES = 50 * 1024 * 1024;

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

/** Why a file cannot be sent, before one is. Null when it is fine. */
export function localRefusal(file: File): string | null {
  if (file.size > MAX_BYTES) {
    return `${file.name} is larger than the 50 MB limit.`;
  }
  if (file.size === 0) return `${file.name} is empty.`;
  return null;
}

