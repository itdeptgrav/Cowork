"use client";

import type { MindMap } from "./tree.ts";
import { mapToMarkdown, mapToOpml, mapToText, mapToFreeMind } from "./textio.ts";

/**
 * The text exports, as downloads. The formats themselves live in `textio.ts`
 * and are tested there; this file only names files and hands bytes to the
 * browser, which is the part a test cannot reach.
 *
 * Every text export carries the WHOLE map — folded branches included — for the
 * same reason the image exports do (see exportImage.ts): the file is the
 * document, not the view of it.
 */

function download(text: string, filename: string, type: string): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function fileBase(map: MindMap): string {
  return (map.title || "mindmap").trim().replace(/[^\w\-]+/g, "_").slice(0, 60) || "mindmap";
}

export function downloadMindmapMarkdown(map: MindMap): void {
  download(mapToMarkdown(map), `${fileBase(map)}.md`, "text/markdown;charset=utf-8");
}

export function downloadMindmapOpml(map: MindMap): void {
  download(mapToOpml(map), `${fileBase(map)}.opml`, "text/x-opml;charset=utf-8");
}

/** FreeMind / Freeplane's `.mm`, which XMind and MindMeister also open. */
export function downloadMindmapFreeMind(map: MindMap): void {
  download(mapToFreeMind(map), `${fileBase(map)}.mm`, "application/x-freemind;charset=utf-8");
}

export function downloadMindmapText(map: MindMap): void {
  download(mapToText(map), `${fileBase(map)}.txt`, "text/plain;charset=utf-8");
}

/** Copy the outline to the clipboard — for pasting into a document or a chat. */
export async function copyMindmapMarkdown(map: MindMap): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(mapToMarkdown(map));
    return true;
  } catch {
    return false;
  }
}
