import type { LegacyResult } from "./envelope";
import { legacyFetch } from "./http.ts";

/**
 * Task mutations, against the engine's own endpoints.
 *
 * ## Why every one of these is an API call and not a Firestore write
 *
 * Legacy reads tasks straight from Firestore in the browser — 22 listeners on
 * the old task page — so it is tempting to write them the same way. **It never
 * does.** `CreateTaskModal.jsx` contains no `fetch` and no task write; it calls
 * `createTask()` in `lib/mediaUploadApi.js:153`, which POSTs. Every lifecycle
 * transition follows that pattern.
 *
 * The reason is that the document is not the decision. `POST /cowork/task/create`
 * alone runs five approval gates, resolves cross-department approvers with an
 * `E000` fallback, computes a per-assignee priority map from live open-task
 * counts, generates the `taskId`, stamps the PMP quarter, and fans out
 * notifications and email. A direct Firestore write produces a document that
 * *looks* right and has skipped all of it — no approval, no rank, no
 * notification, and a client-chosen id that may collide.
 *
 * So: **no task write in this application touches Firestore.** Reads are
 * Firestore because legacy's visibility rules live in its queries; writes are
 * HTTP because legacy's business rules live in its handlers.
 *
 * ## What the server decides, whatever we send
 *
 * `taskForward.js:137` does not even destructure `status`, `createdBy`,
 * `createdByRole` or `dueDate` from the body. They are computed:
 *
 * | Field | Decided by |
 * |---|---|
 * | `taskId` | `_generateTaskId()` |
 * | `assignedBy` | the verified token, never the body |
 * | `status` | the gate chain — `open`, `pending_tl_approval`, `pending_department_approval`, `pending_tl_hours`, `repeat_pending_confirmation` |
 * | `dueDate` | forced `null` — "deadline is always set by employee after assignment" |
 * | `priority` + `assigneePriorities` | live open-task count per assignee |
 *
 * Sending them anyway would be describing an intention the server discards.
 * This module sends only what the handler reads.
 */

/** `POST /cowork/task/create`. Returns the created task document. */
export async function createTask(input: {
  token: string;
  body: Record<string, unknown>;
}): Promise<LegacyResult<{ taskId?: string } & Record<string, unknown>>> {
  return legacyFetch({
    path: "/cowork/task/create",
    method: "POST",
    body: input.body,
    envelopeKey: "task",
    token: input.token,
  });
}

/** `PATCH /cowork/task/:id/edit-details` — title, description, requirements. */
export async function editTaskDetails(input: {
  token: string;
  taskId: string;
  title?: string;
  description?: string;
  requirements?: string[];
}): Promise<LegacyResult<unknown>> {
  return legacyFetch({
    path: `/cowork/task/${encodeURIComponent(input.taskId)}/edit-details`,
    method: "PATCH",
    body: {
      title: input.title,
      description: input.description,
      requirements: input.requirements,
    },
    token: input.token,
  });
}

/** `POST /cowork/task/:id/confirm` — the assignee acknowledges receipt. */
export async function confirmTask(input: {
  token: string;
  taskId: string;
}): Promise<LegacyResult<unknown>> {
  return legacyFetch({
    path: `/cowork/task/${encodeURIComponent(input.taskId)}/confirm`,
    method: "POST",
    token: input.token,
  });
}

/** `POST /cowork/task/:id/start` — work begins. */
export async function startTask(input: {
  token: string;
  taskId: string;
}): Promise<LegacyResult<unknown>> {
  return legacyFetch({
    path: `/cowork/task/${encodeURIComponent(input.taskId)}/start`,
    method: "POST",
    token: input.token,
  });
}

/**
 * `POST /cowork/task/:id/submit-completion`.
 *
 * Moves `completionStatus` to `submitted` and leaves `status` at `open` — the
 * two axes the live lifecycle probe confirmed run independently.
 */
export async function submitCompletion(input: {
  token: string;
  taskId: string;
  message: string;
  imageUrls?: string[];
  pdfAttachments?: unknown[];
}): Promise<LegacyResult<unknown>> {
  return legacyFetch({
    path: `/cowork/task/${encodeURIComponent(input.taskId)}/submit-completion`,
    method: "POST",
    body: {
      message: input.message,
      imageUrls: input.imageUrls ?? [],
      pdfAttachments: input.pdfAttachments ?? [],
    },
    token: input.token,
  });
}

/**
 * `POST /cowork/task/:id/review-completion` — the first review.
 *
 * Whether this finishes the task depends on `_reviewFlow`: under `tl_final` an
 * approval sets `status: "done"` and `completionStatus: "tl_final_approved"`,
 * while under `tl_then_ceo` it sets `tl_approved` and waits for the CEO. The
 * caller does not choose — the engine reads the root creator's role. That is
 * why there is no `completeTask` here: completion is the *outcome* of a
 * review, never its own instruction.
 */
export async function reviewCompletion(input: {
  token: string;
  taskId: string;
  approved: boolean;
  /**
   * Which acceptance criteria failed, as TEXT.
   *
   * Required by the engine whenever work is sent back and the task has any:
   * a reviewer describing the problem in prose left the assignee to guess
   * which criterion they had missed. Text rather than indices because a later
   * edit to the requirements array would silently re-point a historical rework
   * at a different criterion.
   */
  reworkRequirements?: string[];
  /** Optional extra context from the reviewer, stored with the rework. */
  reworkNote?: string;
  /** IDs of already-uploaded attachments. Never bytes. */
  reworkAttachmentIds?: string[];
  rejectionReason?: string;
}): Promise<LegacyResult<unknown>> {
  return legacyFetch({
    path: `/cowork/task/${encodeURIComponent(input.taskId)}/review-completion`,
    method: "POST",
    body: {
      approved: input.approved,
      rejectionReason: input.rejectionReason ?? "",
    },
    token: input.token,
  });
}

/**
 * `POST /cowork/task/:id/ceo-review` — the second review under `tl_then_ceo`.
 *
 * Guarded by `verifyCeoToken`, not `verifyEmployeeToken`. Anyone else gets a
 * permission error from the engine, which is the correct place for that
 * decision to be made.
 */
export async function ceoReviewCompletion(input: {
  token: string;
  taskId: string;
  approved: boolean;
  /**
   * Which acceptance criteria failed, as TEXT.
   *
   * Required by the engine whenever work is sent back and the task has any:
   * a reviewer describing the problem in prose left the assignee to guess
   * which criterion they had missed. Text rather than indices because a later
   * edit to the requirements array would silently re-point a historical rework
   * at a different criterion.
   */
  reworkRequirements?: string[];
  /** Optional extra context from the reviewer, stored with the rework. */
  reworkNote?: string;
  /** IDs of already-uploaded attachments. Never bytes. */
  reworkAttachmentIds?: string[];
  rejectionReason?: string;
}): Promise<LegacyResult<unknown>> {
  return legacyFetch({
    path: `/cowork/task/${encodeURIComponent(input.taskId)}/ceo-review`,
    method: "POST",
    body: {
      approved: input.approved,
      rejectionReason: input.rejectionReason ?? "",
    },
    token: input.token,
  });
}

/**
 * `POST /cowork/task/:id/department-approve` — a cross-department decision.
 *
 * The gate holds the task with **empty `assigneeIds`** and the target parked in
 * `pendingAssigneeId`. Approval by every side is what moves the assignee onto
 * the task, so until then no `array-contains` query can see it.
 */
/**
 * The engine's own words for the two outcomes.
 *
 * **Imperative, not past participle.** `taskForward.js:1023` reads
 * `req.body.decision` and refuses anything outside `["approve", "reject"]` with
 * *"decision must be 'approve' or 'reject'."* — which is exactly what every
 * click produced while this sent `{ approved: boolean }`. The field name was
 * wrong and so was the shape.
 *
 * Typed as a union rather than a string so the mismatch cannot come back: the
 * domain's own vocabulary is `approved`/`rejected` (a state something is IN),
 * and the wire's is `approve`/`reject` (an act being requested). They are one
 * letter apart and mean different things, which is precisely why the
 * translation gets one place and one place only — `decideApproval`.
 */
export type DepartmentDecision = "approve" | "reject";

export async function departmentApprove(input: {
  token: string;
  taskId: string;
  decision: DepartmentDecision;
  rejectionReason?: string;
}): Promise<LegacyResult<unknown>> {
  return legacyFetch({
    path: `/cowork/task/${encodeURIComponent(input.taskId)}/department-approve`,
    method: "POST",
    body: {
      decision: input.decision,
      rejectionReason: input.rejectionReason ?? "",
    },
    token: input.token,
  });
}

/** `DELETE /cowork/task/:id`. Recursive — subtasks go with it. */
export async function deleteTask(input: {
  token: string;
  taskId: string;
}): Promise<LegacyResult<unknown>> {
  return legacyFetch({
    path: `/cowork/task/${encodeURIComponent(input.taskId)}`,
    method: "DELETE",
    token: input.token,
  });
}

/** `POST /cowork/task/:id/reset-to-draft`. */
export async function resetTaskToDraft(input: {
  token: string;
  taskId: string;
}): Promise<LegacyResult<unknown>> {
  return legacyFetch({
    path: `/cowork/task/${encodeURIComponent(input.taskId)}/reset-to-draft`,
    method: "POST",
    token: input.token,
  });
}

/**
 * `POST /cowork/task/:id/propose-deadline`.
 *
 * **`proposedDate` is required** — the route 400s without it
 * (`taskForward.js:1658`). It also takes `windowSecs`, which is the working
 * budget rather than a date, so a UI that asks "how long do you need?" derives
 * the date from the duration and sends both. The engine does not compute one
 * from the other; sending only a duration is rejected.
 */
export async function proposeDeadline(input: {
  token: string;
  taskId: string;
  proposedDate: string;
  windowSecs: number;
  workedSecs?: number;
}): Promise<LegacyResult<unknown>> {
  return legacyFetch({
    path: `/cowork/task/${encodeURIComponent(input.taskId)}/propose-deadline`,
    method: "POST",
    body: {
      proposedDate: input.proposedDate,
      windowSecs: input.windowSecs,
      workedSecs: input.workedSecs ?? 0,
    },
    token: input.token,
  });
}

/**
 * `POST /cowork/task/:id/approve-sender-timer` — the assignee accepts the
 * window their assignor set at creation.
 *
 * This is legacy's own answer to "the manager already set a budget": when
 * `senderTimerWindowSecs > 0`, the receiver is shown the figure and accepts or
 * counters rather than proposing from scratch. Accepting sets
 * `deadlineWindowSecs = senderTimerWindowSecs` and moves the task to
 * `deadline_approved`.
 */
export async function acceptAssignorWindow(input: {
  token: string;
  taskId: string;
}): Promise<LegacyResult<unknown>> {
  return legacyFetch({
    path: `/cowork/task/${encodeURIComponent(input.taskId)}/approve-sender-timer`,
    method: "POST",
    token: input.token,
  });
}

/** `POST /cowork/task/:id/reject-sender-timer` — counter the assignor's window. */
export async function rejectAssignorWindow(input: {
  token: string;
  taskId: string;
  reason: string;
}): Promise<LegacyResult<unknown>> {
  return legacyFetch({
    path: `/cowork/task/${encodeURIComponent(input.taskId)}/reject-sender-timer`,
    method: "POST",
    body: { reason: input.reason, message: input.reason },
    token: input.token,
  });
}

/**
 * `POST /cowork/task/:id/approve-deadline` — the assignor decides on a
 * proposal.
 *
 * Guarded by `verifyEmployeeToken`, so the engine decides whether this caller
 * is entitled to approve. The client does not pre-judge it.
 */
export async function approveDeadline(input: {
  token: string;
  taskId: string;
  approved: boolean;
  rejectionReason?: string;
}): Promise<LegacyResult<unknown>> {
  return legacyFetch({
    path: `/cowork/task/${encodeURIComponent(input.taskId)}/approve-deadline`,
    method: "POST",
    body: {
      approved: input.approved,
      rejectionReason: input.rejectionReason ?? "",
    },
    token: input.token,
  });
}

/**
 * `POST /cowork/task/:id/tl-counter-deadline` — the assignor counters.
 *
 * `counterDate` is required and the engine 400s without it (`taskForward.js`
 * :1850). `counterWindowSecs` is sent alongside, because a counter on a budget
 * task is a duration and not only a date — the route's own comment calls it
 * "typed duration in seconds (for extension-aware accounting)", and omitting it
 * leaves the engine to infer a window it has no basis for.
 */
export async function counterDeadline(input: {
  token: string;
  taskId: string;
  counterDate: string;
  counterWindowSecs?: number;
  message?: string;
}): Promise<LegacyResult<unknown>> {
  return legacyFetch({
    path: `/cowork/task/${encodeURIComponent(input.taskId)}/tl-counter-deadline`,
    method: "POST",
    body: {
      counterDate: input.counterDate,
      counterWindowSecs: input.counterWindowSecs,
      message: input.message ?? "",
    },
    token: input.token,
  });
}

/**
 * `POST /cowork/task/:id/respond-tl-counter` — the assignee answers a counter.
 *
 * `accepted` must be a real boolean: the route tests `typeof accepted !==
 * "boolean"` and 400s, so a truthy string is refused rather than coerced.
 */
export async function respondToCounter(input: {
  token: string;
  taskId: string;
  accepted: boolean;
  rejectMessage?: string;
}): Promise<LegacyResult<unknown>> {
  return legacyFetch({
    path: `/cowork/task/${encodeURIComponent(input.taskId)}/respond-tl-counter`,
    method: "POST",
    body: {
      accepted: input.accepted,
      rejectMessage: input.rejectMessage ?? "",
    },
    token: input.token,
  });
}



/**
 * `POST /cowork/task/:id/subtask` — break work out of a task.
 *
 * Legacy's own delegation route, and the one that replaced Forward when
 * forwarding was removed. The engine owns parent linkage and the approval gates
 * a subtask inherits, so nothing is computed here.
 */
export async function createSubtask(input: {
  token: string;
  taskId: string;
  title: string;
  assigneeIds: string[];
  description?: string;
  dueDate?: string;
  windowSecs?: number;
}): Promise<LegacyResult<unknown>> {
  return legacyFetch({
    path: `/cowork/task/${encodeURIComponent(input.taskId)}/subtask`,
    method: "POST",
    body: {
      title: input.title,
      assigneeIds: input.assigneeIds,
      description: input.description ?? "",
      dueDate: input.dueDate,
      windowSecs: input.windowSecs,
    },
    token: input.token,
  });
}

/**
 * `POST /cowork/task/:id/chat` — a message on the task thread.
 *
 * The engine fans out the notification, which is why this is a write rather
 * than a Firestore append: a message written straight to the document would
 * reach the thread and nobody's bell.
 */
export async function sendTaskChat(input: {
  token: string;
  taskId: string;
  message: string;
}): Promise<LegacyResult<unknown>> {
  return legacyFetch({
    path: `/cowork/task/${encodeURIComponent(input.taskId)}/chat`,
    method: "POST",
    body: { message: input.message },
    token: input.token,
  });
}

/**
 * `POST /cowork/task/:id/department-tl-set-hours` — the receiving department's
 * lead states the effort.
 *
 * Legacy gave this its own route rather than folding it into the generic
 * approval, because it is a number being supplied and not a yes/no — and
 * supplying it converts the task from a fixed deadline to a budget.
 */
export async function setDepartmentHours(input: {
  token: string;
  taskId: string;
  windowSecs: number;
}): Promise<LegacyResult<unknown>> {
  /*
   * **`hoursValue` and `hoursUnit`, which is what the route destructures.**
   *
   * This sent `{ windowSecs, hours }`. The handler reads
   * `const { hoursValue, hoursUnit } = req.body` and then
   * `Number(hoursValue) || 0`, so every submission arrived as 0 and was
   * refused with "Enter a valid number of hours." — a validation message about
   * a field the form never sent.
   *
   * Sent in HOURS. The route multiplies by the unit — `val * (unit ===
   * "minutes" ? 60 : unit === "days" ? 86400 : 3600)` — and there is no
   * "seconds" case: anything unrecognised falls through to the hours
   * multiplier, so passing seconds under a made-up unit name would have
   * multiplied the budget by 3600.
   */
  return legacyFetch({
    path: `/cowork/task/${encodeURIComponent(input.taskId)}/department-tl-set-hours`,
    method: "POST",
    body: { hoursValue: input.windowSecs / 3600, hoursUnit: "hours" },
    token: input.token,
  });
}

/**
 * `PATCH /cowork/task/:id/deadline` — change a task's due date directly.
 *
 * **This is the mutation the due date never had.** `updateTask` carries
 * `title`, `description` and `requirements` and nothing else, and the
 * repository interface had no deadline setter at all, so a changed due date
 * reached no endpoint: the form appeared to save and the document never moved.
 *
 * Distinct from the negotiation flow on purpose, and not a duplicate of it.
 * `proposeDeadline` → `approveDeadline` is a request somebody else decides;
 * this is the assignor changing the date outright, and legacy gives it its own
 * route and its own guard.
 *
 * Two parts of the contract bite:
 *
 * · **`reason` is mandatory.** The route returns 400 on a missing or blank one
 *   (`taskForward.js:1365`) — before touching the document — because the reason
 *   is what lands in `deadlineHistory`, and a deadline that moved for no
 *   recorded reason is exactly what the history exists to prevent.
 * · **CEO only.** `verifyCeoToken`, not `verifyEmployeeToken`. A team lead
 *   editing a date gets 403 from the engine, and that refusal is surfaced
 *   rather than pre-judged here.
 *
 * `newDueDate: null` clears the date, which the engine accepts — it writes
 * `dueDate: null` and recomputes `deadlineStatus`. Passing `undefined` would
 * drop the key and leave the old date in place, so the null is deliberate.
 */
export async function editTaskDeadline(input: {
  token: string;
  taskId: string;
  newDueDate: string | null;
  reason: string;
}): Promise<LegacyResult<unknown>> {
  return legacyFetch({
    path: `/cowork/task/${encodeURIComponent(input.taskId)}/deadline`,
    method: "PATCH",
    body: { newDueDate: input.newDueDate, reason: input.reason },
    token: input.token,
  });
}

/**
 * `POST /cowork/task/:id/rework` — send submitted work back.
 *
 * **A third outcome, not a rejection.** `ReviewDecision` has three values and
 * the engine has three behaviours: approve completes the stage, reject closes
 * the submission against the assignee, and rework returns the task to
 * `in_progress` with the reason recorded and `reworksReceived` incremented —
 * which is what the C1 rework deduction is counted from. Routing it through
 * `review-completion` as a rejection would score somebody for a rejection they
 * did not receive and would not return the task to them to fix.
 *
 * `waiveDeduction` is the reviewer forgiving the score impact. The engine reads
 * it as a real boolean or the string `"true"`; sent as a boolean here.
 *
 * **Role-gated at the engine** — an `employee` role is refused 403. Legacy's
 * own check, and one of the few it actually performs on a review action.
 */
export async function reworkTask(input: {
  token: string;
  taskId: string;
  reworkReason: string;
  waiveDeduction?: boolean;
  /** The acceptance criteria that failed. The engine refuses an empty list. */
  reworkRequirements?: string[];
  /** Optional extra context from the reviewer, stored with the rework. */
  reworkNote?: string;
  /** IDs of already-uploaded attachments. Never bytes. */
  reworkAttachmentIds?: string[];
}): Promise<LegacyResult<unknown>> {
  return legacyFetch({
    path: `/cowork/task/${encodeURIComponent(input.taskId)}/rework`,
    method: "POST",
    body: {
      reworkReason: input.reworkReason,
      waiveDeduction: input.waiveDeduction === true,
      reworkRequirements: input.reworkRequirements ?? [],
      reworkNote: input.reworkNote ?? "",
      reworkAttachmentIds: input.reworkAttachmentIds ?? [],
    },
    token: input.token,
  });
}

/**
 * `POST /cowork/task/:id/budget/counter` — put a different figure forward.
 *
 * Available to whichever side the negotiation is waiting on, which is what
 * makes it a loop rather than a one-way request. There is deliberately no
 * reject: disagreeing means countering.
 */
export async function counterBudget(input: {
  token: string;
  taskId: string;
  proposedSecs: number;
  reason?: string;
}): Promise<LegacyResult<unknown>> {
  return legacyFetch({
    path: `/cowork/task/${encodeURIComponent(input.taskId)}/budget/counter`,
    method: "POST",
    body: { proposedSecs: input.proposedSecs, reason: input.reason ?? "" },
    token: input.token,
  });
}

/**
 * `POST /cowork/task/:id/decline-assignment` — the assignee refuses the work.
 *
 * The counterpart to `/confirm`, added to the engine because it did not exist:
 * the only refusal available was `reject-sender-timer`, which sends the proposed
 * TIME back and leaves the task where it is. This hands the work back — the
 * engine writes `status: "rejected"`, which every existing reader already maps.
 *
 * A reason is REQUIRED and the route refuses without one. Refusing work silently
 * leaves the assignor with a stalled task and no way to find out why.
 */
export async function declineAssignment(input: {
  token: string;
  taskId: string;
  reason: string;
}): Promise<LegacyResult<unknown>> {
  return legacyFetch({
    path: `/cowork/task/${encodeURIComponent(input.taskId)}/decline-assignment`,
    method: "POST",
    body: { reason: input.reason },
    token: input.token,
  });
}

/**
 * `POST /cowork/task/:id/set-budget` — change the budget of a RUNNING task.
 *
 * **Not `department-tl-set-hours`.** That route opens with
 * `if (task.status !== "pending_tl_hours") return 400`, because its job is to
 * activate work waiting at the gate — so every attempt to apply an approved
 * extension to a live task failed, and the record stayed `pending` with no sign
 * of why.
 *
 * **Sent in HOURS, not seconds.** The route multiplies by the unit
 * (`minutes` → 60, `days` → 86400, anything else → 3600), so passing seconds
 * under a made-up unit name would multiply the budget by 3600. Same contract as
 * its sibling, and the same trap.
 */
export async function setActiveTaskBudget(input: {
  token: string;
  taskId: string;
  /** The new TOTAL budget, in seconds. Converted to hours for the wire. */
  secs: number;
}): Promise<LegacyResult<unknown>> {
  return legacyFetch({
    path: `/cowork/task/${encodeURIComponent(input.taskId)}/set-budget`,
    method: "POST",
    body: { hoursValue: input.secs / 3600, hoursUnit: "hours" },
    token: input.token,
  });
}

/**
 * `POST /cowork/employee/:id/priority-order` — persist a queue, atomically.
 *
 * Priority had no route at all: both frontends wrote `assigneePriorities.{id}`
 * straight to Firestore, which is why two tabs could leave duplicate ranks — a
 * browser cannot run a query inside a transaction and so cannot read a queue and
 * renumber it as one operation.
 *
 * **The ORDER is decided here and persisted there.** The route writes 1..N over
 * whatever list it is given; it does not sort. `calculatePriorityOrder` remains
 * the only place that decides sequence.
 */
export async function setPriorityOrder(input: {
  token: string;
  employeeId: string;
  orderedTaskIds: string[];
}): Promise<LegacyResult<unknown>> {
  return legacyFetch({
    path: `/cowork/employee/${encodeURIComponent(input.employeeId)}/priority-order`,
    method: "POST",
    body: { orderedTaskIds: input.orderedTaskIds },
    token: input.token,
  });
}

/**
 * `POST /cowork/task/:id/request-deadline-extension` — ask for a later date.
 *
 * **This route already existed and was not being used.** The extension record
 * was written straight to `cowork_task_deadline_extensions` instead, so the
 * engine never saw the request: no notification, no status change, and none of
 * the rollback bookkeeping `proposeDeadline` does.
 */
export async function requestDeadlineExtension(input: {
  token: string;
  taskId: string;
  proposedDate: string;
  reason?: string;
  previousWindowSecs?: number;
  addedSecs?: number;
  /**
   * The TOTAL after the addition, sent alongside the two parts.
   *
   * All three go on the wire because the engine records the breakdown — "30 + 20
   * + 10" survives many extensions only if each request says what it added AND
   * what it added to. `extensionFromAddition` owns the sum; nothing here adds
   * the two numbers itself.
   */
  proposedWindowSecs?: number;
}): Promise<LegacyResult<unknown>> {
  return legacyFetch({
    path: `/cowork/task/${encodeURIComponent(input.taskId)}/request-deadline-extension`,
    method: "POST",
    body: {
      proposedDate: input.proposedDate,
      reason: input.reason ?? "",
      previousWindowSecs: input.previousWindowSecs ?? 0,
      addedSecs: input.addedSecs ?? 0,
      proposedWindowSecs: input.proposedWindowSecs ?? 0,
    },
    token: input.token,
  });
}

/**
 * `POST /cowork/task/:id/review-deadline-extension` — the assignor answers.
 *
 * Three actions, matching the three the record already models:
 * `approve` · `reject` · `counter` (which carries `newDate`).
 */
export async function reviewDeadlineExtension(input: {
  token: string;
  taskId: string;
  action: "approve" | "reject" | "counter";
  newDate?: string;
}): Promise<LegacyResult<unknown>> {
  return legacyFetch({
    path: `/cowork/task/${encodeURIComponent(input.taskId)}/review-deadline-extension`,
    method: "POST",
    body: {
      action: input.action,
      ...(input.newDate ? { newDate: input.newDate } : {}),
    },
    token: input.token,
  });
}

/** `POST /cowork/task/:id/budget/accept` — agree to what stands. */
export async function acceptBudget(input: {
  token: string;
  taskId: string;
}): Promise<LegacyResult<unknown>> {
  return legacyFetch({
    path: `/cowork/task/${encodeURIComponent(input.taskId)}/budget/accept`,
    method: "POST",
    body: {},
    token: input.token,
  });
}
