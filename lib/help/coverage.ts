import type { HelpCategory } from "./types.ts";

/**
 * What guidance the product is supposed to have, and what it actually has.
 *
 * This is a declared inventory, not a derived one. Deriving coverage from the
 * guides that exist would make it a tautology — everything written is covered
 * by definition, and the gaps are exactly what you cannot see. Declaring the
 * intended surface first means an unwritten walkthrough shows up as a gap
 * rather than as silence.
 *
 * `covered` is the honest column. A `false` here is not a bug; it is work that
 * has not been done, visible in a report and countable in a test. The failure
 * this prevents is the one where "we have onboarding" is true of task creation
 * and of nothing else, and nobody notices until a user does.
 */

export interface CoverageItem {
  /** The field, control or concept a reader needs guiding through. */
  name: string;
  /** True once a walkthrough step actually points at it. */
  covered: boolean;
  /** Why it is not covered yet, when it is not. */
  note?: string;
}

export interface WorkflowCoverage {
  id: string;
  title: string;
  category: HelpCategory;
  /** The article whose "Show me" runs this, when one exists. */
  articleId: string | null;
  items: CoverageItem[];
}

const c = (name: string): CoverageItem => ({ name, covered: true });
const gap = (name: string, note: string): CoverageItem => ({
  name,
  covered: false,
  note,
});

export const WORKFLOW_COVERAGE: WorkflowCoverage[] = [
  {
    id: "create-task",
    title: "Creating a task",
    category: "tasks",
    articleId: "task-create",
    items: [
      c("New task button"),
      c("Title"),
      c("Assignee selection"),
      c("Employee search and filters"),
      c("Deadline model (Budget vs Deadline based)"),
      c("Create action"),
      gap("Task type", "No data-help on the type selector yet."),
      gap("Description", "Field exists; no step points at it."),
      gap("Acceptance criteria", "Requirements list has no target."),
      /* No "Owning department" item: the field was removed from the form, so
         there is no control to guide anyone through. The concept is still
         explained by the task-owning-department article, which is where a
         derived rule belongs. */
      gap("Attachments", "No attachment control in the create form today."),
    ],
  },
  {
    id: "submit-completion",
    title: "Submitting work",
    category: "tasks",
    articleId: "task-submit",
    items: [
      c("Finding your assigned work"),
      c("Submit for review"),
      c("Submission message"),
      gap("Starting a task", "Timer control has no target."),
      gap("Progress updates", "Daily report panel not targeted."),
      gap(
        "Attachments on a submission",
        "No target on the attachment control.",
      ),
    ],
  },
  {
    id: "approve-task",
    title: "Approving work",
    category: "approvals",
    articleId: "approvals-who-approves",
    items: [
      c("Approvals view"),
      c("Review queue"),
      c("Approve"),
      c("Reject"),
      gap("Reading the stage indicator", "Stage chip has no target."),
      gap("Requesting rework", "Rework control not targeted separately."),
    ],
  },
  {
    id: "reject-task",
    title: "Rejecting or reworking",
    category: "approvals",
    articleId: "task-rework",
    items: [
      c("Review queue"),
      c("Reason field"),
      c("Reject"),
      gap(
        "Choosing rework over rejection",
        "No step contrasts the two in the UI.",
      ),
    ],
  },
  {
    id: "request-deadline-change",
    title: "Asking for a deadline change",
    category: "tasks",
    articleId: "task-budget-vs-deadline-rights",
    items: [
      c("Request control"),
      c("Reason field"),
      gap(
        "Adjusting a budget within the allowance",
        "No target on the budget control.",
      ),
      gap(
        "Deciding a request as the assignor",
        "Decision controls not targeted.",
      ),
    ],
  },

  /* ── Declared, not yet built. Each is a workflow the product has and the
     guidance does not, which is precisely what this registry exists to say. */
  {
    id: "score-system",
    title: "Understanding your score",
    category: "scoring",
    articleId: null,
    items: [
      gap("Score overview", "No walkthrough; the explanation covers it."),
      gap("C1–C4 breakdown", "No targets on the channel band."),
      gap("Ledger", "No targets on ledger rows."),
      gap("Private versus team view", "Lens toggle has no target."),
    ],
  },
  {
    id: "team-management",
    title: "Managing a team",
    category: "roles",
    articleId: null,
    items: [
      gap("Team roster", "No targets."),
      gap("Workload view", "No targets."),
      gap("Per-person drill-in", "No targets."),
    ],
  },
  {
    id: "profile-settings",
    title: "Profile and settings",
    category: "settings",
    articleId: null,
    items: [
      gap("Personal settings", "No targets."),
      gap("Notifications", "No notification preferences surface exists yet."),
    ],
  },
  {
    id: "admin-configuration",
    title: "Administering Cowork",
    category: "settings",
    articleId: null,
    items: [
      gap("Role editor", "No targets."),
      gap("Departments and heads of department", "No targets."),
      gap("Reporting lines", "No targets."),
      gap("Approval workflows", "No targets."),
      gap("Scoring rules", "No targets."),
    ],
  },
];

export interface CoverageSummary {
  workflow: string;
  covered: number;
  total: number;
  percent: number;
  missing: string[];
}

export function coverageReport(): CoverageSummary[] {
  return WORKFLOW_COVERAGE.map((w) => {
    const covered = w.items.filter((i) => i.covered).length;
    return {
      workflow: w.title,
      covered,
      total: w.items.length,
      percent: Math.round((covered / w.items.length) * 100),
      missing: w.items.filter((i) => !i.covered).map((i) => i.name),
    };
  });
}

export function overallCoverage(): {
  covered: number;
  total: number;
  percent: number;
} {
  const items = WORKFLOW_COVERAGE.flatMap((w) => w.items);
  const covered = items.filter((i) => i.covered).length;
  return {
    covered,
    total: items.length,
    percent: Math.round((covered / items.length) * 100),
  };
}
