"use client";

import { Avatar } from "@/components/ui/Avatar";
import {
  InlineError,
  Panel,
  PanelHead,
  Select,
} from "@/components/ui/Primitives";
import { useAction, useQuery } from "@/lib/hooks/useRepository";
import { usePermissions } from "@/lib/hooks/usePermissions";

/**
 * People the reporting tree does not place.
 *
 * **Why this panel exists rather than a migration that fills the gaps in.**
 * Team visibility, monitoring, manager dashboards and assignment scope all read
 * one thing: the reporting closure. Somebody outside it is not partially
 * visible — they are reachable by nobody, and nothing anywhere says so. That is
 * how an employee signs in perfectly well and is absent from their own
 * manager's People list.
 *
 * Picking a manager for them automatically would be the obvious fix and the
 * wrong one: it would put a person's work, screen and score under somebody who
 * never agreed to receive them, and it would widen the closure without any
 * decision having been made. So this reports and stops. The repair is one
 * deliberate choice per person, made here or on their record, through the same
 * `setReportingManager` an administrator would use anyway — cycle detection and
 * the `people.change_reporting` check included.
 *
 * It renders nothing when the tree is complete. A panel that says "0 problems"
 * on every visit is a panel people stop reading.
 */
export function UnplacedPeople() {
  const unplaced = useQuery((r) => r.listUnattachedEmployees(), []);
  const people = useQuery((r) => r.listEmployees(), []);
  const perms = usePermissions();

  const [assign, state] = useAction((r, employeeId: string, managerId: string) =>
    r.setReportingManager(employeeId, managerId),
  );

  const rows = unplaced.data ?? [];
  if (unplaced.isLoading || rows.length === 0) return null;

  return (
    <Panel>
      <PanelHead
        title="Not in the reporting line"
        sub={`${rows.length} ${rows.length === 1 ? "person is" : "people are"} outside the hierarchy`}
      />

      <p className="mt-1 max-w-[70ch] text-xs leading-relaxed text-ink-muted">
        Team surfaces, monitoring and manager dashboards all follow the
        reporting line, so nobody can see these people or the work they are
        carrying. Choosing a manager places them. Nothing is assigned
        automatically — who receives somebody is a decision, not a default.
      </p>

      {state.error && (
        <div className="mt-3">
          <InlineError compact message={state.error} code={state.errorCode} />
        </div>
      )}

      <ul className="mt-3 flex flex-col gap-1.5">
        {rows.map((p) => (
          <li
            key={p.id}
            className="flex flex-wrap items-center gap-3 rounded-inset bg-[var(--surface-sunken)] px-3 py-2.5"
          >
            <Avatar
              initials={p.initials}
              hue={p.hue}
              src={p.profilePictureUrl}
              name={p.displayName}
              size="sm"
            />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm text-ink">
                {p.displayName}
              </span>
              <span className="block truncate text-[11px] text-ink-faint">
                {p.designation ?? "No designation"}
                {p.departmentName ? ` · ${p.departmentName}` : ""}
              </span>
            </span>

            <Select
              aria-label={`Manager for ${p.displayName}`}
              defaultValue=""
              disabled={
                !perms.can("people.change_reporting", p.id) || state.isPending
              }
              /* No refetch call: a successful action notifies every mounted
                 query, so this list re-derives and the placed person drops out
                 of it on their own. */
              onChange={(e) => {
                if (e.target.value) void assign(p.id, e.target.value);
              }}
              className="w-auto min-w-[190px]"
            >
              <option value="">Reports to…</option>
              {(people.data ?? [])
                .filter((x) => x.id !== p.id && !x.exitedAt)
                .map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.displayName}
                  </option>
                ))}
            </Select>
          </li>
        ))}
      </ul>

      <p className="mt-3 text-[11px] leading-relaxed text-ink-faint">
        Somebody who genuinely sits at the top of the organisation belongs here
        only until an administrator says so on their record. This list does not
        include the person who created the workspace.
      </p>
    </Panel>
  );
}
