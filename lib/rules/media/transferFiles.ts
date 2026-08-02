/**
 * The files inside a paste or a drop.
 *
 * Trivial-looking, and it exists because the browsers do not agree. A file
 * copied in a file manager arrives on `DataTransfer.files`; an image copied out
 * of another web page, a screenshot from the system clipboard, and a drag from
 * some applications arrive ONLY on `DataTransfer.items` with `files` empty.
 * Reading one and not the other is why "paste a screenshot" works on one machine
 * and does nothing on another.
 *
 * Pure, so both facts can be asserted without a browser: what is picked up, and
 * what is deliberately left alone. A handler that claimed every paste would take
 * plain text and pasted URLs with it.
 */

/** A `DataTransfer`-shaped thing. Narrow, so a test needs no DOM. */
export interface TransferLike {
  files?: ArrayLike<File> | null;
  items?: ArrayLike<{ kind: string; getAsFile(): File | null }> | null;
}

/**
 * Every file carried by a paste or a drop. Empty for a plain-text paste, so a
 * caller can let that through untouched.
 */
export function filesFromTransfer(data: TransferLike | null): File[] {
  if (!data) return [];

  const fromFiles = data.files ? Array.from(data.files) : [];
  if (fromFiles.length) return fromFiles;

  /* `getAsFile` is null for the `text/plain` sibling item that accompanies a
     copied image, so the filter is not decorative. */
  const out: File[] = [];
  for (const item of Array.from(data.items ?? [])) {
    if (item.kind !== "file") continue;
    const f = item.getAsFile();
    if (f) out.push(f);
  }
  return out;
}

/** Only the images. For a surface that takes pictures and nothing else. */
export function imageFilesFromTransfer(data: TransferLike | null): File[] {
  return filesFromTransfer(data).filter((f) => f.type.startsWith("image/"));
}
