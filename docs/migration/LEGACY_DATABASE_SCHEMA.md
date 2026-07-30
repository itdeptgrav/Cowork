# Legacy Database and Schema Audit

Read-only audit of both legacy repositories.

## Two databases, one product, no foreign key between them

| | MongoDB (Mongoose 8.19) | Firestore (firebase-admin 13.8) |
|---|---|---|
| Holds | Employees, HR, SOP, payroll, accounting, manufacturing | All Cowork operational data |
| Models | **51 Mongoose models** | ~28 `cowork_*` collections |
| Written by | Express API only | **Browser (151 writes) and API** |
| Schema | Declared, indexed | Implicit |
| Transactions | Available, largely unused | Per-document only |
| Tenant field | Only in the Accountant product | None |

The two are joined **in application code, by string equality**:

```
Employee.biometricId  (Mongo)  ===  cowork_employees.employeeId  (Firestore)
```

`Employee.employeeId` is a Mongoose **virtual** mapped to `biometricId`
(`models/Employee.js:457`). A virtual is not queryable — and
`timerSop.service.js` documents in its own header that every lookup by
`{ employeeId }` silently returned null until it was fixed to
`{ biometricId: employeeId }`. **The join key is a documented source of
production bugs.** In the new schema this must be one real column with a real
constraint.

## There is no tenant concept

Searched both repositories:

| Field | Backend files | Frontend files |
|---|---:|---:|
| `organizationId` | 27 | 0 |
| `companyId` | 35 | 0 |
| `orgId` | 4 | 0 |
| `organisationId`, `tenantId`, `branchId` | 0 | 0 |

Every hit is inside `models/Accountant_model/` and `routes/Accountant_Routes/`
— the accounting product, which is genuinely multi-tenant
(`accountantUserSchema.index({ organizationId: 1, email: 1 }, { unique: true })`).

**Cowork, HR and SOP are single-tenant.** One company, one implicit
organisation, no scoping field anywhere.

Consequence for the migration, and it is a good one: `organisationId` in the new
project is **net-new architecture with no legacy data to reconcile**. There is no
risk of importing rows whose tenant is ambiguous, because there are no tenants.
The importer synthesises exactly one organisation and stamps every row with it.
The two-tenant isolation tests still outstanding in Phase 1 checkpoint 3 will be
testing a property legacy never had.

## Employee — the central entity

`models/Employee.js`, 20 KB. The join point between both databases and every
module.

### Identity
`biometricId` (unique, sparse — **the real key**), `email` (unique, sparse),
`password` (bcrypt), `temporaryPassword`, virtual `employeeId` → `biometricId`.

### Organisation placement
`department` (string) **and** `departmentId` (ObjectId → `Department`) — two
representations of one fact, free to disagree. `designation`, `jobPosition`
("kept for backward compat"), `jobTitle`, `workLocation`, `shift`.

### Hierarchy
```js
primaryManager:   { managerId: ObjectId → Employee, managerName: String }
secondaryManager: { managerId: ObjectId → Employee, managerName: String }
```

Two lines, denormalised names, **no constraint against cycles or
self-reporting**, and no closure table — the tree is walked in application code
each time.

This maps cleanly onto the new project, which already models PRIMARY and
SECONDARY lines and computes `closureOf()` over **active PRIMARY lines only**.
That decision matches legacy's effective behaviour.

### Lifecycle
`dateOfJoining`, `confirmationDate`, `probationPeriod` (months),
`employmentType` (`full_time | part_time | contract | intern | ""`),
`status` (free string, default `"active"`) **and** `isActive` (boolean) — again
two fields for one fact.

### Scoring
`sopPoints[]` — the per-year point ledger. Fully described in
[SOP_POINTS_AUDIT.md](SOP_POINTS_AUDIT.md).

### Extensibility
`workCustomFields[]` — user-defined fields.

### Indexes
`{ biometricId: 1 }` unique sparse, `{ email: 1 }` unique sparse.

## HR models (`models/HR_Models/`, 14)

| Model | Holds |
|---|---|
| `Attendance` | Attendance records |
| `Dailyattendance` | Per-day rollup |
| `Attendancesettings` | Grace, half-day, rounding |
| `LeaveManagement` | Exports `LeaveApplication` **and** `CompanyHoliday` |
| `Departments` | Department master |
| `Policy` | Compliance policies → SOP bleaches |
| `C4Config` | C4 attendance-scoring configuration |
| `Payroll`, `Payrollsettings` | Payroll |
| `OvertimeReport`, `OvertimeNotificationLog` | Overtime |
| `JobPosting`, `Candidates` | Recruitment |
| `EmployeeTask` | HR-assigned tasks — **distinct from Cowork tasks** |

`LeaveApplication.status` includes `hr_approved` and `withdraw_pending`; both
block deadlines via the availability bridge.

Also at top level: `BandConfig` (scoring bands), `Salaryconfig`, `Appversion`,
plus nine per-department models (`HRDepartment`, `QCDepartment`, `CEODepartment`,
`SalesDepartment`, `StoreDepartment`, `CuttingMasterDepartment`,
`PackagingDispatchDepartment`, `ProductionSupervisorDepartment`,
`ProjectManager`) — a **separate collection per department**, which is a
modelling mistake, not a requirement. The new `Department` row covers it.

## Firestore — Cowork operational data

No declared schema. Shape below is from usage.

| Collection | Role |
|---|---|
| `cowork_tasks` | The task document. Legacy carried ~25 deadline-related fields on it |
| `cowork_task_timers`, `cowork_timer_events`, `cowork_work_commits` | Timer and committed work |
| `cowork_employees` | Cowork-side employee mirror (`employeeId`, `authUid`, `role`, `department`) |
| `cowork_requests` | Assignment / deadline / extension requests |
| `cowork_duty_status` | Presence, break (`breakStartedAtMs`), emergency |
| `cowork_emergency_approvals` | Emergency approvals |
| `cowork_goal_status` | C2 goal state |
| `cowork_settings` | Office hours, break allowance. Doc `office` holds `inTime`/`outTime` |
| `cowork_sop_settings`, `cowork_sop_applied` | SOP thresholds and applied records |
| `cowork_notifications`, `cowork_notes`, `cowork_mails` | |
| `cowork_direct_messages`, `cowork_conversations`, `cowork_groups` | Messaging |
| `cowork_scheduled_meets`, `cowork_meeting_participants`, `cowork_audio`, `cowork_guest_sessions`, `cowork_join_codes` | Meetings |
| `cowork_fcm_tokens`, `cowork_meta`, `cowork_default` | |

### Two parallel state axes

Tasks carry both `status` and `completionStatus`, maintained independently.
Established in the earlier audit; unchanged. The new project collapses these into
one `status` plus explicit workflow records, and that collapse is a **migration
transform requiring per-row rules**, not a rename.

## Audit fields and timestamps

Mongoose models use `{ timestamps: true }` — `createdAt` / `updatedAt` only. No
`createdBy` / `updatedBy` as a convention; SOP carries `createdBy`,
`approvedBy`, and each bleach carries `cutBy`. Firestore documents timestamp
inconsistently. **There is no general audit trail** — which is why the new
project's append-only event logs are an addition, not a port.

## Migration risks from the schema alone

1. **Dual-write, no transaction.** Creating an employee writes Mongo *and*
   Firestore from the client (`/coworking/create-employee`). Any partial failure
   leaves a person who exists in one store and not the other. Expect orphans on
   both sides; the importer must report them, never guess.
2. **String join key with no constraint.** Expect Firestore `employeeId` values
   with no matching `biometricId`.
3. **Duplicated facts.** `department`/`departmentId`, `status`/`isActive`,
   `jobPosition`/`designation`/`jobTitle`. Each needs a documented winner.
4. **No schema on the Cowork side.** Field presence must be validated from data,
   not from a model file.
5. **Firestore security rules are absent from both repos** — the actual
   permission boundary is unknown. Blocking for any claim about what legacy
   allowed.
6. **`status` is a free string.** Its real domain must be read from production
   data before an enum is chosen.
