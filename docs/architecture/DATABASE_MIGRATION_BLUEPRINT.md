# Database Migration Blueprint

Audit only. No code changed. Technology-agnostic — the schema below maps to
Postgres, Prisma, Supabase, Mongo or Firestore without redesign.

---

## 1. What legacy actually was

**Two persistence systems, not one**, and this is the single most important fact
for the migration:

| | Store | Contents |
|---|---|---|
| **MongoDB / Mongoose** | 53 non-CMS models | HR and ERP: `Employee`, `Attendance`, `Dailyattendance`, `C4Config`, `Policy`, `OvertimeReport`, departments |
| **Firestore** | ~25 `cowork_*` collections | The entire workspace: `cowork_tasks`, `cowork_mails`, `cowork_emergency_approvals`, `cowork_duty_status`, `cowork_work_commits`, `cowork_task_timers`, `cowork_notifications`, `cowork_scheduled_meets`, `cowork_goal_status` |

**The workspace domain was never in a relational database.** It was a
document store written *directly from the browser* — which is why priority,
emergency approval, break credit, mail and deadline shifting all had no server
validation, no audit of who acted, and no referential integrity. Every
"FE/BE CONTRADICTION" recorded in `TASK_LOGIC_SPEC.md` traces to this.

A further 42 CMS models (cutting, QC, packaging, store, barcode) belong to a
garment-manufacturing ERP and are **out of scope** — they share the `Employee`
table and nothing else.

## 2. What Cowork is now

Also two stores, and the seam is deliberate:

| | Store | Contents | Shared? |
|---|---|---|---|
| **Identity** | `.data/identity.json`, server, behind `IdentityStore` | organisations, accounts, sessions, credential tokens, Gmail connections | ✅ |
| **Workspace** | `localStorage`, client, `MockRepository` | **55 collections** — employees, tasks, projects, mail, meetings, scoring, attendance | ❌ per browser |

`CoworkRepository` is already the seam a real backend plugs into. That part is
sound. What is not sound is everything below.

---

## 3. Blocking gaps — must be fixed before any database

### 3.1 No entity carries `organisationId` — **critical**

Measured across the domain:

| Entity | `organisationId` |
|---|---|
| Employee, Task, Project, Meeting, Goal, MailThread, Department, Role | **none of them** |

The identity store *has* organisations, and `Account.organisationId` exists — so
the product is multi-tenant at the auth layer and **accidentally single-tenant
at the data layer**. Point 55 collections at one shared database as they stand
and every organisation reads every other organisation's tasks, mail and scores.

**Every table needs a tenant key, and every query needs it in the WHERE clause.**
This is the one gap that cannot be deferred.

### 3.2 Missing timestamps

| Entity | createdAt | updatedAt |
|---|---|---|
| Employee | ✗ | ✗ |
| Department | ✗ | ✗ |
| Meeting | ✗ | ✗ |
| Role, Goal | ✓ | ✗ |
| Project, MailThread | ✓ | ✓ |

No `updatedAt` means no optimistic concurrency and no incremental sync. No
`createdAt` on `Employee` means "when did this person join" is unanswerable
outside `joinedAt`, which is an HR fact, not a record fact.

### 3.3 Twenty-four arrays that must become join tables

`assigneeIds`, `approverIds`, `pendingAssigneeIds`, `participantIds`,
`memberIds`, `roleIds`, `departmentIds`, `readBy`, `starredBy`, `trashedBy`,
`archivedBy`, `attachmentIds`, `taskIds`, `appliedTaskIds`, `shiftedTaskIds`,
`affectedTaskIds`, `satisfiesRequirementIds`, `hierarchyIds`, `directReportIds`,
`labels`, `tags`, `actionItems`, `slotLabels`, `engineKeys`.

Three categories, three different treatments:

- **True many-to-many → join table.** `assigneeIds` → `task_assignment`
  (already an entity: `TaskAssignment` carries `rank`, `isScoreSubject`).
  `participantIds` → `meeting_participant` (already exists).
  `roleIds` → `employee_role`. `memberIds` → `group_member`.
- **Per-person state → state table.** `readBy` / `starredBy` / `trashedBy` /
  `archivedBy` → one `mail_message_state(messageId, employeeId, read, starred,
  trashed, archived)`. Four arrays, one table.
- **Derived, must NOT be persisted.** `hierarchyIds` and `directReportIds` are
  computed by `closureOf()` from the reporting tree. Storing them creates a
  second source of truth for the permission system. They stay derived.
- **Genuinely scalar arrays.** `labels`, `tags`, `actionItems`, `slotLabels` —
  fine as `text[]` in Postgres or a child table if they need indexing.

### 3.4 Prototype-only structures that break on contact with a database

| Structure | Why it breaks |
|---|---|
| `store.seq` + `nextId()` → `e-1`, `t-2` | Sequential per browser. Two clients mint the same id. Replace with UUIDv7 (sortable) or DB-generated keys |
| `store.clockOffsetMs` + `now()` | A simulated clock that only advances on mutation. Already caused the timer bug (10s recorded as 70s). All timestamps must become real `now()` server-side |
| `store.failure` | A simulated-failure switch for the demo. Drop |
| `actingId()` | Documented as *not* authentication. Every query must derive the actor from the verified session instead |
| `PROTOTYPE_NOW` / seed anchoring | Seed data is anchored to a fixed date; real data is not |

### 3.5 Permissions run on the wrong side — **critical**

**30 `#deny()` calls in the client-side repository. 1 server route re-checks
anything.**

Every rule built this session — the reporting closure, "your manager sets your
priority", emergency manager-only approval, `score.configure` for the break
allowance, meeting membership — is enforced in the browser. It is correct,
consistent and tested, and it is trivially bypassable with devtools.

The predicates are already extracted as pure modules for exactly this reason and
can be shared verbatim by a server:
`lib/auth/{can,hierarchy,priority,assignment}.ts`,
`lib/tasks/{completion,emergency,breakMode,deadlineShift,timer,priorityAffordance}.ts`,
`lib/meetings/access.ts`, `lib/mail/{transport,inbound}.ts`.

**The work is re-running them server-side, not rewriting them.**

---

## 4. Core schema

Technology-agnostic. `id` = UUIDv7. Every table below carries
`organisation_id` unless stated. `created_at`/`updated_at` on all.

### organisation
Purpose: tenant root.
`id`, `name`, `founder_account_id`, `created_at`.
Indexes: none beyond PK. Constraint: `name` not null.

### account *(identity — exists server-side today)*
Purpose: a credential. Distinct from Employee, deliberately.
`id`, `organisation_id` →organisation, `employee_id` →employee (nullable),
`email` unique-per-org, `phone`, `password_hash`, `status`, `archetype`,
`last_seen_at`.
Indexes: `(organisation_id, email)` unique; `employee_id`.

### employee
Purpose: the worker. **Add `organisation_id`, `created_at`, `updated_at`.**
`id`, `organisation_id`, `employee_code`, `first_name`, `last_name`,
`display_name`, `initials`, `hue`, `email`, `department_id` →department,
`designation`, `timezone`, `work_calendar_id`, `is_founder`, `joined_at`,
`exited_at`.
Indexes: `(organisation_id, employee_code)` unique; `(organisation_id, email)`;
`department_id`.
Constraint: `exited_at IS NULL OR exited_at >= joined_at`.

### employee_role  *(join — replaces `roleIds[]`)*
`employee_id`, `role_id`, PK `(employee_id, role_id)`.

### role
`id`, `organisation_id`, `key`, `display_name`, `archetype`,
`administrative_level`, `is_system`.
Index: `(organisation_id, key)` unique.

### role_permission *(replaces the embedded permissions array)*
`id`, `role_id`, `capability`, `scope`.
Index: `(role_id, capability)` unique.

### reporting_relationship
Purpose: **the single source of truth for visibility, monitoring, priority and
assignment scope.** Time-bounded on purpose.
`id`, `organisation_id`, `employee_id`, `manager_id` →employee, `type`
(`primary|secondary|dotted`), `effective_from`, `effective_to` (nullable),
`created_by`.
Indexes: `(employee_id, effective_to)`, `(manager_id, effective_to)`.
Constraints: `employee_id <> manager_id`; **partial unique** on
`(employee_id) WHERE type='primary' AND effective_to IS NULL` — at most one live
primary line. Cycle prevention stays in application code (`closureOf` has a
depth guard); a DB constraint cannot express it.

### department
`id`, `organisation_id`, `name`, `hod_employee_id` →employee, `parent_id`
→department, `is_active`.

### task
`id`, `organisation_id`, `reference`, `type`, `status`, `title`, `description`,
`created_by_id`, `created_by_role_id`, `root_creator_employee_id`,
`department_id`, `parent_task_id` →task, `project_id`, `group_id`,
`estimated_effort_secs`, **deadline columns flattened** (`deadline_mode`,
`original_window_secs`, `current_window_secs`, `due_at`, **`official_due_at`**,
`deadline_state`, `assignor_rejection_*`), `approval_reason`,
`is_score_eligible`, `goal_id`, `is_blocked`, `blocked_reason`, `tags`,
`deleted_at`.
Indexes: `(organisation_id, status)`, `parent_task_id`, `project_id`,
`(organisation_id, due_at)`, partial `WHERE deleted_at IS NULL`.

> **`official_due_at` must survive migration.** It is the only field scoring
> reads, and its separation from `due_at` is what makes a waived extension
> differ from a charged one. Break credit moves `due_at` only; approved
> emergency and waived extensions move both.

### task_assignment *(replaces `assigneeIds[]`)*
`id`, `task_id`, `employee_id`, `rank`, `assigned_at`, `confirmed_at`,
`started_at`, `is_score_subject`.
Index: `(employee_id, rank)` — the priority queue read.
Constraint: unique `(task_id, employee_id)`.

### completion_requirement / task_requirement_claim
`completion_requirement`: `id`, `task_id`, `text`, `order`, `satisfied_at`,
`satisfied_by_id`.
`task_requirement_claim` *(replaces `satisfiesRequirementIds[]`)*:
`(task_id, requirement_id)`.
> Satisfaction is **derived** in `completionState()` and must not be
> denormalised — a requirement with claimants is satisfied only when every
> claimant completes.

### task_event / meeting_event / project_activity — **append-only audit**
`id`, `<parent>_id`, `type`, `actor_id`, `actor_name`, `detail`, `created_at`.
Constraint: no UPDATE, no DELETE. `actor_name` is denormalised deliberately —
the audit must still read correctly after somebody leaves.

### Remaining entities *(same treatment; fields already modelled)*
`project`, `project_member`, `project_task_link`, `project_milestone`;
`approval`, `approval_workflow`, `workflow_stage`;
`deadline_proposal`, `deadline_counter`, `deadline_extension`,
`deadline_change_request`;
`priority_change`, `priority_cascade`, `cascade_effect`,
`priority_acknowledgement`;
`emergency_request`, `break_session`, `organisation_settings`;
`timer_session`, `work_commit`, `daily_report`;
`goal`, `goal_activity`; `conduct_policy`, `conduct_event`;
`attendance_day`, `attendance_event`;
`score_unit`, `score_ledger_entry` *(immutable)*, `scoring_rule`,
`scoring_rule_version`;
`meeting`, `meeting_participant`, `meeting_event`;
`mail_thread`, `mail_message`, `mail_message_state`, `mail_attachment`,
`gmail_connection` *(encrypted columns)*;
`conversation`, `message`, `group`, `group_member`, `notification`,
`attachment`.

---

## 5. Relationship map

```
organisation (tenant root)
 ├─1:N─ account ─────────0..1:1── employee
 ├─1:N─ employee
 │        ├─M:N─ role            (employee_role)
 │        ├─1:N─ reporting_relationship  (self-referencing, time-bounded)
 │        ├─1:N─ timer_session / work_commit / break_session
 │        ├─1:N─ emergency_request ──N:1── employee (manager)
 │        ├─0..1─ gmail_connection
 │        └─1:N─ attendance_day / score_unit / score_ledger_entry
 ├─1:N─ department ──1:1── employee (hod)
 ├─1:N─ role ──1:N─ role_permission
 ├─1:N─ task
 │        ├─M:N─ employee        (task_assignment: rank, is_score_subject)
 │        ├─1:N─ completion_requirement ──M:N── task (claims)
 │        ├─1:N─ task_event  [append-only]
 │        ├─1:N─ approval / submission / review / deadline_*
 │        └─N:1─ task (parent, depth 1)
 ├─1:N─ project ──M:N── employee (project_member) / task (project_task_link)
 ├─1:N─ meeting ──M:N── employee (meeting_participant) ──1:N── meeting_event
 ├─1:N─ mail_thread ──1:N── mail_message ──M:N── employee (mail_message_state)
 ├─1:N─ goal ──1:N── goal_activity
 └─1:N─ notification ──N:1── employee
```

Cardinality notes: account↔employee is **1:1 optional** (a person can exist in
the directory before they can sign in — that is the invitation flow).
task→task is **1:N depth-one only**, enforced by `subtaskRefusal`.

---

## 6. Migration plan

### Phase 1 — before touching a database
1. **Add `organisation_id` to every workspace entity** and thread it through
   `CoworkRepository`. Nothing else matters until this is done.
2. Add `createdAt`/`updatedAt` where missing (Employee, Department, Meeting,
   Role, Goal).
3. Replace `nextId()` with UUIDv7; retire `store.seq`.
4. Replace `now()`/`clockOffsetMs` with real time; retire `tick()`.
5. Retire `actingId()` in favour of a session-derived actor passed into the
   repository.
6. Delete `store.failure` and the demo reset.

### Phase 2 — schema
Create tables per §4. Start with `organisation → employee → role →
reporting_relationship` — the permission substrate everything else reads.

### Phase 3 — repositories
Implement `ApiRepository` against `CoworkRepository`. **The pure predicate
modules move server-side unchanged** — they were extracted for this. Keep
`MockRepository` as the test double.

### Phase 4 — API
One route per repository method, each re-running the predicate server-side. The
existing `/api/auth/*`, `/api/mail/*`, `/api/meetings/*` routes are the pattern.
Close the two documented holes: LiveKit tokens cannot verify membership, and the
meeting/mail routes trust client-stated identity.

### Phase 5 — data migration
- Legacy **Mongo** (`Employee`, `Attendance`) → `employee`, `attendance_day`.
  Reconcile `biometricId` against `employee_code`.
- Legacy **Firestore** (`cowork_tasks` et al) → `task` + `task_assignment`.
  Expect to **collapse three priority fields** (`priority`,
  `assigneePriorities{}`, `order`) into one `rank`, and two status axes
  (`status` + `completionStatus`) into one — both are recorded in
  `TASK_LOGIC_SPEC.md` §2.2 and §10.1.
- `cowork_emergency_approvals` → `emergency_request` (no document, no
  notifications in legacy — those fields start empty).
- Mail: legacy had **two** systems; `cowork_mails` → `mail_thread`/
  `mail_message` with `transport='internal'`.
- **Do not migrate**: folders, forwarding (removed, D33), `taskTree.routes.js`
  shadow collections.

---

## 7. Business rules that must survive

| Rule | Where it lives |
|---|---|
| Reporting closure = active **primary** lines only; self excluded | `lib/auth/hierarchy.ts` |
| Your rank is set by your manager; exception if you have none | `lib/auth/priority.ts` |
| `official_due_at` moves only on a waived extension | `#extendDeadline` |
| Break credit is clamped by daily allowance, never refuses the break | `lib/tasks/breakMode.ts` |
| Emergency needs the **named** manager; admin cannot bypass | `lib/tasks/emergency.ts` |
| Subtask must claim ≥1 parent requirement; depth 1 | `lib/tasks/completion.ts` |
| Cross-department gate exemption must be **earned** | `createTask` |
| Meeting: seeing ≠ joining | `lib/meetings/access.ts` |
| Mail transport decided by recipients, never by the sender | `lib/mail/transport.ts` |
| Score ledger immutable; reversal not mutation | D26 |
| Reporting relationships time-bounded | D28 |

All are pure functions today. **None needs rewriting — only re-running on the
server.**
