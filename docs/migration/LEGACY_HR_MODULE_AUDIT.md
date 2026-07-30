# Legacy HR Module Audit

Read-only audit of HR functionality across both legacy repositories.

## Scale

**146 endpoints across 17 route files, 14 dedicated models, plus `Employee`.**

HR is not a small adjunct to Cowork — measured in endpoints it is two-thirds the
size of Cowork itself, and `routes/HrRoutes/Attendance_section.js` (260 KB) is
the largest route file in the repository.

**There is no HR frontend in `cowork-old-frontend`.** All 30 pages are Cowork.
The HR UI lives in a client that is not in scope here — so for HR, the legacy
API is the only available specification of behaviour, and the screens are
unknown. Any HR UI built now is new design work, not a port.

## Employee management

| Capability | Where | Present |
|---|---|:--:|
| Create / edit / fetch / search | `HrRoutes/Employee-Section.js` (11) | ✓ |
| Bulk import / export | `employeeImportExport.js` (4, 56 KB) + `employee_import_template.xlsx` | ✓ |
| Activate / deactivate | `Employee.status` (free string) + `Employee.isActive` (boolean) | ⚠️ two fields, one fact |
| Employee ID | `biometricId` — unique sparse. The join key to Cowork | ✓ |
| Password admin | `Passwordmanagement.js` (2) | ✓ |
| Profile | `HrProfile-Section.js` (3), `/api/hr` | ✓ |
| Public profile | `Employee_Routes/publicProfileAPI.js` (1) | ✓ |
| Custom fields | `Employee.workCustomFields[]` | ✓ |

## Organisation structure

| Concept | Legacy | Note |
|---|---|---|
| Department | `HR_Models/Departments.js`, `HrRoutes/Departments.js` (8) | Master table exists |
| Department on employee | `department` (String) **and** `departmentId` (ObjectId) | Two representations, free to disagree |
| Designation | `Employee.designation` | Free string. **Drives band → score maxima** |
| Job title | `jobPosition` ("kept for backward compat") + `jobTitle` | Third and fourth spellings |
| Team | — | No team entity |
| Branch / location | `workLocation` (String, default `"GRAV Clothing"`) | Not an entity |
| Per-department models | 9 collections (`HRDepartment`, `QCDepartment`, `CEODepartment`, `SalesDepartment`, `StoreDepartment`, `CuttingMasterDepartment`, `PackagingDispatchDepartment`, `ProductionSupervisorDepartment`, `ProjectManager`) | **A separate collection per department.** A modelling mistake — do not port |
| Organisation / tenant | **None** | See schema audit |

## Hierarchy

```js
primaryManager:   { managerId → Employee, managerName }
secondaryManager: { managerId → Employee, managerName }
```

Two reporting lines with denormalised names. What legacy does **not** have:

- no constraint against **self-reporting**;
- no constraint against **cycles**;
- no organisation containment check (there is no organisation);
- no closure table — the tree is walked in application code per request;
- no department-head concept;
- no indirect-reports query — derived by repeated traversal.

The new project is already ahead here: `lib/auth/hierarchy.ts` computes
`closureOf()` over **active PRIMARY lines only**, self-excluded, and drives
visibility, monitoring and assignment from it. The required behaviours in the
brief — no circular reporting, no self reporting, manager in the same
organisation, server-side enforcement — are **new requirements with no legacy
equivalent to preserve**, and three of the four are already satisfied in the
domain layer. What is missing is server-side enforcement, which is Phase 3.

## HR workflows

| Workflow | Evidence | Present |
|---|---|:--:|
| Onboarding | `dateOfJoining`, recruitment → employee, import | ⚠️ implicit — no workflow entity |
| Probation / confirmation | `probationPeriod` (months), `confirmationDate` | ⚠️ fields only, no state machine |
| Offboarding | `status`, `isActive` | ⚠️ implicit |
| Transfers | Editing `department` / `departmentId` | ✗ no record of the change |
| Promotions | Editing `designation` | ✗ no record — **and this silently changes the employee's band, and therefore their score maxima** |
| Leave approval chain | `Leave_section.js` (18), `leaveRoutes.js` (15, 88 KB), status `hr_approved`, `withdraw_pending` | ✓ real workflow |
| Overtime approval | `Overtimeroutes.js` (3), `OvertimeReport`, `OvertimeNotificationLog` | ✓ |
| Recruitment | `JobPosting_Section.js` (7), `Candidates_section.js` (2) | ✓ |

**Employment-change history does not exist.** A promotion or transfer is an
in-place field edit. Because designation determines band and band determines
score maxima, **a promotion retroactively changes what past scores meant, with no
record that it happened.** This is a genuine defect to fix rather than port: the
new project should model employment changes as append-only events, consistent
with how it already treats scoring and office-hours versions.

## HR data

| Area | Models | Endpoints |
|---|---|---|
| Attendance | `Attendance`, `Dailyattendance`, `Attendancesettings`, `C4Config` | `Attendance_section.js` (28), `employeeAttendance.js` (3) |
| Biometric source | — | `services/BiometricSyncService.js` — eTimeOffice polling. **Credentials committed, lines 8–10** |
| Attendance derivation | `services/Attendanceengine.js` | punches → attendance days |
| Leave | `LeaveManagement.js` → `LeaveApplication`, `CompanyHoliday` | `Leave_section.js` (18), `leaveRoutes.js` (15) |
| Holidays | `CompanyHoliday` | consumed by the deadline bridge |
| Shifts | `Employee.shift` (String) | ✗ no shift entity |
| Working hours | Firestore `cowork_settings/office` (`inTime`/`outTime`) — **not in HR** | The split below |
| Policy | `Policy` | `policyRoutes.js` (14) |
| Payroll | `Payroll`, `Payrollsettings`, `Salaryconfig`, `utils/salaryEncryption.js` | `Payroll_section.js` (14), `Payslip_section.js` (3) |
| Documents | `Employee` sub-fields | ⚠️ no document entity found |
| Qualifications / experience / skills | — | ✗ **not present** |

Two omissions worth stating plainly: **working hours live in Firestore under
Cowork settings, not in HR**, so HR owns leave and holidays while Cowork owns the
working day — and the new `OfficeHours` model unifies them, which is an
improvement but also means one source now feeds two former owners. And
**qualifications, experience and skills do not exist**; if they are wanted, they
are new product scope.

## HR reports

`Reports_section.js` (4 endpoints, 68 KB), `Overview-Section.js` (5),
`/api/hr/overview`, `Performance_section.js` (2), plus `CEO_Routes/hr.js` (10).
Employee, department and performance reporting exist. **Hierarchy reports were
not found** as a distinct surface.

## The Cowork ↔ HR bridge

One endpoint: `GET /cowork/deadline-availability/blocked-dates`
(`routes/task_routes/deadlineAvailability.routes.js`).

Given `employeeId`, `fromDate`, `days` (≤ 90) it returns dates a deadline must
skip — `CompanyHoliday` for everyone, plus that employee's `LeaveApplication`
rows in `hr_approved` or `withdraw_pending`.

**This is the only place HR data reaches Cowork's deadline maths, and the new
project models only half of it.** `OfficeHours.dayOverrides` covers org-wide
holidays. There is **no per-employee leave input to the office calendar** — so a
deadline can currently be computed straight through somebody's approved leave.

Given the availability ledger just built, the natural home for this is a
`leave` availability kind, or a per-employee overlay on `workingWindowsOn`.
Recorded as a gap; not implemented in Phase 1.

## Permissions

`verifyHRToken` appears 26 times. HR routes use the JWT system, not Firebase —
so **HR authorisation is a separate mechanism from Cowork authorisation**, with a
separate credential. See the auth audit.

## Migration recommendation

**Implement**: employee CRUD + search + deactivate, departments, designations,
hierarchy with the constraints legacy lacked, attendance, leave and holidays,
policies, and the leave→deadline bridge.

**Fix rather than port**: `department`/`departmentId` (choose the ID),
`status`/`isActive` (choose one enum), `jobPosition`/`jobTitle`/`designation`
(choose one), the nine per-department collections (one `Department` row each),
the missing employment-change history, the two-credential split.

**Owner decision required**: payroll, payslips and salary encryption;
recruitment (job postings, candidates); biometric device sync; qualifications /
experience / skills / documents. Each is real, none has a stated requirement in
the new product, and each is a substantial module on its own.
