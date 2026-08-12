"use client";

import { useState } from "react";
import Link from "next/link";
import { Avatar } from "@/components/ui/Avatar";
import { IconTabs, WorkspaceHead, Breadcrumb } from "@/components/ui/Workspace";
import { ComponentBand } from "@/components/ui/ComponentBand";
import {
  Button,
  Chip,
  EmptyState,
  ErrorState,
  Meter,
  Panel,
  PanelHead,
  PermissionDenied,
  ProvisionalBadge,
  Segmented,
  SkeletonRows,
} from "@/components/ui/Primitives";
import { ApplyConductRule } from "@/components/features/score/ConductArea";
import { PersonMonitor } from "./PersonMonitor";
import { TeamCards } from "./TeamCards";
import { PersonCalendar } from "./PersonCalendar";
import { useQuery } from "@/lib/hooks/useRepository";
import { usePermissions } from "@/lib/hooks/usePermissions";
import { useDutyModes } from "@/lib/hooks/useDutyMode";
import { totalMeasured } from "@/lib/rules/scoring/scoreDisplay";
import { STATUS_META } from "@/lib/status/employeeStatus";
import { formatDate, formatPoints } from "@/lib/utils/format";
import type { DutyMode } from "@/lib/rules/presence/duty";

/**
 * Team surfaces.
 *
 * Scope is the whole point: a manager sees only their reporting closure, and
 * comparison flows one way — down the chain, never up or sideways. Legacy let
 * any team lead see every employee's score; that does not carry forward.
 */

export function TeamRoster() {
  const viewer = useQuery((r) => r.getViewer(), []);
  const people = useQuery((r) => r.listEmployees(), []);
  const { isLoading, error, refetch } = people;

  const reports = (people.data ?? []).filter((e) =>
    viewer.data?.hierarchyIds.includes(e.id),
  );
  /* Live presence for the whole roster, from one subscription. This is the
     same `cowork_duty_status` the person's own pill publishes to, with the
     staleness window applied — so a dot goes grey when somebody's laptop
     shuts, without that person's browser having written anything on the way
     out. Reading the document's `mode` directly is what would leave a green
     dot behind for somebody who went home. */
  const duty = useDutyModes(reports.map((p) => p.id));

  /* Two readings of the same roster: the table compares everyone down a few
     columns; the cards give each person's situation — presence, what they're
     on, their load — as one tile. The manager picks which question they're
     asking. */
  const [view, setView] = useState<"list" | "cards">("list");

  if (isLoading) return <SkeletonRows rows={6} />;
  if (error) return <ErrorState body={error} onRetry={refetch} />;

  return (
    <>
      <WorkspaceHead
        title="Team"
        count={
          <>
            <span data-figure>{reports.length}</span> in your reporting line
          </>
        }
        /* Monitoring is deliberately absent from the global bar: it is a
           manager-only surface and a dead entry in everyone else's navigation
           would be worse than a link from the place they already look. */
        action={
          reports.length > 0 ? (
            <div className="flex items-center gap-2">
              <Segmented
                label="Team view"
                size="sm"
                value={view}
                onChange={setView}
                options={[
                  { id: "list", label: "List" },
                  { id: "cards", label: "Cards" },
                ]}
              />
              <Link
                href="/manager"
                className="inline-flex items-center gap-1.5 rounded-full bg-[var(--control)] px-3.5 py-1.5 text-xs font-medium text-ink transition-colors hover:bg-[var(--control-hover)]"
              >
                Live monitoring
              </Link>
            </div>
          ) : undefined
        }
      />

      {!reports.length ? (
        <Panel>
          <PermissionDenied
            what="a team view"
            reason="You have no direct or indirect reports. Team surfaces appear once people report to you."
          />
        </Panel>
      ) : (
        <>
          {view === "list" ? (
            <Panel padded={false} className="mb-4">
              <div className="hidden grid-cols-[minmax(0,1fr)_120px_110px_90px_90px_90px] items-center gap-2 border-b border-hairline px-4 py-1.5 text-[11px] tracking-[0.09em] text-ink-faint uppercase deck:grid">
                <span>Person</span>
                <span>Score</span>
                <span>Open tasks</span>
                <span className="text-right">Overdue</span>
                <span className="text-right">In review</span>
                <span className="text-right">Rework</span>
              </div>
              <div className="divide-y divide-hairline">
                {reports.map((p) => (
                  <PersonRow
                    key={p.id}
                    id={p.id}
                    duty={duty.get(p.id) ?? null}
                  />
                ))}
              </div>
            </Panel>
          ) : (
            <div className="mb-4">
              <TeamCards reports={reports} duty={duty} />
            </div>
          )}

          <p className="text-[11px] text-ink-faint">
            Comparison is visible only looking down the reporting chain. The
            people listed here cannot see each other&rsquo;s figures.
          </p>
        </>
      )}
    </>
  );
}

function PersonRow({ id, duty }: { id: string; duty: DutyMode | null }) {
  const person = useQuery((r) => r.getEmployee(id), [id]);
  const score = useQuery((r) => r.getScoreOverview(id), [id]);
  const tasks = useQuery(
    (r) => r.listTasks({ scope: "all", assigneeId: id }).then((p) => p.items),
    [id],
  );

  const list = tasks.data ?? [];
  const open = list.filter(
    (t) => t.task.status !== "completed" && t.task.status !== "cancelled",
  );
  const overdue = list.filter((t) => t.isOverdue);
  const inReview = list.filter((t) => t.task.status === "in_review");
  const rework = list.reduce((s, t) => s + t.reworkCount, 0);

  if (!person.data)
    return (
      <div className="px-4 py-3">
        <SkeletonRows rows={1} />
      </div>
    );
  const p = person.data;

  return (
    <Link
      href={`/team/${id}`}
      className="grid grid-cols-1 gap-2 px-4 py-2.5 transition-colors hover:bg-[var(--control)] deck:grid-cols-[minmax(0,1fr)_120px_110px_90px_90px_90px] deck:items-center"
    >
      <span className="flex items-center gap-2.5">
        <Avatar
          initials={p.initials}
          hue={p.hue}
          src={p.profilePictureUrl}
          name={p.displayName}
          size="sm"
        />
        <span className="min-w-0">
          <span className="flex items-center gap-1.5">
            {/* The state's own colour from the shared palette, so this dot and
                the person's own pill cannot drift apart. Absent — not grey —
                while presence is still resolving: a grey dot is the claim
                "offline", and we do not know that yet. */}
            {duty !== null && (
              <span
                aria-hidden
                className="h-1.5 w-1.5 shrink-0 rounded-full"
                style={{ background: STATUS_META[duty].dot }}
              />
            )}
            <span className="truncate text-sm text-ink">{p.displayName}</span>
            {duty !== null && (
              <span className="sr-only">{STATUS_META[duty].label}</span>
            )}
          </span>
          <span className="block truncate text-[11px] text-ink-faint">
            {p.designation} · {p.departmentName}
          </span>
        </span>
      </span>

      <span>
        {score.data ? (
          <>
            <Meter
              value={score.data.overallPercentage}
              announce={score.data.overallPercentage}
              label={`${p.displayName} score`}
            />
            <span data-figure className="mt-1 block text-[11px] text-ink">
              {Math.round(score.data.overallPercentage)}%
            </span>
          </>
        ) : (
          <span className="block h-1 rounded-full bg-[var(--control)]" />
        )}
      </span>

      <span data-figure className="text-sm text-ink">
        {open.length}
      </span>
      <span
        data-figure
        className={`text-right text-sm ${overdue.length ? "text-[var(--state-overdue-ink)]" : "text-ink-faint"}`}
      >
        {overdue.length}
      </span>
      <span data-figure className="text-right text-sm text-ink-faint">
        {inReview.length}
      </span>
      <span
        data-figure
        className={`text-right text-sm ${rework ? "text-[var(--state-rework-ink)]" : "text-ink-faint"}`}
      >
        {rework}
      </span>
    </Link>
  );
}

/* ── One person ───────────────────────────────────────────────────────────── */

type PersonTab = "overview" | "tasks" | "score" | "attendance" | "calendar";

export function PersonPage({
  employeeId,
  tab,
}: {
  employeeId: string;
  tab: PersonTab;
}) {
  const viewer = useQuery((r) => r.getViewer(), []);
  const person = useQuery((r) => r.getEmployee(employeeId), [employeeId]);
  const score = useQuery((r) => r.getScoreOverview(employeeId), [employeeId]);
  const attendance = useQuery(
    (r) => r.listAttendance(employeeId, "2026-06-01", "2026-07-25"),
    [employeeId],
  );

  if (person.isLoading || viewer.isLoading) return <SkeletonRows rows={8} />;
  if (!person.data)
    return (
      <Panel>
        <ErrorState title="Person not found" />
      </Panel>
    );

  const inScope =
    viewer.data?.hierarchyIds.includes(employeeId) ||
    viewer.data?.employeeId === employeeId;

  const p = person.data;
  const tabs = [
    {
      id: "overview",
      label: "Overview",
      href: `/team/${employeeId}`,
      icon: "user" as const,
    },
    {
      id: "tasks",
      label: "Tasks",
      href: `/team/${employeeId}/tasks`,
      icon: "tasks" as const,
    },
    {
      id: "calendar",
      label: "Calendar",
      href: `/team/${employeeId}/calendar`,
      icon: "calendar" as const,
    },
    {
      id: "score",
      label: "Score",
      href: `/team/${employeeId}/score`,
      icon: "score" as const,
    },
    {
      id: "attendance",
      label: "Attendance",
      href: `/team/${employeeId}/attendance`,
      icon: "calendar" as const,
    },
  ];

  const nav = (
    <div className="border-b border-hairline pb-2">
      <IconTabs items={tabs} active={tab} />
    </div>
  );

  /* The overview tab carries the person on a hero slab and owns its own
     header, so the compact one below would be the same identity stated twice
     in a row. Every other tab keeps it: they are content surfaces, and a hero
     on each would spend the view's one stepped silhouette on furniture. */
  const heroTab = tab === "overview" && inScope;

  return (
    <>
      <Breadcrumb
        items={[{ label: "Team", href: "/team" }, { label: p.displayName }]}
      />

      {!heroTab && (
        <div className="mt-2 mb-4">
          <div className="flex flex-wrap items-center gap-3">
            <Avatar
              initials={p.initials}
              hue={p.hue}
              src={p.profilePictureUrl}
              name={p.displayName}
              size="lg"
            />
            <div className="min-w-0">
              <h1 className="text-[clamp(1.25rem,1.9vw,1.625rem)] leading-tight font-light tracking-[-0.03em] text-ink">
                {p.displayName}
              </h1>
              <p className="mt-0.5 text-sm text-ink-muted">
                {p.designation} · {p.departmentName} ·{" "}
                <span data-figure className="text-ink-faint">
                  {p.employeeCode}
                </span>
              </p>
            </div>
            {score.data && inScope && (
              <span className="ml-auto flex items-baseline gap-2 rounded-full bg-[var(--control)] px-3.5 py-1.5">
                <span
                  data-figure
                  className="text-[22px] leading-none tracking-[-0.025em] text-ink"
                >
                  {Math.round(score.data.overallPercentage)}%
                </span>
                <span data-figure className="text-xs text-ink-muted">
                  {score.data.delta >= 0 ? "↑" : "↓"}
                  {Math.abs(Math.round(score.data.delta))}
                </span>
              </span>
            )}
          </div>
          <div className="mt-3">{nav}</div>
        </div>
      )}

      {!inScope ? (
        <Panel>
          <PermissionDenied
            what={`${p.firstName}'s record`}
            reason="Visibility follows the reporting hierarchy. You can see the people who report to you, and your own record."
          />
        </Panel>
      ) : (
        <>
          {tab === "overview" && (
            <PersonMonitor employeeId={employeeId} nav={nav} />
          )}

          {tab === "tasks" && <PersonTasks employeeId={employeeId} />}

          {tab === "calendar" && <PersonCalendar employeeId={employeeId} />}

          {tab === "score" && score.data && (
            <div className="grid grid-cols-1 items-start gap-4 deck:grid-cols-12">
              <div className="deck:col-span-7">
                <div
                  className="slab-wrap"
                  style={{ "--tab-rise": "52px" } as React.CSSProperties}
                >
                  <div className="slab">
                    <div
                      className="slab-content absolute left-0 px-5"
                      style={{ top: "-38px" }}
                    >
                      <Avatar
                        initials={p.initials}
                        hue={p.hue}
                        src={p.profilePictureUrl}
                        name={p.displayName}
                        size="md"
                      />
                    </div>
                    <div className="slab-content px-5 pt-5 pb-5">
                      <p className="text-xs text-slab-ink-muted">
                        Achieved against achievable
                      </p>
                      <p className="mt-1.5 flex items-baseline gap-2">
                        <span
                          data-figure
                          className="text-4xl leading-none font-light tracking-[-0.035em] text-slab-ink"
                        >
                          {Math.round(score.data.overallPercentage)}%
                        </span>
                        {/* No composite point total — see ComponentBand. */}
                        <span
                          data-figure
                          className="text-xs text-slab-ink-muted"
                        >
                          {totalMeasured(score.data) ?? "—"} measured
                        </span>
                      </p>
                    </div>
                    <div className="slab-content px-5 pb-5">
                      <ComponentBand
                        channels={score.data.channels}
                        height={64}
                        verbose={false}
                      />
                    </div>
                  </div>
                </div>
              </div>
              <div className="deck:col-span-5 space-y-4">
                <PersonLedger employeeId={employeeId} />
                {/* C3 · applying a conduct rule to this person.
                    Here as well as on `/score/c3`, because a manager decides a
                    breach while looking at the record it belongs to — and the
                    person is already chosen by the page, so this form does not
                    ask again. The engine refuses anyone but their own primary
                    manager regardless of what is on screen. */}
                <ApplyConduct employeeId={employeeId} name={p.firstName} />
              </div>
            </div>
          )}

          {tab === "attendance" && (
            <Panel padded={false}>
              <div className="border-b border-hairline px-5 py-3">
                <h2 className="text-sm font-medium text-ink">Attendance</h2>
              </div>
              <AttendanceList
                days={attendance.data ?? []}
                loading={attendance.isLoading}
              />
            </Panel>
          )}
        </>
      )}
    </>
  );
}

function PersonTasks({
  employeeId,
  compact,
}: {
  employeeId: string;
  compact?: boolean;
}) {
  const { data, isLoading } = useQuery(
    (r) =>
      r
        .listTasks({ scope: "all", assigneeId: employeeId, sort: "rank" })
        .then((p) => p.items),
    [employeeId],
  );
  if (isLoading)
    return (
      <div className="px-5 py-3">
        <SkeletonRows rows={5} />
      </div>
    );
  if (!data?.length) return <EmptyState compact title="No tasks assigned" />;

  const rows = compact ? data.slice(0, 8) : data;
  return (
    <div className="divide-y divide-hairline">
      {rows.map((v) => (
        <Link
          key={v.task.id}
          href={`/tasks/${v.task.id}`}
          className="flex items-center gap-3 px-5 py-2.5 transition-colors hover:bg-[var(--control)]"
        >
          <span
            data-figure
            className="shrink-0 rounded-full bg-[var(--control)] px-1.5 py-0.5 text-[11px] text-ink-muted"
          >
            P
            {v.assignments.find((a) => a.employeeId === employeeId)?.rank ??
              "—"}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm text-ink">
              {v.task.title}
            </span>
            <span className="mt-0.5 block truncate text-[11px] text-ink-faint">
              {v.project?.name ?? "No project"}
              {v.task.deadline.dueAt &&
                ` · ${formatDate(v.task.deadline.dueAt)}`}
            </span>
          </span>
          {v.isOverdue && <Chip tone="overdue">Overdue</Chip>}
          {v.task.isBlocked && <Chip tone="blocked">Blocked</Chip>}
        </Link>
      ))}
    </div>
  );
}

/**
 * "Apply a conduct rule" on somebody's own record.
 *
 * Hidden entirely from anybody who cannot charge this person — a control that
 * exists only to be refused teaches people the interface is lying to them. The
 * permission check is the same `can()` the repository calls, so the button and
 * the write agree; the engine asks the reporting line again and has the final
 * word.
 */
function ApplyConduct({
  employeeId,
  name,
}: {
  employeeId: string;
  name: string;
}) {
  const perms = usePermissions();
  const [open, setOpen] = useState(false);

  if (!perms.can("conduct.apply", employeeId)) return null;

  return (
    <Panel>
      <PanelHead
        title="Conduct"
        sub={`Records a breach against ${name}. They are told, and can dispute it.`}
        aside={
          !open ? (
            <Button size="sm" onClick={() => setOpen(true)}>
              Apply a rule
            </Button>
          ) : undefined
        }
      />
      {open && (
        <ApplyConductRule
          employeeId={employeeId}
          onDone={() => setOpen(false)}
        />
      )}
    </Panel>
  );
}

function PersonLedger({ employeeId }: { employeeId: string }) {
  const { data, isLoading } = useQuery(
    (r) => r.listLedger(employeeId),
    [employeeId],
  );
  return (
    <Panel padded={false}>
      <div className="flex items-center gap-2 border-b border-hairline px-4 py-2">
        <h2 className="text-sm font-medium text-ink">Score events</h2>
        <span data-figure className="text-xs text-ink-faint">
          {data?.length ?? 0}
        </span>
      </div>
      {isLoading ? (
        <div className="px-4 py-3">
          <SkeletonRows rows={4} />
        </div>
      ) : !data?.length ? (
        <EmptyState compact title="No score events" />
      ) : (
        <div className="max-h-[420px] divide-y divide-hairline overflow-y-auto scroll-slim">
          {data.slice(0, 30).map((e) => (
            <div key={e.id} className="px-4 py-2">
              <div className="flex items-baseline gap-2">
                <span className="truncate text-xs text-ink">
                  {e.sourceLabel}
                </span>
                <span
                  data-figure
                  className={`ml-auto shrink-0 text-xs ${
                    e.credit > 0
                      ? "text-[var(--state-positive-ink)]"
                      : "text-[var(--state-rework-ink)]"
                  }`}
                >
                  {e.credit > 0 ? "+" : "−"}
                  {formatPoints(e.credit > 0 ? e.credit : e.deduction)}
                </span>
              </div>
              <p className="mt-0.5 flex items-center gap-1.5 text-[11px] text-ink-faint">
                {e.component.toUpperCase()} · {e.effectiveDate}
                {e.isProvisional && <ProvisionalBadge />}
              </p>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}

export function AttendanceList({
  days,
  loading,
}: {
  days: import("@/lib/domain").AttendanceDay[];
  loading: boolean;
}) {
  if (loading)
    return (
      <div className="px-5 py-3">
        <SkeletonRows rows={6} />
      </div>
    );
  if (!days.length) return <EmptyState compact title="No attendance records" />;

  return (
    <div className="divide-y divide-hairline">
      {days.slice(0, 40).map((d) => (
        <div key={d.id} className="flex items-center gap-3 px-5 py-2">
          <span data-figure className="w-24 shrink-0 text-xs text-ink">
            {d.date}
          </span>
          <Chip
            tone={
              d.status === "absent"
                ? "overdue"
                : d.status === "half_day"
                  ? "risk"
                  : d.status === "leave" ||
                      d.status === "holiday" ||
                      d.status === "week_off"
                    ? "neutral"
                    : "positive"
            }
          >
            {d.status.replace(/_/g, " ")}
          </Chip>
          <span className="min-w-0 flex-1 truncate text-xs text-ink-faint">
            {d.actualStart && d.actualEnd
              ? `${d.actualStart} – ${d.actualEnd}`
              : "—"}
          </span>
          {d.lateMinutes > 0 && (
            <span
              data-figure
              className="shrink-0 text-xs text-[var(--state-rework-ink)]"
            >
              {d.lateMinutes}m late
            </span>
          )}
          {d.earlyDepartureMinutes > 0 && (
            <span
              data-figure
              className="shrink-0 text-xs text-[var(--state-rework-ink)]"
            >
              {d.earlyDepartureMinutes}m early
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center gap-3">
      <dt className="w-24 shrink-0 text-xs text-ink-faint">{label}</dt>
      <dd className="min-w-0 flex-1 truncate text-sm text-ink">{value}</dd>
    </div>
  );
}

/* ── Directory ────────────────────────────────────────────────────────────── */

export function PeopleDirectory() {
  const { data, isLoading } = useQuery((r) => r.listEmployees(), []);
  const viewer = useQuery((r) => r.getViewer(), []);

  return (
    <>
      <WorkspaceHead
        title="People"
        count={data ? `${data.length} in the organisation` : undefined}
      />
      {isLoading ? (
        <SkeletonRows rows={8} />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 deck:grid-cols-3">
          {(data ?? []).map((p) => {
            const inScope =
              viewer.data?.hierarchyIds.includes(p.id) ||
              viewer.data?.employeeId === p.id;
            return (
              <Panel key={p.id}>
                <div className="flex items-start gap-2.5">
                  <Avatar
                    initials={p.initials}
                    hue={p.hue}
                    src={p.profilePictureUrl}
                    name={p.displayName}
                    size="md"
                  />
                  <div className="min-w-0 flex-1">
                    <Link
                      href={inScope ? `/team/${p.id}` : `/people/${p.id}`}
                      className="block truncate text-sm font-medium text-ink"
                    >
                      {p.displayName}
                    </Link>
                    <p className="mt-0.5 truncate text-[11px] text-ink-faint">
                      {p.designation}
                    </p>
                    <p className="truncate text-[11px] text-ink-faint">
                      {p.departmentName}
                    </p>
                  </div>
                </div>
                {!inScope && (
                  <p className="mt-3 border-t border-hairline pt-2.5 text-[11px] text-ink-faint">
                    Outside your reporting line — no score visible.
                  </p>
                )}
              </Panel>
            );
          })}
        </div>
      )}
    </>
  );
}

export function PersonProfile({ employeeId }: { employeeId: string }) {
  const person = useQuery((r) => r.getEmployee(employeeId), [employeeId]);
  const viewer = useQuery((r) => r.getViewer(), []);
  if (person.isLoading) return <SkeletonRows rows={6} />;
  if (!person.data)
    return (
      <Panel>
        <ErrorState title="Person not found" />
      </Panel>
    );
  const p = person.data;
  const inScope =
    viewer.data?.hierarchyIds.includes(employeeId) ||
    viewer.data?.employeeId === employeeId;

  return (
    <>
      <Breadcrumb
        items={[{ label: "People", href: "/people" }, { label: p.displayName }]}
      />
      <div className="mt-2 mb-4 flex flex-wrap items-center gap-3">
        <Avatar
          initials={p.initials}
          hue={p.hue}
          src={p.profilePictureUrl}
          name={p.displayName}
          size="lg"
        />
        <div>
          <h1 className="text-[clamp(1.25rem,1.9vw,1.625rem)] leading-tight font-light tracking-[-0.03em] text-ink">
            {p.displayName}
          </h1>
          <p className="mt-0.5 text-sm text-ink-muted">
            {p.designation} · {p.departmentName}
          </p>
        </div>
      </div>
      <div className="grid gap-4 deck:grid-cols-2">
        <Panel>
          <h2 className="mb-3 text-sm font-medium text-ink">Profile</h2>
          <dl className="space-y-2.5">
            <Row label="Employee code" value={p.employeeCode} />
            <Row label="Department" value={p.departmentName ?? "—"} />
            <Row label="Designation" value={p.designation ?? "—"} />
            <Row label="Joined" value={formatDate(p.joinedAt)} />
            <Row label="Timezone" value={p.timezone} />
          </dl>
        </Panel>
        <Panel>
          {inScope ? (
            <>
              <h2 className="mb-2 text-sm font-medium text-ink">Performance</h2>
              <p className="text-sm text-ink-muted">
                This person is in your reporting line.{" "}
                <Link href={`/team/${employeeId}`} className="text-ink">
                  Open their team record ›
                </Link>
              </p>
            </>
          ) : (
            <PermissionDenied
              what="performance data"
              reason="Score visibility follows the reporting hierarchy. This person is outside yours."
            />
          )}
        </Panel>
      </div>
    </>
  );
}
