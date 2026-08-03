import { mindmapTreeRefusal } from "./validity.ts";
import type { MindNode } from "../../domain/mindmap.ts";

/**
 * Lifting the old browser-only map onto the server.
 *
 * ## Why this exists at all
 *
 * Mindmaps used to be one map per browser, under `cowork.mindmap.v1` in
 * `localStorage`. Making them server records is the right change and it strands
 * that map: it is still sitting in the browser, and nothing reads that key any
 * more. Deleting somebody's thinking as a side effect of an improvement is not
 * a trade anybody agreed to, so it is offered back to them once.
 *
 * **Offered, not migrated automatically.** An import that ran on its own would
 * put a map into a shared list without anybody asking — on a machine that might
 * be a spare desk, with a map that might be somebody else's. The list asks.
 *
 * ## Pictures, and the one thing that cannot come across
 *
 * The old map stored pasted pictures as base64 `dataUrl` bytes. One of those
 * fills a Firestore document on its own, so the engine refuses them outright —
 * correctly. But refusing the whole import over a picture would strand the map
 * for exactly the people who used it most.
 *
 * So the bytes are dropped and **the drop is reported**, which is the part that
 * makes it honest rather than lossy: `readLocalMindMap` returns how many
 * pictures were left behind so the screen can say so. A silent strip would have
 * somebody discover a year later that a card they remember illustrated is bare.
 */

/** The key the browser-only map was stored under. Read once, never written. */
export const LEGACY_MINDMAP_KEY = "cowork.mindmap.v1";

export interface LocalMindMap {
  title: string;
  nodes: MindNode[];
  /** Pictures dropped because they were browser bytes rather than uploads. */
  droppedImages: number;
}

/**
 * The stored map, or null if there is nothing worth offering.
 *
 * Null covers every uninteresting case together — no key, unreadable JSON, a
 * shape that is not a map, a tree that cannot be drawn — because they all mean
 * the same thing to the caller: do not offer an import. A corrupt value must
 * not surface as an error on a screen the person did not ask anything of.
 */
export function readLocalMindMap(raw: string | null): LocalMindMap | null {
  if (!raw) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;

  const map = parsed as { title?: unknown; nodes?: unknown };
  if (!Array.isArray(map.nodes) || map.nodes.length === 0) return null;

  let droppedImages = 0;
  const nodes: MindNode[] = [];
  for (const item of map.nodes) {
    if (!item || typeof item !== "object") return null;
    const n = item as Record<string, unknown>;
    if (typeof n.id !== "string" || !n.id) return null;

    const images = Array.isArray(n.images) ? n.images : [];
    const kept = [];
    for (const img of images) {
      if (!img || typeof img !== "object") continue;
      const i = img as Record<string, unknown>;
      /* An uploaded picture already lives in Drive and comes across intact. A
         byte picture cannot, and is counted rather than quietly discarded. */
      if (typeof i.fileId === "string" && i.fileId) {
        kept.push({
          id: typeof i.id === "string" ? i.id : "",
          name: typeof i.name === "string" ? i.name : "",
          fileId: i.fileId,
          url: typeof i.url === "string" ? i.url : null,
          sizeBytes: typeof i.sizeBytes === "number" ? i.sizeBytes : 0,
        });
      } else if (typeof i.dataUrl === "string" && i.dataUrl) {
        droppedImages += 1;
      }
    }

    nodes.push({
      id: n.id,
      parentId: typeof n.parentId === "string" && n.parentId ? n.parentId : null,
      title: typeof n.title === "string" ? n.title : "",
      description: typeof n.description === "string" ? n.description : "",
      links: Array.isArray(n.links)
        ? n.links
            .filter(
              (l): l is { id?: string; url: string; label?: string } =>
                !!l && typeof (l as { url?: unknown }).url === "string",
            )
            .map((l) => ({
              id: typeof l.id === "string" ? l.id : l.url.slice(0, 40),
              url: l.url,
              label: typeof l.label === "string" ? l.label : "",
            }))
        : [],
      images: kept,
      collapsed: n.collapsed === true,
    });
  }

  /* Checked with the rule the engine checks it with, so an unimportable map is
     never offered. Being told "import" and then refused is worse than not being
     offered: the offer is the only evidence the old map still exists. */
  if (mindmapTreeRefusal(nodes)) return null;

  const title =
    typeof map.title === "string" && map.title.trim()
      ? map.title.trim()
      : "Imported mindmap";

  return { title, nodes, droppedImages };
}

/**
 * What to say once the import has landed.
 *
 * A sentence rather than a count on its own, because "3" beside a tick does not
 * tell somebody they have three cards to re-illustrate.
 */
export function importSummary(dropped: number): string {
  if (dropped === 0)
    return "Your mindmap from this browser has been imported and is now stored with your account.";
  return (
    `Your mindmap from this browser has been imported. ` +
    `${dropped === 1 ? "One picture" : `${dropped} pictures`} could not come across, ` +
    `because ${dropped === 1 ? "it was" : "they were"} saved inside the browser rather than uploaded — ` +
    `attach ${dropped === 1 ? "it" : "them"} again on the card and ${dropped === 1 ? "it" : "they"} will follow the map to everyone who can see it.`
  );
}
