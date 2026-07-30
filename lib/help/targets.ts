/**
 * Stable identifiers for the UI elements a walkthrough can point at.
 *
 * One registry, used by BOTH sides: the component writes
 * `data-help={HELP_TARGETS.taskTitleField}` and the walkthrough step names the
 * same constant. Neither side can drift without the other failing to compile.
 *
 * Why a registry rather than string literals at each site: a `data-help`
 * attribute deleted during a refactor breaks a walkthrough silently, and it
 * fails at the worst possible moment — mid-tour, for somebody who is already
 * lost. Nothing in TypeScript, ESLint or the type system objects to a missing
 * attribute. So it is checked mechanically instead, in `guides.test.ts`.
 *
 * These are NOT CSS selectors and must never become them. A class name is a
 * styling decision that changes when the design changes; a help target is a
 * contract that says "this control is the one the walkthrough means".
 */
export const HELP_TARGETS = {
  /* Tasks — creation */
  newTaskButton: "new-task-button",
  taskTitleField: "task-title-field",
  taskAssigneeField: "task-assignee-field",
  taskDeadlineMode: "task-deadline-mode",
  taskSubmitButton: "task-create-submit",

  /* Tasks — the working surface */
  taskScopeSwitch: "task-scope-switch",
  approvalsTab: "task-approvals-tab",

  /* Review and approval */
  reviewQueueList: "review-queue-list",
  approveButton: "review-approve-button",
  rejectButton: "review-reject-button",
  reviewReasonField: "review-reason-field",

  /* Submitting work */
  submitWorkButton: "task-submit-work-button",
  submissionMessageField: "submission-message-field",

  /* Deadline and budget */
  deadlineRequestButton: "deadline-request-button",
  deadlineReasonField: "deadline-reason-field",
} as const;

export type HelpTarget = (typeof HELP_TARGETS)[keyof typeof HELP_TARGETS];

/** Every registered target, for the drift guards. */
export const ALL_HELP_TARGETS: HelpTarget[] = Object.values(HELP_TARGETS);
