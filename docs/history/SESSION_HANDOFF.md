# Session Handoff

Written 2026-07-27. State at handoff: `tsc` clean, lint clean, **192 tests
passing**, `npm run build` compiles, `check-secrets` clean.

---

## Current project goal

Bring the **task module** to parity with `cowork-old-backend`, working from
`LEGACY_AUDIT.md` and the legacy source rather than assumption. Four audit
documents from this session carry the analysis:

| Document | What it holds |
|---|---|
| `TASK_MODULE_PARITY_REPORT.md` | 12 flows, legacy vs current, matching/missing/incorrect |
| `TASK_ASSIGNMENT_LIFECYCLE_AUDIT.md` | Receiver-side lifecycle, four assignment shapes |
| `TASK_MODULE_FIX_PLAN.md` | Every disparity classified A/B/C with implementation order |
| `TASK_UI_PARITY_REPORT.md` | Receiver-side UI vs legacy frontend |

`TASK_MODULE_FIX_PLAN.md` is the roadmap. Phase 0 (decisions) is complete.

---

## Workflow bugs fixed this session

Ordered by severity. Every one was found by tracing legacy or by running the
flow, not by inspection.

1. **`useAction` captured a stale closure.** `execute` was
   `useCallback(…, [])`, so every mutation submitted the values its fields held
   on FIRST render — task creation sent `title: ""` and reported "A title is
   required" against a title plainly on screen. Affected **all 64 call sites**.
   Fixed with a latest-ref written in an effect.

2. **The approval workflow could never complete.** Deciding an
   `effort_estimate` through `decideApproval` left the task deadline-mode, so
   the completion branch raised *another* effort stage — and again on the next
   decision. The task was unreleasable. `decideApproval` now refuses that kind;
   `setEffortEstimate` is its entry point.

3. **The assignee was asked to approve their own intake.** The cross-department
   chain routed to `target_department_hod`; when the assignee heads the
   receiving department (Hanne heads Operations, Maya heads Product) they were
   placed in their own approval chain. Replaced with a new
   `target_reporting_manager` rule — managers, never the receiver.

4. **The approver could not see the task.** `listTasks({scope:"all"})` narrowed
   to assigned/hierarchy/created-by for anyone without organisation `task.view`.
   A cross-department task is none of those for its approver, and has no
   assignment rows because the receiver is held back — so the request was
   raised, the approver notified, and the task invisible. Added an approver
   clause.

5. **Nobody was told their approval was needed.** `createTask` wrote approval
   records and never notified. `decideApproval` told the *next* approver, so
   every approver after the first learned it was their turn and the first never
   did.

6. **The held-back assignee was notified anyway** — `task_assigned` fired for
   people whose task is deliberately invisible to them.

7. **`side` on approvals came from array position**, so when a stage
   self-satisfied the receiving head slid to index 0 and was labelled `sender`.
   Now read from the stage's `rule`.

8. **A department boundary overrode a reporting line.** `crossesDepartment` was
   a plain department comparison, so a manager assigning to their own direct
   report across departments got a fixed deadline *and* a two-head approval.

9. **The visibility gate was missing.** Assignment rows were created during a
   cross-department gate, putting unapproved work on someone's list.

10. **A head of department could never assign outside their own department** —
    the sending stage resolved to them and blocked on self-approval. Split into
    consent stages (`onSelfApproval: "satisfied"`) versus review stages.

11. **Department heads with no head configured hard-blocked.** Legacy resolved
    through a chain (head → manager → default approver). Restored the manager
    link; message rewritten to be actionable.

12. **`nextAction` pointed at the wrong action.** It reached
    `state === "unset"` before checking for an offered window, so every list
    said "Propose a deadline" while the task offered "Accept 4h".

13. **Hardcoded viewer ids in 13 files** — `signals.ts` had
    `const VIEWER = "e-01"` at module scope. `ScoreArea` showed **Maya's score
    to everyone**; `WorkAreas` the same for attendance. Now zero.

---

## Files modified

**Domain / logic**
- `lib/auth/assignment.ts` *(new)* — the single assignment resolver
- `lib/auth/workflow.ts` — stage resolution, fallback chain, `target_reporting_manager`
- `lib/auth/can.ts` — unchanged this session, but is the enforcement layer
- `lib/domain/workflow.ts` — `onSelfApproval`, `resolvedVia`, `selfSatisfied`
- `lib/domain/tasks.ts` — `pendingAssigneeIds`, `assignorWindowRejection`
- `lib/repositories/types.ts` — `listAssignableEmployees`, `acceptAssignorWindow`, `rejectAssignorWindow`, `setEffortEstimate`, `getViewer(id?)`, `TaskView.approvals`/`pendingAssignees`
- `lib/repositories/mock/index.ts` — createTask, decideApproval, visibility, notifications
- `lib/hooks/useRepository.ts` — the stale-closure fix
- `lib/hooks/usePermissions.ts` — exposes `ctx`
- `lib/mock/seed.ts` — scopes widened to `organisation`, workflow stages → managers

**Components**
- `components/tasks/` — `NewTaskForm`, `TaskDetail`, `TaskTable`, `TaskBoard`, `TasksArea`, `DeadlinePanel`, `ChatPanel`, `statusMeta`
- *(new)* `ApprovalTrail.tsx`, `RelationshipNote.tsx`, `AssignorWindowCard.tsx`, `relationshipCopy.ts`
- `components/dashboard/` — `signals.ts`, `Stats.tsx`, `AttentionCard.tsx`, `NowCard`, `Chrome`
- 13 files de-hardcoded from `"e-01"`

**Help knowledge** — `lib/help/knowledge.ts` updated alongside every user-facing
change, per `CLAUDE.md`.

**Development persistence** *(added 2026-07-27, to make the above verifiable)*
- `lib/config/mockPersistence.ts` *(new)* — the flag and storage key
- `lib/repositories/mock/persistence.ts` *(new)* — load / save / clear
- `lib/repositories/mock/persistence.test.ts` *(new)* — 11 tests, mostly on the
  fallback paths
- `lib/repositories/mock/store.ts` — restores at module init, clears on reset
- `lib/repositories/mock/index.ts` — saves from `ok()`, the one place every
  successful mutation returns through
- `lib/config/settings.ts` — `exportRuleOverrides` / `importRuleOverrides`, so
  published rule values travel with the store rather than being left behind
- `package.json` — the test glob reached only two directory levels under `sh`,
  so any test deeper than `lib/*/` was silently never run. Node expands it now:
  **181 → 192 tests**, and the 11 new ones are the difference

---

## Tests

**181 passing.** Notable files:

- `lib/auth/can.test.ts` — permission scopes, assignable sets, hierarchy vs department
- `lib/auth/workflow.test.ts` — approval chains, consent vs review stages, cross-department routing
- `lib/auth/legacyGate.test.ts` — legacy predicates **transcribed, not imported** (a guard that imports what it guards cannot fail)
- `components/tasks/statusMeta.test.ts` — `nextAction` labels, window precedence, approver visibility
- `components/tasks/relationshipCopy.test.ts` — copy matches the resolver's output

---

## Architecture decisions

1. **Assignment is consent, not permission.** Legacy restricted assignment to
   nobody; gates hold work until the right person agrees. Seeded `task.create`
   is `organisation` for all roles *deliberately*.
2. **Three separate concepts, never conflated**: department **ownership**
   (creator's department) · **reporting line** (who manages whom) · **approval
   authority** (managers of each side).
3. **Deadline model follows the full reporting line; the approval gate follows
   the direct manager only.** They had the same answer by accident.
4. **One resolver, many consumers.** `assignmentRelationship` and
   `windowOnOffer` are called by both the UI and the repository so a prediction
   and a decision cannot diverge.
5. **Approval records, not an embedded array.** Legacy used
   `departmentApprovals[]` on the task; we use records with `stage`. Same
   behaviour, more inspectable.
6. **Actionable = the action inbox** (`?view=approvals`, label "Actionable"):
   Needs your action · Approvals · Reviews, membership decided once so nothing
   appears twice. Tasks answers "state of the work"; Actionable answers "what is
   waiting on me".

---

## Verified

- Task creation across employee / manager / admin / cross-department profiles
- Full cross-department lifecycle, all four states × three profiles, at the
  repository layer: create → route → approve → effort → release → confirm
- Assignee held back until every approval clears; approver retains visibility
- Notifications: `approval_requested` to the approver at creation,
  `task_assigned` to the receiver only on release, `task_confirmed` to the sender
- Legacy gate eligibility, hierarchy vs department, self-approval rules
- **UI, in Chrome**: dashboard fold, task list grouping, `ApprovalTrail`
  rendering State 1 correctly (Maya → Priya → Hanne with the receiver held)

- **Cross-department UI states 2–4, in Chrome, across three profiles.** Walked
  create → route → approve → set effort → release → accept → confirm → notify
  back, as Maya, Priya and Hanne. The workflow behaved correctly throughout, and
  the visibility gate held under direct test: a second task left unapproved
  (`t-1016`) is absent from Hanne's list and produces no notification for her.
  Six UI/backend mismatches came out of it — see
  **`CROSS_PROFILE_UI_FINDINGS.md`**. None is a broken workflow; two (F1, F2)
  need a decision before the copy around them can be corrected.

## NOT verified

- **Notification coverage** beyond the three moments above. Legacy emits ~30
  types; ours are not enumerated against them. (**A4** in the fix plan.)
- **C1 scoring arithmetic** — deduction formula, equal-weighting rule,
  cancellation exclusion, unchecked against `lib/scoring/engine.ts`. (**A3**.)
- **Repeat task cycle** — entirely absent. (**A1**.)
- Dashboard redesign items 4–6 (graph interpretation band, work-distribution
  risk line, meeting card task context).
- Animation and transition timing — the Chrome tab is not foregrounded
  (`requestAnimationFrame` reports 0 frames/sec; a 900 ms timer fires at ~1200 ms).
  Layout, geometry and screenshots are reliable; timing is not.

---

## Exact next task

**Decide F1 and F2 in `CROSS_PROFILE_UI_FINDINGS.md`**, because everything
downstream of them is copy that cannot be written until they are settled:

- **F1** — the chain routes to reporting managers; five UI surfaces and five
  help articles still say "both department heads". The words are simply stale
  and can be corrected once. Cheap, and it is the sentence people read to learn
  who is holding their work.
- **F2** — setting an effort estimate converts a fixed-deadline cross-department
  task into a 4h budget and discards the creator's date. Either that is intended
  (and the Deadline-mode copy, the C1 record and `knowledge.ts:292` are wrong)
  or it is not. It is workflow behaviour, so it was left alone.

Both fixes are `CLAUDE.md` four-part changes: code, UI copy, help knowledge,
tests.

After that, in order from `TASK_MODULE_FIX_PLAN.md`: **A3** (verify scoring
arithmetic — cheap, and errors there are silent and compounding), **A4**
(notification coverage), then **A1** (repeat cycle — needs its own audit of
`repeatConfig` before implementation).

---

## Do NOT change

- **The workload flow graph** — position, size and treatment are fixed by
  direction.
- **`task.create` scope = `organisation`** in the seed. It is deliberate and
  reproduces legacy; narrowing it will look like a fix and is a regression.
- **The People department's `hodEmployeeId: null`** — a deliberate fixture
  proving the blocked path, with a test depending on it.
- **Budget vs deadline derivation.** Decided (C1): stays derived from the
  hierarchy relationship. Do not restore legacy's creator-chosen `hasTimer`.
- **The direct-manager-only gate skip.** Decided (C2): only a direct manager
  clears the department boundary.
- **Draft chat has no participation guard in legacy.** Deliberately not
  reproduced — keep ours.
- **The visual identity** — glass panels, gradients, typography, spacing scale,
  radii, pills. Recent work is copy, ordering, derivation and deletion only.
- **`lib/help/knowledge.ts` must ship with any user-facing change** — see
  `CLAUDE.md`. It is product logic, not documentation.

## Known hazards

- `baseTask` in `lib/mock/seed.ts` ends with `as Task`, which silences
  missing-field errors — it already hid one runtime failure this session.
- `components/dashboard/signals.ts` is fixed, but check any *new* dashboard code
  for hardcoded ids before trusting per-profile behaviour.
- Temporary verification routes were created under `app/api/` throughout this
  session and **all removed**; `app/api/` should contain only `help`, `livekit`,
  `music`. Verify before committing.
