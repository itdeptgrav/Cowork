# Legacy System Map

**The operational reference for the adapter layer.** Everything the new UI needs
to read or write, and where it actually lives.

Scope: `~/Documents/cowork-old-backend`, `~/Documents/cowork-old-frontend`.
Read-only — no legacy file has been modified.

Architecture decision in force:

```
New Cowork UI  →  lib/legacy/*  →  new API route (proxy)  →  Firestore / Express
```

Components never touch Firebase directly. The adapter is thin: it moves data, it
does not own rules. **Business logic stays where it is.**

Deeper analyses: [`docs/legacy/backend-map.md`](legacy/backend-map.md),
[`docs/legacy/frontend-map.md`](legacy/frontend-map.md),
[`docs/migration/SOP_POINTS_AUDIT.md`](migration/SOP_POINTS_AUDIT.md).

---

## 1. Firestore collections

Names are frozen. Do not rename, restructure or migrate.

| Collection | Shape | Written by |
|---|---|---|
| `cowork_tasks` | Flat task documents | **Browser** + API |
| `cowork_task_timers` | `/{employeeId}/sessions/{taskId}` — **subcollection** | **Browser only** |
| `cowork_timer_events` | Timer event log | Browser + API |
| `cowork_work_commits` | Committed work | Browser + API |
| `cowork_duty_status` | `/{employeeId}` — presence, break, emergency | **Browser only** |
| `cowork_emergency_approvals` | Emergency approvals | Browser |
| `cowork_employees` | Cowork identity mirror | Browser + API |
| `cowork_requests` | Assignment / deadline requests | Browser |
| `cowork_notifications` | Per-recipient | Browser (read) + API (write) |
| `cowork_settings` | Doc `office` → `inTime`/`outTime`; break allowance | Browser + API |
| `cowork_sop_settings` | Doc `task_events` → timer thresholds | API |
| `cowork_sop_applied` | Applied SOP records | API |
| `cowork_direct_messages`, `cowork_conversations` | Messaging | Browser + API |
| `cowork_groups` | Groups | Browser + API |
| `cowork_mails` | Internal mail | Browser |
| `cowork_notes` | Notes | Browser |
| `cowork_goal_status` | C2 goal state | Browser |
| `cowork_scheduled_meets`, `cowork_meeting_participants`, `cowork_audio`, `cowork_guest_sessions`, `cowork_join_codes` | Meetings | Browser + API |
| `cowork_fcm_tokens`, `cowork_meta`, `cowork_default` | Infrastructure | API |
| `cowork_login_toast`, `cowork_logout_toast` | Cross-page toast messages — **do not port** | Browser |

### Key document shapes

**`cowork_task_timers/{employeeId}/sessions/{taskId}`** — note the subcollection
path; a flat query will not find these.
```
taskId, employeeId, startedAt, updatedAt,
baseSecs, anchorBaseSecs, totalSecs, totalSeconds,
windowSecs, winSecs, newTotalWindowSecs, addedSecs, lastExtensionSecs,
displaySecs, displaySeconds, activeId, activeTaskId
```

**`cowork_duty_status/{employeeId}`** — the richest browser-written document.
```
status, prevMode, targetMode, startedAt, createdAt, updatedAt,
sessionSecs, totalSeconds, workedTodaySeconds,
latenessMs, officeOpenMs, istMidnightUtcMs, istTimeMs,
breakStartedAtMs, breakSessionSecs, breakElapsedSeconds, breakRemainingSeconds,
dailyBreakSeconds, maxBreakSecs, breakIncrementSecs,
breakGapStoredMs, breakGapAppliedMs, pendingBreakGapMs, directBreakAppliedMs,
emergencyStartedAtMs, emergencyGapStoredMs, emergencyGapAppliedMs,
pendingEmergencyGapMs, directEmergencyGapMs,
lastDeadlineShiftMs, shiftMs, appliedSecs, dueMs, pendingMs, sinceMs
```

**Read this document carefully before Phase 5.** Legacy already implements the
availability-delta concept: `latenessMs` is late login; `breakGapAppliedMs` and
`emergencyGapAppliedMs` are applied deltas held separately from the *stored*
gaps; `pendingBreakGapMs` is un-applied; `lastDeadlineShiftMs` is an idempotency
watermark. The vocabulary differs from the new `availabilityDelta` work but the
model is the same one. **Extend this, do not duplicate it.**

**`cowork_tasks/{taskId}`** — ~25 deadline-related fields plus the two state
axes (§6). Priority is a plain numeric `priority` field.

---

## 2. API endpoints

Base `NEXT_PUBLIC_API_URL`, Cowork mounted at `/cowork`.
**Response envelopes are inconsistent** — `{employees}`, `{success,data}`,
`{error}`, and bare objects all occur. Normalise in the adapter, per endpoint.

**Mount-order shadowing:** six routers mount on bare `/cowork`; the first
declaration of a path wins. `taskForward.js` (`server.js:1301`) wins everything.
**`taskTree.routes.js` — 96 KB, 51 endpoints — is dead** except two debug routes,
and the legacy client still calls several of its paths. Verify against live
traffic before reproducing any call.

### Identity
`GET /cowork/me` → `{ authUid, employeeId, role, name, tempPassword, passwordChanged }`
· `POST /cowork/change-password` · `POST /cowork/change-email` (CEO)

### Employees / hierarchy
`GET /cowork/employee/list` (CEO/TL) → `{ employees: [...] }` ·
`GET /cowork/employee/list-members` · `GET /cowork/employee/:id` ·
`GET /cowork/employee/my-managers/:employeeId` — **the hierarchy call** ·
`GET /cowork/employee/biometric-ids` · `POST /cowork/employee/create` ·
`PATCH /cowork/employee/:id/update-id` · `DELETE /cowork/employee/:id` ·
`POST /cowork/employee/:id/reset-password` ·
`POST /cowork/employee/:employeeId/change-role` ·
`POST /cowork/employee/:employeeId/change-department`

⚠ The last two carry authentication only — **no role check**. Any employee can
change any role. The adapter must gate them.

### Tasks — `taskForward.js` (all reachable)
Lifecycle: `POST /cowork/task/create` · `/create-parent` · `/:id/confirm` ·
`/:id/start` · `/:id/approve` · `/:id/submit-completion` · `/:id/review-completion` ·
`/:id/ceo-review` (CEO) · `/:id/rework` · `/:id/reset-to-draft` ·
`DELETE /cowork/task/:id` · `PATCH /:id/edit-details` · `PATCH /:id/parent-progress`

`POST /task/create` body — 26 fields, one endpoint for every variant:
```
title, description, notes, requirements, assigneeIds, priority, parentTaskId,
groupId, createdByTl, isFolder, isRepeat, repeatConfig, isThirdParty,
thirdPartyConfig, isGoal, goalConfig, hasTimer, fixedDeadline, isSelfAssigned,
visibleTo, approverId, approverName, senderTimerWindowSecs, isGoldTask,
c2Config, etcHours
```

Deadline negotiation: `/:id/propose-deadline` · `/approve-deadline` ·
`/tl-counter-deadline` · `/respond-tl-counter` · `/request-deadline-extension` ·
`/review-deadline-extension` · `/approve-sender-timer` · `/reject-sender-timer` ·
`/extension-deduction` · `PATCH /:id/deadline` (CEO)

Variants: `/repeat-confirm` · `/repeat-submit` · `/third-party-update` ·
`/third-party-complete` · `/third-party-payment-action` · `/goal-update` ·
`GET|POST /:id/goal-activities` · `/goal-activity/:activityId/request-report` ·
`/submit-report` · `/self-assign-approve` · `/department-approve` ·
`/department-tl-set-hours` · `/subtask` · `/forward` · `/move-to-folder`

Reads: `GET /:id/details` · `/full` · `/chat` · `/daily-reports` ·
`/task/list-hierarchy` · `POST /task/p1-conflict-check`

⚠ `POST /task/:id/review-completion` performs **no authorisation check** — any
employee can approve/reject any task and fire its C1 score. Gate in the adapter.
⚠ `GET /task/force-repair-self-assign` and `/task/self-assign-debug/:employeeId`
have **no middleware**. Never expose.

### Scoring
`GET /cowork/pmp/:employeeId/dashboard?quarter&year` · `/pmp/:employeeId/c1` ·
`/c2` · `/pmp/employees` · `/c1/config` · `/c1/scores/:employeeId` ·
`/c1/scores` (CEO/TL) · `POST /c1/preview` · `/c2/config` · `/c2/gold-tasks` ·
`/c2/scores` · `/workload/summary` · `/workload/employee/:employeeId/calendar`

### SOP
`GET|POST /cowork/sop/folders` · `DELETE /folders/:id` · `GET /cowork/sop/` ·
`/all-categories` · `POST /cowork/sop/` · `PATCH|DELETE /cowork/sop/:id` ·
`PATCH /:id/approve` (CEO) · `/:id/reject` (CEO) · `POST /cowork/sop/bleach` ·
`GET /cowork/sop/bleach/:employeeId` · `POST|PATCH /bleach/:employeeId/:bleachId/recheck` ·
`GET /recheck/pending-list` · `/pending-count` · `GET|POST /task-suggestions` ·
`POST /goal-credit` · `POST /settings/sync` (CEO) · `GET /performance-summary` (CEO) ·
`GET|POST /cowork/band-config` · `/band-config/designations` · `/employee-bands`

### Timer-SOP
`POST /cowork/timer-sop/evaluate` · `GET /timer-sop/accum/:employeeId` ·
`POST /timer-sop/test-finalize/:employeeId` (CEO)

### Cowork ↔ HR bridge
`GET /cowork/deadline-availability/blocked-dates?employeeId&fromDate&days` (≤90)
— `CompanyHoliday` (everyone) + that employee's `LeaveApplication` rows in
`hr_approved` or `withdraw_pending`. **The only path from HR into deadlines.**

### Groups / messaging / meetings / notifications
`POST /group/create` (CEO/TL) · `GET /group/list` · `/group/:id` ·
`PATCH|DELETE /group/:id` (CEO) · `POST|DELETE /group/:id/members` ·
`GET /group/:id/members` · `POST /group/:id/message` · `GET /group/:id/messages` ·
`POST /direct-message/send` · `GET /direct-message/conversations` ·
`GET /direct-message/:convId/messages` · `POST /schedule-meet/create` (CEO/TL) ·
`GET /schedule-meet/list` · `/:meetId` · `PATCH /:meetId/edit|cancel` ·
`GET /cowork/notifications` · `PATCH /notifications/read-all`

### HR (146, mount prefixes inconsistent)
`/hr/attendance` + `/api/employee/attendance` (31) · `/api/hr/leaves` +
`/api/employee/leave-applications` (33) · `/api/hr/policy` (14) ·
`/api/hr/payroll`, `/payslip` (17) · `/api/employees`, `/api/hr` (14) ·
`/api/hr/departments` (8) · `/api/hr/job-postings`, `/candidates` (9) ·
`/api/hr/overview`, `/hr/reports`, `/hr/performance` (11) ·
`/api/employees/import-export` (4) · `/api/hr/sop` (10)

---

## 3. Authentication flow

```
Browser → Firebase client SDK (NEXT_PUBLIC_FIREBASE_*)
        → Firebase ID token
        → Authorization: Bearer <token>
        → verifyCoworkToken (Middlewear/coworkAuth.js)
        → req.coworkUser = { authUid, employeeId, role, name, employeeData }
```

`GET /cowork/me` bootstraps the session. `passwordChanged === false` forces a
password change.

**The same Firebase session authorises direct Firestore access** — which is how
the legacy browser performs 151 writes without the server.

Middleware behaviour to account for:
- **5-minute in-memory permission cache**, per process. Role changes take up to
  5 minutes and are inconsistent across instances.
- Employee lookup by `authUid`, **falling back to `email`**.
- Absent employee + Firebase custom claim `role === "ceo"` → **creates `E000`
  and grants CEO** inside the auth middleware.

Roles: `ceo`, `tl`, `employee` (+ `verifyHRToken` for HR). Compared inline; no
capability model. **Role checks appear on 92 of ~470 in-scope endpoints.**

HR and self-service use a **second, separate** system: self-issued JWT + bcrypt,
cookie `employee_token`, default password = the employee's mobile number.

**Consequence for the new project:** the adapter must obtain a Firebase ID token,
so the Firebase client SDK is required. The existing scrypt/HTTP-only-cookie
session in `lib/server/` cannot authenticate against this backend.

---

## 4. HR entities

MongoDB. `Employee` is the join point for everything.

```
Employee  (key = biometricId — NOT the `employeeId` virtual)
  ├─ email (unique sparse), password (bcrypt), temporaryPassword
  ├─ department (String)  +  departmentId (ObjectId → Department)   ← duplicated
  ├─ designation, jobPosition, jobTitle                             ← triplicated
  ├─ primaryManager   { managerId → Employee, managerName }
  ├─ secondaryManager { managerId → Employee, managerName }
  ├─ dateOfJoining, confirmationDate, probationPeriod, employmentType
  ├─ workLocation, shift
  ├─ status (free String)  +  isActive (Boolean)                    ← duplicated
  ├─ workCustomFields[]
  └─ sopPoints[]  → §5
```

**`Employee.employeeId` is a Mongoose virtual and is not queryable.**
`timerSop.service.js` documents that every lookup by `{ employeeId }` silently
returned null until fixed to `{ biometricId }`. The adapter must query
`biometricId`.

Hierarchy has **no constraint against cycles or self-reporting**, no closure
table, no department-head concept. The tree is walked in application code.

Other HR models: `Attendance`, `Dailyattendance`, `Attendancesettings`,
`C4Config`, `LeaveManagement` (exports `LeaveApplication` **and**
`CompanyHoliday`), `Departments`, `Policy`, `Payroll`, `Payrollsettings`,
`OvertimeReport`, `OvertimeNotificationLog`, `JobPosting`, `Candidates`,
`EmployeeTask`, plus `BandConfig` and `Salaryconfig`.

Nine per-department collections exist (`HRDepartment`, `QCDepartment`, …) — a
modelling artefact, not a requirement.

**There is no HR frontend in the legacy repo.** All HR UI is new design work.
**There is no tenant/organisation field** in Cowork, HR or SOP.

---

## 5. SOP entities

```
Sop            { name, points (min 0.5), severity, description, department,
                 folderId → SopFolder, folderName,
                 status: pending|approved|rejected, approvedBy, approvedAt,
                 createdBy, createdByName, createdByRole }
SopFolder      { name, department, createdBy* }

Employee.sopPoints[] = [{
   year, totalDeducted,          ← NET. Positive = violations dominate.
   bleaches: [{
     sopId → Sop, policyId → Policy,
     type: "C1"|"C2"|"C3"|"C4",  ← spans ALL score components
     sopName, folderName, points, description, date ("YYYY-MM-DD"),
     cutBy, cutByName, cutByRole,
     bleachType: "credit"|"debit",
     isCredit: Boolean,
     recheck: { status, requestedAt, requestNote,
                reviewedBy, reviewedByName, reviewedAt, reviewNote }
   }]
}]
```

`severity` ∈ `minor | moderate | serious | falsification | idle_pool | null`
(`null` = pre-dates the field; keeps its stored `points`).

### ⚠ The vocabulary is inverted

- `bleachType: "credit"` = a **violation**. Raises `totalDeducted`. Red in the UI.
- `bleachType: "debit"` = a **reward**. Lowers it. Green.
- `isCredit: true` maps to `"debit"` — the boolean's name is inverted relative to
  the enum value it means.

**Preserve the storage exactly; never surface these words in the new UI.** The
adapter reads and writes `bleachType` verbatim and presents a signed value to
components. This is presentation, not a model change.

### Lifecycle
Author (CEO/TL) → **approve (CEO only)** → apply as a bleach (CEO/TL; **a TL may
only bleach within their own department**) → employee requests recheck → CEO/TL
decides.

`POST /bleach` accepts `sopId` **or** `manualPoints` — an arbitrary deduction
with no rule behind it, named `"Manual Deduction"`, bypassing the approval gate.

### Automatic sources
| Source | Writes |
|---|---|
| `c1Service.js` (4 sites) | C1 task deductions into `sopPoints` |
| `Policy` / `C4Config` | C4 attendance; `policyId` de-duplicates |
| `timerSop.service.js` | C3 `"Idle Pool Deduction"` (credit) and C4 `"Overtime Reward"` (**debit**) |
| `POST /sop/goal-credit` | C2 reward (debit) |

Thresholds: `cowork_sop_settings/task_events` →
`timerDeficitThresholdHrs`, `timerDeficitPoints`, `timerOvertimeThresholdHrs`,
`timerOvertimePoints`. Accumulators `Employee.timerDeficitAccumHrs` /
`timerOvertimeAccumHrs`, finalised once per day behind a `lastFinalizedDate`
watermark.

### Bands
`BandConfig` — **a single document, ever**. `bands[].designations[]` →
`c1Max..c4Max`; `globalSettings.c1` = maxPoints 35, baseScore 1.0, deadline 0.2,
extension 0.1, rework 0.2, reject 0.3; `c2.globalMaxPoints` 30.
`getBandMaxForEmployee()` resolves designation → band → maxima, `null` → global
defaults. **An employee's maximum score depends on their designation.**

---

## 6. Task lifecycle

**Two parallel state axes**, maintained independently.

`status` — observed: `open`, `pending`, `in_progress`, `submitted`, `approved`,
`rejected`, `completed`, `cancelled`.

`completionStatus` — observed: `submitted`, `pending_tl_review`,
`pending_ceo_review`, `tl_approved`, `tl_final_approved`, `tl_rejected`,
`rejected_by_tl`, `ceo_approved`, `ceo_rejected`, `rejected_by_ceo`,
`approved`, `completed`.

⚠ **Two spellings for the same state**: `tl_rejected` / `rejected_by_tl`, and
`ceo_rejected` / `rejected_by_ceo`. Both are written. Any adapter predicate must
accept both.

⚠ **The axes bleed.** `services/taskForward.service.js:2200`:
```js
const TERMINAL_STATUSES = ["done", "cancelled", "tl_final_approved", "ceo_approved"];
if (TERMINAL_STATUSES.includes(conflictTask.status)) { … }
```
It tests `status` against values that otherwise appear in `completionStatus`,
and against `"done"`, which is not in the observed `status` set. **Treat
terminality as this exact list checked against `status`** — reproducing it
faithfully matters more than making it consistent.

### Flow
```
create → confirm → start → (work: timer + commits) → submit-completion
       → review-completion (TL)  → ceo-review (CEO, where required)
       → rework  ↺
```
Parallel: deadline negotiation (two mechanisms — `propose-deadline`, creator
approves; `request-deadline-extension`, any manager approves — writing different
fields); self-assign approval; department approval.

### Priority
A plain numeric `priority` on the task, assigned client-side as
`openTaskCount + 1` per assignee, **written straight to Firestore with no
permission check and no audit**. Promotion cascades deadlines for that
employee's lower-ranked tasks (`checkAndExtendForP1`).
`/coworking/fix-priorities` exists to renumber corrupted priorities — sorting by
`priority` then `createdAt` — which is direct evidence the model does not hold.

---

## 7. Score calculation flow

```
cowork_tasks + cowork_work_commits + cowork_timer_events
        │
        ├─ c1Service.js       → C1 Task Execution   → writes into sopPoints
        ├─ c2Band.routes.js   → C2 Goal Attainment
        ├─ SOP bleaches       → C3 Conduct & Policy
        ├─ Attendance/C4Config→ C4 Attendance
        │
        └─ Employee.sopPoints[year].totalDeducted
                    │
                    ▼
            services/pmpService.js   (reads sopPoints at 3 sites)
                    │  band maxima ← BandConfig.getBandMaxForEmployee()
                    ▼
        GET /cowork/pmp/:employeeId/dashboard?quarter&year
                    │
                    ▼
            /coworking/pmp   →  new UI /score
```

Owner-confirmed model: every unit max **1.0**; rework **−0.2**;
`clamp(max − deductions + credits, 0, max)`; aggregate **points-over-points,
never averaging percentages**. Labels: `C1 · Task Execution`,
`C2 · Goal Attainment`, `C3 · Conduct & Policy`, `C4 · Attendance`.

Quarter and year are query parameters defaulting to current.
TLs are scoped to their own department on the dashboard endpoint.

⚠ The authoritative spec **`CW-DEV-PMP-01 v1.0` (June 2026)** is cited
throughout `pmpService.js` and **is in neither repository**. Exact scoring
parity cannot be verified without it. The adapter should therefore **read
scores, never recompute them** — `pmpService` stays the only implementation.

---

## 8. Frontend → data dependencies

The legacy client is **primarily a Firestore client**: 61 files import Firebase,
46 call `fetch()`, and 29 files perform **151 direct writes**.

| Reached over HTTP | Reached only via Firestore |
|---|---|
| Task create/confirm/start/submit/review | Task **reads** (live lists) |
| Deadline negotiation | **Timers**, pause/resume |
| Scoring (`/pmp`, `/c1`, `/c2`) | **Priority rank** |
| SOP rules, bleaches, recheck | **Duty status**, break, emergency |
| Employee create / role / department | Presence, monitoring |
| Notification *send* | Notification *read* |
| Meetings, LiveKit, uploads | Messages, groups (live) |
| HR (all) | Settings documents |

| Page | fetch | Firestore | writes |
|---|---:|---:|---:|
| `/coworking/tasks` | 10 | **65** | **35** |
| `/coworking` | 0 | 24 | 5 |
| `/coworking/direct-messages` | 3 | 31 | 18 |
| `/coworking/groups` | 1 | 21 | 10 |
| `/coworking/mail` | 5 | 17 | 6 |
| `/coworking/status-tracking` | 0 | 12 | 0 |
| `/coworking/sop` | 11 | 10 | 3 |
| `/coworking/mail/gmail` | 10 | 0 | 0 |
| `/coworking/settings` | 3 | 2 | 2 |
| `/coworking/task-settings` | 0 | 2 | 2 |

`components/coworking/layout/CoworkingShell.js` holds **11 fetch + 49 Firestore**
— session, directory, notifications, presence and duty status all live in the
layout, which is why most pages read zero. Do not reproduce that shape.

`hooks/useTaskTimer.js` (6 Firestore, 0 fetch) and
`components/coworking/shared/DutyStatusToggle.jsx` (7 Firestore, 0 fetch) are the
two files that matter most for timers and availability. Both write straight to
Firestore.

**Firestore security rules are in neither repository.** They are the real
permission boundary for everything the browser writes. Until they are produced,
the adapter's server-side proxy is the only enforcement the new UI can rely on —
which is the argument for routing every write through it.

---

## Adapter layer — the contract this map implies

```
lib/legacy/
  firebase.ts    Firebase app + ID-token acquisition. The ONLY Firebase import.
  auth.ts        Sign-in, GET /cowork/me, session, role.
  employees.ts   Directory, hierarchy (my-managers), profile, role/department.
  tasks.ts       Lifecycle via API; reads + timers + priority via proxy.
  scoring.ts     PMP / C1 / C2 reads. Never recomputes.
  sop.ts         Rules, bleaches, recheck, bands. Signed points at the boundary.
  hr.ts          Attendance, leave, holidays, departments, blocked-dates.
  settings.ts    cowork_settings/office, break allowance, SOP thresholds.
```

Rules for every module:

1. **No component imports Firebase.** One import site, in `firebase.ts`.
2. **Writes go through a new-project API route**, which holds the Firebase Admin
   credential and performs the authorisation legacy omits — particularly
   `review-completion`, `change-role` and `change-department`.
3. **Names and shapes are preserved on the wire.** Collections, fields and enum
   values are written exactly as legacy writes them. Renaming happens only at the
   TypeScript boundary, for the UI to consume.
4. **No business logic in the adapter.** Deadline maths, scoring and SOP
   accumulation stay in the legacy services. The adapter marshals.
5. **Accept both spellings** wherever legacy has two (`tl_rejected` /
   `rejected_by_tl`, `isCredit` / `bleachType`, `status` / `completionStatus`).
6. **Query `biometricId`, never `employeeId`.**
7. **Never call** `force-repair-self-assign`, `self-assign-debug`, or any
   `taskTree.routes.js` path.

## Open items that block specific work

| # | Item | Blocks |
|---|---|---|
| 1 | Firestore security rules absent | Any claim about what legacy permits |
| 2 | `CW-DEV-PMP-01 v1.0` absent | Scoring parity — mitigated by never recomputing |
| 3 | Firebase client SDK required | Replaces the existing scrypt session for legacy calls |
| 4 | No tenant field in legacy | `organisationId` cannot be enforced against this backend |
| 5 | eTimeOffice credentials committed (`BiometricSyncService.js:8-10`) | Rotate regardless |
| 6 | After-duty work: legacy **rewards** it (C4), the new rules **charge** it | Phase 5 — the two rules contradict |
