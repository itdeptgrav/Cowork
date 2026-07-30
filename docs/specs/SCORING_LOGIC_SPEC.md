# Scoring Logic Spec — Cowork

**Date:** 2026-07-25
**Purpose:** Document legacy scoring exactly as it behaves, then define the owner-confirmed universal earned-points model and the immutable ledger that replaces it.

Labels per [LEGACY_BEHAVIOUR_SPEC.md](LEGACY_BEHAVIOUR_SPEC.md) §0.

---

## 1. The External Specification

The scoring engine cites a document that is **not in either repository**:

| Reference | Cited at | Sections referenced |
|---|---|---|
| **`CW-DEV-PMP-01 v1.0`, June 2026** | `services/pmpService.js:8` | "PDF Section 03" (quarter weights), "Section 05" (gap to next rating), "Section 09" (dashboard flags), plus formula notes at `:64`, `:143`, `:270`, `:436` |
| **"PDF §3.4 C3 table"** | `models/sopmodel/sop_model.js:8` | C3 severity → deduction mapping |

**This must be obtained before any scoring work.** The code is an implementation of it, `PRODUCT.md` contradicts it in several places, and the owner's confirmed model in §3 below differs from both.

---

## 2. Legacy Architecture — Where Each Component Lives

| Component | Computation | Storage |
|---|---|---|
| **C1 · Task Execution** | `services/c1Service.js` | Firestore `cowork_tasks.c1{}` + cache `cowork_c1_scores/{employeeId}` + **MongoDB** `Employee.sopPoints` ledger entries |
| **C2 · Goals** | `services/pmpService.js:148` + `routes/task_routes/c2Band.routes.js` | Firestore `cowork_tasks.c2Config` / `goalActivities[]` + cache `cowork_c2_scores/{employeeId}` |
| **C3 · Conduct** | `services/pmpService.js:279` | **MongoDB only** — `Employee.sopPoints[year].bleaches[]` where `type === "C3"` |
| **C4 · Attendance** | `services/pmpService.js:332` + `models/HR_Models/C4Config.js` | **MongoDB only** — same array, `type === "C4"` |
| **Composite** | `services/pmpService.js:417` | Computed on read; never stored |

**The defining structural problem:** C1 computes in Firestore but writes its ledger to MongoDB. C3 and C4 read only MongoDB. There is no transaction spanning the two, no reconciliation job, and no consistency guarantee. Every score is a dual-store read.

### 2.1 The bleach ledger (legacy's ledger attempt)

`Employee.sopPoints[]` = `[{ year, totalDeducted, bleaches[] }]`. Each bleach:

```
sopName, type ("C1"|"C2"|"C3"|"C4"), points (always POSITIVE),
bleachType ("credit" = penalty | "debit" = reward), isCredit,
folderName, description, date (YYYY-MM-DD),
cutBy, cutByName, cutByRole, taskId, policyId,
recheck { status, requestedAt, requestNote, reviewedBy, reviewedByName, reviewedAt, reviewNote }
```

The intent is sound — an append-only event log with dispute handling. The execution is not:

| Defect | Evidence |
|---|---|
| Two sign conventions in one file: `computeC3ForEmployee` filters on `bleachType`, `getSOPBreakdown` derives sign from `isCredit` | `pmpService.js:295` vs `:404` |
| The convention is documented as having been **inverted** in two places and later corrected | `c1Service.js:359-363`, `:401-403` |
| Entries are mutated in place for recheck, not superseded | `soproute.js` recheck PATCH |
| No rule ID, no rule version, no config snapshot — a config change silently rewrites history | — |
| Nested inside the employee document, so it grows unboundedly and cannot be queried independently | `models/Employee.js:254` |
| Written via `employee.save()` on a read-modify-write — lost-update race under concurrency | `c1Service.js:183` |

---

## 3. Legacy C1 — Full Trace

### 3.1 Documented vs implemented formula

**Header comment** (`c1Service.js:5-15`):
```
taskScore   = base − (deadlineDeduction × missed) − (extensionDeduction × filed) − (reworkDeduction × reworks)
qualityRate = MAX( Σ(taskScore × etcHours) ÷ Σ(etcHours), 0 )
C1 Net      = qualityRate × c1MaxPoints
```

**Implementation** (`c1Service.js:58-95`) — differs on three counts:

```js
// line 58-67
taskScore = isRejected
  ? c1RejectScore
  : MAX(0, base
          − (deadlineDeduction × deadlinesMissed)
          − 0 * extensionsFiled                      // ← ①  MULTIPLIED BY ZERO
          − (reworkDeduction × reworksReceived)
          − (rejectScore × rejectionsReceived))      // ← ②  reject value reused as a multiplier

// line 74-90 — ③ UNWEIGHTED MEAN, not ETC-weighted
qualityRate = MAX( Σ(taskScore) ÷ count , 0 )

// line 92-95 — ④ c1MaxPoints accepted and IGNORED
c1Net = qualityRate × 100
```

| # | Defect | Label |
|---|---|---|
| ① | The extension deduction never affects a task score. `c1.extensionsFiled` still increments and a −0.2 ledger entry is still written, so the ledger and the score disagree about the same event | **INTENDED BUT BROKEN** |
| ② | `c1RejectScore` is both the override value for a rejected task *and* a per-rejection deduction multiplier. At the default of `0` this is invisible; set it to anything else and it does two contradictory jobs | **INTENDED BUT BROKEN** |
| ③ | Comment says ETC-weighted; code is an unweighted mean. An in-code comment at `:75-77` explains the change, so the header is simply stale | **FE/BE CONTRADICTION** (doc vs code) |
| ④ | `calculateC1Net(qualityRate, c1MaxPoints)` ignores its second argument. Every band-specific `c1Max` computed at `:194` and `:277` is dead for scoring | **INTENDED BUT BROKEN** |

### 3.2 Configuration — two conflicting sources

| Value | `c1Service.C1_DEFAULTS` (`:23-30`) | `BandConfig.globalSettings.c1` (`BandConfig.js:17-22`) |
|---|---|---|
| max points | 35 | 35 |
| base score | 1.0 | 1.0 |
| deadline deduction | **0.5** | **0.2** |
| extension deduction | **0.2** | **0.1** |
| rework deduction | 0.2 | 0.2 |
| reject | **0** | **0.3** |

Three of six values disagree. Live overrides come from Firestore `cowork_sop_settings/task_events`; per-band overrides come from MongoDB `BandConfig.bands[bandName]` resolved by the employee's HR `designation`. **Duplicate implementation with divergent defaults.**

This also directly contradicts `PRODUCT.md:61` ("component weights are fixed product-wide … Weighting is not a configurable surface") — legacy has **two** layers of configurability.

### 3.3 Scoring window and triggers

- **Quarterly.** `_updateC1ScoreCache` filters `where("quarter","==",q).where("year","==",y)` (`c1Service.js:281-288`); `quarter`/`year` are stamped at task creation.
- **Fires on:** final approval (`tl_final_approved` / `ceo_approved`) and TL rejection (`service:1335`); CEO approval (`service:1496`). **Not** on the intermediate `tl_approved`; **not** on CEO rejection.
- **Cache refresh gated on `etcHours > 0`** (`c1Service.js:259`) although the quality-rate calculation no longer requires ETC (`:75-77`). Employees whose tasks all have zero ETC never get a cache update. **INTENDED BUT BROKEN.**
- **Deadline miss** measured as `submittedAt > (c1.officialDeadline || dueDate || fixedDeadline)`; if `submittedAt` is absent, **"now" is used**, so approving late marks a miss that the employee did not cause (`c1Service.js:203`).
- **Cancelled tasks:** `markTaskCancelled` sets `isExcluded`, `c1Status: "cancelled"`, `taskScore: null` — **but nothing calls it** (see [TASK_LOGIC_SPEC.md](TASK_LOGIC_SPEC.md) §9.2). **INTENDED BUT BROKEN.**
- **`c1/preview` omits `rejectionsReceived`** from its `calculateTaskScore` call (`c1Routes.js:107`) while the real path passes it — preview diverges from the committed score.

---

## 4. Legacy C2, C3, C4, Composite

### 4.1 C2 · Goals (Gold Tasks)

- A gold task carries `c2Config.weightagePercent`. **All active gold tasks must sum to ≤ 100%**, hard-blocked before creation by `POST /cowork/c2/validate-weightage` (`c2Band.routes.js:189`). *This answers `PRODUCT.md:90` — C2 cannot exceed target.*
- Decomposes into `goalActivities[]`, each with `points` and its own `deadline`. Multi-user gold uses `perUserStatus[employeeId]`.
- A component earns its points only when `status === "done"` **and** `lateSubmission !== true` (`pmpService.js:215`).
- `c2Score = ptsEarned / ptsAssigned`; `c2Net = c2Score × 100`.
- **Annual-running, not quarterly** — the same C2 value is reused for every quarter in the annual roll-up (`pmpService.js:448`).
- `ptsPastDeadline` is computed and carried in the API response but has **no live consumer** (`pmpService.js:164`). Dead field.

### 4.2 C3 · Conduct

Reads MongoDB `sopPoints[year].bleaches[]` where `type === "C3"` **and** `bleachType === "credit"` (penalties only), within the quarter's month range, skipping entries whose `recheck.status === "confirmed"` (overturned). Returns `c3Net = 0 − totalDeductions` — always ≤ 0. Correctly deduction-only, matching `PRODUCT.md:58`.

**Vocabulary collision:** `PRODUCT.md:58` names C3 "Policy". In legacy, C3 is the **SOP/conduct** system, and the Mongoose model literally named `Policy` is **hard-locked to C4** (`Policy.js:45`: `enum: ["C4"]`). Migrating on the word "policy" wires the wrong subsystem. The owner's confirmed label — **C3 · Conduct & Policy** — resolves this.

Severity tiers exist on the SOP catalogue: `minor`, `moderate`, `serious`, `falsification`, `idle_pool` (`sop_model.js:12`), each mapped to a point value by the missing PDF §3.4.

### 4.3 C4 · Attendance

```
basePoints  = (distinct dates with any C4 ledger entry this quarter) × basePointsPerDay
penalty     = Σ points of non-"debit" C4 entries this quarter
finalPoints = basePoints − penalty
c4Net       = (finalPoints ÷ basePoints) × 100
```

Config (`C4Config.js`): `basePointsPerDay: 1`, `lateArrivalPoints: 1`, `absencePoints: 3`, `earlyDeparturePoints: 1`, `lateThresholdMins: 15`, `earlyThresholdMins: 0`, `nonWorkingStatuses: ["WO"]`. An always-on hourly presence engine with a 7-day lookback credits the daily base point, throttled by `lastPresenceRunAt`.

**Structural fragility:** the denominator is derived from *days that happen to have a ledger entry*, not from a working-day calendar. A missed presence-engine run shrinks the denominator and **silently inflates** the score. `pmpService.js:369` logs `[C4 DEBUG]` on every computation, which is how this was being watched.

**Lateness is a flat penalty per instance.** There is no proportional model — 1 minute late over the threshold costs the same as 3 hours. The owner's confirmed model requires proportional lateness (§5.5).

Attendance thresholds are defined in **three** places: `LATE_THRESHOLD_MINS` env var, `C4Config.lateThresholdMins`, and `Policy.thresholdMins`. Duplicate implementation.

### 4.4 The composite — do not carry this forward

```js
// pmpService.js:417-424
function computeBaseScore({ c1Net, c2Net, c4Net, c3 = 0 }) {
  const components = [c1Net, c2Net, c4Net].filter(v => v !== null && v !== undefined);
  const avg = components.length ? components.reduce((s,v) => s+v, 0) / components.length : 0;
  if (components.length === 0 && (c3 || 0) === 0) return null;
  return +(avg + (c3 || 0)).toFixed(2);
}
```

| Defect | Consequence |
|---|---|
| **Averages percentages** | Components with different possible-point totals are given equal say |
| **Unweighted** | Contradicts `PRODUCT.md:61` (fixed product-wide weights) |
| **Null components dropped from the divisor** | A new employee with only C4 data is scored purely on attendance |
| **No floor at 0, no cap at 100** | `avg + c3` goes negative with a large C3. Contradicts `PRODUCT.md:59` |
| `computePaceScore` and `computeQuarterScore` are **identical passthroughs** | Dead abstraction |
| The comment above them (`:270-275`) documents a completely different pace formula | Never implemented |

**Annual roll-up** (`pmpService.js:439-508`): quarter weights `{Q1 0.10, Q2 0.20, Q3 0.30, Q4 0.40}`, normalised by the weights actually used. `liveAnnual` and `projectedAnnual` are computed from **identical inputs** (`:468` and `:487` call the same function with the same arguments) — the projection is not a projection.

**Ratings:** ≥95 Exceptional · ≥85 Strong · ≥70 Solid · ≥50 Developing · <50 Critical.
**Flags:** `PACE-CRITICAL` (<30 after day 30), `PACE-WARNING` (<60), `C2-WARNING` (hit rate <0.5), `ANNUAL-CRITICAL` (<50 after day 45), `ON-TRACK` (≥85, no other flags).

### 4.5 What legacy answers that `PRODUCT.md` calls undecided

| `PRODUCT.md` | Legacy | Source |
|---|---|---|
| `:87` weight values undecided | C1 max 35, C2 max 30; quarters 10/20/30/40% | `BandConfig.js:17,25`; `pmpService.js:20` |
| `:88` C3 breach definition undecided | 5 severity tiers | `sop_model.js:12` |
| `:89` C4 measurement undecided | +1/day, −1 late >15m, −3 absent, −1 early | `C4Config.js:23-32` |
| `:90` C2 over-target undecided | Capped by a hard 100% pool | `c2Band.routes.js:189` |
| `:91` scoring period undecided | Quarterly + weighted annual | `pmpService.js:20,281` |

**None of these is authoritative.** They are implementations of the missing PDF, and the owner's confirmed model in §5 supersedes the parts it covers.

---

## 5. The Universal Scoring Model — Owner-Confirmed

**OWNER-CONFIRMED NEW RULE.** This replaces the legacy model entirely. It applies to **all** components, not only C1.

### 5.1 Labels

- **C1 · Task Execution**
- **C2 · Goal Attainment**
- **C3 · Conduct & Policy**
- **C4 · Attendance**

Per `PRODUCT.md:52`, codes always appear alongside their label, never alone.

### 5.2 The unit

> Every measurable scoring unit has a maximum value of **1.0 point** unless an approved future rule specifies otherwise.
> A perfect unit earns **1.0**. Deductions reduce that unit's earned points.

| Component | One scoring unit is… |
|---|---|
| C1 | One completed task (or one completed scoring-eligible task occurrence) |
| C2 | One goal component / activity |
| C3 | One conduct event *(sign and unit shape — **OWNER DECISION REQUIRED**, see §6)* |
| C4 | One expected attendance day |

### 5.3 The formulae

```
earnedPoints = clamp(maximumPoints − totalDeductions + approvedCredits, 0, maximumPoints)

unitPercentage      = earnedPoints / maximumPoints × 100

componentPercentage = Σ earnedPoints across the component
                    ÷ Σ possiblePoints across the component
                    × 100

overallPercentage   = Σ earnedPoints across all included components
                    ÷ Σ possiblePoints across all included components
                    × 100
```

**Never average percentages when possible points differ.** This is the specific defect in `pmpService.js:417` and must not be reproduced. Within a component, aggregation is always points-over-points.

> **CORRECTION — pooling across components is itself a weighting (O2).**
>
> An earlier revision of this section applied the same formula *across* C1–C4 and described the result as asserting no weighting. That was wrong, and the error reached the interface before it was caught.
>
> Pooling every unit into one denominator weights each component **by its unit count**. With 18 attendance days, 7 goal units, 1 completed task and 1 conduct unit, the composite is 66.7% attendance and 3.7% task execution — an employee who executed every task perfectly sees a composite dominated by punctuality. Nobody chose that split; it is an artefact of how many events each component happens to generate, and it moves every time the mix of work changes.
>
> Both available aggregations therefore assert something: averaging percentages weights components equally, and pooling weights them by volume. Neither is neutral, and **the neutral option does not exist** — a single composite figure requires a weighting by definition. O2 is consequently a blocking decision for the composite specifically, not only for the components.
>
> Until it is resolved:
> - the engine keeps pooling, because it is at least traceable to real events;
> - the composite is labelled **provisional at every point of display**;
> - **`earnedPoints` and `possiblePoints` are never rendered as a decomposition.** Points shown side by side under four channels, or summed into one total, publish the split directly. `PRODUCT.md:87` forbids displaying or implying a weighting, `PRODUCT.md:107` forbids a computed-looking breakdown, and DESIGN.md's No Weighting Rule forbids drawing the channels as slices of one total. Those fields exist for the ledger and for arithmetic, not for the interface;
> - surfaces state **unit counts** instead. "18 units measured" carries the same traceability and asserts nothing about worth.
>
> A single channel shown alone — on `/score/c4`, say — may still show its own points against its own maximum. That comparison has nothing beside it to divide against.

### 5.4 Confirmed rules

| Rule | Value |
|---|---|
| Normal maximum per scoring unit | **1.0** |
| Perfect unit | **1.0** |
| Task rework deduction | **0.2 per rework** |
| Deductions | **Accumulate** |
| Floor | **0** — a score can never go below 0 |
| Ceiling | Normal scores cannot exceed their maximum |
| Foundation | Task, goal, conduct and attendance all use the same earned-points foundation |
| Attendance lateness | **Proportional**, not flat |
| Traceability | **Every score must be traceable to source events** |

**Worked example — rework (confirmed):**

| Reworks | Arithmetic | Earned | Unit % |
|---|---|---|---|
| 0 | 1.0 − 0.0 | 1.0 | 100% |
| 1 | 1.0 − 0.2 | 0.8 | 80% |
| 2 | 1.0 − 0.4 | 0.6 | 60% |
| 5 | 1.0 − 1.0 | 0.0 | 0% |
| 7 | clamp(1.0 − 1.4, 0, 1.0) | 0.0 | 0% |

Legacy's rework arithmetic already matches this exactly (`c1Service.js:23-30, 58-67`). It is the one legacy deduction that survives unchanged.

**Worked example — component aggregation (confirmed method):**

An employee closes 4 tasks: two clean, one with 1 rework, one with 2 reworks.
```
earned   = 1.0 + 1.0 + 0.8 + 0.6 = 3.4
possible = 4 × 1.0               = 4.0
C1       = 3.4 / 4.0 × 100       = 85%
```
Legacy would reach the same number here only because every unit has an identical maximum. As soon as maxima differ — which C2 components and C4 days will — the points-over-points method and the average-of-percentages method diverge. Use points-over-points.

### 5.5 Attendance

> Each expected attendance day is one scoring unit with maximum **1.0**.
> A perfect attendance day earns **1.0 = 100%**.
> Lateness uses **proportional deduction**: `latenessDeduction = lateDuration × configuredRate`.
> Duration is stored internally in **minutes**.
> **The exact rate is not confirmed.**

**Explicitly not to be invented** — every one of these is **OWNER DECISION REQUIRED**:
deduction per minute or hour · grace period · absence deduction · half-day treatment · early-leaving deduction · attendance credits · overtime credits.

The denominator must come from an **expected-working-day calendar**, not from "days that happen to have a ledger entry" as legacy does (§4.3). A day with no events is a day earning 1.0, not a day that vanishes from the denominator.

---

## 6. Unconfirmed Values — OWNER DECISION REQUIRED

None of these may be invented, and none may be silently inherited from legacy. Legacy's value is shown only as evidence of what was once implemented.

| # | Value | Legacy implementation | Notes |
|---|---|---|---|
| S1 | Missed-deadline deduction | 0.5 (`c1Service`) **or** 0.2 (`BandConfig`) | Two conflicting defaults |
| S2 | Extension deduction | 0.2 configured, **applied as 0** | Broken in legacy |
| S3 | Rejection deduction | Zeroes the whole unit (`c1RejectScore`, default 0) | **Owner explicitly withheld approval** |
| S4 | Cancellation treatment | Designed as excluded (`isExcluded`) but **never triggered** | Exclude vs zero |
| S5 | Late-submission deduction | Not separate from deadline miss | |
| S6 | Priority score effect | **None** | Confirm that priority stays score-neutral |
| S7 | Goal (C2) deductions | Binary per component: late or not-done → 0 | Is partial credit possible? |
| S8 | Conduct (C3) deductions | 5 severity tiers, values in the missing PDF | |
| S9 | Lateness rate | Flat 1 point per instance | Must become proportional |
| S10 | Grace period | 15 min (`lateThresholdMins`), defined in 3 places | |
| S11 | Absence deduction | 3 points/day | |
| S12 | Half-day treatment | `HALF_DAY_THRESHOLD_MINS` env, unused by C4 | |
| S13 | Early-departure deduction | 1 point/instance | |
| S14 | Credits and bonuses | `bleachType: "debit"` exists; C4 base point uses it | Do rewards exist in the new model? |
| S15 | Component weights | Unweighted mean of C1/C2/C4 + raw C3 | `PRODUCT.md:61` says fixed and non-configurable; legacy is doubly configurable |
| S16 | Reporting period | Quarterly + weighted annual (10/20/30/40) | |
| S17 | Score finalisation | **Never finalised** — recomputed on every read | Determines whether history is reproducible |
| S18 | Multi-assignee attribution | `assigneeIds[0]` only | Others unmeasured |
| S19 | Does C3 use the 1.0-unit model, or is it purely subtractive? | Purely subtractive | The universal model implies units; C3 may be the exception |
| S20 | Are third-party and repeat tasks scoring-eligible? | Neither scores | |

---

## 7. The Immutable Score Ledger

Every score-changing event appends one entry. **Nothing is ever deleted or mutated.** Corrections are new entries that reference what they reverse.

### 7.1 Required fields

| Field | Type | Purpose |
|---|---|---|
| `id` | string | Ledger entry ID |
| `employeeId` | string | Subject |
| `component` | `"c1" \| "c2" \| "c3" \| "c4"` | |
| `sourceType` | `"task" \| "goal_activity" \| "conduct_event" \| "attendance_day" \| "manual"` | |
| `sourceId` | string | Task ID, activity ID, attendance date, … |
| `eventType` | e.g. `task_completed`, `rework_applied`, `deadline_missed`, `extension_charged`, `rejection_applied`, `late_arrival`, `absence`, `conduct_breach`, `manual_adjustment`, `reversal` | |
| `maximumPoints` | number | The unit's maximum — **stored, not derived** |
| `deduction` | number ≥ 0 | Magnitude |
| `credit` | number ≥ 0 | Magnitude |
| `pointsBefore` | number | Unit earned points before this entry |
| `pointsAfter` | number | Unit earned points after, already clamped |
| `reason` | string | Human-readable |
| `actorId` | string \| `"system"` | Who caused it |
| `actorRole` | string | Role at the time |
| `effectiveDate` | ISO date | The date the event *belongs to* (drives period bucketing) |
| `createdAt` | ISO timestamp | When it was recorded |
| `ruleId` | string | Which rule produced it |
| `ruleVersion` | string | Version of that rule |
| `configSnapshot` | object | The exact parameter values used |
| `isManualAdjustment` | boolean | |
| `adjustmentReason` | string \| null | Required when manual |
| `reversalOf` | ledger id \| null | Set on reversal entries |
| `periodKey` | string | e.g. `2026-Q3` — resolved at write time |

### 7.2 Invariants

1. **Append-only.** No update, no delete.
2. `pointsAfter === clamp(pointsBefore − deduction + credit, 0, maximumPoints)` — verifiable on every row.
3. `effectiveDate` decides the period; `createdAt` never does. A late-recorded event lands in the period it belongs to.
4. `configSnapshot` + `ruleVersion` make every historical score **reproducible after configuration changes** — the single most important property legacy lacks.
5. A dispute (legacy's "recheck") is resolved by writing a **reversal** entry, never by mutating the original.
6. Deleting a task must **not** delete its ledger entries. If a task is removed, write a reversal.

### 7.3 What this fixes

| Legacy defect | Fixed by |
|---|---|
| Config change silently rewrites history | `ruleVersion` + `configSnapshot` |
| Two sign conventions (`bleachType` vs `isCredit`) | Explicit `deduction` and `credit`, both ≥ 0 |
| Recheck mutates entries in place | `reversalOf` |
| Ledger nested in the employee document; unbounded growth | Standalone collection/table |
| `employee.save()` read-modify-write race | Append-only insert |
| Rejection then re-approval writes duplicate entries | Reversal on re-scoring |
| Hard task delete orphans ledger rows | Reversal, and soft-delete of tasks |
| Score not reproducible | All of the above |

### 7.4 Snapshots

`ScoreSnapshot` is a **derived cache**, never a source of truth: `{employeeId, periodKey, component, earnedPoints, possiblePoints, percentage, computedAt, ledgerHighWaterMark}`. It must be rebuildable from the ledger alone. Legacy's `cowork_c1_scores` / `cowork_c2_scores` are the same idea without that guarantee — they can drift with no way to detect it.

---

## 8. Score Visibility

From `PRODUCT.md:66-70`, and **not** what legacy does:

| Rule | `PRODUCT.md` | Legacy | Required |
|---|---|---|---|
| Individual sees own score only | `:66` | Enforced on `/c1/scores/:id`, `/c2/scores/:id` (`c1Routes.js:37`) | ✅ preserve |
| Manager sees their reports, including comparison | `:67` | **Any TL sees everyone** (`verifyCeoOrTL` on `/c1/scores`, `/c2/scores`) | ❌ must be scoped to the reporting hierarchy |
| Comparison never surfaced downward | `:69` | n/a | enforce |
| Skip-level and People Operations see beneath them | `:70` | No such role | add |
| Score is ambient and persistently present | `:46` | Confined to `/coworking/pmp` | rebuild |
| Score is decomposable to C1–C4 and the actions beneath | `:112` | Partially — `taskBreakdown`, `breaches[]` | the ledger makes this complete |

---

## 9. Validation Summary — Scoring

| Behaviour | Label |
|---|---|
| C1 rework deduction −0.2 per rework | **CONFIRMED WORKING** — and matches the owner-confirmed rule |
| C1 deadline-miss deduction | **CONFIRMED WORKING** (value disputed between two configs) |
| C1 extension deduction | **INTENDED BUT BROKEN** — multiplied by zero |
| C1 rejection zeroes the unit | **CONFIRMED WORKING** — **owner has not approved it** |
| C1 quality rate ETC-weighted | **FE/BE CONTRADICTION** — comment says weighted, code is an unweighted mean |
| `c1MaxPoints` / band maxima applied | **INTENDED BUT BROKEN** — computed then discarded |
| C1 cache refresh for zero-ETC tasks | **INTENDED BUT BROKEN** — gated on `etcHours > 0` |
| C1 preview matches committed score | **INTENDED BUT BROKEN** — omits `rejectionsReceived` |
| Cancelled tasks excluded from C1 | **INTENDED BUT BROKEN** — `markTaskCancelled` is never called |
| C2 weightage pool capped at 100% | **CONFIRMED WORKING** |
| C2 component earns only if done and not late | **CONFIRMED WORKING** |
| C2 `ptsPastDeadline` | Dead field — computed, never consumed |
| C3 deduction-only | **CONFIRMED WORKING** |
| C3 named "Policy" in `PRODUCT.md` but implemented as SOP; `Policy` model is C4 | **FE/BE CONTRADICTION** |
| C4 proportional lateness | **OWNER-CONFIRMED NEW RULE** — legacy is flat per instance |
| C4 denominator from ledger entries, not a calendar | **INTENDED BUT BROKEN** |
| Composite floors at 0 / caps at 100 | **INTENDED BUT BROKEN** — neither |
| Composite weighted | **FE/BE CONTRADICTION** vs `PRODUCT.md:61` |
| `liveAnnual` vs `projectedAnnual` differ | **INTENDED BUT BROKEN** — identical inputs |
| Multi-assignee scoring | **CONFIRMED WORKING** — `assigneeIds[0]` only, by design or accident |
| Score history reproducible after config change | **Not implemented** |
| Universal earned-points model | **OWNER-CONFIRMED NEW RULE** |
| Immutable ledger with rule versioning | **OWNER-CONFIRMED NEW RULE** |
