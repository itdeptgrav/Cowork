/**
 * The document outline — the headings, as a navigable list.
 *
 * ## Why depth is not the heading level
 *
 * A document that opens with a Heading 1 and then uses Heading 3 for everything
 * under it is not badly written — it is common, because people pick heading
 * styles by how they look. Indenting by the raw level would show that document
 * as a first item and then a column of things two steps in from nothing, which
 * reads as broken structure rather than as the flat list it actually is.
 *
 * So depth is the position in the ANCESTOR STACK, not the level: each heading
 * sits one step in from the nearest heading above it with a smaller level. That
 * is the same rule a table of contents uses, and it is why the outline of a
 * sloppily-styled document still looks like an outline.
 *
 * ## Empty headings are not listed
 *
 * A heading you have just created and not typed into has no text. Listing it
 * would put a blank row in the sidebar that cannot be labelled and cannot be
 * usefully clicked. It appears as soon as it says something.
 */

export interface OutlineHeading {
  /** ProseMirror document position, for scroll-to and for identity. */
  pos: number;
  /** 1–6, as authored. */
  level: number;
  text: string;
}

export interface OutlineRow extends OutlineHeading {
  /** Steps of indentation. The first heading is always 0, whatever its level. */
  depth: number;
}

export function outlineRows(headings: readonly OutlineHeading[]): OutlineRow[] {
  const rows: OutlineRow[] = [];
  /* The levels of the headings this one sits under, smallest first. */
  const stack: number[] = [];

  for (const h of headings) {
    const text = h.text.trim();
    if (!text) continue;
    while (stack.length > 0 && stack[stack.length - 1] >= h.level) stack.pop();
    rows.push({ pos: h.pos, level: h.level, text, depth: stack.length });
    stack.push(h.level);
  }
  return rows;
}

/**
 * Which heading the reader is currently under, given a scroll position.
 *
 * The LAST heading at or above the line — not the nearest, which would jump the
 * highlight forward to a section that is still off screen the moment its title
 * came within a few pixels of the top.
 */
export function activeHeading(
  rows: readonly OutlineRow[],
  offsets: ReadonlyMap<number, number>,
  scrollTop: number,
): number | null {
  let active: number | null = null;
  for (const row of rows) {
    const top = offsets.get(row.pos);
    if (top === undefined) continue;
    /* A small allowance, or the heading sitting exactly at the top edge is
       counted as still ahead of the reader. */
    if (top - 8 <= scrollTop) active = row.pos;
    else break;
  }
  return active;
}
