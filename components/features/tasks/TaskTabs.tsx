"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

/**
 * Sub-navigation for the Tasks area.
 *
 * Projects is a tab HERE, not a global module — brief §7, and independently
 * confirmed by the Tasks layout reference, whose own tab bar carries Projects
 * alongside Overview, Timeline and Approvals.
 */

const tabs = [
  { id: "overview", label: "Overview", href: "/tasks?view=overview" },
  { id: "tasks", label: "Tasks", href: "/tasks?view=tasks" },
  { id: "projects", label: "Projects", href: "/tasks/projects" },
  { id: "timeline", label: "Timeline", href: "/tasks?view=timeline" },
  { id: "approvals", label: "Approvals", href: "/tasks?view=approvals" },
];

export function TaskTabs({ counts = {} }: { counts?: Record<string, number> }) {
  const pathname = usePathname();
  const params = useSearchParams();
  const view = params.get("view") ?? "overview";
  const onProjects = pathname.startsWith("/tasks/projects");

  return (
    <div
      role="tablist"
      aria-label="Tasks views"
      className="rail flex items-center gap-1 overflow-x-auto"
    >
      {tabs.map((t) => {
        const active =
          t.id === "projects" ? onProjects : !onProjects && view === t.id;
        const count = counts[t.id];
        return (
          <Link
            key={t.id}
            href={t.href}
            role="tab"
            aria-selected={active}
            className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-3.5 py-2 text-[15px] font-medium tracking-[-0.012em] transition-[color,background-color] duration-[180ms] ease-[var(--ease-deck)] ${
              active
                ? "bg-[var(--control)] text-ink"
                : "text-ink-muted hover:bg-[var(--surface-sunken)] hover:text-ink"
            }`}
          >
            {t.label}
            {count !== undefined && count > 0 && (
              <span
                data-figure
                className={`rounded-full px-1.5 py-px text-[11px] ${
                  active
                    ? "bg-[var(--control-active)] text-ink"
                    : "bg-[var(--control)] text-ink-faint"
                }`}
              >
                {count}
              </span>
            )}
          </Link>
        );
      })}
    </div>
  );
}
