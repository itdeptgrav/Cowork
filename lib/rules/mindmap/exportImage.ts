"use client";

import { childrenOf, extrasOf, NODE_H, NODE_W, type MindMap } from "./tree.ts";
import { connectorPathFor, layoutMapAs } from "./layouts.ts";
import { fontSizeOf, priorityMarker, radiusOf, textOn, themeOf } from "./theme.ts";
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
  const kind = extrasOf(map).settings.layout;
  const layout = layoutMapAs(map, kind);
  const width = Math.max(1, layout.width);
  const height = Math.max(1, layout.height);

  /* The theme decides every colour, exactly as on the canvas. The default
     theme still reads the page's own tokens so a dark-mode export looks like
     dark mode; every other theme carries its own colours. */
  const theme = themeOf(extrasOf(map).settings.theme);
  const isField = theme.id === "field";
  const bg = isField ? cssVar("--body-bg", "#cfcfcf") : theme.card === "#1e1f26" ? "#121318" : "#fafafa";
  const card = isField ? cssVar("--frost-panel", "rgb(238, 238, 240)") : theme.card;
  const hairline = isField ? cssVar("--hairline", "rgba(10, 10, 10, 0.12)") : theme.line;
  const ink = isField ? cssVar("--ink", "#0a0a0a") : theme.text;
  const depthColors = isField
    ? DEPTH_VARS_WITH_FALLBACK.map(([name, fallback]) => cssVar(name, fallback))
    : theme.depths;
  const accent = (node: MindMap["nodes"][number], depth: number) =>
    node.style?.fill || depthColors[depth % depthColors.length];

  const connectors = layout.placed
    .flatMap((p) =>
      (p.node.collapsed ? [] : childrenOf(map, p.node.id)).map((c) => {
        const child = layout.byId.get(c.id);
        if (!child) return "";
        const stroke = isField && !c.style?.fill ? hairline : accent(c, child.depth);
        const opacity = isField && !c.style?.fill ? 1 : 0.55;
        return `<path d="${connectorPathFor(kind, p, child)}" fill="none" stroke="${stroke}" stroke-opacity="${opacity}" stroke-width="1.5" />`;
      }),
    )
    .join("");

  const nodes = layout.placed
    .map((p) => {
      const hue = accent(p.node, p.depth);
      const style = p.node.style;
      const filled = Boolean(style?.fill);
      const text = style?.text ?? (filled ? textOn(style?.fill, theme) : ink);
      const rx = radiusOf(style, NODE_H);
      const size = fontSizeOf(style);
      const weight = style?.bold ? "600" : "400";
      const decoration = [style?.underline ? "underline" : "", style?.strike ? "line-through" : ""].filter(Boolean).join(" ");
      const slant = style?.italic ? "italic" : "normal";
      const prefix = p.node.icon ? `${p.node.icon} ` : "";
      const label = escapeXml(truncate(prefix + p.node.title, size > 14 ? 26 : 34));
      const underline = style?.shape === "underline";
      const box = underline
        ? `<line x1="0" y1="${NODE_H - 1}" x2="${NODE_W}" y2="${NODE_H - 1}" stroke="${hue}" stroke-width="2" />`
        : `<rect width="${NODE_W}" height="${NODE_H}" rx="${rx}" fill="${filled ? style!.fill : card}" stroke="${hairline}" />` +
          (filled ? "" : `<rect width="3" height="${NODE_H}" rx="1.5" fill="${hue}" />`);
      const marker = p.node.priority
        ? `<circle cx="${NODE_W - 2}" cy="2" r="8" fill="${priorityMarker(p.node.priority).colour}" /><text x="${NODE_W - 2}" y="2.5" text-anchor="middle" dominant-baseline="middle" font-family="system-ui, sans-serif" font-size="9" font-weight="600" fill="#fff">${p.node.priority}</text>`
        : "";
      const progress =
        p.node.progress !== undefined && p.node.progress !== null
          ? `<circle cx="${NODE_W - (p.node.priority ? 22 : 2)}" cy="2" r="6" fill="${card}" stroke="${hue}" stroke-opacity="0.3" stroke-width="2.5" /><circle cx="${NODE_W - (p.node.priority ? 22 : 2)}" cy="2" r="6" fill="none" stroke="${hue}" stroke-width="2.5" stroke-dasharray="${(p.node.progress / 100) * 37.7} 37.7" transform="rotate(-90 ${NODE_W - (p.node.priority ? 22 : 2)} 2)" />`
          : "";
      return `<g transform="translate(${p.x}, ${p.y})">
        ${box}
        <text x="${filled || underline ? 12 : 16}" y="${NODE_H / 2}" dominant-baseline="middle" font-family="system-ui, sans-serif" font-size="${size}" font-weight="${weight}" font-style="${slant}" fill="${text}">${label}</text>
        ${marker}${progress}
      </g>`;
    })
    .join("");

  /* ── Boundaries, summaries and relationships — the same geometry the canvas
     draws, so the file shows what the screen showed. Boundaries go under the
     tree, the other two over it. */
  const extras = extrasOf(map);
  const pad = 14;

  const boxOf = (ids: Iterable<string>) => {
    let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
    for (const id of ids) {
      const p = layout.byId.get(id);
      if (!p) continue;
      x1 = Math.min(x1, p.x);
      y1 = Math.min(y1, p.y);
      x2 = Math.max(x2, p.x + NODE_W);
      y2 = Math.max(y2, p.y + NODE_H);
    }
    return Number.isFinite(x1) ? { x: x1, y: y1, w: x2 - x1, h: y2 - y1 } : null;
  };
  const subtree = (id: string): string[] => {
    const out = [id];
    for (let i = 0; i < out.length; i++)
      for (const n of map.nodes) if (n.parentId === out[i]) out.push(n.id);
    return out;
  };

  const boundaries = extras.boundaries
    .map((b) => {
      const box = boxOf(subtree(b.nodeId));
      const owner = layout.byId.get(b.nodeId);
      if (!box || !owner) return "";
      const colour = b.color ?? accent(owner.node, owner.depth);
      const label = b.label
        ? `<text x="${box.x - pad + 12}" y="${box.y - pad - 6}" font-family="system-ui, sans-serif" font-size="11" fill="${colour}">${escapeXml(b.label)}</text>`
        : "";
      return `<rect x="${box.x - pad}" y="${box.y - pad}" width="${box.w + pad * 2}" height="${box.h + pad * 2}" rx="18" fill="${colour}" fill-opacity="0.1" stroke="${colour}" stroke-opacity="0.55" stroke-width="1.2" stroke-dasharray="6 4" />${label}`;
    })
    .join("");

  const summaries = extras.summaries
    .map((s) => {
      const owner = layout.byId.get(s.nodeId);
      const kids = map.nodes.filter((n) => n.parentId === s.nodeId && layout.byId.has(n.id));
      if (!owner || kids.length === 0) return "";
      const box = boxOf(kids.flatMap((k) => subtree(k.id)));
      if (!box) return "";
      const colour = accent(owner.node, owner.depth);
      const gap = 10;
      const down = owner.side === "down";
      const left = owner.side === "left";
      const path = down
        ? `M ${box.x} ${box.y + box.h + gap} q 0 8 8 8 h ${box.w / 2 - 12} q 4 0 4 4 q 0 -4 4 -4 h ${box.w / 2 - 12} q 8 0 8 -8`
        : left
          ? `M ${box.x - gap} ${box.y} q -8 0 -8 8 v ${box.h / 2 - 12} q 0 4 -4 4 q 4 0 4 4 v ${box.h / 2 - 12} q 0 8 8 8`
          : `M ${box.x + box.w + gap} ${box.y} q 8 0 8 8 v ${box.h / 2 - 12} q 0 4 4 4 q -4 0 -4 4 v ${box.h / 2 - 12} q 0 8 -8 8`;
      const tx = down ? box.x + box.w / 2 : left ? box.x - gap - 22 : box.x + box.w + gap + 22;
      const ty = down ? box.y + box.h + gap + 26 : box.y + box.h / 2;
      const anchor = down ? "middle" : left ? "end" : "start";
      return `<path d="${path}" fill="none" stroke="${colour}" stroke-width="1.5" /><text x="${tx}" y="${ty}" text-anchor="${anchor}" dominant-baseline="middle" font-family="system-ui, sans-serif" font-size="11.5" fill="${ink}">${escapeXml(s.text || "Summary")}</text>`;
    })
    .join("");

  const relations = extras.relations
    .map((r) => {
      const a = layout.byId.get(r.from);
      const b = layout.byId.get(r.to);
      if (!a || !b) return "";
      const ax = a.x + NODE_W / 2, ay = a.y + NODE_H / 2, bx = b.x + NODE_W / 2, by = b.y + NODE_H / 2;
      const sx = bx > ax ? a.x + NODE_W : bx < ax ? a.x : ax;
      const sy = Math.abs(bx - ax) > NODE_W ? ay : by > ay ? a.y + NODE_H : a.y;
      const ex = ax > bx ? b.x + NODE_W : ax < bx ? b.x : bx;
      const ey = Math.abs(bx - ax) > NODE_W ? by : ay > by ? b.y + NODE_H : b.y;
      const dx = ex - sx, dy = ey - sy, len = Math.hypot(dx, dy) || 1;
      const bulge = r.line === "straight" ? 0 : Math.min(60, len * 0.2);
      const cx = (sx + ex) / 2 - (dy / len) * bulge;
      const cy = (sy + ey) / 2 + (dx / len) * bulge;
      const lx = 0.25 * sx + 0.5 * cx + 0.25 * ex;
      const ly = 0.25 * sy + 0.5 * cy + 0.25 * ey;
      const colour = r.color ?? (isField ? cssVar("--color-ink-muted", "#5a5a5a") : theme.text);
      const text = r.label || "…";
      const w = text.length * 6.8 + 20;
      return `<path d="M ${sx} ${sy} Q ${cx} ${cy} ${ex} ${ey}" fill="none" stroke="${colour}" stroke-width="1.5" stroke-dasharray="5 4" marker-end="url(#mind-arrow)" /><rect x="${lx - w / 2}" y="${ly - 9}" width="${w}" height="18" rx="9" fill="${card}" stroke="${colour}" stroke-width="1" /><text x="${lx}" y="${ly}" text-anchor="middle" dominant-baseline="middle" font-family="system-ui, sans-serif" font-size="11" fill="${ink}">${escapeXml(text)}</text>`;
    })
    .join("");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
    <title>${escapeXml(map.title || "Mindmap")}</title>
    <defs><marker id="mind-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="${ink}" /></marker></defs>
    <rect width="${width}" height="${height}" fill="${bg}" />
    ${boundaries}
    ${connectors}
    ${nodes}
    ${summaries}
    ${relations}
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
  const layout = layoutMapAs(fullyExpanded(map), extrasOf(map).settings.layout);
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
