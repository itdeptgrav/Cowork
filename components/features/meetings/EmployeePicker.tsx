"use client";

import { useMemo, useState } from "react";
import type { Employee } from "@/lib/domain";
import { Avatar } from "@/components/ui/Avatar";
import { Icon } from "@/components/ui/Icons";

/**
 * A searchable list for choosing internal people — the meeting organiser picking
 * who to invite, and later adding more to a meeting already made. A LIST rather
 * than a wall of chips: on a directory of any size, chips give no way to find a
 * name, and every unselected person is visual noise the whole time. Here the
 * search narrows the list, a checkmark marks who is in, and the organiser sits
 * at the top, fixed and always included.
 *
 * Selection is owned by the caller (`selected` + `onToggle`) so the same picker
 * drives a form's local state and a live "add people" write without knowing
 * which it is.
 */
export function EmployeePicker({
  people,
  selected,
  onToggle,
  fixedId,
  disabled,
  fixedLabel = "you",
  maxHeightClass = "max-h-72",
}: {
  people: Employee[];
  /** Ids currently chosen (excluding the fixed organiser). */
  selected: string[];
  onToggle: (id: string) => void;
  /** The organiser — always shown at the top, always included, not toggleable. */
  fixedId?: string | null;
  disabled?: boolean;
  fixedLabel?: string;
  maxHeightClass?: string;
}) {
  const [query, setQuery] = useState("");

  const fixed = fixedId ? people.find((p) => p.id === fixedId) : undefined;

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const pool = people.filter((p) => p.id !== fixedId);
    const matched = q
      ? pool.filter((p) =>
          [p.displayName, p.designation ?? "", p.departmentName ?? "", p.email ?? ""]
            .join(" ")
            .toLowerCase()
            .includes(q),
        )
      : pool;
    return [...matched].sort((a, b) => a.displayName.localeCompare(b.displayName));
  }, [people, query, fixedId]);

  return (
    <div className="rounded-inset border border-hairline bg-[var(--surface-sunken)]">
      {/* Search — the whole reason this is a list and not chips. */}
      <div className="relative border-b border-hairline p-2">
        <span className="pointer-events-none absolute top-1/2 left-4 -translate-y-1/2 text-ink-faint">
          <Icon.search className="h-4 w-4" />
        </span>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          disabled={disabled}
          placeholder="Search people by name, role or department"
          aria-label="Search people"
          className="h-9 w-full rounded-full bg-[var(--surface-raised)] pr-3 pl-9 text-sm text-ink outline-none placeholder:text-ink-faint focus-visible:ring-2 focus-visible:ring-ink disabled:opacity-50"
        />
      </div>

      <div className={`${maxHeightClass} overflow-y-auto p-1`}>
        {/* The organiser, fixed at the top. */}
        {fixed && (
          <div className="flex items-center gap-3 rounded-inset px-2 py-1.5">
            <Avatar
              initials={fixed.initials}
              hue={fixed.hue}
              src={fixed.profilePictureUrl}
              name={fixed.displayName}
              size="sm"
            />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm text-ink">
                {fixed.displayName}
                <span className="ml-1.5 text-[11px] text-ink-faint">{fixedLabel}</span>
              </span>
            </span>
            <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-ink text-[var(--body-bg)]">
              <Icon.check className="h-3 w-3" />
            </span>
          </div>
        )}

        {rows.length === 0 ? (
          <p className="px-3 py-6 text-center text-sm text-ink-faint">
            {query ? `No one matches “${query}”.` : "No people to add."}
          </p>
        ) : (
          rows.map((p) => {
            const on = selected.includes(p.id);
            return (
              <button
                key={p.id}
                type="button"
                aria-pressed={on}
                disabled={disabled}
                onClick={() => onToggle(p.id)}
                className="flex w-full items-center gap-3 rounded-inset px-2 py-1.5 text-left transition-colors hover:bg-[var(--control)] disabled:opacity-50"
              >
                <Avatar
                  initials={p.initials}
                  hue={p.hue}
                  src={p.profilePictureUrl}
                  name={p.displayName}
                  size="sm"
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm text-ink">{p.displayName}</span>
                  {(p.designation ?? p.departmentName) && (
                    <span className="block truncate text-[11px] text-ink-faint">
                      {p.designation ?? p.departmentName}
                    </span>
                  )}
                </span>
                <span
                  aria-hidden
                  className={`grid h-5 w-5 shrink-0 place-items-center rounded-full border transition-colors ${
                    on
                      ? "border-ink bg-ink text-[var(--body-bg)]"
                      : "border-hairline text-transparent"
                  }`}
                >
                  <Icon.check className="h-3 w-3" />
                </span>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
