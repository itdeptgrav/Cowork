"use client";

import { isActivePriorityTask } from "@/lib/rules/tasks/activeQueue";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Avatar } from "@/components/ui/Avatar";
import { Icon } from "@/components/ui/Icons";
import { Breadcrumb } from "@/components/ui/Workspace";
import {
  Button,
  Chip,
  Field,
  InlineError,
  Input,
  Meter,
  Panel,
  PanelHead,
  PermissionDenied,
  QueryError,
  Select,
  SkeletonRows,
} from "@/components/ui/Primitives";
import { useAction, useQuery } from "@/lib/hooks/useRepository";
import { usePermissions } from "@/lib/hooks/usePermissions";
import { formatDate, formatDateTime } from "@/lib/utils/format";
import type { Employee } from "@/lib/domain";

/**
 * One employee, for an administrator.
 *
 * Every action here already existed on the repository with its own permission
 * check — `updateEmployee`, `setEmployeeDepartment`, `assignRoles`,
 * `setReportingManager`, `setEmployeeActive`. This is a surface over them, not
 * a new administrative capability, which is why the page can be honest about
 * refusals: it renders what `can()` allows and the repository refuses the rest
 * regardless of what the screen showed.
 *
 * The one genuinely new thing is the SECURITY panel, and it is the only part
 * that crosses into the server: whether this person has an account, when they
 * last used it, and the ability to issue a sign-in link. Everything else is
 * workspace data.
 *
 * **Nothing here is invented.** Where a model does not exist — last login for
 * somebody with no account, a score for a person with no units — the panel says
 * so rather than showing a zero that reads as a measurement.
 */
export function EmployeeProfile({ employeeId }: { employeeId: string }) {
  const perms = usePermissions();
  const person = useQuery((r) => r.getEmployee(employeeId), [employeeId]);
  const roles = useQuery((r) => r.listRoles(), []);
  const departments = useQuery((r) => r.listDepartments(), []);
  const people = useQuery((r) => r.listEmployees(), []);
  const reporting = useQuery((r) => r.listReporting(), []);

  if (person.isLoading || !perms.ready) return <SkeletonRows rows={10} />;
  if (person.error)
    return (
      <QueryError
        queries={[person]}
        message="This employee could not be loaded."
      />
    );
  if (!person.data)
    return (
      <Panel>
        <PermissionDenied
          what="this employee"
          reason="No employee with that id exists in this workspace."
        />
      </Panel>
    );

  const p = person.data;
  const manager = reporting.data?.find(
    (r) => r.employeeId === p.id && !r.effectiveTo,
  );
  const managerName = people.data?.find(
    (e) => e.id === manager?.managerId,
  )?.displayName;

  const refetchAll = () => {
    person.refetch();
    people.refetch();
    reporting.refetch();
  };

  return (
    <>
      <Breadcrumb
        items={[
          { label: "People", href: "/admin/people" },
          { label: p.displayName },
        ]}
      />

      <Header person={p} managerName={managerName ?? null} />

      <div className="mt-4 grid items-start gap-4 deck:grid-cols-12">
        <div className="flex flex-col gap-4 deck:col-span-7">
          <DetailsPanel person={p} onSaved={refetchAll} />
          <PlacementPanel
            person={p}
            departments={departments.data ?? []}
            roles={roles.data ?? []}
            people={people.data ?? []}
            currentManagerId={manager?.managerId ?? null}
            onSaved={refetchAll}
          />
          <ActivityPanel employeeId={p.id} />
        </div>

        <div className="flex flex-col gap-4 deck:col-span-5">
          <SecurityPanel person={p} />
          <DangerPanel person={p} onSaved={refetchAll} />
        </div>
      </div>
    </>
  );
}

/* ── Header ───────────────────────────────────────────────────────────────── */

function Header({
  person: p,
  managerName,
}: {
  person: Employee;
  managerName: string | null;
}) {
  return (
    <div className="mt-2 flex flex-wrap items-center gap-4">
      <Avatar initials={p.initials} hue={p.hue} name={p.displayName} size="lg" />
      <div className="min-w-0 flex-1">
        <h1 className="truncate text-[clamp(1.25rem,1.9vw,1.625rem)] leading-tight font-light tracking-[-0.03em] text-ink">
          {p.displayName}
        </h1>
        <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-sm text-ink-muted">
          <span className="truncate">{p.email ?? "No email on file"}</span>
          <span className="text-ink-faint">·</span>
          <span data-figure className="text-ink-faint">
            {p.employeeCode}
          </span>
        </p>
        <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-ink-faint">
          <span>{p.designation ?? "No designation"}</span>
          <span>·</span>
          <span>{p.departmentName ?? "No department"}</span>
          <span>·</span>
          <span>Reports to {managerName ?? "nobody"}</span>
          {p.joinedAt && (
            <>
              <span>·</span>
              <span>Joined {formatDate(p.joinedAt)}</span>
            </>
          )}
        </p>
      </div>
      <Chip tone={p.exitedAt ? "overdue" : "positive"}>
        {p.exitedAt ? "Deactivated" : "Active"}
      </Chip>
      <Link
        href={`/team/${p.id}`}
        className="shrink-0 rounded-full bg-[var(--control)] px-3.5 py-1.5 text-xs text-ink transition-colors hover:bg-[var(--control-hover)]"
      >
        Open their record
      </Link>
    </div>
  );
}

/* ── Details ──────────────────────────────────────────────────────────────── */

function DetailsPanel({
  person: p,
  onSaved,
}: {
  person: Employee;
  onSaved: () => void;
}) {
  const perms = usePermissions();
  const [firstName, setFirst] = useState(p.firstName);
  const [lastName, setLast] = useState(p.lastName);
  const [email, setEmail] = useState(p.email ?? "");
  const [designation, setDesignation] = useState(p.designation ?? "");
  const [saved, setSaved] = useState(false);

  const [save, state] = useAction((r) =>
    r.updateEmployee(p.id, {
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      email: email.trim(),
      designation: designation.trim() || null,
    }),
  );

  const may = perms.can("people.change_reporting", p.id);
  const dirty =
    firstName !== p.firstName ||
    lastName !== p.lastName ||
    email !== (p.email ?? "") ||
    designation !== (p.designation ?? "");

  return (
    <Panel label="Details">
      <PanelHead
        title="Details"
        sub="Their name as it appears everywhere, and the address invitations go to."
      />
      {state.error && (
        <div className="mb-3">
          <InlineError message={state.error} code={state.errorCode} />
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="First name">
          <Input
            value={firstName}
            disabled={!may}
            onChange={(e) => setFirst(e.target.value)}
          />
        </Field>
        <Field label="Last name">
          <Input
            value={lastName}
            disabled={!may}
            onChange={(e) => setLast(e.target.value)}
          />
        </Field>
        <Field label="Work email" className="sm:col-span-2">
          <Input
            type="email"
            value={email}
            disabled={!may}
            onChange={(e) => setEmail(e.target.value)}
          />
        </Field>
        <Field label="Designation" className="sm:col-span-2">
          <Input
            value={designation}
            disabled={!may}
            onChange={(e) => setDesignation(e.target.value)}
          />
        </Field>
      </div>
      {may && (
        <div className="mt-4 flex items-center gap-3">
          <Button
            size="sm"
            tone="primary"
            disabled={!dirty || state.isPending}
            onClick={async () => {
              const r = await save();
              if (r.ok) {
                setSaved(true);
                onSaved();
              }
            }}
          >
            {state.isPending ? "Saving…" : "Save details"}
          </Button>
          {saved && !dirty && (
            <span className="text-xs text-[var(--state-positive-ink)]">
              Saved
            </span>
          )}
        </div>
      )}
    </Panel>
  );
}

/* ── Placement: department, roles, manager ────────────────────────────────── */

function PlacementPanel({
  person: p,
  departments,
  roles,
  people,
  currentManagerId,
  onSaved,
}: {
  person: Employee;
  departments: { id: string; name: string }[];
  roles: { id: string; displayName: string; administrativeLevel: number }[];
  people: Employee[];
  currentManagerId: string | null;
  onSaved: () => void;
}) {
  const perms = usePermissions();
  const mayRole = perms.can("people.change_role", p.id);
  const mayReport = perms.can("people.change_reporting", p.id);

  const [setDept, deptState] = useAction((r, id: string | null) =>
    r.setEmployeeDepartment(p.id, id),
  );
  const [setRoles, roleState] = useAction((r, ids: string[]) =>
    r.assignRoles(p.id, ids),
  );
  const [setManager, mgrState] = useAction((r, id: string | null) =>
    r.setReportingManager(p.id, id),
  );

  const err = deptState.error ?? roleState.error ?? mgrState.error;

  return (
    <Panel label="Placement and access">
      <PanelHead
        title="Placement and access"
        sub="Department, roles and reporting line. Each saves on change."
      />
      {err && (
        <div className="mb-3">
          <InlineError message={err} />
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Department">
          <Select
            value={p.departmentId ?? ""}
            disabled={!mayReport || deptState.isPending}
            onChange={async (e) => {
              const r = await setDept(e.target.value || null);
              if (r.ok) onSaved();
            }}
          >
            <option value="">No department</option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </Select>
        </Field>

        <Field
          label="Reports to"
          hint="A reporting change closes the old line rather than overwriting it."
        >
          <Select
            value={currentManagerId ?? ""}
            disabled={!mayReport || mgrState.isPending}
            onChange={async (e) => {
              const r = await setManager(e.target.value || null);
              if (r.ok) onSaved();
            }}
          >
            <option value="">No manager</option>
            {people
              .filter((x) => x.id !== p.id && !x.exitedAt)
              .map((x) => (
                <option key={x.id} value={x.id}>
                  {x.displayName}
                </option>
              ))}
          </Select>
        </Field>
      </div>

      <div className="mt-4">
        <p className="mb-2 text-xs text-ink-faint">
          Roles decide what this person can do. Nobody may be granted a role at
          or above the level of whoever is granting it.
        </p>
        <div className="flex flex-wrap gap-2">
          {roles.map((role) => {
            const on = p.roleIds.includes(role.id);
            return (
              <button
                key={role.id}
                type="button"
                aria-pressed={on}
                disabled={!mayRole || roleState.isPending}
                onClick={async () => {
                  const next = on
                    ? p.roleIds.filter((id) => id !== role.id)
                    : [...p.roleIds, role.id];
                  const r = await setRoles(next);
                  if (r.ok) onSaved();
                }}
                className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs transition-colors duration-[180ms] disabled:cursor-not-allowed disabled:opacity-45 ${
                  on
                    ? "bg-ink text-[var(--body-bg)]"
                    : "bg-[var(--control)] text-ink hover:bg-[var(--control-hover)]"
                }`}
              >
                {on && <Icon.check className="h-3 w-3" />}
                {role.displayName}
              </button>
            );
          })}
        </div>
      </div>
    </Panel>
  );
}

/* ── Security ─────────────────────────────────────────────────────────────── */

interface AccountFacts {
  hasAccount: boolean;
  status: string | null;
  archetype: string | null;
  lastSeenAt: string | null;
  createdAt: string | null;
  pendingLink: { purpose: string; expiresAt: string } | null;
}

/**
 * The one panel that reads the SERVER's view of this person.
 *
 * Everything else on the page is workspace data from the mock repository; this
 * asks the identity store whether the address can actually sign in. The two are
 * genuinely separate systems and this is the seam, so the panel says which
 * facts come from where rather than presenting one blended picture.
 */
function SecurityPanel({ person: p }: { person: Employee }) {
  const [facts, setFacts] = useState<AccountFacts | null>(null);
  const [loading, setLoading] = useState(true);
  const [link, setLink] = useState<{ url: string; purpose: string } | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const [issuing, setIssuing] = useState(false);
  const [copied, setCopied] = useState(false);

  const email = p.email ?? "";

  const load = async () => {
    if (!email) {
      setFacts(null);
      setLoading(false);
      return;
    }
    try {
      const res = await fetch(
        `/api/auth/admin/account?email=${encodeURIComponent(email)}`,
        { cache: "no-store" },
      );
      const data = await res.json();
      setFacts(data.ok ? data : null);
    } catch {
      setFacts(null);
    }
    setLoading(false);
  };

  useEffect(() => {
    queueMicrotask(() => void load());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [email]);

  async function issue() {
    setIssuing(true);
    setError(null);
    setLink(null);
    try {
      const res = await fetch("/api/auth/admin/credential-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          employeeId: p.id,
          displayName: p.displayName,
        }),
      });
      const data = await res.json();
      if (!data.ok) setError(data.message ?? "That did not work.");
      else {
        setLink({ url: data.link, purpose: data.purpose });
        void load();
      }
    } catch {
      setError("Could not reach the server.");
    }
    setIssuing(false);
  }

  return (
    <Panel label="Sign-in and security">
      <PanelHead
        title="Sign-in and security"
        sub="From the identity store — separate from the workspace record above."
      />

      {!email ? (
        <p className="text-sm leading-relaxed text-ink-muted">
          This person has no email address, so they cannot be invited. Add one in
          Details first.
        </p>
      ) : loading ? (
        <SkeletonRows rows={3} />
      ) : (
        <>
          <dl className="divide-y divide-hairline">
            <Fact
              label="Account"
              value={
                facts?.hasAccount ? (
                  <Chip tone="positive">Can sign in</Chip>
                ) : (
                  <Chip tone="neutral">No sign-in yet</Chip>
                )
              }
            />
            {facts?.hasAccount && (
              <>
                <Fact
                  label="Status"
                  value={facts.status ?? "—"}
                />
                <Fact
                  label="Access level"
                  value={(facts.archetype ?? "—").replace(/_/g, " ")}
                />
                <Fact
                  label="Last signed in"
                  value={
                    facts.lastSeenAt ? (
                      formatDateTime(facts.lastSeenAt)
                    ) : (
                      <span className="text-ink-faint">Never</span>
                    )
                  }
                />
                <Fact
                  label="Account created"
                  value={facts.createdAt ? formatDate(facts.createdAt) : "—"}
                />
              </>
            )}
            <Fact
              label="Method"
              value="Email and password"
            />
            {facts?.pendingLink && (
              <Fact
                label="Outstanding link"
                value={
                  <span className="text-[var(--state-extension-ink)]">
                    {facts.pendingLink.purpose === "invite"
                      ? "Invitation"
                      : "Password reset"}{" "}
                    · expires {formatDateTime(facts.pendingLink.expiresAt)}
                  </span>
                }
              />
            )}
          </dl>

          {error && (
            <div className="mt-3">
              <InlineError message={error} />
            </div>
          )}

          {link && (
            <div className="mt-3 rounded-inset bg-[var(--surface-sunken)] p-3">
              <p className="text-xs font-medium text-ink">
                {link.purpose === "invite"
                  ? "Invitation link"
                  : "Password reset link"}
              </p>
              {/* Shown once and never again — only a hash was stored. Said
                  plainly, because an administrator who dismisses this without
                  copying it has to issue a new one. */}
              <p className="mt-1 text-[11px] leading-relaxed text-ink-muted">
                Copy this now and give it to {p.firstName} yourself. It is shown
                once, works once, and Cowork cannot send it — there is no mail
                service configured.
              </p>
              <div className="mt-2 flex items-center gap-2">
                <code className="min-w-0 flex-1 truncate rounded-inset bg-[var(--surface-raised)] px-2.5 py-1.5 text-[11px] text-ink">
                  {link.url}
                </code>
                <Button
                  size="sm"
                  onClick={() => {
                    void navigator.clipboard?.writeText(link.url);
                    setCopied(true);
                  }}
                >
                  {copied ? "Copied" : "Copy"}
                </Button>
              </div>
            </div>
          )}

          <div className="mt-4 flex flex-wrap gap-2">
            <Button size="sm" disabled={issuing} onClick={issue}>
              {issuing
                ? "Issuing…"
                : facts?.hasAccount
                  ? "Reset password"
                  : "Invite to sign in"}
            </Button>
          </div>
          <p className="mt-2 text-[11px] leading-relaxed text-ink-faint">
            {facts?.hasAccount
              ? "A reset ends every session they have open."
              : "An invitation lets them choose their own password. It does not grant any role — their access comes from the roles above."}
          </p>
        </>
      )}
    </Panel>
  );
}

function Fact({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-2">
      <dt className="shrink-0 text-xs text-ink-faint">{label}</dt>
      <dd className="min-w-0 truncate text-right text-xs text-ink">{value}</dd>
    </div>
  );
}

/* ── Deactivation ─────────────────────────────────────────────────────────── */

function DangerPanel({
  person: p,
  onSaved,
}: {
  person: Employee;
  onSaved: () => void;
}) {
  const perms = usePermissions();
  const [setActive, state] = useAction((r, active: boolean) =>
    r.setEmployeeActive(p.id, active),
  );
  if (!perms.can("people.deactivate", p.id)) return null;

  return (
    <Panel label="Employment">
      <PanelHead title="Employment" />
      {state.error && (
        <div className="mb-3">
          <InlineError message={state.error} />
        </div>
      )}
      <p className="text-sm leading-relaxed text-ink-muted">
        {p.exitedAt
          ? "This person is deactivated. Reactivating restores their access and puts them back on team lists."
          : "Deactivation keeps every record they authored — submissions, reviews and ledger entries all still cite them. Nothing is deleted."}
      </p>
      <div className="mt-4">
        <Button
          size="sm"
          tone={p.exitedAt ? "secondary" : "destructive"}
          disabled={state.isPending}
          onClick={async () => {
            const r = await setActive(!!p.exitedAt);
            if (r.ok) onSaved();
          }}
        >
          {state.isPending
            ? "Working…"
            : p.exitedAt
              ? "Reactivate"
              : "Deactivate"}
        </Button>
      </div>
    </Panel>
  );
}

/* ── Activity ─────────────────────────────────────────────────────────────── */

/**
 * What the workspace already knows about this person's work.
 *
 * Reads existing feeds only — tasks and the score overview. Where a figure has
 * no data behind it the panel says so; a zero here would read as "measured at
 * nothing" rather than "not measured", and the score model is explicit that a
 * component with no units is the latter.
 */
function ActivityPanel({ employeeId }: { employeeId: string }) {
  const tasks = useQuery(
    (r) =>
      r.listTasks({ scope: "all", assigneeId: employeeId }).then((p) => p.items),
    [employeeId],
  );
  const score = useQuery((r) => r.getScoreOverview(employeeId), [employeeId]);

  const list = tasks.data ?? [];
  /* The shared rule, not "not finished". A task whose hours are still being
     agreed is real work that has not been committed to — counting it shows
     capacity as blocked by something neither side has accepted. */
  const open = list.filter(isActivePriorityTask);
  const done = list.filter((t) => t.task.status === "completed");
  const overdue = list.filter((t) => t.isOverdue);

  return (
    <Panel label="Activity">
      <PanelHead
        title="Activity"
        sub="From the workspace. Read-only here — manage the work itself in Tasks."
        aside={
          <Link href={`/team/${employeeId}/tasks`} className="text-ink">
            Open their tasks ›
          </Link>
        }
      />

      {tasks.isLoading ? (
        <SkeletonRows rows={3} />
      ) : tasks.error ? (
        <QueryError
          compact
          queries={[tasks]}
          message="Their work could not be loaded."
        />
      ) : (
        <>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
            <Stat label="Assigned" value={String(list.length)} />
            <Stat label="Open" value={String(open.length)} />
            <Stat label="Completed" value={String(done.length)} />
            <Stat
              label="Overdue"
              value={String(overdue.length)}
              alert={overdue.length > 0}
            />
          </dl>

          <div className="mt-4 border-t border-hairline pt-3">
            <p className="mb-1.5 text-xs text-ink-faint">Current workload</p>
            {open.length === 0 ? (
              <p className="text-sm text-ink-muted">Nothing open.</p>
            ) : (
              <>
                <Meter
                  value={Math.min(100, (open.length / 12) * 100)}
                  announce={open.length}
                  label="Open tasks against a nominal twelve"
                  tone={open.length > 10 ? "overdue" : undefined}
                />
                <p className="mt-1.5 text-[11px] text-ink-faint">
                  <span data-figure>{open.length}</span> open, against a nominal
                  twelve. Cowork has no committed-capacity model yet, so this is
                  a count rather than a measurement.
                </p>
              </>
            )}
          </div>

          <div className="mt-4 border-t border-hairline pt-3">
            <p className="mb-1.5 text-xs text-ink-faint">Performance</p>
            {!score.data ? (
              <p className="text-sm text-ink-muted">No score for this period.</p>
            ) : (
              <>
                <p className="flex items-baseline gap-2">
                  <span
                    data-figure
                    className="text-[22px] leading-none tracking-[-0.025em] text-ink"
                  >
                    {Math.round(score.data.overallPercentage)}%
                  </span>
                  <span data-figure className="text-xs text-ink-muted">
                    {score.data.delta >= 0 ? "↑" : "↓"}
                    {Math.abs(Math.round(score.data.delta))} on the period
                  </span>
                </p>
                <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
                  {score.data.channels.map((c) => (
                    <li key={c.id} className="text-[11px] text-ink-faint">
                      {c.code} · {c.label}{" "}
                      <span data-figure className="text-ink">
                        {c.unitCount === 0
                          ? "not measured"
                          : `${Math.abs(Math.round(c.percentage))}%`}
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>

          <div className="mt-4 border-t border-hairline pt-3">
            <p className="mb-1.5 text-xs text-ink-faint">Recent work</p>
            {list.length === 0 ? (
              <p className="text-sm text-ink-muted">
                Nothing has been assigned to them.
              </p>
            ) : (
              <ul className="divide-y divide-hairline">
                {[...list]
                  .sort((a, b) =>
                    b.task.updatedAt.localeCompare(a.task.updatedAt),
                  )
                  .slice(0, 5)
                  .map((t) => (
                    <li key={t.task.id}>
                      <Link
                        href={`/tasks/${t.task.id}`}
                        className="-mx-2 flex items-baseline gap-2 rounded-inset px-2 py-2 transition-colors hover:bg-[var(--row-hover)]"
                      >
                        <span className="min-w-0 flex-1 truncate text-xs text-ink">
                          {t.task.title}
                        </span>
                        <span className="shrink-0 text-[11px] text-ink-faint">
                          {formatDate(t.task.updatedAt)}
                        </span>
                      </Link>
                    </li>
                  ))}
              </ul>
            )}
          </div>
        </>
      )}
    </Panel>
  );
}

function Stat({
  label,
  value,
  alert,
}: {
  label: string;
  value: string;
  alert?: boolean;
}) {
  return (
    <div className="min-w-0">
      <dt className="truncate text-[11px] text-ink-faint">{label}</dt>
      <dd
        data-figure
        className={`mt-1 text-[22px] leading-none tracking-[-0.025em] ${
          alert ? "text-[var(--state-overdue-ink)]" : "text-ink"
        }`}
      >
        {value}
      </dd>
    </div>
  );
}
