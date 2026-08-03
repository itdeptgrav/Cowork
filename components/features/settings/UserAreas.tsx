"use client";

import Link from "next/link";
import { ProfilePicture } from "./ProfilePicture";
import { Icon, type IconName } from "@/components/ui/Icons";
import { WorkspaceHead } from "@/components/ui/Workspace";
import { GmailConnection } from "@/components/features/mail/GmailConnection";
import { useTheme } from "@/components/layout/shell/ThemeContext";
import {
  DeviceModeSection,
  DeviceModeSuggestion,
} from "./DeviceModeSection";
import { WebAppSection } from "./WebAppSection";
import { PerformanceMonitor } from "./PerformanceMonitor";
import { ThemeToggle } from "@/components/layout/shell/ThemeToggle";
import {
  Chip,
  Panel,
  SkeletonRows,
  QueryError,
  EmptyState,
} from "@/components/ui/Primitives";
import { useQuery } from "@/lib/hooks/useRepository";
import { useViewerId } from "@/lib/hooks/usePermissions";
import { formatDate } from "@/lib/utils/format";
import { openDecisionCount } from "@/lib/config/provisional";

export function SettingsPage() {
  const { preference, resolved } = useTheme();
  const me = useQuery((r) => r.getCurrentEmployee(), []);

  return (
    <>
      <WorkspaceHead title="Settings" />
      {/* The offer, above everything: somebody whose machine is struggling should
          meet it before they scroll past it. Renders nothing where the signals
          give no reason, and nothing once it has been answered. */}
      <DeviceModeSuggestion />
      <div className="grid gap-4 deck:grid-cols-2">
        {/* Mail connection. External mail sends from the person's own address,
            so the authorisation is theirs to give and theirs to withdraw. */}
        <GmailConnection />
        <Panel>
          <h2 className="text-sm font-medium text-ink">Appearance</h2>
          <p className="mt-2 text-sm text-ink-muted">
            Light and dark are tuned separately rather than inverted — surface
            depth, border strength, shadow and status colour all differ by
            design.
          </p>
          <div className="mt-3 flex items-center gap-3 border-t border-hairline pt-3">
            <ThemeToggle />
            <span className="text-xs text-ink-faint">
              Preference <span className="text-ink">{preference}</span>
              {preference === "system" && ` · currently ${resolved}`}
            </span>
          </div>
        </Panel>

        {/* The web app: install state, version, updates, offline cache and
            push, all read from the running application rather than claimed. */}
        <WebAppSection />

        {/* Performance sits beside Appearance because it is the same kind of
            choice — how this machine draws the product — and separating them
            would make somebody hunt for it. */}
        <DeviceModeSection />
        <PerformanceMonitor />

        <Panel>
          <h2 className="text-sm font-medium text-ink">Notifications</h2>
          <ul className="mt-3 space-y-2">
            {[
              ["Task assigned", true],
              ["Review requested", true],
              ["Deadline decided", true],
              ["Priority cascade", true],
              ["Daily digest", false],
            ].map(([label, on]) => (
              <li key={label as string} className="flex items-center gap-3">
                <span className="min-w-0 flex-1 truncate text-sm text-ink-muted">
                  {label as string}
                </span>
                <Chip tone={on ? "positive" : "neutral"}>
                  {on ? "On" : "Off"}
                </Chip>
              </li>
            ))}
          </ul>
          <p className="mt-3 border-t border-hairline pt-3 text-[11px] text-ink-faint">
            Per-type, per-channel preferences are read-only in this prototype.
          </p>
        </Panel>

        <Panel>
          <h2 className="text-sm font-medium text-ink">Account</h2>
          {me.isLoading ? (
            <SkeletonRows rows={3} />
          ) : me.error ? (
            <div className="mt-3">
              <QueryError
                compact
                queries={[me]}
                message="Your account details could not be loaded."
              />
            </div>
          ) : me.data ? (
            <dl className="mt-3 space-y-2.5">
              <Row label="Name" value={me.data.displayName} />
              <Row label="Code" value={me.data.employeeCode} />
              <Row label="Department" value={me.data.departmentName ?? "—"} />
              <Row label="Timezone" value={me.data.timezone} />
            </dl>
          ) : null}
        </Panel>

        <Panel>
          <h2 className="text-sm font-medium text-ink">About this build</h2>
          <p className="mt-2 text-sm text-ink-muted">
            A UI-first prototype running on synthetic data held in memory. No
            production backend is connected.
          </p>
          <p className="mt-2 flex flex-wrap items-center gap-2 text-sm text-ink-muted">
            <span data-figure>{openDecisionCount()}</span> scoring rules are
            provisional.
            <Link href="/admin/scoring-rules" className="text-ink">
              Review them ›
            </Link>
          </p>
        </Panel>
      </div>
    </>
  );
}

export function ProfilePage() {
  const me = useQuery((r) => r.getCurrentEmployee(), []);
  const viewerId = useViewerId();
  const score = useQuery((r) => r.getScoreOverview(viewerId ?? ""), []);
  const roles = useQuery((r) => r.listRoles(), []);
  const viewer = useQuery((r) => r.getViewer(), []);

  if (me.isLoading) return <SkeletonRows rows={6} />;
  /* A profile that cannot load is not an empty profile. Returning null here
     left the route rendering nothing at all — a blank page with a working
     navigation bar, and no way to tell whether that was the answer. */
  if (me.error || !me.data)
    return (
      <Panel>
        <QueryError
          queries={[me]}
          message="This profile could not be loaded."
        />
        {!me.error && (
          <EmptyState
            compact
            title="No profile"
            body="No employee record is attached to this session."
          />
        )}
      </Panel>
    );
  const p = me.data;

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        {/* The avatar IS the control — see `ProfilePicture`. */}
        <ProfilePicture person={p} onChanged={me.refetch} />
        <div>
          <h1 className="text-[clamp(1.25rem,1.9vw,1.625rem)] leading-tight font-light tracking-[-0.03em] text-ink">
            {p.displayName}
          </h1>
          <p className="mt-0.5 text-sm text-ink-muted">
            {p.designation} · {p.departmentName}
          </p>
        </div>
        {/* The ONLY route to Settings on a wide screen. The top bar's Settings
            link lives inside a `deck:hidden` block, so on desktop the page was
            reachable only by typing the URL — which meant the Gmail connection
            was effectively unreachable for anyone not told where it was. */}
        <Link
          href="/settings"
          className="ml-auto rounded-full bg-[var(--control)] px-3.5 py-1.5 text-sm text-ink-muted transition-colors hover:bg-[var(--control-hover)] hover:text-ink"
        >
          Settings
        </Link>
        {score.data && (
          <Link
            href="/score"
            className="flex items-baseline gap-2 rounded-full bg-[var(--control)] px-3.5 py-1.5 transition-colors hover:bg-[var(--control-hover)]"
          >
            <span
              data-figure
              className="text-[22px] leading-none tracking-[-0.025em] text-ink"
            >
              {Math.round(score.data.overallPercentage)}%
            </span>
            <span className="text-xs text-ink-muted">your score</span>
          </Link>
        )}
      </div>

      <div className="grid gap-4 deck:grid-cols-2">
        <Panel>
          <h2 className="mb-3 text-sm font-medium text-ink">Details</h2>
          <dl className="space-y-2.5">
            <Row label="Employee code" value={p.employeeCode} />
            <Row label="Department" value={p.departmentName ?? "—"} />
            <Row label="Designation" value={p.designation ?? "—"} />
            <Row label="Joined" value={formatDate(p.joinedAt)} />
            <Row label="Timezone" value={p.timezone} />
          </dl>
        </Panel>
        <Panel>
          <h2 className="mb-3 text-sm font-medium text-ink">Access</h2>
          <div className="flex flex-wrap gap-1.5">
            {p.roleIds.map((rid) => (
              <Chip key={rid}>
                {roles.data?.find((r) => r.id === rid)?.displayName ?? rid}
              </Chip>
            ))}
          </div>
          <p className="mt-3 border-t border-hairline pt-3 text-sm text-ink-muted">
            You can see{" "}
            <span data-figure className="text-ink">
              {viewer.data?.hierarchyIds.length ?? 0}
            </span>{" "}
            people in your reporting line. Score visibility follows that
            hierarchy — never sideways, never upward.
          </p>
        </Panel>
      </div>
    </>
  );
}

export function DocsPage() {
  const docs = [
    {
      title: "How scoring works",
      body: "Every unit is worth 1.0 point. Deductions reduce it, credits add to it, and the result is clamped to the unit's maximum. Components aggregate points over points — never an average of percentages.",
      href: "/score",
    },
    {
      title: "Priority and the cascade",
      body: "Rank is per person, 1 is highest. Raising a task pushes its remaining time into the work below it, crediting time already logged and never moving a deadline earlier.",
      href: "/tasks?view=tasks",
    },
    {
      title: "Deadline negotiation",
      body: "A creator suggests, an assignee proposes, and either side can counter. A waived extension moves the scored deadline; a charged one does not.",
      href: "/tasks?view=tasks",
    },
    {
      title: "Rework and rejection",
      body: "Rework returns the task with the time you had left and deducts 0.2. Rejection records an adverse review; its deduction is not yet approved.",
      href: "/tasks?view=approvals",
    },
    {
      title: "Projects and tasks",
      body: "Projects group tasks. They carry no score of their own, and removing a task from a project only unlinks it.",
      href: "/tasks/projects",
    },
  ];

  return (
    <>
      <WorkspaceHead title="Documentation" count={`${docs.length} topics`} />
      <div className="grid gap-3 deck:grid-cols-2">
        {docs.map((d) => (
          <Panel key={d.title}>
            <h2 className="text-sm font-medium text-ink">{d.title}</h2>
            <p className="mt-2 max-w-[62ch] text-sm text-ink-muted">{d.body}</p>
            <Link
              href={d.href}
              className="mt-3 flex items-center gap-1 text-xs text-ink-muted hover:text-ink"
            >
              Go there <Icon.chevronRight className="h-3 w-3" />
            </Link>
          </Panel>
        ))}
      </div>

      <IconLegend />
    </>
  );
}

/**
 * The concept-to-glyph map, rendered rather than only written down.
 *
 * docs/architecture/DESIGN.md carries the table; this is where it can be *checked*. The pairs
 * most at risk of collision sit next to each other on purpose — Employee beside
 * Project, Project beside Team — because the only real test of an icon set is
 * reading the neighbours together at their actual size in both themes.
 */
function IconLegend() {
  const map: { icon: IconName; concept: string; note: string }[] = [
    {
      icon: "user",
      concept: "Employee",
      note: "One person — head and shoulders, nothing else",
    },
    {
      icon: "projects",
      concept: "Project",
      note: "A container with internal structure: grouped work",
    },
    { icon: "team", concept: "Team", note: "Two people — plainly plural" },
    { icon: "tasks", concept: "Task", note: "A checklist" },
    { icon: "goal", concept: "Goal", note: "A target" },
    { icon: "meeting", concept: "Meeting", note: "People at a table edge" },
    { icon: "chat", concept: "Message", note: "A speech bubble" },
    { icon: "score", concept: "Score", note: "The C1–C4 band in miniature" },
    { icon: "attendance", concept: "Attendance", note: "A day marked present" },
  ];

  return (
    <section className="mt-4">
      <Panel padded={false}>
        <div className="border-b border-hairline px-4 py-2">
          <h2 className="text-sm font-medium text-ink">Icon meanings</h2>
          <p className="mt-0.5 text-xs text-ink-faint">
            One glyph per concept. Employee, Project and Team are listed
            together because they are the three that must never be mistaken for
            each other.
          </p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2">
          {map.map((m, i) => {
            const Ico = Icon[m.icon];
            return (
              <div
                key={m.concept}
                className={`flex items-center gap-3 px-4 py-2.5 ${
                  i > 0 ? "border-t border-hairline" : ""
                } ${i % 2 === 1 ? "sm:border-l sm:border-hairline" : ""}`}
              >
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[var(--control)] text-ink">
                  <Ico />
                </span>
                <span className="min-w-0">
                  <span className="block text-sm text-ink">{m.concept}</span>
                  <span className="mt-0.5 block truncate text-[11px] text-ink-faint">
                    {m.note}
                  </span>
                </span>
              </div>
            );
          })}
        </div>
      </Panel>
    </section>
  );
}

export function PrivacyPage() {
  return (
    <>
      <WorkspaceHead title="Privacy" />
      <div className="max-w-[68ch]">
        <Panel>
          <h2 className="text-sm font-medium text-ink">What Cowork records</h2>
          <p className="mt-2 text-sm text-ink-muted">
            Cowork records the work you do — tasks, submissions, reviews, logged
            time, goals, conduct events and attendance — because that record is
            what produces the performance score. Nothing is measured that is not
            shown to you.
          </p>

          <h2 className="mt-5 text-sm font-medium text-ink">
            Who can see your score
          </h2>
          <p className="mt-2 text-sm text-ink-muted">
            You always see your own score in full. Your reporting line can see
            it. Nobody else can — not peers, not other departments. Comparison
            between people exists only looking down a reporting chain, and is
            never shown to the people being compared.
          </p>

          <h2 className="mt-5 text-sm font-medium text-ink">Traceability</h2>
          <p className="mt-2 text-sm text-ink-muted">
            Every point gained or lost is an entry in an append-only ledger that
            names the event, the rule, the rule version and the person
            responsible. Entries are never edited or deleted; a correction is a
            reversal that references what it reverses.
          </p>

          <h2 className="mt-5 text-sm font-medium text-ink">
            What Cowork does not do
          </h2>
          <p className="mt-2 text-sm text-ink-muted">
            No screen capture, no keystroke logging, no application monitoring,
            no location tracking. Time is recorded only when you start a timer
            or commit work yourself.
          </p>

          <p className="mt-5 border-t border-hairline pt-3 text-[11px] text-ink-faint">
            This is prototype copy on synthetic data. It is not a legal notice.
          </p>
        </Panel>
      </div>
    </>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center gap-3">
      <dt className="w-28 shrink-0 text-xs text-ink-faint">{label}</dt>
      <dd className="min-w-0 flex-1 truncate text-sm text-ink">{value}</dd>
    </div>
  );
}
