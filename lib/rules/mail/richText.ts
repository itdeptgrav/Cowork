/**
 * Plain ↔ rich helpers for mail bodies. Pure string/regex only — the TipTap
 * schema sanitiser lives in the `MailRichText` component; this is safe to import
 * anywhere (repository, tests) without pulling the editor in.
 */

/**
 * Plain text → simple HTML, for seeding the rich composer from a plain
 * reply/forward prefill or a grammar correction. Escapes first (so a `<` in the
 * quoted text is text, not a tag), splits blank-line paragraphs, and turns
 * single newlines into `<br>`.
 */
export function textToHtml(text: string): string {
  if (!text) return "";
  const esc = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return esc
    .split(/\n{2,}/)
    .map((p) => `<p>${p.replace(/\n/g, "<br>") || "<br>"}</p>`)
    .join("");
}

/**
 * Whether an editor's HTML carries real FORMATTING worth storing as a rich body.
 *
 * A single paragraph of plain text answers false — so an unformatted message
 * stays plain (`bodyHtml` is not set) and renders the fast plain-text path,
 * never the sanitising rich renderer. A formatting mark/tag, or more than one
 * block, answers true.
 */
export function isRichHtml(html: string): boolean {
  if (!html) return false;
  if (
    /<(strong|b|em|i|u|s|strike|a|ul|ol|li|h[1-6]|blockquote|span|sub|sup)\b/i.test(
      html,
    )
  ) {
    return true;
  }
  return (html.match(/<p\b/gi)?.length ?? 0) > 1;
}
