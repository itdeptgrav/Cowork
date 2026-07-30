# UI Data Contracts

**Date:** 2026-07-25
**Purpose:** the typed boundary between the UI and whatever provides data. The mock repository satisfies it today; a production API satisfies it later without any component changing.

---

## 1. The seam

```
UI component
   ↓  never imports mock data
domain hook  (lib/hooks/useRepository.ts — useQuery / useAction)
   ↓
CoworkRepository  (lib/repositories/types.ts — the interface)
   ↓
MockRepository  →  later: ApiRepository
```

Selection happens in exactly one place, `lib/repositories/index.ts`:

```ts
let current: CoworkRepository = mockRepository;
export function getRepository(): CoworkRepository { return current; }
export function setRepository(repo: CoworkRepository): void { current = repo; }
```

**Enforced rules**
1. No page or component imports from `lib/mock/` or `lib/repositories/mock/`.
2. Every repository method is `async`, even where the mock resolves immediately, so a network implementation needs no caller changes.
3. Mutations return `ActionResult<T>` rather than throwing — a permission denial or validation failure is a state to render, not an exception to catch.
4. No large mock object lives inside a page file. All seed data is in `lib/mock/seed.ts`.

---

## 2. Domain types

Defined in `lib/domain/`, re-exported from `lib/domain/index.ts`. All 50 contracts the brief asked for are present.

| Module | Types |
|---|---|
| `identity.ts` | `User` · `Employee` · `Department` · `Role` · `RoleArchetype` · `Capability` · `Scope` · `Permission` · `ReportingRelationship` · `Viewer` |
| `tasks.ts` | `Task` · `TaskType` · `TaskStatus` · `ApprovalReason` · `TaskDeadline` · `TaskAssignment` · `TaskEvent` · `TaskEventType` · `TaskSubmission` · `TaskReview` · `ReviewDecision` · `ReworkRequest` · `Rejection` · `Approval` · `ApprovalKind` · `CompletionRequirement` · `WorkCommit` · `TimerSession` · `DailyReport` · `Attachment` · `TaskChatMessage` · `RecurrenceConfig` |
| `deadlines.ts` | `DeadlineProposal` · `DeadlineCounter` · `DeadlineExtension` · `ProposalState` · `BlockedDate` · `WorkCalendar` · `WorkCalendarDay` |
| `priority.ts` | `PriorityChange` · `PriorityCascade` · `CascadeEffect` · `PriorityAcknowledgement` · `PriorityConflict` |
| `projects.ts` | `Project` · `ProjectStatus` · `ProjectHealth` · `ProjectMember` · `ProjectRole` · `ProjectTaskLink` · `ProjectMilestone` · `ProjectActivity` · `ProjectProgress` |
| `scoring.ts` | `ChannelId` · `ScoringRule` · `ScoringRuleVersion` · `ScoreUnit` · `ScoreEvent` · `ScoreEventType` · `ScoreLedgerEntry` · `ScoreSnapshot` · `ChannelBreakdown` · `ScoreOverview` |
| `work.ts` | `Goal` · `GoalActivity` · `ConductEvent` · `ConductPolicy` · `ConductSeverity` · `AttendanceDay` · `AttendanceEvent` · `Conversation` · `Message` · `Group` · `Meeting` · `Notification` |

### 2.1 Contracts that encode a fix

| Type | What it fixes |
|---|---|
| `Task.status` | ONE axis. Legacy ran `status` and `completionStatus` in parallel, unsynchronised. |
| `Task.approvalReason` | Five near-identical legacy `pending_*` statuses collapse to one status plus a typed reason. |
| `TaskAssignment.rank` | ONE priority field per (task, person). Legacy spread it across `priority`, `assigneePriorities` and `order`. |
| `TaskAssignment.isScoreSubject` | Makes multi-assignee attribution explicit instead of implicitly scoring `assigneeIds[0]`. |
| `TaskDeadline.officialDueAt` | The only field scoring reads, separate from the displayed `dueAt`. |
| `TaskSubmission.supersededById` | Append-only attempts. Legacy overwrote the previous submission silently. |
| `Task.deletedAt` | Soft delete. Legacy hard-deleted recursively and orphaned the ledger. |
| `ScoreLedgerEntry.ruleVersion` + `configSnapshot` | Makes a historical score reproducible after a rule change — the property legacy's `sopPoints` array lacked. |
| `ScoreLedgerEntry.reversalOf` | Disputes resolve by reversal, never by mutating the original row. |
| `ReportingRelationship.effectiveFrom/To` | Time-bounded, so a past score stays visible to whoever managed that person then. |
| `Permission = capability × scope` | The legacy defect — any TL seeing every score — came from capabilities with no scope. |

---

## 3. Query requirements

```ts
interface Page<T> { items: T[]; nextCursor: string | null; total: number }

interface TaskQuery {
  scope: "mine" | "team" | "assigned_out" | "all";
  status?: TaskStatus[];
  assigneeId?: EmployeeId;
  projectId?: ProjectId | null;
  folderId?: string | null;
  parentTaskId?: TaskId | null;
  search?: string;
  overdueOnly?: boolean;
  blockedOnly?: boolean;
  sort?: "rank" | "due" | "updated" | "title";
  cursor?: string | null;
  limit?: number;
}
```

`scope: "team"` resolves through the **reporting closure**, not through a role check. This is where decision D10 is enforced at the data layer.

**Composite views** resolve a row's full needs in one call, so a list never issues N+1 requests:

- `TaskView` — task, assignments, assignees, project, the viewer's own rank, latest submission, open proposal/counter, pending approvals, rework count, overdue flag, subtask count, chat count.
- `ProjectView` — project, owner, members with employees, computed progress, milestones, task links.

**Pagination** is cursor-based throughout. **Sorting** and **filtering** are server-side concerns expressed in the query, never done in a component.

---

## 4. Mutation requirements

Every mutation returns:

```ts
type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; code: ActionErrorCode; message: string; field?: string };

type ActionErrorCode =
  | "permission_denied" | "not_found" | "invalid_state"
  | "validation_failed" | "conflict" | "budget_exceeded" | "offline";
```

`field` lets a form attach the message to the input that caused it. `code` lets the UI choose between an inline error, a permission-denied state and an offline banner.

Typed inputs: `CreateTaskInput` · `ChangePriorityInput` · `ProposeDeadlineInput` · `RequestExtensionInput` · `SubmitCompletionInput` · `ReviewInput` · `ForwardTaskInput` · `CreateProjectInput` · `CreateMeetingInput`.

**Production additions required:** an `Idempotency-Key` on every mutation, and `ETag`/`If-Match` on task updates. Neither is in the mock — the prototype has no concurrency — but both belong in the interface before the API lands.

---

## 5. Realtime requirements

The prototype has no socket. Two places stand in for one, and both are marked in code:

| Surface | Prototype | Production |
|---|---|---|
| Pending priority acknowledgement | 2.5s poll in `PriorityAckGate` | Push on `priority_cascaded` |
| Notification count | Fetch on mount | Push on any notification write |

Events the production layer must deliver: `task_assigned` · `priority_cascaded` · `deadline_proposed` · `deadline_decided` · `extension_requested` · `extension_decided` · `submission_created` · `review_decided` · `task_completed` · `notification_created`.

Realtime is a **delivery channel, never a source of truth**. Legacy's `timer_blocked` was advisory and enforcement was client-side; here the server is authoritative and the socket only tells the client to refetch.

---

## 6. Prototype-only surface

Three methods exist on the interface that the production implementation will not have:

```ts
resetDemoData(): Promise<void>;
setSimulatedFailure(mode: SimulatedFailure): void;
getSimulatedFailure(): SimulatedFailure;
```

They drive the demo bar and let every page demonstrate its offline, error and permission-denied states. They are the visible edge of the temporary state layer and are deleted with it.
