# Legacy Backend Map

Integration reference for `~/Documents/cowork-old-backend`. Written to be called,
not to be rebuilt. Read-only audit; no legacy file was modified.

Companion: [frontend-map.md](frontend-map.md).

## Framework and topology

Express (CommonJS) + Socket.IO 4.8. One `server.js`, 80 KB, **174 `app.use()`
mounts**, 1454 route handlers.

It is a **multi-product monolith** for a garment manufacturer. Cowork is one
product inside it:

| Group | Endpoints | In scope |
|---|---:|:--:|
| `CMS_Routes/` — manufacturing ERP | 503 | ✗ |
| `Accountant_Routes/` — accounting, Tally, GST | 308 | ✗ |
| `task_routes/` — **Cowork** | 213 | ✓ |
| `HrRoutes/` — **HR** | 146 | ✓ |
| `CEO_Routes/` | 82 | partial |
| `Customer_Routes/`, `Vendor_Routes/`, barcode | 86 | ✗ |
| `Employee_Routes/` — self-service | 46 | ✓ |
| `soproutes/` — **SOP Points** | 25 | ✓ |
| Other | 45 | partial |

**~470 endpoints are Cowork-relevant.** The rest belong to other products and
share only the employee table.

### Mount-order shadowing — read before trusting any file

Six routers mount on the bare `/cowork` prefix (`server.js:1301–1335`). Express
resolves in mount order: **the first declaration of a path wins; later ones are
dead code.**

`routes/task_routes/taskForward.js` mounts first (line 1301) and wins every
shared path. Therefore:

- **`taskTree.routes.js` is 96 KB and 51 endpoints, and is dead** except two
  debug routes. It is the largest file in `task_routes/`. Do not read it as a
  spec — it will give confident, wrong answers.
- Roughly half of `coworkEnhanced.js` is unreachable.

Anything not listed below as reachable should be assumed shadowed until proven
otherwise by mount order.

## Databases

**Two, with no foreign key between them.**

| | MongoDB (Mongoose 8.19) | Firestore (firebase-admin 13.8) |
|---|---|---|
| Holds | `Employee`, all HR, SOP rules + ledger, payroll, accounting, manufacturing | All Cowork operational data (~28 `cowork_*` collections) |
| Models | 51 | none declared |
| Written by | Express only | **Express *and* the browser** |

Joined in application code by string equality:

```
Employee.biometricId  (Mongo)  ===  cowork_employees.employeeId  (Firestore)
```

`Employee.employeeId` is a Mongoose **virtual** (`models/Employee.js:457`) and is
**not queryable**. `timerSop.service.js` documents in its own header that every
lookup by `{ employeeId }` silently returned null until fixed to
`{ biometricId }`. Any new query must use `biometricId`.

**There is no tenant/organisation field** anywhere in Cowork, HR or SOP.
`organizationId` exists only inside the Accountant product.

## Authentication

**Two systems.** A person has two credentials and two identity records.

### Cowork + SOP — Firebase Auth
`Middlewear/coworkAuth.js`, `verifyCoworkToken` (237 uses).

```
Authorization: Bearer <firebase-id-token>
```

1. `auth.verifyIdToken()`.
2. **In-memory cache keyed by uid, 5-minute TTL** — Firestore skipped on hit.
3. Miss → `cowork_employees` by `authUid`, falling back to `email`.
4. Absent + Firebase custom claim `role === "ceo"` → **creates employee `E000`
   on the fly** and grants CEO.
5. Else 403 `"Employee not found in Firestore. Ask your CEO."`

Populates `req.coworkUser = { authUid, employeeId, role, name, employeeData }`.

Caveats for a new client: the cache means **role changes take up to 5 minutes**
and are per-process; email fallback means a reused address inherits an identity.

### HR + self-service — self-issued JWT
`routes/Employee_Routes/login.js`. bcrypt + `jsonwebtoken`. Token read from
cookie `employee_token`, then `Authorization: Bearer`, then a manual cookie
parse. **Default password is the employee's mobile number.**

### Authorisation
Role strings compared inline: `ceo`, `tl`, `employee` (+ `verifyHRToken`).
Middleware counts: `verifyEmployeeToken` 181, `verifyCeoOrTL` 36,
`verifyCeoToken` 30, `verifyHRToken` 26.

**Role checks appear on 92 of ~470 in-scope endpoints.** The rest authenticate
and then trust the caller.

### Unauthenticated endpoints — do not expose from a new UI

| Endpoint | Problem |
|---|---|
| `POST /cowork/task/:taskId/review-completion` | Declared with `verifyCoworkToken, verifyEmployeeToken` but performs **no authorisation check** — any employee can approve/reject any task and fire its C1 score |
| `GET /cowork/task/force-repair-self-assign` | **No middleware.** Full-collection scan-and-write |
| `GET /cowork/task/self-assign-debug/:employeeId` | **No middleware.** Reads any employee |

## Base URL and conventions

Client base: `NEXT_PUBLIC_API_URL`. Cowork paths are mounted under `/cowork`.

Response envelopes are **not consistent** — `{ employees: [...] }`,
`{ success, data }`, `{ error }`, and bare objects all appear. A new API layer
must normalise per endpoint rather than assume a shape.

## Cowork task API — `taskForward.js` (56, all reachable)

### Lifecycle
| Method | Path | Auth |
|---|---|---|
| POST | `/cowork/task/create` | employee |
| POST | `/cowork/task/create-parent` | employee |
| POST | `/cowork/task/:taskId/confirm` | employee |
| POST | `/cowork/task/:taskId/start` | employee |
| POST | `/cowork/task/:taskId/approve` | employee |
| POST | `/cowork/task/:taskId/submit-completion` | employee |
| POST | `/cowork/task/:taskId/review-completion` | employee — **no authz** |
| POST | `/cowork/task/:taskId/ceo-review` | **CEO** |
| POST | `/cowork/task/:taskId/rework` | employee |
| POST | `/cowork/task/:taskId/reset-to-draft` | employee |
| DELETE | `/cowork/task/:taskId` | employee |
| PATCH | `/cowork/task/:taskId/edit-details` | employee |
| PATCH | `/cowork/task/:taskId/parent-progress` | employee |

`POST /task/create` body (verbatim from the destructure):

```
title, description, notes, requirements, assigneeIds, priority,
parentTaskId, groupId, createdByTl, isFolder, isRepeat, repeatConfig,
isThirdParty, thirdPartyConfig, isGoal, goalConfig, hasTimer,
fixedDeadline, isSelfAssigned, visibleTo, approverId, approverName,
senderTimerWindowSecs, isGoldTask, c2Config, etcHours
```

26 fields on one endpoint — every task variant (folder, repeat, third-party,
goal, self-assigned, gold) is a flag on the same call. Note `isFolder` and
`forward`, both **removed from the new product by decision D33**.

### Deadline negotiation
| Method | Path | Auth |
|---|---|---|
| POST | `/cowork/task/:taskId/propose-deadline` | employee |
| POST | `/cowork/task/:taskId/approve-deadline` | employee |
| POST | `/cowork/task/:taskId/tl-counter-deadline` | employee |
| POST | `/cowork/task/:taskId/respond-tl-counter` | employee |
| POST | `/cowork/task/:taskId/request-deadline-extension` | employee |
| POST | `/cowork/task/:taskId/review-deadline-extension` | employee |
| POST | `/cowork/task/:taskId/approve-sender-timer` | employee |
| POST | `/cowork/task/:taskId/reject-sender-timer` | employee |
| POST | `/cowork/task/:taskId/extension-deduction` | employee |
| PATCH | `/cowork/task/:taskId/deadline` | **CEO** |

Two parallel extension mechanisms (`propose-deadline` — creator approves; and
`request-deadline-extension` — any manager approves) writing different fields.

### Subtasks, forwarding, folders
`POST /task/:taskId/subtask`, `POST /task/:taskId/forward`,
`GET /task/:taskId/forward-budget`, `POST /task/:taskId/move-to-folder`.
**Forwarding and folders are removed from the new product (D33).**

### Variants
Repeat: `/repeat-confirm`, `/repeat-submit`. Third-party: `/third-party-update`,
`/third-party-complete`, `/third-party-payment-action`. Goal: `/goal-update`,
`GET|POST /goal-activities`, `/goal-activity/:activityId/request-report`,
`/submit-report`. Self-assign: `/self-assign-approve`, `/self-assign-repair`.
Department: `/department-approve`, `/department-tl-set-hours`.

### Reads, chat, reports
`GET /task/:taskId/details`, `/full`, `/chat`, `/daily-reports`,
`/task/list-hierarchy`; `POST /task/:taskId/chat`, `/thread-message`,
`/daily-report`, `GET|POST /task/:taskId/draft-chat`.
`POST /task/p1-conflict-check` — priority-1 conflict detection.

## Cowork core — `cowork.js` (45, partially shadowed)

### Identity
`GET /cowork/me` → `{ authUid, employeeId, role, name, tempPassword, passwordChanged }`
— the session bootstrap call.
`POST /cowork/change-password`, `POST /cowork/change-email` (CEO),
`POST /cowork/setup/seed-ceo` (**no auth**).

### Employees
| Method | Path | Auth |
|---|---|---|
| GET | `/cowork/employee/list` | CEO or TL → `{ employees: [...] }` |
| GET | `/cowork/employee/list-members` | employee |
| GET | `/cowork/employee/:id` | employee |
| GET | `/cowork/employee/my-managers/:employeeId` | employee — **the hierarchy call** |
| GET | `/cowork/employee/biometric-ids` | CEO or TL |
| POST | `/cowork/employee/create` | CEO or TL |
| PATCH | `/cowork/employee/:id/update-id` | CEO or TL |
| DELETE | `/cowork/employee/:id` | CEO or TL |
| POST | `/cowork/employee/:id/reset-password` | CEO or TL |
| POST | `/cowork/employee/:employeeId/change-role` | **authenticated only — no role check** |
| POST | `/cowork/employee/:employeeId/change-department` | **authenticated only — no role check** |
| POST | `/cowork/employee/fcm-token` | employee |

`change-role` and `change-department` carry `verifyCoworkToken` and no
authorisation. **Privilege escalation** — any employee can change any role.

### Groups, messaging, meetings
`POST /group/create` (CEO/TL), `GET /group/list`, `GET /group/:groupId`,
`PATCH|DELETE /group/:groupId` (CEO), `POST|DELETE /group/:groupId/members`,
`GET /group/:groupId/members`, `POST /group/:groupId/message`,
`GET /group/:groupId/messages`, `POST /direct-message/send`,
`GET /direct-message/conversations`, `GET /direct-message/:convId/messages`,
`POST /direct-message/notify`, `POST /group/:groupId/notify`.
Meetings: `POST /schedule-meet/create` (CEO/TL), `GET /schedule-meet/list`,
`GET /schedule-meet/:meetId`, `PATCH /schedule-meet/:meetId/edit|cancel`.

### Notifications, scheduling
`GET /cowork/notifications`, `PATCH /cowork/notifications/read-all`,
`POST /cowork/notify-request-response`,
`GET /cowork/scheduling/blocked-dates`.

## Scoring

| Method | Path | Auth |
|---|---|---|
| GET | `/cowork/pmp/:employeeId/dashboard?quarter&year` | employee (TL scoped by department) |
| GET | `/cowork/pmp/:employeeId/c1`, `/c2` | employee |
| GET | `/cowork/pmp/employees` | employee |
| GET | `/cowork/c1/config` | employee |
| GET | `/cowork/c1/scores/:employeeId` | employee |
| GET | `/cowork/c1/scores` | CEO or TL |
| POST | `/cowork/c1/preview` | CEO or TL |
| GET | `/cowork/c2/config`, `/c2/gold-tasks`, `/c2/scores` | employee / CEO-TL |
| GET | `/cowork/workload/summary` | CEO or TL |
| GET | `/cowork/workload/employee/:employeeId/calendar` | CEO or TL |

Backed by `services/pmpService.js` and `c1Service.js`. Quarter/year are query
parameters, defaulting to current. The authoritative spec `CW-DEV-PMP-01 v1.0`
is cited throughout `pmpService.js` and **is in neither repository**.

## SOP Points — `soproutes/` (25)

Full behavioural analysis in
[`docs/migration/SOP_POINTS_AUDIT.md`](../migration/SOP_POINTS_AUDIT.md).

| Method | Path | Auth |
|---|---|---|
| GET/POST | `/cowork/sop/folders` | employee / CEO-TL |
| DELETE | `/cowork/sop/folders/:id` | CEO or TL |
| GET | `/cowork/sop/`, `/all-categories` | employee |
| POST | `/cowork/sop/` | CEO or TL |
| PATCH/DELETE | `/cowork/sop/:id` | CEO or TL |
| PATCH | `/cowork/sop/:id/approve`, `/reject` | **CEO only** |
| POST | `/cowork/sop/bleach` | CEO or TL |
| GET | `/cowork/sop/bleach/:employeeId` | employee — **appears unscoped** |
| POST/PATCH | `/cowork/sop/bleach/:employeeId/:bleachId/recheck` | employee / CEO-TL |
| GET | `/cowork/sop/recheck/pending-list`, `/pending-count` | CEO or TL |
| GET/POST | `/cowork/sop/task-suggestions`, `/dismiss` | CEO or TL |
| POST | `/cowork/sop/goal-credit` | CEO or TL |
| POST | `/cowork/sop/settings/sync` | CEO |
| GET | `/cowork/sop/performance-summary` | CEO |
| GET/POST | `/cowork/band-config` | employee / CEO |
| GET | `/cowork/band-config/designations`, `/employee-bands` | CEO |

`POST /bleach` body: `{ targetEmployeeId, sopId?, description?, manualPoints?,
manualSopName? }`. Refuses a non-approved SOP. **A TL may only bleach within
their own department**; CEO is unrestricted.

**Vocabulary warning:** `bleachType: "credit"` means a **violation**; `"debit"`
means a reward. `isCredit: true` maps to `"debit"`. Any UI must not surface
these words.

## Timer-derived SOP
`POST /cowork/timer-sop/evaluate`, `GET /cowork/timer-sop/accum/:employeeId`,
`POST /cowork/timer-sop/test-finalize/:employeeId` (CEO).
Engine: `services/timerSop.service.js`, thresholds in Firestore
`cowork_sop_settings/task_events`. Idle deficit → C3 penalty; overtime → C4
**reward** (`"Overtime Reward"`).

## The Cowork ↔ HR bridge

`GET /cowork/deadline-availability/blocked-dates?employeeId&fromDate&days`
(≤ 90 days). Returns `CompanyHoliday` rows (everyone) plus that employee's
`LeaveApplication` rows in `hr_approved` or `withdraw_pending`.

**The only place HR data reaches Cowork's deadline maths.**

## HR API (146)

Mount prefixes are inconsistent — `/api/hr/*`, `/hr/*`, `/api/employees/*`,
`/api/employee/*` all coexist, and `/hr/attendance` vs `/api/employee/attendance`
are different routers over the same data.

| Area | Mount | Eps |
|---|---|---:|
| Attendance | `/hr/attendance`, `/api/employee/attendance` | 31 |
| Leave | `/api/hr/leaves`, `/api/employee/leave-applications` | 33 |
| Policy | `/api/hr/policy` | 14 |
| Payroll / payslip | `/api/hr/payroll`, `/api/hr/payslip` | 17 |
| Employees | `/api/employees`, `/api/hr` | 14 |
| Departments | `/api/hr/departments` | 8 |
| Recruitment | `/api/hr/job-postings`, `/api/hr/candidates` | 9 |
| Overview / reports | `/api/hr/overview`, `/hr/reports`, `/hr/performance` | 11 |
| Import/export | `/api/employees/import-export` | 4 |
| Passwords | `/api/hr/password-management` | 2 |
| SOP (HR side) | `/api/hr/sop` | 10 |

**There is no HR frontend in `cowork-old-frontend`** — all 30 pages are Cowork.
For HR, the API is the only available specification and any HR UI is new design
work.

## Key services

| Service | Role |
|---|---|
| `pmpService.js` | C1–C4 aggregation. Cites `CW-DEV-PMP-01 v1.0` |
| `c1Service.js` | Task-execution scoring; writes into `Employee.sopPoints` |
| `timerSop.service.js` | Day-by-day deficit/overtime finalisation with a `lastFinalizedDate` watermark |
| `Attendanceengine.js` | Punches → attendance days |
| `BiometricSyncService.js` | eTimeOffice polling. **Credentials committed at lines 8–10 — rotate** |
| `cowork.service.js`, `taskForward.service.js` | Cowork data access |
| `NotificationService.js`, `fcmPush.service.js`, `sendWebPush.js`, `sendExpoPush.js` | Three push channels |
| `mediaUpload.service.js` + `utils/cloudinary.js` | Attachments |

## Entities and relationships

```
Employee (Mongo, key = biometricId)
  ├─ primaryManager.managerId   → Employee     (no cycle/self constraint)
  ├─ secondaryManager.managerId → Employee
  ├─ departmentId → Department  (+ duplicate `department` string)
  ├─ designation  → BandConfig.bands[].designations → c1Max..c4Max
  └─ sopPoints[] → { year, totalDeducted, bleaches[] → Sop | Policy }

Sop → SopFolder            (department-scoped, approval-gated)
LeaveApplication → Employee
CompanyHoliday             (global)
Attendance / Dailyattendance → Employee

  ═══ string join on biometricId ═══

cowork_employees (Firestore)  ← authUid ← Firebase Auth
cowork_tasks
  ├─ cowork_task_timers, cowork_timer_events, cowork_work_commits
  └─ cowork_requests
cowork_duty_status, cowork_emergency_approvals, cowork_goal_status
cowork_settings/office  (inTime / outTime)
cowork_sop_settings/task_events  (thresholds)
```

## What a new client must know

1. **Most Cowork data is not behind HTTP.** See [frontend-map.md](frontend-map.md)
   — the legacy UI performs 151 direct Firestore writes. There is no REST
   equivalent for timers, priority, duty status or presence.
2. **Firebase Auth is required**, not optional — `verifyCoworkToken` accepts only
   Firebase ID tokens, so a client must run the Firebase SDK to obtain one.
3. **Firestore security rules are in neither repository.** They are the real
   permission boundary for everything the browser writes, and their absence is a
   blocking unknown for any claim about what is permitted.
4. **Response shapes vary per endpoint.** Normalise at the API-layer boundary.
5. **Query by `biometricId`, never `employeeId`.**
6. **Three endpoints have no authorisation**, and `change-role` /
   `change-department` are open to any authenticated employee.
