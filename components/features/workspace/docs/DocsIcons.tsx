/**
 * Editor glyphs.
 *
 * Separate from `components/ui/Icons` on purpose: that set is the product's
 * navigation vocabulary — seven tabs and a row-action menu — and a word
 * processor's toolbar needs thirty marks that mean nothing anywhere else in the
 * app. Mixing them would make the shared set a dumping ground and make it
 * unclear which glyphs are load-bearing for navigation.
 *
 * Same construction as that set so they sit together: 16px box, 1.5 stroke,
 * `currentColor`, no colour of their own.
 */

type P = { className?: string };
const base = "h-4 w-4 shrink-0";

function S({ children, className = "" }: P & { children: React.ReactNode }) {
  return (
    <svg
      viewBox="0 0 16 16"
      className={`${base} ${className}`}
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

/** Alignment marks share one body — the bar widths are the whole message. */
function Bars({ widths, anchor }: { widths: number[]; anchor: "start" | "center" | "end" }) {
  return (
    <S>
      {widths.map((w, i) => {
        const y = 3.5 + i * 2.4;
        const x1 = anchor === "start" ? 2.5 : anchor === "center" ? 8 - w / 2 : 13.5 - w;
        return <path key={i} d={`M${x1} ${y}h${w}`} />;
      })}
    </S>
  );
}

export const DocIcon = {
  search: (p: P) => (
    <S {...p}>
      <circle cx="7" cy="7" r="4.2" />
      <path d="M10.2 10.2L13.5 13.5" />
    </S>
  ),
  undo: (p: P) => (
    <S {...p}>
      <path d="M3 7.5h6.2a3.3 3.3 0 010 6.6H6" />
      <path d="M5.4 4.6L2.6 7.5l2.8 2.9" />
    </S>
  ),
  redo: (p: P) => (
    <S {...p}>
      <path d="M13 7.5H6.8a3.3 3.3 0 000 6.6H10" />
      <path d="M10.6 4.6l2.8 2.9-2.8 2.9" />
    </S>
  ),
  print: (p: P) => (
    <S {...p}>
      <path d="M4.5 6V2.6h7V6" />
      <rect x="2.2" y="6" width="11.6" height="5" rx="1.4" />
      <rect x="4.5" y="9.4" width="7" height="4" rx="0.8" />
    </S>
  ),
  spellcheck: (p: P) => (
    <S {...p}>
      <path d="M2 11.2L5 3.6l3 7.6" />
      <path d="M3 8.8h4" />
      <path d="M9.2 9.6l2 2 3.3-4.6" />
    </S>
  ),
  paint: (p: P) => (
    <S {...p}>
      <rect x="2.4" y="2.4" width="9" height="4" rx="1.2" />
      <path d="M11.4 4.4h1.6a1 1 0 011 1v2a1 1 0 01-1 1H7.4" />
      <rect x="6" y="9.4" width="3" height="4.2" rx="1" />
    </S>
  ),
  textColor: (p: P) => (
    <S {...p}>
      <path d="M3.6 10.4L6.9 2.8l3.3 7.6" />
      <path d="M4.7 7.9h4.4" />
      <path d="M2.6 13.4h10.8" strokeWidth="2.2" />
    </S>
  ),
  highlight: (p: P) => (
    <S {...p}>
      <path d="M4.6 9.6l4.8-4.8 2.2 2.2-4.8 4.8H4.6z" />
      <path d="M9.6 3.4l1.4-1.4 2.2 2.2-1.4 1.4" />
      <path d="M2.6 13.6h10.8" strokeWidth="2.2" />
    </S>
  ),
  link: (p: P) => (
    <S {...p}>
      <path d="M6.6 9.4a2.6 2.6 0 010-3.7l2-2a2.6 2.6 0 013.7 3.7l-1 1" />
      <path d="M9.4 6.6a2.6 2.6 0 010 3.7l-2 2a2.6 2.6 0 01-3.7-3.7l1-1" />
    </S>
  ),
  image: (p: P) => (
    <S {...p}>
      <rect x="2.2" y="3" width="11.6" height="10" rx="1.6" />
      <circle cx="5.8" cy="6.4" r="1.1" />
      <path d="M2.6 11.4l3.2-3.1 2.4 2.3 2-1.9 3.4 3.1" />
    </S>
  ),
  table: (p: P) => (
    <S {...p}>
      <rect x="2.2" y="3" width="11.6" height="10" rx="1.4" />
      <path d="M2.2 6.4h11.6M6.6 6.4V13M10 6.4V13" />
    </S>
  ),
  rule: (p: P) => (
    <S {...p}>
      <path d="M2.2 8h11.6" />
      <path d="M4 4.4h8M4 11.6h8" opacity="0.45" />
    </S>
  ),
  pageBreak: (p: P) => (
    <S {...p}>
      <path d="M4 5.4V2.8h8v2.6" />
      <path d="M4 10.6v2.6h8v-2.6" />
      <path d="M1.8 8h2.4M6.4 8h3.2M11.8 8h2.4" />
    </S>
  ),
  alignLeft: () => <Bars widths={[11, 7, 11, 6]} anchor="start" />,
  alignCenter: () => <Bars widths={[11, 7, 11, 6]} anchor="center" />,
  alignRight: () => <Bars widths={[11, 7, 11, 6]} anchor="end" />,
  alignJustify: () => <Bars widths={[11, 11, 11, 11]} anchor="start" />,
  lineSpacing: (p: P) => (
    <S {...p}>
      <path d="M3.4 3.4v9.2" />
      <path d="M1.8 5L3.4 3.2 5 5" />
      <path d="M1.8 11L3.4 12.8 5 11" />
      <path d="M7 4.2h7M7 8h7M7 11.8h7" />
    </S>
  ),
  checklist: (p: P) => (
    <S {...p}>
      <path d="M1.8 4.4l1.3 1.3 2.1-2.3" />
      <path d="M1.8 10.6l1.3 1.3 2.1-2.3" />
      <path d="M7.6 4.6h6.6M7.6 11h6.6" />
    </S>
  ),
  bulletList: (p: P) => (
    <S {...p}>
      <circle cx="3" cy="4.4" r="1.1" />
      <circle cx="3" cy="11.2" r="1.1" />
      <path d="M6.4 4.4h7.8M6.4 11.2h7.8" />
    </S>
  ),
  numberList: (p: P) => (
    <S {...p}>
      <path d="M2 3.4h1v3.2M2 6.6h2" strokeWidth="1.2" />
      <path d="M2 10h2l-2 2.6h2.2" strokeWidth="1.2" />
      <path d="M6.6 5h7.6M6.6 11.2h7.6" />
    </S>
  ),
  indent: (p: P) => (
    <S {...p}>
      <path d="M6.6 4.2h7.6M6.6 8h7.6M6.6 11.8h7.6" />
      <path d="M2 5.6L4.4 8 2 10.4z" fill="currentColor" stroke="none" />
    </S>
  ),
  outdent: (p: P) => (
    <S {...p}>
      <path d="M6.6 4.2h7.6M6.6 8h7.6M6.6 11.8h7.6" />
      <path d="M4.4 5.6L2 8l2.4 2.4z" fill="currentColor" stroke="none" />
    </S>
  ),
  clearFormat: (p: P) => (
    <S {...p}>
      <path d="M4 4.2h7.6" />
      <path d="M7.4 4.2L5.6 11.8" />
      <path d="M10.2 9.6l3.4 3.4M13.6 9.6l-3.4 3.4" />
    </S>
  ),
  quote: (p: P) => (
    <S {...p}>
      <path d="M3 10.6c0-3.4 1.2-5 3.4-5.4M3 10.6h2.6V8H3z" />
      <path d="M9 10.6c0-3.4 1.2-5 3.4-5.4M9 10.6h2.6V8H9z" />
    </S>
  ),
  code: (p: P) => (
    <S {...p}>
      <path d="M5.6 4.6L2.4 8l3.2 3.4" />
      <path d="M10.4 4.6L13.6 8l-3.2 3.4" />
    </S>
  ),
  pencil: (p: P) => (
    <S {...p}>
      <path d="M10.2 2.9l2.9 2.9-7 7-3.5.6.6-3.5z" />
    </S>
  ),
  eye: (p: P) => (
    <S {...p}>
      <path d="M1.6 8s2.4-4 6.4-4 6.4 4 6.4 4-2.4 4-6.4 4-6.4-4-6.4-4z" />
      <circle cx="8" cy="8" r="1.7" />
    </S>
  ),
  chevronDown: (p: P) => (
    <S {...p}>
      <path d="M4 6.2L8 10l4-3.8" />
    </S>
  ),
  chevronUp: (p: P) => (
    <S {...p}>
      <path d="M4 9.8L8 6l4 3.8" />
    </S>
  ),
  chevronLeft: (p: P) => (
    <S {...p}>
      <path d="M9.8 3.6L6 8l3.8 4.4" />
    </S>
  ),
  minus: (p: P) => (
    <S {...p}>
      <path d="M3 8h10" />
    </S>
  ),
  plus: (p: P) => (
    <S {...p}>
      <path d="M8 3v10M3 8h10" />
    </S>
  ),
  download: (p: P) => (
    <S {...p}>
      <path d="M8 2.6v7.2" />
      <path d="M5.2 7.2L8 10l2.8-2.8" />
      <path d="M2.8 11.4v1.2a1 1 0 001 1h8.4a1 1 0 001-1v-1.2" />
    </S>
  ),
  outline: (p: P) => (
    <S {...p}>
      <path d="M2.4 3.8h11.2" />
      <path d="M4.8 7.2h8.8" />
      <path d="M7.2 10.6h6.4" />
      <path d="M4.8 13.4h8.8" opacity="0.45" />
    </S>
  ),
  fullscreen: (p: P) => (
    <S {...p}>
      <path d="M2.6 6V3.4a.8.8 0 01.8-.8H6" />
      <path d="M10 2.6h2.6a.8.8 0 01.8.8V6" />
      <path d="M13.4 10v2.6a.8.8 0 01-.8.8H10" />
      <path d="M6 13.4H3.4a.8.8 0 01-.8-.8V10" />
    </S>
  ),
  people: (p: P) => (
    <S {...p}>
      <circle cx="6.2" cy="5.6" r="2.4" />
      <path d="M2.2 13.2c0-2.2 1.8-3.6 4-3.6s4 1.4 4 3.6" />
      <path d="M11 4.2a2.2 2.2 0 010 4.2M11.6 13.2c0-1.6-.5-2.7-1.4-3.4" opacity="0.6" />
    </S>
  ),
  history: (p: P) => (
    <S {...p}>
      <path d="M2.6 8a5.4 5.4 0 105.4-5.4A5.4 5.4 0 003.4 5.4" />
      <path d="M2.4 2.6v3h3" />
      <path d="M8 5.4V8l2 1.4" />
    </S>
  ),
};
