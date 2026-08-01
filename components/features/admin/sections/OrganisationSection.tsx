"use client";

import Link from "next/link";
import {
  Chip,
  EmptyState,
  Panel,
  PanelHead,
  QueryError,
  SkeletonRows,
} from "@/components/ui/Primitives";
import { Avatar } from "@/components/ui/Avatar";
import { useQuery } from "@/lib/hooks/useRepository";
import { SettingsShell } from "../SettingsShell";

/**
 * Organisation — departments, the reporting closure and the roles it grants.
 *
 * ## Read-only, and that is a decision rather than an unfinished screen
 *
 * The reporting line lives in MongoDB `Employee.primaryManager` and is written
 * through HR's own routes, which authenticate against HR rather than Cowork.
 * Editing it here would need a second authentication domain **and** would create a
 * second place a reporting line can be changed — which means two answers to "who
 * does this person report to", resolved by whichever system was written to last.
 *
 * That matters more here than almost anywhere else in the product, because the
 * closure is the source of truth for three separate things: what a manager may
 * see, who may be monitored, and who approves an extension. A reporting line
 * edited in the wrong store does not fail loudly — it silently changes who can
 * read somebody's work.
 *
 * ## What this screen is for
 *
 * Answering "why does the product behave this way for this person". A manager who
 * cannot see a report, an approval that went to an unexpected person, a new joiner
 * with no team — all three trace to this tree, and all three are diagnosed by
 * reading it rather than by editing it.
 */
export function OrganisationSection() {
  const people = useQuery((r) => r.listEmployees(), []);
  const departments = useQuery((r) => r.listDepartments(), []);
  const reporting = useQuery((r) => r.listReportingLines(), []);
  const roles = useQuery((r) => r.listRoles(), []);

  const byId = new Map((people.data ?? []).map((p) => [p.id, p]));

  /* Nodes with no manager. Roots and orphans look identical in the data and are
     not the same thing — a chief executive has nobody above them, while a new
     joiner whose HR record is incomplete also has nobody above them, and only the
     second is a problem. The count is shown without claiming which. */
  const roots = (reporting.data ?? []).filter((n) => !n.managerId);
  const unresolvedDepth = (reporting.data ?? []).filter(
    (n) => n.depth === null,
  );

  return (
    <SettingsShell
      section="organisation"
      count={
        <>
          <span data-figure>{people.data?.length ?? 0}</span> people ·{" "}
          <span data-figure>{departments.data?.length ?? 0}</span> departments
        </>
      }
    >
      <div className="space-y-4">
        <Panel>
          <PanelHead
            title="Where each of these is edited"
            sub="Cowork reads all of it. None of it is written here."
          />
          <dl className="mt-3 divide-y divide-hairline">
            <Source
              what="Names, employee ids, departments, designations, joining details"
              where="HR — MongoDB Employee"
            />
            <Source
              what="Reporting lines — primary and secondary manager"
              where="HR — MongoDB Employee.primaryManager"
            />
            <Source
              what="Whether somebody can sign in to Cowork, and their engine role"
              where="Firestore cowork_employees.role"
            />
            <Source
              what="What each role may do, and at what scope"
              where="Code — one table, shared with the seed tenant"
            />
          </dl>
        </Panel>

        <Panel padded={false}>
          <PanelHead
            title="Departments"
            sub="Departments group people. They grant nothing — reach comes from the reporting line, so a shared department is not a permission."
          />
          {departments.isLoading ? (
            <div className="px-4 py-3">
              <SkeletonRows rows={4} />
            </div>
          ) : departments.error ? (
            <div className="px-4 py-3">
              <QueryError
                queries={[departments]}
                message="Departments could not be loaded."
              />
            </div>
          ) : !departments.data?.length ? (
            <div className="px-4 py-3">
              <EmptyState
                title="No departments"
                body="Nothing in the directory carries a department yet."
              />
            </div>
          ) : (
            <ul className="divide-y divide-hairline">
              {departments.data.map((d) => {
                const members = (people.data ?? []).filter(
                  (p) => p.departmentId === d.id,
                );
                return (
                  <li
                    key={d.id}
                    className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5"
                  >
                    <span className="min-w-0 flex-1 truncate text-sm text-ink">
                      {d.name}
                    </span>
                    <span className="text-[11px] text-ink-faint">
                      <span data-figure>{members.length}</span>{" "}
                      {members.length === 1 ? "person" : "people"}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>

        <Panel padded={false}>
          <PanelHead
            title="Reporting closure"
            sub="The tree every visibility, monitoring and approval decision reads. A person absent from it is invisible on team surfaces regardless of their role."
          />
          <div className="flex flex-wrap gap-2 px-4 py-2.5">
            <Chip title="Nobody above them. A chief executive and an incomplete HR record look the same here.">
              <span data-figure>{roots.length}</span> without a manager
            </Chip>
            {unresolvedDepth.length > 0 && (
              <Chip
                tone="risk"
                title="The chain to a root could not be resolved — usually a manager named on a record who is not themselves in the directory."
              >
                <span data-figure>{unresolvedDepth.length}</span> with an
                unresolved chain
              </Chip>
            )}
          </div>
          {reporting.isLoading ? (
            <div className="px-4 py-3">
              <SkeletonRows rows={6} />
            </div>
          ) : reporting.error ? (
            <div className="px-4 py-3">
              <QueryError
                queries={[reporting]}
                message="The reporting tree could not be loaded."
              />
            </div>
          ) : (
            <>
              <div className="hidden grid-cols-[minmax(0,1fr)_150px_90px_110px] items-center gap-2 border-t border-hairline px-4 py-1.5 text-[11px] tracking-[0.09em] text-ink-faint uppercase deck:grid">
                <span>Person</span>
                <span>Reports to</span>
                <span>Depth</span>
                <span>Direct reports</span>
              </div>
              <ul className="divide-y divide-hairline border-t border-hairline">
                {(reporting.data ?? []).map((node) => {
                  const person = byId.get(node.employeeId);
                  return (
                    <li
                      key={node.employeeId}
                      className="grid grid-cols-1 gap-1.5 px-4 py-2.5 deck:grid-cols-[minmax(0,1fr)_150px_90px_110px] deck:items-center"
                    >
                      <span className="flex min-w-0 items-center gap-2.5">
                        {/* A node with no directory record gets a neutral slot
                            rather than an avatar. Keeps the rows aligned without
                            inventing a hue: `Avatar` derives its colour from the
                            person, and picking one here would give the same
                            individual a different colour on this screen than on
                            every other. */}
                        {person ? (
                          <Avatar
                            initials={person.initials}
                            hue={person.hue}
                            src={person.profilePictureUrl}
                            name={person.displayName}
                            size="sm"
                          />
                        ) : (
                          <span
                            aria-hidden
                            title="Named as a manager, but not a Cowork account"
                            className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-[var(--control)] text-[11px] text-ink-faint"
                          >
                            ··
                          </span>
                        )}
                        <span className="min-w-0">
                          {person ? (
                            <Link
                              href={`/admin/people/${node.employeeId}`}
                              className="block truncate text-sm text-ink"
                            >
                              {person.displayName}
                            </Link>
                          ) : (
                            <span className="block truncate text-sm text-ink">
                              {node.managerName ?? node.employeeId}
                            </span>
                          )}
                          <span className="block truncate text-[11px] text-ink-faint">
                            <span data-figure>{node.employeeId}</span>
                            {!node.isDirectoryMember && " · not a Cowork account"}
                          </span>
                        </span>
                      </span>
                      <span className="truncate text-xs text-ink-muted">
                        {node.managerName ?? "—"}
                      </span>
                      <span className="text-xs text-ink-muted">
                        {/* Null is not zero. An unresolvable chain shown as 0
                            would read as "this person is a root", which is a
                            different and much more reassuring claim. */}
                        {node.depth === null ? (
                          <span className="text-ink-faint">unresolved</span>
                        ) : (
                          <span data-figure>{node.depth}</span>
                        )}
                      </span>
                      <span className="text-xs text-ink-muted">
                        <span data-figure>{node.directReportIds.length}</span>
                      </span>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </Panel>

        <Panel>
          <PanelHead
            title="Roles"
            sub="Additive — a person's permissions are the union of the roles they hold."
          />
          <ul className="mt-3 divide-y divide-hairline">
            {(roles.data ?? []).map((role) => (
              <li
                key={role.id}
                className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5"
              >
                <span className="min-w-0 flex-1 truncate text-sm text-ink">
                  {role.displayName}
                </span>
                <Chip title="A lower level can never act on a higher one.">
                  level <span data-figure>{role.administrativeLevel}</span>
                </Chip>
                <span className="text-[11px] text-ink-faint">
                  <span data-figure>{role.permissions.length}</span> permissions
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-3 border-t border-hairline pt-3 text-[11px] leading-relaxed text-ink-faint">
            Manager is earned from the reporting tree rather than granted, so it
            follows a re-org without anybody editing a list.{" "}
            <Link
              href="/admin/roles"
              className="text-ink underline underline-offset-2"
            >
              See each role&rsquo;s capabilities and scopes
            </Link>
            .
          </p>
        </Panel>
      </div>
    </SettingsShell>
  );
}

function Source({ what, where }: { what: string; where: string }) {
  return (
    <div className="grid grid-cols-1 gap-0.5 py-2.5 deck:grid-cols-[minmax(0,1fr)_260px] deck:gap-3">
      <dt className="text-xs text-ink-muted">{what}</dt>
      <dd className="text-[11px] text-ink-faint">
        <span data-figure>{where}</span>
      </dd>
    </div>
  );
}
