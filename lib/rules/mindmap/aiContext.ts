/**
 * What the mindmap canvas sends Gemini — the visible tree as a compact
 * outline, never the raw node array.
 *
 * Mirrors `lib/rules/documents/aiContext.ts`: this module does not read the
 * canvas or the store. It takes the `MindMap` the caller already has and
 * walks it with the SAME tree walk `tree.ts` uses for layout
 * (`childrenOf`/`rootOf`) rather than a second, possibly-divergent one.
 *
 * ## Why real ids are in the outline
 *
 * `add_child_nodes` and `reorganize_nodes` both take node ids as arguments —
 * Gemini has no other way to point at a card. Leaving ids out of the context
 * (the way Docs context never sends a Tiptap position) would make both tools
 * unusable, so every line of the outline carries the id it names.
 */

const MAX_NODES = 300;
const MAX_TITLE_CHARS = 200;

/** Cuts to a character budget, same rule `aiContext.ts` uses for Docs. */
function clamp(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  const trimmed = lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut;
  return `${trimmed}…`;
}

export interface MindmapContextInput {
  map: { nodes: { id: string; parentId: string | null; title: string }[] };
  /** The card selected on the canvas, if any — the implicit parent/target when the instruction names none. */
  selectedNodeId: string | null;
}

/**
 * Serialise the visible tree as an indented outline: `id: title`, one line
 * per card, depth-indented, in the same order `layoutMap` would draw them —
 * a parent immediately followed by its children.
 *
 * Bounded at `MAX_NODES` cards so a very large map still fits the context
 * budget `protocol.ts` enforces; a map beyond that is walked in layout order
 * so the cards nearest the root — the ones most likely relevant — are the
 * ones that survive the cut.
 */
export function buildMindmapContext(input: MindmapContextInput): string {
  const { map, selectedNodeId } = input;
  const byParent = new Map<string | null, { id: string; parentId: string | null; title: string }[]>();
  for (const node of map.nodes) {
    const siblings = byParent.get(node.parentId) ?? [];
    siblings.push(node);
    byParent.set(node.parentId, siblings);
  }

  const root = map.nodes.find((n) => n.parentId === null) ?? null;
  const lines: string[] = [];
  let truncated = false;

  const walk = (node: { id: string; parentId: string | null; title: string }, depth: number) => {
    if (lines.length >= MAX_NODES) {
      truncated = true;
      return;
    }
    const title = clamp(node.title.trim() || "(untitled)", MAX_TITLE_CHARS);
    lines.push(`${"  ".repeat(depth)}${node.id}: ${title}`);
    const children = byParent.get(node.id) ?? [];
    for (const child of children) walk(child, depth + 1);
  };

  if (root) walk(root, 0);

  const parts: string[] = [];
  if (lines.length > 0) {
    const note = truncated ? ` (truncated at ${MAX_NODES} cards)` : "";
    parts.push(`Mindmap outline, each line "id: title"${note}:\n${lines.join("\n")}`);
  } else {
    parts.push("This map has no root card.");
  }

  parts.push(
    selectedNodeId
      ? `Currently selected card: ${selectedNodeId}`
      : "No card is currently selected.",
  );

  return parts.join("\n\n");
}
