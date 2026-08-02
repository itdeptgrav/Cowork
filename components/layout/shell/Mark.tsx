/**
 * The Cowork mark — the folder-and-check brand logo.
 *
 * A layered folder: a cream back (tab + body), a purple sheet tilted out of it,
 * and a black rounded front carrying the white check. Unlike the old monochrome
 * slab it is FULL-COLOUR and fixed, so it reads the same on every surface and
 * does not take `currentColor`. `className` still controls only its size, and the
 * geometry is mirrored in `app/icon.svg` (the favicon) so the two never drift.
 */
export function Mark({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 1000 1000"
      className={className}
      role="img"
      aria-label="Cowork"
      fill="none"
    >
      {/* Cream folder — the back tab, then the body. */}
      <path d="M0 60A60 60 0 0 1 60 0H500A60 60 0 0 1 560 60V150H0Z" fill="#F6E3A0" />
      <rect x="0" y="175" width="1000" height="760" rx="150" fill="#F6E3A0" />
      {/* Purple sheet, tilted out of the folder. */}
      <rect
        x="10"
        y="290"
        width="980"
        height="560"
        rx="150"
        transform="rotate(-7 500 520)"
        fill="#9B82F0"
      />
      {/* Black rounded front, carrying the check. */}
      <rect x="0" y="500" width="945" height="500" rx="215" fill="#0B0B0F" />
      <path
        d="M150 780L270 895L480 655"
        fill="none"
        stroke="#FFFFFF"
        strokeWidth="72"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
