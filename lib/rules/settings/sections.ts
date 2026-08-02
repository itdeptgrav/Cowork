/**
 * The settings console, declared once.
 *
 * **Every section names where its value is stored and who enforces it**, because
 * that is the question an administrator cannot answer from a form and the one
 * that decides whether a control should exist at all. A toggle that changes a
 * number on screen and nothing in the product is worse than a missing toggle:
 * the administrator stops looking for the real cause.
 *
 * ## The three enforcement classes, and why they are not interchangeable
 *
 * `both` — the value is read by this app **and** by the legacy Cowork frontend
 * and its Express engine. Only office policy is in this class, and it is why
 * office policy is the section that carries a deadline-impact confirmation.
 *
 * `engine` — the value is read by the Express engine's own scoring services.
 * These reach production scores. They are written to Firestore **and** mirrored
 * into MongoDB through a legacy route; writing one half leaves the other stale,
 * so the repository does both or neither.
 *
 * `cowork_ui` — the value is read only by this application's rules layer. It
 * genuinely changes what a person sees and may do here, and it genuinely does
 * **not** change what the old app does. Sections in this class say so on screen.
 * That divergence is a fact about a half-migrated product, not something a
 * label can dissolve.
 *
 * ## What is deliberately absent
 *
 * There is no section for task lifecycle statuses, priority arithmetic or the
 * extension unit rule. Those are not values an administrator changes; they are
 * the product. Statuses are legacy's vocabulary, priority position is derived
 * from a queue, and the budget/deadline split is enforced by the type system on
 * purpose. Exposing them as configuration would make the tests assert defaults
 * while the real behaviour lived in a document.
 */

/** Who actually reads the value once it is saved. */
export type Enforcement = "both" | "engine" | "cowork_ui";

export interface SettingsSection {
  id: SettingsSectionId;
  label: string;
  href: string;
  /** One line, for the console index. Says what it controls, not how. */
  summary: string;
  /** The document or record the value lives in. Shown to the administrator. */
  store: string;
  enforcement: Enforcement;
  /**
   * Whether saving this section can move the expected completion of live work.
   *
   * A section-level hint used to decide whether to *offer* a confirmation. The
   * authority on a given save is `affectsDeadlines(fields)` in `audit.ts`, which
   * looks at what actually changed — a timezone edit and a holiday edit are the
   * same section and not the same consequence.
   */
  mayAffectDeadlines: boolean;
  /** Present when the section cannot be written, with the reason. */
  readOnly?: string;
}

export type SettingsSectionId =
  | "task-rules"
  | "priority-scoring"
  | "workflow-routing"
  | "organisation"
  | "office-policy"
  | "provisional-rules"
  | "employees";

/**
 * The audit `section` string for each area.
 *
 * Kept beside the section rather than derived from the id: the audit log is
 * append-only and its rows outlive any renaming of a route. A row written today
 * must still be findable if the URL changes tomorrow, so the log's vocabulary is
 * fixed independently of the console's.
 */
export const AUDIT_SECTION: Record<SettingsSectionId, string> = {
  "task-rules": "task_rules",
  "priority-scoring": "scoring",
  "workflow-routing": "workflow_routing",
  organisation: "organisation",
  "office-policy": "office",
  "provisional-rules": "provisional_rules",
  employees: "employees",
};

/** The event names the log records. One per writable area. */
export const TASK_RULES_CHANGED = "TASK_RULES_CHANGED";
export const SCORING_CHANGED = "SCORING_CHANGED";
export const WORKFLOW_ROUTING_CHANGED = "WORKFLOW_ROUTING_CHANGED";
export const PROVISIONAL_RULES_CHANGED = "PROVISIONAL_RULES_CHANGED";

export const SETTINGS_SECTIONS: SettingsSection[] = [
  {
    id: "task-rules",
    label: "Task rules",
    href: "/admin/settings/task-rules",
    summary:
      "Acceptance, submission and escalation gates — what a person must do before a task can move.",
    store: "cowork_settings/task_rules",
    enforcement: "cowork_ui",
    mayAffectDeadlines: false,
  },
  {
    id: "priority-scoring",
    label: "Priority & scoring",
    href: "/admin/settings/priority-scoring",
    summary:
      "Deduction values, component maximums and the idle-pool threshold. These reach real scores.",
    store: "cowork_sop_settings/task_events + MongoDB BandConfig",
    enforcement: "engine",
    mayAffectDeadlines: false,
  },
  {
    id: "workflow-routing",
    label: "Workflow routing",
    href: "/admin/settings/workflow-routing",
    summary:
      "Who decides an extension, when it escalates, and who answers if the named approver cannot.",
    store: "cowork_settings/workflow_routing",
    enforcement: "cowork_ui",
    mayAffectDeadlines: false,
  },
  {
    id: "organisation",
    label: "Organisation",
    href: "/admin/settings/organisation",
    summary:
      "Departments, the reporting closure and the roles derived from it, as the product sees them.",
    store: "MongoDB Employee + cowork_employees",
    enforcement: "both",
    mayAffectDeadlines: false,
    readOnly:
      "The reporting line and departments are HR records. Cowork reads them and never writes them — a second place to change who somebody reports to is a second answer to the question.",
  },
  {
    id: "office-policy",
    label: "Office policy",
    href: "/admin/settings/office-policy",
    summary:
      "Working days, hours, breaks, the daily break allowance and the task action gap.",
    store: "cowork_settings/office",
    enforcement: "both",
    mayAffectDeadlines: true,
  },
  {
    id: "provisional-rules",
    label: "Provisional rules",
    href: "/admin/settings/provisional-rules",
    summary:
      "Placeholder values standing in for decisions nobody has taken. Publishing one resolves it.",
    store: "cowork_settings/rule_overrides",
    enforcement: "cowork_ui",
    mayAffectDeadlines: false,
  },
  {
    id: "employees",
    label: "Add employees",
    href: "/admin/settings/employees",
    summary:
      "Import HR employees into CoWork. Pick who needs an account — the system creates their login and sends a welcome email.",
    store: "Firebase Auth + cowork_employees",
    enforcement: "cowork_ui",
    mayAffectDeadlines: false,
  },
];

export function sectionById(id: SettingsSectionId): SettingsSection {
  const found = SETTINGS_SECTIONS.find((s) => s.id === id);
  /* Throws rather than returning a default. A typo'd section id that silently
     resolved to the first section would write one area's values into another
     area's audit rows, which is unrecoverable — the log is append-only. */
  if (!found) throw new Error(`Unknown settings section: ${id}`);
  return found;
}

/** How the console explains an enforcement class, in one sentence. */
export function enforcementNote(enforcement: Enforcement): string {
  switch (enforcement) {
    case "both":
      return "Read by Cowork and by the legacy app. A change here applies everywhere.";
    case "engine":
      return "Read by the scoring engine. A change here affects published scores.";
    case "cowork_ui":
      return "Enforced by Cowork only. The legacy app does not read these values and will not apply them.";
  }
}
