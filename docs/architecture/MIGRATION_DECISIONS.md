# Migration Decisions — Cowork

**Date:** 2026-07-25
**Status:** Recorded. Decisions D1–D22 are settled by the owner and are binding on all subsequent work. Section 3 lists what remains open.

---

## 1. Settled Decisions

### Design and code

**D1 · The new Impeccable UI is the visual authority.**
`DESIGN.md`, the Impeccable design system, and the existing app shell in `/Users/risheeray/Documents/cowork` are the single source of truth for anything visual. No legacy screenshot, layout, or component informs how the new product looks.

**D2 · Legacy workflow behaviour is a reference, not code to copy.**
The legacy repositories answer *what the product does*: state transitions, validations, permissions, notifications, scoring events, edge cases. They do not answer *how it should be built*. Every behaviour carried forward is re-implemented from the specification, not ported.

**D3 · No legacy CSS or layout structures.**
No `lib/coworkStyles.js`, no `lib/designTokens.js`, no inline style objects, no shadcn/Radix component defaults, no legacy layout scaffolding. Legacy styling is the reason the rewrite exists.

**D4 · No giant page components.**
`app/coworking/tasks/page.js` is 10,794 lines and `CoworkingShell.js` is 4,202. Nothing in the new system approaches this. Routes decompose into server components with client islands, and domain logic lives outside the view layer entirely.

**D5 · TypeScript.**
The legacy frontend is `my-v0-project`, almost entirely JavaScript with a stray `tsconfig.json`. `PRODUCT.md:76` requires TypeScript. All new code is TypeScript with explicit domain contracts.

**D6 · Modular domain components.**
Reusable UI components, clean folder structure, maintainable patterns (`PRODUCT.md:78`). Domain logic is separated from presentation, and neither imports the other's internals.

### Behaviour

**D7 · Rebuild task logic cleanly.**
The reachable task engine — `taskForward.js` (2,368 lines) plus `taskForward.service.js` (2,412 lines), with a near-duplicate 96 KB `taskTree.routes.js` shadowed behind it — is not refactorable. It is re-specified in [TASK_LOGIC_SPEC.md](TASK_LOGIC_SPEC.md) and rebuilt from that spec.

**D8 · Preserve real workflow behaviour.**
The legacy workflows are genuinely sophisticated and reflect real operational needs. All of the following carry forward: the multi-round deadline negotiation; the penalty-waiver decision; per-person priority with the cascade; the two-stage cross-department approval gate; the CEO-assignment gate; the receiving-TL effort-estimate gate; the self-assignment approver gate; the flow-dependent review chain (`tl_final` / `ceo_direct` / `tl_then_ceo`); rework distinct from rejection; draft chat as a pre-start negotiation thread. Simplification must not silently delete a workflow that exists for a reason.

Forward budgets were the one exception, and they were removed as a product decision rather than as a simplification — see D33.

**D9 · Fix broken behaviour.**
Behaviour that is intended-but-broken is fixed, not reproduced. Specifically:

| Fix | Legacy defect |
|---|---|
| Extension deduction applies | `c1Service.js:63` multiplies it by zero |
| Composite score floors at 0 and caps at 100 | `pmpService.js:417` does neither |
| Aggregate by points-over-points, never by averaging percentages | `pmpService.js:417` averages |
| Cancellation is reachable | `markTaskCancelled` exists and is never called |
| Completion review is permission-checked | `review-completion` has no check at all |
| Score caches are rebuildable from the ledger | Caches drift with no detection |
| C4 denominator comes from an expected-working-day calendar | Legacy derives it from ledger entries |
| One state axis | Legacy runs `status` and `completionStatus` in parallel |
| Projection differs from live | `liveAnnual` and `projectedAnnual` use identical inputs |

**D10 · Managers see only their reporting hierarchy.**
The legacy behaviour where any TL sees every employee's tasks and scores does not carry forward. Every people-scoped and score-scoped query is filtered by the reporting closure. This implements `PRODUCT.md:67`.

**D11 · Add People Operations permissions.**
A designated people-operations role exists as a first-class archetype, per `PRODUCT.md:70`. Legacy has no such role.

**D12 · The score remains persistently visible.**
`PRODUCT.md:46` requires the score to be ambient. Legacy confines it to `/coworking/pmp`. The score lives in the shell and is present as people work; `/score` is for decomposition, not for discovery.

**D13 · Use the universal earned-points scoring model.**
Every scoring unit has a maximum of 1.0 unless a future approved rule says otherwise. `earnedPoints = clamp(max − deductions + credits, 0, max)`. Aggregate points-over-points. Rework deducts 0.2 per occurrence. Scores never go below 0. Full model in [SCORING_LOGIC_SPEC.md](SCORING_LOGIC_SPEC.md) §5.

**D14 · Component labels are fixed.**
`C1 · Task Execution`, `C2 · Goal Attainment`, `C3 · Conduct & Policy`, `C4 · Attendance`. Codes always appear with their label, never alone (`PRODUCT.md:52`). Note that `C3 · Conduct & Policy` deliberately resolves a legacy collision: `PRODUCT.md` called C3 "Policy" while legacy's `Policy` model is hard-locked to C4.

### Scope

**D15 · Office Monitor is excluded.**
Desktop screenshot capture, application-category tracking, and agent tamper detection do not migrate. The separate `grav-office-monitor` Firebase project is not carried over.

**D16 · MRF is excluded.**
Material-request functionality is ERP leakage into the Cowork frontend and does not migrate.

**D17 · Unrelated ERP modules are excluded.**
Accounting, inventory, manufacturing, QC, dispatch, sales/CRM, payroll, vendor and customer portals, barcode hardware, and the Tally/Setu/GSTIN integrations. Roughly 90% of the legacy backend.

**D18 · No complete ERP backend migration.**
The new backend is Cowork-only. The legacy monolith continues to serve its non-Cowork modules independently.

### Architecture and security

**D19 · No Firestore + MongoDB dual-write score architecture.**
C1 computing in Firestore while writing its ledger to MongoDB, with C3 and C4 read only from MongoDB, across no transaction, is the root cause of the drift, race, and reproducibility defects.

**D20 · One authoritative datastore.**

**D21 · Security baseline.**
- **No plaintext passwords**, including temporary ones. Legacy stores `tempPassword` in Firestore (`cowork.js:399`).
- **No unauthenticated admin bootstrap.** Legacy's `POST /cowork/setup/seed-ceo` creates a CEO account with no authentication.
- **No frontend secrets.** Legacy's frontend repository references `FIREBASE_PRIVATE_KEY`, `GOOGLE_SERVICE_ACCOUNT`, `CLOUDINARY_API_SECRET`.
- **No production debug or repair endpoints.** Legacy ships `force-repair-self-assign` and `self-assign-debug/:employeeId` **with no auth middleware at all**, plus `task/dump`, `employee/dump`, `test-email`, `audio/test-gemini`, `timer-sop/test-finalize`, and a `/coworking/fix-priorities` page.
- Additionally, and following from the same principle: the exposed eTimeOffice credentials in `services/BiometricSyncService.js:8-10` must be rotated regardless of migration timing.

**D22 · AI positioning.**
AI meeting assistance may remain as an optional, opt-in feature. **Cowork must not be positioned as an AI product** — not in navigation, not in interface copy, not in product narrative (`PRODUCT.md:30`, `:99`).

---

## 2. Decisions Implied by the Above

Recorded so they are not re-litigated:

| # | Implication | Follows from |
|---|---|---|
| D23 | Priority changes become server-mediated, permission-checked and audited | D9, D21 — legacy writes them client-side to Firestore with no check |
| D24 | Timers and work commits become server-mediated | D19, D21 — they feed scoring and are currently client-written |
| D25 | Task deletion becomes soft-delete with tombstones | D9 — hard recursive delete orphans the ledger and files |
| D26 | The score ledger is immutable and append-only, with rule versioning and config snapshots | D13, D20 — history must be reproducible after configuration changes |
| D27 | Roles are configurable data, not string literals; no magic IDs like `E000` | D11, `PRODUCT.md:115` |
| D28 | The reporting hierarchy is time-bounded | D10 — a Q2 score must be visible to whoever managed that person in Q2 |
| D29 | Every external system sits behind an adapter | D18, D20 |
| D30 | API is versioned under `/api/v1/*` | D18 — legacy exposes a bare `/cowork` prefix with no version |
| D31 | No IST hard-coding; timezone and office schedule are configuration | `PRODUCT.md:115` — legacy hard-codes `5.5 * 3600000` in four places |
| D32 | Datastore access rules are committed to the repository and reviewable | D21 — legacy's Firestore rules are absent and unauditable |

---

## 2a. Decisions Taken After Migration Began

**D33 · Forwarding and folders are removed. (2026-07-27, owner decision.)**
Two legacy concepts are deliberately gone from the product, not deferred:

- **Forwarding** — the Forward button, `forwardTask`, the per-recipient time
  budget and its `forwarded_in` / `forwarded_out` flow channels. It handed a
  slice of the sender's window to somebody else and produced a child task that
  stated no purpose. **Subtasks replace it.** A subtask must claim at least one
  of the parent's completion requirements, so the same delegation now carries a
  contract that forwarding never had, and the parent's completion is gated on
  it. This narrows D8: forwarding was a real workflow, and it is superseded
  rather than simplified away.
- **Folders** — the `Folder` record, the `folder` task type, `Task.folderId`
  and the Folders tab. They were organisational only, and half the feature was
  never wired: `createFolder` and `moveTaskToFolder` existed on the repository
  with no control anywhere calling them, so a folder could not be created or
  a task moved in or out of one. **Projects are the grouping construct.**

Both were removed from the domain, the repository, the store, the seed and the
UI in one change; `MOCK_STORE_SCHEMA_VERSION` went to 4 so a persisted store
from before the change is discarded rather than restoring the dead collections.
Do not reintroduce either from the legacy audit — `taskForward.js` remains in
`cowork-old-backend` and describes a product decision that no longer holds.

---

## 3. Open — Blocking

Work cannot responsibly begin on the affected areas until these are answered.

### 3.1 Blocking everything scoring-related

| # | Decision | Why blocking |
|---|---|---|
| **O1** | **Obtain `CW-DEV-PMP-01 v1.0` (June 2026)** and the "PDF §3.4 C3 table" | Cited throughout `pmpService.js` and `sop_model.js`; in neither repository. It is the actual scoring specification, and `PRODUCT.md` contradicts it |
| **O2** | Component weights across C1–C4 | `PRODUCT.md:61` says fixed and non-configurable; legacy is configurable at two layers with conflicting defaults. **Escalated:** this blocks the *composite* too, not just the components. Any single overall figure requires a weighting — pooling units weights by event volume (attendance 67%), averaging percentages weights equally. There is no neutral aggregation, so the composite is provisional until O2 lands, and no point decomposition may be displayed. See `SCORING_LOGIC_SPEC.md` §5.3 |
| **O3** | Reporting period and score finalisation | Legacy is quarterly with a 10/20/30/40 annual weighting, never finalised |
| **O4** | Rejection score effect | Legacy zeroes the whole unit; the owner explicitly withheld approval |
| **O5** | Attendance: lateness rate, grace period, absence, half-day, early departure, credits | Proportional lateness is confirmed; no values are |
| **O6** | Missed-deadline, extension, cancellation, late-submission deductions | Two conflicting legacy defaults for the first; the second is broken; the third is unreachable |
| **O7** | Conduct (C3) deduction values and whether C3 uses the 1.0-unit model or is purely subtractive | |
| **O8** | Goal (C2) deduction rules — is partial credit possible? | Legacy is binary per component |
| **O9** | Multi-assignee attribution | Legacy scores `assigneeIds[0]` only; other assignees are unmeasured |

### 3.2 Blocking task rebuild

| # | Decision |
|---|---|
| **O10** | Should P1 be exclusive per employee? |
| **O11** | Which renumbering semantic — contiguous, or preserve-the-set? The two legacy UIs disagree |
| **O12** | Is downward re-prioritisation allowed? Blocked in drag, allowed in the direct setter |
| **O13** | Priority range and the meaning of P3–P9. Legacy clamps 1–10 on the frontend, is unbounded on the backend, and labels only three values |
| **O14** | Are the 50%/70% extension-penalty zones a real product rule? |
| **O15** | Timeout or escalation for unanswered deadline proposals? Legacy waits indefinitely |
| **O16** | Who may approve an extension — the creator, or any manager? The two legacy mechanisms disagree |
| **O17** | Cancellation semantics and who may cancel |
| **O18** | Does rework-waiver survive, and if so who may waive and must it be audited? |
| **O19** | Is rejection final, or resubmittable? Legacy allows silent resubmission |
| **O20** | Repeat and third-party tasks: in scope, and do they score? Neither scores today |

### 3.3 Blocking architecture

| # | Decision |
|---|---|
| **O21** | Which single authoritative datastore (D20 settles the principle, not the choice) |
| **O22** | Keep Firebase Auth, or move identity with the datastore? |
| **O23** | Google Workspace v1 scope — recommendation is Calendar + Drive picker only |
| **O24** | Do AI meeting features ship in v1, or post-v1? |
| **O25** | eTimeOffice or TeamOffice — which provider is live? |
| **O26** | Where are the legacy Firestore security rules? They govern the entire client-write surface and could not be audited |
| **O27** | Does a mobile app consume this API? `expo-server-sdk` and `Appversion.js` suggest one exists outside these repositories |

### 3.4 Blocking permissions

| # | Decision |
|---|---|
| **O28** | The five role archetypes, and this organisation's names for them |
| **O29** | Does score visibility follow only the primary reporting line, or also secondary/dotted? |
| **O30** | How many levels does skip-level span? |
| **O31** | May People Operations apply conduct deductions, or only administer the catalogue? |
| **O32** | Approval delegation during leave — legacy has no such concept |

---

## 4. Explicitly Not Carried Forward

| Item | Reason |
|---|---|
| `routes/task_routes/taskTree.routes.js` (96 KB) | Shadowed by `taskForward.js`; an abandoned earlier draft |
| The shadowed half of `coworkEnhanced.js` | Same |
| `services/taskForward.service.js` ↔ `routes/task_routes/taskForward.js` near-duplication (118 KB each) | One implementation |
| `Middlewear/` (misspelled) alongside `middleware/` | One directory |
| Three toast systems (`hooks/useToast.js`, `utils/toast.js`, `components/ToastProvider.js`) plus `sonner` and `react-hot-toast` | One |
| Duplicate hooks (`use-toast`, `use-mobile`, `useCoworkGroups` in both `.js` and `.ts`) | One each |
| `app/globals.css` alongside `styles/globals.css` | One |
| `/task/assign`, `PATCH /task/:taskId/progress`, `GET /task/list` (`cowork.js:639-652`) | Superseded dual API |
| `/direct-message/conversations` v1 | Superseded by `conversations-v2` |
| `/deadline-availability/blocked-dates` | Duplicate of `/scheduling/blocked-dates` |
| `MONGO_URI` alongside `MONGODB_URI`; four overlapping frontend-URL vars; two Google OAuth env sets; `VAPID_EMAIL` alongside `VAPID_SUBJECT` | Consolidated configuration |
| The `+6h "BRANDED PROBE"` due-date fallback (`taskForward.js:1625`, `:1707`) | A silent six-hour deadline shift used as a debug marker, in production |
| `console.log("yugyu")` (`cowork.js:41`), `[C4 DEBUG]` (`pmpService.js:369`) | Debug output on request paths |
| Root-level migration scripts (`update_from_excel.js` 140 KB, `test.js` 94 KB, `backfill_leaves.js`, `fix-*.js`, `syncIdentityID.js`) | Operational scripts, not product |
| Task forwarding and its budget allocation (`taskForward.js`) | Removed 2026-07-27 — see D33 |
| Folders | Removed 2026-07-27 — see D33 |
| `employee_import_template.xlsx` (0 bytes) | Empty placeholder |
| Supabase env references | No Supabase dependency exists |
| Expo push | No mobile app in scope |
| `lib/patternGradingEngine.js`, `components/DashboardLayout.js`, `services/schedulingService.js`, `setup-ceo.js`, `pages/api/upload-to-drive.js`, `CreateSubtaskModal.js` | Unreferenced dead code in the legacy frontend |
