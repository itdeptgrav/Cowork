import type { Approval, Task } from "@/lib/domain";

/**
 * Where a task has got to, who owes the next action, and what happens after.
 *
 * **This decides nothing.** Every stage below is read off state the engine
 * already wrote — the department gate's own `approvals` array, `assigneeIds`,
 * `pendingAssigneeIds`, the review chain. Nothing here approves, advances or
 * re-orders anything; it answers three questions a status label cannot:
 *
 *   *Whose turn is it? · What happens next? · Why is it waiting?*
 *
 * "Pending approval" answers none of them. A cross-department task can sit for
 * days with the reader unable to tell whether it is stuck on their own head of
 * department, the receiving one, or nobody at all — and the state that would
 * tell them was already on the task.
 *
 * **The honesty rule.** Where the data does not say, this says so. A gated task
 * whose `approvals` array is empty yields one undetermined stage reading
 * "Waiting for department approval" — never a guessed name, and never an
 * invented sequence. Ordering is the engine's array order, because that IS the
 * sequence the engine clears: `sender` first, which flips `receiver` from
 * `waiting` to `pending`.
 */

export type StageState =
  /** Cleared. Carries who did it and when, where the engine recorded them. */
  | "done"
  /** The action is owed now, by the person named. Exactly one, or none. */
  | "current"
  /** Reached only after the current stage clears. */
  | "upcoming"
  /** Refused or cancelled here. Nothing downstream will happen. */
  | "blocked";

export interface FlowStage {
  key: string;
  /** What happens at this stage, in the reader's words. */
  label: string;
  /** Who owns it, or null where the engine has not named anybody. */
  person: string | null;
  /** Their standing at this stage — "Sending department", never a raw role id. */
  role: string | null;
  state: StageState;
  /** ISO, only ever for a stage that actually happened. */
  at: string | null;
  /** One line of context: "Current action required", "Starts after approval". */
  note: string | null;
}

export interface TaskFlow {
  stages: FlowStage[];
  /** *Whose turn is it?* — null when the task is finished or nobody is owed. */
  whoseTurn: string | null;
  /** *What happens next?* Always present; terminal tasks say they are done. */
  whatNext: string;
  /** *Why is it waiting?* Only when something is genuinely blocking. */
  whyWaiting: string | null;
}

/** Resolves an employee id to a display name. Returns null when unknown. */
export type NameOf = (id: string) => string | null;

/**
 * A name for somebody the engine identified but we cannot resolve.
 *
 * Printing a raw id ("GR0081") on a workflow diagram tells a reader nothing and
 * looks like a bug. Saying the role is honest and useful: they know an approval
 * is owed and by which side, just not by whom.
 */
function personLabel(id: string, nameOf: NameOf, fallback: string): string {
  const name = nameOf(id);
  return name && name.trim() !== "" ? name : fallback;
}

function sideLabel(side: "sender" | "receiver" | null): string | null {
  if (side === "sender") return "Sending department";
  if (side === "receiver") return "Receiving department";
  return null;
}

/**
 * The department gate, one stage per approver, in the engine's order.
 *
 * A `waiting` entry is deliberately NOT rendered as pending. The receiving
 * side cannot act until the sending side clears, and showing both as "action
 * required" would send two people to a screen where only one has a button.
 */
function approvalStages(approvals: Approval[], nameOf: NameOf): FlowStage[] {
  return [...approvals]
    .sort((a, b) => a.stage - b.stage)
    .map((a) => {
      const role = sideLabel(a.side);
      const person = personLabel(
        a.approverId,
        nameOf,
        a.approverName || role || "Department head",
      );
      const state: StageState =
        a.decision === "approved"
          ? "done"
          : a.decision === "rejected"
            ? "blocked"
            : a.decision === "pending"
              ? "current"
              : "upcoming";
      return {
        key: `approval-${a.stage}`,
        label:
          a.decision === "rejected"
            ? "Approval refused"
            : a.decision === "approved"
              ? "Approved"
              : "Department approval",
        person,
        role,
        state,
        at: a.decidedAt,
        note:
          a.decision === "pending"
            ? "Current action required"
            : a.decision === "waiting"
              ? "Waiting for the previous approval"
              : a.decision === "rejected"
                ? (a.reason ?? "Refused at this stage")
                : null,
      } satisfies FlowStage;
    });
}

/**
 * The whole flow.
 *
 * Built forward from creation so the reader sees the shape of the journey and
 * not only the step it is stuck on — which is what makes a diagram worth more
 * than a label.
 */
export function taskFlow(input: {
  task: Task;
  approvals: Approval[];
  /*
   * Passed in rather than read off the task, because the domain does not put it
   * there: assignment is its own record (`TaskAssignment`), which is what lets
   * a task be owned by a department before anybody holds it. The caller already
   * has the resolved people.
   */
  assigneeIds: string[];
  /** Only where the record has one. Absent is normal and prints no date. */
  completedAt?: string | null;
  /**
   * The team lead who may set a pending time budget.
   *
   * Resolved from the directory for every viewer — not only the one who can
   * act — so the stage names somebody instead of reading as an anonymous wait.
   */
  budgetOwnerName?: string | null;
  /**
   * Whose turn it is on a time budget, already phrased.
   *
   * Passed in rather than derived: the turn rule reads the whole task view, and
   * this module deliberately takes only what it renders.
   */
  budgetWaitingOn?: string | null;
  /**
   * Whether the time budget is currently the assignee's MANAGER's to decide.
   *
   * True on a self task whose proposed budget is waiting on the manager
   * (`waiting_for_assignor`), and on an ordinary task the assignee has countered.
   * It inserts a budget stage the manager owns and holds the assignment as
   * upcoming — without it a self task jumps to "Assigned · waiting to be
   * accepted" and names the assignee as the one holding up their own proposal.
   */
  budgetOnOwner?: boolean;
  /**
   * Whether the READER is the person who owes the acceptance.
   *
   * Passed in for the same reason as `budgetWaitingOn`: this module renders a
   * diagram and deliberately takes only what it renders, while who the viewer is
   * belongs to `getAssignmentActions`. Without it the acceptance sentence
   * describes the reader in the third person, which is how "Waiting for Umung
   * Arora — you" came to read as a report rather than a prompt.
   */
  acceptanceIsViewers?: boolean;
  /*
   * The reviewer sequence, resolved at submission and carried on the
   * submission record — NOT on the task. Optional because the legacy read path
   * does not populate `latestSubmission` today (`taskMap.ts`), so on production
   * data this is absent and the review stage stays deliberately unnamed. When
   * it does arrive, "stage 1 of 2" and the reviewer's name come from here and
   * are never derived from the reporting tree, which would be a guess.
   */
  review?: { chain: string[]; currentStage: number } | null;
  nameOf: NameOf;
}): TaskFlow {
  const { task, approvals, assigneeIds, nameOf } = input;
  const stages: FlowStage[] = [];

  const creator = personLabel(task.createdById, nameOf, "Unknown");
  stages.push({
    key: "created",
    label: "Created",
    person: creator,
    role: null,
    state: "done",
    at: task.createdAt,
    note: null,
  });

  /* ── The department gate ────────────────────────────────────────────────── */

  const gated =
    task.pendingAssigneeIds.length > 0 && assigneeIds.length === 0;
  const gateStages = approvalStages(approvals, nameOf);

  if (gateStages.length > 0) {
    stages.push(...gateStages);
  } else if (gated) {
    /* The engine holds the task but did not tell us who is deciding. Naming a
       likely approver here would be a guess printed on a workflow diagram,
       which is worse than an honest gap — the reader would go and ask the
       wrong person. */
    stages.push({
      key: "approval-undetermined",
      label: "Waiting for department approval",
      person: null,
      role: null,
      state: "current",
      at: null,
      note: "The approvers have not been recorded on this task",
    });
  }

  /* ── The budget ─────────────────────────────────────────────────────────── */

  /*
   * A stage of its own, between the gate and the assignment.
   *
   * The engine inserts it silently: with `hasTimer === false`, clearing the last
   * department approval moves the task to `pending_tl_hours` rather than
   * assigning it, and the person stays in `pendingAssigneeId` until a number of
   * hours is supplied. A timeline that jumps from "approved" to "assignment"
   * describes a handover that has not happened and cannot explain the wait.
   */
  const awaitingBudget = task.approvalReason === "effort_estimate";
  /* A self task's budget is the assignee's MANAGER's to decide before the
     assignment goes live: the assignee proposed a figure and the turn rule
     reports it as `waiting_for_assignor`. It is the same shape of step as the
     cross-department effort estimate — a number the manager owes before the work
     is handed over — so it is modelled as the same stage. Without it the diagram
     skips straight to "Assigned · waiting to be accepted" and names the assignee
     as the one holding up a proposal that is actually sitting with their
     manager. */
  const budgetOnOwner = input.budgetOnOwner === true;
  if (awaitingBudget || budgetOnOwner) {
    /* Named only where the viewer is the person who can act — that entry is
       synthesised for them alone. Everybody else sees the stage without a name,
       which is honest: the engine authorises a role in a department rather than
       an individual, and no individual is recorded. */
    const owner = approvals.find((a) => a.kind === "effort_estimate") ?? null;
    stages.push({
      key: "budget",
      /* "Set" where no figure exists yet (the effort estimate); "Approve" where
         the assignee has already proposed one and the manager decides on it. */
      label: awaitingBudget ? "Set the time budget" : "Approve the time budget",
      person: owner
        ? personLabel(owner.approverId, nameOf, owner.approverName)
        : (input.budgetOwnerName ?? null),
      /* Not a department. The budget is a management decision about one
         person's work, so the label names the relationship that authorises it
         — "Receiving department" pointed at the wrong idea entirely. */
      role: "The assignee's manager",
      state: "current",
      at: null,
      note: awaitingBudget
        ? "The work needs an agreed number of hours before it is handed over"
        : "The assignee proposed a time budget; their manager approves or adjusts it before work starts",
    });
  }

  /* ── Assignment ─────────────────────────────────────────────────────────── */

  const assigneeNames = assigneeIds.map((id) =>
    personLabel(id, nameOf, "Assignee"),
  );
  const pendingNames = task.pendingAssigneeIds.map((id) =>
    personLabel(id, nameOf, "Assignee"),
  );

  const started =
    task.status === "in_progress" ||
    task.status === "in_review" ||
    task.status === "completed";

  if (gated) {
    stages.push({
      key: "assignment",
      label: "Employee assignment",
      person: pendingNames.join(", ") || null,
      role: null,
      state: "upcoming",
      at: null,
      note: awaitingBudget
        ? "Starts once the budget is set"
        : "Starts after approval",
    });
  } else if (assigneeNames.length > 0) {
    stages.push({
      key: "assignment",
      label: "Assigned",
      person: assigneeNames.join(", "),
      role: null,
      state:
        started || task.status === "confirmed"
          ? "done"
          : /* Held behind the budget. The assignment is real, but it is not the
               CURRENT step until the manager settles the hours — otherwise the
               diagram shows two current stages, or names the assignee as owing a
               move that is actually their manager's. */
            budgetOnOwner
            ? "upcoming"
            : "current",
      at: null,
      note: budgetOnOwner
        ? "Starts once the manager settles the time budget"
        : task.status === "assigned"
          ? "Waiting to be accepted"
          : task.status === "deadline_negotiation"
            ? "Deadline is being agreed"
            : null,
    });
  }

  /* ── The work ───────────────────────────────────────────────────────────── */

  if (!gated && assigneeNames.length > 0) {
    stages.push({
      key: "work",
      label: task.status === "in_progress" ? "Working on task" : "Work",
      person: assigneeNames.join(", "),
      role: null,
      state:
        task.status === "in_progress"
          ? "current"
          : task.status === "in_review" || task.status === "completed"
            ? "done"
            : "upcoming",
      at: null,
      note: task.status === "in_progress" ? "Submit completion when done" : null,
    });
  }

  /* ── Review ─────────────────────────────────────────────────────────────── */

  if (task.status === "in_review" || task.status === "completed") {
    const chain = input.review?.chain ?? [];
    const at = input.review?.currentStage ?? 0;
    const reviewer = chain[at] ? personLabel(chain[at], nameOf, "Reviewer") : null;
    stages.push({
      key: "review",
      label: task.status === "completed" ? "Approved" : "Manager review",
      /* Named only from the recorded chain. Where there is none the stage is
         left unnamed rather than guessed at from the reporting tree — the tree
         is how a chain is BUILT, not proof of who it named on this task. */
      person: task.status === "completed" ? null : reviewer,
      role:
        chain.length > 1 && task.status === "in_review"
          ? `Stage ${at + 1} of ${chain.length}`
          : null,
      state: task.status === "completed" ? "done" : "current",
      at: task.status === "completed" ? (input.completedAt ?? null) : null,
      note:
        task.status === "in_review"
          ? "Approve · Rework · Reject"
          : null,
    });
  } else if (!gated && assigneeNames.length > 0) {
    stages.push({
      key: "review",
      label: "Manager review",
      person: null,
      role: null,
      state: "upcoming",
      at: null,
      note: "After the work is submitted",
    });
  }

  /* ── Terminal states replace the tail rather than sitting after it ──────── */

  if (task.status === "cancelled" || task.status === "assignment_rejected") {
    const kept = stages.filter((s) => s.state === "done");
    return {
      stages: [
        ...kept,
        {
          key: "stopped",
          label:
            task.status === "cancelled" ? "Cancelled" : "Assignment refused",
          person: null,
          role: null,
          state: "blocked",
          at: null,
          note: "This task will not go further",
        },
      ],
      whoseTurn: null,
      whatNext:
        task.status === "cancelled"
          ? "Nothing — this task was cancelled."
          : "Nothing — the assignment was refused.",
      whyWaiting: null,
    };
  }

  const current = stages.find((s) => s.state === "current") ?? null;
  const upcoming = stages.filter((s) => s.state === "upcoming");
  const blocked = stages.find((s) => s.state === "blocked") ?? null;

  return {
    stages,
    whoseTurn: blocked ? null : (current?.person ?? null),
    whatNext: nextSentence({ task, current, upcoming, blocked, gated }),
    whyWaiting: whyWaitingSentence({
    task,
    current,
    gated,
    awaitingBudget,
    blocked,
    budgetWaitingOn: input.budgetWaitingOn ?? null,
    acceptanceIsViewers: input.acceptanceIsViewers === true,
  }),
  };
}

/** *What happens next?* — the stage after the current one, named. */
function nextSentence(input: {
  task: Task;
  current: FlowStage | null;
  upcoming: FlowStage[];
  blocked: FlowStage | null;
  gated: boolean;
}): string {
  const { task, current, upcoming, blocked } = input;

  if (blocked) return "Nothing further — this task was refused.";
  if (task.status === "completed") return "Nothing — this task is complete.";

  const next = upcoming[0];
  if (!next) {
    return current
      ? `${current.label} is the last recorded step.`
      : "No further steps are recorded on this task.";
  }
  if (next.person) return `${next.label} — ${next.person}`;
  return next.label;
}

/**
 * *Why is it waiting?* — only when something genuinely holds it.
 *
 * A task in progress is not "waiting"; saying so on every screen would make the
 * word meaningless where it matters.
 */
function whyWaitingSentence(input: {
  task: Task;
  current: FlowStage | null;
  gated: boolean;
  awaitingBudget: boolean;
  blocked: FlowStage | null;
  budgetWaitingOn: string | null;
  /** Whether the READER is the person who owes the acceptance. */
  acceptanceIsViewers: boolean;
}): string | null {
  const { task, current, gated, blocked } = input;

  if (blocked) return blocked.note;
  if (input.awaitingBudget) {
    return current?.person
      ? `Before the work is handed over, ${current.person} — who manages the assignee — has to set how many hours it is worth.`
      : "The assignee has no manager recorded, so there is nobody the system will accept a time budget from.";
  }
  if (gated) {
    return current?.person
      ? `Work crossing departments needs approval before it is assigned. ${current.person} has not decided yet.`
      : "Work crossing departments needs approval before it is assigned.";
  }
  if (task.status === "assigned") {
    /* More specific than "not accepted yet" where a budget is being agreed —
       that phrasing suggests the assignee is simply slow, when in fact the
       turn may be sitting with the person who set the time. */
    if (input.budgetWaitingOn) return input.budgetWaitingOn;
    /* **Addressed to the reader when it is theirs.** "The assignee has not
       accepted it yet" is a third-person report, and reading it about yourself
       is what made "Waiting for Umung Arora — you" feel like a wall rather than
       a prompt: it describes the delay instead of naming the move. The action
       itself is on the confirmation card above this; the sentence's job is to
       send somebody to it. */
    return input.acceptanceIsViewers
      ? "You have not accepted it yet — accept it above to start work."
      : "The assignee has not accepted it yet.";
  }
  if (task.status === "deadline_negotiation") {
    return "A different deadline has been proposed and not yet agreed.";
  }
  if (task.status === "in_review") {
    return "The work is submitted and waiting for a reviewer.";
  }
  return null;
}
