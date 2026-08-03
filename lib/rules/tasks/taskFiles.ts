/**
 * Every file that belongs to one task, in one list.
 *
 * ## Why this is a rule and not a component
 *
 * A task's files are scattered across five places that do not know about each
 * other: reference material on the task, a set per submission attempt,
 * correction files from a reviewer, files on daily reports, and whatever was
 * dropped into either chat thread. Somebody who wants "the spec Rakesh sent"
 * does not remember which of those it came through — they remember the file.
 * Pooling them is the whole point of the Files tab, and the pooling has to
 * happen somewhere testable, because it is where two genuinely different
 * storage systems meet.
 *
 * ## The two storage systems, which are NOT interchangeable
 *
 * | | Where | Reached by | Who can open it |
 * |---|---|---|---|
 * | `private` | `cowork_attachments` + private Drive | the engine's authenticated route | whoever may see the task |
 * | `link` | public Drive / Cloudinary | a URL | **anybody holding the URL** |
 *
 * Reference, submission and correction files are private. Chat and daily-report
 * files are public media — that is a property they already had, decided in
 * `uploadDriveFile` vs `uploadAttachment`, not something this list introduces.
 * But a tab that gathers them into one place makes those URLs easy to collect,
 * so `access` travels with every file and the screen says which is which.
 * Silently mixing them would teach the reader that every file here is guarded.
 *
 * Nothing here fetches, and nothing constructs a URL — `mediaUrl` needs an
 * environment the rules layer does not read. Each file carries the HANDLE its
 * origin gave it and the component resolves it.
 */

import type { AttachmentMeta } from "@/lib/legacy/attachments";
import type {
  DailyReport,
  MessageAttachment,
  TaskChatMessage,
  TaskSubmission,
} from "@/lib/domain";

/* ── The shape ────────────────────────────────────────────────────────────── */

/**
 * Where a file entered the task. The filter the reader actually reaches for —
 * "it was in the chat" is how people remember a file, far more than its type.
 */
export type FileSource =
  | "reference"
  | "submission"
  | "correction"
  | "report"
  | "chat";

/**
 * What a file IS, coarsely.
 *
 * Coarse on purpose: a reader scanning for "the spreadsheet" does not care
 * whether it is `.xlsx` or `.csv`, and a filter with fourteen entries is a
 * second search box. Eight buckets, each one a word somebody would say.
 */
export type FileKind =
  | "image"
  | "pdf"
  | "document"
  | "sheet"
  | "slides"
  | "archive"
  | "voice"
  | "other";

/** How the bytes are reached. The component switches on this; nothing else does. */
export type FileHandle =
  /** Private: an id, fetched through the engine with the viewer's token. */
  | { via: "attachment"; attachment: AttachmentMeta }
  /** Chat media: kind, name and a Drive id the media proxy resolves. */
  | { via: "media"; media: MessageAttachment }
  /** A plain public URL, which is all a daily report stores. */
  | { via: "url"; url: string };

export interface TaskFile {
  /**
   * Unique within a task and stable across refetches.
   *
   * Sourced from the id or URL rather than an index, so a React list does not
   * reshuffle its rows when a new file arrives at the top.
   */
  key: string;
  name: string;
  kind: FileKind;
  source: FileSource;
  /**
   * Which submission, which report, which message — one short phrase.
   *
   * A pooled list loses the grouping that gave a file its meaning; "Attempt 2"
   * and "Report · 14 Jul" are what put it back without splitting the list.
   */
  context: string;
  sizeBytes: number | null;
  /** ISO. Null where the origin stored none — never defaulted to now. */
  uploadedAt: string | null;
  /** An employee id or a name, whichever the origin recorded. Null if neither. */
  uploadedBy: string | null;
  access: "private" | "link";
  handle: FileHandle;
}

/* ── Classification ───────────────────────────────────────────────────────── */

const BY_EXTENSION: Record<string, FileKind> = {
  pdf: "pdf",
  doc: "document",
  docx: "document",
  rtf: "document",
  odt: "document",
  txt: "document",
  md: "document",
  xls: "sheet",
  xlsx: "sheet",
  csv: "sheet",
  ods: "sheet",
  ppt: "slides",
  pptx: "slides",
  odp: "slides",
  zip: "archive",
  rar: "archive",
  "7z": "archive",
  gz: "archive",
  tar: "archive",
};

/**
 * What kind of file this is, from its type and failing that its name.
 *
 * **The name is a fallback, not the answer.** A browser reports `text/csv` for
 * one spreadsheet and `application/octet-stream` for the next, and the engine
 * sniffs the real type from the CONTENT on upload — so the mime type is the
 * better evidence wherever there is one. Chat media, which carries no mime type
 * at all, is the case the extension branch exists for.
 */
export function fileKind(mimeType: string | null, name: string | null): FileKind {
  const type = (mimeType ?? "").toLowerCase();
  if (type.startsWith("image/")) return "image";
  if (type.startsWith("audio/")) return "voice";
  if (type === "application/pdf") return "pdf";
  if (type.includes("spreadsheet") || type === "text/csv") return "sheet";
  if (type.includes("presentation")) return "slides";
  if (type.includes("word") || type.startsWith("text/")) return "document";
  if (type.includes("zip") || type.includes("compressed")) return "archive";

  const dot = (name ?? "").lastIndexOf(".");
  if (dot > 0) {
    const ext = (name ?? "").slice(dot + 1).toLowerCase();
    const known = BY_EXTENSION[ext];
    if (known) return known;
    /* Only where the mime type said nothing at all — an explicit
       `application/octet-stream` on a `.png` is still a picture. */
    if (["png", "jpg", "jpeg", "gif", "webp", "svg", "heic", "avif"].includes(ext))
      return "image";
    if (["mp3", "wav", "m4a", "ogg", "webm", "aac"].includes(ext)) return "voice";
  }
  return "other";
}

/**
 * A name for a file whose origin recorded none.
 *
 * Chat and report media are stored as URLs, and a voice note has no name at
 * all. Falling back to the last path segment beats "Untitled" — it is usually
 * the real filename — and a voice note gets a word rather than a blank row.
 */
export function fileNameFrom(
  name: string | null,
  url: string,
  kind: FileKind,
): string {
  if (name && name.trim()) return name.trim();
  try {
    /* A relative or malformed URL is not an error worth throwing over; the
       fallback below covers it. */
    const path = url.split("?")[0].split("#")[0];
    const last = path.slice(path.lastIndexOf("/") + 1);
    const decoded = decodeURIComponent(last);
    if (decoded && decoded.includes(".")) return decoded;
  } catch {
    /* A percent sequence that is not valid UTF-8. Fall through. */
  }
  return kind === "voice" ? "Voice note" : "Untitled file";
}

/* ── Normalisers, one per origin ──────────────────────────────────────────── */

/** Private files hanging off an entity: reference, submission or correction. */
export function fromAttachments(
  attachments: readonly AttachmentMeta[],
  source: Extract<FileSource, "reference" | "submission" | "correction">,
  context: string,
): TaskFile[] {
  return attachments.map((a) => ({
    key: `attachment:${a.id}`,
    name: a.name,
    kind: fileKind(a.type, a.name),
    source,
    context,
    sizeBytes: a.size > 0 ? a.size : null,
    uploadedAt: a.uploadedAt ?? null,
    uploadedBy: a.uploadedBy ?? null,
    access: "private",
    handle: { via: "attachment", attachment: a },
  }));
}

/** Everything dropped into either chat thread. */
export function fromChat(messages: readonly TaskChatMessage[]): TaskFile[] {
  const out: TaskFile[] = [];
  for (const m of messages) {
    const items = m.attachments ?? [];
    items.forEach((a, i) => {
      /* The message's OWN kind first: it was decided when the file was sent and
         a voice note has nothing else to go on. `file` means the sender's
         client did not know, which is exactly when the name is worth reading. */
      const kind: FileKind =
        a.kind === "voice" || a.kind === "image" || a.kind === "pdf"
          ? a.kind
          : fileKind(null, a.name ?? a.url);
      out.push({
        /* The URL is the only stable handle a chat attachment has — the mapper
           says so where it builds `attachmentIds`. The index disambiguates the
           same file sent twice in one message. */
        key: `chat:${m.id}:${i}:${a.fileId ?? a.url}`,
        name: fileNameFrom(a.name, a.url, kind),
        kind,
        source: "chat",
        context: m.thread === "draft" ? "Negotiation chat" : "Chat",
        sizeBytes: a.sizeBytes,
        uploadedAt: m.createdAt || null,
        uploadedBy: m.senderName || (m.senderId === "system" ? null : m.senderId),
        access: "link",
        handle: { via: "media", media: a },
      });
    });
  }
  return out;
}

/** Files attached to a daily report. The report's own document is not a file. */
export function fromReports(reports: readonly DailyReport[]): TaskFile[] {
  const out: TaskFile[] = [];
  for (const r of reports) {
    r.attachments.forEach((a, i) => {
      const kind = fileKind(a.mimeType, a.name);
      out.push({
        key: `report:${r.id}:${i}:${a.url}`,
        name: fileNameFrom(a.name, a.url, kind),
        kind,
        source: "report",
        /* The report DATE, not its id: that is how somebody refers to it. */
        context: `Report · ${r.reportDate}`,
        sizeBytes: null,
        uploadedAt: r.createdAt || null,
        uploadedBy: r.employeeId || null,
        access: "link",
        handle: { via: "url", url: a.url },
      });
    });
  }
  return out;
}

/** The label an attempt carries in the list. Numbered from the submission. */
export function submissionContext(sub: Pick<TaskSubmission, "attempt">): string {
  return `Attempt ${sub.attempt}`;
}

/* ── Ordering, filtering, counting ────────────────────────────────────────── */

/**
 * Newest first, and files with no timestamp LAST rather than first.
 *
 * A null date sorted as 0 would put every legacy chat file that lost its
 * timestamp above today's upload — the list would open on its oldest, least
 * relevant rows. Ties and undated rows fall back to the name so the order is
 * stable between renders rather than dependent on fetch completion order.
 */
export function sortTaskFiles(files: readonly TaskFile[]): TaskFile[] {
  return [...files].sort((a, b) => {
    const at = a.uploadedAt ? Date.parse(a.uploadedAt) : NaN;
    const bt = b.uploadedAt ? Date.parse(b.uploadedAt) : NaN;
    const aOk = Number.isFinite(at);
    const bOk = Number.isFinite(bt);
    if (aOk && bOk && at !== bt) return bt - at;
    if (aOk !== bOk) return aOk ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

export interface FileFilter {
  /** Empty means every source. Not "none" — an empty filter is not a refusal. */
  sources: readonly FileSource[];
  kinds: readonly FileKind[];
  /** Matched against the name and the context, case-insensitively. */
  query: string;
}

export const NO_FILTER: FileFilter = { sources: [], kinds: [], query: "" };

export function filterTaskFiles(
  files: readonly TaskFile[],
  filter: FileFilter,
): TaskFile[] {
  const q = filter.query.trim().toLowerCase();
  return files.filter((f) => {
    if (filter.sources.length && !filter.sources.includes(f.source)) return false;
    if (filter.kinds.length && !filter.kinds.includes(f.kind)) return false;
    if (!q) return true;
    return (
      f.name.toLowerCase().includes(q) ||
      f.context.toLowerCase().includes(q) ||
      (f.uploadedBy ?? "").toLowerCase().includes(q)
    );
  });
}

/**
 * How many files each source holds — counted over the WHOLE set, never the
 * filtered one.
 *
 * A chip reading "Chat 4" that becomes "Chat 0" the moment you filter to
 * Reports is telling you about the filter rather than about the task, and it
 * makes the one thing a chip is for — deciding whether to press it — impossible.
 */
export function countBySource(
  files: readonly TaskFile[],
): Record<FileSource, number> {
  const counts: Record<FileSource, number> = {
    reference: 0,
    submission: 0,
    correction: 0,
    report: 0,
    chat: 0,
  };
  for (const f of files) counts[f.source] += 1;
  return counts;
}

export function countByKind(files: readonly TaskFile[]): Record<FileKind, number> {
  const counts: Record<FileKind, number> = {
    image: 0,
    pdf: 0,
    document: 0,
    sheet: 0,
    slides: 0,
    archive: 0,
    voice: 0,
    other: 0,
  };
  for (const f of files) counts[f.kind] += 1;
  return counts;
}

/** Total bytes, and how many files that figure actually covers. */
export function totalSize(files: readonly TaskFile[]): {
  bytes: number;
  covered: number;
  total: number;
} {
  let bytes = 0;
  let covered = 0;
  for (const f of files) {
    if (typeof f.sizeBytes === "number" && f.sizeBytes > 0) {
      bytes += f.sizeBytes;
      covered += 1;
    }
  }
  /* A pair, not a number. Chat and report files record no size at all, so "12
     MB" across nine files when only four carry a figure reads as the whole and
     is not — the same rule `committedEffort` follows for time. */
  return { bytes, covered, total: files.length };
}

/* ── Labels, so the tab and the help article cannot drift ─────────────────── */

export const SOURCE_LABEL: Record<FileSource, string> = {
  reference: "Reference",
  submission: "Submitted work",
  correction: "Corrections",
  report: "Reports",
  chat: "Chat",
};

export const SOURCE_HINT: Record<FileSource, string> = {
  reference: "Supplied with the task — what the work is done from.",
  correction: "Attached by a reviewer when work was sent back.",
  submission: "Handed in by the assignee, kept per attempt.",
  report: "Attached to a daily progress report.",
  chat: "Sent in the task's chat or its negotiation thread.",
};

export const KIND_LABEL: Record<FileKind, string> = {
  image: "Images",
  pdf: "PDFs",
  document: "Documents",
  sheet: "Sheets",
  slides: "Slides",
  archive: "Archives",
  voice: "Voice",
  other: "Other",
};

/** The order the chips are drawn in: the order files arrive at a task. */
export const SOURCE_ORDER: readonly FileSource[] = [
  "reference",
  "chat",
  "report",
  "submission",
  "correction",
];

export const KIND_ORDER: readonly FileKind[] = [
  "image",
  "pdf",
  "document",
  "sheet",
  "slides",
  "voice",
  "archive",
  "other",
];
