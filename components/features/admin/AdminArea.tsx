"use client";

import Link from "next/link";

import { useState } from "react";
import { Avatar } from "@/components/ui/Avatar";
import { IconTabs, WorkspaceHead } from "@/components/ui/Workspace";
import {
  Button,
  Chip,
  InlineError,
  Panel,
  PanelHead,
  SkeletonRows,
  QueryError,
  EmptyState,
} from "@/components/ui/Primitives";
import { useAction, useQuery } from "@/lib/hooks/useRepository";
import { usePermissions } from "@/lib/hooks/usePermissions";
import { ADMIN_TABS } from "./adminTabs";
import { RoleEditor } from "./RoleEditor";
import { NewEmployee } from "./PeopleEditor";
import { AuditLog } from "./AuditLog";
import { UnplacedPeople } from "./UnplacedPeople";
import { ALL_CAPABILITIES } from "@/lib/auth/capabilities";

/**
 * The three administration surfaces that are NOT settings.
 *
 * People and Roles describe records rather than configure behaviour, and the audit
 * log reports what configuration was changed. Everything that actually sets a rule
 * moved to `/admin/settings`, behind one audited write path.
 *
 * **Five editors were deleted rather than moved**, and it is worth knowing why so
 * nobody restores them: `OrgEditor`, `WorkflowEditor`, `ScoringRuleEditor`,
 * `BreakAllowanceEditor` and `OfficeSettings` all called repository methods that
 * exist only on `MockRepository`. Against the real engine each rendered its panel,
 * accepted edits, and threw `NotConnectedError` on save — and `OfficeSettings` was
 * additionally the unaudited second writer of `cowork_settings/office`. A control
 * that cannot save is worse than an absent one, because the person using it
 * believes the configuration changed.
 */


export function AdminPeople() {
  const people = useQuery((r) => r.listEmployees(), []);
  const roles = useQuery((r) => r.listRoles(), []);
  const reporting = useQuery((r) => r.listReporting(), []);
  const perms = usePermissions();
  const [adding, setAdding] = useState(false);

  const [setActive, activeState] = useAction((r, id: string, active: boolean) =>
    r.setEmployeeActive(id, active),
  );

  return (
    <>
      <WorkspaceHead
        title="People administration"
        count={people.data ? `${people.data.length} employees` : undefined}
        tabs={<IconTabs items={ADMIN_TABS} active="people" />}
        action={
          perms.can("people.create") && !adding ? (
            <Button size="sm" onClick={() => setAdding(true)}>
              Add someone
            </Button>
          ) : undefined
        }
      />

      {activeState.error && (
        <div className="mb-3">
          <InlineError message={activeState.error} />
        </div>
      )}
      {adding && (
        <div className="mb-4">
          <NewEmployee onDone={() => setAdding(false)} />
        </div>
      )}
      {/* Above the roster on purpose: somebody outside the reporting line is
          invisible everywhere else in the product, so this is the one screen
          where it can be noticed at all. Renders nothing when the tree is
          complete. */}
      <div className="mb-4">
        <UnplacedPeople />
      </div>
      {people.isLoading ? (
        <SkeletonRows rows={8} />
      ) : people.error ? (
        <QueryError
          queries={[people]}
          message="The people list could not be loaded."
        />
      ) : !people.data?.length ? (
        <Panel>
          <EmptyState
            title="No employees"
            body="Nobody has been added to this workspace yet."
          />
        </Panel>
      ) : (
        <Panel padded={false}>
          <div className="hidden grid-cols-[minmax(0,1fr)_130px_160px_150px] items-center gap-2 border-b border-hairline px-4 py-1.5 text-[11px] tracking-[0.09em] text-ink-faint uppercase deck:grid">
            <span>Person</span>
            <span>Department</span>
            <span>Roles</span>
            <span>Reports to</span>
          </div>
          <div className="divide-y divide-hairline">
            {(people.data ?? []).map((p) => {
              const mgr = reporting.data?.find(
                (r) => r.employeeId === p.id && !r.effectiveTo,
              );
              const mgrName = people.data?.find(
                (e) => e.id === mgr?.managerId,
              )?.displayName;
              return (
                <div
                  key={p.id}
                  className="grid grid-cols-1 gap-2 px-4 py-2.5 transition-colors hover:bg-[var(--row-hover)] deck:grid-cols-[minmax(0,1fr)_130px_160px_150px] deck:items-center"
                >
                  {/* The NAME is the link, not the row: the row also holds a
                      Deactivate button, and nesting a button inside an anchor
                      is invalid and makes the click target ambiguous. */}
                  <Link
                    href={`/admin/people/${p.id}`}
                    className="flex min-w-0 items-center gap-2.5"
                  >
                    <Avatar
                      initials={p.initials}
                      hue={p.hue}
                      src={p.profilePictureUrl}
                      name={p.displayName}
                      size="sm"
                    />
                    <span className="min-w-0">
                      <span className="block truncate text-sm text-ink">
                        {p.displayName}
                      </span>
                      <span className="block truncate text-[11px] text-ink-faint">
                        {p.email ?? (
                          <span data-figure>{p.employeeCode}</span>
                        )}
                      </span>
                    </span>
                  </Link>
                  <span className="truncate text-xs text-ink-muted">
                    {p.departmentName}
                  </span>
                  <span className="flex flex-wrap gap-1">
                    {p.roleIds.map((rid) => (
                      <Chip key={rid}>
                        {roles.data?.find((r) => r.id === rid)?.displayName ??
                          rid}
                      </Chip>
                    ))}
                  </span>
                  <span className="flex items-center justify-between gap-2">
                    <span className="min-w-0 truncate text-xs text-ink-muted">
                      {mgrName ?? "—"}
                    </span>
                    {p.exitedAt ? <Chip tone="neutral">Inactive</Chip> : null}
                    {perms.can("people.deactivate", p.id) && (
                      <Button
                        size="sm"
                        tone="ghost"
                        title={
                          p.exitedAt
                            ? "Bring this person back into service."
                            : "Deactivation keeps every record they authored — nothing is deleted."
                        }
                        onClick={() => void setActive(p.id, !!p.exitedAt)}
                      >
                        {p.exitedAt ? "Reactivate" : "Deactivate"}
                      </Button>
                    )}
                  </span>
                </div>
              );
            })}
          </div>
        </Panel>
      )}
      <p className="mt-3 text-[11px] text-ink-faint">
        Creating, deactivating and deleting people are People Operations and
        administrator capabilities. No role below that can reset another
        person&rsquo;s password.
      </p>
    </>
  );
}

export function AdminRoles() {
  const roles = useQuery((r) => r.listRoles(), []);
  const people = useQuery((r) => r.listEmployees(), []);
  const perms = usePermissions();
  const [editing, setEditing] = useState<string | null>(null);
  const canEdit = perms.can("people.change_role");

  const [assign, assignState] = useAction(
    (r, employeeId: string, roleIds: string[]) =>
      r.assignRoles(employeeId, roleIds),
  );

  const role = (roles.data ?? []).find((r) => r.id === editing) ?? null;

  return (
    <>
      <WorkspaceHead
        title="Roles and permissions"
        count={roles.data ? `${roles.data.length} roles` : undefined}
        tabs={<IconTabs items={ADMIN_TABS} active="roles" />}
      />

      {!canEdit && perms.ready && (
        <div className="mb-3">
          <InlineError message="You can read this configuration but not change it. Role editing needs the change-role capability." />
        </div>
      )}
      {assignState.error && (
        <div className="mb-3">
          <InlineError message={assignState.error} />
        </div>
      )}

      {role ? (
        <RoleEditor
          role={role}
          allCapabilities={ALL_CAPABILITIES}
          canEdit={canEdit}
          onDone={() => setEditing(null)}
        />
      ) : roles.isLoading ? (
        <SkeletonRows rows={6} />
      ) : (
        <>
          <div className="grid gap-3 deck:grid-cols-2">
            {(roles.data ?? []).map((r) => (
              <Panel key={r.id}>
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-ink">
                      {r.displayName}
                    </p>
                    <p className="mt-0.5 text-[11px] text-ink-faint">
                      <span data-figure>{r.key}</span> · archetype{" "}
                      {r.archetype.replace(/_/g, " ")}
                    </p>
                  </div>
                  <Chip title="Higher levels can never be targeted by lower ones">
                    level <span data-figure>{r.administrativeLevel}</span>
                  </Chip>
                </div>
                <ul className="mt-3 max-h-[190px] space-y-1 overflow-y-auto border-t border-hairline pt-2.5 scroll-slim">
                  {r.permissions.map((p) => (
                    <li
                      key={p.id}
                      className="flex items-baseline gap-2 text-xs"
                    >
                      <span className="min-w-0 flex-1 truncate text-ink-muted">
                        {p.capability}
                      </span>
                      <Chip>{p.scope.replace(/_/g, " ")}</Chip>
                    </li>
                  ))}
                </ul>
                <div className="mt-3 flex items-center gap-2 border-t border-hairline pt-2.5">
                  <Button size="sm" onClick={() => setEditing(r.id)}>
                    {canEdit ? "Edit permissions" : "View permissions"}
                  </Button>
                  <span className="text-[11px] text-ink-faint">
                    <span data-figure>
                      {
                        (people.data ?? []).filter((e) =>
                          e.roleIds.includes(r.id),
                        ).length
                      }
                    </span>{" "}
                    holding
                  </span>
                </div>
              </Panel>
            ))}
          </div>

          <Panel className="mt-4">
            <PanelHead
              title="Who holds what"
              sub="Roles are additive — a person's permissions are the union of the roles they hold."
            />
            <ul className="divide-y divide-hairline">
              {(people.data ?? []).map((p) => (
                <li
                  key={p.id}
                  className="flex flex-wrap items-center gap-x-3 gap-y-2 py-2.5"
                >
                  <span className="flex min-w-0 flex-1 items-center gap-2.5">
                    <Avatar initials={p.initials} hue={p.hue} src={p.profilePictureUrl} size="sm" />
                    <span className="min-w-0 truncate text-sm text-ink">
                      {p.displayName}
                    </span>
                  </span>
                  <span className="flex flex-wrap items-center gap-1.5">
                    {(roles.data ?? []).map((r) => {
                      const held = p.roleIds.includes(r.id);
                      return (
                        <button
                          key={r.id}
                          type="button"
                          disabled={!canEdit}
                          aria-pressed={held}
                          onClick={() =>
                            void assign(
                              p.id,
                              held
                                ? p.roleIds.filter((x) => x !== r.id)
                                : [...p.roleIds, r.id],
                            )
                          }
                          className={`rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors disabled:opacity-45 ${
                            held
                              ? "bg-ink text-[var(--body-bg)]"
                              : "bg-[var(--control)] text-ink-muted hover:bg-[var(--control-hover)] hover:text-ink"
                          }`}
                        >
                          {r.displayName}
                        </button>
                      );
                    })}
                  </span>
                </li>
              ))}
            </ul>
          </Panel>
        </>
      )}

      <Panel className="mt-4">
        <h2 className="text-sm font-medium text-ink">Why scope matters</h2>
        <p className="mt-2 max-w-[68ch] text-sm text-ink-muted">
          A permission is a capability <em>and</em> a scope. Legacy had
          capabilities alone, which is how any team lead could see every
          employee&rsquo;s score. Here a manager&rsquo;s capabilities resolve
          through their reporting closure, and an administrative floor makes it
          structurally impossible for a lower level to act on a higher one.
        </p>
      </Panel>
    </>
  );
}

/**
 * The audit log page.
 *
 * A thin wrapper: the panel refuses for itself, from the repository, so this
 * does not repeat the check. Two copies of one permission is how a page comes
 * to show a heading over a refusal.
 */
export function AdminAuditLog() {
  return (
    <>
      <WorkspaceHead
        title="Audit log"
        count="System settings changes"
        tabs={<IconTabs items={ADMIN_TABS} active="audit" />}
      />
      <AuditLog />
    </>
  );
}
