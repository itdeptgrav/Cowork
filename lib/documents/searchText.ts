import type { Node as ProseMirrorNode } from "@tiptap/pm/model";

/**
 * The document as one string, with a way back to document positions.
 *
 * Find-and-replace needs to search across text nodes: `he**ll**o` is three
 * nodes and one word, and a search that could not see it as one word would fail
 * on exactly the text somebody has been formatting. So the text is flattened
 * once, and every run records where it came from.
 *
 * Blocks are separated by a single newline. One character, not two, because the
 * index arithmetic has to stay reversible — and because a query typed into a
 * one-line field can never contain a newline, a match can never span the
 * boundary and be mapped to the wrong block.
 */

export interface TextRun {
  /** Index of this run's first character in the flattened string. */
  start: number;
  /** Document position of that same character. */
  pos: number;
  length: number;
}

export interface FlatText {
  text: string;
  runs: TextRun[];
}

export function flattenDocument(doc: ProseMirrorNode): FlatText {
  let text = "";
  const runs: TextRun[] = [];

  doc.nodesBetween(0, doc.content.size, (node, pos) => {
    if (node.isText && node.text) {
      runs.push({ start: text.length, pos, length: node.text.length });
      text += node.text;
      return false;
    }
    /* A block boundary, written once — nested blocks (a list item inside a
       list) must not each contribute a newline, or the offsets drift by one
       for everything after them. */
    if (node.isBlock && text.length > 0 && !text.endsWith("\n")) text += "\n";
    return true;
  });

  return { text, runs };
}

/**
 * A flattened index back to a document position.
 *
 * The run it belongs to is the LAST one that starts at or before it: an index
 * sitting exactly at the end of a run is the end of that run, not the start of
 * whatever comes next, and getting that backwards puts a replacement one
 * character into the following paragraph.
 */
export function positionOf(runs: readonly TextRun[], index: number): number | null {
  if (runs.length === 0) return null;
  let low = 0;
  let high = runs.length - 1;
  let found = -1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if (runs[mid].start <= index) {
      found = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  if (found === -1) return null;
  const run = runs[found];
  return run.pos + (index - run.start);
}
