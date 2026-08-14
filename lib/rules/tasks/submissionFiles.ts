import type { TaskAttachment } from "../../domain/tasks.ts";

/**
 * The files on a completion submission, out of the two shapes the engine stores.
 *
 * ## Why this exists rather than a `.map()` at the call site
 *
 * `completionSubmission` carries files under two keys written by two paths:
 *
 *  · `imageUrls` — plain URL strings, from the proof-photo path.
 *  · `pdfAttachments` — objects `{url, name, embedUrl, downloadUrl}`, from the
 *    document path (`taskForward.service.js` builds them that way when it posts
 *    the same files to the task chat).
 *
 * The reader flattened BOTH to bare URL strings. A URL is not something to show
 * somebody — it has no filename in it and, rendered as chip text rather than as
 * a link, cannot even be opened. So the reviewer's screen had a message, a date,
 * and no way to see the work; and the Files tab, which looks for files in a
 * different store entirely, listed nothing at all.
 *
 * Keeping the name and the download address is the whole fix. Everything here is
 * defensive because both shapes are written by an application this one does not
 * control, and a malformed row must cost that row rather than the list.
 */

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

/** A readable name when the record carries none — the URL's last path segment. */
export function nameFromUrl(url: string, fallback: string): string {
  try {
    const path = new URL(url, "https://placeholder.invalid").pathname;
    const last = decodeURIComponent(path.split("/").filter(Boolean).pop() ?? "");
    return last || fallback;
  } catch {
    return fallback;
  }
}

/** `image` / `pdf` / the extension, for the glyph beside the link. */
export function typeOf(url: string, name: string, hint: string): string {
  const subject = `${name} ${url}`.toLowerCase();
  if (/\.pdf(\?|$|#)/.test(subject) || hint === "pdf") return "pdf";
  if (/\.(png|jpe?g|gif|webp|avif|heic)(\?|$|#)/.test(subject)) return "image";
  if (hint === "image") return "image";
  const ext = /\.([a-z0-9]{1,5})(\?|$|#)/.exec(subject)?.[1];
  return ext ?? "file";
}

function readOne(raw: unknown, hint: "image" | "pdf", index: number): TaskAttachment | null {
  if (typeof raw === "string") {
    const url = str(raw);
    if (!url) return null;
    const name = nameFromUrl(url, hint === "pdf" ? "Document" : "Proof");
    return { url, name, type: typeOf(url, name, hint), downloadUrl: url };
  }
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  /* `url` is the identity. A row without one cannot be opened or keyed, so it
     is dropped rather than rendered as a dead link. */
  const url = str(r.url) ?? str(r.downloadUrl) ?? str(r.embedUrl);
  if (!url) return null;
  const name =
    str(r.name) ?? nameFromUrl(url, hint === "pdf" ? `Document ${index + 1}` : `Proof ${index + 1}`);
  return {
    url,
    name,
    type: str(r.type) ?? typeOf(url, name, hint),
    /* The engine supplies a separate download address for documents; where it
       does not, the stored URL is the only address there is. */
    downloadUrl: str(r.downloadUrl) ?? url,
  };
}

/**
 * Every file on one submission, images first, in the order they were stored.
 *
 * Duplicates by URL are collapsed: the same file can legitimately appear in
 * both keys when a path writes it to each, and listing it twice reads as two
 * separate pieces of work.
 */
export function readSubmissionAttachments(
  submission: Record<string, unknown> | null | undefined,
): TaskAttachment[] {
  if (!submission) return [];
  const images = Array.isArray(submission.imageUrls) ? submission.imageUrls : [];
  const pdfs = Array.isArray(submission.pdfAttachments)
    ? submission.pdfAttachments
    : [];

  const out: TaskAttachment[] = [];
  const seen = new Set<string>();
  const push = (raw: unknown, hint: "image" | "pdf", i: number) => {
    const file = readOne(raw, hint, i);
    if (!file || seen.has(file.url)) return;
    seen.add(file.url);
    out.push(file);
  };

  images.forEach((raw, i) => push(raw, "image", i));
  pdfs.forEach((raw, i) => push(raw, "pdf", i));
  return out;
}
