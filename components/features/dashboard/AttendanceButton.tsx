"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "@/components/ui/Icons";
import { useQuery, useRepo } from "@/lib/hooks/useRepository";
import { STATUS_META } from "@/lib/status/employeeStatus";
import { AttendanceDrawer } from "./AttendanceDrawer";
import type { DutyFacts } from "@/lib/rules/presence/roster";
import type { EmployeeId } from "@/lib/domain";

/**
 * "Today's attendance" — the control, and the count it carries.
 *
 * **A button rather than the card this replaced.** Eighteen people is a list
 * somebody reads deliberately, not a figure they glance at, and holding it open
 * on the dashboard pushed the work surfaces down the page every day for a
 * question asked once a morning. So the glance and the detail are separated:
 * the button answers "how many are here" without being opened, and the drawer
 * behind it answers "who, and since when".
 *
 * The count is live — the same per-person duty subscription the drawer uses,
 * held here because a number nobody can trust is worse than no number. It costs
 * one document listener per employee, which is what the team pages already
 * open.
 */
export function AttendanceButton() {
  const repo = useRepo();
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);

  const people = useQuery((r) => r.listEmployees(), []);
  const ids = useMemo(
    () => (people.data ?? []).filter((e) => !e.exitedAt).map((e) => e.id),
    [people.data],
  );
  const idKey = ids.join(",");
  const [facts, setFacts] = useState<Map<EmployeeId, DutyFacts>>(new Map());

  useEffect(() => {
    if (ids.length === 0) return;
    return repo.watchDutyRoster?.(ids, setFacts);
    /* `idKey`, not `ids` — a new array each render would rebuild every
       listener on any change to the page. */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repo, idKey]);

  let online = 0;
  let away = 0;
  for (const id of ids) {
    const mode = facts.get(id)?.mode ?? "offline";
    if (mode === "online") online += 1;
    else if (mode === "break" || mode === "emergency") away += 1;
  }
  const total = ids.length;

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={open}
        className="frost-panel flex w-full items-center gap-3 rounded-card px-4 py-3 text-left transition-colors duration-[180ms] ease-[var(--ease-deck)] hover:bg-[var(--row-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink"
      >
        <span
          aria-hidden
          className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[var(--surface-sunken)] text-ink-muted"
        >
          <Icon.attendance className="h-4 w-4" />
        </span>

        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm text-ink">
            Today&rsquo;s attendance
          </span>
          <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-ink-faint">
            {total === 0 ? (
              "Loading the directory…"
            ) : (
              <>
                <span className="flex items-center gap-1.5">
                  <span
                    aria-hidden
                    className="h-2 w-2 rounded-full"
                    style={{ backgroundColor: STATUS_META.online.dot }}
                  />
                  <span data-figure className="text-ink">
                    {online}
                  </span>
                  <span>of</span>
                  <span data-figure>{total}</span>
                  <span>on duty</span>
                </span>
                {away > 0 && (
                  <span className="flex items-center gap-1.5">
                    <span
                      aria-hidden
                      className="h-2 w-2 rounded-full"
                      style={{ backgroundColor: STATUS_META.break.dot }}
                    />
                    <span data-figure>{away}</span>
                    <span>away</span>
                  </span>
                )}
              </>
            )}
          </span>
        </span>

        <Icon.chevronRight className="h-4 w-4 shrink-0 text-ink-faint" />
      </button>

      <AttendanceDrawer
        open={open}
        onClose={() => setOpen(false)}
        returnFocusTo={buttonRef}
      />
    </>
  );
}
