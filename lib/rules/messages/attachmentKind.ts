import type { MessageAttachment } from "@/lib/domain";

/**
 * What kind of thing an attachment is, from what the browser tells us about it.
 *
 * ## Why the filename is consulted at all
 *
 * `File.type` is a guess, not a fact. It comes from the operating system's own
 * association table, and it is **empty far more often than people expect**: a
 * file dragged from an archive, one with an extension the OS does not know, a
 * `.mkv` on a machine with no player installed, anything arriving through some
 * paste paths. An empty type is not "unknown media" — it is "nobody asked".
 *
 * Deciding on MIME alone therefore filed real videos as generic files, and a
 * generic file renders as a grey row with a paperclip. The person who sent a
 * clip would see a download link where a player should be, and nothing about
 * the message would explain why.
 *
 * So: **MIME first, because when it is present it is authoritative** — a server
 * that says `video/mp4` knows better than a name — and the extension only as a
 * fallback when MIME is absent or useless (`application/octet-stream`, which is
 * what "I have no idea" looks like on the wire).
 *
 * ## `voice` is the audio kind, and the name is historical
 *
 * The union says `voice` because audio arrived here as recorded voice notes.
 * Every audio file now takes that kind — an uploaded `.mp3` gets the same
 * player a voice note does, which is what somebody attaching one wants. The
 * name is left alone because it is written into every message document ever
 * stored; renaming it would be a migration to buy a nicer word.
 */

/** Extensions that identify media when the MIME type does not. */
const VIDEO_EXTENSIONS = [
  "mp4", "m4v", "mov", "webm", "mkv", "avi", "wmv", "flv", "mpg", "mpeg",
  "3gp", "3g2", "ogv", "mts", "m2ts", "ts", "vob", "asf", "rm", "rmvb",
];

const AUDIO_EXTENSIONS = [
  "mp3", "wav", "ogg", "oga", "m4a", "aac", "flac", "wma", "opus", "aiff",
  "aif", "amr", "mid", "midi", "weba", "caf",
];

const IMAGE_EXTENSIONS = [
  "jpg", "jpeg", "png", "gif", "webp", "avif", "bmp", "svg", "heic", "heif",
  "tif", "tiff", "ico",
];

/** The extension, lowercased, or "" — never the whole name for a dotfile. */
export function extensionOf(name: string | null | undefined): string {
  if (!name) return "";
  const base = name.split(/[\\/]/).pop() ?? "";
  const dot = base.lastIndexOf(".");
  /* `> 0`, not `>= 0`: ".gitignore" is a name, not an extension. */
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : "";
}

/**
 * Whether a MIME type actually says anything.
 *
 * `application/octet-stream` is the wire's way of shrugging, and it is what
 * Drive hands back for plenty of files it did not recognise on the way in.
 * Treating it as authoritative is how a video becomes a paperclip.
 */
function meaningful(mime: string): boolean {
  const m = mime.toLowerCase().trim();
  return m !== "" && m !== "application/octet-stream" && m !== "binary/octet-stream";
}

export function attachmentKind(
  name: string | null | undefined,
  mimeType: string | null | undefined,
): MessageAttachment["kind"] {
  const mime = (mimeType ?? "").toLowerCase().trim();

  if (meaningful(mime)) {
    if (mime.startsWith("image/")) return "image";
    if (mime.startsWith("video/")) return "video";
    if (mime.startsWith("audio/")) return "voice";
    if (mime === "application/pdf") return "pdf";
    /* A recognised MIME that is none of the above is a document, an archive, a
       spreadsheet — all of which are "file", and correctly so. Falling through
       to the extension check here would let a `.mov` inside a zip named
       "clip.mov.zip" be mistaken for a video. */
    return "file";
  }

  const ext = extensionOf(name);
  if (IMAGE_EXTENSIONS.includes(ext)) return "image";
  if (VIDEO_EXTENSIONS.includes(ext)) return "video";
  if (AUDIO_EXTENSIONS.includes(ext)) return "voice";
  if (ext === "pdf") return "pdf";
  return "file";
}

/** Whether this attachment should be given a player rather than a link. */
export function isPlayable(kind: MessageAttachment["kind"]): boolean {
  return kind === "video" || kind === "voice";
}
