/**
 * The images inside a paste or a drop.
 *
 * **Two places to look, and both are needed.** A file copied in a file manager
 * arrives in `DataTransfer.files`. A screenshot, or an image copied from a web
 * page, often arrives only in `items` — `files` is empty and the picture is
 * reachable through `getAsFile()`. Reading one and not the other is why "paste
 * a screenshot" and "paste a copied file" behave differently in most editors.
 *
 * A paste that carries an image usually carries text alongside it — a web page
 * copy brings `text/html` and `text/plain` describing the same picture. So the
 * caller has to know whether the paste is ABOUT an image, which is what
 * `imageFilesFrom` answers: the image files, or an empty list, and the caller
 * lets an empty list fall through to the editor's ordinary paste.
 */

/** Every file in a transfer, from whichever of the two places holds them. */
export function filesFrom(data: DataTransfer | null | undefined): File[] {
  if (!data) return [];
  const listed = data.files ? Array.from(data.files) : [];
  if (listed.length) return listed;
  const out: File[] = [];
  for (const item of Array.from(data.items ?? [])) {
    if (item.kind === "file") {
      const f = item.getAsFile();
      if (f) out.push(f);
    }
  }
  return out;
}

/**
 * Just the images.
 *
 * Matched on the MIME type the browser reports rather than on the file name: a
 * screenshot pasted from the clipboard frequently has no name at all, or a
 * generated one like `image.png`, and a name is not evidence of content.
 */
export function imageFilesFrom(data: DataTransfer | null | undefined): File[] {
  return filesFrom(data).filter((f) => (f.type || "").startsWith("image/"));
}

/**
 * Does this paste carry an image the editor should handle itself?
 *
 * **False when there is also HTML on the clipboard that is not just the image.**
 * Copying a rich passage that happens to contain a picture should paste the
 * passage — text, headings and all — not silently reduce it to its first
 * image. Only a paste whose meaningful content IS the image is intercepted.
 */
export function pasteIsImage(data: DataTransfer | null | undefined): boolean {
  const images = imageFilesFrom(data);
  if (!images.length) return false;

  const html = data?.getData?.("text/html") ?? "";
  if (!html) return true;

  /* Rich HTML with real text in it is a passage, not a picture. The tags are
     stripped and what is left is inspected: an `<img>`-only fragment leaves
     nothing behind, a copied paragraph leaves its words. */
  const text = html
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .trim();
  return text.length === 0;
}
