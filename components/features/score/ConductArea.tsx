"use client";

import { useState } from "react";
import {
  Button,
  Chip,
  EmptyState,
  Field,
  InlineError,
  Input,
  Panel,
  PanelHead,
  Select,
  SkeletonRows,
  Textarea,
} from "@/components/ui/Primitives";
import { IconTabs, WorkspaceHead } from "@/components/ui/Workspace";
import { useAction, useQuery } from "@/lib/hooks/useRepository";
import { usePermissions } from "@/lib/hooks/usePermissions";
import { SCORE_TABS } from "./tabs";
import { CHANNEL_CODE, CHANNEL_LABEL } from "@/lib/domain";
import type { ConductPolicy, ConductSeverity, EmployeeId } from "@/lib/domain";
import { conductNet, disputeOutcome } from "@/lib/rules/scoring/conduct";

/**
 * C3 · Conduct.
 *
 * The other three channels are measured — tasks approved, deadlines met, hours
 * worked — and the page for each of them lists what the engine counted. C3 is
 * the only one a person does to another person, and it has four acts rather
 * than a measurement:
 *
 *   1. a manager **writes** a rule and says what a breach costs,
 *   2. **their own** manager approves it, because nobody sets the price of
 *      their own penalties,
 *   3. the employee's own manager **applies** it to somebody, and
 *   4. that employee may **dispute** it, and the same manager settles it.
 *
 * So this page is not a list of figures; it is four queues, and which of them
 * a reader sees depends on where they stand in the reporting line. Everybody
 * sees their own deductions and can argue with one. A manager additionally
 * sees the rules they may write, the ones waiting on their decision, and the
 * disputes belonging to their reports.
 *
 * **Percentages, never points.** A breach takes percentage points off the
 * score directly — C1, C2 and C4 are percentages and C3 is subtracted from
 * their average, so five here means eighty becomes seventy-five. The old
 * system said "points" for the same quantity and nobody could say what a point
 * was worth. See `lib/rules/scoring/conduct.ts`.
 */
export function ConductPage() {
  const perms = usePermissions();
  const viewerId = perms.employeeId;

  /**
   * **Not asked until there is somebody to ask about.**
   *
   * `usePermissions` answers null on the first renders, while the viewer is
   * still being fetched. Sending that on as `""` built
   * `/cowork/sop/bleach/` with no id on the end, which matches no route — and
   * Express answers a plain HTML 404 page, so the panel rendered
   * `<!DOCTYPE html> … Cannot GET /cowork/sop/bleach/` where the deductions
   * should be, and kept rendering it. An empty id is not a person; there is
   * nothing to fetch yet, and an empty list is the honest answer until there
   * is. The dependency below refetches the moment the viewer lands.
   */
  const ledger = useQuery(
    (r) => (viewerId ? r.listLedger(viewerId, "c3") : Promise.resolve([])),
    [viewerId],
  );
  const policies = useQuery((r) => r.listConductPolicies(), []);
  const approvals = useQuery((r) => r.listConductApprovals(), []);
  const disputes = useQuery((r) => r.listConductDisputes(), []);

  /* Two different questions, and the page used to ask neither. `conduct.apply`
     against nobody in particular answers "does this person ever charge anyone",
     which is what decides whether the rule-writing and applying controls exist
     at all; the engine asks it again per person, and refuses. */
  const mayApply = perms.can("conduct.apply");
  const mayReview = perms.can("conduct.review_dispute");

  const mine = ledger.data ?? [];
  /* This quarter's cost, computed by the same function the score uses rather
     than summed here — a figure recomputed in the interface eventually
     disagrees with the one the engine applied. */
  const today = new Date();
  const net = conductNet(
    mine.map((e) => ({
      percent: e.deduction > 0 ? e.deduction : 0,
      date: e.effectiveDate || null,
      reversed: e.reversalOf !== null,
    })),
    {
      quarter: Math.floor(today.getMonth() / 3) + 1,
      year: today.getFullYear(),
    },
  );

  return (
    <>
      <WorkspaceHead
        title={`${CHANNEL_CODE.c3} · ${CHANNEL_LABEL.c3}`}
        count={
          mine.length > 0 ? (
            <>
              {/* `conductNet` is already negative — it is only ever a
                  deduction — so the sign is read from it rather than applied
                  again. */}
              <span data-figure>
                {net < 0 ? "−" : ""}
                {Math.abs(net)}%
              </span>
              {" · "}
              <span data-figure>{mine.length}</span>{" "}
              {mine.length === 1 ? "entry" : "entries"}
            </>
          ) : undefined
        }
        tabs={<IconTabs items={SCORE_TABS} active="c3" />}
      />

      {ledger.isLoading ? (
        <SkeletonRows rows={6} />
      ) : (
        <div className="grid grid-cols-1 items-start gap-4 deck:grid-cols-12">
          <div className="deck:col-span-7">
            <MyDeductions
              entries={mine}
              error={ledger.error}
              reload={ledger.refetch}
            />
          </div>

          <div className="deck:col-span-5 space-y-4">
            <ConductRules
              policies={policies.data ?? []}
              loading={policies.isLoading}
              mayWrite={mayApply}
            />
            {mayApply && (
              <ApplyPanel
                policies={(policies.data ?? []).filter(
                  (p) => p.status === "approved" && p.isActive,
                )}
              />
            )}
            {mayApply && (
              <ApprovalQueue
                policies={approvals.data ?? []}
                loading={approvals.isLoading}
              />
            )}
            {mayReview && (
              <DisputeQueue
                disputes={disputes.data ?? []}
                loading={disputes.isLoading}
              />
            )}
          </div>
        </div>
      )}
    </>
  );
}

/* ── Your own deductions ──────────────────────────────────────────────────── */

type LedgerRow = {
  id: string;
  sourceLabel: string;
  reason: string;
  deduction: number;
  credit: number;
  effectiveDate: string;
  actorLabel: string;
  reversalOf: string | null;
  disputeStatus?: string | null;
  disputeReviewNote?: string | null;
  disputeReviewedBy?: string | null;
};

function MyDeductions({
  entries,
  error,
  reload,
}: {
  entries: LedgerRow[];
  error: string | null;
  reload: () => void;
}) {
  return (
    <Panel padded={false}>
      <div className="flex flex-wrap items-baseline gap-x-2 border-b border-hairline px-4 py-3">
        <h2 className="text-sm font-medium text-ink">Your own deductions</h2>
        {entries.length > 0 && (
          <span data-figure className="text-xs text-ink-faint">
            {entries.length}
          </span>
        )}
      </div>
      {error ? (
        <div className="p-4">
          <InlineError message={error} onRetry={reload} />
        </div>
      ) : !entries.length ? (
        <EmptyState
          compact
          title="Nothing on your conduct record"
          body="Deductions appear here when a manager applies a company rule to you. You can ask for a recheck on any of them."
        />
      ) : (
        <div className="divide-y divide-hairline">
          {entries.map((e) => (
            <DeductionRow key={e.id} entry={e} />
          ))}
        </div>
      )}
    </Panel>
  );
}

function DeductionRow({ entry }: { entry: LedgerRow }) {
  const [arguing, setArguing] = useState(false);
  const [note, setNote] = useState("");
  const [ask, state] = useAction((r, entryId: string, text: string) =>
    r.requestConductRecheck({ entryId, note: text }),
  );

  const penalty = entry.deduction > 0;
  const amount = penalty ? entry.deduction : entry.credit;
  /* Read once, through the shared translator — the engine's `"confirmed"`
     means the deduction was REVERSED, which is the opposite of how it reads. */
  const dispute = disputeOutcome(entry.disputeStatus);

  return (
    <article className="px-4 py-3.5">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h3 className="min-w-0 flex-1 truncate text-sm text-ink">
          {entry.sourceLabel}
        </h3>
        <span
          data-figure
          className={`shrink-0 text-sm ${
            entry.reversalOf
              ? "text-ink-faint line-through"
              : penalty
                ? "text-[var(--state-rework-ink)]"
                : "text-[var(--state-positive-ink)]"
          }`}
        >
          {penalty ? "−" : "+"}
          {Math.abs(Math.round(amount * 10) / 10)}%
        </span>
      </div>

      {entry.reason && (
        <p className="mt-1 text-[11px] leading-relaxed text-ink-muted">
          {entry.reason}
        </p>
      )}
      <p className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px] text-ink-faint">
        <span>{entry.effectiveDate}</span>
        {entry.actorLabel && <span>· {entry.actorLabel}</span>}
        {entry.reversalOf && <span>· reversed</span>}
      </p>

      {/**
       * The argument, where there has been one.
       *
       * **Shown before the button, and instead of it once it has been used.**
       * The row offered "Ask for a recheck" to somebody who had already asked —
       * it had no way to know — so the only way to find out what had happened
       * was to ask again. And when the manager decided, they wrote a reason
       * that reached nobody: the person whose score it was never saw why it
       * stood. Both reported.
       */}
      {dispute.raised && (
        <div className="mt-2.5 rounded-inset bg-[var(--surface-sunken)] px-3 py-2">
          <p
            className={`text-[11px] font-medium ${
              dispute.pending
                ? "text-ink-muted"
                : dispute.removed
                  ? "text-[var(--state-positive-ink)]"
                  : "text-ink"
            }`}
          >
            {dispute.label}
          </p>
          {/* The reviewer's own words. A decision without its reason is a
              verdict, which is the thing this whole flow exists to avoid. */}
          {entry.disputeReviewNote && (
            <p className="mt-1 text-[11px] leading-relaxed text-ink-muted">
              “{entry.disputeReviewNote}”
              {entry.disputeReviewedBy && (
                <span className="text-ink-faint"> — {entry.disputeReviewedBy}</span>
              )}
            </p>
          )}
        </div>
      )}

      {/* A deduction nobody can argue with is a verdict. The control sits on
          the row itself rather than behind a separate screen, because the
          moment somebody disagrees is the moment they are reading the row.
          Offered once: a dispute already raised is not raised again. */}
      {!entry.reversalOf &&
        !dispute.raised &&
        (arguing ? (
          <div className="mt-2.5 rounded-inset bg-[var(--surface-sunken)] p-3">
            {state.error && (
              <div className="mb-2">
                <InlineError message={state.error} />
              </div>
            )}
            <Field label="Why is this wrong?" required>
              <Textarea
                rows={3}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="What actually happened."
              />
            </Field>
            <div className="mt-2 flex items-center gap-2">
              <Button
                tone="primary"
                size="sm"
                disabled={!note.trim() || state.isPending}
                onClick={async () => {
                  const res = await ask(entry.id, note.trim());
                  if (res.ok) {
                    setArguing(false);
                    setNote("");
                  }
                }}
              >
                {state.isPending ? "Sending…" : "Send to your manager"}
              </Button>
              <Button
                tone="ghost"
                size="sm"
                onClick={() => {
                  setArguing(false);
                  setNote("");
                }}
              >
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <Button
            tone="ghost"
            size="sm"
            className="mt-2"
            onClick={() => setArguing(true)}
          >
            Ask for a recheck
          </Button>
        ))}
    </article>
  );
}

/* ── The rule catalogue ───────────────────────────────────────────────────── */

const STATUS_TONE = {
  approved: "positive",
  pending: "risk",
  rejected: "neutral",
} as const;

function ConductRules({
  policies,
  loading,
  mayWrite,
}: {
  policies: ConductPolicy[];
  loading: boolean;
  mayWrite: boolean;
}) {
  const [writing, setWriting] = useState(false);

  return (
    <Panel>
      <PanelHead
        title="Conduct rules"
        sub="What a breach costs, and who approved it."
        aside={
          mayWrite && !writing ? (
            <Button size="sm" onClick={() => setWriting(true)}>
              Write a rule
            </Button>
          ) : undefined
        }
      />
      {writing && (
        <div className="mb-3">
          <WriteRule onDone={() => setWriting(false)} />
        </div>
      )}
      {loading ? (
        <SkeletonRows rows={3} />
      ) : !policies.length ? (
        <EmptyState
          compact
          title="No rules yet"
          body={
            mayWrite
              ? "Write one, and your own manager approves it before it can be applied to anybody."
              : "Company conduct rules appear here once they are approved."
          }
        />
      ) : (
        <ul className="divide-y divide-hairline">
          {policies.map((p) => (
            <li key={p.id} className="flex items-baseline gap-2 py-2">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs text-ink">
                  {p.name}
                </span>
                {p.status === "rejected" && p.rejectedReason && (
                  <span className="mt-0.5 block text-[11px] text-ink-faint">
                    {p.rejectedReason}
                  </span>
                )}
                {p.status === "pending" && p.approverName && (
                  <span className="mt-0.5 block text-[11px] text-ink-faint">
                    with {p.approverName}
                  </span>
                )}
              </span>
              <span data-figure className="shrink-0 text-xs text-ink-muted">
                {p.percent}%
              </span>
              <Chip tone={STATUS_TONE[p.status]}>{p.status}</Chip>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

const SEVERITIES: { id: ConductSeverity; label: string }[] = [
  { id: "minor", label: "Minor" },
  { id: "moderate", label: "Moderate" },
  { id: "serious", label: "Serious" },
  { id: "falsification", label: "Falsification" },
];

function WriteRule({ onDone }: { onDone: () => void }) {
  const [name, setName] = useState("");
  const [percent, setPercent] = useState("5");
  const [description, setDescription] = useState("");
  const [severity, setSeverity] = useState<ConductSeverity>("minor");

  const [create, state] = useAction(
    (
      r,
      input: {
        name: string;
        percent: number;
        description: string;
        severity: ConductSeverity;
        scope: "global" | "department";
        departmentIds: string[];
      },
    ) => r.createConductPolicy(input),
  );

  const cost = Number(percent);
  const costValid = cost > 0 && cost <= 100;

  return (
    <div className="rounded-inset bg-[var(--surface-sunken)] p-3">
      {state.error && (
        <div className="mb-3">
          <InlineError message={state.error} />
        </div>
      )}
      <div className="grid gap-3 deck:grid-cols-2">
        <Field label="What the rule is" required>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Late to a client call"
          />
        </Field>
        <Field
          label="Cut when breached"
          required
          hint="Percentage points off the score. 5 turns 80 into 75."
        >
          <Input
            value={percent}
            inputMode="decimal"
            onChange={(e) => setPercent(e.target.value.replace(/[^0-9.]/g, ""))}
          />
        </Field>
        <Field label="Severity">
          <Select
            value={severity}
            onChange={(e) => setSeverity(e.target.value as ConductSeverity)}
          >
            {SEVERITIES.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <Field label="What counts as a breach" className="mt-3">
        <Textarea
          rows={2}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </Field>
      {/* Said before it is submitted rather than discovered afterwards: the
          author cannot approve their own rule, and the queue it lands in is
          one named person's. */}
      <p className="mt-2 text-[11px] leading-relaxed text-ink-faint">
        Your own manager approves this before it can be applied to anybody.
      </p>
      <div className="mt-3 flex items-center gap-2">
        <Button
          tone="primary"
          size="sm"
          disabled={!name.trim() || !costValid || state.isPending}
          onClick={async () => {
            const res = await create({
              name: name.trim(),
              percent: cost,
              description: description.trim(),
              severity,
              scope: "global",
              departmentIds: [],
            });
            if (res.ok) onDone();
          }}
        >
          {state.isPending ? "Sending…" : "Send for approval"}
        </Button>
        <Button tone="ghost" size="sm" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

/* ── Waiting on you ───────────────────────────────────────────────────────── */

function ApprovalQueue({
  policies,
  loading,
}: {
  policies: ConductPolicy[];
  loading: boolean;
}) {
  const [decide, state] = useAction(
    (r, id: string, decision: "approve" | "reject", reason?: string) =>
      r.decideConductPolicy(id, decision, reason),
  );
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [reason, setReason] = useState("");

  return (
    <Panel>
      <PanelHead
        title="Waiting on you"
        sub="Rules the people who report to you have written."
        aside={
          policies.length > 0 ? (
            <span data-figure className="text-xs text-ink-faint">
              {policies.length}
            </span>
          ) : undefined
        }
      />
      {state.error && (
        <div className="mb-3">
          <InlineError message={state.error} />
        </div>
      )}
      {loading ? (
        <SkeletonRows rows={2} />
      ) : !policies.length ? (
        <EmptyState compact title="Nothing waiting" />
      ) : (
        <ul className="divide-y divide-hairline">
          {policies.map((p) => (
            <li key={p.id} className="py-2.5">
              <div className="flex items-baseline gap-2">
                <span className="min-w-0 flex-1 truncate text-xs text-ink">
                  {p.name}
                </span>
                <span data-figure className="shrink-0 text-xs text-ink-muted">
                  {p.percent}%
                </span>
              </div>
              {p.description && (
                <p className="mt-0.5 text-[11px] leading-relaxed text-ink-faint">
                  {p.description}
                </p>
              )}
              {p.createdByName && (
                <p className="mt-0.5 text-[11px] text-ink-faint">
                  written by {p.createdByName}
                </p>
              )}

              {rejecting === p.id ? (
                <div className="mt-2">
                  <Field label="Why not?" required>
                    <Textarea
                      rows={2}
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                    />
                  </Field>
                  <div className="mt-2 flex items-center gap-2">
                    <Button
                      tone="destructive"
                      size="sm"
                      disabled={!reason.trim() || state.isPending}
                      onClick={async () => {
                        const res = await decide(p.id, "reject", reason.trim());
                        if (res.ok) {
                          setRejecting(null);
                          setReason("");
                        }
                      }}
                    >
                      Reject
                    </Button>
                    <Button
                      tone="ghost"
                      size="sm"
                      onClick={() => {
                        setRejecting(null);
                        setReason("");
                      }}
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="mt-2 flex items-center gap-2">
                  <Button
                    tone="primary"
                    size="sm"
                    disabled={state.isPending}
                    onClick={() => void decide(p.id, "approve")}
                  >
                    Approve
                  </Button>
                  <Button
                    tone="ghost"
                    size="sm"
                    onClick={() => setRejecting(p.id)}
                  >
                    Reject
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

/* ── Disputes ─────────────────────────────────────────────────────────────── */

type Dispute = {
  employeeId: EmployeeId;
  employeeName: string;
  entryId: string;
  policyName: string;
  percent: number;
  date: string | null;
  requestNote: string | null;
};

function DisputeQueue({
  disputes,
  loading,
}: {
  disputes: Dispute[];
  loading: boolean;
}) {
  const [settle, state] = useAction(
    (
      r,
      input: {
        employeeId: EmployeeId;
        entryId: string;
        overturn: boolean;
        note: string;
      },
    ) => r.decideConductRecheck(input),
  );
  const [note, setNote] = useState("");
  const [open, setOpen] = useState<string | null>(null);

  return (
    <Panel>
      <PanelHead
        title="Disputes"
        sub="Deductions the people who report to you say are wrong."
        aside={
          disputes.length > 0 ? (
            <span data-figure className="text-xs text-ink-faint">
              {disputes.length}
            </span>
          ) : undefined
        }
      />
      {state.error && (
        <div className="mb-3">
          <InlineError message={state.error} />
        </div>
      )}
      {loading ? (
        <SkeletonRows rows={2} />
      ) : !disputes.length ? (
        <EmptyState compact title="Nothing disputed" />
      ) : (
        <ul className="divide-y divide-hairline">
          {disputes.map((d) => (
            <li key={d.entryId} className="py-2.5">
              <div className="flex items-baseline gap-2">
                <span className="min-w-0 flex-1 truncate text-xs text-ink">
                  {d.employeeName}
                </span>
                <span data-figure className="shrink-0 text-xs text-ink-muted">
                  −{d.percent}%
                </span>
              </div>
              <p className="mt-0.5 text-[11px] text-ink-faint">
                {d.policyName}
                {d.date && ` · ${d.date}`}
              </p>
              {d.requestNote && (
                <p className="mt-1 rounded-inset bg-[var(--surface-sunken)] px-2 py-1.5 text-[11px] leading-relaxed text-ink-muted">
                  {d.requestNote}
                </p>
              )}

              {open === d.entryId ? (
                <div className="mt-2">
                  <Field label="What you decided, and why" required>
                    <Textarea
                      rows={2}
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                    />
                  </Field>
                  {/* Both outcomes stated as what HAPPENS to the deduction.
                      The engine's own words for these are "confirm" and
                      "reject", where confirm reverses it — the wrong way round
                      for anybody reading, so they stop at the wire. */}
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <Button
                      tone="primary"
                      size="sm"
                      disabled={!note.trim() || state.isPending}
                      onClick={async () => {
                        const res = await settle({
                          employeeId: d.employeeId,
                          entryId: d.entryId,
                          overturn: true,
                          note: note.trim(),
                        });
                        if (res.ok) {
                          setOpen(null);
                          setNote("");
                        }
                      }}
                    >
                      Remove the deduction
                    </Button>
                    <Button
                      tone="ghost"
                      size="sm"
                      disabled={!note.trim() || state.isPending}
                      onClick={async () => {
                        const res = await settle({
                          employeeId: d.employeeId,
                          entryId: d.entryId,
                          overturn: false,
                          note: note.trim(),
                        });
                        if (res.ok) {
                          setOpen(null);
                          setNote("");
                        }
                      }}
                    >
                      It stands
                    </Button>
                    <Button
                      tone="ghost"
                      size="sm"
                      onClick={() => {
                        setOpen(null);
                        setNote("");
                      }}
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : (
                <Button
                  tone="ghost"
                  size="sm"
                  className="mt-2"
                  onClick={() => setOpen(d.entryId)}
                >
                  Decide
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

/* ── Applying a rule ──────────────────────────────────────────────────────── */

/**
 * Charge an approved rule to somebody.
 *
 * Two placements, deliberately. Here it carries a person picker, because a
 * manager who opens C3 is thinking about conduct and has to say who. On
 * somebody's own record (`ApplyConductRule` below) the person is already
 * decided by the page, and asking again would be asking twice.
 */
function ApplyPanel({ policies }: { policies: ConductPolicy[] }) {
  const people = useQuery((r) => r.listEmployees(), []);
  const viewer = useQuery((r) => r.getViewer(), []);
  const [employeeId, setEmployeeId] = useState("");

  /**
   * **The people who report to you — the reporting line, not a permission.**
   *
   * This filtered by `can("conduct.apply", id)`, and that check applies an
   * ADMINISTRATIVE FLOOR: it refuses a target whose administrative level is not
   * strictly below the viewer's. Against the engine's data those levels are
   * routinely equal — often zero on both sides, because a role id that resolves
   * to no role scores nothing — so the floor denied every person and the picker
   * offered nobody at all. The reporting relationship, which is the actual
   * authority here, was never reached.
   *
   * `directReportIds` IS "whose primary manager is you", which is exactly the
   * question. The engine asks it again through `_mayDecideFor` and refuses
   * anybody else, so this is the list narrowing to what it says on the panel
   * rather than the thing granting the power.
   */
  const reports = new Set(viewer.data?.directReportIds ?? []);
  const chargeable = (people.data ?? []).filter(
    (p) => !p.exitedAt && reports.has(p.id),
  );

  return (
    <Panel>
      <PanelHead
        title="Apply a rule"
        sub="Records a breach against somebody who reports to you."
      />
      {!policies.length ? (
        <EmptyState
          compact
          title="No approved rules"
          body="A rule has to be approved by your own manager before it can be applied."
        />
      ) : (
        <>
          <Field label="Who" required>
            <Select
              value={employeeId}
              onChange={(e) => setEmployeeId(e.target.value)}
            >
              <option value="">Choose…</option>
              {chargeable.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.displayName}
                </option>
              ))}
            </Select>
          </Field>
          {employeeId && (
            <div className="mt-3">
              <ApplyConductRule
                employeeId={employeeId}
                policies={policies}
                onDone={() => setEmployeeId("")}
              />
            </div>
          )}
        </>
      )}
    </Panel>
  );
}

/**
 * The apply form itself, for one named person.
 *
 * Exported because the same act belongs on that person's own record, where a
 * manager already has the context to judge it — see `/team/[employeeId]`.
 */
export function ApplyConductRule({
  employeeId,
  policies,
  onDone,
}: {
  employeeId: EmployeeId;
  policies?: ConductPolicy[];
  onDone?: () => void;
}) {
  const fetched = useQuery((r) => r.listConductPolicies(), []);
  const available = (
    policies ??
    (fetched.data ?? []).filter((p) => p.status === "approved" && p.isActive)
  ).filter((p) => p.isActive);

  const [policyId, setPolicyId] = useState("");
  const [reason, setReason] = useState("");
  const [apply, state] = useAction(
    (r, input: { employeeId: EmployeeId; policyId: string; reason: string }) =>
      r.applyConductPolicy(input),
  );

  const chosen = available.find((p) => p.id === policyId);

  if (!available.length) {
    return (
      <EmptyState
        compact
        title="No approved rules"
        body="A rule has to be approved by your own manager before it can be applied."
      />
    );
  }

  return (
    <div className="rounded-inset bg-[var(--surface-sunken)] p-3">
      {state.error && (
        <div className="mb-3">
          <InlineError message={state.error} />
        </div>
      )}
      <Field label="Which rule" required>
        <Select
          value={policyId}
          onChange={(e) => setPolicyId(e.target.value)}
        >
          <option value="">Choose…</option>
          {available.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} — {p.percent}%
            </option>
          ))}
        </Select>
      </Field>
      <Field label="What happened" required className="mt-3">
        <Textarea
          rows={2}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="They will see this, and can dispute it."
        />
      </Field>
      {/* The consequence, in the same numbers the person will see on their own
          page. A control that says only "Apply" hides how much it costs. */}
      {chosen && (
        <p className="mt-2 text-[11px] leading-relaxed text-ink-muted">
          Takes <span data-figure>{chosen.percent}%</span> off their score, and
          they are told.
        </p>
      )}
      <div className="mt-3 flex items-center gap-2">
        <Button
          tone="primary"
          size="sm"
          disabled={!policyId || !reason.trim() || state.isPending}
          onClick={async () => {
            const res = await apply({
              employeeId,
              policyId,
              reason: reason.trim(),
            });
            if (res.ok) {
              setPolicyId("");
              setReason("");
              onDone?.();
            }
          }}
        >
          {state.isPending ? "Applying…" : "Apply"}
        </Button>
        {onDone && (
          <Button tone="ghost" size="sm" onClick={onDone}>
            Cancel
          </Button>
        )}
      </div>
    </div>
  );
}
