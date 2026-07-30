# Legacy API Inventory

Audit of `~/Documents/cowork-old-backend`. Read-only; no code was changed.

## Method and confidence

Endpoints were enumerated mechanically across every file under `routes/` plus
`server.js`, by matching `router.<method>("<path>")`. That count is complete.

Detail — request body, permissions, models, consumers — was then written for the
**Cowork-relevant subset**, and only for it. This document says so explicitly
rather than implying uniform depth: 811 of the 1454 endpoints belong to products
that are not Cowork, and describing them to the same depth would be a month of
work with no bearing on the migration.

Where a claim is inferred rather than read, it is marked **(inferred)**.

## The headline finding: this is not a Cowork backend

`cowork-old-backend` is a **multi-product monolith** for a garment manufacturer
(GRAV Clothing). Cowork is one of roughly eight products inside it, and not the
largest. 174 `app.use()` mounts in a single 80 KB `server.js`.

| Route group | Endpoints | Product | In scope |
|---|---:|---|:--:|
| `CMS_Routes/` | 503 | Manufacturing ERP — production, cutting, packaging, inventory, work orders, quotations, measurement | ✗ |
| `Accountant_Routes/` | 308 | Accounting suite — Tally import, GST/GSTR-2B, vouchers, bank recon, payroll, e-way bills | ✗ |
| `task_routes/` | 213 | **Cowork** | ✓ |
| `HrRoutes/` | 146 | **HR** | ✓ |
| `CEO_Routes/` | 82 | Executive dashboards across all products | partial |
| `Customer_Routes/` | 55 | Customer portal | ✗ |
| `Employee_Routes/` | 46 | **Employee self-service** — login, leave, attendance, payslip, overtime | ✓ |
| `googleWorkspaceRoutes.js` | 41 | Google Workspace admin | partial |
| `Vendor_Routes/` | 26 | Vendor portal | ✗ |
| `soproutes/` | 25 | **SOP Points + band config** | ✓ |
| `Barcode_Scan_Punchings/` | 5 | Shop-floor scanners | ✗ |
| `login.js`, `googleTasksRoutes.js` | 4 | Auth, Google Tasks | ✓ |
| **Total** | **1454** | | **~470 in scope** |

**This is a scoping decision the owner has to make, not one I can make.** If
Cowork is to remain a standalone product, ~1000 endpoints are out of scope and
the migration is tractable. If the intent is to replace the whole ERP, this is a
different and far larger programme. Everything below assumes the former.

## Route reachability — read this before treating any file as a spec

Six files mount on the bare `/cowork` prefix (`server.js:1301–1335`). Express
resolves in mount order, so **the first file to declare a path wins and later
declarations of the same path are dead code**.

`routes/task_routes/taskForward.js` mounts first (`server.js:1301`) and wins
every shared path. Consequences established in the earlier audit and re-confirmed
here:

- `taskTree.routes.js` is 96 KB and 51 endpoints, and is **dead except two debug
  endpoints**. It is the largest single file in `task_routes/`. Reading it as a
  behavioural spec produces confident, wrong answers.
- Roughly half of `coworkEnhanced.js` is unreachable for the same reason.

Any endpoint below marked **(shadowed)** is declared but never executes.

## Cowork core — `routes/task_routes/` (213)

| File | Eps | Reachable | Purpose |
|---|---:|:--:|---|
| `taskForward.js` | 56 | ✓ all | The real task API — create, assign, accept/reject, submit, review, deadline negotiation, comments |
| `taskTree.routes.js` | 51 | ✗ 2 of 51 | Dead. Subtask tree — superseded |
| `cowork.js` | 45 | partial | Employees, groups, notifications, settings |
| `googleWorkspaceRoutes.js` | 26 | ✓ | Workspace directory sync |
| `coworkEnhanced.js` | 12 | ~50% | Overflow from `cowork.js`; heavily shadowed |
| `pmpRoutes.js` | 4 | ✓ | Performance score read API (C1–C4 aggregate) |
| `c1Routes.js` | 4 | ✓ | C1 task-execution scoring |
| `c2Band.routes.js` | 3 | ✓ | C2 goal attainment |
| `timerSop.routes.js` | 3 | ✓ | Timer-derived SOP evaluation |
| `workloadroutes.js` | 2 | ✓ | Workload/flow dashboard |
| `livekit.routes.js` | 2 | ✓ | LiveKit token minting |
| `meetingSummary.routes.js` | 2 | ✓ | Meeting summaries |
| `audioRecording.routes.js` | 1 | ✓ | Audio capture (socket-bound) |
| `mediaUpload.js` | 1 | ✓ | Attachment upload |
| `deadlineAvailability.routes.js` | 1 | ✓ | **Cowork↔HR bridge** — see below |

### `GET /cowork/deadline-availability/blocked-dates`

Small and easy to miss, and it is the only place the two halves of the product
meet. Given `employeeId`, `fromDate`, `days` (capped at 90) it returns the dates
a deadline must skip: **company holidays** (`CompanyHoliday`, everyone) plus
**that employee's HR-approved leave** (`LeaveApplication` where status is
`hr_approved` or `withdraw_pending`).

Two things follow.

The comment `// CoWork's employeeId IS the HR biometricId` marks the join between
the Firestore world and the Mongo world. It is a string-to-ObjectId bridge
performed in application code, with no constraint enforcing it.

More importantly: **deadlines are blocked per-employee by approved leave, not
only by org-wide holidays.** The new `OfficeHours.dayOverrides` models the
org-wide half and has no per-person equivalent. Named again in the gap analysis.

### Endpoints with no authorisation at all

Re-confirmed from the earlier audit and load-bearing for the rebuild:

| Endpoint | Problem |
|---|---|
| `POST /cowork/task/:id/review-completion` | **No authorisation check whatsoever.** Any authenticated employee can approve or reject any task and fire its C1 score |
| `POST /cowork/force-repair-self-assign` | **No auth middleware.** Full-collection scan-and-write |
| `GET /cowork/self-assign-debug/:employeeId` | **No auth middleware** |

These are not to be ported. They are listed so the rebuild can assert the
opposite behaviour deliberately.

## HR — `routes/HrRoutes/` (146)

| File | Eps | Purpose |
|---|---:|---|
| `Attendance_section.js` | 28 | 260 KB — the largest route file in the repo. Attendance records, corrections, reports |
| `Leave_section.js` | 18 | Leave applications, approval chain, balances |
| `policyRoutes.js` | 14 | Compliance policies → SOP bleaches |
| `Payroll_section.js` | 14 | Payroll runs, salary structure |
| `Employee-Section.js` | 11 | Employee CRUD |
| `hrSopRoutes.js` | 10 | HR-side SOP administration |
| `Departments.js` | 8 | Department CRUD |
| `JobPosting_Section.js` | 7 | Recruitment |
| `EmployeeTasks_section.js` | 7 | HR-assigned tasks (distinct from Cowork tasks) |
| `Overview-Section.js` | 5 | HR dashboard |
| `Reports_section.js` | 4 | 68 KB — HR reporting |
| `employeeImportExport.js` | 4 | 56 KB — bulk employee import (XLSX) |
| `Appversionroutes.js` | 4 | Mobile app version gate |
| `Payslip_section.js`, `HrProfile-Section.js` | 6 | Payslips, HR profile |
| `Performance_section.js` | 2 | Performance |
| `Passwordmanagement.js` | 2 | Admin password reset |
| `Candidates_section.js` | 2 | Candidate pipeline |

Mount prefixes are inconsistent — `/api/hr/*`, `/hr/*`, `/api/employees/*` and
`/api/employee/*` all coexist, with `/hr/attendance` and `/api/employee/attendance`
being different routers over the same data. Not worth reproducing.

## Employee self-service — `routes/Employee_Routes/` (46)

`leaveRoutes.js` (15, 88 KB), `employeeAuth.js` (7), `login.js` (5),
`TasksEmployee.js` (5), `pushToken.js` (4), `Overtimeroutes.js` (3),
`Payslip.js` (3), `employeeAttendance.js` (3), `publicProfileAPI.js` (1).

## SOP — `routes/soproutes/` (25)

Documented in full in [SOP_POINTS_AUDIT.md](SOP_POINTS_AUDIT.md).
`soproute.js` (21) + `bandConfig.routes.js` (4).

## Background work, sockets, integrations

| Kind | Where | Note |
|---|---|---|
| Cron / scheduler | `services/accountantBackupScheduler.js` | Accounting backup — out of scope |
| Biometric sync | `services/BiometricSyncService.js` | eTimeOffice device polling → attendance. **Credentials committed at lines 8–10 — rotate regardless of migration** |
| Attendance engine | `services/Attendanceengine.js` | Derives attendance days from punches |
| Timer→SOP engine | `services/timerSop.service.js` | Runs after every work commit; see SOP audit |
| Scoring | `services/pmpService.js`, `c1Service.js` | C1–C4 computation |
| Sockets | `config/socketInstance.js`, `ProductionScheduleSocketService.js`, `audioRecording.routes.js` | Socket.IO 4.8 |
| Push | `fcmPush.service.js`, `sendWebPush.js`, `sendExpoPush.js` | Three push channels |
| Email | `emailService.js`, `emailNotifications.service.js`, `leaveNotification.service.js` | |
| Media | `mediaUpload.service.js`, `utils/cloudinary.js` | Cloudinary |
| Google | `googleTasksService.js`, `googleWorkspaceRoutes.js` | |

## What is required in the new system

**Port the behaviour of** — task lifecycle (`taskForward.js`), scoring
(`pmpService`, `c1Service`), SOP points, band config, HR employee/department/
hierarchy, attendance, leave, the deadline-availability bridge.

**Do not port** — CMS, Accountant, Customer, Vendor, Barcode, production and
QC routes; `taskTree.routes.js`; the three unauthenticated endpoints; the
mount-order shadowing; the committed credentials.

**Undecided, needs the owner** — payroll and payslips, recruitment (job postings,
candidates), Google Workspace sync, the three push channels. Each is real
functionality with no equivalent in the new product and no stated requirement.
