/**
 * The score area's tab strip.
 *
 * Extracted from `ScoreArea` because C3 is its own page — four queues rather
 * than a measurement — and two copies of a navigation strip drift: one gains a
 * tab, the other keeps the old set, and which one a reader sees depends on
 * which channel they happened to open.
 */
export const SCORE_TABS = [
  { id: "overview", label: "Overview", href: "/score", icon: "score" as const },
  { id: "c1", label: "C1", href: "/score/c1", icon: "tasks" as const },
  { id: "c2", label: "C2", href: "/score/c2", icon: "flag" as const },
  { id: "c3", label: "C3", href: "/score/c3", icon: "blocked" as const },
  { id: "c4", label: "C4", href: "/score/c4", icon: "calendar" as const },
  {
    id: "history",
    label: "History",
    href: "/score/history",
    icon: "history" as const,
  },
];
