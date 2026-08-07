"use client";

import {
  childrenOf,
  connectorPath,
  layoutMap,
  NODE_H,
  NODE_W,
  type MindMap,
} from "./tree.ts";
/* Relative and extensioned: the test runner is plain `node --test`, which
   resolves neither the `@/` alias nor an extensionless path — and without it
   this module cannot be loaded by a test at all. */
import { PX_PER_INCH } from "../documents/pageSetup.ts";

/**
 * SVG and PNG export.
 *
 * **Not a serialization of the canvas.** `MindMapCanvas.tsx` draws the
 * connectors as one real `<svg>` layer, but every card is an HTML `<div>`
 * (title, badges, buttons) positioned alongside it — there is no single SVG
 * element that is "the map" to serialize. Rebuilding the map as its own
 * small, clean SVG here — cards as `<rect>`+`<text>`, connectors as
 * `<path>`, from the same `layoutMap` the canvas itself draws from — is a
 * few dozen lines and produces a genuinely portable vector file; embedding
 * the live HTML cards into an SVG via `<foreignObject>` would have been more
 * code for a result several browsers refuse to rasterize to a canvas at all
 * (a security restriction on foreignObject content, not a bug to work
 * around here).
 *
 * Depth colours and ink/hairline read from the page's own CSS custom
 * properties at export time (`getComputedStyle`), so a dark-mode export
 * looks like dark mode rather than always exporting the light palette. The
 * hex fallbacks match `app/globals.css`'s light theme exactly, for the
 * narrow case of exporting before the stylesheet has painted.
 */

const DEPTH_VARS_WITH_FALLBACK: [string, string][] = [
  ["--color-field-mauve", "#b39cc6"],
  ["--color-field-slate", "#8b9fbc"],
  ["--color-field-rose", "#d9a4b0"],
  ["--color-field-gold", "#e6c79c"],
  ["--color-field-ivory", "#f2e6d2"],
];

function cssVar(name: string, fallback: string): string {
  if (typeof window === "undefined" || typeof document === "undefined")
    return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

/** One line, roughly what the on-screen card already truncates to. */
function truncate(text: string, max = 34): string {
  const trimmed = text.trim() || "Untitled";
  return trimmed.length > max ? `${trimmed.slice(0, max - 1)}…` : trimmed;
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * The map with every branch OPEN.
 *
 * `layoutMap` places nothing beneath a collapsed node — correctly, because on
 * screen a collapsed branch is not there to be drawn. An export is a different
 * question: it is the document, not the view of it, and a reader opening the
 * PDF has no chevron to press. Exporting the collapsed shape silently dropped
 * whole branches from the file, and nothing on the page said so — the map
 * looked complete because it matched the screen it was taken from.
 *
 * Done on a COPY. Expanding the live map would open every branch under the
 * person exporting it, which is a change to their view they did not ask for —
 * and on a shared map, to everybody else's too.
 */
function fullyExpanded(map: MindMap): MindMap {
  if (!map.nodes.some((n) => n.collapsed)) return map;
  return {
    ...map,
    nodes: map.nodes.map((n) => (n.collapsed ? { ...n, collapsed: false } : n)),
  };
}

/** The map, as one self-contained SVG document string. Every branch included. */
export function mindmapToSvg(input: MindMap): string {
  const map = fullyExpanded(input);
  const layout = layoutMap(map);
  const width = Math.max(1, layout.width);
  const height = Math.max(1, layout.height);

  const bg = cssVar("--body-bg", "#cfcfcf");
  const card = cssVar("--frost-panel", "rgb(238, 238, 240)");
  const hairline = cssVar("--hairline", "rgba(10, 10, 10, 0.12)");
  const ink = cssVar("--ink", "#0a0a0a");
  const depthColors = DEPTH_VARS_WITH_FALLBACK.map(([name, fallback]) =>
    cssVar(name, fallback),
  );

  const connectors = layout.placed
    .flatMap((p) =>
      (p.node.collapsed ? [] : childrenOf(map, p.node.id)).map((c) => {
        const child = layout.byId.get(c.id);
        if (!child) return "";
        return `<path d="${connectorPath(p, child)}" fill="none" stroke="${hairline}" stroke-width="1.5" />`;
      }),
    )
    .join("");

  const nodes = layout.placed
    .map((p) => {
      const hue = depthColors[Math.min(p.depth, depthColors.length - 1)];
      const label = escapeXml(truncate(p.node.title));
      return `<g transform="translate(${p.x}, ${p.y})">
        <rect width="${NODE_W}" height="${NODE_H}" rx="10" fill="${card}" stroke="${hairline}" />
        <rect width="3" height="${NODE_H}" fill="${hue}" />
        <text x="16" y="${NODE_H / 2}" dominant-baseline="middle" font-family="system-ui, sans-serif" font-size="13" fill="${ink}">${label}</text>
      </g>`;
    })
    .join("");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
    <title>${escapeXml(map.title || "Mindmap")}</title>
    <rect width="${width}" height="${height}" fill="${bg}" />
    ${connectors}
    ${nodes}
  </svg>`;
}

function download(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function downloadMindmapSvg(map: MindMap): void {
  const svg = mindmapToSvg(map);
  download(new Blob([svg], { type: "image/svg+xml" }), `${fileBase(map)}.svg`);
}

/**
 * The SVG, rasterized onto a canvas at `scale`× — plain `Image` + `<canvas>`,
 * the standard SVG→raster browser pattern, no dependency needed because the
 * source is already SVG rather than arbitrary styled HTML. Shared by the PNG
 * and PDF exports below, so there is exactly one place that turns the map's
 * vector form into pixels.
 */
async function rasterizeMindmap(
  map: MindMap,
  scale: number,
): Promise<{ canvas: HTMLCanvasElement; widthPx: number; heightPx: number }> {
  const svg = mindmapToSvg(map);
  /* **The SAME expansion the SVG was drawn from.** Measuring the collapsed map
     here would size the canvas to the visible shape and scale a full-size
     drawing into it — the branches would be present and squashed, which is
     worse than the omission it replaced. */
  const layout = layoutMap(fullyExpanded(map));
  const widthPx = Math.max(1, layout.width);
  const heightPx = Math.max(1, layout.height);

  const svgUrl = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("Could not rasterize the map."));
      img.src = svgUrl;
    });

    const canvas = document.createElement("canvas");
    canvas.width = widthPx * scale;
    canvas.height = heightPx * scale;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Could not rasterize the map.");
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    return { canvas, widthPx, heightPx };
  } finally {
    URL.revokeObjectURL(svgUrl);
  }
}

/** A PNG at `scale`× for a crisp export on a high-DPI screen. */
export async function downloadMindmapPng(map: MindMap, scale = 2): Promise<void> {
  const { canvas } = await rasterizeMindmap(map, scale);
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/png"),
  );
  if (!blob) throw new Error("Could not export the map as an image.");
  download(blob, `${fileBase(map)}.png`);
}

/**
 * A single-page PDF holding the whole map, sized to the map's own aspect
 * ratio rather than a fixed Letter/A4 — the same "the export is the size of
 * the thing it's exporting" rule `lib/documents/pdfExport.ts` follows for a
 * document page.
 *
 * Converted to inches by hand with `PX_PER_INCH` (96, the standard CSS
 * pixel) rather than trusting `jsPDF`'s own `unit: "px"` mode: jsPDF's "px"
 * has historically meant 72-DPI px in some versions and 96-DPI in others
 * depending on a hotfix flag, which is exactly the kind of silent disagreement
 * that would print this at the wrong physical size. `unit: "in"` with a
 * pre-computed size has no such ambiguity, and is the same approach
 * `pdfExport.ts` already uses for a document page.
 */
export async function downloadMindmapPdf(map: MindMap, scale = 2): Promise<void> {
  const { canvas, widthPx, heightPx } = await rasterizeMindmap(map, scale);
  const widthIn = widthPx / PX_PER_INCH;
  const heightIn = heightPx / PX_PER_INCH;
  const { jsPDF } = await import("jspdf");
  const pdf = new jsPDF({
    unit: "in",
    format: [widthIn, heightIn],
    orientation: widthIn >= heightIn ? "landscape" : "portrait",
  });
  pdf.addImage(canvas.toDataURL("image/png"), "PNG", 0, 0, widthIn, heightIn);
  pdf.save(`${fileBase(map)}.pdf`);
}

function fileBase(map: MindMap): string {
  return (map.title || "mindmap").trim().replace(/[^\w\-]+/g, "_").slice(0, 60) || "mindmap";
}
