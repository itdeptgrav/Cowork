/**
 * Dragging files onto a conversation.
 *
 * Two small rules, both here rather than inline in a component, because both
 * are the kind of thing that looks obviously right and is obviously wrong the
 * moment a real drag happens.
 */

/**
 * Whether a drag is carrying FILES, as opposed to text or a link.
 *
 * `dataTransfer.files` is deliberately **empty during a drag** — the browser
 * does not hand over the contents until the drop, so a component that checks
 * `files.length` on `dragover` concludes there are none and never shows its
 * drop zone. `types` is the only thing readable mid-drag, and `"Files"` is the
 * entry that means what it says.
 *
 * This is also what stops the overlay appearing when somebody drags a selected
 * sentence across the thread, or a link from another tab — those carry
 * `text/plain` and `text/uri-list` and nothing else, and dropping them should
 * do what it always did.
 */
export function dragCarriesFiles(
  types: readonly string[] | undefined | null,
): boolean {
  if (!types) return false;
  return Array.from(types).includes("Files");
}

/**
 * How deep into the drop zone the pointer is, counted across children.
 *
 * **The bug this exists to prevent.** `dragenter` and `dragleave` fire for every
 * element the pointer crosses, not just the one the handler is on. A boolean
 * set true on enter and false on leave therefore flickers off the instant the
 * pointer moves over a message bubble INSIDE the drop zone — the overlay
 * strobes as somebody drags across the thread, and worse, it is usually
 * "off" at the moment they release.
 *
 * Counting enters against leaves is the fix: crossing into a child raises the
 * depth before the parent's leave lowers it, so the total never touches zero
 * until the pointer genuinely leaves.
 *
 * Clamped at zero: a drag that begins outside the window and ends inside it can
 * deliver a `dragleave` with no matching `dragenter`, and a negative depth
 * would then need two real entries before the zone lit up again.
 */
export function dragDepth(current: number, event: "enter" | "leave" | "drop"): number {
  /* A drop ends the drag outright, whatever the count had reached — the
     browser sends no final `dragleave` for the element that received it. */
  if (event === "drop") return 0;
  const next = event === "enter" ? current + 1 : current - 1;
  return Math.max(0, next);
}

/** Whether the drop zone should be showing itself. */
export function isDropActive(depth: number): boolean {
  return depth > 0;
}
