/**
 * The Cowork mark.
 *
 * It is the stepped slab silhouette at 20px — the same geometry as every score
 * card, so the identity and the product's signature shape are literally one
 * shape. Two forms read in it: the step of a rising measure, and two surfaces
 * sharing one edge.
 *
 * Drawn as a path rather than composed like the CSS card because at this scale
 * a fixed viewBox has no aspect-ratio distortion to worry about.
 */
export function Mark({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      role="img"
      aria-label="Cowork"
      fill="none"
    >
      {/* Stepped slab: high across the left, stepping down at 71% through a
          convex radius and a concave fillet, matching SlabCard. */}
      <path
        d="M4.4 1h8.2a3.4 3.4 0 0 1 3.4 3.4 3.4 3.4 0 0 0 3.4 3.4A3.4 3.4 0 0 1 22.8 11.2v8.4A3.4 3.4 0 0 1 19.4 23H4.4A3.4 3.4 0 0 1 1 19.6V4.4A3.4 3.4 0 0 1 4.4 1Z"
        fill="currentColor"
      />
      {/* The tab's identity slot, knocked out — the same hole the avatar fills
          on a score card. */}
      <circle
        cx="8.1"
        cy="8.1"
        r="2.5"
        fill="var(--color-frost-bar, #fafafa)"
      />
    </svg>
  );
}
