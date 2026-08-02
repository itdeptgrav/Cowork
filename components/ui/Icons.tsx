/**
 * A single 16px icon set at one stroke weight.
 *
 * Icons exist here for one reason: a seven-item tab bar and a dense row-action
 * menu are materially faster to scan with a leading glyph, which is what both
 * layout references do. They are line icons at 1.5 stroke to sit with Geist's
 * weight, and they never carry colour of their own.
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

export const Icon = {
  overview: (p: P) => (
    <S {...p}>
      <rect x="2" y="2.5" width="5" height="5" rx="1.3" />
      <rect x="9" y="2.5" width="5" height="5" rx="1.3" />
      <rect x="2" y="9" width="5" height="4.5" rx="1.3" />
      <rect x="9" y="9" width="5" height="4.5" rx="1.3" />
    </S>
  ),
  tasks: (p: P) => (
    <S {...p}>
      <path d="M2.5 4.5l1.6 1.6L7 3.2" />
      <path d="M9.5 4.6h4" />
      <path d="M2.5 11l1.6 1.6L7 9.7" />
      <path d="M9.5 11.1h4" />
    </S>
  ),
  /**
   * PROJECT — a structured work container with connected tasks and progress.
   *
   * An outer container holding one tall column and two stacked blocks: a
   * compact project board. Deliberately NOT a person and NOT a briefcase — and
   * with no raised tab, so it cannot be read as a bare grouping. It reads as
   * "grouped work with structure" at 16px and stays legible down to 14px.
   */
  projects: (p: P) => (
    <S {...p}>
      <rect x="1.9" y="2.6" width="12.2" height="10.8" rx="2" />
      <path d="M5.7 5.4v5.2" />
      <path d="M8.6 5.4h3.7" />
      <path d="M8.6 8h2.4" />
      <path d="M8.6 10.6h3.1" />
    </S>
  ),
  timeline: (p: P) => (
    <S {...p}>
      <path d="M2 4.2h7" />
      <path d="M5 8h9" />
      <path d="M2 11.8h6" />
    </S>
  ),
  approvals: (p: P) => (
    <S {...p}>
      <circle cx="8" cy="8" r="5.8" />
      <path d="M5.6 8.2l1.6 1.6 3.2-3.4" />
    </S>
  ),
  calendar: (p: P) => (
    <S {...p}>
      <rect x="2.2" y="3.4" width="11.6" height="10" rx="1.6" />
      <path d="M2.2 6.4h11.6M5.4 2.2v2.2M10.6 2.2v2.2" />
    </S>
  ),
  search: (p: P) => (
    <S {...p}>
      <circle cx="7.2" cy="7.2" r="4.4" />
      <path d="M10.5 10.5l3 3" />
    </S>
  ),
  filter: (p: P) => (
    <S {...p}>
      <path d="M2.4 4h11.2M4.4 8h7.2M6.4 12h3.2" />
    </S>
  ),
  /* Sliders, for the administration console. Deliberately not `filter`, which
     is three centred lines and reads as a funnel — the handles are what make
     this "values somebody sets" rather than "a list being narrowed". */
  settings: (p: P) => (
    <S {...p}>
      <path d="M2.4 4.5h11.2M2.4 11.5h11.2" />
      <circle cx="6" cy="4.5" r="1.6" />
      <circle cx="10.4" cy="11.5" r="1.6" />
    </S>
  ),
  sort: (p: P) => (
    <S {...p}>
      <path d="M4.4 3v10M2.4 10.6l2 2.4 2-2.4" />
      <path d="M9.4 5.4h4.2M9.4 8.6h3M9.4 11.8h1.8" />
    </S>
  ),
  group: (p: P) => (
    <S {...p}>
      <path d="M2.4 3.6h11.2M4.6 8h9M4.6 12.4h9" />
      <circle cx="2.6" cy="8" r="0.9" />
      <circle cx="2.6" cy="12.4" r="0.9" />
    </S>
  ),
  list: (p: P) => (
    <S {...p}>
      <path d="M5.4 4.2h8.2M5.4 8h8.2M5.4 11.8h8.2" />
      <circle cx="2.7" cy="4.2" r="0.9" />
      <circle cx="2.7" cy="8" r="0.9" />
      <circle cx="2.7" cy="11.8" r="0.9" />
    </S>
  ),
  board: (p: P) => (
    <S {...p}>
      <rect x="2.2" y="2.8" width="3.6" height="10.4" rx="1.2" />
      <rect x="6.9" y="2.8" width="3.6" height="7" rx="1.2" />
      <rect x="11.6" y="2.8" width="2.4" height="9" rx="1.2" />
    </S>
  ),
  plus: (p: P) => (
    <S {...p}>
      <path d="M8 3.2v9.6M3.2 8h9.6" />
    </S>
  ),
  more: (p: P) => (
    <S {...p}>
      <circle cx="3.4" cy="8" r="1" fill="currentColor" stroke="none" />
      <circle cx="8" cy="8" r="1" fill="currentColor" stroke="none" />
      <circle cx="12.6" cy="8" r="1" fill="currentColor" stroke="none" />
    </S>
  ),
  /** A task broken down into subtasks — a project, in the task-detail sense. */
  folder: (p: P) => (
    <S {...p}>
      <path d="M1.8 4.2a1 1 0 011-1h3.1l1.4 1.6h5.9a1 1 0 011 1v6a1 1 0 01-1 1H2.8a1 1 0 01-1-1z" />
    </S>
  ),
  chevronRight: (p: P) => (
    <S {...p}>
      <path d="M6 3.4L10.6 8 6 12.6" />
    </S>
  ),
  chevronDown: (p: P) => (
    <S {...p}>
      <path d="M3.4 6L8 10.6 12.6 6" />
    </S>
  ),
  clock: (p: P) => (
    <S {...p}>
      <circle cx="8" cy="8" r="5.8" />
      <path d="M8 4.8V8l2.2 1.5" />
    </S>
  ),
  play: (p: P) => (
    <S {...p}>
      <path d="M5.4 3.6l6.6 4.4-6.6 4.4z" />
    </S>
  ),
  pause: (p: P) => (
    <S {...p}>
      <path d="M6 3.6v8.8M10 3.6v8.8" />
    </S>
  ),
  flag: (p: P) => (
    <S {...p}>
      <path d="M3.6 13.6V2.8M3.6 3.4h7.6l-1.4 2.6 1.4 2.6H3.6" />
    </S>
  ),
  blocked: (p: P) => (
    <S {...p}>
      <circle cx="8" cy="8" r="5.8" />
      <path d="M4.2 4.2l7.6 7.6" />
    </S>
  ),
  send: (p: P) => (
    <S {...p}>
      <path d="M13.6 2.4L7.2 8.8M13.6 2.4l-4.2 11.2-2.2-4.8-4.8-2.2z" />
    </S>
  ),
  link: (p: P) => (
    <S {...p}>
      <path d="M6.6 9.4a2.6 2.6 0 0 0 3.8.2l1.8-1.8a2.6 2.6 0 0 0-3.7-3.7l-1 1" />
      <path d="M9.4 6.6a2.6 2.6 0 0 0-3.8-.2L3.8 8.2a2.6 2.6 0 0 0 3.7 3.7l1-1" />
    </S>
  ),
  chat: (p: P) => (
    <S {...p}>
      <path d="M13.6 7.6c0 2.8-2.5 5-5.6 5a6.4 6.4 0 0 1-2-.3L2.4 13.4l1.2-2.7A4.8 4.8 0 0 1 2.4 7.6c0-2.8 2.5-5 5.6-5s5.6 2.2 5.6 5Z" />
    </S>
  ),
  history: (p: P) => (
    <S {...p}>
      <path d="M2.6 8a5.4 5.4 0 1 0 1.6-3.8" />
      <path d="M2.4 2.6v3.2h3.2" />
      <path d="M8 5.2V8l2 1.4" />
    </S>
  ),
  check: (p: P) => (
    <S {...p}>
      <path d="M3.4 8.4l3 3 6.2-6.8" />
    </S>
  ),
  close: (p: P) => (
    <S {...p}>
      <path d="M4 4l8 8M12 4l-8 8" />
    </S>
  ),
  /** EMPLOYEE — one person. Head plus shoulder arc, nothing else. */
  user: (p: P) => (
    <S {...p}>
      <circle cx="8" cy="5.4" r="2.7" />
      <path d="M3 13.4a5 5 0 0 1 10 0" />
    </S>
  ),
  /** TEAM — two people. Same family as EMPLOYEE, plainly plural. */
  team: (p: P) => (
    <S {...p}>
      <circle cx="6.2" cy="5.6" r="2.4" />
      <path d="M1.9 13.2a4.4 4.4 0 0 1 8.6 0" />
      <path d="M11 4.1a2.4 2.4 0 0 1 0 4.6" />
      <path d="M12.2 13.2a4.5 4.5 0 0 0-1.5-3.3" />
    </S>
  ),
  /** GOAL — a target, distinct from FLAG which marks a milestone. */
  goal: (p: P) => (
    <S {...p}>
      <circle cx="8" cy="8" r="5.6" />
      <circle cx="8" cy="8" r="2.4" />
      <circle cx="8" cy="8" r="0.5" fill="currentColor" stroke="none" />
    </S>
  ),
  /** MEETING — people around a table edge. Not a calendar. */
  meeting: (p: P) => (
    <S {...p}>
      <circle cx="5.4" cy="5.2" r="1.8" />
      <circle cx="10.6" cy="5.2" r="1.8" />
      <path d="M2.2 13.4v-.9a3.2 3.2 0 0 1 3.2-3.2h5.2a3.2 3.2 0 0 1 3.2 3.2v.9" />
    </S>
  ),
  /** ATTENDANCE — a day marked present. */
  attendance: (p: P) => (
    <S {...p}>
      <rect x="2.2" y="3.4" width="11.6" height="10" rx="1.6" />
      <path d="M2.2 6.4h11.6M5.4 2.2v2.2M10.6 2.2v2.2" />
      <path d="M6 9.9l1.4 1.4 2.7-2.9" />
    </S>
  ),
  score: (p: P) => (
    <S {...p}>
      <path d="M2.6 13.4V9.2M6.2 13.4V4.6M9.8 13.4V7M13.4 13.4V2.6" />
    </S>
  ),
  /** VOLUME — a speaker with two arcs. Distinct from MESSAGE's bubble. */
  volume: (p: P) => (
    <S {...p}>
      <path d="M2.4 6.2h2.4l3.1-2.6v8.8L4.8 9.8H2.4z" />
      <path d="M10.6 6a2.8 2.8 0 0 1 0 4" />
      <path d="M12.6 4.2a5.4 5.4 0 0 1 0 7.6" />
    </S>
  ),
  /** MUTED — the same speaker, struck through. */
  volumeOff: (p: P) => (
    <S {...p}>
      <path d="M2.4 6.2h2.4l3.1-2.6v8.8L4.8 9.8H2.4z" />
      <path d="M10.6 6.4l3.4 3.2M14 6.4l-3.4 3.2" />
    </S>
  ),
  /** QUEUE — a list with a plus, distinct from LIST and TASKS. */
  queue: (p: P) => (
    <S {...p}>
      <path d="M2.4 4.4h8M2.4 8h5.6M2.4 11.6h4" />
      <path d="M11.4 8.6v4.4M9.2 10.8h4.4" />
    </S>
  ),
  /** FAVOURITE — an outline heart; filled by the caller when active. */
  heart: (p: P) => (
    <S {...p}>
      <path d="M8 13.2S2.4 10 2.4 6.3A2.9 2.9 0 0 1 8 5.1a2.9 2.9 0 0 1 5.6 1.2c0 3.7-5.6 6.9-5.6 6.9Z" />
    </S>
  ),
  /** EXTERNAL — leaves Cowork. Always paired with a visible label. */
  external: (p: P) => (
    <S {...p}>
      <path d="M6.6 3.4H3.4v9.2h9.2V9.4" />
      <path d="M9.2 2.8h4v4M13.2 2.8L7.8 8.2" />
    </S>
  ),
  attach: (p: P) => (
    <S {...p}>
      <path d="M11.6 7.2l-4.3 4.3a2.4 2.4 0 0 1-3.4-3.4l5-5a1.7 1.7 0 0 1 2.4 2.4l-5 5" />
    </S>
  ),
};

export type IconName = keyof typeof Icon;
