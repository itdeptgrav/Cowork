import { PX_PER_INCH } from "@/lib/rules/documents/pageSetup";

/**
 * PDF export — client-side, from the real on-screen page.
 *
 * ## Why this is a raster export and not a second HTML→PDF renderer
 *
 * `exportHtml` in `DocumentEditor.tsx` already produces a standalone HTML file
 * with the prose styles inlined; a native PDF generator that walked the Tiptap
 * document a THIRD time (after the editor's own rendering and that exporter)
 * would be a second place page breaks, fonts and table borders could disagree
 * with what is on screen. `html2canvas` sidesteps that by capturing the actual
 * rendered page — the same pixels the person has been looking at — and
 * `jsPDF` lays those pixels into pages sized from the SAME `pageSizeIn`
 * constants the on-screen renderer computes with, so a PDF page is the same
 * size as the page it was captured from rather than a hardcoded Letter/A4.
 *
 * The backend's `pdfkit` is not used here. It is a from-scratch drawing API —
 * lines, text runs, explicit coordinates — with no HTML/CSS rendering of its
 * own, so it cannot take this editor's live DOM as an input; reimplementing
 * this document's layout in `pdfkit`'s drawing calls would be a second layout
 * engine for the editor to stay visually in sync with forever. This stays
 * entirely client-side.
 */

const RENDER_SCALE = 2;

/**
 * Where a captured page image should be cut into PDF pages.
 *
 * Two kinds of boundary, and they are not the same rule:
 *
 * - A **manual page break** (`.doc-page-break`, `break-after: page` in print)
 *   is a HARD boundary wherever it falls — the same thing the browser's own
 *   print already does with it, so a PDF that ignored it would be less
 *   faithful to the document than printing it is.
 * - Otherwise, a boundary falls every `pageHeightPx` — the exact page height
 *   `pageSizeIn` already computes from the document's stored paper size and
 *   orientation, so a PDF page holds the same amount of text a physical page
 *   would.
 *
 * Pure and DOM-free on purpose, so the slicing logic can be exercised without
 * a browser or a captured canvas.
 */
export function computePageBoundaries(
  contentHeightPx: number,
  pageHeightPx: number,
  breakOffsetsPx: number[] = [],
): number[] {
  if (!(contentHeightPx > 0) || !(pageHeightPx > 0)) return [0];
  const breaks = [...breakOffsetsPx]
    .filter((b) => b > 0 && b < contentHeightPx)
    .sort((a, b) => a - b);

  const bounds = [0];
  let cursor = 0;
  /* A tiny epsilon on both sides of the comparisons below: captured heights
     come out of `offsetTop`/`scrollHeight`, which are already rounded to the
     pixel, and without it a break sitting exactly on a natural page boundary
     could be skipped or double-counted depending on which side of .5 it
     rounded to. */
  while (cursor < contentHeightPx - 0.5) {
    const natural = Math.min(cursor + pageHeightPx, contentHeightPx);
    const forced = breaks.find((b) => b > cursor + 0.5 && b <= natural + 0.5);
    const next = forced ?? natural;
    bounds.push(next);
    cursor = next;
  }
  return bounds;
}

export interface PdfExportInput {
  /**
   * The live `[data-doc-print]` page element — the same node the print
   * stylesheet targets. Must be captured UNSCALED: the caller is responsible
   * for neutralising any `transform: scale(zoom)` on it first (and restoring
   * it afterwards), because the PDF's own page size already comes from the
   * document's true inch measure and a zoomed capture would double-apply it.
   */
  page: HTMLElement;
  widthIn: number;
  heightIn: number;
  /** Without the extension — `.pdf` is appended here. */
  fileName: string;
  /**
   * Repeated at the top and bottom of every page, from the document's page
   * setup. The on-screen copies are `position: fixed` for the PRINT path and
   * mean nothing to a canvas capture, so the export draws its own — real text
   * through jsPDF, on each page, after the image lands.
   */
  header?: string;
  footer?: string;
  pageNumbers?: boolean;
}

export type PdfExportResult = { ok: true } | { ok: false; message: string };

/**
 * Capture the page and save it as a PDF.
 *
 * `html2canvas` and `jsPDF` are imported dynamically so neither ships in the
 * bundle for a document nobody exports — the same convention this codebase
 * already uses for `firebase/firestore` and the Firebase auth helpers.
 */
export async function exportDocumentPdf(input: PdfExportInput): Promise<PdfExportResult> {
  const { page, widthIn, heightIn, fileName } = input;
  try {
    const [{ default: html2canvas }, { jsPDF }] = await Promise.all([
      import("html2canvas"),
      import("jspdf"),
    ]);

    const pageWidthPx = widthIn * PX_PER_INCH;
    const pageHeightPx = heightIn * PX_PER_INCH;

    /* Read BEFORE the capture — html2canvas clones the subtree, and an
       `offsetTop` read against the clone would need the clone's own layout
       pass rather than the one the browser already did for the real page. */
    const breakOffsetsPx = Array.from(
      page.querySelectorAll<HTMLElement>(".doc-page-break"),
    ).map((el) => el.offsetTop);
    const contentHeightPx = page.scrollHeight;

    const canvas = await html2canvas(page, {
      scale: RENDER_SCALE,
      backgroundColor: "#ffffff",
      useCORS: true,
      windowWidth: pageWidthPx,
    });

    const bounds = computePageBoundaries(contentHeightPx, pageHeightPx, breakOffsetsPx);
    if (bounds.length < 2) return { ok: false, message: "The document is empty — nothing to export." };

    const orientation = widthIn > heightIn ? "landscape" : "portrait";
    const pdf = new jsPDF({ unit: "in", format: [widthIn, heightIn], orientation });

    /* The ratio between the captured canvas and the unscaled page, so a slice
       boundary expressed in on-screen px can be read as a canvas-pixel
       offset. Measured from the real output rather than assumed to equal
       `RENDER_SCALE`, in case the browser clamped it (very tall documents can
       hit a canvas size limit). */
    const canvasScale = canvas.width / pageWidthPx;

    const slice = document.createElement("canvas");
    const ctx = slice.getContext("2d");
    if (!ctx) return { ok: false, message: "This browser could not prepare the PDF image." };
    slice.width = canvas.width;

    for (let i = 0; i < bounds.length - 1; i++) {
      const fromPx = bounds[i];
      const toPx = bounds[i + 1];
      const sliceCanvasHeight = Math.max(1, Math.round((toPx - fromPx) * canvasScale));
      slice.height = sliceCanvasHeight;
      ctx.clearRect(0, 0, slice.width, slice.height);
      ctx.drawImage(
        canvas,
        0,
        Math.round(fromPx * canvasScale),
        canvas.width,
        sliceCanvasHeight,
        0,
        0,
        slice.width,
        sliceCanvasHeight,
      );

      if (i > 0) pdf.addPage([widthIn, heightIn], orientation);
      const sliceHeightIn = (toPx - fromPx) / PX_PER_INCH;
      pdf.addImage(slice.toDataURL("image/png"), "PNG", 0, 0, widthIn, sliceHeightIn);

      /* The page furniture, drawn as real text after the image so it can never
         be covered by it. Centred header at the top margin's midline, footer at
         the bottom's; the page number sits at the right edge of the footer
         line, clear of a centred footer text. */
      if (input.header || input.footer || input.pageNumbers) {
        pdf.setFontSize(9);
        pdf.setTextColor(102);
        if (input.header) {
          pdf.text(input.header, widthIn / 2, 0.35, { align: "center" });
        }
        if (input.footer) {
          pdf.text(input.footer, widthIn / 2, heightIn - 0.3, { align: "center" });
        }
        if (input.pageNumbers) {
          pdf.text(
            `Page ${i + 1} of ${bounds.length - 1}`,
            widthIn - 0.5,
            heightIn - 0.3,
            { align: "right" },
          );
        }
      }
    }

    pdf.save(`${fileName}.pdf`);
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      message: e instanceof Error ? e.message : "The PDF could not be created.",
    };
  }
}
