"use client";

/**
 * Word documents in.
 *
 * `mammoth` reads a .docx and produces clean semantic HTML — headings, lists,
 * tables, bold and italic, images as data URIs — rather than a copy of Word's
 * styling, which is exactly what an editor with its own styles wants. What it
 * does not carry (page layout, fonts, columns) is what a document would lose
 * anyway on the way into Google Docs.
 *
 * Loaded on demand: the library is a few hundred kilobytes and most documents
 * are never imported.
 */
export interface DocxImportResult {
  html: string;
  /** What mammoth could not represent, one line each, for the import notice. */
  warnings: string[];
}

export async function docxToHtml(file: File): Promise<DocxImportResult> {
  const mammoth = await import("mammoth");
  const arrayBuffer = await file.arrayBuffer();
  const result = await mammoth.convertToHtml(
    { arrayBuffer },
    {
      styleMap: [
        "p[style-name='Title'] => h1:fresh",
        "p[style-name='Subtitle'] => h2:fresh",
        "p[style-name='Quote'] => blockquote:fresh",
        "p[style-name='Intense Quote'] => blockquote:fresh",
      ],
    },
  );
  const warnings = [...new Set(result.messages.map((m) => m.message))].slice(0, 6);
  return { html: result.value, warnings };
}

/** A title for the new document: the file's name, without its extension. */
export function docxTitle(file: File): string {
  return file.name.replace(/\.docx?$/i, "").trim() || "Imported document";
}
