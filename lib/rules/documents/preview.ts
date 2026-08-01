/**
 * The one line a document list shows under a title.
 *
 * Derived from the stored HTML rather than kept as its own field: a stored
 * preview is a second copy of the first sentence, and it goes stale the moment
 * somebody edits the opening paragraph and the write that updates it is missed.
 *
 * **Tags are stripped, not rendered.** The list is text; putting a document's
 * own markup into it would let a heading in somebody's notes restyle the
 * sidebar, and an `<img>` or `<script>` in stored HTML would be worse than
 * merely ugly.
 */

const MAX = 140;

export function previewOfHtml(html: string): string {
  if (!html) return "";
  const text = html
    /* Whole elements whose CONTENT is not prose. Dropping only the tags would
       leave stylesheet or script text in the preview. */
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    /* Block boundaries become spaces, so two paragraphs do not run together
       into one word at the join. */
    .replace(/<\/(p|div|li|h[1-6]|blockquote|tr)>/gi, " ")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();

  if (text.length <= MAX) return text;
  /* Cut on a word where there is one nearby, so the preview does not end
     mid-syllable. */
  const cut = text.slice(0, MAX);
  const space = cut.lastIndexOf(" ");
  return `${space > MAX - 24 ? cut.slice(0, space) : cut}…`;
}

/** Whether a document has any prose in it at all. */
export function isEmptyHtml(html: string): boolean {
  return previewOfHtml(html).length === 0;
}
