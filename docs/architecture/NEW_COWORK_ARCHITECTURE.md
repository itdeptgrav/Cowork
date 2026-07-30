# New Cowork Architecture

**Date:** 2026-07-25
**Status:** Proposal for review. No code written. Nothing here is implemented.
**Binding inputs:** [MIGRATION_DECISIONS.md](MIGRATION_DECISIONS.md) D1–D32 · `PRODUCT.md` · `DESIGN.md` and the Impeccable system (visual authority)

---

## 1. Recommended Datastore

**Recommendation: PostgreSQL as the single authoritative store.**

Decision D20 settles that there is one store; this is the recommendation for which. **OWNER DECISION REQUIRED (O21).**

| Requirement | Why Postgres |
|---|---|
| Immutable ledger with transactional appends | ACID; a task approval and its ledger entry commit together or not at all. Legacy's dual-store write has no such guarantee |
| Range queries by `(employeeId, component, periodKey)` | Composite indexes; Firestore's constraints forced legacy to post-filter in the route (`taskForward.js:1328`) |
| Reproducible history | `configSnapshot JSONB` + `ruleVersion` per entry |
| Referential integrity | Legacy's `update-id` orphaned every reference because nothing enforced it |
| Recursive task hierarchy | Recursive CTEs; legacy walks `subtaskIds[]` with N round-trips and no cycle guard |
| Reporting-closure queries | Recursive CTE, materialised and cached |
| Cycle detection on reporting lines | Enforceable at write |

**Where Firestore genuinely fits:** live message streams and typing indicators. Those may stay if the team wants them, but **no scoring-relevant data lives there**, and the client never writes anything that feeds a score. That is the whole of decision D19.

**Migration note.** The legacy join key is `employeeId ≡ Employee.biometricId`, exposed as a **non-queryable Mongoose virtual** (`models/Employee.js:457`). Import must key on `biometricId` explicitly; querying `{employeeId}` silently returns null and has already caused one production outage of the timer engine (`timerSop.service.js:14-18`).

---

## 2. Authentication Architecture

```
Browser ──► Next.js server (session cookie, httpOnly, SameSite=Lax)
              │
              ├─ Server Components read the session directly
              ├─ Route Handlers verify before every mutation
              └─ Socket handshake verifies the same session
```

| Requirement | Fixes |
|---|---|
| Server-side verification on **every** state-changing request | Legacy client-writes priority, timers, commits, acknowledgements |
| Session in an httpOnly cookie, not a bearer token in JS | Legacy passes Firebase ID tokens from client memory |
| First administrator provisioned out-of-band (CLI, seed, signed invite) | Legacy's unauthenticated `POST /setup/seed-ceo` |
| No plaintext passwords, including temporary | Legacy stores `tempPassword` in Firestore |
| Password reset issues a single-use expiring token | |
| Role resolved from **one** store | Legacy dual-writes claims and Firestore doc non-atomically |
| No email-fallback identity resolution | Legacy falls back to email on both client and server |
| Session revocation on role change, deactivation, password reset | Legacy already does this — preserve |
| Cache TTL ≤ 60 s with explicit invalidation, or none | Legacy's 5-minute cache delays privilege revocation |

**Identity provider:** keeping Firebase Auth is defensible if the migration cost matters more than consolidation. If the datastore moves to Postgres, the coupling that made Firebase Auth natural is gone. **OWNER DECISION REQUIRED (O22).**

---

## 3. Role and Permission Architecture

Permission = **capability × scope**, evaluated as `(capability, actor, target) → allow | deny`. Roles are seed data, never string literals in code (D27).

```ts
type Capability =
  | "task.view" | "task.create" | "task.edit" | "task.cancel" | "task.delete"
  | "task.priority.change" | "task.forward"
  | "deadline.propose" | "deadline.decide" | "deadline.extend" | "deadline.extension.decide"
  | "submission.create" | "review.decide" | "review.rework" | "review.second_stage"
  | "score.view" | "score.compare" | "score.configure" | "score.adjust"
  | "conduct.apply" | "conduct.review_dispute"
  | "people.view" | "people.create" | "people.deactivate" | "people.delete"
  | "people.reset_password" | "people.change_role" | "people.change_reporting"
  | "group.manage" | "meeting.manage" | "integration.configure" | "notification.broadcast";

type Scope = "self" | "direct_reports" | "hierarchy" | "organisation";
```

**Four invariants, enforced centrally:**

1. **Hierarchy containment (D10).** Any capability with scope `direct_reports` or `hierarchy` resolves through the reporting closure. A manager cannot see, act on, or score anyone outside it. Legacy's "any TL sees everyone" does not carry forward.
2. **Administrative floor.** No non-administrator capability may target a user of equal or higher administrative level. This makes the legacy defect — a TL resetting the CEO's password — structurally impossible, not merely unlikely.
3. **Self-exclusion.** `review.decide` and `score.adjust` can never target the actor. Legacy's `review-completion` lets anyone approve their own work.
4. **Comparison flows down only** (`PRODUCT.md:69`). `score.compare` has no upward or lateral form.

Full matrix in [PERMISSIONS_AND_ROLES_SPEC.md](PERMISSIONS_AND_ROLES_SPEC.md) §4.3.

---

## 4. Reporting Hierarchy

Time-bounded relationships (D28):

```ts
interface ReportingRelationship {
  id: string;
  employeeId: string;
  managerId: string;
  type: "primary" | "secondary" | "dotted";
  effectiveFrom: string;          // ISO date
  effectiveTo: string | null;     // null = current
  createdBy: string;
  createdAt: string;
}
```

**Why time-bounded, concretely:** a 2026-Q2 score must be visible to whoever managed that person *in Q2*. Legacy stores a single current `primaryManager` on the employee document, so re-orgs silently rewrite who could see what, retroactively.

- Closure resolved server-side via recursive CTE, cached, invalidated on change
- **Cycle detection on write** — legacy has none
- Orphans (no manager) visible to People Operations and administrators only
- **Score visibility follows the primary line only** unless explicitly configured — secondary and dotted lines grant task visibility, not score visibility (**OWNER DECISION REQUIRED, O29**)
- Approval-gate resolution queries this model instead of matching department strings, replacing `resolveDepartmentApprover` (`taskForward.js:86`)

---

## 5. Cowork-Only Backend Boundaries

**In scope:** identity, people, reporting, tasks, priority, deadlines, submissions, reviews, forwarding, timers, work commits, daily reports, chat, groups, messaging, meetings, notifications, goals, conduct, attendance ingestion, scoring, ledger, files.

**Out of scope (D17, D18):** accounting, inventory, manufacturing, QC, dispatch, sales/CRM, payroll, vendor and customer portals, barcode hardware, Tally/Setu/GSTIN, MRF, Office Monitor.

**Two boundaries the legacy code crosses and the new system must not:**

| Legacy crossing | New treatment |
|---|---|
| `GET /cowork/employee/biometric-ids` reads the HR MongoDB employee master directly | People data is Cowork's own, seeded once; HR remains a source system behind an import boundary |
| `GET /cowork/scheduling/blocked-dates` queries `CompanyHoliday` and `LeaveApplication` in the ERP | A `WorkCalendar` port; the ERP is one possible adapter |

---

## 6. Versioned API Structure

Legacy exposes a bare `/cowork` prefix with no version and three files fighting over the same paths. New (D30):

```
/api/v1/auth/*                    session, password
/api/v1/me                        identity, permissions, ambient score
/api/v1/people/*                  directory, profile, reporting
/api/v1/roles/*                   role and permission administration
/api/v1/tasks                     list, create
/api/v1/tasks/:id                 get, patch, soft-delete
/api/v1/tasks/:id/assignments     assignees
/api/v1/tasks/:id/priority        change (audited)
/api/v1/tasks/:id/deadline/*      proposals, counters, decisions, extensions
/api/v1/tasks/:id/approvals/*     gate decisions
/api/v1/tasks/:id/confirm|start|cancel
/api/v1/tasks/:id/submissions     create, list
/api/v1/tasks/:id/reviews         approve | rework | reject | second-stage
/api/v1/tasks/:id/forward         + /forward-budget
/api/v1/tasks/:id/events          immutable task history
/api/v1/tasks/:id/chat|draft-chat|reports|attachments
/api/v1/timers/*                  start, pause, commits  (server-mediated, D24)
/api/v1/goals/*                   goals, activities, reports
/api/v1/conduct/*                 events, disputes
/api/v1/attendance/*              days, events
/api/v1/score/me                  ambient
/api/v1/score/:employeeId         scoped
/api/v1/score/:employeeId/ledger  traceability
/api/v1/score/rules/*             versioned configuration
/api/v1/notifications/*           list, read (per-item and bulk)
/api/v1/groups/*  /messages/*  /meetings/*
```

Conventions: cursor pagination; `Idempotency-Key` on every mutation; `ETag`/`If-Match` on task updates; RFC 7807 problem responses; no debug or repair endpoint ever ships (D21).

---

## 7. Task State Machine

One `status` axis. Legacy's parallel `completionStatus` becomes a typed `submission` sub-object. Five near-identical `pending_*` statuses collapse into one with a typed reason. Full rationale in [TASK_LOGIC_SPEC.md](TASK_LOGIC_SPEC.md) §10.

```
draft → pending_approval → assigned ⇄ deadline_negotiation
                                ↓ confirm
                            confirmed
                                ↓ start
                            in_progress ⇄ in_review
                                ↓ final approval
                            completed ●

pending_approval --reject--> assignment_rejected ●
cancelled ● reachable from every non-terminal state
```

```ts
type TaskStatus =
  | "draft" | "pending_approval" | "assigned" | "deadline_negotiation"
  | "confirmed" | "in_progress" | "in_review"
  | "completed" | "cancelled" | "assignment_rejected";

type ApprovalReason =
  | "tl_assignment" | "cross_department" | "ceo_assignment"
  | "effort_estimate" | "self_assignment" | "recurrence";
```

Mapping from legacy: `open`→`assigned` · `pending_tl_approval`/`pending_department_approval`/`pending_tl_hours`/`repeat_pending_confirmation`→`pending_approval` + reason · `pending_deadline_approval`→`deadline_negotiation` · `deadline_approved`→`assigned` + deadline sub-state · `confirmed`→`confirmed` · `in_progress`→`in_progress` · `done`→`completed` · `rejected`→`assignment_rejected` · `repeat_active`→`in_progress` + recurrence flag. Dropped as never-assigned: `pending`, `submitted`, `approved`, `pending_tl_review`, `pending_ceo_review`, `not_started`.

---

## 8. Priority Model

Legacy priority is a numeric rank, auto-assigned as `openTaskCount + 1`, written to three fields (`priority`, `assigneePriorities{}`, `order`) **client-side with no permission check or audit**.

```ts
interface TaskAssignment {
  taskId: string;
  employeeId: string;
  rank: number;                   // 1 = highest, per employee
  confirmedAt: string | null;
  startedAt: string | null;
}
```

| Change | Reason |
|---|---|
| **One field** — `rank` on the assignment, not three on the task | Legacy's `priority` / `assigneePriorities` / `order` express one concept three ways |
| **Rank is per (task, employee)** — no shared task-level priority | Priority is already per-person in practice |
| **Server-mediated and audited** (D23) | Fixes the client-write hole |
| **One reorder semantic** | Legacy's drag renumbers contiguously; `PrioritySwapPanel` preserves the number set. **OWNER DECISION REQUIRED (O11)** |
| Reorder is **transactional** over the affected set | Legacy writes a client batch then races a 500 ms timer |
| Reason **mandatory** on manual reorder | Legacy requires it in drag, not in the direct setter |
| Every change emits a `TaskEvent` and a `PriorityChange` record | Legacy has no priority audit at all |

**The cascade** (preserved, `service:2123` re-specified): promoting a task recomputes downstream deadlines for that employee's lower-ranked tasks, crediting work already done, never moving a deadline earlier, deduplicating repeat fires, and requiring acknowledgement. Changes: it runs **synchronously inside the reorder transaction** rather than 500 ms later, and it notifies **the affected employee** as well as the manager (legacy notifies only `assignedBy`).

**Acknowledgement** stays a blocking, non-dismissable receipt (`PriorityChangeAckModal` behaviour) but becomes a server-recorded `PriorityAcknowledgement` rather than a client-written boolean inside a history array.

---

## 9. Deadline Negotiation Model

Preserved in full (D8) — it is the most sophisticated workflow in the product. Restructured from ~25 fields scattered across the task document into one sub-aggregate:

```ts
interface TaskDeadline {
  mode: "timer" | "fixed";
  originalWindowSecs: number | null;
  currentWindowSecs: number | null;
  dueAt: string | null;
  officialDueAt: string | null;      // the ONLY field scoring reads
  state: "unset" | "proposed" | "countered" | "agreed" | "extension_pending";
  proposals: DeadlineProposal[];
  extensions: DeadlineExtension[];
}
```

| Preserved | Changed |
|---|---|
| Creator sets fixed deadline, timer window, or nothing | `dueDate` is no longer forced to `null` at creation — a fixed deadline is stored as one |
| Employee proposes; creator approves, rejects, or counters; employee responds | **One** extension mechanism, not two. Legacy has `propose-deadline` (creator approves) and `request-deadline-extension` (any manager approves), writing different fields |
| Extensions are **additive** with an auditable chain | Preserved exactly — `30m + 20m + 10m = 60m` |
| Penalty-waiver decision at approval | Preserved. Whether the 50%/70% zone model is a real rule: **OWNER DECISION REQUIRED (O14)** |
| `officialDueAt` separate from displayed deadline | Preserved — this separation is correct and load-bearing |
| Office-hours-aware duration walking, skipping off-days and breaks | Preserved; **timezone becomes configuration** (D31), and the `+6h "BRANDED PROBE"` fallback is deleted |
| Blocked dates from holidays and approved leave | Promoted from advisory to **enforced** at proposal time |
| — | Proposals **expire** with escalation. Legacy waits indefinitely (**OWNER DECISION REQUIRED, O15**) |
| — | `timer_blocked` becomes server-enforced, not an advisory socket event |
| — | Extension approval computes the new deadline immediately. Legacy leaves `dueAt` deliberately stale until the employee presses Start, so a task never restarted keeps a wrong deadline forever |

---

## 10. Submission and Review Model

Submissions become first-class records rather than a single overwritable object.

```ts
interface TaskSubmission {
  id: string; taskId: string; attempt: number;
  submittedBy: string; submittedAt: string;
  message: string; attachmentIds: string[];
  supersededBy: string | null;
}
```

| Legacy | New |
|---|---|
| `completionSubmission` is one object; re-submitting overwrites it silently | Append-only attempts with `supersededBy` |
| No check on `status` — an `assigned` task can be submitted without ever being confirmed or started | Submission requires `in_progress` |
| Completion message optional | **OWNER DECISION REQUIRED (T17)** |
| `reviewFlow` recomputed then cached on the task | Resolved from the reporting chain at submission and stored on the submission |
| **Anyone can review** | `review.decide`, scoped to the assignee's management chain, never self |
| Timer not stopped on submit | Timer stops server-side |

**Review stages** replace `_reviewFlow`'s role-derived `tl_final` / `ceo_direct` / `tl_then_ceo` with hierarchy-derived stages, so the chain does not break when a role is renamed (D27):

```ts
interface TaskReview {
  id: string; submissionId: string; stage: number; isFinalStage: boolean;
  reviewerId: string; decision: "approved" | "rework" | "rejected";
  reason: string | null; reviewedAt: string;
}
```

---

## 11. Rework and Rejection Model

Legacy conflates and mishandles these. The new model separates them cleanly.

| | **Rework** | **Rejection** |
|---|---|---|
| Meaning | Work is on the right track; revise and resubmit | Work is not acceptable as an attempt |
| Task state | → `in_progress` | → `in_progress` |
| Submission | preserved, superseded on resubmit | preserved, superseded on resubmit |
| Deadline | leftover time re-granted from the next working moment *(preserved from legacy)* | **same treatment** — legacy re-grants on TL rejection but **not** on CEO rejection |
| Reason | **required** *(legacy defaults to `""`)* | required *(legacy already requires it)* |
| Score | **−0.2 per occurrence** — owner-confirmed, matches legacy | **OWNER DECISION REQUIRED (O4)** — legacy zeroes the unit; explicitly not approved |
| Score event | one ledger entry per rework | one ledger entry, reversed if later approved |
| Repeatable | yes | yes |
| Waiver | **OWNER DECISION REQUIRED (O18)** — legacy allows silent, unaudited waiving | — |

**Two legacy defects fixed here:**
1. Re-approval after rejection currently writes a *second* ledger entry without reversing the first, so ledger and score diverge permanently. The new model writes a reversal.
2. CEO rejection fires no score event and re-grants no time, while TL rejection does both. Symmetric treatment.

---

## 12. Task Event History

Legacy scatters history across `reworkHistory[]`, `deadlineHistory[]`, `deadlineAutoExtendedHistory[]`, `extensions[]`, `vendorUpdates[]`, `goalUpdates[]`, `departmentApprovals[]`, and system chat messages. Seven shapes, none queryable, some client-written.

```ts
interface TaskEvent {
  id: string; taskId: string; sequence: number;
  type: TaskEventType; actorId: string | "system"; actorRole: string;
  payload: Record<string, unknown>;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  occurredAt: string;
}
```

One append-only stream per task. Every state transition, priority change, deadline move, approval, submission, review, forward, assignment change and cancellation emits one. The activity feed renders it; the ledger references it; audit answers from it.

---

## 13. Universal Scoring System

Implements [SCORING_LOGIC_SPEC.md](SCORING_LOGIC_SPEC.md) §5 (D13).

```
earnedPoints = clamp(maximumPoints − Σdeductions + Σcredits, 0, maximumPoints)

componentPercentage = Σ earned ÷ Σ possible × 100     // points over points
overallPercentage   = Σ earned ÷ Σ possible × 100     // NEVER average percentages
```

```
ScoringRule ──has many──► ScoringRuleVersion (immutable, effective-dated)
                                  │
ScoreUnit (max 1.0) ──────────────┼──► ScoreEvent ──► ScoreLedgerEntry (immutable)
                                  │
                          ScoreSnapshot (derived cache, rebuildable)
```

**Pipeline:** domain event → rule engine resolves the active `ScoringRuleVersion` for the event's `effectiveDate` → computes deduction/credit → appends a ledger entry inside the same transaction → invalidates the snapshot.

| Legacy defect | Fixed by |
|---|---|
| Composite averages percentages | Points over points |
| No floor or cap | `clamp(…, 0, max)` |
| Weights unweighted despite `PRODUCT.md:61` | Explicit weights, once O2 is answered |
| Two conflicting config sources with different defaults | One versioned rule set |
| Extension deduction multiplied by zero | Rule engine has no special cases |
| `c1MaxPoints` computed then discarded | Maximum stored per unit |
| Cache refresh gated on `etcHours > 0` | Snapshots rebuild from the ledger |
| Cancellation designed but unreachable | First-class cancellation, ledger-recorded |
| Preview diverges from committed score | Same code path, dry-run flag |
| Attendance denominator from ledger entries | Expected-working-day calendar |
| Flat lateness penalty | Proportional (owner-confirmed) |
| History rewritten by config changes | `ruleVersion` + `configSnapshot` per entry |
| Score attributed to `assigneeIds[0]` only | Per-assignment units (**O9**) |

---

## 14. Immutable Score Ledger

Full field list in [SCORING_LOGIC_SPEC.md](SCORING_LOGIC_SPEC.md) §7.

**Invariants:**
1. Append-only. No update, no delete.
2. `pointsAfter === clamp(pointsBefore − deduction + credit, 0, maximumPoints)` — verifiable per row.
3. `effectiveDate` decides the period; `createdAt` never does.
4. `ruleVersion` + `configSnapshot` make every historical score reproducible.
5. Disputes resolve by **reversal**, never by mutation.
6. Task deletion never deletes ledger entries — it writes a reversal.
7. `ScoreSnapshot` is derived and must be rebuildable from the ledger alone.

Storage: one table, `(employeeId, component, periodKey, effectiveDate)` indexed, partitioned by period. Not nested inside the employee record as legacy's `sopPoints` array is — that shape causes unbounded growth and read-modify-write races via `employee.save()`.

---

## 15. Notification Architecture

**One pipeline.** Legacy has two (`_notify` at the route layer, `_notifyMany` at the service layer) that treat the same event class differently — `_notify` never sends email.

```
Domain event ──► NotificationRouter
                    ├─ recipient resolution (hierarchy-aware)
                    ├─ preference filter (per user, per type, per channel)
                    ├─ dedup + coalescing window
                    └─ fan-out ──► in-app  (always, the durable record)
                                   socket  (if connected)
                                   push    (FCM, if enabled)
                                   email   (if enabled + cooldown)
```

| Legacy gap | Fix |
|---|---|
| No per-notification read; only read-all | Per-item and bulk |
| P1 cascade notifies the manager, not the affected employee | Both |
| No notification on priority change at all | Emitted |
| Sender-timer approve/reject are FCM-only | In-app record always |
| Goal events are email-only | In-app record always |
| No user preferences | Per-type, per-channel |
| No dedup | Coalescing window |
| Fire-and-forget with no failure handling | Retry with backoff; dead-letter |

---

## 16. Realtime Architecture

One Socket.IO namespace for Cowork (legacy registers two `io.on("connection")` handlers on the same server).

| Requirement | Fixes |
|---|---|
| Handshake authenticated against the session | Legacy accepts unauthenticated call and recording payloads |
| Room membership derived from the **verified** identity | Legacy's `join_cowork` trusts a client-supplied `employeeId` |
| Server authoritative; realtime is a delivery channel, never a source of truth | Legacy's `timer_blocked` is advisory only |
| Rooms: `user:{id}`, `task:{id}`, `group:{id}`, `conversation:{id}`, `meeting:{id}` | |
| Reconnect replays missed events from the task-event sequence | Legacy loses events on disconnect |

---

## 17. File and Attachment Architecture

```ts
interface Attachment {
  id: string; ownerId: string;
  scope: { type: "task" | "submission" | "message" | "report" | "goal_activity"; id: string };
  filename: string; mimeType: string; sizeBytes: number;
  storageKey: string; provider: "cloudinary" | "drive";
  scanStatus: "pending" | "clean" | "infected";
  uploadedAt: string; deletedAt: string | null;
}
```

- **Server-issued signed upload credentials.** No secret in the browser — legacy exposes `CLOUDINARY_API_SECRET` in the frontend repo
- One entity replaces `imageUrls[]`, `pdfAttachments[]`, `files[]`, `attachments[]`, `vendorUpdates[].files[]`
- Lifecycle tied to the parent: soft-delete cascades, hard-delete is a retention job. Legacy's task deletion orphans every file
- Access checked per request against the scope's permission

---

## 18. Integration Boundaries

Ports and adapters (D29). No domain module imports a vendor SDK. Full table in [INTEGRATIONS_SPEC.md](INTEGRATIONS_SPEC.md) §11.

```
IdentityProvider · Repository · NotificationChannel · MediaStore
RealtimeGateway  · MeetingProvider · AttendanceSource · CalendarProvider
WorkCalendar     · SummaryProvider (optional)
```

**The concrete payoff:** legacy's C4 engine reads `DailyAttendance` documents whose shape is dictated by the eTimeOffice API. Changing provider means rewriting the scoring engine. With an `AttendanceSource` port emitting normalised `AttendanceEvent`s, it means writing one adapter.

---

## 19. Frontend Route Structure

Desktop-first, all-day expert use (`PRODUCT.md:34`, `:114`). The score is ambient, not a destination (D12).

```
/(auth)/login
/(app)
  ├── /                          home — both lenses
  ├── /tasks                     list, filters, saved views
  │     └── /[taskId]            detail: overview · activity · chat · submissions · score
  ├── /goals  /goals/[goalId]
  ├── /messages  /messages/[conversationId]
  ├── /groups  /groups/[groupId]
  ├── /meetings  /meetings/new  /meetings/[meetingId]
  ├── /team                      manager lens: workload, status, comparison
  │     └── /[personId]          + /workload
  ├── /score                     decomposition
  │     └── /[channel]           C1–C4 + ledger trace
  ├── /policy                    conduct catalogue and events
  ├── /admin/people  /admin/roles  /admin/scoring  /admin/settings
  └── /settings
/join/[token]                    public guest meeting join
/privacy
```

**Shell:** persistent ambient score (`ScoreCard`, `ComponentBand` already exist), lens toggle (`LensContext`, `Lens` type already exist), global search, notification centre.

Dropped from legacy: `/coworking/mrf`, `/coworking/office-monitor`, `/coworking/fix-priorities`, `/google-task`, `/workspace/google-panel`. Deferred: `/mail`.

---

## 20. TypeScript Domain Structure

```
lib/domain/
  identity/      User, Employee, Role, Permission, ReportingRelationship
  tasks/         Task, TaskType, TaskStatus, TaskPriority, TaskAssignment,
                 TaskEvent, TaskSubmission, TaskReview, ReworkRequest,
                 Rejection, Approval, TaskForward
  deadlines/     DeadlineProposal, DeadlineCounter, DeadlineExtension
  priority/      PriorityChange, PriorityAcknowledgement
  work/          WorkCommit, DailyReport, Attachment
  goals/         Goal, GoalActivity
  conduct/       ConductEvent
  attendance/    AttendanceDay, AttendanceEvent
  scoring/       ScoringRule, ScoringRuleVersion, ScoreUnit, ScoreEvent,
                 ScoreLedgerEntry, ScoreSnapshot
  notifications/ Notification
```

Extends the existing `lib/types.ts` (`ChannelId`, `ScoreChannel`, `PersonScore`, `Person`, `TaskState`, `Task`, `Goal`, `Lens`). Note the existing comment — *"Their weights are NOT decided, which is why nothing here models a weight"* — remains correct until O2 is answered.

### 20.1 Contracts

```ts
// ── identity ────────────────────────────────────────────────────────────────
interface User {
  id: string; email: string; displayName: string;
  status: "active" | "invited" | "suspended" | "deactivated";
  identityProviderId: string; createdAt: string; lastSeenAt: string | null;
}

interface Employee {
  id: string; userId: string; employeeCode: string;
  firstName: string; lastName: string;
  departmentId: string | null; designation: string | null;
  roleIds: string[]; timezone: string; workCalendarId: string;
  joinedAt: string; exitedAt: string | null;
}

interface Role {
  id: string; key: string; displayName: string;
  archetype: "employee" | "manager" | "skip_level" | "people_ops" | "system_admin";
  administrativeLevel: number;          // higher cannot be targeted by lower
  permissionIds: string[]; isSystem: boolean;
}

interface Permission { id: string; capability: Capability; scope: Scope; }

interface ReportingRelationship {
  id: string; employeeId: string; managerId: string;
  type: "primary" | "secondary" | "dotted";
  effectiveFrom: string; effectiveTo: string | null;
  createdBy: string; createdAt: string;
}

// ── tasks ───────────────────────────────────────────────────────────────────
type TaskType = "standard" | "folder" | "recurring" | "goal" | "external" | "self_assigned";

type TaskStatus =
  | "draft" | "pending_approval" | "assigned" | "deadline_negotiation"
  | "confirmed" | "in_progress" | "in_review"
  | "completed" | "cancelled" | "assignment_rejected";

interface TaskPriority { employeeId: string; rank: number; updatedAt: string; }

interface Task {
  id: string; reference: string;
  type: TaskType; status: TaskStatus;
  title: string; description: string | null; requirements: string[];
  createdById: string; createdByRoleId: string;
  parentTaskId: string | null; folderId: string | null; groupId: string | null;
  rootCreatorRoleId: string | null;        // drives the review chain
  estimatedEffortSecs: number | null;
  deadline: TaskDeadline;
  approvalReason: ApprovalReason | null;
  approverIds: string[];
  isScoreEligible: boolean;
  recurrence: RecurrenceConfig | null;
  goalId: string | null;
  createdAt: string; updatedAt: string; deletedAt: string | null;
}

interface TaskAssignment {
  id: string; taskId: string; employeeId: string;
  rank: number;                            // per-employee priority
  assignedAt: string; confirmedAt: string | null; startedAt: string | null;
  isScoreSubject: boolean;                 // resolves the multi-assignee question (O9)
}

interface TaskEvent {
  id: string; taskId: string; sequence: number;
  type: TaskEventType; actorId: string | "system"; actorRole: string;
  payload: Record<string, unknown>;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  occurredAt: string;
}

interface TaskSubmission {
  id: string; taskId: string; attempt: number;
  submittedById: string; submittedAt: string;
  message: string; attachmentIds: string[];
  reviewChain: string[];                   // ordered reviewer ids
  supersededById: string | null;
}

interface TaskReview {
  id: string; submissionId: string; stage: number; isFinalStage: boolean;
  reviewerId: string; decision: "approved" | "rework" | "rejected";
  reason: string | null; reviewedAt: string;
}

interface ReworkRequest {
  id: string; reviewId: string; taskId: string; occurrence: number;
  reason: string; requestedById: string; requestedAt: string;
  previousDueAt: string | null; newDueAt: string | null;
  deductionWaived: boolean; waiverReason: string | null;   // pending O18
}

interface Rejection {
  id: string; reviewId: string; taskId: string;
  reason: string; rejectedById: string; rejectedAt: string;
  allowsResubmission: boolean;             // pending O19
}

interface Approval {
  id: string; taskId: string; submissionId: string | null;
  kind: "assignment" | "self_assignment" | "cross_department" | "effort_estimate" | "completion";
  stage: number; approverId: string;
  decision: "pending" | "waiting" | "approved" | "rejected";
  reason: string | null; decidedAt: string | null;
}

interface TaskForward {
  id: string; sourceTaskId: string; createdTaskId: string;
  forwardedById: string; allocatedSecs: number;
  notes: string; forwardedAt: string;
}

// ── deadlines ───────────────────────────────────────────────────────────────
interface TaskDeadline {
  mode: "timer" | "fixed";
  originalWindowSecs: number | null;
  currentWindowSecs: number | null;
  dueAt: string | null;
  officialDueAt: string | null;            // the only field scoring reads
  state: "unset" | "proposed" | "countered" | "agreed" | "extension_pending";
}

interface DeadlineProposal {
  id: string; taskId: string; proposedById: string;
  proposedDueAt: string; windowSecs: number;
  isExtension: boolean; previousWindowSecs: number | null;
  state: "pending" | "approved" | "rejected" | "countered" | "expired";
  decidedById: string | null; decisionReason: string | null;
  createdAt: string; expiresAt: string | null;   // pending O15
  decidedAt: string | null;
}

interface DeadlineCounter {
  id: string; proposalId: string; counteredById: string;
  counterDueAt: string; counterWindowSecs: number; message: string | null;
  response: "pending" | "accepted" | "rejected";
  responseMessage: string | null; respondedAt: string | null;
}

interface DeadlineExtension {
  id: string; taskId: string; proposalId: string;
  addedSecs: number; previousWindowSecs: number; newWindowSecs: number;
  elapsedPercentAtRequest: number;
  penaltyWaived: boolean; waiverDecidedById: string | null;
  approvedById: string; approvedAt: string;
}

// ── priority ────────────────────────────────────────────────────────────────
interface PriorityChange {
  id: string; taskId: string; employeeId: string;
  previousRank: number; newRank: number;
  reason: string; changedById: string; changedAt: string;
  cascadeId: string | null;
}

interface PriorityAcknowledgement {
  id: string; cascadeId: string; employeeId: string;
  affectedTaskIds: string[]; acknowledgedAt: string;
  timerPausedTaskId: string | null;
}

// ── work ────────────────────────────────────────────────────────────────────
interface WorkCommit {
  id: string; taskId: string; employeeId: string;
  startedAt: string; endedAt: string; durationSecs: number;
  message: string | null; attachmentIds: string[];
  pauseReason: "manual" | "task_switch" | "priority_ack" | "submission" | "auto";
}

interface DailyReport {
  id: string; taskId: string; employeeId: string;
  reportDate: string; message: string; progressPercent: number;
  attachmentIds: string[]; createdAt: string;
}

// ── goals ───────────────────────────────────────────────────────────────────
interface Goal {
  id: string; title: string; description: string | null;
  ownerId: string; period: string;
  weightPercent: number;                   // pool must sum to ≤ 100
  maximumPoints: number; targetValue: number | null; unit: string | null;
  status: "draft" | "active" | "completed" | "cancelled";
  createdById: string; createdAt: string;
}

interface GoalActivity {
  id: string; goalId: string; heading: string;
  points: number; dueAt: string | null;
  assigneeIds: string[];
  status: "pending" | "in_progress" | "submitted" | "approved" | "rejected";
  submittedLate: boolean;
  report: { text: string; attachmentIds: string[]; submittedAt: string; submittedById: string } | null;
}

// ── conduct & attendance ────────────────────────────────────────────────────
interface ConductEvent {
  id: string; employeeId: string; policyId: string;
  severity: "minor" | "moderate" | "serious" | "falsification" | "idle_pool";
  description: string; occurredOn: string;
  appliedById: string; appliedAt: string;
  disputeStatus: "none" | "requested" | "upheld" | "overturned";
  disputeNote: string | null; reversalLedgerEntryId: string | null;
}

interface AttendanceDay {
  id: string; employeeId: string; date: string;
  isExpectedWorkingDay: boolean;           // from the calendar, NOT from event presence
  scheduledStart: string | null; scheduledEnd: string | null;
  actualStart: string | null; actualEnd: string | null;
  lateMinutes: number; earlyDepartureMinutes: number;
  status: "present" | "absent" | "half_day" | "leave" | "holiday" | "week_off";
}

interface AttendanceEvent {
  id: string; employeeId: string; occurredAt: string;
  kind: "punch_in" | "punch_out" | "leave_approved" | "holiday" | "manual_correction";
  source: "biometric" | "hr_system" | "manual";
  sourceRef: string | null; raw: Record<string, unknown> | null;
}

// ── scoring ─────────────────────────────────────────────────────────────────
interface ScoringRule {
  id: string; key: string; component: ChannelId;
  displayName: string; description: string;
  currentVersionId: string;
}

interface ScoringRuleVersion {
  id: string; ruleId: string; version: string;
  parameters: Record<string, number>;
  effectiveFrom: string; effectiveTo: string | null;
  createdById: string; createdAt: string;
  supersedesVersionId: string | null;
}

interface ScoreUnit {
  id: string; employeeId: string; component: ChannelId;
  sourceType: "task" | "goal_activity" | "conduct_event" | "attendance_day";
  sourceId: string; periodKey: string;
  maximumPoints: number;                   // 1.0 unless a rule says otherwise
  earnedPoints: number;                    // clamp(max − deductions + credits, 0, max)
  isExcluded: boolean; exclusionReason: string | null;
  finalisedAt: string | null;              // pending O17
}

interface ScoreEvent {
  id: string; scoreUnitId: string;
  eventType: string; deduction: number; credit: number;
  ruleId: string; ruleVersionId: string;
  effectiveDate: string; createdAt: string;
}

interface ScoreLedgerEntry {
  id: string; employeeId: string; component: ChannelId;
  sourceType: string; sourceId: string; scoreUnitId: string;
  eventType: string;
  maximumPoints: number; deduction: number; credit: number;
  pointsBefore: number; pointsAfter: number;
  reason: string; actorId: string | "system"; actorRole: string;
  effectiveDate: string; periodKey: string; createdAt: string;
  ruleId: string; ruleVersion: string;
  configSnapshot: Record<string, number>;
  isManualAdjustment: boolean; adjustmentReason: string | null;
  reversalOf: string | null;
}

interface ScoreSnapshot {                   // derived; rebuildable from the ledger
  id: string; employeeId: string; periodKey: string;
  component: ChannelId | "overall";
  earnedPoints: number; possiblePoints: number; percentage: number;
  unitCount: number; computedAt: string; ledgerHighWaterMark: string;
}

// ── notifications ───────────────────────────────────────────────────────────
interface Notification {
  id: string; recipientId: string; type: string;
  title: string; body: string; data: Record<string, unknown>;
  sourceType: string | null; sourceId: string | null;
  channels: ("in_app" | "push" | "email" | "socket")[];
  readAt: string | null; createdAt: string;
}
```

---

## 21. Testing Strategy

Legacy has **no test suite** — `npm test` exits 1, and `test.js` (94 KB), `c1_interactive_test.js`, `c2_interactive_test.js`, `p1_conflict_test.js` and `verifyTimerSop.js` are manual scripts.

| Layer | Focus | Non-negotiable |
|---|---|---|
| **Domain unit** | Pure functions: state machine, scoring, priority cascade, deadline arithmetic, permission resolution | 100% branch coverage on the scoring engine |
| **Property** | `earnedPoints` always within `[0, max]`; ledger `pointsAfter` always equals the clamp; cascade never moves a deadline earlier; renumbering yields a valid ordering | These are the invariants legacy violates |
| **Golden** | Fixture inputs → expected ledger entries, versioned in the repo | Prevents silent scoring drift |
| **Integration** | Route → service → datastore → ledger → notification, per workflow | Every workflow in §22's table |
| **Permission** | Every `(capability, actor, target)` triple, including the four invariants in §3 | Would have caught the `review-completion` hole |
| **Migration** | Legacy fixture → import → equivalence assertions | Parallel-run reconciliation |
| **E2E** | Critical paths: login, create → negotiate → work → submit → review → score | |

**Specific regression tests, each named for a legacy defect:** extension deduction actually applies · composite clamps to `[0,100]` · aggregation is points-over-points not average-of-percentages · cancellation excludes a unit · rejection then approval leaves exactly one net ledger effect · a manager cannot see outside their hierarchy · no role can reset the administrator's password · nobody can review their own submission · re-running a score after a rule-version change reproduces the historical number.

---

## 22. Legacy → New Mapping

| Legacy behaviour | Confirmed legacy implementation | Problem or ambiguity | New Cowork implementation | Action |
|---|---|---|---|---|
| Task engine | `taskForward.js` + `taskForward.service.js`, 2,368 + 2,412 ln | 96 KB `taskTree.routes.js` shadowed behind it; near-duplicate service | Domain module rebuilt from spec | **Replace** |
| Two state axes | `status` + `completionStatus` | Unsynchronised, neither implies the other | One `TaskStatus` + `TaskSubmission` | **Refactor** |
| Five `pending_*` statuses | `pending_tl_approval`, `pending_department_approval`, `pending_tl_hours`, `pending_approval`, `repeat_pending_confirmation` | Same concept, five names | `pending_approval` + `ApprovalReason` | **Refactor** |
| Dead statuses | `pending`, `submitted`, `approved`, `pending_tl_review`, `pending_ceo_review`, `not_started` | Never assigned by any reachable path | — | **Drop** |
| Priority as numeric rank | `openTaskCount + 1`, per person | Written client-side, no check, no audit; unbounded on BE, clamped 1–10 on FE | `TaskAssignment.rank`, server-mediated, audited | **Replace** |
| Priority in three fields | `priority`, `assigneePriorities{}`, `order` | One concept, three representations | One `rank` | **Refactor** |
| Two priority UIs | drag-reorder vs `PrioritySwapPanel` | Contradictory renumbering semantics | One semantic (**O11**) | **Replace** |
| P1 cascade | `checkAndExtendForP1` | Fires 500 ms after a client write; notifies manager only | In-transaction; notifies both | **Refactor** |
| Priority acknowledgement | `PriorityChangeAckModal` + `acknowledgedByEmployee` in a history array | Client-written; gates nothing | Server-recorded `PriorityAcknowledgement` | **Refactor** |
| Deadline negotiation | propose → approve/reject/counter → respond | Sound; the best workflow in the product | Preserved, restructured | **Preserve** |
| Two extension mechanisms | `propose-deadline` vs `request-deadline-extension` | Different fields, different approvers | One | **Replace** |
| Penalty waiver | 50%/70% elapsed zones | Hard-coded, undocumented (**O14**) | Versioned scoring rule | **Refactor** |
| `officialDeadline` distinct from `dueDate` | `c1.officialDeadline` | Correct and load-bearing | `TaskDeadline.officialDueAt` | **Preserve** |
| Office-hours walker | `_addWorkingSecsIST`, duplicated | IST hard-coded; `+6h` debug fallback in production | Configurable calendar service | **Refactor** |
| Blocked dates | Holidays + approved leave | Advisory only, never enforced | Enforced at proposal | **Refactor** |
| Submission | `completionSubmission` object | Overwritten silently; no `status` check | Append-only attempts | **Replace** |
| Review flow | `_reviewFlow` → `tl_final`/`ceo_direct`/`tl_then_ceo` | Role-derived, breaks if roles are renamed | Hierarchy-derived stages | **Refactor** |
| **Completion review** | `review-completion` | **No permission check whatsoever** | `review.decide`, scoped, never self | **Replace** |
| Rework | −0.2, deadline re-granted, `reworkHistory[]` | Reason optional; waiver silent and unaudited | Preserved; reason required; waiver pending **O18** | **Preserve** |
| Rejection | Zeroes the unit; silently resubmittable | Score effect **not approved**; asymmetric with CEO rejection | Pending **O4**; symmetric | **Replace** |
| CEO review | Second stage | No score event and no time re-grant on rejection | Symmetric | **Refactor** |
| Forward budget | Duration budget enforced against the parent | Malformed assignments silently skipped; skipped entirely when the parent has no window | Preserved; validation surfaces errors | **Preserve** |
| Cross-department gate | Two-stage sequential with `E000` fallback | Sound; magic ID | Hierarchy-resolved | **Preserve** |
| Cancellation | `markTaskCancelled` exists, never called | Consumed everywhere, triggerable nowhere | First-class endpoint | **Replace** |
| Deletion | Hard recursive | Orphans ledger, files, `draft_chat`; no cycle guard | Soft-delete + tombstone + reversal | **Replace** |
| Task history | 7 array shapes + system chat | Not queryable; some client-written | One `TaskEvent` stream | **Replace** |
| Timers | Client → `cowork_task_timers` | Feeds scoring with no server mediation | Server-mediated | **Replace** |
| Work commits | Client → `cowork_work_commits` | Same | Server-mediated | **Replace** |
| C1 rework −0.2 | `c1Service.js` | Matches the owner-confirmed rule | Preserved | **Preserve** |
| C1 extension deduction | Configured 0.2 | **Multiplied by zero** | Rule engine, no special cases | **Replace** |
| C1 band maxima | Computed at two sites | **Discarded** by `calculateC1Net` | Maximum stored per unit | **Replace** |
| C1 quality rate | Unweighted mean | Header claims ETC-weighted | Points-over-points | **Replace** |
| C2 weightage pool | Hard 100% cap, pre-validated | Sound | Preserved | **Preserve** |
| C2 late/not-done → 0 | Binary per component | Partial credit undecided (**O8**) | Rule-driven | **Refactor** |
| C3 conduct | MongoDB bleaches, deduction-only | Named "Policy" in `PRODUCT.md`; the `Policy` model is C4 | `ConductEvent` + `C3 · Conduct & Policy` | **Refactor** |
| C4 attendance | Flat per-instance penalties | Denominator from ledger entries; flat lateness | Calendar denominator; proportional lateness | **Replace** |
| Composite | `mean(C1,C2,C4) + C3` | No floor, no cap, averages percentages, unweighted | `clamp`, points-over-points, weighted | **Replace** |
| Annual roll-up | Q1 10 / Q2 20 / Q3 30 / Q4 40 | `liveAnnual` ≡ `projectedAnnual` | Pending **O3** | **Refactor** |
| Bleach ledger | `Employee.sopPoints[]` | Two sign conventions; mutated on dispute; no rule version; RMW race | Immutable ledger | **Replace** |
| Score caches | `cowork_c1_scores`, `cowork_c2_scores` | Drift undetectably | `ScoreSnapshot`, rebuildable | **Replace** |
| Score visibility | Own-only for employees | **Any TL sees everyone** | Hierarchy-scoped | **Replace** |
| Score location | `/coworking/pmp` page | `PRODUCT.md:46` requires ambient | Shell + `/score` | **Replace** |
| Roles | `ceo`/`tl`/`employee` literals, `E000` | Hard-codes this company | Configurable records | **Replace** |
| Reporting hierarchy | Exists, display-only | Never used for authorisation | Time-bounded, authorisation-bearing | **Replace** |
| Notifications | `_notify` + `_notifyMany` | Two pipelines; email only from one; read-all only | One router, preferences, per-item read | **Replace** |
| Socket | Two `io.on("connection")` | Unauthenticated payloads; trusts client IDs | One namespace, authenticated | **Refactor** |
| Attachments | 5 shapes, no lifecycle | Orphaned on delete; secrets in the frontend | One entity, signed uploads | **Replace** |
| Repeat tasks | Slot submissions | Never score; never terminate | Recurrence model (**O20**) | **Refactor** |
| Third-party tasks | `vendorUpdates[]`, payment actions | Never score | Deferred (**O20**) | **Defer** |
| Google Workspace | 26 endpoints | Duplicates own surfaces; `all-inbox` privacy | Calendar + Drive picker (**O23**) | **Defer** |
| AI meeting features | Gemini summaries, Ask-AI | `PRODUCT.md:30` says not an AI product | Optional, opt-in, never positioning | **Defer** |
| Office Monitor | Desktop surveillance | Owner-confirmed exclusion | — | **Drop** |
| MRF | ERP leakage | Owner-confirmed exclusion | — | **Drop** |
| Debug/repair endpoints | `force-repair-self-assign`, `self-assign-debug` — **no auth** | Full-collection write, unauthenticated | — | **Drop** |
| `setup/seed-ceo` | Unauthenticated CEO creation | Admin takeover | Out-of-band provisioning | **Drop** |

---

## 23. Migration Sequence and Cutover

### 23.1 Sequence

| Phase | Contents | Exit criteria |
|---|---|---|
| **0 · Decisions** | Answer O1–O32. Obtain `CW-DEV-PMP-01 v1.0`. **Rotate the eTimeOffice credentials** (independent of this project). Locate the legacy Firestore rules. Update `PRODUCT.md` — including the stale "Evidence on Hand" note at `:103` | Written answers to every blocking decision |
| **1 · Foundations** | Datastore, schema, `.env.example`, identity, roles, reporting closure, permission engine, server route guards | A user logs in, lands on `/`, and is correctly denied a route they lack permission for |
| **2 · Scoring** | Rule engine, versioned rules, immutable ledger, snapshots, C1–C4, ambient score in the shell, `/score` + `/score/[channel]`, hierarchy-scoped visibility | A score is visible everywhere, decomposes to C1–C4, traces to individual events, never leaves `[0,100]`, and reproduces after a rule-version change |
| **3 · Tasks** | Task aggregate, state machine, assignments, priority + cascade + acknowledgement, deadline negotiation, submissions, reviews, rework/rejection, forwarding, event history, timers, commits, reports, chat, attachments | A task is created, negotiated, worked, submitted, reworked, approved — and the resulting C1 movement is correct and traceable to its ledger entries |
| **4 · Collaboration** | Groups, messaging, notifications, duty status, presence | |
| **5 · Meetings** | Scheduling, LiveKit, guest join, recording | |
| **6 · Goals & conduct** | Goals, activities, C2 pool, conduct catalogue, disputes | |
| **7 · Attendance** | Provider adapter, calendar, C4 | |
| **8 · Deferred** | Calendar/Drive integration; AI meeting assistance if approved | |
| **9 · Data migration & cutover** | §23.2 | |

Phases 1–3 are sequential. 4–7 can overlap once 1–3 are stable.

### 23.2 Cutover

1. **Import** — people, reporting lines, tasks, chat, attachments metadata. Key on `biometricId`, not the `employeeId` virtual.
2. **Repair known corruption first** — `update-id` orphans in `assigneeIds`/`memberIds`/`sopPoints`; ledger entries referencing hard-deleted tasks; score caches already drifted from source tasks.
3. **Reconstruct the ledger.** Legacy's `sopPoints` bleaches carry no rule version or config snapshot. Import them as historical entries tagged `ruleVersion: "legacy-import"` with the config snapshot recorded as unknown. **They are not reproducible and must not be presented as if they were.**
4. **Parallel run.** Both systems compute scores for one full period. Reconcile every variance to a named cause — expect differences from the four fixed C1 defects alone.
5. **Freeze** legacy Cowork writes.
6. **Delta import.**
7. **Switch.**
8. **Legacy read-only** for one period, then retire the Cowork module. The ERP monolith continues serving its non-Cowork modules unchanged.

**Rollback:** available through step 6. After the switch, roll forward only — the ledger is append-only and new entries have no legacy representation.

---

## 24. Security Controls

| Control | Fixes |
|---|---|
| Server-side authorisation on every mutation | Client-written priority, timers, commits, acknowledgements |
| Permission engine with the four invariants (§3) | Anyone reviewing anything; TL resetting the CEO's password; TL seeing all scores |
| No unauthenticated endpoints except documented public ones (guest meeting join) | `force-repair-self-assign`, `self-assign-debug`, `setup/seed-ceo` |
| No debug or repair endpoints in production builds | `task/dump`, `employee/dump`, `test-email`, `audio/test-gemini`, `timer-sop/test-finalize`, `/coworking/fix-priorities` |
| No secrets in the frontend bundle or repository | `FIREBASE_PRIVATE_KEY`, `GOOGLE_SERVICE_ACCOUNT`, `CLOUDINARY_API_SECRET` in the legacy frontend |
| No credentials in source, including comments | eTimeOffice credentials at `BiometricSyncService.js:8-10` |
| No plaintext passwords, including temporary | `tempPassword` in Firestore |
| Datastore access rules committed and reviewed | Legacy Firestore rules absent |
| Signed, server-issued upload credentials | Unsigned client uploads with secrets present |
| Authenticated socket handshake; server-derived identity | Client-supplied `employeeId` on `join_cowork` |
| Single-use, scoped, expiring guest meeting tokens | Lifecycle not enforced in reachable code |
| Idempotency keys on mutations | Duplicate submissions and double-scoring |
| Optimistic concurrency on task updates | Lost updates during the 8-second live-listener suppression |
| Immutable audit for every permission-relevant action | No priority audit; no review audit beyond the review record |
| Rate limiting on auth and mutations | None |
| Structured logging without PII; no debug logging on request paths | `console.log("yugyu")`, `[C4 DEBUG]` |
| Dependency and secret scanning in CI | |
| Retention and export policy for ledger and task history | **OWNER DECISION REQUIRED (R10)** |

---

## Appendix — Documents

| Document | Contents |
|---|---|
| [LEGACY_AUDIT.md](LEGACY_AUDIT.md) | Original inventory: features, routes, endpoints, models, env vars, tech debt, duplicates |
| [LEGACY_BEHAVIOUR_SPEC.md](LEGACY_BEHAVIOUR_SPEC.md) | Route reachability, feature classification, notifications, realtime, data model, validation |
| [TASK_LOGIC_SPEC.md](TASK_LOGIC_SPEC.md) | Creation paths, priority, deadlines, execution, submission, review, forwarding, state machine |
| [SCORING_LOGIC_SPEC.md](SCORING_LOGIC_SPEC.md) | Legacy C1–C4 traced, universal earned-points model, immutable ledger |
| [PERMISSIONS_AND_ROLES_SPEC.md](PERMISSIONS_AND_ROLES_SPEC.md) | Legacy matrix, 19 defects, new role and hierarchy model |
| [INTEGRATIONS_SPEC.md](INTEGRATIONS_SPEC.md) | Every integration classified, credentials to rotate, boundaries |
| [MIGRATION_DECISIONS.md](MIGRATION_DECISIONS.md) | D1–D32 settled; O1–O32 open |
| **NEW_COWORK_ARCHITECTURE.md** | This document |
