/**
 * The spreadsheet toolbar's icons.
 *
 * Same drawing conventions as the app's shared set (`components/ui/Icons.tsx`):
 * a 16px box, no fill, `currentColor` at 1.5 stroke, round caps and joins — so
 * these sit with Geist at the same weight as every other icon in Cowork and
 * inherit whatever colour their button gives them. They live HERE rather than in
 * the shared file because they are feature-specific and numerous; the shared set
 * is the app's navigation vocabulary and should not carry fifteen spreadsheet
 * glyphs that only one screen uses.
 *
 * The SHAPES follow the conventions every spreadsheet shares — stacked lines
 * ragged on the side they align to, a funnel for filter, a grid for borders,
 * A→Z for sort. That is what makes a toolbar read as a spreadsheet at a glance,
 * and it is the part that is common vocabulary rather than anyone's artwork.
 * Microsoft's own Office icons are proprietary and are deliberately not used or
 * traced here.
 *
 * Note what is NOT here: bold, italic, underline and strikethrough. Every
 * spreadsheet and word processor draws those as LETTERFORMS ("B", "I", "U"),
 * which the toolbar already renders as text — an icon would be a worse version
 * of the thing it replaced.
 */

type P = { className?: string };

function S({ children, className = "" }: P & { children: React.ReactNode }) {
  return (
    <svg
      viewBox="0 0 16 16"
      className={`h-4 w-4 shrink-0 ${className}`}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

export const SheetIcon = {
  /* Horizontal alignment — four stacked lines, ragged on the free side so the
     icon shows which edge the text is pulled to. */
  alignLeft: (p: P) => (
    <S {...p}>
      <path d="M2.5 3.5h11" />
      <path d="M2.5 6.8h7" />
      <path d="M2.5 10.1h11" />
      <path d="M2.5 13.4h7" />
    </S>
  ),
  alignCenter: (p: P) => (
    <S {...p}>
      <path d="M2.5 3.5h11" />
      <path d="M4.5 6.8h7" />
      <path d="M2.5 10.1h11" />
      <path d="M4.5 13.4h7" />
    </S>
  ),
  alignRight: (p: P) => (
    <S {...p}>
      <path d="M2.5 3.5h11" />
      <path d="M6.5 6.8h7" />
      <path d="M2.5 10.1h11" />
      <path d="M6.5 13.4h7" />
    </S>
  ),

  /* Vertical alignment — a solid edge the content is pushed against, with the
     content shown as two short bars beside it. */
  alignTop: (p: P) => (
    <S {...p}>
      <path d="M2.5 2.5h11" />
      <path d="M5.5 5v6" />
      <path d="M10.5 5v3.5" />
    </S>
  ),
  alignMiddle: (p: P) => (
    <S {...p}>
      <path d="M2.5 8h11" />
      <path d="M5.5 4v8" />
      <path d="M10.5 5.5v5" />
    </S>
  ),
  alignBottom: (p: P) => (
    <S {...p}>
      <path d="M2.5 13.5h11" />
      <path d="M5.5 5v6" />
      <path d="M10.5 7.5v3.5" />
    </S>
  ),

  /** Wrap text — a line that runs on, turns, and comes back with an arrowhead. */
  wrap: (p: P) => (
    <S {...p}>
      <path d="M2.5 4h11" />
      <path d="M2.5 8h8.5a2.5 2.5 0 0 1 0 5H8.5" />
      <path d="M10 11l-1.8 2 1.8 2" />
      <path d="M2.5 12h3" />
    </S>
  ),

  /** Merge cells — two cells with the wall between them opening outward. */
  merge: (p: P) => (
    <S {...p}>
      <rect x="2" y="4" width="12" height="8" rx="1.2" />
      <path d="M8 4v2.2" />
      <path d="M8 9.8V12" />
      <path d="M4.6 8h2.2" />
      <path d="M9.2 8h2.2" />
    </S>
  ),

  /** Borders — a four-cell grid, the outer edge carried by the box. */
  borders: (p: P) => (
    <S {...p}>
      <rect x="2" y="2.5" width="12" height="11" rx="1.2" />
      <path d="M8 2.5v11" />
      <path d="M2 8h12" />
    </S>
  ),

  /** Fill colour — a tipped paint bucket, the way every editor draws it. */
  fillColor: (p: P) => (
    <S {...p}>
      <path d="M6.6 2.2l5.6 5.6a1 1 0 0 1 0 1.4l-3.6 3.6a1.4 1.4 0 0 1-2 0L3.4 9.6a1 1 0 0 1 0-1.4L6.6 5" />
      <path d="M3.6 8.4h8.8" />
      <path d="M14 11.4c0 .8-.6 1.4-1.3 1.4S11.4 12.2 11.4 11.4 12.7 9.2 12.7 9.2s1.3 1.4 1.3 2.2z" />
    </S>
  ),

  /** Text colour — an "A" over the bar that carries the colour swatch. */
  textColor: (p: P) => (
    <S {...p}>
      <path d="M3.6 10.5L7 3.2l3.4 7.3" />
      <path d="M4.8 8.2h4.4" />
      <path d="M2.5 13.5h11" />
    </S>
  ),

  /** More / fewer decimal places — a decimal point with the digits beside it. */
  decimalMore: (p: P) => (
    <S {...p}>
      <path d="M2.6 12.4h.01" />
      <path d="M5.4 6.5h2.2v5.9H5.4z" />
      <path d="M11.4 3.4v4.4" />
      <path d="M9.2 5.6h4.4" />
    </S>
  ),
  decimalLess: (p: P) => (
    <S {...p}>
      <path d="M2.6 12.4h.01" />
      <path d="M5.4 6.5h2.2v5.9H5.4z" />
      <path d="M9.2 5.6h4.4" />
    </S>
  ),

  /** Sort — the A→Z convention, with the arrow showing the direction. */
  sortAsc: (p: P) => (
    <S {...p}>
      <path d="M4.2 13V3.6" />
      <path d="M1.8 6l2.4-2.4L6.6 6" />
      <path d="M9 5.4h4.6" />
      <path d="M9 8.6h3.2" />
      <path d="M9 11.8h1.8" />
    </S>
  ),
  sortDesc: (p: P) => (
    <S {...p}>
      <path d="M4.2 3.6V13" />
      <path d="M1.8 10.6l2.4 2.4 2.4-2.4" />
      <path d="M9 5.4h1.8" />
      <path d="M9 8.6h3.2" />
      <path d="M9 11.8h4.6" />
    </S>
  ),

  /** Filter — a funnel, the one shape every spreadsheet agrees on. */
  filter: (p: P) => (
    <S {...p}>
      <path d="M2.4 3.4h11.2l-4.3 5.1v4.6l-2.6-1.5V8.5z" />
    </S>
  ),

  /** Find — a magnifier, the one shape every editor agrees on. */
  find: (p: P) => (
    <S {...p}>
      <circle cx="7" cy="7" r="4.3" />
      <path d="M10.2 10.2l3.3 3.3" />
    </S>
  ),

  /** Freeze panes — a grid whose first row and column are held. */
  freeze: (p: P) => (
    <S {...p}>
      <rect x="2" y="2.5" width="12" height="11" rx="1.2" />
      <path d="M2 6.2h12" />
      <path d="M6.2 2.5v11" />
    </S>
  ),
};
