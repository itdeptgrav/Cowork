# Legacy Response Validation

Comparing what the legacy engine actually returns against what the adapter turns
it into.

## Status: NOT RUN

**No credentials are configured**, and none exist in either legacy repository —
neither `cowork-old-frontend` nor `cowork-old-backend` contains a `.env` file or
a service-account key. Nothing in this document has been executed against a live
system.

Every adapter mapper was written by reading legacy source: route files, Mongoose
models, service code and the legacy client. That is enough to be confident about
*field names and semantics*, and **not** enough to be confident about *response
envelopes*, because most legacy routes do not declare one consistently.

This document is therefore the protocol, with a results column to fill in. Run
it as soon as `/legacy/health` reports `CONNECTED`.

## Why envelopes are the risk

An envelope mismatch is the **worst kind of failure** because it looks like
success: `unwrap()` returns an empty array, the screen renders its empty state,
and the page looks correct while showing nothing. No error, no warning.

The adapter names an expected key per call. Where that key was inferred rather
than read from an explicit `res.json({ key: ... })`, it is marked **inferred**
below and must be confirmed first.

| Call | Expected key | Confidence |
|---|---|---|
| `GET /cowork/me` | *(bare object)* | **read** — `res.json({ authUid, employeeId, role, name, ... })` |
| `GET /cowork/employee/list` | `employees` | **read** — `res.json({ employees: await svc.listCoworkEmployees() })` |
| `GET /cowork/employee/list-members` | `employees` | **inferred** |
| `GET /cowork/employee/:id` | `employee` | **inferred** |
| `GET /cowork/employee/my-managers/:id` | *(bare)* | **read** — `{ success, primaryManager, secondaryManager, message }` |
| `GET /cowork/task/:id/details` | `task` | **inferred** |
| `GET /cowork/task/list-hierarchy` | `tasks` | **inferred** |
| `GET /cowork/sop/` | `sops` | **inferred** |
| `GET /cowork/sop/folders` | `folders` | **inferred** |
| `GET /cowork/sop/bleach/:employeeId` | `sopPoints` | **inferred** |
| `GET /cowork/pmp/:id/dashboard` | *(bare)* | **inferred** |
| `GET /api/hr/departments` | `departments` | **inferred** |
| `GET /api/hr/departments/with-designations` | `data` | **inferred** |
| `GET /api/employee/attendance/today` | `attendance` | **inferred** |
| `GET /api/hr/policy` | `policies` | **inferred** |

**Eleven of fifteen are inferred.** Confirming them is the first hour of this
work and probably the highest-value hour in the whole migration.

`unwrap()` falls back to treating the body as the payload when the named key is
absent, so a wrong key usually produces "the whole envelope as the payload"
rather than a crash — which then fails to map and yields an empty list. Watch
for empty lists, not for errors.

## How to run it

1. Configure `.env.local` per [`legacy-environment-setup.md`](legacy-environment-setup.md).
2. Open `/legacy/health` — require `CONNECTED`.
3. Open `/legacy` — confirm your own name, role and department.
4. For each row below, call the adapter and capture the raw response beside it.
   In the browser console with the dev server running:

   ```js
   // Raw — what the engine sent
   const token = await (await import("/lib/legacy/firebase.ts")).idToken();
   const raw = await fetch(`${API}/cowork/employee/list`,
     { headers: { Authorization: `Bearer ${token}` } }).then(r => r.json());

   // Transformed — what the adapter produced
   const { listEmployees } = await import("/lib/legacy/employees.ts");
   const mapped = await listEmployees(token);
   ```

5. Record the verdict. **Any mismatch is an adapter bug** — the legacy response
   is correct by definition, because legacy is the source of truth.

## Protocol

### 1 · Identity — `GET /cowork/me`

| Check | Expectation | Result |
|---|---|---|
| Returns an object with `employeeId`, `role`, `name` | | ☐ |
| `employeeId` equals the HR `biometricId` for the same person | | ☐ |
| `role` is one of `ceo`, `tl`, `employee` | | ☐ |
| An unrecognised role maps to `employee` | matches the engine's own fallthrough | ☐ |
| `passwordChanged: false` → `mustChangePassword: true` | | ☐ |
| A 403 carries *"Employee not found in Firestore. Ask your CEO."* | | ☐ |

### 2 · Employees

| Check | Expectation | Result |
|---|---|---|
| `employee/list` envelope key is `employees` | | ☐ |
| Row count matches the legacy `/coworking` directory | | ☐ |
| `tempPassword` is absent from every row | the engine strips it on list | ☐ |
| A row with no `employeeId` falls back to the Firestore doc id | the CEO is seeded at `E000` | ☐ |
| `list-members` returns data for a plain `employee` account | if it 403s, the adapter is calling the wrong endpoint for non-managers | ☐ |
| `department` is a plain string | | ☐ |

### 3 · Hierarchy — `my-managers/:employeeId`

| Check | Expectation | Result |
|---|---|---|
| `primaryManager.biometricId` is present for somebody with a manager | | ☐ |
| Somebody with no HR record returns `success: true` and the *"not found in HR system"* message | `inHrSystem: false` | ☐ |
| The message wording still matches `/not found in hr/i` | **the only signal the engine gives** | ☐ |
| `designation` falls back to `jobTitle` when absent | | ☐ |

### 4 · Departments — `GET /api/hr/departments`

| Check | Expectation | Result |
|---|---|---|
| **The HR JWT is accepted here and the Firebase token is not** | confirms the two-token model | ☐ |
| Envelope key is `departments` | | ☐ |
| `designations[]` is nested on each department | | ☐ |
| Department names on employees all exist in the master | `unknownDepartments()` should be empty; if not, that is real data drift | ☐ |

### 5 · Tasks

| Check | Expectation | Result |
|---|---|---|
| `task/:id/details` envelope key is `task` | | ☐ |
| `status` values fall inside the observed set | `open`, `pending`, `in_progress`, `submitted`, `approved`, `rejected`, `completed`, `cancelled` | ☐ |
| `completionStatus` values fall inside the observed set | **both rejection spellings appear in real data** | ☐ |
| **Is `"done"` ever written to `status`?** | it is in `TERMINAL_STATUSES` but was never seen being written | ☐ |
| The deadline is on `fixedDeadline`, `deadline` or `dueDate` | record which, per task type | ☐ |
| Timestamp format | ISO string, epoch number, or Firestore `Timestamp` — record which | ☐ |
| `priority` is a number, 1 = highest | | ☐ |
| Are there live standard tasks with more than one assignee? | expected — the new single-assignee rule contradicts legacy | ☐ |

### 6 · Timers — `cowork_task_timers/{employeeId}/sessions/{taskId}`

Requires the Firestore proxy, so the service account must be set.

| Check | Expectation | Result |
|---|---|---|
| The path really is a subcollection | a flat query must return nothing | ☐ |
| Which of `totalSecs` / `totalSeconds` is written | the adapter accepts either | ☐ |
| Which of `windowSecs` / `winSecs` / `newTotalWindowSecs` is written | | ☐ |
| A running session has `startedAt` and a stopped one does not | the adapter infers running from this | ☐ |

### 7 · SOP

| Check | Expectation | Result |
|---|---|---|
| `sop/` envelope key is `sops` | | ☐ |
| `sop/bleach/:employeeId` envelope key is `sopPoints` | | ☐ |
| **`bleachType: "credit"` entries raise `totalDeducted`** | the inversion — confirm against a real ledger | ☐ |
| **`signedPoints()` summed equals the stored `totalDeducted`** | `netMatchesStored()` — the single most important assertion in this document | ☐ |
| Entries carry `type` values other than `C3` | confirms the ledger spans all four components | ☐ |
| Old entries exist with `isCredit` and no `bleachType` | confirms the fallback path is live | ☐ |
| Rules with `severity: null` exist | confirms points and severity are independent | ☐ |
| An unapproved SOP is refused with *"Only approved SOPs can be applied."* | | ☐ |

### 8 · Scores — `GET /cowork/pmp/:employeeId/dashboard`

| Check | Expectation | Result |
|---|---|---|
| The response is bare, not wrapped | | ☐ |
| `totalEarned` is present | | ☐ |
| Are `c1`/`c2` bare numbers or `{earned, max}` objects? | `readScoreValue()` handles both — record which | ☐ |
| `c4Net` is already net of credits | must not be adjusted again | ☐ |
| **The displayed total equals `/coworking/pmp` for the same person and quarter** | the definitive parity check | ☐ |
| Omitting `quarter`/`year` gives the current period | | ☐ |
| A TL requesting somebody outside their department is refused | | ☐ |
| Fields the adapter does not map survive in `raw` | | ☐ |

### 9 · Attendance

| Check | Expectation | Result |
|---|---|---|
| `attendance/today` accepts the **HR JWT** | | ☐ |
| Envelope key is `attendance` | | ☐ |
| Which field carries the punch time — `inTime`, `actualStart` or `punchIn` | | ☐ |
| `blocked-dates` accepts the **Firebase** token despite reading Mongo | | ☐ |
| Which key holds the result — `blockedDates`, `holidays`, `leaves` | the adapter reads all three | ☐ |
| Approved leave appears for somebody who has some | | ☐ |
| `cowork_duty_status` carries `latenessMs`, `breakGapAppliedMs`, `lastDeadlineShiftMs` | confirms legacy's availability-delta model is live | ☐ |

### 10 · Settings

| Check | Expectation | Result |
|---|---|---|
| `cowork_settings/office` has `inTime`/`outTime` as `"HH:MM"` strings | | ☐ |
| Per-weekday keys are lowercase day names with `isOff` | | ☐ |
| `maxBreakMinutesPerDay` is present | | ☐ |
| `cowork_sop_settings/task_events` exists and `isConfigured` is true | if false, the timer-SOP rule is inert in production | ☐ |
| `band-config` returns a single document | | ☐ |
| Every employee designation maps to a band | unmapped ⇒ that person scores against global defaults | ☐ |

## Mismatch log

Record every difference. One row per mismatch.

| # | Call | Legacy returned | Adapter produced | Cause | Fixed in |
|---|---|---|---|---|---|
| — | *(none recorded — validation not yet run)* | | | | |

## Acceptance

Validation is complete when:

1. All fifteen envelope keys are confirmed or corrected.
2. `netMatchesStored()` holds for at least three real ledgers.
3. A score shown in the new UI equals the same score in `/coworking/pmp` for the
   same person and quarter.
4. The directory count matches the legacy directory.
5. All three roles have been signed in with, and `accessSummary()` matches what
   each account can actually do.
6. Every mismatch above is either fixed or recorded with a reason.

Only then does a screen move past `wired` to `done` in
[`ui-migration-status.md`](ui-migration-status.md), and only then does UI
migration continue to step 2.
