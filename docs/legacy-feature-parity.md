# Legacy Feature Parity

Where each legacy behaviour lives, what covers it in the adapter, and how far
that has got.

**Status** — `bridged` mapper + call written and tested against legacy's shapes ·
`mapped` transformation written, no call (no endpoint exists) ·
`read-only` deliberately not writable · `conflict` legacy and the new rules
disagree, unresolved · `pending` not started · `excluded` deliberately out of
scope

Nothing below is verified against a **live** backend. Every claim is checked
against the legacy source, not against a real response.

## Identity and access

| Feature | Legacy location | New adapter | Status |
|---|---|---|---|
| Sign in | Firebase client SDK | `firebase.signIn()` | bridged |
| Session bootstrap | `GET /cowork/me` | `auth.fetchIdentity()` | bridged |
| Forced password change | `passwordChanged === false` | `LegacyIdentity.mustChangePassword` | bridged |
| Change password | `POST /cowork/change-password` | `auth.changePassword()` | bridged |
| Role check — CEO | `verifyCeoToken` | `permissions.isCeo()` | bridged |
| Role check — CEO or TL | `verifyCeoOrTL` | `permissions.isCeoOrTl()` | bridged |
| Authenticated | `verifyEmployeeToken` | `permissions.isAuthenticated()` | bridged |
| TL department scope | `POST /sop/bleach` inline check | `permissions.tlSharesDepartment()` | bridged |
| Refusal wording | `"CEO only"` / `"CEO or TL only"` | `permissions.gateRefusal()` | bridged |
| 5-minute role cache | `coworkAuth.js` `_cache` | `auth.ROLE_CHANGE_NOTICE` | mapped |
| HR JWT auth | `EmployeeAuthMiddlewear` | `hrToken` parameter | bridged |
| Ungated endpoints | `review-completion`, `change-role`, `change-department` | `permissions.UNGATED_LEGACY_ENDPOINTS` | mapped — **proxy pending** |
| Unauthenticated debug routes | `force-repair-self-assign`, `self-assign-debug` | `http` refuses by path | bridged |

## People, hierarchy, departments

| Feature | Legacy location | New adapter | Status |
|---|---|---|---|
| Directory (CEO/TL) | `GET /cowork/employee/list` | `employees.listEmployees()` | bridged |
| Directory (everyone) | `GET /cowork/employee/list-members` | `employees.listMembers()` | bridged |
| One employee | `GET /cowork/employee/:id` | `employees.getEmployee()` | bridged |
| Reporting managers | `GET /cowork/employee/my-managers/:id` | `employees.fetchHierarchy()` | bridged |
| Missing HR record | `"Employee not found in HR system"` | `LegacyHierarchy.inHrSystem` | bridged |
| Direct reports | *no endpoint* | `employees.directReports()` | mapped |
| Reporting chain | *no endpoint* | `employees.reportingChain()` — cycle-safe | mapped |
| Create employee | `POST /cowork/employee/create` | — | pending |
| Change role | `POST /cowork/employee/:id/change-role` | — | pending — **needs proxy gate** |
| Change department | `POST /.../change-department` | — | pending — **needs proxy gate** |
| Reset password | `POST /cowork/employee/:id/reset-password` | — | pending |
| Departments | `GET /api/hr/departments` | `departments.listDepartments()` | bridged |
| Designations | nested in `Department` | `departments.allDesignations()` | bridged |
| Department drift | — | `departments.unknownDepartments()` | mapped |

## Tasks

| Feature | Legacy location | New adapter | Status |
|---|---|---|---|
| Task document | Firestore `cowork_tasks` | `tasks.readTask()` | mapped |
| Task detail | `GET /cowork/task/:id/details` | `tasks.getTask()` | bridged |
| Task hierarchy list | `GET /cowork/task/list-hierarchy` | `tasks.listTaskHierarchy()` | bridged |
| Create (26-field body) | `POST /cowork/task/create` | `tasks.createTask()` | bridged |
| 24 lifecycle actions | `taskForward.js` | `tasks.taskAction()` | bridged |
| Two state axes | `status` + `completionStatus` | preserved raw + `reviewState` | bridged |
| Duplicate spellings | `tl_rejected` / `rejected_by_tl` | `wire.readCompletionStatus()` | bridged |
| Terminality | `TERMINAL_STATUSES` | `wire.isTerminal()` — verbatim | bridged |
| Task variants | boolean flags | `tasks.readKind()` | bridged |
| Deadline field | `fixedDeadline` ‖ `deadline` ‖ `dueDate` | `tasks.readDueAtMs()` | bridged |
| Timestamp formats | ISO / epoch / Firestore `Timestamp` | `tasks.readInstant()` | bridged |
| Priority rank | `cowork_tasks.priority`, **browser write** | `LegacyTask.priority` (read) | mapped — **no endpoint** |
| P1 conflict check | `POST /cowork/task/p1-conflict-check` | `tasks.checkPriorityConflict()` | bridged |
| Deadline negotiation | 10 endpoints | `tasks.taskAction()` | bridged |
| Timer session | `cowork_task_timers/{emp}/sessions/{task}` | `tasks.readTimer()` | mapped — **no endpoint** |
| Elapsed-time display | legacy `useTaskTimer` hook | — | **deliberately not ported** |
| Work commits | `cowork_work_commits` | — | pending |
| Requests | `cowork_requests` | — | pending |
| Forwarding | `POST /task/:id/forward` | — | excluded (D33) |
| Folders | `isFolder`, `move-to-folder` | reported by `conflictsWithNewRules` | excluded (D33) |
| Third-party tasks | `isThirdParty` + 3 endpoints | reported by `conflictsWithNewRules` | excluded |
| Subtask tree | `taskTree.routes.js` | — | excluded — **dead in legacy** |

## SOP Points

| Feature | Legacy location | New adapter | Status |
|---|---|---|---|
| SOP rule | Mongo `sop_model` | `sop.readSop()` | bridged |
| Severity enum | `Sop.severity` | `LegacySeverity` — matches new domain exactly | bridged |
| Folders | Mongo `sop_folder_model` | `sop.listFolders()` | bridged |
| Approval gate (CEO) | `PATCH /sop/:id/approve` | `sop.UNAPPROVED_SOP_REFUSAL` | mapped |
| Apply a rule | `POST /cowork/sop/bleach` | `sop.applySop()` | bridged |
| Manual deduction | `manualPoints` | `sop.applySop({manualPoints})` | bridged |
| Employee ledger | `Employee.sopPoints[]` | `sop.fetchLedger()` | bridged |
| **credit/debit inversion** | `bleachType`, `isCredit` | `wire.signedPoints()` — positive = penalty | bridged |
| Component tag | `bleach.type` C1–C4 | `wire.readComponent()` | bridged |
| Ledger integrity | — | `sop.netMatchesStored()` | mapped |
| Dispute (recheck) | `POST/PATCH .../recheck` | `sop.requestRecheck()` | bridged |
| Pending recheck count | `GET /sop/recheck/pending-count` | `sop.pendingRecheckCount()` | bridged |
| Timer idle-pool → C3 | `timerSop.service.js` | — | read-only — engine writes it |
| Timer overtime → C4 | `timerSop.service.js` | — | **conflict**, see below |
| Goal credit | `POST /sop/goal-credit` | — | pending |
| Task suggestions | `GET/POST /sop/task-suggestions` | — | pending |
| Bands | Mongo `BandConfig` | `sop.fetchBandConfig()`, `bandForDesignation()` | read-only |

## Scoring

| Feature | Legacy location | New adapter | Status |
|---|---|---|---|
| Dashboard | `GET /cowork/pmp/:id/dashboard` | `scoring.fetchDashboard()` | bridged |
| C1 breakdown | `GET /cowork/pmp/:id/c1` | `scoring.fetchC1()` | bridged |
| C2 breakdown | `GET /cowork/pmp/:id/c2` | `scoring.fetchC2()` | bridged |
| C1 config | `GET /cowork/c1/config` | `scoring.fetchC1Config()` | bridged |
| Scorable employees | `GET /cowork/pmp/employees` | `scoring.fetchScorableEmployees()` | bridged |
| Workload summary | `GET /cowork/workload/summary` | `scoring.fetchWorkloadSummary()` | bridged |
| Component labels | product convention | `scoring.COMPONENT_LABELS` | bridged |
| Varied value shapes | `pmpService` | `scoring.readScoreValue()` | bridged |
| Empty vs zero | — | `scoring.hasScoreData()` | mapped |
| **Any score calculation** | `pmpService.js`, `c1Service.js` | — | **deliberately not ported** |
| Score history | partial in legacy | — | pending |

## Attendance and duty

| Feature | Legacy location | New adapter | Status |
|---|---|---|---|
| Duty status | Firestore `cowork_duty_status` | `attendance.readDuty()` | mapped — **no endpoint** |
| Late login | `latenessMs` | `LegacyDuty.latenessMs` | mapped |
| Break state + allowance | `breakStartedAtMs`, `maxBreakSecs` | `LegacyDuty.break` | mapped |
| Emergency state | `emergencyStartedAtMs` | `LegacyDuty.emergency` | mapped |
| Applied vs pending gap | `breakGapApplied/StoredMs` | `wire.unappliedGapMs()` | mapped |
| Idempotency watermark | `lastDeadlineShiftMs` | `LegacyDuty.lastShiftAtMs` | mapped |
| Blocked dates | `GET /cowork/deadline-availability/blocked-dates` | `attendance.fetchBlockedDates()` | bridged |
| Today | `GET /api/employee/attendance/today` | `attendance.fetchToday()` | bridged |
| Monthly | `GET /api/employee/attendance/monthly` | `attendance.fetchMonthly()` | bridged |
| Per-employee (HR) | `GET /hr/attendance/employee/:empId` | `attendance.fetchEmployeeAttendance()` | bridged |
| Biometric sync | `BiometricSyncService.js` | — | excluded — server-side job |
| Leave applications | `/api/hr/leaves` (33 eps) | — | pending |
| Overtime reports | `/api/employee/overtime` | — | pending |
| Payroll / payslips | 17 endpoints | — | excluded — owner decision |
| Recruitment | 9 endpoints | — | excluded — owner decision |

## Settings

| Feature | Legacy location | New adapter | Status |
|---|---|---|---|
| Office hours | `cowork_settings/office` | `settings.readOfficeSettings()` | mapped — **no endpoint** |
| Week-offs | per-day `isOff` | `settings.workingWeekdays()` | mapped |
| Break allowance | `maxBreakMinutesPerDay` | `LegacyOfficeSettings.breakAllowanceSecs` | mapped |
| Daily minimum | `dailyMinHrs`, `dailyMinPct` | mapped | mapped |
| Timer-SOP thresholds | `cowork_sop_settings/task_events` | `settings.readTimerSopSettings()` | mapped |
| Configured vs zero | engine's own condition | `LegacyTimerSopSettings.isConfigured` | bridged |
| Policies | `GET /api/hr/policy` | `settings.listPolicies()` | bridged |
| Timezone | hard-coded IST ×4 | `assumedTimezone` | mapped |

## Conflicts — legacy versus the new rules

Not silently resolved. Each has an extension point; **legacy's calculation is
what reaches anybody's score**, because legacy remains the engine.

| # | Legacy | New rule | Extension point | Status |
|---|---|---|---|---|
| 1 | After-duty and week-off work accumulates an **"Overtime Reward"** (C4 credit, raises the score) | After-duty work **consumes task budget** | `attendance.AFTER_DUTY_CONFLICT` | **conflict** |
| 2 | Any number of assignees on a standard task | Standard tasks are single-assignee | `tasks.conflictsWithNewRules()` | reported |
| 3 | Folders and third-party tasks exist | Removed (D33) | `tasks.conflictsWithNewRules()` | reported |
| 4 | Priority written client-side, no permission check, no audit | Manager-gated with acknowledgement | none yet — priority has no endpoint | **open** |
| 5 | Office hours: strings, fixed IST offset, no breaks or holidays | Minutes, IANA zone, breaks, day overrides, versioned | `settings.toNewOfficeHours()`, `OFFICE_HOURS_GAPS` | mapped |
| 6 | Disputes **mutate** the ledger entry's `recheck` | Resolve by reversal, never mutation | none — the engine owns the write | **open** |
| 7 | No tenant concept anywhere | `organisationId` on Tier-A entities | none | **open** — unenforceable against this backend |
| 8 | Deadlines skip per-employee leave via the bridge | `dayOverrides` covers org-wide holidays only | `attendance.fetchBlockedDates()` | bridged |

## Blocking unknowns

| # | Item | Consequence |
|---|---|---|
| 1 | **Firestore security rules are in neither repo** | The real permission boundary for everything the browser writes is unknown; parity is unverifiable |
| 2 | **`CW-DEV-PMP-01 v1.0` is in neither repo** | Exact scoring parity unverifiable — mitigated by never recomputing |
| 3 | **No credentials configured** | Nothing has been run against a live backend; every mapper is checked against source, not responses |
| 4 | `JWT_SECRET` may be unset in production | `EmployeeAuthMiddlewear` falls back to a hard-coded secret; HR tokens forgeable |
| 5 | eTimeOffice credentials committed | Rotate regardless |

## Not built

Proxy routes (every browser-written collection), work commits, requests,
messaging, notifications, meetings, mail, leave, overtime, goal credit, task
suggestions, score history, employee create/role/department writes.

The **mock repository is untouched** — 187 methods still serving every screen.
No UI is connected. Screen-by-screen replacement is the next phase.
