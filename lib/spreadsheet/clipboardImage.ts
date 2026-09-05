/**
 * Deciding whether a paste is a picture.
 *
 * ## Why this is a decision and not a lookup
 *
 * A clipboard holds several representations of one copy at once. A screenshot
 * is an image and nothing else. But a range copied out of Excel or Google
 * Sheets carries tab-separated TEXT, HTML **and**, on Windows, a bitmap of the
 * cells — so "does the clipboard contain an image?" is true for both, and
 * answering yes to both would hijack every ordinary paste from another
 * spreadsheet and offer to crop a picture of somebody's numbers.
 *
 * The rule, therefore: **a picture only when there is no text to paste
 * instead.** Text is the thing a spreadsheet knows how to place into cells, so
 * where a source offers it, it is what was meant. That leaves the genuine
 * cases — a screenshot, an image copied from a web page, an image file copied
 * in a file manager — which carry no text at all.
 *
 * Pure: it takes a `DataTransfer`-shaped thing and returns a `File` or null. No
 * React, no `navigator`, so the decision can be tested without a clipboard.
 */

/** The parts of `DataTransfer` this needs — narrowed so a test can supply one. */
export interface ClipboardLike {
  getData?: (format: string) => string;
  items?: ArrayLike<{
    kind: string;
    type: string;
    getAsFile: () => File | null;
  }>;
  files?: ArrayLike<File>;
}

/** Whether the clipboard offers text worth placing into cells. */
function hasText(data: ClipboardLike): boolean {
  try {
    const text = data.getData?.("text/plain") ?? "";
    return text.trim() !== "";
  } catch {
    /* Some browsers throw reading a format that is not there. */
    return false;
  }
}

/**
 * The picture on the clipboard, or null when this paste is not one.
 *
 * Returns the FIRST image. A clipboard carrying several is vanishingly rare
 * and a cell holds one picture, so there is nothing sensible to do with the
 * rest; taking the first is at least predictable.
 */
export function imageFromClipboard(data: ClipboardLike | null | undefined): File | null {
  if (!data) return null;
  /* Text wins — see the note above. */
  if (hasText(data)) return null;

  const items = data.items;
  if (items) {
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.kind !== "file" || !item.type.startsWith("image/")) continue;
      const file = item.getAsFile();
      if (file) return file;
    }
  }

  /* `files` rather than `items`: a file manager's copy arrives this way in
     some browsers, with no `items` entry at all. */
  const files = data.files;
  if (files) {
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      if (file && file.type.startsWith("image/")) return file;
    }
  }
  return null;
}
