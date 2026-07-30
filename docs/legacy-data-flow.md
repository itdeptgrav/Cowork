# Legacy Data Flow

How data reaches a screen. One row per surface.

```
UI Screen  →  lib/legacy/*  →  Legacy API / Firestore  →  Transformation  →  New UI model
```

Reference: [`legacy-system-map.md`](legacy-system-map.md) ·
[`../lib/legacy/README.md`](../lib/legacy/README.md)

## The rule these flows obey

**The adapter fetches and maps. It never calculates.** Every score, deadline,
SOP total and attendance figure is produced by the legacy engine and passed
through. Where a transformation column says "signed" or "collapsed", that is
presentation — the stored value is unchanged and the arithmetic that produced it
happened in `pmpService.js`, `c1Service.js`, `timerSop.service.js` or
`Attendanceengine.js`.

## Two tokens

`/cowork/*` needs a **Firebase ID token**. `/api/hr/*` and `/hr/*` need the
**HR JWT**. Rows below name which.

---

## Identity

| | |
|---|---|
| **Screen** | Sign-in, app shell, every permission decision |
| **Adapter** | `firebase.ts` → `auth.ts` |
| **Source** | Firebase Auth → `GET /cowork/me` *(Firebase token)* |
| **Transformation** | `role` → `LegacyRole` (unknown ⇒ `employee`); `passwordChanged: false` → `mustChangePassword`; `employeeId` branded `BiometricId` |
| **New model** | `LegacyIdentity` |

```
Firebase uid → cowork_employees.employeeId → Employee.biometricId
                (Firestore, role)             (Mongo, HR/SOP)
```
The third link can be missing. The engine reports that as a **success**.

---

## People and hierarchy

| | |
|---|---|
| **Screen** | `/people`, `/team`, `/admin/people`, org chart |
| **Adapter** | `employees.ts` |
| **Source** | `GET /cowork/employee/list` (CEO/TL) or `/list-members` (everyone); `/my-managers/:employeeId` *(Firebase token)* |
| **Collections** | Firestore `cowork_employees` + Mongo `Employee.primaryManager` |
| **Transformation** | id falls back to the Firestore doc id; rows with no identifier dropped; name falls back to id; `designation` falls back to `jobTitle`; `"not found in HR"` → `inHrSystem: false` |
| **New model** | `LegacyEmployee`, `LegacyHierarchy` |

`directReports()` and `reportingChain()` are assembled client-side — **legacy
has no endpoint in either direction but upward**. `reportingChain` stops on a
cycle; legacy has no constraint preventing one.

---

## Departments

| | |
|---|---|
| **Screen** | `/admin/organisation`, department pickers |
| **Adapter** | `departments.ts` |
| **Source** | `GET /api/hr/departments`, `/with-designations` *(**HR token**)* |
| **Collection** | Mongo `Department` |
| **Transformation** | `status` absent ⇒ active; designations reduced to `managerCount` |
| **New model** | `LegacyDepartment` |

The employee↔department join is a **free string** (`Employee.department`), since
the Firestore mirror carries no id. `unknownDepartments()` reports drift; it
never repairs it.

---

## Tasks

| | |
|---|---|
| **Screen** | `/tasks`, `/tasks/[taskId]` and its sub-routes |
| **Adapter** | `tasks.ts` |
| **Source** | `GET /cowork/task/:id/details`, `/task/list-hierarchy`; `POST /cowork/task/create` and 24 lifecycle actions *(Firebase token)* |
| **Collection** | Firestore `cowork_tasks` |
| **Transformation** | timestamps read from ISO / epoch / Firestore `Timestamp`; deadline from `fixedDeadline` ‖ `deadline` ‖ `dueDate`; variant from boolean flags; **both state axes preserved raw** plus a collapsed `reviewState`; terminality from legacy's own list |
| **New model** | `LegacyTask` |

`POST /task/create` takes legacy's 26-field body unchanged. It is **typed, not
validated** — the engine decides what is acceptable, and a second validator
would eventually disagree with it.

⚠ `review-completion` has **no authorisation in legacy**. Must go through the
proxy.

---

## Timers

| | |
|---|---|
| **Screen** | Task detail, timer pill |
| **Adapter** | `tasks.ts` (`readTimer`, `timerSessionPath`) |
| **Source** | Firestore `cowork_task_timers/{employeeId}/sessions/{taskId}` — **a subcollection; no REST endpoint exists** |
| **Transformation** | accepts either spelling of each duplicated field; running inferred from a start stamp; `remainingSecs` null when there is no budget |
| **New model** | `LegacyTimer` |

**No elapsed time is computed.** Legacy's display value comes from a stored base
plus a running anchor, computed in its `useTaskTimer` hook. A second clock here
would disagree with the one work is committed against.

---

## SOP Points

| | |
|---|---|
| **Screen** | `/score/c3`, SOP admin, employee ledger |
| **Adapter** | `sop.ts` |
| **Source** | `GET /cowork/sop/`, `/folders`, `/bleach/:employeeId`, `/recheck/pending-count`; `POST /cowork/sop/bleach` *(Firebase token)* |
| **Collections** | Mongo `Sop`, `SopFolder`, `Employee.sopPoints[]` |
| **Transformation** | **`bleachType` → signed points** (positive = penalty, matching `totalDeducted`); `isCredit` honoured for old rows; component read from `type` |
| **New model** | `LegacySop`, `LegacyLedgerYear`, `LegacyLedgerEntry` |

The vocabulary inversion — legacy's `"credit"` means a violation — is converted
once here and never appears above this layer. `netMatchesStored()` flags a
ledger that has stopped summarising its own history; the **stored** total still
drives scoring.

---

## Scoring

| | |
|---|---|
| **Screen** | `/score`, `/score/c1`–`c4`, `/score/history` |
| **Adapter** | `scoring.ts` |
| **Source** | `GET /cowork/pmp/:employeeId/dashboard?quarter&year`, `/c1`, `/c2`, `/cowork/c1/config` *(Firebase token)* |
| **Computed by** | `services/pmpService.js`, `c1Service.js` — **not here** |
| **Transformation** | score values read from number ‖ string ‖ `{earned}` ‖ `{score}`; `c4Net` used as-is; **unmapped fields preserved in `raw`** |
| **New model** | `LegacyScoreDashboard` |

Quarter and year are **omitted by default** so the engine picks the period —
computing "the current quarter" here could disagree with its boundary.
`hasScoreData()` separates "no activity" from "scored zero".

⚠ The authoritative spec `CW-DEV-PMP-01 v1.0` is in neither repository. Nothing
here recomputes a score, which is what makes that survivable.

---

## Duty status, break, emergency

| | |
|---|---|
| **Screen** | Presence pill, `/team`, break and emergency controls |
| **Adapter** | `attendance.ts` (`readDuty`) |
| **Source** | Firestore `cowork_duty_status/{employeeId}` — **no REST endpoint** |
| **Transformation** | break/emergency active inferred from a non-zero start stamp; allowance null when unset; `unappliedGapMs` from the engine's own pending fields |
| **New model** | `LegacyDuty` |

**Legacy already implements the availability-delta model** — `latenessMs`,
`breakGapStoredMs` vs `breakGapAppliedMs`, `lastDeadlineShiftMs` as the
idempotency watermark. New work extends these fields; a parallel accumulator
would credit the same hour twice.

---

## Blocked dates — the Cowork↔HR bridge

| | |
|---|---|
| **Screen** | Deadline pickers, `/attendance` |
| **Adapter** | `attendance.ts` (`fetchBlockedDates`) |
| **Source** | `GET /cowork/deadline-availability/blocked-dates` *(**Firebase** token, though it reads Mongo)* |
| **Collections** | `CompanyHoliday` (everyone) + `LeaveApplication` in `hr_approved` ‖ `withdraw_pending` |
| **Transformation** | holidays and leave merged, deduplicated, sorted; multiple response keys accepted |
| **New model** | `LegacyBlockedDate[]` |

**The only path from HR into deadline maths.** Window capped at 90 days by the
engine.

---

## Attendance records

| | |
|---|---|
| **Screen** | `/attendance`, `/attendance/history`, `/team/[employeeId]/attendance` |
| **Adapter** | `attendance.ts` |
| **Source** | `GET /api/employee/attendance/today`, `/monthly`; `/hr/attendance/employee/:empId` *(**HR token**)* |
| **Collections** | Mongo `Attendance`, `Dailyattendance` |
| **Transformation** | date required; in/out read from three possible field names; `isExpectedWorkingDay` defaults true |
| **New model** | `LegacyAttendanceDay` |

Derived by `Attendanceengine.js` from biometric punches supplied by
`BiometricSyncService.js`.

---

## Settings

| | |
|---|---|
| **Screen** | `/settings`, `/admin/settings` |
| **Adapter** | `settings.ts` |
| **Source** | Firestore `cowork_settings/office`, `cowork_sop_settings/task_events`; `GET /api/hr/policy` *(**HR token**)* |
| **Transformation** | `"HH:MM"` validated then converted to minutes; per-day config keyed by legacy's `DAY_KEYS` (index 0 = Sunday); `isConfigured` transcribed from the engine's own condition |
| **New model** | `LegacyOfficeSettings`, `LegacyTimerSopSettings`, `LegacyPolicy` |

Unset times stay **null**, never defaulting to 09:00. `toNewOfficeHours()`
returns **empty** breaks and day overrides because legacy stores neither —
holidays come from the blocked-dates endpoint instead.

---

## Bands

| | |
|---|---|
| **Screen** | `/admin/scoring-rules` |
| **Adapter** | `sop.ts` (`fetchBandConfig`, `bandForDesignation`) |
| **Source** | `GET /cowork/band-config` *(Firebase token)* |
| **Collection** | Mongo `BandConfig` — **a single document, ever** |
| **Transformation** | defaults transcribed from the model (C1 max 35, base 1.0, deadline 0.2, extension 0.1, rework 0.2, reject 0.3, C2 max 30) |
| **New model** | `LegacyBandConfig` |

**An employee's maximum score depends on their designation.** Read-only here —
adopting bands changes what every score means and is an owner decision.

---

## Writes that have no endpoint

These are written from the browser in legacy and have **no REST equivalent**:
task reads, **timers**, **priority rank**, **duty status / break / emergency**,
presence, messages, notifications, settings documents.

Under approach C they go through the new project's own API routes, which hold
the Admin credential, write the same documents with the same field names, and
perform the authorisation legacy omits. **Those proxy routes are not yet
built** — the adapter provides the paths (`timerSessionPath`, `dutyStatusPath`,
`officeSettingsPath`, `timerSopSettingsPath`) and the mappers they will use.
