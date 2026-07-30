"use client";

import { useState } from "react";
import { Button, Field, InlineError, Panel } from "@/components/ui/Primitives";
import { useAction } from "@/lib/hooks/useRepository";
import type { Approval, Employee, Task } from "@/lib/domain";

/**
 * The decision this viewer owes on this task, with the buttons to make it.
 *
 * **Why this exists at all.** The timeline said "current action required" and
 * there was no control anywhere on the page. Two faults met: `pendingApprovals`
 * was hardcoded empty in the mapper, so the existing button block could never
 * find the viewer's approval; and `decideApproval` passed the composite
 * approval id to an endpoint that looks up a task, so even a rendered button
 * would have failed. Both are fixed at their source — this card is the surface,
 * not the fix.
 *
 * It shows for the CURRENT approver only. A `waiting` entry belongs to somebody
 * whose turn has not come — the engine flips it to `pending` when the stage
 * before it clears — and offering them a button would be offering an action the
 * engine refuses.
 */
export function ApprovalActionCard({
  task,
  approvals,
  pendingApprovals,
  assignees,
  pendingAssignees,
  creator,
  viewerId,
  onDone,
}: {
  task: Task;
  approvals: Approval[];
  pendingApprovals: Approval[];
  assignees: Employee[];
  pendingAssignees: Employee[];
  creator: Employee | null;
  viewerId: string | null;
  onDone: () => void;
}) {
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const [decide, state] = useAction(
    (r, approvalId: string, decision: "approved" | "rejected", why: string) =>
      r.decideApproval(approvalId, decision, why),
  );

  /*
   * Three conditions, and matching on the viewer alone was not enough.
   *
   * `pendingApprovals` carries every stage somebody can act on, and at the
   * budget stage that is a synthesised `effort_estimate` entry. Finding it by
   * `approverId` alone, this card rendered "Approve your department taking this
   * work on" over a task that had cleared both gates — and its Approve button
   * posted a department decision the engine answered with "This task is not
   * waiting on a department approval."
   *
   * So: the right KIND of decision, owed by THIS viewer, on a task whose
   * current state IS that decision. The third clause is not redundant — it is
   * what stops a completed approval record from rendering as a live action
   * after the workflow has moved past it.
   */
  const mine =
    viewerId && task.approvalReason === "cross_department"
      ? (pendingApprovals.find(
          (a) => a.approverId === viewerId && a.kind === "cross_department",
        ) ?? null)
      : null;
  /* Everybody else gets the read-only timeline below. */
  if (!mine) return null;

  const directory = new Map<string, string>();
  for (const e of [...assignees, ...pendingAssignees, creator]) {
    if (e) directory.set(e.id, e.displayName);
  }
  /* What happens after this decision, named. The generic "it will move on" is
     the sentence that made the old copy useless — the reader wants to know
     whether they are the last gate or the first of two. */
  const outstanding = approvals.filter(
    (a) => a.decision === "pending" || a.decision === "waiting",
  );
  const isLastGate = outstanding.length <= 1;
  const forWhom = pendingAssignees.map((p) => p.displayName).join(", ");

  /*
   * The next approver can be the viewer again.
   *
   * Real shape, from T631: one person is recorded as BOTH the sending and the
   * receiving side, so they approve twice. Naming them in the third person —
   * "it goes to Rishee Ray" to Rishee Ray — reads as a bug and hides the fact
   * that another decision is coming back to them.
   */
  const nextApprover = outstanding.find((a) => a.id !== mine.id) ?? null;
  const nextIsMe = nextApprover?.approverId === viewerId;
  const nextName = nextApprover
    ? (directory.get(nextApprover.approverId) ?? nextApprover.approverName)
    : null;

  return (
    <Panel data-help="approval-action">
      <p className="text-[11px] tracking-[0.09em] text-ink-faint uppercase">
        Your approval is needed
      </p>
      <p className="mt-0.5 text-[15px] leading-snug text-ink">
        {mine.side === "sender"
          ? "Approve sending this work to another department"
          : mine.side === "receiver"
            ? "Approve your department taking this work on"
            : "Approve this assignment"}
      </p>

      <p className="mt-1.5 text-[13px] leading-relaxed text-ink-muted">
        {isLastGate
          ? forWhom
            ? `This is the last approval. Once you approve, the task is assigned to ${forWhom} and they can start.`
            : "This is the last approval. Once you approve, the task is assigned and work can start."
          : nextIsMe
            ? "You are recorded as the approver on both sides, so after this it comes back to you once more for the receiving department's decision."
            : nextName
              ? `After you approve, it goes to ${nextName} for the receiving department's decision.`
              : "After you approve, it goes to the receiving department for their decision."}
      </p>

      {state.error && <InlineError message={state.error} />}

      {rejecting ? (
        <div className="mt-3">
          {/* A reason is required for a refusal and not for an approval, which
              matches the record: the engine stores `rejectionReason` and has no
              field for why somebody agreed. Refusing without saying why leaves
              the sender with a dead task and nothing to act on. */}
          <Field
            label="Why are you refusing this?"
            hint="The person who raised it sees this."
          >
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              autoFocus
              className="w-full rounded-xl border border-[var(--hairline)] bg-[var(--surface-sunken)] px-3 py-2 text-[14px] text-ink outline-none focus:border-ink/30"
              placeholder="The team has no capacity this sprint"
            />
          </Field>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button
              tone="destructive"
              size="sm"
              disabled={state.isPending || reason.trim() === ""}
              onClick={async () => {
                const r = await decide(mine.id, "rejected", reason.trim());
                if (r.ok) onDone();
              }}
              data-help="approval-reject-confirm"
            >
              {state.isPending ? "Refusing…" : "Refuse assignment"}
            </Button>
            <Button
              tone="ghost"
              size="sm"
              disabled={state.isPending}
              onClick={() => {
                setRejecting(false);
                setReason("");
              }}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button
            tone="primary"
            size="sm"
            disabled={state.isPending}
            onClick={async () => {
              const r = await decide(mine.id, "approved", "");
              if (r.ok) onDone();
            }}
            data-help="approval-approve-button"
          >
            {state.isPending ? "Approving…" : "Approve"}
          </Button>
          <Button
            tone="destructive"
            size="sm"
            disabled={state.isPending}
            onClick={() => setRejecting(true)}
            data-help="approval-reject-button"
          >
            Refuse
          </Button>
          {/* No third option. The engine's endpoint takes `approved` as a
              boolean and a rejection reason — there is no send-back, and a
              button that quietly refused instead would be worse than its
              absence. */}
        </div>
      )}
    </Panel>
  );
}
