"use client";

import Link from "next/link";
import { useState } from "react";
import { Icon } from "@/components/ui/Icons";
import { AttendanceList } from "@/components/features/team/TeamArea";
import { Breadcrumb, IconTabs, WorkspaceHead } from "@/components/ui/Workspace";
import {
  Button,
  Chip,
  EmptyState,
  ErrorState,
  Meter,
  Panel,
  ProvisionalBadge,
  Segmented,
  SkeletonRows,
  QueryError,
} from "@/components/ui/Primitives";
import { useAction, useQuery } from "@/lib/hooks/useRepository";
import { useViewerId } from "@/lib/hooks/usePermissions";
import { formatDate, formatDateTime, formatPoints } from "@/lib/utils/format";
import {
  notificationHref,
  notificationTarget,
} from "@/lib/rules/notifications/target";
import { usePushRegistration } from "@/lib/hooks/useFCMToken";
import { useCoworkNotifications } from "@/lib/legacy-ui/useCoworkNotifications";

/* ── Goals ────────────────────────────────────────────────────────────────── */

export function GoalsList() {
  const viewerId = useViewerId();
  const { data, isLoading, error, refetch } = useQuery(
    (r) => r.listGoals(viewerId ?? ""),
    [viewerId],
  );

  return (
    <>
      <WorkspaceHead
        title="Goals"
        count={
          data ? (
            <>
              <span data-figure>{data.length}</span> active · C2 · Goal
              Attainment
            </>
          ) : undefined
        }
      />
      {isLoading ? (
        <SkeletonRows rows={5} />
      ) : error ? (
        <ErrorState body={error} onRetry={refetch} />
      ) : !data?.length ? (
        <Panel>
          <EmptyState
            title="No goals"
            body="Goals feed C2 · Goal Attainment."
          />
        </Panel>
      ) : (
        <div className="grid gap-3 deck:grid-cols-2">
          {data.map((g) => {
            const pct = g.targetValue
              ? Math.round((g.achievedValue / g.targetValue) * 100)
              : 0;
            return (
              <Panel key={g.id}>
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <Link
                      href={`/goals/${g.id}`}
                      className="block text-sm font-medium text-ink"
                    >
                      {g.title}
                    </Link>
                    {g.description && (
                      <p className="mt-0.5 text-xs text-ink-muted">
                        {g.description}
                      </p>
                    )}
                  </div>
                  <Chip>{g.periodKey}</Chip>
                </div>
                <div className="mt-3">
                  <div className="flex items-baseline justify-between">
                    <span className="text-[11px] text-ink-faint">
                      Attainment
                    </span>
                    <span data-figure className="text-xs text-ink">
                      {g.achievedValue} / {g.targetValue} {g.unit}
                    </span>
                  </div>
                  <Meter
                    value={pct}
                    label={`${g.title} progress`}
                    className="mt-1.5"
                  />
                </div>
                <div className="mt-3 flex items-baseline gap-4 border-t border-hairline pt-2.5">
                  <span className="text-[11px] text-ink-faint">
                    Weight{" "}
                    <span data-figure className="text-ink">
                      {g.weightPercent}%
                    </span>
                  </span>
                  <span className="text-[11px] text-ink-faint">
                    Max{" "}
                    <span data-figure className="text-ink">
                      {formatPoints(g.maximumPoints)}
                    </span>{" "}
                    pts
                  </span>
                  <Link
                    href={`/goals/${g.id}`}
                    className="ml-auto flex items-center gap-1 text-xs text-ink-muted hover:text-ink"
                  >
                    Open <Icon.chevronRight className="h-3 w-3" />
                  </Link>
                </div>
              </Panel>
            );
          })}
        </div>
      )}
    </>
  );
}

export function GoalDetail({ goalId }: { goalId: string }) {
  const goal = useQuery((r) => r.getGoal(goalId), [goalId]);
  const { data, isLoading } = goal;
  const [update] = useAction((r, id: string) =>
    r.updateGoalActivity(id, { status: "approved" }),
  );

  if (isLoading) return <SkeletonRows rows={8} />;
  if (goal.error)
    return (
      <QueryError queries={[goal]} message="This goal could not be loaded." />
    );
  if (!data)
    return (
      <Panel>
        <ErrorState title="Goal not found" />
      </Panel>
    );

  const { goal: g, activities } = data;
  const earned = activities
    .filter((a) => a.status === "approved" && !a.submittedLate)
    .reduce((s, a) => s + a.points, 0);
  const possible = activities.reduce((s, a) => s + a.points, 0);

  return (
    <>
      <Breadcrumb
        items={[{ label: "Goals", href: "/goals" }, { label: g.title }]}
      />
      <h1 className="mt-2 mb-1 text-[clamp(1.25rem,1.9vw,1.625rem)] leading-tight font-light tracking-[-0.03em] text-ink">
        {g.title}
      </h1>
      <p className="mb-4 text-sm text-ink-muted">{g.description}</p>

      <div className="grid grid-cols-1 items-start gap-4 deck:grid-cols-12">
        <div className="deck:col-span-8">
          <Panel padded={false}>
            <div className="flex items-center gap-2 border-b border-hairline px-5 py-3">
              <h2 className="text-sm font-medium text-ink">Activities</h2>
              <span data-figure className="text-xs text-ink-faint">
                {activities.length}
              </span>
              <span className="ml-auto text-[11px] text-ink-faint">
                each is one C2 scoring unit
              </span>
            </div>
            {!activities.length ? (
              <EmptyState compact title="No activities" />
            ) : (
              <div className="divide-y divide-hairline">
                {activities.map((a) => (
                  <div
                    key={a.id}
                    className="flex flex-wrap items-center gap-3 px-5 py-3"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm text-ink">
                        {a.heading}
                      </span>
                      <span className="mt-0.5 block text-[11px] text-ink-faint">
                        {a.dueAt ? `Due ${formatDate(a.dueAt)}` : "No deadline"}{" "}
                        · <span data-figure>{formatPoints(a.points)}</span> pts
                      </span>
                    </span>
                    {a.submittedLate && <Chip tone="overdue">Late</Chip>}
                    <Chip
                      tone={
                        a.status === "approved"
                          ? "positive"
                          : a.status === "rejected"
                            ? "overdue"
                            : "neutral"
                      }
                    >
                      {a.status.replace(/_/g, " ")}
                    </Chip>
                    {a.status !== "approved" && (
                      <Button size="sm" onClick={() => update(a.id)}>
                        Mark done
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </Panel>
        </div>

        <div className="flex flex-col gap-4 deck:col-span-4">
          <Panel>
            <h2 className="text-sm font-medium text-ink">C2 contribution</h2>
            <p className="mt-2 flex items-baseline gap-2">
              <span
                data-figure
                className="text-[22px] leading-none tracking-[-0.025em] text-ink"
              >
                {formatPoints(earned)}
              </span>
              <span className="text-xs text-ink-faint">
                of {formatPoints(possible)} points
              </span>
            </p>
            <Meter
              value={possible ? (earned / possible) * 100 : 0}
              label="Goal attainment"
              className="mt-2"
            />
            <p className="mt-3 flex flex-wrap items-center gap-2 border-t border-hairline pt-3 text-[11px] text-ink-faint">
              A component earns its points only when completed and not late.
              Whether partial credit should exist is unresolved.
              <ProvisionalBadge decisionId="O8" label="Goal partial credit" />
            </p>
          </Panel>
          <Panel>
            <h2 className="mb-3 text-sm font-medium text-ink">Details</h2>
            <dl className="space-y-2.5">
              <Row label="Period" value={g.periodKey} />
              <Row label="Weight" value={`${g.weightPercent}%`} />
              <Row
                label="Target"
                value={`${g.targetValue ?? "—"} ${g.unit ?? ""}`}
              />
              <Row label="Achieved" value={String(g.achievedValue)} />
              <Row label="Status" value={g.status} />
            </dl>
          </Panel>
        </div>
      </div>
    </>
  );
}

/* ── Attendance ───────────────────────────────────────────────────────────── */

export function AttendancePage({ history = false }: { history?: boolean }) {
  const viewerId = useViewerId();
  const from = history ? "2026-04-25" : "2026-07-01";
  const { data, isLoading } = useQuery(
    (r) => r.listAttendance(viewerId ?? "", from, "2026-07-25"),
    [from, viewerId],
  );
  const score = useQuery((r) => r.getScoreOverview(viewerId ?? ""), [viewerId]);
  const c4 = score.data?.channels.find((c) => c.id === "c4");

  const days = data ?? [];
  const expected = days.filter((d) => d.isExpectedWorkingDay);
  const late = expected.filter((d) => d.lateMinutes > 0);
  const absent = expected.filter((d) => d.status === "absent");
  const totalLateMins = late.reduce((s, d) => s + d.lateMinutes, 0);

  return (
    <>
      <WorkspaceHead
        title={history ? "Attendance history" : "Attendance"}
        count={
          <>
            <span data-figure>{expected.length}</span> expected working days ·
            C4 · Attendance
          </>
        }
        tabs={
          <IconTabs
            items={[
              {
                id: "current",
                label: "This period",
                href: "/attendance",
                icon: "calendar",
              },
              {
                id: "history",
                label: "History",
                href: "/attendance/history",
                icon: "history",
              },
            ]}
            active={history ? "history" : "current"}
          />
        }
      />

      <Panel padded={false} className="mb-4">
        <div className="grid grid-cols-2 divide-x divide-y divide-hairline sm:grid-cols-4 sm:divide-y-0">
          <Cell
            label="C4 score"
            value={
              c4 && c4.percentage !== null
                ? `${Math.round(c4.percentage)}%`
                : "—"
            }
            note={
              c4
                ? `${formatPoints(c4.earnedPoints)} of ${formatPoints(c4.possiblePoints)} pts`
                : ""
            }
            provisional
          />
          <Cell
            label="Days late"
            value={String(late.length)}
            note={`${totalLateMins} minutes total`}
          />
          <Cell
            label="Absent"
            value={String(absent.length)}
            note="unapproved"
            alert={absent.length > 0}
          />
          <Cell
            label="On time"
            value={`${expected.length ? Math.round(((expected.length - late.length - absent.length) / expected.length) * 100) : 0}%`}
            note="of expected days"
          />
        </div>
      </Panel>

      <Panel padded={false}>
        <div className="flex items-center gap-2 border-b border-hairline px-5 py-3">
          <h2 className="text-sm font-medium text-ink">Days</h2>
          <span className="ml-auto flex items-center gap-2 text-[11px] text-ink-faint">
            Lateness deducts proportionally
            <ProvisionalBadge decisionId="O5" label="Lateness rate" />
          </span>
        </div>
        <AttendanceList days={days} loading={isLoading} />
      </Panel>
    </>
  );
}

function Cell({
  label,
  value,
  note,
  alert = false,
  provisional = false,
}: {
  label: string;
  value: string;
  note?: string;
  alert?: boolean;
  provisional?: boolean;
}) {
  return (
    <div className="px-4 py-3">
      <p className="flex items-center gap-1.5 text-[11px] tracking-[0.09em] text-ink-faint uppercase">
        {label}
        {provisional && <ProvisionalBadge decisionId="O5" />}
      </p>
      <p
        data-figure
        className={`mt-1.5 text-[22px] leading-none tracking-[-0.025em] ${
          alert ? "text-[var(--state-overdue-ink)]" : "text-ink"
        }`}
      >
        {value}
      </p>
      {note && (
        <p className="mt-1.5 truncate text-[11px] text-ink-faint">{note}</p>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center gap-3">
      <dt className="w-20 shrink-0 text-xs text-ink-faint">{label}</dt>
      <dd className="min-w-0 flex-1 truncate text-sm text-ink capitalize">
        {value}
      </dd>
    </div>
  );
}

/* ── Notifications ────────────────────────────────────────────────────────── */

/**
 * Push, as a thing you can switch on and see the state of.
 *
 * ## Why a button rather than only asking on load
 *
 * Browsers honour a permission request that came from a click and quietly
 * ignore one that did not. Chrome's "quieter permissions" suppresses an
 * automatic request on a low-engagement origin — `localhost` above all — and
 * when it does, `requestPermission()` resolves without showing anything. The
 * automatic attempt then ended silently and no token was ever written, which
 * from outside looks exactly like a broken save: the symptom is "the token is
 * not stored" and the cause is a prompt nobody saw.
 *
 * So this states which of those it is. Registered, blocked, dismissed,
 * unsupported or failed each read differently, because only some of them are
 * something the person can do anything about.
 *
 * Hidden once push is on. A control that only ever says "working" is furniture.
 */
function PushPanel() {
  const viewerId = useViewerId();
  const { state, detail, enable } = usePushRegistration(viewerId ?? null);

  /**
   * Hidden ONLY once push is confirmed on.
   *
   * This also hid on `idle` — and `idle` is precisely "permission is still
   * `default`": never asked, or asked and silently suppressed by the browser.
   * That is the one state where somebody needs this control, so the button
   * that fixes the problem was invisible in exactly the case it exists for,
   * and the page looked as though it had nothing to say.
   */
  if (state === "on") return null;

  const working = state === "working";
  const canRetry = state !== "unsupported" && state !== "working";

  return (
    <Panel className="mb-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm text-ink">
            {state === "blocked"
              ? "Notifications are blocked on this device"
              : state === "unsupported"
                ? "This device cannot show notifications"
                : "Notifications are off on this device"}
          </p>
          <p className="mt-1 text-xs text-ink-muted">
            {detail ??
              "Turn them on to be told about task, deadline and score changes when Cowork is not open."}{" "}
            Everything still arrives in this list either way.
          </p>
        </div>
        {canRetry && (
          <Button size="sm" disabled={working} onClick={enable}>
            {working ? "Turning on…" : "Turn on notifications"}
          </Button>
        )}
      </div>
    </Panel>
  );
}

export function NotificationsPage() {
  /**
   * **Live, via the same `onSnapshot` hook the old app uses.**
   *
   * This read `listNotifications()`, a one-shot `getDocs` that only re-ran when
   * some unrelated mutation invalidated the query. So a notification arriving
   * while somebody sat on this page did not appear — on the one page in the
   * product whose entire job is showing notifications as they arrive. The bell
   * in the top bar was already live off this hook, so the badge could count
   * something the list beneath it did not show.
   *
   * `useCoworkNotifications` is `cowork-old-frontend`'s own hook, ported here
   * byte for byte. It owns the subscription, the unread counts and the
   * per-type sounds; the reason a notification already makes a noise today is
   * that `TopBar` mounts it on every route.
   */
  const viewerId = useViewerId();
  const { notifications: live, unread } = useCoworkNotifications(
    viewerId ?? null,
  );
  const [markRead] = useAction((r, id: string) => r.markNotificationRead(id));
  const [markAll, allState] = useAction((r) => r.markAllNotificationsRead());
  const [filter, setFilter] = useState<"all" | "unread">("all");

  /* The engine's shape, as the row renders it. `readAt` carries the empty
     string for "read, time unknown" — legacy stores a boolean and no
     timestamp, and inventing one would be worse than admitting it. */
  const data = live.map((n) => ({
    id: n.id,
    type: n.type,
    title: n.title,
    body: n.body,
    data: (n.data ?? {}) as Record<string, unknown>,
    createdAt: n.createdAt,
    readAt: n.read ? "" : null,
    channels: ["in_app"] as const,
  }));

  /* No `refetch`: the listener delivers the change itself, so marking one read
     updates the row without asking for anything. */
  const refetch = () => {};
  const isLoading = false;

  const list = data.filter((n) => (filter === "unread" ? !n.readAt : true));

  return (
    <>
      <WorkspaceHead
        title="Notifications"
        count={
          <>
            <span data-figure>{unread}</span> unread
          </>
        }
        scope={
          <Segmented
            label="Filter"
            size="sm"
            value={filter}
            onChange={setFilter}
            options={[
              { id: "all", label: "All" },
              { id: "unread", label: "Unread", count: unread },
            ]}
          />
        }
        action={
          <Button
            size="sm"
            disabled={allState.isPending || unread === 0}
            onClick={async () => {
              await markAll();
              refetch();
            }}
          >
            Mark all read
          </Button>
        }
      />
      <PushPanel />
      {/* No error branch: a live listener does not fail the way a fetch does.
          It either delivers or stays silent, and the hook logs a subscription
          failure rather than surfacing one — the same behaviour the old app
          has, where a dropped listener leaves the last good list on screen
          instead of replacing it with an error. */}
      {isLoading ? (
        <SkeletonRows rows={6} />
      ) : !list.length ? (
        <Panel>
          <EmptyState
            title={filter === "unread" ? "Nothing unread" : "No notifications"}
            body="Task assignments, reviews, deadline decisions and priority cascades arrive here."
          />
        </Panel>
      ) : (
        <Panel padded={false}>
          <div className="divide-y divide-hairline">
            {list.map((n) => {
              /* One resolution for every type, replacing three hard-coded
                 branches that between them covered two of the forty-odd types
                 the engine sends — and, with `sourceType` always null, rendered
                 for none of them. */
              const href = notificationHref(
                notificationTarget(n.type, n.data),
              );
              const open = async () => {
                /* Marked read on the way out, so opening the thing you were
                   told about is the same gesture as acknowledging it. Awaited
                   before navigating rather than fired alongside: a route change
                   can unmount this list mid-request. */
                if (!n.readAt) {
                  await markRead(n.id);
                  refetch();
                }
              };

              return (
                <div
                  key={n.id}
                  className={`flex items-start gap-3 px-5 py-3 ${n.readAt ? "" : "bg-[var(--surface-sunken)]"}`}
                >
                  {!n.readAt && (
                    <span
                      aria-hidden="true"
                      className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-ink"
                    />
                  )}
                  <div
                    className={`min-w-0 flex-1 ${n.readAt ? "pl-[18px]" : ""}`}
                  >
                    {/* The whole text block is the target when there is one.
                        A person who has just read a notification reaches for
                        the thing they read, not for a four-letter word at the
                        far right of the row. */}
                    {href ? (
                      <Link
                        href={href}
                        onClick={open}
                        className="block rounded-inset outline-none focus-visible:ring-2 focus-visible:ring-ink"
                      >
                        <p className="text-sm text-ink hover:underline">
                          {n.title}
                        </p>
                        <p className="mt-0.5 text-xs text-ink-muted">{n.body}</p>
                      </Link>
                    ) : (
                      <>
                        <p className="text-sm text-ink">{n.title}</p>
                        <p className="mt-0.5 text-xs text-ink-muted">{n.body}</p>
                      </>
                    )}
                    <p className="mt-1 text-[11px] text-ink-faint">
                      {formatDateTime(n.createdAt)} · {n.channels.join(", ")}
                    </p>
                  </div>
                  {/* Kept alongside the link, not replaced by it: dismissing
                      something you do NOT want to open is the commoner of the
                      two actions on a busy list. */}
                  {!n.readAt && (
                    <button
                      type="button"
                      onClick={async () => {
                        await markRead(n.id);
                        refetch();
                      }}
                      className="shrink-0 text-xs text-ink-faint hover:text-ink"
                    >
                      Mark read
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </Panel>
      )}
    </>
  );
}
