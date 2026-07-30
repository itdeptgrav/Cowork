# SOP Points — Investigation

Mandatory investigation. SOP Points exist, are live business logic, and feed
scoring. Nothing here is assumed; every claim cites the file it came from.

## Definition

**An "SOP" is a named policy rule carrying a point value. A "bleach" is one
recorded application of that rule to one employee on one date. "SOP Points" is
the per-employee, per-year ledger of bleaches.**

"Bleach" is legacy's own term for the event — from garment manufacturing, where
bleaching is a defect. It appears in the model, the routes and the UI. It is a
poor name for a compliance record and should not survive the migration.

### `Sop` — the rule (`models/sopmodel/sop_model.js`)

```js
{ name, points: Number(min 0.5),
  severity: "minor"|"moderate"|"serious"|"falsification"|"idle_pool"|null,
  description, department,
  createdBy, createdByName, createdByRole,
  folderId → SopFolder, folderName (default "Uncategorized"),
  status: "approved"|"pending"|"rejected" (default "pending"),
  approvedBy, approvedByName, approvedAt }
```
Indexes: `{department, status}`, `{createdBy}`. `SopFolder` is grouping only:
`{ name, department, createdBy* }`.

`severity: null` is explicitly documented as "legacy SOP created before this
field existed; keeps its stored `points` as-is" — so points and severity are
**two independent sources for the same number**, and older rows only have one.

### The ledger — `Employee.sopPoints[]`

```js
sopPoints: [{
  year: Number,
  totalDeducted: Number,     // NET. Positive = violations dominate.
                             //      Negative = rewards outweigh violations.
  bleaches: [{
    sopId → Sop,  policyId → Policy,     // policy-driven (e.g. attendance C4)
    type: "C1"|"C2"|"C3"|"C4",           // which score component
    sopName, folderName, points, description,
    date: "YYYY-MM-DD",
    cutBy, cutByName, cutByRole,
    bleachType: "credit"|"debit",
    isCredit: Boolean,                   // legacy duplicate of bleachType
    recheck: { status, requestedAt, requestNote,
               reviewedBy, reviewedByName, reviewedAt, reviewNote },
  }]
}]
```

**The vocabulary is inverted and this is the single most dangerous thing in the
subsystem.** From the model's own comments:

- `bleachType: "credit"` = a **violation**. Adds to `totalDeducted`. Red in the UI.
- `bleachType: "debit"` = a **reward**. Subtracts from `totalDeducted`. Green.

"Credit" is bad. Anyone reading this schema with ordinary accounting intuition
will get the sign backwards. `isCredit` is a third spelling of the same flag,
kept for old rows, and its `true` is treated as `bleachType: "debit"` — so the
boolean's name is inverted relative to the enum value it maps to.

**This must be renamed on migration, not carried.** A signed `points` value with
one sign convention removes the whole class of error.

## Ownership

SOP Points attach to the **employee**, not to tasks, departments or processes.
The `Sop` rule is scoped by `department`; the bleach is scoped by employee-year.
`type` files each bleach under a score component.

**They are not a C3-only mechanism.** Despite living in a "conduct" shape,
bleaches are written with `type` set to C1, C2, C3 *and* C4 — SOP Points are the
**general-purpose point ledger for all four components**.

## Lifecycle

### 1. Rule authoring
| Step | Endpoint | Who |
|---|---|---|
| Create folder | `POST /cowork/sop/folders` | CEO or TL |
| Delete folder | `DELETE /cowork/sop/folders/:id` | CEO or TL |
| List folders | `GET /cowork/sop/folders` | any employee |
| Create SOP | `POST /cowork/sop/` | CEO or TL |
| Edit SOP | `PATCH /cowork/sop/:id` | CEO or TL |
| Delete SOP | `DELETE /cowork/sop/:id` | CEO or TL |
| List / categories | `GET /cowork/sop/`, `GET /cowork/sop/all-categories` | any employee |

### 2. Approval
| Step | Endpoint | Who |
|---|---|---|
| Approve | `PATCH /cowork/sop/:id/approve` | **CEO only** |
| Reject | `PATCH /cowork/sop/:id/reject` | **CEO only** |

A rule is created `pending`. `POST /bleach` refuses a non-approved SOP:
`"Only approved SOPs can be applied."` **A two-stage authoring gate — author
broadly, approve narrowly.**

### 3. Application (`POST /cowork/sop/bleach`, CEO or TL)

Body: `{ targetEmployeeId, sopId?, description?, manualPoints?, manualSopName? }`
— `sopId` **or** `manualPoints` required.

Enforced:
- SOP must exist and be `approved`.
- Target employee must exist (`biometricId`).
- **A TL may only bleach employees in their own department** — the one genuine
  scope check in the subsystem. A CEO is unrestricted.
- Written as `type: "C3"`, `bleachType: "credit"`, dated today, attributed to
  `cutBy`/`cutByName`/`cutByRole`.

`manualPoints` allows an **arbitrary deduction with no rule behind it**, named
`"Manual Deduction"` and filed under folder `"Task Event"`. It bypasses the
approval gate entirely — the gate governs rules, not deductions.

### 4. Dispute — "recheck"
| Step | Endpoint | Who |
|---|---|---|
| Request recheck | `POST /cowork/sop/bleach/:employeeId/:bleachId/recheck` | the employee |
| Decide | `PATCH /cowork/sop/bleach/:employeeId/:bleachId/recheck` | CEO or TL |
| Pending list / count | `GET /cowork/sop/recheck/pending-list`, `/pending-count` | CEO or TL |

A real dispute workflow with request note, reviewer, decision note and timestamp.

### 5. History
`GET /cowork/sop/bleach/:employeeId` — any employee (**no scoping check
observed**: appears to allow reading any employee's compliance history).

### 6. Automatic sources

**C1 — task execution** (`services/c1Service.js`). Task-scoring deductions are
written into `sopPoints` "so they show in SOP history". Four separate write
sites (lines ~167, ~368, ~407, ~440).

**C4 — attendance policy** (`Policy` model, `policyId` on the bleach). Attendance
violations generate bleaches. `policyId` exists explicitly to **de-duplicate
attendance suggestions so the same violation is never recorded twice** — legacy
already hit double-counting here.

**Timer-derived** (`services/timerSop.service.js`), after every work commit,
reading thresholds from Firestore `cowork_sop_settings/task_events`:

| Rule | Trigger | Written as |
|---|---|---|
| Idle/deficit pool | Accumulated shortfall vs daily minimum crosses `timerDeficitThresholdHrs` | `type: "C3"`, `sopName: "Idle Pool Deduction"`, `bleachType: "credit"` — penalty |
| Overtime | Accumulated time worked after office close, plus all time on week-offs, crosses `timerOvertimeThresholdHrs` | `type: "C4"`, `sopName: "Overtime Reward"`, `bleachType: "debit"` — **reward** |

Both use a `while` loop that fires repeatedly and keeps the remainder, and both
accumulate on `Employee.timerDeficitAccumHrs` / `timerOvertimeAccumHrs`. The two
counters are independent — one day can add to both.

Correctness machinery worth preserving as *requirements*, from the file's own
header: a `lastFinalizedDate` watermark so a day is finalised **once** (a
previous version added a day's shortfall once per pause — four pauses, four
charges); catch-up across skipped days, each judged independently; bleaches filed
under the year of the day being finalised, not the year the job runs in; days the
schedule marks `isOff` skipped; a 60-day cap per run.

**These are the same problems the new availability ledger solves** — idempotency,
one-application-per-event, correct day attribution. Legacy arrived at watermarks;
the new design uses interval identity and idempotency keys, which is stronger.

### 7. Rewards
`POST /cowork/sop/goal-credit` (CEO or TL) writes `bleachType: "debit"` for
on-time goal submission.

### 8. Configuration and reporting
`POST /cowork/sop/settings/sync` (CEO), `GET /cowork/sop/performance-summary`
(CEO), `GET|POST /cowork/sop/task-suggestions` (CEO or TL) — proposed bleaches
from task events, dismissable.

## Business impact

`totalDeducted` is read by `services/pmpService.js` at three sites (lines 283,
336, 385) — **SOP Points feed the performance score directly.** With `type` on
each bleach, they carry deductions and credits for all of C1–C4.

Effect on ranking, incentives and reports follows from the score. No evidence
was found that SOP Points gate task completion.

## Technical flow

```
/coworking/sop  (frontend)
   └─ fetch → /cowork/sop/*        (soproute.js, 21 endpoints)
        ├─ Sop, SopFolder          (Mongo)
        └─ Employee.sopPoints[]    (Mongo)   ← the ledger
             ↑ c1Service.js        (C1 task deductions)
             ↑ Policy / C4Config   (C4 attendance)
             ↑ timerSop.service.js (C3 idle pool, C4 overtime reward)
             ↑ goal-credit         (C2 rewards)
                  ↓
             pmpService.js → C1–C4 score → /coworking/pmp
```

## Band configuration — adjacent, and required

`routes/soproutes/bandConfig.routes.js` + `models/BandConfig.js`. **A single
document, ever** (`BandConfig.findOne()`).

- `bands` — named bands, each with `designations[]` and `c1Max`…`c4Max`.
- `globalSettings.c1` — `maxPoints` 35, `baseScore` 1.0, and deductions:
  `deadline` 0.2, `extension` 0.1, `rework` 0.2, `reject` 0.3.
- `globalSettings.c2.globalMaxPoints` 30.
- `getBandMaxForEmployee()` resolves designation → band → per-component maxima,
  returning `null` to fall back to global defaults.

**An employee's maximum score depends on their designation via their band.**
The new project's scoring uses a flat max per component. Adopting bands changes
what a score means, so it is an owner decision, recorded in the gap analysis —
not something to implement silently.

Endpoints: `GET /cowork/band-config` (any employee), `POST /cowork/band-config`
(CEO), `GET /cowork/band-config/designations`, `GET /cowork/band-config/employee-bands` (CEO).

## Verdict: active, and largely missing from the new project

**Not obsolete. Implement it.**

The new project has `ConductPolicy` and `ConductEvent` in `lib/domain/work.ts`,
whose `severity` enum is **exactly** legacy's SOP severity enum —
`minor | moderate | serious | falsification | idle_pool`. That is the SOP rule,
already modelled. What is missing:

| Legacy | New | Status |
|---|---|---|
| `Sop.severity` | `ConductPolicy.severity` | ✅ identical |
| `Sop.department` scope | `ConductPolicy.scope` + `departmentIds` | ✅ |
| `Sop.points` | — | ❌ **missing** — policies carry no point value |
| Approval gate (`pending`→`approved`, CEO only) | — | ❌ missing |
| Folders | — | ❌ missing |
| Per-year ledger `sopPoints[]` | — | ❌ missing |
| `type: C1..C4` on each entry | — | ❌ missing |
| Signed credit/debit | — | ❌ missing |
| Recheck/dispute | `ConductEvent.disputeStatus`, `reversalLedgerEntryId` | ⚠️ **better than legacy** — reversal, not mutation |
| Manual arbitrary deduction | — | ❌ missing (deliberately?) |
| Timer-derived idle/overtime | — | ❌ missing |
| Band config | — | ❌ **entirely missing** |

The new project's dispute model is stronger: legacy mutates the bleach's
`recheck` sub-document, the new one resolves by **reversal, never by mutating the
original**. Keep the new model.

### Recommended shape

1. **Rename.** `Sop` → `ConductPolicy` (exists), `bleach` → `ConductEvent`
   (exists). Retire "bleach", "credit"/"debit" and `isCredit`.
2. **One signed `points`.** Negative = penalty, positive = credit, one
   convention, asserted by a test. This removes the inverted-vocabulary trap
   outright.
3. **Add `component: "C1"|"C2"|"C3"|"C4"`** to `ConductEvent` — SOP Points are
   cross-component and modelling them as conduct-only loses C1, C2 and C4 entries.
4. **Add the approval gate** to `ConductPolicy` — author broadly, approve
   narrowly, and refuse applying an unapproved policy with legacy's exact
   sentence.
5. **Keep reversal-based disputes.** Do not port `recheck`.
6. **Points from severity, not beside it.** Legacy's dual source with `null` on
   old rows is a migration hazard; derive the value and record the override
   explicitly where one existed.
7. **Automatic sources become ledger consumers.** Idle-pool and overtime belong
   on the availability/work-commit path already being built, writing conduct
   events through the same idempotency discipline.
8. **Band config is a separate decision.** Do not fold it in silently.

## Open questions for the owner

1. **Bands** — adopt designation-based maxima, or keep flat maxima?
2. **Manual arbitrary deductions** — keep the escape hatch, or require a policy?
3. **Overtime as reward** — legacy pays C4 credit for after-hours work. The new
   product treats after-duty work as *consuming budget*. **These two rules point
   in opposite directions** and cannot both be right.
4. **Reading anyone's history** — `GET /bleach/:employeeId` appears unscoped.
   Confirm intended visibility.
5. `CW-DEV-PMP-01 v1.0` (June 2026), the real scoring spec cited throughout
   `pmpService.js`, **is in neither repository**. Still blocking for exact
   scoring parity.
