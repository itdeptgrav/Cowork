"use client";

/**
 * How many people are in this document, sheet or mindmap.
 *
 * The count and not the names: awareness carries a display name per caret and
 * the carets already show them where the work is happening. A second list of the
 * same names in the header is the same fact twice.
 *
 * Lifted out of `DocumentEditor` when mindmaps started collaborating. The dot is
 * the part that has to stay identical everywhere — it is the one thing on screen
 * that says "what you are looking at is current", and a person who has learned
 * to trust it in a document has to be able to trust it in a map.
 */
export function Presence({ peers }: { peers: number }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full bg-[var(--control)] px-2 py-0.5 text-[10px] text-ink-muted"
      title="Live collaboration is on"
    >
      <span
        aria-hidden="true"
        className="h-1.5 w-1.5 rounded-full"
        style={{ background: "var(--state-positive)" }}
      />
      {peers > 0 ? (
        <>
          <span data-figure>{peers + 1}</span> editing
        </>
      ) : (
        "Live"
      )}
    </span>
  );
}
