"use client";

import Link from "next/link";
import { isOpen } from "./signals";
import { Icon, type IconName } from "@/components/ui/Icons";
import { useLens } from "@/components/layout/shell/LensContext";
import { useQuery } from "@/lib/hooks/useRepository";
import type { TaskView } from "@/lib/repositories";

/**
 * The header's pill row — the reference's filter set beside the page title.
 *
 * There it is four pills, the first carrying a circular icon badge and an
 * active treatment. The shape is worth keeping because of what it does to the
 * scan: before any card is read, the eye gets four short words and four counts.
 *
 * Cowork's adaptation is jumps rather than filters. A pill that filtered this
 * page would need a filtered dashboard behind it; a pill that opens the list
 * already filtered is the same intent with somewhere to land. The leading pill
 * takes the active treatment and is always the one that matters most — overdue
 * if there is any, otherwise whatever is waiting.
 */
interface Pill {
  id: string;
  label: string;
  href: string;
  icon: IconName;
  count: (tasks: TaskView[]) => number;
}

const PILLS: Pill[] = [
  {
    id: "overdue",
    label: "Overdue",
    href: "/tasks?view=tasks",
    icon: "flag",
    count: (t) => t.filter((v) => isOpen(v) && v.isOverdue).length,
  },
  {
    id: "review",
    label: "In review",
    href: "/tasks?view=approvals",
    icon: "check",
    count: (t) =>
      t.filter((v) => isOpen(v) && v.task.status === "in_review").length,
  },
  {
    id: "blocked",
    label: "Blocked",
    href: "/tasks?view=tasks",
    icon: "blocked",
    count: (t) => t.filter((v) => isOpen(v) && v.task.isBlocked).length,
  },
  {
    id: "open",
    label: "All open",
    href: "/tasks?view=tasks",
    icon: "list",
    count: (t) => t.filter(isOpen).length,
  },
];

export function ScopePills() {
  const { lens } = useLens();
  const team = lens === "team";

  const tasks = useQuery(
    (r) =>
      r
        .listTasks({ scope: team ? "team" : "mine", sort: "rank" })
        .then((p) => p.items),
    [team],
  );

  /* A failed read is not a count of zero. "Overdue 0" beside an error is the
     most confident wrong answer this page could give. */
  const unknown = !!tasks.error;
  const list = tasks.data ?? [];
  const counts = PILLS.map((p) => ({ ...p, n: p.count(list) }));
  /* The lead pill is the reference's active one: filled, badged, first. It is
     whichever of these is actually a problem today, not a fixed choice. */
  const leadId = unknown
    ? "open"
    : (counts.find((c) => c.id === "overdue" && c.n > 0)?.id ??
      counts.find((c) => c.id === "blocked" && c.n > 0)?.id ??
      counts.find((c) => c.id === "review" && c.n > 0)?.id ??
      "open");

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {counts.map((c) => {
        const lead = c.id === leadId;
        const Ico = Icon[c.icon];
        return (
          <Link
            key={c.id}
            href={c.href}
            className={`inline-flex items-center gap-2 rounded-full py-1.5 pr-3.5 pl-1.5 text-xs font-medium transition-colors ${
              lead
                ? "bg-ink text-[var(--body-bg)]"
                : "bg-[var(--control)] text-ink-muted hover:bg-[var(--control-hover)] hover:text-ink"
            }`}
          >
            <span
              aria-hidden="true"
              className={`grid h-6 w-6 place-items-center rounded-full ${
                lead ? "bg-[var(--body-bg)]/20" : "bg-[var(--surface-sunken)]"
              }`}
            >
              <Ico className="h-3 w-3" />
            </span>
            {c.label}
            <span
              data-figure
              className={lead ? "opacity-80" : "text-ink-faint"}
              title={unknown ? "Could not be loaded" : undefined}
            >
              {tasks.isLoading || unknown ? "—" : c.n}
            </span>
          </Link>
        );
      })}
    </div>
  );
}
