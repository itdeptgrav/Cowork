import type { TaskStatus } from "@/lib/domain";
import type { TaskView } from "@/lib/repositories";

/**
 * The chip a task shows.
 *
 * Derived from the view rather than the status alone, because the operationally
 * important signal is often not the status: an overdue in-progress task and a
 * healthy in-progress task are the same status and completely different
 * situations. Order matters — the first true condition wins.
 *
 * No tone borrows a C1–C4 hue (The Four Channels Rule) or a field hue.
 */

export type ChipTone =
  | "neutral"
  | "risk"
  | "rework"
  | "extension"
  | "blocked"
  | "overdue"
  | "positive"
  | "solid";

export interface StatusMeta {
  label: string;
  tone: ChipTone;
  /** Longer form for detail headers. */
  description: string;
}

const BASE: Record<TaskStatus, StatusMeta> = {
  draft: { label: "Draft", tone: "neutral", description: "Not yet assigned" },
  pending_approval: {
    label: "Pending approval",
    tone: "extension",
    description: "Waiting on an approval before work can begin",
  },
  assigned: {
    label: "Assigned",
    tone: "neutral",
    description: "Assigned, not yet confirmed",
  },
  deadline_negotiation: {
    label: "Deadline pending",
    tone: "extension",
    description: "A deadline is being agreed",
  },
  confirmed: {
    label: "Confirmed",
    tone: "neutral",
    description: "Confirmed, not yet started",
  },
  in_progress: {
    label: "In progress",
    tone: "neutral",
    description: "Work under way",
  },
  in_review: {
    label: "In review",
    tone: "extension",
    description: "Submitted and awaiting review",
  },
  completed: {
    label: "Completed",
    tone: "positive",
    description: "Approved and closed",
  },
  cancelled: {
    label: "Cancelled",
    tone: "neutral",
    description: "Cancelled — excluded from scoring",
  },
  assignment_rejected: {
    label: "Assignment rejected",
    tone: "overdue",
    description: "An approver rejected this assignment",
  },
};

export function statusMeta(view: TaskView): StatusMeta {
  const { task } = view;

  if (task.isBlocked)
    return {
      label: "Blocked",
      tone: "blocked",
      description: task.blockedReason ?? "Blocked",
    };

  if (view.isOverdue)
    return {
      label: "Overdue",
      tone: "overdue",
      description: "Past its deadline",
    };

  if (task.deadline.state === "extension_pending")
    return {
      label: "Extension requested",
      tone: "extension",
      description: "An extension is awaiting a decision",
    };

  if (view.reworkCount > 0 && task.status === "in_progress")
    return {
      label: view.reworkCount === 1 ? "Rework" : `Rework ×${view.reworkCount}`,
      tone: "rework",
      description: `Sent back ${view.reworkCount} time${view.reworkCount > 1 ? "s" : ""}`,
    };

  return BASE[task.status];
}

export function statusLabel(status: TaskStatus): string {
  return BASE[status].label;
}

/**
 * What this task needs next, and from whom.
 *
 * The brief names "pending action" as a first-class column. Legacy made people
 * infer it from a status enum, which is exactly the inference an operational
 * table should do for them.
 */
export interface NextAction {
  label: string;
  /** Whose move it is, from the current viewer's point of view. */
  actor: "you" | "them" | "nobody";
  href?: string;
}

/**
 * Re-exported, not defined here.
 *
 * `windowOnOffer` moved to `lib/tasks/actionable.ts` when the repository began
 * deciding the action inbox: the repository needs the same answer and must not
 * import from a component. The re-export keeps every existing caller — and this
 * file's own test — pointed at one definition.
 *
 * A relative, extensioned specifier rather than the `@/` alias because
 * `statusMeta.test.ts` runs under plain `node --test`, which resolves neither.
 */
export { windowOnOffer } from "../../../lib/rules/tasks/actionable.ts";
import { windowOnOffer } from "../../../lib/rules/tasks/actionable.ts";
import { budgetTurn } from "../../../lib/rules/tasks/budgetNegotiation.ts";
import { presenceRefusal } from "../../../lib/rules/presence/taskGate.ts";
import { mayReview } from "../../../lib/rules/tasks/reviewChain.ts";
import type { DutyMode } from "../../../lib/rules/presence/duty.ts";

export function nextAction(
  view: TaskView,
  viewerId: string,
  /**
   * The viewer's presence, when the caller knows it.
   *
   * Optional, and permissive when absent — the same meaning `null` carries
   * everywhere else in the presence rules: unknown is not away. A surface that
   * only labels a task ("In progress", "Awaiting review") does not need it; a
   * surface that offers the person a way to ACT on their own work does, because
   * that is the offer legacy withheld.
   */
  dutyMode: DutyMode | null = null,
): NextAction {
  const { task } = view;
  const id = task.id;
  const mine = view.assignments.some((a) => a.employeeId === viewerId);
  const isCreator = task.createdById === viewerId;

  /**
   * Away from your own work.
   *
   * **Placed before every other branch on purpose.** Legacy replaced the whole
   * action banner rather than editing the label inside it, and the ordering is
   * what reproduces that: whatever this task would otherwise be asking of you —
   * confirm it, start it, submit it, accept a window — the answer while you are
   * on a break is the same sentence, and it is not your move until you are back.
   *
   * `actor: "them"` rather than `"you"` is the load-bearing part, not the
   * label. It is what keeps the task out of "Needs action" counts and off the
   * dashboard's your-move lists while somebody is away — otherwise a person on
   * a two-hour emergency accrues a growing pile of things the product insists
   * are waiting on them, every one of which it would refuse to let them do.
   */
  const away = presenceRefusal(dutyMode, mine);
  if (away && task.status !== "completed" && task.status !== "cancelled") {
    return { label: away.short, actor: "them" };
  }

  if (task.status === "completed")
    return { label: "Complete", actor: "nobody" };
  if (task.status === "cancelled")
    return { label: "Cancelled", actor: "nobody" };
  if (task.status === "assignment_rejected")
    return { label: "Assignment rejected", actor: "nobody" };

  if (task.status === "pending_approval") {
    const isApprover = view.pendingApprovals.some(
      (a) => a.approverId === viewerId,
    );
    if (isApprover) {
      /* The budget stage is not an approve/reject — it asks for a number, and
         labelling it "Approve or reject" sends somebody looking for buttons
         that are deliberately not there. */
      const mine = view.pendingApprovals.find((a) => a.approverId === viewerId);
      return {
        label:
          mine?.kind === "effort_estimate"
            ? "Set the time budget"
            : "Approve or reject",
        actor: "you",
        href: `/tasks/${id}`,
      };
    }

    /* Name the person and the position in the chain. "Awaiting approval" is
       true of every pending task and tells the creator nothing they can act
       on — not who to chase, not how much is left. Both facts are already in
       the records; only the label was withholding them. */
    const current = view.approvals.find((a) => a.decision === "pending");
    if (!current) return { label: "Awaiting approval", actor: "them" };
    /* Name the DECISION, not the position. "Awaiting Priya · 2 of 2" is
       accurate and reads as though the same person is being asked twice — the
       count describes the chain, which nobody outside it is tracking. What the
       reader wants is which decision is outstanding and who owes it. */
    /* Named for the reader waiting on somebody else. "department approval" on a
       task that has already cleared both gates is wrong — what it is actually
       waiting for is the receiving department to put a number on the work. */
    const WAITING_ON: Record<string, string> = {
      cross_department: "department approval",
      effort_estimate: "a time budget",
      assignment: "acceptance",
      self_assignment: "sign-off",
      completion: "review",
    };
    const what = WAITING_ON[current.kind];
    return {
      label: what
        ? `Awaiting ${what} from ${current.approverName}`
        : `Awaiting ${current.approverName}`,
      actor: "them",
    };
  }

  if (task.status === "in_review") {
    const isReviewer =
      view.latestSubmission !== null &&
      mayReview({
        chain: view.latestSubmission.reviewChain,
        currentStage: view.latestSubmission.currentStage,
        viewerId,
        submittedById: view.latestSubmission.submittedById,
      });
    return isReviewer
      ? {
          label: "Review submission",
          actor: "you",
          href: `/tasks/${id}/review`,
        }
      : { label: "Awaiting review", actor: "them" };
  }

  /*
   * A self task's time budget is proposed by the ASSIGNEE and decided by their
   * MANAGER.
   *
   * `budgetTurn` is the one authority on whose move a budget is, so this defers
   * to it. Without it a self task falls through to the branches below — written
   * for work somebody else assigned — and offers the assignee "Propose a
   * deadline" or "Confirm receipt" over a figure they have already proposed and
   * are waiting on their manager to approve. Scoped to self tasks so nothing an
   * assignor set on ordinary work is touched; `windowOnOffer` (which excludes
   * self tasks) still owns the standard opening.
   */
  if (task.type === "self_assigned") {
    const bt = budgetTurn(view, viewerId);
    if (
      bt.state === "waiting_for_assignor" ||
      bt.state === "waiting_for_assignee"
    ) {
      if (bt.canAccept) {
        return {
          label:
            bt.state === "waiting_for_assignor"
              ? "Decide the time budget"
              : "Accept the time budget",
          actor: "you",
          href: `/tasks/${id}`,
        };
      }
      return { label: "Awaiting the time budget", actor: "them" };
    }
  }

  if (
    task.deadline.state === "proposed" ||
    task.deadline.state === "extension_pending"
  ) {
    return isCreator
      ? {
          label: "Decide deadline",
          actor: "you",
          href: `/tasks/${id}/deadline`,
        }
      : { label: "Awaiting decision", actor: "them" };
  }

  if (task.deadline.state === "countered") {
    return mine
      ? {
          label: "Respond to counter",
          actor: "you",
          href: `/tasks/${id}/deadline`,
        }
      : { label: "Awaiting response", actor: "them" };
  }

  /* The offer first. Legacy tests `senderSecs > 0 && !senderTimerRejected`
     before it offers "Propose your own duration", because proposing is what you
     do INSTEAD of accepting — naming it first sends the reader past the decision
     they were actually asked to make. */
  if (windowOnOffer(task))
    return mine
      ? {
          label: "Accept or discuss the time",
          actor: "you",
          href: `/tasks/${id}`,
        }
      : { label: "Awaiting the assignee", actor: "them" };

  if (task.deadline.state === "unset")
    return mine
      ? {
          label: "Propose a deadline",
          actor: "you",
          href: `/tasks/${id}/deadline`,
        }
      : { label: "Awaiting deadline", actor: "them" };

  if (task.status === "assigned")
    return mine
      ? { label: "Confirm receipt", actor: "you", href: `/tasks/${id}` }
      : { label: "Awaiting confirmation", actor: "them" };

  if (task.status === "confirmed")
    return mine
      ? { label: "Start work", actor: "you", href: `/tasks/${id}` }
      : { label: "Not started", actor: "them" };

  if (task.status === "in_progress")
    return mine
      ? {
          label: "Submit when ready",
          actor: "you",
          href: `/tasks/${id}/submission`,
        }
      : { label: "In progress", actor: "them" };

  return { label: "—", actor: "nobody" };
}

export const ALL_STATUSES: TaskStatus[] = [
  "draft",
  "pending_approval",
  "assigned",
  "deadline_negotiation",
  "confirmed",
  "in_progress",
  "in_review",
  "completed",
  "cancelled",
  "assignment_rejected",
];
