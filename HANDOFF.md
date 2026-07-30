# Cowork migration — handoff

Last verify: **build exit 0, 1954 tests passing, tsc clean, lint clean,
check-secrets clean.**
Read this before touching anything; it will save you re-deriving what took three
long sessions to establish.

**Session 2 (2026-07-29 → 30) is documented in §9 onward.** It is almost
entirely about the task deadline/priority/extension engine and an admin
permission hardening. If you are picking up that work, read §9 first — it
contradicts a few things earlier sections imply.

**Session 3 (2026-07-30) is documented in §10 onward.** It is the admin settings
console. **Read §10.0 first — it found that `/admin` was unreachable in
production for every real employee, including the CEO**, and it contradicts §9.7
about what the admin surfaces could do.

**Session 4 (2026-07-30) is §11.** It fixes the time-budget negotiation, and it
**contradicts §9.4**: the budget record had no confirmation state, its approval
applied the budget through a route that always refused, and there were TWO budget
state machines. `getExtensionActions` is now the single authority.

**Session 9 (2026-07-30) is §16** — the low-end device performance mode. It
names the app's real GPU cost, which was not the one anybody expected.

**Session 8 (2026-07-30) is §15** — normalisation wired into every mutation path.
It **closes §14.6's open item**: nothing has to remember to normalise any more.

**Session 7 (2026-07-30) is §14** — the priority QUEUE: duplicates, gaps and the
active rule. It **narrows §13.4**: unaccepted work no longer holds a slot.

**Session 6 (2026-07-30) is §13** — the priority system audit. It **contradicts
nothing but sharpens §9.3**: one field held two different numbers on two
different scales. It also records a premise that does not hold — priority is
per-person by design and must not be flattened.

**Session 5 (2026-07-30) is §12** — assignment acceptance, the same bug class a
third time. It **corrects a help article and this document's own §5 entry**:
`assignment_rejected` is NOT an assignee declining work. There is no
assignee-side decline route at all.

---

## 0 · What this project is

A new Next.js UI (`/Users/risheeray/Documents/cowork`) over the **existing**
Cowork backend. Two read-only reference repos:

- `cowork-old-frontend` — the functional source of truth
- `cowork-old-backend` — the permanent backend (Express + MongoDB + Firestore)

**"Same application, new skin."** Do not build a backend, a database, Next.js
API routes, or duplicate business logic.

### The four stores, and what lives where

| Concern | Store | Key |
|---|---|---|
| Auth | Firebase (project `grav-cms-38f45`) | `authUid` |
| Cowork directory, tasks, timers, notifications | **Firestore** | `employeeId` |
| HR records + **the reporting hierarchy** | **MongoDB** `Employee` | `biometricId` |
| Scores, task lifecycle rules | Express backend | HTTP |

`biometricId === employeeId` joins Firestore to Mongo. It is a **naming
convention, not a stored reference** — that is the root of a whole class of bug.

### The one rule that explains most of the code

**Reads are Firestore; writes are HTTP.** Legacy reads tasks with 22 browser
`onSnapshot` listeners but writes every lifecycle transition through
`taskForward.js`, because the engine owns the rules (approval gates, priority
computation, `taskId` generation, notification fan-out).

**The single exception is the timer** — legacy has *no REST endpoint* for it, so
timers are written straight to Firestore, matching `useTaskTimer`.

---

## 1 · Completed this session

### Security (all verified against production)

- **Auth bypass closed.** `middleware.ts` checked JWT *claims* only — a forged
  unsigned token returned **200 on `/team`**. Now verifies the RS256 signature
  via `verifyIdToken` (Google JWKS, Edge-compatible, certs cached). Fails
  closed. Verified: forged/garbage/absent cookies all 307.
- **Directory 403.** `#employeesById()` called `/cowork/employee/list`
  (`verifyCeoOrTL`). Every ordinary employee got 403 → empty map → no name/id in
  the top bar, empty assignee picker, empty Team. Now `/employee/list-members`
  (any employee token). **8 of 16 staff were affected.**
- **Task visibility.** The cross-department gate query is org-wide by necessity
  (Firestore can't filter inside `departmentApprovals[]`); it is now scoped at
  the repository to sender + approvers + pending assignee.

### Identity (data migration executed)

`E000` was **not a person** — `coworkAuth.js:51` auto-creates it for any
Firebase user it can't match. The CEO fell into it, so 8 people reported to
`GR0000` while the login resolved to `E000`.

Executed: created `cowork_employees/GR0000` with the CEO's `authUid`; removed
`authUid` from `E000`; set `E000.email` to a reserved `.invalid` address
(original preserved in `legacyEmail`, `isSystemIdentity: true`). **E000 kept
intact** — it is the hardcoded default cross-department approver
(`taskForward.js:199`) and holds ~130 references across 14 collections.

Rollback value, if ever needed: `paHxne71GZQR7Qt89STzj8XHXmq2`.

### Hierarchy

Derived from `primaryManager` via N `my-managers` calls, cached lazily. A
manager named by an edge but absent from the directory now becomes a node
(`isDirectoryMember: false`), which is what connects the tree.

**`hierarchyIds` = direct reports only** — deliberately narrowed, applies to
every role including CEO. Admin = TL + `canAccessAdminSettings`; the hierarchy
engine never reads a role.

### Tasks

Scopes (Assigned/Created/Self/Submitted), root-only filtering, descendant
matching, per-person rank, 7 previously-missing statuses, real-time
`onSnapshot` → `notifyRepositoryChanged()`, and **all 20 lifecycle mutations
connected** including the timer.

### Permissions — the engine is live (owner-decided, 2026-07-29)

`listRoles()` returned `[]`, so `can()` denied every capability to everybody.
That was never a permission decision; it was the absence of one. Three surfaces
were dark because of it: `/admin` told the CEO "your roles do not include", the
Workload tab filtered every colleague out, and priority reorder was inert.

**Roles come from `lib/auth/systemRoles.ts`** — one table, no storage, shared
with the seed tenant so a capability means the same thing on either backend.

Two owner decisions, both taken this session:

1. **Who holds what**: everyone holds Employee; **Manager is earned from the
   reporting tree** (or `role === "tl"`, so a lead between assignments keeps
   their surfaces); Administrator from `role === "ceo"`.
2. **Where legacy is looser than the spec, the spec wins.** §4.3 of
   `PERMISSIONS_AND_ROLES_SPEC.md` is the grant source, so three controls are now
   absent for people whose write the engine would still accept — see
   `SPEC_STRICTER_THAN_LEGACY`. Each is a legacy defect §4.4 names (P1, P6, and
   the unchecked counter-proposal).

### Presence — one system, not two (owner-decided, 2026-07-29)

**There were two presence systems and they did not know about each other.** The
new workspace derived presence from a live LiveKit screen-share and kept it in
an in-memory store — correct, immediate, invisible to everyone, erased by a
refresh. Legacy kept `cowork_duty_status/{employeeId}` in Firestore — shared,
durable, and the thing that actually gated work. The ported reader
(`lib/legacy-ui/useDutyStatus.js`) was wired into `StatusButton` and used for
**one diagnostic sentence**. Nothing wrote the document.

They are now one system:

- **The share decides, the legacy document carries.** `DutySync` publishes what
  `employeeStatus.ts` derived into `cowork_duty_status` — same collection, same
  field names, plus two additive fields the old app ignores. `mode: "online"`
  is written only while a whole-screen share is live.
- **Heartbeat + staleness window** (`HEARTBEAT_INTERVAL_MS` 45s,
  `STALE_AFTER_MS` 120s). A crash, a force-quit or a sleeping laptop resolves
  on its own, because nothing has to run at shutdown for presence to become
  correct. **Never read `doc.mode` directly** — `readDutyMode()` applies the
  window, and skipping it is what leaves a green dot for somebody who went home.
- **Only `online` expires.** A break and an emergency are claims about a person,
  not a connection; expiring one would silently resume their deadlines.
- **Multi-tab**: the document records which connection holds the claim, and a
  tab may only clear one it owns. Otherwise opening a second tab — which has no
  room, so honestly sees "not sharing" — would end the first tab's live share.

**The offline restriction is restored, and it is a rule now rather than six
render conditions.** Legacy's gate lived entirely in
`app/coworking/tasks/page.js` (`:6419, :6462, :6601, :6615, :7824, :8571`), so
the same Firestore write went through untouched from anywhere a condition had
been forgotten. It is now `presenceRefusal()` in one file, called by the banner,
the timer control and **`startTimer` itself**. Three conditions are load-bearing
and all three are ported: the gate applies only to the **assignee**, `break` and
`emergency` block exactly as `offline` does, and a **null mode is permissive**
(unknown is not away).

**Transitions own their consequences.** `setDutyMode` banks the break/emergency
span and auto-pauses the running timer (`logged_out`, legacy's own reason).
`StatusButton` used to do both as well — two callers for one consequence is how
the same minutes get credited twice. It no longer does.

**LiveKit is required, not an unused dependency** — presence, monitoring and
meetings here; meetings and DM calls in legacy. Env vars set, token route
authenticated with split publish/subscribe seats.

#### The 401 that would have made all of it unusable

Found in the running dev server, not in the code:
`GET /api/livekit/token?identity=employee-GR0000 401` — for a **signed-in** CEO
whose page loads were all 200.

The product has **two sign-in systems** and this route knew only one:

| | Issued by | Gates |
|---|---|---|
| `cowork_session` | `/api/auth/signup` | `currentSession()` in API routes |
| Firebase ID token cookie | `SignInForm` — **the path all real staff use** | `middleware.ts`, every page |

Nothing issues `cowork_session` on the Firebase path. So every actual employee
had working pages and a 401 on the token route — meaning **nobody could ever go
online**. Harmless while presence only coloured a pill; not harmless once task
actions are gated on it, because the chain becomes: no token → no room → never
online → **cannot start a timer or advance your own work.**

`lib/server/apiAuth.ts` now accepts either, verifying the Firebase **signature**
against Google's JWKS — the identical check the middleware makes, since claims
alone were the bypass closed earlier. The seat split is untouched.

**`/api/meetings/token` is deliberately NOT fixed.** It mints a token *as* a
named person and reads `session.employeeId` to do it; a Firebase token carries a
uid, which is not the workspace employee id. Guessing that mapping would put
somebody into a meeting under another person's name. It refuses honestly until
the identity seam is resolved — see `cowork-identity-workspace-seam`.

### Task module — 29 unconnected methods, now 0

The reported symptom was one modal (*"changePriority is not connected"*). It was
one of **29** task-module methods reaching the throwing proxy. Audited
mechanically rather than by grep — diff `CoworkRepository`'s 191 declarations
against what `LegacyRepository` defines, intersect with what the task module
calls — and that diff is now a test, so the gap cannot silently reopen.

**24 connected** to real legacy sources; **5 intentionally unavailable** because
the engine has no field, collection or route for them. Full table in
`TASK_LIFECYCLE_VERIFICATION_REPORT.md`.

Two findings worth carrying forward:

- **Priority has no route.** The spec records it as "none — client-side
  Firestore write" (P6), so the contract is the DOCUMENT SHAPE. `updateDoc` with
  **dot notation** on `assigneePriorities.{id}` — writing the map whole erases
  every other assignee's rank.
- **`getTimer` was missing**, and `TimerControl` calls it for every row it
  renders. The write half had been connected all along; the read the control
  renders from had not.

### The manager could not see a shared screen — and LiveKit was fine

Reported as a LiveKit fault. It was not. The employee published correctly under
`employee-<id>`, the watcher's seat subscribed, and the track arrived in the
room. **`LiveScreenViewer` matches incoming tracks against
`subject.presenceIdentity`, and `getMonitoringSubject()` returned `null` on the
legacy backend** — so `PersonMonitor` rendered `NoSubjectFrame` instead of the
viewer at all, and `ScreenDialog` was handed `presenceIdentity=""`, which
matches no participant that has ever existed. The screen was in the room the
whole time with nobody asking for it.

Two further defects found in the same audit:

- **Every watcher joined as the bare string `"manager"`.** LiveKit treats
  identity as unique per room and evicts the existing participant on a
  collision, so the second manager to open a monitoring page silently
  disconnected the first — who saw their screen go blank having done nothing.
  Watchers now carry a per-tab suffix (`watcherIdentity`), and
  `isWatcherIdentity` still accepts the bare form so tokens minted before the
  change keep working.
- **`/manager` told a manager with reports that they had none.** The roster
  read resolves to `[]` on this backend, and the empty branch rendered "You have
  no direct reports" — the same settled-looking wrong answer the file's own
  comment warns about for the error case, arrived at from the other direction.
  It now asks the reporting line which sentence is true.

`listTeamMonitoring` is still empty on purpose: `TeamMonitoringRow` requires
`workloadPercent` / `workloadBand`, the domain says both are **stated, not
derived**, and legacy states hours with no capacity to divide them by. It
resolves rather than throwing because `workMap.test.ts` pins that a `/team`
read must not reject. **The live-screen path does not depend on it** —
`/team/{id}` is the working manager surface.

**Reach and standing are separate, and this is the part to not undo.** The tree
grants reach — every Manager permission is `direct_reports`-scoped, so the role
reaches your reports and nobody else. `administrativeLevel` is standing and
comes only from the engine's role string, for the viewer and for the directory
alike; if the tree could raise it, one employee would get two different answers
from the administrative floor and the upward-assignment gate.

Two consequences worth knowing:

- `Employee.roleIds` is populated now. It was `[]`, which made `levelOf()`
  answer 0 for a new joiner and 0 for the CEO — so the floor compared `0 >= 0`
  and refused, and **the upward-assignment gate could never fire for anybody**.
  It fires now.
- Role *editing* is refused with a reason rather than a `NotConnectedError`:
  there is nothing to wire, because the engine stores no role record. The table
  still renders, because it is the only legible answer to "why can that person
  approve this". `assignRoles` is left throwing — legacy's `change-role`
  endpoint is real and could be wired, so a not-yet is the honest signal.

---

## 2 · Files changed (the ones that matter)

| File | Why it matters |
|---|---|
| `middleware.ts` | Route gate; now verifies signatures |
| `lib/auth/systemRoles.ts` | **The role table.** The whole of the permission model's data |
| `lib/rules/presence/duty.ts` | Presence model: staleness, multi-tab ownership, legacy's transition arithmetic |
| `lib/rules/presence/taskGate.ts` | **The offline restriction.** One function; the banner, the control and the write all call it |
| `components/features/status/DutySync.tsx` | Publishes the derived status to `cowork_duty_status` + heartbeat |
| `lib/hooks/useDutyMode.ts` | The only correct way to read presence — applies the staleness window |
| `lib/integrations/livekit/identity.ts` | Who publishes/watches under what name. **Both sides derive from here** |
| `lib/legacy/identityMap.ts` | Alias table (**now empty** — keep it that way) |
| `lib/legacy/hierarchy.ts` | Tree derivation, `buildReportingTree` |
| `lib/legacy/tasks.ts` | Wire types + `readTask` — all task field reads |
| `lib/legacy/taskWrites.ts` | Every task mutation endpoint |
| `lib/repositories/legacy/index.ts` | **The repository.** ~1600 lines; the centre of everything |
| `lib/repositories/legacy/taskMap.ts` | `toTask` / `toTaskView` — most UI bugs trace here |
| `lib/repositories/legacy/taskWatch.ts` | Live listeners |
| `lib/rules/tasks/workingWindow.ts` | Duration presets, `describeWindow` |
| `lib/rules/tasks/actionable.ts` | `windowOnOffer`, action inbox |
| `components/features/tasks/statusMeta.ts` | `nextAction` — the "your move" logic |
| `firestore.indexes.json` + `firebase.json` + `.firebaserc` | Index deploy config |

---

## 3 · Architecture decisions

1. **No task write touches Firestore** (timer excepted, see §0).
2. **Unimplemented repository methods throw** `NotConnectedError` via the proxy
   — never resolve to null/empty. Three bugs this session were "a method didn't
   exist and the screen said *no data*". Do not soften the proxy.
3. **Null ≠ zero.** An unscored quarter is null; a depth we can't resolve is
   null. Never default to 0 — it reads as a real value.
4. **Never recompute what the engine sends.** Scores come from `pace.score`;
   recomputing gave 14% against the engine's 90%.
5. **Assignment is consent, not permission.** Anyone may assign to anyone; the
   approval gates hold the work. The picker lists everyone except self.
6. **Departments group; the reporting line grants.** A direct manager assigning
   to their own report raises no gate regardless of department.
7. **Failures raise, not swallow.** `#taskDocuments` deliberately throws on a
   missing index rather than returning an empty list.

---

## 4 · Tests

**799 passing.** `npm run verify` = lint && tsc && test && build && check-secrets.

- Runner is `node --test` — **value imports must use relative `.ts` paths**
  (`@/` is not resolved). Type-only imports may use `@/`.
- **Stop the dev server before verify** or the build hits an `.next` ENOTEMPTY
  race.
- Tests assert *legacy's* rule, citing the old file and line, not our
  implementation.

---

## 5 · Known issues

| Issue | Severity | Note |
|---|---|---|
| Break credit + emergency approval are **banked, not raised** | Medium | `endBreak` and `createEmergencyRequest` are unwired against the engine, so `setDutyMode` writes `pendingBreakGapMs` / `pendingEmergencyGapMs` instead. That is legacy's OWN field for a measured-but-unapplied span, and the old app's `applyPendingBreakGap` / `applyPendingEmergencyApproval` act on it at its next online transition — so nothing is lost. Wiring those two methods here is what closes it |
| Presence not verified against two live browsers | **High** | Every rule is unit-tested and none has been seen on a real screen with two accounts. This is verification steps 1–5 and it is the top of §6 |
| **Meetings are unreachable for real staff** | **High** | `/api/meetings/token` requires `cowork_session`, which the Firebase sign-in path never issues — the same 401 the presence route had. Cannot take the same fix: it needs an *identity*, not just "somebody real". Blocked on the identity/workspace seam |
| `/api/auth/directory` 401s for the same reason | Medium | Seen in the dev log. Not traced to a consumer this session, and not touched — it is outside the presence brief. Same root cause, same fix shape |
| `/manager` roster is empty on legacy | Medium | Needs `workloadPercent` / `workloadBand`, which the domain requires be **stated** and legacy has no capacity to state. The page now says so instead of claiming you have no reports. Use `/team/{id}` to watch a screen — that path is wired |
| Spec tightenings not verified against a real screen | Medium | Approving a completion, changing priority and countering a deadline are now narrower than the engine. Each is a control that has *gone* for someone who used the old app. Confirm the refusals read as intended before anyone else meets them |
| **`/api/meetings/token` and `/api/auth/directory` 401 for real staff** | **High** | Same root cause as §10.0 and now the only two left. Both can take `adminAuth.ts`'s fix; meetings additionally needs an *identity*, not just "somebody real" |
| Settings writes are not enforceable at the store | Medium | The repository and the API both refuse a non-admin, but the write itself is browser→Firestore with the user's own credentials. A Firestore rule would close it and would break the live legacy app — see §10.5 |
| `assignRoles` throws | Low | Wiring legacy's `change-role` is real work — it rewrites two stores and revokes sessions (`cowork.js:839,842`), and a partial failure desynchronises them permanently (P15) |
| `nextAction` vs timer state can disagree | Medium | Status "In progress" while the control says "Start timer" |
| Manager-side deadline cards missing | Medium | `deadlineHistory[]` is counted (`deadlineHistoryCount`) but not parsed |
| File uploads not wired | Medium | `submitCompletion` drops `attachmentIds` — legacy takes resolved URLs from its own upload endpoints. **Hide the UI rather than ship broken controls.** |
| **`assignment_rejected` is not an assignee declining** | Info | It maps from legacy's `"rejected"` — a cross-department approver refusing a gate. There is no assignee-side decline route at all; the assignee's only refusal is `reject-sender-timer`, which sends the TERMS back and changes no status. See §12.2 |
| `confirmed` → "Start work" unreachable | Low | Legacy `confirmed` maps to `in_progress` (matching the old page's tab grouping), so that branch never fires. `startTask()` is connected but unreachable. Deliberate — a test pins it. |
| `E000` + `GR0000` share nothing now, but `coworkAuth.js:43` email fallback is unordered | Low | Closed by the `.invalid` address; would reopen if `GR0000`'s uid were rotated |
| Cowork→HR join is a convention | Low | Recommend adding a real `biometricId` field to `cowork_employees` |
| Split history | Info | CEO's notifications/DMs/duty status/Gmail token stay on E000. Accepted. |

---

## 6 · Next steps, in order

1. **Two-browser test, and it is now the blocker.** Two sessions changed what
   every screen shows — permissions and presence — and none of it has been seen
   running. It is also the only way to catch "data layer right, screen wrong",
   the most common bug shape of the first session. Sign in as `GR0000` (CEO:
   `/admin` opens, Everyone scope, Workload populated) and `GR0045` (TL, two
   reports: My team and Workload, no `/admin`). Then, for presence:
   - A goes online → A's pill Online, **B's Team roster dot turns green**
   - A closes the browser → B's dot goes grey **within ~2 minutes on its own**
   - A offline, opens a task they are assigned → actions replaced by
     *"Offline — the timer is paused…"*, and `startTimer` refuses if forced
   - A back online → banner and timer control return, logged time untouched
   - A opens a **second tab** → the first tab's share must survive it
   - **Screen share**: A online and sharing → B opens `/team/{A}` → B sees A's
     screen. Then a **second manager** opens the same page — neither must be
     disconnected (that was the `"manager"` identity collision)
2. **Timer UI states**: not started / running (elapsed) / paused (worked today).
   Backend is connected; read from the engine, no React-local timer state.
3. **Manager deadline cards** — parse `deadlineHistory[]`, render
   original-vs-requested, approve/counter. Do this against a real populated
   task, not the schema.
4. **Wire `endBreak` / `createEmergencyRequest`** so spans are credited rather
   than banked — see §5. Until then the old app is what applies them.
5. **Hide the attachment UI** until uploads are wired.

---

## 7 · Constraints — do not rebuild

- ❌ New backend, DB, Next API routes, or duplicated business logic
- ❌ New task status enums — legacy's are the vocabulary
- ❌ A second timer system — `cowork_task_timers/{employeeId}/sessions/{taskId}`
  and `cowork_timer_events/{employeeId}/logs` are it
- ❌ A monetary budget — **"budget" means a working-time window**
  (`senderTimerWindowSecs`, `deadlineWindowSecs`). There is no currency field
  anywhere in the task schema.
- ❌ Redesigning the UI or design system
- ❌ Mock/placeholder data — show an explicit unavailable state
- ❌ Modifying either legacy repo
- ❌ Re-adding entries to `IDENTITY_ALIASES`
- ❌ A second role table — `lib/auth/systemRoles.ts` is it, and the seed reads
  from it. Two copies of a permission matrix is two answers to "may I approve
  this"
- ❌ A second presence collection. `cowork_duty_status` is it. The old app reads
  and writes the same document, and anything we write elsewhere it will never see
- ❌ Reading `doc.mode` directly. `readDutyMode()` / `useDutyMode()` apply the
  staleness window; bypassing them is how a closed browser stays green
- ❌ Re-adding break credit or auto-pause to `StatusButton`. `setDutyMode` owns
  every consequence of a transition, and it derives them from the stored
  document so it stays idempotent
- ❌ A `role === "manager"` comparison anywhere. Roles are data; the moment code
  names one, the model is back to string literals

### Verified facts worth not re-deriving

- 17 Cowork employees; 96 HR employees; 32 Firebase users
- `GR0045` = Rakesh Biswal, TL, IT — reports: GR0067 (Soumya), GR0108
- `GR0000` = Rishee Ray, CEO — the login; `E000` = system approver, not a person
- `taskForward.js` is mounted **before** `taskTree.routes.js`, so the latter's
  `/task/create` is dead code
- `propose-deadline` **400s without `proposedDate`** and does not derive one
  from `windowSecs` — send both
- All 4 Firestore indexes are declared and **READY** in production

---

## 8 · Working method that paid off

Every significant bug this session was found by **running the thing against
production data**, not by reading types:

- The score bugs came from inferring payload shape → fixed by capturing a live
  payload as a fixture
- "Task not found" → proved by invoking the proxy and reading the actual throw
- The auth bypass → proved by minting a forged token and getting a 200
- The empty picker → proved by checking which endpoint the role could call

Read the old code before changing the new. Several briefs this session rested on
premises the code disproved — six task tabs (there are four), a department-based
hierarchy (it was already manager-based), an ID mismatch (there wasn't one), a
rupee budget (it's time). **Check the premise first; say so plainly when it does
not hold.**

---

# Session 2 — 2026-07-29 → 2026-07-30

Verify at handoff: **tsc clean · lint clean · 1782 tests, 0 failed · `next build`
exit 0 · dev server 200.**

**Read §9.0 before anything else.** One constraint shaped every decision below.

---

## 9.0 · The constraint that governed the whole session

**There was never an authenticated session.** I was asked not to submit the
user's password and did not. Consequence, stated plainly:

> **Nothing in this session has been visually verified in a browser.**

Everything below is proven by: typecheck, lint, unit tests against real rule
functions, source assertions, and `curl` status codes. Not by watching a screen.

The one live observation obtained: `/admin/*` returns **307** unauthenticated
while `/signin` returns **200** — so the admin server guard demonstrably fires.

**First thing to do in the new session: sign in and exercise the task detail
page.** Several fixes below are inferences from described symptoms and would be
confirmed or refuted in minutes with a session.

Also unverified: **the legacy backend was never restarted.** Edits to
`taskForward.js` / `taskTree.routes.js` (§9.4) take effect only after a Node
restart. If a fresh extension request still shows no amount, that is why.

---

## 9.1 · A test-fixture defect that invalidated earlier confidence

**Every office-hours fixture I wrote was silently ignored for most of the
session.** `addWorkingSecs` reads:

```js
_dayCfg = schedule[dayKey] || { isOff: dayKey === "sunday", inTime: "09:30", outTime: "18:30" }
//         ↑ FULL day names: "monday".."sunday"
//           fields: isOff / inTime / outTime
```

I was passing `{ mon: { open, close, isOpen } }` — **none of which it reads.**
Seven test files fell through to that built-in default. They passed because the
default's 09:30–18:30 matched my chosen hours and nothing crossed a Saturday
(**the default leaves Saturday OPEN**).

Corrected in all seven files; every pre-existing assertion still passed, so the
conclusions held — but coverage is only now what it claimed to be.

**Correct fixture shape:**

```ts
const SCHEDULE = {
  monday:    { isOff: false, inTime: "09:30", outTime: "18:30" },
  // …tuesday–friday…
  saturday:  { isOff: true,  inTime: "09:30", outTime: "18:30" },
  sunday:    { isOff: true,  inTime: "09:30", outTime: "18:30" },
};
```

**Lesson worth carrying:** a fixture that is structurally ignored produces
passing tests that assert nothing. If a test involves an injected config object,
verify one non-default value actually changes the output.

---

## 9.2 · Hardcoded-empty mapper fields — a recurring bug class

Same shape found repeatedly. The mapper wrote a constant where the document had
a value, and six UI surfaces rendered the constant.

| Field | Was | Now |
|---|---|---|
| `estimatedEffortSecs` | `0` hardcoded, comment claimed legacy keeps budget on the timer doc | `resolveTimeBudget(legacy)` |
| `operationalDueAt` | did not exist | chained from the queue |
| `addedSecs` (extensions) | `0` / `null` hardcoded | read from the record |
| `windowSecs` (pending extension) | `0` hardcoded | read from the record |

`estimatedEffortSecs: 0` alone emptied: the Details panel, both `TimerControl`
views, two `TaskTable` cells, and `TasksOverview` workload totals.

**When a mapper field is a literal, check the document before believing the
comment.** The justifying comments were wrong in two of these four cases.

---

## 9.3 · The deadline / priority engine — current architecture

### One resolver per concept (this was the main structural work)

| Rule | File | Replaces |
|---|---|---|
| `resolveTaskPriority(task, employeeId)` | `lib/rules/tasks/resolveTaskPriority.ts` | 4 copies of `assigneePriorities[me] ?? priority ?? 999` |
| `resolveTimeBudget(task)` | `lib/rules/tasks/resolveTimeBudget.ts` | 4 copies of `agreedWindowSecs ?? senderWindowSecs` |
| `remainingWorkSecs(task)` | same file | nothing — new |
| `holdersOf(task)` | `resolveTaskPriority.ts` | `assigneeIds` reads that ignored pending assignees |

Tests ban re-typing these expressions anywhere.

### The operational vs committed date distinction

- **`deadline.dueAt` / `officialDueAt`** — legacy's STORED figure: assignment
  time + budget, as if the person were free. This is the **commitment**, and
  what scoring measures. Do not change it.
- **`deadline.operationalDueAt`** — DERIVED per read from `#chainQueue`: the
  whole queue laid end to end through the office calendar. This is **when the
  work actually happens**.

For anyone with a queue the two differ by everything ahead. A 4h task handed
over at 09:30 stored `13:30` while three hours of committed work sat in front —
the real answer was `16:30`.

### `#chainQueue(employeeId, order, tasks)` — the single chain

Called by exactly two places (asserted): the task list and `#readTaskView`. It
fetches office policy + blocked dates + logged seconds, and chains
`remainingWorkSecs` — **not** the full budget.

**Critical subtlety:** the queue-occupancy test uses the *allocated* budget
(`windowSecsFor > 0`); the chain duration uses the *remainder*. Testing
occupancy on the remainder would drop a fully-worked task out of the queue and
pull everything behind it earlier.

### Work outside office hours

The office engine was already correct — `addWorkingSecs` advances an
out-of-hours anchor to the next opening. The bug was feeding it the wrong
seconds. Four quantities, kept apart:

1. **elapsed real time** — wall clock. Never scheduled.
2. **worked seconds** — what the person logged. **Never modified.**
3. **remaining workload** — budget − worked, floored at 0.
4. **scheduled completion** — (3) through the office calendar.

5 min at 04:53 on a 2h task → 1h55m remaining → **11:25**, not 11:30.

### Two bugs where the engine was right and was lied to

- **T648 started at 09:30.** `proposedPriority={view.myRank ?? view.myStoredRank ?? 1}`
  — both are `null` unless the VIEWER is an assignee, so a manager's preview ran
  at **P1**. `proposedPriority` is now optional; absent means "where it already
  sits", falling back to the **back** of the queue (the product's own rule for
  new work). There is no default of 1 anywhere; a test enforces it.
- **Pramod saw dashes, his manager saw P1/P2/P3.** The mapper gave the queue
  OWNER the derived position with `?? UNRANKED`, and everyone else the stored
  rank. A task outside the live queue therefore had a rank for every viewer
  *except the person whose queue it is.* Both reads now fall back to
  `resolveTaskPriority`.

### Pending assignees were invisible everywhere

A cross-department task at the gate has **empty `assigneeIds`** and its person
in `pendingAssigneeId`. Four reads keyed on `assigneeIds` returned nothing for
the one person holding the work: `myRank`, `myStoredRank`, `assignments`, and
the queue `subjectId` (which returned `null`, so no queue was fetched at all).
Plus `timeSubject` for logged time. All now use `holdersOf`.

**Firestore cannot OR across fields**, so `#activeQueueOf` does two reads
(`assigneeIds array-contains` + `pendingAssigneeId ==`) and merges by id.
A `holderIds` array on the document would collapse this to one query — not done.

### Other engine facts

- `resolveTaskPriority` guards `null`/`""` explicitly: `Number(null) === 0`, and
  **0 sorted ahead of every real priority.** A blank entry jumped the queue.
- `movedLaterSeconds` is **wall-clock slip**, not effort. +6h of budget can
  delay the next task by 21h if it spills past closing. The UI says
  `delayed +21:00:00` rather than a bare figure.
- **Swapping two tasks above a third leaves the third where it was** — it still
  has the same total work in front. Only *crossing* a task moves it.

---

## 9.4 · The extension system — the largest piece

### The business rule (settled, do not re-merge)

```
TIME BUDGET EXTENSION      DEADLINE EXTENSION
assignee → primary manager manager → assignor
unit: WORKING SECONDS      unit: DATE/TIME
```

Hours first, always. Only if the workload engine says they cannot fit does it
become a date conversation — and then the **manager** escalates, carrying the
queue's earliest achievable date.

**Never `oldDeadline + extraHours`.** The work sits behind other work and runs
through a calendar; that sum is always wrong. The types enforce this:
`deadlineExtension()` has **no duration parameter** and `timeBudgetExtension()`
has **no date parameter**. `isUnitPure()` re-checks at runtime because these
come back from Firestore untyped.

### Storage

| Collection | Record |
|---|---|
| `cowork_task_budget_extensions` | `TIME_BUDGET_EXTENSION` — `previousBudgetSecs`, `requestedAdditionalSecs`, `newBudgetSecs`, `approverId`, `status`, `createdAt`, `approvedAt` |
| `cowork_task_deadline_extensions` | `DEADLINE_EXTENSION` — `previousDeadline`, `proposedDeadline`, `counterDeadline`, `approverId`, `status`, `decidedBy`, `isHistorical` |
| `cowork_settings_audit` | settings audit entries |

`counterDeadline` sits **beside** `proposedDeadline`, not over it — both are
part of the account. `liveDeadline(record)` returns the one under discussion.
**Approval applies `liveDeadline`, not `proposedDeadline`** (I shipped that bug
and caught it).

Deadline status has a fourth state the budget one does not:
`counter_proposed`. Collapsing it into `rejected` would end a conversation that
is not over.

### The `addDoc` crash — root cause worth remembering

```
Unsupported field value: undefined (found in field id in
document cowork_task_budget_extensions/…)
```

`{ ...record, id: undefined }` — **spreading cannot delete.** It sets the key to
`undefined`, the one value Firestore refuses. I wrote that line in **three**
places. Fixed with `documentBody(record, REQUIRED)` in
`lib/rules/settings/firestorePayload.ts`, which strips `id`, drops `undefined`
recursively, **keeps `null`** (`approvedAt: null` means something), and throws a
named `PayloadError` for missing required fields and for `NaN`/`Infinity`.

SDK error text no longer reaches the UI — both request paths return
*"Unable to submit extension request. Please try again."* and `console.error`
the cause.

### The state machine

`lib/rules/tasks/extensionActions.ts` answers *whose move is it* — exactly one
outstanding action, ever:

| record state | kind | owner |
|---|---|---|
| budget `pending` | `decide_budget` | approver (manager) |
| deadline `pending` | `decide_deadline` | approver (assignor) |
| deadline `counter_proposed` | `accept_counter` | **requester** |
| answered / historical | `none` | — |

**`hierarchyKind` compares `assignorId` to `primaryManagerId`, never a
department field.** Internal (same person owns both) grants hours *and* moves
the date in one press — escalating would have Rakesh sending Rakesh a request,
which is what left T650 "waiting for Pramod" with no button.

**The guard that matters:** a test enumerates every `PendingActionKind` and
asserts a component renders it. *A state nobody can act on is not a state — it
is a dead end with a label.*

### UI surfaces

`ExtensionDecisionCard` (manager, hours + one routed button) ·
`DeadlineRevisionCard` (assignor, **dates only** — a test bans
`formatDurationTimer` from the file) · `CounterDeadlineCard` (accept/discuss) ·
`ExtensionTimeline` (both conversations merged by time, each row in its own
unit).

Waiting lines name the **action**, not just the person: *"Rakesh Biswal needs to
review the request for additional working time."*

---

## 9.5 · Admin permission model (hardened)

**Single source: `lib/rules/admin/access.ts`.**

```ts
canAccessAdminConsole(user) → user.archetype === "system_admin"
canViewAuditLogs(user)      → user.archetype === "system_admin"
canModifySettings(user)     → user.archetype === "system_admin"
```

`null` / `undefined` / `{}` / `{archetype: null}` all refused — **unknown is not
permitted.** Three functions despite identical bodies, because they answer
different questions.

### Two definitions removed

1. **`mayOpenAdmin` allowed `people_ops`.** It now delegates. `landingFor` sends
   people_ops to `/home` — **they have lost `/admin` entirely, including the
   people directory.** That follows from the requirement; the fix if wanted is a
   directory surface *outside* `/admin`, not a second archetype.
2. **`legacyRole === "ceo"` inference.** Worse than a duplicate: `legacyRole` is
   *derived from* archetype by `legacyRoleOf()`, so inferring it back was a
   lossy round trip — and the same account could be admin via a repository call
   but not via a page. `LegacyRepositoryContext` now carries
   `archetype?: RoleArchetype | null`, populated in `SessionProvider`.

**⚠ `archetype` is optional and fails closed.** Any other construction site of
`LegacyRepository` will silently refuse settings/audit. `SessionProvider` was
the only one found.

Enforced at four depths: server layout (`/admin/*`), API routes, legacy
repository, mock.

---

## 9.6 · Settings audit

`applySettingsChange` (`lib/rules/settings/service.ts`) takes read, write and
log as one operation — **a caller cannot supply a new value without the old
one**, because the entry is built from both.

Order: **write first, log second.** The reverse records changes that then failed
to save. A landed write with a failed log returns `unlogged: true` and the
message *"Settings saved but audit logging failed"* — not swallowed.

`diffFields` records dotted leaf paths only (`schedule.tuesday.outTime`), arrays
whole. `auditEntry` returns **null** when nothing changed. `affectsDeadlines` is
**stored, not derived at read time**.

Viewer at `/admin/audit`, system_admin only. A refusal renders as a refusal, not
an empty log — different facts.

---

## 9.7 · Admin console audit (asked for, delivered as a report)

| Section | UI | Backend |
|---|---|---|
| Organisation | `OrgEditor` | ✗ mock-only |
| People | `PeopleEditor`, `EmployeeProfile`, `UnplacedPeople` | ✗ mock-only |
| Roles | `RoleEditor` | ⚠ wired as explicit refusal |
| Scoring Rules | `ScoringRuleEditor` | ✗ mock-only |
| Provisional Rules | `ProvisionalRulesArea` | ✓ `setOfficePolicy`, audited |
| Workflows | `WorkflowEditor` | ✗ mock-only |
| Settings | `OfficeSettings`, `BreakAllowanceEditor` | ✗ mock-only |
| Audit log | `AuditLog` | ✓ wired |

**~2 of ~20 admin writes reach the real backend.** "mock-only" means the method
exists on `MockRepository` but not `LegacyRepository`, so the proxy throws
`NotConnectedError` in production: the panel renders, you edit, Save fails.

### ⚠ The office-policy split — highest-priority known defect

```
OfficeSettings.tsx    → r.setOfficeHours(config, why)   ← MOCK-ONLY, not wired
ProvisionalRulesArea  → r.setOfficePolicy(next)         ← wired + audited
```

Both target `cowork_settings/office`. **I wired the audit to the method the
Provisional Rules panel uses, not the one the Office Settings panel uses.** My
test "the office document is written from exactly one place" passes only because
`setOfficeHours` does not exist in the legacy repository at all.

**Roles is a different kind of incomplete:** legacy stores a role as one of three
words on an employee, not a record with permissions. Real role editing needs a
new store, not wiring.

---

## 9.8 · Next steps, in order

1. **Sign in and exercise the task detail page.** Nothing here is visually
   verified. Highest information gain per minute.
2. **Restart the legacy Node backend** so §9.4's route edits take effect.
3. **Point `OfficeSettings` at the audited `setOfficePolicy`** — closes the
   split above. One panel, real deadline impact.
4. **Add the confirmation dialog** — `affectsDeadlines` exists, the prompt does
   not. *"Changing office policy may recalculate active task deadlines."*
5. **Wire `decideTimeBudgetExtension` follow-through**: a `counter_proposed`
   deadline has no card for the manager to re-counter; the conversation can
   start but not finish from the UI.
6. **Notifications** — nothing emits one. A counter-offer produces a card on
   next load, not a push. Listed in a brief; never built.
7. **Organisation + People writes** — legacy has REST routes, so this is wiring.
8. **Scoring / Workflow / Task Rules** — need new Firestore collections; legacy
   has no equivalent. **Decide first** whether these become settings-driven:
   today they are pure functions with tests asserting exact behaviour, and
   making them configurable means the tests assert *defaults* while real
   behaviour lives in a document.

### Deliberately not done, with reasons

- **`ExtensionStatus` as one nine-state enum** (requested,
  pending_manager_review, escalated_to_deadline, …). Several of those states
  collapse two conversations back into one — `escalated_to_deadline` is the
  budget record ending and a deadline record beginning, which two collections
  already express. Merging would undo §9.4's separation. `cancelled` is
  genuinely missing and worth adding.
- **Drag-and-drop for touch** — the planner uses native HTML5 DnD, which does
  not work on touch devices.
- **`extensionImpact` before/after table** — the rule is built and tested; not
  rendered, because the approver's card does not query the assignee's queue.
- **Rejection banner** for a declined extension — the timeline shows it; there
  is no prompt.

---

## 9.9 · Working method — what actually caught bugs

**Reproduce before fixing.** T648: I built the failing case first and got
`start: 09:30, blocking: 0, position: 1` — which named the cause (`?? 1`) rather
than the symptom. Do this every time; it took two minutes and removed all doubt.

**Probe injected helpers rather than trusting the fixture.** One `addWorkingSecs`
probe found that seven test files had been passing an ignored schedule (§9.1).

**Write the test that can fail for the real reason.** Several of my own
assertions were wrong and the code was right — a 6h budget increase delays the
next task by 21h, not 6h; moving a task from P2→P1 delays *one* task, not two.
Each wrong assertion taught something the passing version would not have.

**Source assertions are load-bearing here** (the repo has no component render
harness) — but they break on refactor. Bound slices by the **next method**, not
a character count; assert on the *call*, not on prose that may appear in a
comment; strip comments with `code()` first.

**Say what was not done.** Every report in this session ended with an explicit
"not done / not verified" list. Keep that — the value of this document is that
its gaps are named rather than discovered.

---

# Session 3 — 2026-07-30

Verify at handoff: **tsc clean · lint clean · 1815 tests, 0 failed · `next build`
exit 0 · check-secrets clean.**

The whole session is the **admin settings console**. Read §10.0 first.

---

## 10.0 · `/admin` was unreachable in production, and the guard looked like it worked

`app/admin/layout.tsx` gated on `currentSession()`, which reads the
`cowork_session` cookie **and nothing else**. `SignInForm` signs in through
Firebase and writes only the Firebase cookie — nothing on that path has ever
issued `cowork_session`.

So `if (!session) redirect("/signin")` fired for **every real employee, including
the chief executive.** The admin console could not be opened by anybody who signs
in the way staff actually sign in.

§9.0 recorded the one live observation available last session — `/admin/*` returns
307 unauthenticated — and read it as proof the gate fires. It was. It also fires
for the person who is supposed to get in, and a 307 cannot tell you which.

**This is the fourth instance of one bug**, and the pattern is now worth naming
rather than re-finding: `/api/livekit/token` 401, `/api/meetings/token` 401,
`/api/auth/directory` 401, and now the admin route gate. **Any server-side code
that asks `currentSession()` alone is closed to every real employee.**

Fixed by `lib/server/adminAuth.ts` — `currentAdminIdentity()` asks both systems
in order: `cowork_session`, else the Firebase cookie with its **signature
verified** against Google's JWKS, then `GET /cowork/me`, then
`archetypeForLegacyRole`. Same sources and same mapping the client already used,
moved to where the gate is instead of duplicated.

**A test pins it** (`access.test.ts`, "the gate resolves the archetype from BOTH
sign-in systems") because a regression here does not look like a permission bug —
it looks like the console being empty for everybody.

> **Still true and still unfixed: `/api/meetings/token` and
> `/api/auth/directory`.** Both can now take this fix; `adminAuth.ts` shows the
> shape. Meetings additionally needs an *identity*, not just "somebody real" —
> see §5.

---

## 10.1 · What the console is

```
/admin
    Overview                          ← app/admin/page.tsx, which did not exist
    Settings
        Task rules                    ← new
        Priority & scoring            ← new, reaches real scores
        Workflow routing              ← new
        Organisation                  ← read-only
        Office policy                 ← moved, audit split closed
        Provisional rules             ← moved, now persists
    Audit log                         ← extended
```

`/admin` had **no page at all** — the layout's guard ran and rendered nothing,
which is also why `landingFor("system_admin")` pointed at `/admin/organisation`.

Top level went from a flat strip of eight peers to three areas. Eight put "the
whole approval model" and "one editor for one document" at the same weight.

**`lib/rules/settings/sections.ts` is the registry.** The sub-navigation is
derived from it, and a test checks the registry against the filesystem in both
directions — a section listed and not built is a dead link, a page built and not
listed is reachable only by URL.

---

## 10.2 · The three enforcement classes, which are the point

Every section names where its values are stored **and who reads them once
saved**, on screen. That is the fact an administrator cannot get from a form, and
it is what decides whether a control can be trusted.

| Class | Sections | Who reads the value |
|---|---|---|
| `both` | Office policy, Organisation | Cowork **and** the legacy frontend and engine |
| `engine` | Priority & scoring | The Express engine's scoring services — **reaches published scores** |
| `cowork_ui` | Task rules, Workflow routing, Provisional rules | This app's rules layer only |

**`cowork_ui` is a real divergence, not a euphemism.** A rule tightened there is
tightened for people using this UI and not for anyone still on the old one. The
console says so rather than implying company-wide effect.

---

## 10.3 · The scoring discovery — no backend edit was needed

The owner chose "editable, and wire the Express engine", which would have meant
editing `cowork-old-backend` (read-only per §7, and **not a git repository**, so
unversioned).

**It turned out the wiring already exists.** The engine reads admin-set scoring
config from Firestore in **seven places**:

| Fields | Read by |
|---|---|
| `c1*` | `services/c1Service.js` → `getC1Config`; `soproutes/soproute.js /all-categories` |
| `c2GlobalMaxPoints` | `services/pmpService.js`; `task_routes/c2Band.routes.js` |
| `goal*` | `components/coworking/tasks/GoalTask.jsx` |
| `timer*` | `services/timerSop.service.js` → `evaluateTimerSop` |

Document: **`cowork_sop_settings/task_events`**. Legacy writes it straight from
the browser in `app/coworking/sop/page.js`, gated on `role === "ceo"` — the same
documented exception class as the timer, the duty document and
`cowork_settings/office`.

### The write has TWO halves and both are required

```
setDoc(cowork_sop_settings/task_events)   ← the engine's getC1Config reads this
POST /cowork/sop/settings/sync            ← mirrors into MongoDB BandConfig
```

`BandConfig.globalSettings.c1.*` is a second copy read by band resolution. Write
one and not the other and a score is **computed from one figure and explained
from another**, with nothing reporting it. Legacy's own page does both, in that
order. The route is `verifyCeoToken`.

`setScoringSettings` does both, and a mirror failure returns *"Saved, but the copy
the scoring engine keeps in its own store was not updated. The two now
disagree"* rather than success.

### Three defaults for one rule

`c1DeadlineDeduction`: **`c1Service.js` says 0.5**, legacy's sync route says 0.2,
our `PROVISIONAL_RULES.deadlineMissDeduction` says 0.2. Only the first is the
function that computes the score, so `DEFAULT_SCORING_SETTINGS` uses **0.5** and
the console shows that as "engine default". A test pins it.

### Zero has to survive

`Number(d.x) || fallback` — what legacy writes — turns a deliberate zero into the
default. Zero is how an administrator switches a deduction **off**. `readScoringSettings`
checks finiteness, not truthiness. Same for `timerSopEnabled`: only an explicit
`false` disables it, because an absent field means a workspace that has never
opened the page and defaulting to off would stop every deduction in the company
on first read.

---

## 10.4 · One write path, and the split from §9.7 is closed

**`#writeSettingsSection<T>` in `LegacyRepository` is THE settings write path.**
Private, so it cannot be called from outside. Five public setters are thin
wrappers supplying their own validation and document shape.

Fixed order, and the order is the point:

1. **Validate** — before the permission check, so a refusal for invalid input
   does not read like a security answer.
2. **Authorise** from `this.#ctx.archetype`, never inferred from a legacy role.
3. **Read what is in force** — no before-value means the log can only say what
   the setting became.
4. **Write, then log** (`applySettingsChange`). The reverse records changes that
   then failed to save.
5. **Mirror**, where a second store must not go stale.

### How the split was actually closed

§9.7 said the audit was wired to `setOfficePolicy` while the console rendered
`OfficeSettings.tsx` calling `setOfficeHours`. It was worse than described:
`getOfficeHours`, `setOfficeHours` and `listOfficeHoursHistory` are **all absent
from `LegacyRepository`**, so that panel could not even *load* in production —
the read reached the throwing proxy.

Closed by **deleting the second path**, not repointing it. `OfficeHours` models
one start and end for the week; the engine's schedule is per-day, so a company
that closes early on Saturday is representable there and not in that type — and
the discarded hours are the ones deadlines are computed from. A test asserts
`OfficeSettings.tsx` is **absent**, so it cannot be restored from history without
reading why it went.

**Five editors were deleted, all mock-only** — against the real engine each
rendered, accepted edits and threw `NotConnectedError` on save:
`OfficeSettings`, `OrgEditor`, `WorkflowEditor`, `ScoringRuleEditor`,
`BreakAllowanceEditor`. `/admin/workflows`, `/admin/scoring-rules`,
`/admin/organisation` and `/admin/provisional-rules` now redirect into the
sections that work, each stating why.

### The mock has the same path, and that is what makes the audit testable

`MockRepository.#writeSettings` calls the same `applySettingsChange` in the same
order. Firestore cannot be unit-tested; the shared rule can. `setOfficePolicy`
previously wrote `#officePolicy` and nothing else, so the demo tenant had
settings changes with no record — the defect the production path was fixed for.

---

## 10.5 · The four depths, and what the API layer does NOT do

| Depth | Where | What it decides |
|---|---|---|
| Navigation | `visibleNavItems(music, isAdmin)` | Whether the Admin entry renders. **Courtesy, not a gate.** |
| Route | `app/admin/layout.tsx` + `app/admin/settings/layout.tsx` | Server components; refuse before a byte ships |
| API | `app/api/admin/settings/route.ts` | 401 vs 403, server-resolved archetype |
| Repository | `#writeSettingsSection` | Every write, again |

**The API route is NOT in the path of the Firestore write, and this is written
down in the route itself so its limits are not mistaken for absence.** Settings
documents are written browser→Firestore with the user's own Firebase
credentials; there is **no service-account credential in this deployment**, so
the server cannot perform those writes on the caller's behalf.

Consequence, stated plainly: **a determined person with a valid employee token
could call Firestore directly and bypass both the route and the repository.** The
layer that would stop that is a Firestore security rule on
`cowork_settings/*` and `cowork_sop_settings/task_events` — **not deployed, and
deliberately not**: those collections are shared with the live legacy app, whose
own frontend writes them, and a rule refusing its writes would break it.

What the route genuinely does: the console's routing reflects a decision made
where the archetype is trustworthy, and the **audit entry's diff and its
`affectsDeadlines` flag are computed server-side**. A non-admin gets 403 and no
entry, so cannot produce a well-formed audit row. Permission is checked **before**
the body is parsed, so a malformed payload from a non-admin still gets the
permission answer.

`app/admin/settings/layout.tsx` gates on `canModifySettings`, which is provably
equal to `canAccessAdminConsole` today. The seam exists so a **read-only
auditor** — the obvious next archetype — is one predicate change rather than a
hunt for every editor.

---

## 10.6 · The confirmation, and why the diff is the audit's diff

`SettingsSaveBar` is **one component so no section can forget it.** The office
panel had a review dialog; the provisional panel, writing the same document, had a
bare Save.

It builds its preview with `diffFields` — the same function the log records with
— so the rows a person confirms are exactly the rows that get written. A
separately-built preview drifts, and then the screen and the log describe one save
differently, which is worse than no preview because both look authoritative.

The deadline warning is **derived from the changed paths** via
`affectsDeadlines(fields)`, not from a section flag: a timezone edit and a holiday
edit are the same section and not the same consequence.

Wording: *"This change may recalculate active task deadlines"*, then *"Committed
deadlines are not moved. What is recalculated is the operational date."* Warning
without that distinction makes an administrator afraid of a correct edit.

---

## 10.7 · What the new settings actually control, and what is deliberately absent

**The test a rule had to pass to be exposed**: it is a *gate* with two defensible
answers, it is currently a constant somebody chose, and an organisation would
plausibly change it after a month.

**Task rules** (`cowork_settings/task_rules`) — outstanding criteria block or
warn; timer required or not; submission note optional or required; rejected task
resubmits or must be reopened; proposal expiry in hours (0 = never lapses).

**Workflow routing** (`cowork_settings/workflow_routing`) — the two chains are
**shown and not editable**, with the reason on screen. What is editable is where
the code previously *guessed*: `budgetApproverId` returned
`primaryManagerId ?? assigneeId`, which is right for a CEO and wrong for a new
joiner with an incomplete record, and the code cannot tell them apart. Now
`self` / `named_fallback` / `block`. Plus whether a manager may override an
infeasible budget, and a stuck-approval threshold that **reports, never
reassigns** — moving a decision automatically produces an approval nobody
consciously gave.

**Absent on purpose**, and the console says so: task statuses (the engine's
vocabulary), priority position (derived from the queue — there is no weight to
set), the hours-vs-date split (enforced by the types), reporting lines and
departments (HR records).

### Every default reproduces today's behaviour, exactly

An unsaved document changes nothing. This matters more than it sounds: the
existing rule tests assert exact behaviour, and a default differing by one field
would turn them into assertions about a document nobody wrote. A test pins every
default.

### These are wired, not just stored

A persisted value nothing reads is the fake state this work exists to remove.
`budgetApproverId` and `mayApproveBudget` were exported from
`extensionRouting.ts` and called from **nowhere** in the product.

- `requestTimeBudgetExtension` → `routedBudgetApproverId`, and **refuses by name**
  via `routingRefusal` rather than creating a record with a null approver (which
  on screen is indistinguishable from waiting on somebody who will never answer).
- `requestDeadlineExtension` → `routedDeadlineApproverId`.
- `submitCompletion` → `submissionRefusal`, reading `view.completion.outstanding`
  and `view.loggedSecs` **off the view rather than recomputing** — `TaskView.completion`
  is derived on every read precisely so the detail page and the gate cannot
  disagree. The extra read happens only when a rule needs it.

---

## 10.8 · Provisional rules — the fake state, closed

Overrides lived in a module-level `Map` in `lib/config/settings.ts`. That is the
right place for the *read* (the engine is called from the repository, below any
component). **Nothing ever wrote it to storage.** An administrator published a
value, the card showed it, the engine used it, and a refresh restored the seeded
placeholder with nothing saying so — two people could see different numbers for
the same rule depending on who had reloaded.

Now `cowork_settings/rule_overrides`, plus two load-bearing calls to
`applyRuleOverrides`:

- **`SessionProvider`**, at the point the repository goes live and before the
  first query — a score computed between mount and that read would use the
  placeholder.
- **On save**, so this browser stops using the old figure without a reload.

`applyRuleOverrides` **replaces, never merges**: a cleared override must not
survive the load, or `isOverridden` — the badge that tells a decision from a
placeholder — would say yes forever.

**Unpublishing deletes the key** rather than writing the default back. "An
administrator chose 0.2" and "nobody has decided, and the placeholder is 0.2" are
different facts.

Unknown keys are **dropped on read**: `ruleValue` throws on an unknown key, and
loading a stale one from Firestore would turn a removed rule into a crash inside
a score calculation, far from the document that caused it.

---

## 10.9 · Organisation is read-only, by owner decision

Reporting lines live in MongoDB `Employee.primaryManager`, written through HR's
routes, which authenticate against HR rather than Cowork. `POST
/cowork/employee/:id/change-department` **is** reachable with a Cowork token, and
was deliberately left unwired: the owner chose a read-only view.

Why it matters more here than elsewhere: the closure is the source of truth for
**three** things — what a manager may see, who may be monitored, and who approves
an extension. A reporting line edited in the wrong store does not fail loudly; it
silently changes who can read somebody's work.

`listReportingLines` was promoted to the `CoworkRepository` interface (it was
legacy-only) and given a mock implementation derived from the fixture's own edges.
It is richer than `listReporting`, which returns edges and cannot say depth,
report count, or whether a named manager is a Cowork account. **`depth` is null,
never 0**, when the chain cannot be resolved — a person whose manager is missing
from the directory is not the same as a person at the top.

---

## 10.10 · Files that matter

| File | Why |
|---|---|
| `lib/server/adminAuth.ts` | **The fix for §10.0.** Archetype from either sign-in system |
| `lib/rules/settings/sections.ts` | The registry. Store + enforcement class per section |
| `lib/rules/settings/scoringSettings.ts` | The engine's real scoring surface, defaults taken from `c1Service.js` |
| `lib/rules/settings/taskRules.ts` | Five gates + `submissionRefusal` |
| `lib/rules/settings/workflowRouting.ts` | Fallbacks + `routedBudgetApproverId` |
| `lib/rules/settings/ruleOverrides.ts` | Provisional values, made durable |
| `lib/repositories/legacy/index.ts` | `#writeSettingsSection` — the one write path |
| `components/features/admin/SettingsSaveBar.tsx` | The confirmation no section can forget |
| `components/features/admin/SettingsShell.tsx` | The frame that states provenance |
| `app/api/admin/settings/route.ts` | Server-side 403; limits documented in the file |
| `lib/rules/settings/console.test.ts` | The nine required tests, and 15 more |

---

## 10.11 · Tests

**1815 passing, 0 failing.** The nine required, all in
`lib/rules/settings/console.test.ts`:

1. `system_admin` can access `/admin/settings` · 2. employee cannot · 3. manager
cannot (plus `skip_level`, `people_ops`) · 4. API rejects non-admin mutations ·
5. office policy changes create audit entries · 6. priority changes persist ·
7. workflow changes persist · 8. provisional rules persist · 9. audit entries
carry old **and** new value per field.

**Persistence is tested against `applySettingsChange` directly**, with each
section's own `read`/`validate`/`write`. `MockRepository` imports through `@/`,
which `node --test` does not resolve — and this is the better test anyway: a
section whose document shape does not survive a round trip fails here rather than
in production.

### Six pre-existing tests were updated, and one was deliberately inverted

Five were source assertions describing the old structure. The inverted one:
*"unconfirmed rules are shown and NOT editable"* → *"provisional values are
editable AND persist"*. The old reasoning was that a control would imply the
value was settled **and** that changing it did something; the second half was
true and is now false. Replaced rather than deleted, so the change of mind is
legible.

`nothing writes the office document outside the service` was asserting a literal
`setDoc(doc(..., "cowork_settings", "office"` and passed partly because
`setOfficeHours` did not exist. It now asserts **zero** literal-path writes to
either settings collection and exactly one `setDoc` in the shared writer.

---

## 10.12 · Help knowledge base

Per `CLAUDE.md`, updated in the same change. Three articles described **deleted**
behaviour and were rewritten; four are new.

Rewritten: `settings-provisional-rules` (read-only → editable and durable),
`settings-workflows` (stage editor → routing), `settings-scoring-rules`
(versioned rule editor → the engine's real values, two-store write, C4 not
editable here).

New: `settings-console`, `settings-office-policy`, `settings-task-rules`,
`settings-audit-log`.

Refusals are quoted, not paraphrased — including *"This change may recalculate
active task deadlines"*.

---

## 10.13 · Not done, and not verified

**Nothing in this session has been seen in a browser.** Same constraint as §9.0:
no authenticated session. Everything is proven by tsc, lint, 1815 unit tests
against real rule functions, source assertions, and a clean production build.

> **§10.0 means the two-browser test from §6 could never have passed for
> `/admin`.** It is now unblocked, and it is the first thing to do.

1. **Sign in as `GR0000` and open `/admin`.** Confirm the Admin entry appears in
   the top bar, Overview renders, and all six sections load. Then sign in as
   `GR0045` (TL) and confirm no Admin entry and that `/admin` redirects.
2. **Save office policy and read the audit log.** The one loop that exercises
   confirmation → write → audit → viewer end to end.
3. **Save a scoring value and check `BandConfig` in MongoDB.** The mirror is the
   half most likely to fail in production — `POST /cowork/sop/settings/sync` is
   `verifyCeoToken` and has never been called from this app.
4. **Restart the legacy Node backend** — still outstanding from §9.8.2, unrelated
   to this session but still true.

### Deliberately not done, with reasons

- **Firestore security rules** on the settings documents. They are the only thing
  that would make the write itself unbypassable, and they would break the live
  legacy app, which writes the same documents. Needs an owner decision about
  cutting the old frontend over first.
- **Wiring `change-department`.** The route exists and is reachable; the owner
  chose a read-only Organisation section.
- **Role editing.** Legacy stores a role as one of three words on an employee,
  not a record with permissions. Needs a new store, not wiring — unchanged
  from §9.7.
- **C4 attendance values.** HR's Mongo config, HR's auth domain. Exposing them
  would create a second place an attendance rule can be changed.
- **`OrgEditor`'s department and reporting writes.** Five mock-only methods; the
  page redirects rather than offering controls that throw.
- **A `people_ops` directory outside `/admin`.** Still the recommended fix if
  people-ops needs the directory back (§9.5).

---

# Session 4 — 2026-07-30 · the time-budget negotiation

Verify at handoff: **tsc clean · lint clean · 1837 tests, 0 failed · `next build`
exit 0 · check-secrets clean.**

Reported: *"the frontend shows 'waiting for assignee confirmation' but the
assignee has no action."* **Three separate defects produce that one sentence.**
Each needed its own fix, and a fix aimed at the screen would have closed one.

---

## 11.0 · Root cause: there were TWO budget state machines

| | Parties | States | Enforcement |
|---|---|---|---|
| **Engine** `budgetNegotiation` | assignor ↔ assignee | `WAITING_FOR_ASSIGNEE` / `WAITING_FOR_ASSIGNOR` / `ACCEPTED` | transactional, `waitingFor` **is** the permission |
| **Ours** `cowork_task_budget_extensions` | assignee → **primary manager** | `pending` / `approved` / `rejected` | Firestore write, no transition check |

The engine's loop is complete: symmetric, looping, `assertTurn` refuses anybody
it is not waiting on, and `acceptBudget` writes `senderTimerWindowSecs` **on any
task status**. Ours could not express the reported step at all.

### Defect 1 — `approved` was terminal

`budgetAction()` returned `none` for anything other than `pending`. So a
manager's answer *ended* the conversation, and "your manager granted four hours,
confirm them" was **not a state the record could hold**. `approved` now hands the
turn to the assignee; `accepted` is the terminal agreement.

**Why the assignee must confirm at all:** a manager may grant FEWER hours than
were asked for. Their answer is an offer about somebody else's week, and applying
it silently commits somebody to a figure they never agreed to and then measures
them against it.

### Defect 2 — the approval path could never succeed

`decideTimeBudgetExtension` applied the budget via `setEffortEstimate` →
`POST /cowork/task/:id/department-tl-set-hours`, whose handler opens:

```js
if (task.status !== "pending_tl_hours")
  return res.status(400).json({ error: "This task is not waiting on TL hours — it may already be active." })
```

An extension is requested on work that is **already running**, so this refused
every time. The early return left the record `pending`, so the audit trail said
nobody had decided anything.

### Defect 3 — a wait rendered for a turn nobody owned

`waitingOnLabel` returned *"Waiting for the assignee to accept"* whenever the
owner id was missing, while `canAccept` was false for **everybody including that
assignee**. The screen named an action nobody could take.

Two ways to reach it: the engine wrote `waitingFor: null`, or — the common one —
**our mapper derived the opening negotiation from `assigneeIds[0]` while the
engine resolves `pendingAssigneeId || assigneeIds[0]`.** On the
cross-department path the assignee is not in `assigneeIds` until the hours are
set, so the one person who could answer was not named. Same bug class as the four
reads fixed in §9.3.

---

## 11.1 · `getExtensionActions` — the single authority

`lib/rules/tasks/extensionAuthority.ts`. Asked by every card before it renders a
control **and** by every repository transition before it accepts a write.

```ts
getExtensionActions(viewerId, { negotiation, budget, deadline }) → {
  canAccept, canNegotiate, canReject,
  nextActor, statusLabel, actionType, currentSecs, round
}
```

Resolution order, deliberate: **live budget record → engine negotiation →
deadline record.** Exactly one live turn, always — two is how somebody is shown
two cards that disagree about what happens next.

`budgetTurn`, `budgetAction`, `deadlineAction` and `pendingAction` all **delegate
to it now** rather than deciding independently. `PendingActionKind` is an alias of
`ExtensionActionType`, so there is one enumeration.

### `actionType: "unowned"` is the new load-bearing state

A live turn whose owner cannot be resolved is a **fault, not a wait** — no amount
of waiting resolves it, and the fix is an administrator completing a reporting
line. It renders a named notice saying so. `waitingOnLabel` and `waitingSentence`
return **null** for it, so the misleading sentence cannot come back.

**Subtlety worth keeping:** an owner whose *name* we cannot resolve still reads as
a role ("the assignee"). I first changed that to show the raw employee id and a
pre-existing test correctly caught it. The distinction is **owner missing** vs
**name missing**; only the first is a fault.

### `transitionRefusal` — the write's copy of the same question

Returns the refusal **sentence**, not a boolean, so no call site invents wording.
`"It is not your turn — the other side is deciding."` also delivers *you cannot
decide your own request*: after asking, you are never the one waited on.

---

## 11.2 · The loop

```
pending          → approver (manager): grant · grant a different figure · decline
approved         → requester (assignee): accept · ask again          ← was terminal
counter_proposed → approver (manager): answer again
accepted         → nobody. The budget is in force.
rejected         → nobody. Nothing changed.
```

`approved → counter_proposed → approved → …` and the **only exit is `accepted`.**
No round limit: a cap would end the conversation on somebody's terms rather than
by consent.

**`canReject` is true only on the FIRST answer.** Once a figure has been offered
and countered, the conversation is a negotiation and a refusal would leave the
work carrying a figure neither side settled. Disagreeing means countering.

New record fields: `approvedSecs` (the manager's figure, **null** when they
granted exactly what was asked — "granted what you asked" and "granted 4h" are
different facts), `round`, `confirmedAt`, `confirmedBy`.

`DeadlineExtensionStatus` is now the same union. The deadline record always had
`counter_proposed`; the budget one not having it was the gap.

---

## 11.3 · Where the budget is applied, and why it is fiddly

**Only on confirmation.** `#applyAgreedBudget` tries two routes because neither
works in every case:

1. **`POST /cowork/task/:id/budget/accept`** — preferred: transactional, writes
   `senderTimerWindowSecs`, appends the history the timeline reads. Used only when
   the engine's negotiation already holds this figure **and** names this person as
   the one waited on, else its `assertTurn` refuses.
2. **`setEffortEstimate`** — the fallback, and **its refusal is surfaced rather
   than swallowed.** The record stays at `approved` (still the assignee's turn), so
   a failure leaves a state somebody can retry from rather than a settled record
   over a budget that never moved.

> **Not fixed, and it is the honest gap:** the two machines still have **different
> parties** — engine is assignor↔assignee, ours is assignee↔primary manager
> (§9.4's rule, and correct). So on a cross-department task where the manager is
> not the assignor, route 1 cannot be used and route 2 may still 400. Closing that
> needs a backend route accepting a manager-set budget on an active task, which
> the read-only-repo constraint forbids. **Confirm this against a real
> cross-department task before relying on it.**

Applied **before** the record is marked settled: a record claiming agreement over
a budget that never moved is the worse failure, because nothing afterwards would
report the difference.

---

## 11.4 · Files changed

| File | Change |
|---|---|
| `lib/rules/tasks/extensionAuthority.ts` | **New. The one authority** + `transitionRefusal` + `UNOWNED_TURN_NOTICE` |
| `lib/rules/tasks/extensionRecords.ts` | `ExtensionStatus` gains `counter_proposed`/`accepted`; `approvedSecs`, `round`, `confirmedAt`, `confirmedBy` |
| `lib/rules/tasks/extensionActions.ts` | Delegates; `PendingActionKind` is now an alias |
| `lib/rules/tasks/budgetNegotiation.ts` | Delegates; `BudgetTurn.unowned` added |
| `lib/rules/tasks/extensionTimeline.ts` | `budget_counter_proposed`, `budget_accepted`; approval now names who it waits on |
| `lib/legacy/tasks.ts` | **`pendingAssigneeId` first**, matching the engine |
| `lib/repositories/legacy/index.ts` | Approval stops applying; `confirmTimeBudgetExtension`; `#applyAgreedBudget` |
| `lib/repositories/mock/index.ts` | Same loop, so it is unit-testable |
| `components/features/tasks/BudgetConfirmationCard.tsx` | **New. The surface that did not exist** |
| `components/features/tasks/ExtensionDecisionCard.tsx` | Reads `counter_proposed` too — reading only `pending` made the loop one-way |
| `components/features/tasks/TaskDetail.tsx`, `DeadlinePanel.tsx` | Mount the new card |

---

## 11.5 · Tests

**1837 passing.** `budgetLoop.test.ts` is the ten numbered scenarios;
`budgetDeadEnd.test.ts` holds the reproductions, written to fail first.

**The guard test was itself the reason this shipped broken.** It named three
action kinds by hand, so `confirm_budget` could be added to the state machine and
reached by a record with nothing noticing there was no surface. It now **parses
`ExtensionActionType` out of the source** and requires a surface per kind — a
guard needing manual updating to catch a new dead end does not catch new dead
ends.

### Seven pre-existing tests updated, and the reversals are explicit

`once the hours are answered nobody is waiting` → **`once the hours are SETTLED`**,
because `approved` is no longer terminal. Also: the mock's branch inverted
(`rejected` is the early return now), `approving hours moves the budget` →
`CONFIRMING hours moves the budget`, and the timeline's approval row now waits on
`PRAMOD` where it asserted `null`.

---

## 11.6 · Not verified

**Nothing seen in a browser** — same constraint as §9.0 and §10.13. In order:

1. **Drive the loop on a real task**: ask → grant a *different* figure → confirm
   the card appears with Accept and Propose → accept → check the budget and the
   operational date moved.
2. **The cross-department case in §11.3.** The path most likely to still refuse.
3. **Ask again from the confirmation card** and check the manager's card renders
   for round 2 — `ExtensionDecisionCard` reading `counter_proposed` is new.
4. **A task at the cross-department gate**, for the `pendingAssigneeId` mapper fix:
   before it, that task showed a wait with no button for anybody.

### Deliberately not done

- **Merging the two machines.** They have different parties by design and §9.4 is
  right about why. `getExtensionActions` unifies the *question* without merging
  the records.
- **Notifications.** Still nothing emits one (§9.8.6). A granted budget produces a
  card on next load, not a push — and this flow adds a step that now needs one.
- **`isExtension`/`extensionSecs` on `proposeDeadline`.** Our propose never marks
  itself as an extension, so the engine's own `extensions[]` audit array is never
  appended. Related, separate, and not touched.

---

# Session 5 — 2026-07-30 · assignment acceptance

Verify at handoff: **tsc clean · lint clean · 1855 tests, 0 failed · `next build`
exit 0 · check-secrets clean.**

Reported on T651: **"Waiting for Umung Arora — you"** and *"The assignee has not
accepted it yet."*, with no control for Umung.

**This is the same bug class as §11, found a third time.** The pattern is now
established enough to state as a rule: *a screen condition stricter than the
engine's, combined with a suppressed fallback, renders a prompt with nothing
behind it.*

---

## 12.0 · Root cause

The acceptance control was an inline condition in `TaskDetail`:

```tsx
{v.task.status === "assigned" && v.task.deadline.state === "agreed" && (
  <Button>Confirm receipt</Button>
)}
```

**Defect 1 — stricter than the engine.** `confirmTaskReceipt` (in
`services/taskForward.service.js`) skips the deadline requirement entirely:

```js
const needsDeadlineCheck = !task.isRepeat && !task.isThirdParty && !task.isGoal
  && task.hasTimer !== true   // timer/budget task — skipped
  && task.hasTimer !== false; // assignor set the date — skipped
```

Only a legacy task with `hasTimer` **absent** needs a deadline first. T651 is a
budget task whose window was still being agreed, so `deadline.state` was `unset`
— the engine would have accepted the confirmation and the screen would not offer
it.

**Defect 2 — the fallback was suppressed at the same time.** The generic "Go"
link carried `v.task.status !== "assigned"`. So on `assigned`: the confirm branch
false, the start branch false, the fallback excluded. **All three false at once**,
and the card rendered "Your move" above nothing.

**Defect 3 — no viewer check at all.** That condition never asked who was
looking, so the task's **creator** was shown "Confirm receipt" on a write the
engine 403s. The same defect as the dead end, from the other side.

---

## 12.1 · `getAssignmentActions` — the authority

`lib/rules/tasks/assignmentAcceptance.ts`. Read by the card before it renders and
by both repositories before they write.

```ts
getAssignmentActions(viewerId, view) → {
  actionType, canAccept, canRefuseTerms, nextActor, statusLabel
}
```

`actionType` is one of `accept_assignment` · `await_assignee` · `unowned` ·
`none`, and **every one has a rendered surface** (a test enumerates them).

### Two rules, in opposite directions, and both are load-bearing

**Do not be stricter than the engine.** Where a precondition is the engine's to
judge, offer the control and let its refusal speak — it returns actionable
sentences like *"Please propose a deadline and get it approved before
confirming."* Hiding the button converts a message somebody can act on into a
screen with nothing on it. `acceptanceRefusal` deliberately does **not** re-check
the deadline.

**Do not be looser about WHO.** Only the pending assignee. The creator, a
stranger, and a manager who is not the assignee all get `await_assignee` — told
whose move it is and offered nothing, because accepting for somebody would record
their agreement to a deadline they never saw.

### `pendingAccepters` reads per ASSIGNMENT, not per task

`TaskAssignment.confirmedAt` (null = not yet), plus `pendingAssignees`. Two
reasons: on work given to three people, one accepting must not clear the wait for
the other two; and somebody behind a cross-department gate has no assignment row
yet — **the fourth time `pendingAssigneeId` has had to be added to a read.**

---

## 12.2 · Declining does not exist, and the UI no longer implies it does

> **`assignment_rejected` is NOT an assignee declining work.** It maps from
> legacy's `"rejected"`, which is a **cross-department approver refusing a gate**.
> There is no assignee-side decline route anywhere in the engine — I searched every
> POST/PATCH in `taskForward.js` and `taskTree.routes.js`.

This corrects **`lib/help/knowledge.ts`**, which said *"assignment rejected, when
someone declines work assigned to them"* — plausible, wrong, and exactly the kind
of stale answer the help rules exist to prevent.

It also follows from the model: assignment is consent, not permission (§3.5).
Anybody may assign to anybody; the approval gates hold the work.

**What the engine does offer** is `POST /task/:id/reject-sender-timer` — the
assignee refusing the **terms**, with a required reason, which sets
`senderTimerRejected` and opens the negotiation. **It does not change status.**

So the button is labelled **"Ask for different terms"**, not "Decline task", and
the card says plainly *"there is no way to hand it back entirely."* A test bans
the string `Decline task` from that file. It is offered only where there is a
proposed window to refuse — the route 400s without one.

---

## 12.3 · The phrasing, which was half the report

`"Waiting for X — you"` is now impossible. Where the turn is the reader's:

| Surface | Was | Now |
|---|---|---|
| Flow eyebrow | `Waiting for Umung Arora — you` | `Your move — accept this task` |
| Flow sentence | `The assignee has not accepted it yet.` | `You have not accepted it yet — accept it above to start work.` |

A person reading their own name after "Waiting for" is being told they *are* the
delay. `taskFlow` takes `acceptanceIsViewers` from the same resolver the card
uses, so the sentence and the control cannot disagree about whose move it is.

---

## 12.4 · Files changed

| File | Change |
|---|---|
| `lib/rules/tasks/assignmentAcceptance.ts` | **New. The authority** + `acceptanceRefusal`, `refuseTermsRefusal`, `UNASSIGNED_ACCEPTANCE_NOTICE` |
| `components/features/tasks/AssignmentConfirmationCard.tsx` | **New.** The card, with task ref / assigned by / priority / expected completion / time budget |
| `components/features/tasks/TaskDetail.tsx` | Inline condition **deleted**; fallback link no longer excludes `assigned`; card mounted |
| `lib/rules/tasks/taskFlow.ts` | `acceptanceIsViewers` — second person where it is the reader's |
| `components/features/tasks/TaskFlowSection.tsx` | "Your move" branch before the generic wait |
| `lib/repositories/legacy/index.ts` | `confirmTask` authorises through `acceptanceRefusal` |
| `lib/repositories/mock/index.ts` | Dropped the `deadline.state !== "agreed"` refusal — it was stricter than the engine, same as the UI |
| `lib/help/knowledge.ts` | Corrected the `assignment_rejected` claim; documented the acceptance step |

---

## 12.5 · Tests

**1855 passing.** `assignmentAcceptance.test.ts` is the seven required scenarios
plus the sweep. Two general guards worth knowing about:

- **`no state reports actor 'you' without somewhere to act`** — parses every
  `actor: "you"` branch out of `nextAction` and requires an `href` within its own
  object literal, because the fallback link renders on that and nothing else.
- **`the fallback link is suppressed only where a specific control is certain`** —
  pins the actual mechanism. `confirmed` may stay excluded because its own button
  is gated on nothing but the status; `assigned` may not, and no longer is.

My own doc comment explaining *why there is no "Decline task" button* contains
that phrase, and the ban assertion caught it. The tests now strip comments with
the codebase's `code()` helper first.

---

## 12.6 · Not verified

**Nothing seen in a browser.** In order:

1. **Open T651 as Umung.** The card should render with Accept task, and the
   eyebrow should read "Your move — accept this task".
2. **Open T651 as Rishee.** No controls — "Waiting for Umung Arora to accept".
3. **Accept it**, and confirm the flow advances to `confirmed` and the timer
   becomes available.
4. **A task with neither a budget nor a date.** The engine refuses with *"Please
   propose a deadline and get it approved before confirming"*; that message should
   now reach the card instead of the button being hidden.

### The pattern to check next

Three sessions, three instances of one shape. Worth a sweep of its own:
**anywhere a screen condition duplicates a precondition the engine owns.**
`windowOnOffer`, `mayReview` and the approval-chain gates are the remaining
candidates — each re-derives something the engine also decides.

---

# Session 6 — 2026-07-30 · the priority system

Verify at handoff: **tsc clean · lint clean · 1872 tests, 0 failed · `next build`
exit 0 · check-secrets clean.**

A full audit was asked for rather than a patch. Four cases were named; **one was
real, one rested on a premise that does not hold, one was already correct, and one
needed documenting.**

---

## 13.0 · The premise that does not hold, stated first

> *"A task has one operational priority. Everyone should see the same priority."*

**Priority is per person by design, and flattening it would be a regression.**

Legacy stores `assigneePriorities[employeeId]` and reads
`assigneePriorities[me] ?? priority ?? 999`. It writes one rank per assignee at
assignment time, each being **that person's own open-task count plus one**. The
help corpus already documents the consequence: *"each person has their own queue,
so somebody else finishing their P1 never changes yours."*

One shared number would order everybody's day by one colleague's queue position —
which is the defect the per-person map exists to prevent.

**What legitimately must be consistent is the scale and the subject**: one viewer
sees one number for one task on every screen, and the label says whose it is.
That is what was broken, and it is what §13.1 fixes.

The task *does* also have a shared figure — `priority`, which every per-person
rank falls back to. `getTaskPriority(task)` returns it, so the "one operational
priority" is available where it is the right question.

---

## 13.1 · Case 1 was real: one field, two scales

```ts
// the mapper, before
rank: queue && queue.ownerId === employeeId
  ? (queue.positions.get(id) ?? resolveTaskPriority(...))   // DERIVED 1..N
  : resolveTaskPriority(...)                                 // STORED 1..10
```

And the two read paths supply different owners:

| Path | `queue.ownerId` |
|---|---|
| `listTasks` | **the viewer** |
| `#readTaskView` | the viewer *if they hold it*, else the first holder |

So a manager opening a report's task got the **assignee's derived queue
position**; the same manager in the list got the **stored priority**. Two scales,
both rendered `P{n}`. That is *"detail says P1, list says P3"*.

**The fix is to make them un-conflatable**, not to pick a winner:

| Concept | Scale | Field | Written by |
|---|---|---|---|
| Stored rank | 1–10, 1 highest | `TaskAssignment.rank` | a manager, deliberately |
| Queue position | 1..N over live work | `TaskAssignment.queuePosition` | nobody — derived per read |

`queuePosition` is **null where that person's queue was not the one read**, which
is the honest answer: a list read fetches one queue, so every other assignee's
position is genuinely unknown rather than zero. A caller must not substitute
`rank` for it, and the domain type says so.

---

## 13.2 · `lib/rules/tasks/priority.ts` — the authority

Composes the pieces that were already individually correct rather than replacing
them; each carries hard-won rules a rewrite would have lost.

| Function | Answers |
|---|---|
| `getPersonPriority` | one person's priority, and **which scale** it came from |
| `getTaskPriority` | the task's own shared figure, belonging to nobody |
| `displayPriority` | **the one decision** every surface makes |
| `describePriority` | which scale AND whose, for a tooltip |
| `canChangePriority` / `priorityChangeRefusal` | who may change it, and why not |
| `updateTaskPriority` / `clampRank` | the whole-queue reorder |
| `queuePositions` | the derivation, re-exported so there is one import |

`rankFor` and the mapper's `myRank` now delegate. `TaskPriority` carries `scale`
and `subjectId`, which is what the old single number could never say.

### It operates on RESOLVED inputs, and that was a correction

My first version had `displayPriority` read `priority` / `assigneePriorities` off
the task. **The domain `Task` does not carry those fields at all** — they are
legacy wire fields resolved once at the mapper boundary. It typechecked anyway,
because every field on `PriorityCarrier` is optional, and it would have silently
read `undefined` on every screen.

So: the mapper resolves *through* `getPersonPriority`, and `displayPriority`
decides between already-resolved facts. The two cannot disagree.

---

## 13.3 · Case 3 was already correct — verified, not fixed

`activeQueuePositions` sorts by **stored rank first**, then `order`, then
`createdAt`, then id. A P1 cannot appear behind a P3. Closed work and anything
whose budget is unsettled hold no slot at all, and `#chainQueue` chains the dates
in that same order — so priority → position → expected completion is connected.

Now pinned by tests (`3`, `3b`, `3c`) so it stays that way.

---

## 13.4 · Case 4 — the lifecycle, defined

| Stage | What happens to priority |
|---|---|
| Creation | engine writes `priority` (default 5) and one `assigneePriorities` entry per assignee, each = that person's open-task count + 1 |
| Assignment | as above — the rank IS the assignment |
| Acceptance | **unchanged.** Accepting is consent, not a reordering |
| Budget / deadline extension | **stored rank unchanged.** The derived position and the dates move, because the queue is re-chained from the new budget |
| Escalation | unchanged |
| Reassignment | a new assignee gets their own entry; nobody else's moves |
| Completion | **stored rank frozen.** It becomes the record — "was P3" — and the task leaves the queue, so everything behind it moves up **with no write** |

**Stored or derived?** Both, and the distinction is the whole point. Stored is
what a manager set; derived is where it currently sits. Only the first is written,
and only ever through `changePriority` → `reorderPriorities`, which writes the
**whole queue** because moving one task moves the queue.

**Who may change it:** the subject's manager, or the subject themselves only if
nobody manages them. Never on a closed task. Two halves — capability reach and
the not-your-own rule — and `can()` cannot express the second, because its scope
check returns true for yourself before scope is consulted.

---

## 13.5 · Files changed

| File | Change |
|---|---|
| `lib/rules/tasks/priority.ts` | **New. The authority.** |
| `lib/domain/tasks.ts` | `TaskAssignment.queuePosition`; `rank` documented as strictly stored |
| `lib/repositories/legacy/taskMap.ts` | `rank` always stored; `queuePosition` separate; `myRank` through the authority; **`toTaskStatus`, not `legacy.status`** |
| `lib/rules/tasks/priorityDisplay.ts` | `rankFor` is a translation now |
| `lib/repositories/mock/index.ts`, `lib/seed/seed.ts` | `queuePosition: null` — never stored |

---

## 13.6 · Tests

**1872 passing.** `priorityAuthority.test.ts` covers the four cases in order.

**Three of my own errors were caught by pre-existing tests**, which is the system
working:

1. Reaching for `priority` on the domain `Task`, which does not have it.
2. **Losing the legacy fall-through.** Returning null for a holder whose own
   reading is unusable showed a dash to the one person holding the work — the
   exact bug §9.3 fixed, reached from a new direction. Pinned now as test `2c`.
3. Asserting on a doc comment, which `code()` strips. Same lesson as §11.

---

## 13.7 · Not verified, and what to watch

**Nothing seen in a browser.** In order:

1. **Open one task as a manager, in the list and on the detail page.** The numbers
   may legitimately differ — a position and a stored rank are different facts — but
   each should now be labelled for what it is. If they still both read a bare
   `P{n}` with no distinction, a surface is bypassing `formatPriority`.
2. **A shared task**, to confirm each assignee reads their own rank.
3. **Complete a P1** and confirm the rest move up with no write.

### The remaining inconsistency, named rather than hidden

A **position** and a **stored rank** are still both rendered `P{n}`. `TaskPriority`
now carries `scale`, and `describePriority` explains it in a tooltip — but no
surface renders the two *visually* differently. Whether they should is a product
decision I did not take: distinguishing them everywhere would touch every task
surface, and conflating them was the bug, not the notation.

---

# Session 7 — 2026-07-30 · the priority queue

Verify at handoff: **tsc clean · lint clean · 1882 tests, 0 failed · `next build`
exit 0 · check-secrets clean.**

Reported: duplicate P1/P2/P3, inactive tasks holding priority, ordering not a
valid queue. **Reproduced first**, which bounded the fault usefully.

---

## 14.0 · The derivation was already sound; the STORED data was not

`activeQueuePositions` numbers by array index, so it **cannot** emit a duplicate
or a gap. Test `the DERIVED positions are unique and continuous even from bad
stored data` pins that, and it is what narrowed the search.

The stored ranks are a different matter, and they are **what everybody except the
queue owner reads**:

- Legacy writes `assigneePriorities[id] = that person's open-task count + 1`, per
  assignee, independently, at assignment time. Two tasks created before either was
  counted both get the same number.
- Nothing ever normalised the set. A completed task keeps its rank, so live work
  below it sits at 3 and 5 with nothing at 2 or 4.
- A list read fetches only the **viewer's** queue, so a manager reading a report's
  tasks falls through to those raw numbers — duplicates, gaps and all.

So the derivation papered over bad data for exactly one person. The fix makes the
data satisfy the rule rather than compensating at every read.

---

## 14.1 · `lib/rules/tasks/priorityQueue.ts` — the queue authority

| Function | Answers |
|---|---|
| `isActiveWorkload` | does this hold a priority slot? |
| `getActiveTasksForUser` | this person's active workload |
| `calculatePriorityOrder` | the order, as task ids |
| `assignPriorityRanks` | 1..N, unique and continuous **by construction** |
| `normalizePriorityQueue` | what the queue should be, and which stored ranks disagree |
| `describeQueueFault` | one sentence for a diagnostic |

`activeQueuePositions` now **delegates** to it, so the reader and the writer are
one expression of the rule. Before, the filter and sort lived only in the reader —
which is why a queue could read as 1..N and store `1, 1, 3, 5`.

`assignPriorityRanks` takes no rank argument. There is deliberately no way to pass
one in; that is what let two tasks hold P1.

---

## 14.2 · Active is about ACCEPTANCE, not only status

**This narrows §13.4.** `assigned` is the awaiting-acceptance state, and it was in
`ACTIVE_STATUSES` — so work nobody had taken on pushed accepted work down a place.

But `assigned` is **also the mapper's fallback for any unrecognised legacy
status**, so excluding the status would silently drop unknown-status work out of
every queue. The precise test is the confirmation fact —
`TaskAssignment.confirmedAt`, or legacy's `confirmedBy` array — and statuses from
`in_progress` onward imply acceptance already happened (legacy's `confirmed` maps
to `in_progress`).

Both queue builders now supply it: `#activeQueueOf` and the list read.

### Three predicates, three questions — do not collapse them

| Predicate | Question | Requires |
|---|---|---|
| `isActiveInQueue` | live rather than closed? | a live status |
| `isActivePriorityTask` | on somebody's plate? | + a settled budget |
| `isActiveWorkload` | holds a priority SLOT? | + accepted by that person |

I briefly made `isActivePriorityTask` require acceptance too and then reverted it:
it is used by `TasksArea` and `EmployeeProfile` to count a team's open work, and
work assigned-but-unaccepted **is** still work heading somebody's way. A roster
that hid it would show a person as free the day before eight tasks land.

---

## 14.3 · `normalizePriorities(employeeId)` — the repair

On both repositories, through the one function. **Idempotent**: a healthy queue is
zero writes and `changed: 0`, because `normalizePriorityQueue` returns only the
tasks that actually disagree and the sort is total. That is what makes it safe to
call after any priority write rather than churning the queue each time.

Inactive tasks are never renumbered — a completed task keeps the rank it finished
with, because it is a record rendered as "was P3", and pulling it into the
renumbering would rewrite history to make room for live work.

The legacy write uses **dot notation** on `assigneePriorities.{id}`. Writing the
map whole erases every other assignee's rank — the document shape IS the contract,
because priority has no REST route.

### ⚠ A queue longer than ten cannot be fully stored

`assignPriorityRanks` is unbounded — twelve active tasks get P1..P12, and clamping
would put two at 10. But the **stored** rank is legacy's 1–10 field and the old app
reads it, so `normalizePriorities` clamps the write and positions past ten
duplicate at the tail.

Invisible to the queue owner, who sees the derived position. Visible only to
somebody reading another person's stored ranks. Fixing it properly needs a field
the old app does not share — so it is recorded rather than papered over.

---

## 14.4 · Files changed

| File | Change |
|---|---|
| `lib/rules/tasks/priorityQueue.ts` | **New. The queue authority.** |
| `lib/rules/tasks/activeQueue.ts` | `activeQueuePositions` delegates; the three predicates documented apart; `queueRankFor` and `nextActiveRank` route through `isActiveWorkload` |
| `lib/repositories/legacy/index.ts` | `normalizePriorities`; `accepted` supplied by both queue builders |
| `lib/repositories/mock/index.ts` | same normaliser, so the invariant is testable without Firestore |
| `lib/repositories/types.ts` | `normalizePriorities` declared |

---

## 14.5 · Tests

**1882 passing.** `queueIntegrity.test.ts` — written to fail first — covers the
exclusion list status by status, the 8-task continuity case, idempotence, the
>10 derivation, and that both repositories go through the one function.

Two of my own mistakes, both caught:

1. **A comment tripped a source assertion for the third time.** The tie-break test
   banned the token `index`, and `assignPriorityRanks`'s doc comment says it
   "numbers by index". The test now strips comments, as the `code()` convention
   does. Worth adopting everywhere.
2. `require` in an ESM test file.

---

## 14.6 · Not verified

**Nothing seen in a browser.** In order:

1. **A user with a known-bad queue.** Call `normalizePriorities` and confirm
   `changed > 0`, then again and confirm `changed === 0`.
2. **An unaccepted task.** It should now hold no slot — the accepted work below it
   moves up. Check the assignment card still shows a sensible figure (it falls
   back to the stored rank).
3. **A manager reading a report's list** before and after a normalise — the
   duplicates should disappear.

### Still open

- **Nothing calls `normalizePriorities` automatically.** It is deliberate: a write
  during a read is racy, and the repair should be a decision. Wiring it into
  `changePriority`/`reorderPriorities` (which already write 1..N) or exposing it in
  the admin console is the obvious next step, and needs an owner call on which.
- **The >10 stored limit** in §14.3.

---

# Session 8 — 2026-07-30 · normalisation on every write

Verify at handoff: **tsc clean · lint clean · 1896 tests, 0 failed · `next build`
exit 0 · check-secrets clean.**

§14 made the queue correct on READ and left the wiring open. This closes it.

---

## 15.0 · The priority queue lifecycle, end to end

| Event | Stored rank | Queue membership | Normalised by |
|---|---|---|---|
| Task created / assigned | engine writes `open count + 1` | **not yet** — unaccepted | `#write` funnel |
| Assignee accepts (`confirmTask`) | unchanged | **enters** the queue | `#write` funnel |
| Work starts / submits / is reviewed | unchanged | stays | `#write` funnel |
| Budget agreed | unchanged | **enters** (was unsettled) | `#write` funnel |
| Priority changed | rewritten 1..N | unchanged | `changePriority` — both branches |
| Queue dragged | rewritten 1..N | unchanged | `reorderPriorities` |
| Completed / cancelled | **frozen** — the record | **leaves**; the rest shift up | `#write` funnel |
| Reassigned | new holder gets an entry | leaves one queue, enters another | `#write` + `priorHolders` |

---

## 15.1 · The funnel is the coverage

**`#write` is the single funnel for the task lifecycle — 22 call sites** —
covering acceptance, start, submission, review, deadline and budget decisions,
creation and subtask creation. Normalisation is hooked THERE:

```
engine write → #readTaskView → #normalizeAfterWrite → notifyRepositoryChanged
```

A normalise bolted onto each of 22 methods is 22 chances to forget, and the
forgotten one is where duplicates come back. Two tests pin the funnel: one that it
is called with the read-back view, one that at least twenty call sites exist so
the funnel really is the coverage.

**After the read-back, never before, never during a read.** A test walks
`listTasks`, `#readTaskView`, `#activeQueueOf` and `getTask` and asserts none of
them normalises — the `render → write → normalise` race the brief rules out.

**The two direct-Firestore paths bypass `#write` and are wired individually:**
`changePriority` (both branches — the reorder one and the single-rank one) and
`reorderPriorities`. Both look redundant and are not: a caller's order may omit an
active task, and `#clampRank` caps at ten, so a long queue writes duplicate tens
that a re-read then resolves.

### The one thing a caller must supply

`#write` takes `priorHolders`. After a reassignment the read-back names the NEW
holders and the person who lost the work is gone from the document — but their
queue still has a gap. That cannot be derived after the fact, so it is a typed
parameter. `#normalizeAfterWrite` unions it with the current holders and
normalises each queue independently, because a rank is per person.

### A failed renumber does not fail the mutation

The caller's change has landed. Reporting it as failed would send them to do it
again, and `normalizePriorities` is idempotent so the next mutation closes the gap.
Logged for a developer, swallowed for the caller — a test bans `return { ok: false }`
from that helper.

---

## 15.2 · The guarantees, stated exactly

**Always, after any mutation:** no duplicate ranks, no gaps, only active tasks
ranked, inactive tasks untouched.

**Idempotent.** `normalizePriorityQueue` returns only the tasks that actually
disagree, so a healthy queue costs two reads and no write. Load-bearing now that
it runs after every mutation — a sort that was not total would renumber
differently each call and write every time, turning a repair into churn. Tested to
three iterations to catch a two-cycle.

### Concurrency — what is guaranteed and what is not

A client-side Firestore transaction **cannot run a query**, only
`tx.get(docRef)`, so a queue read with `where(...)` cannot be read and written
atomically. What makes the race safe is the shape of the calculation rather than a
lock: `calculatePriorityOrder` is a **total sort over stored fields**, so two
concurrent normalisations of the same data converge on the same answer.

> **The invariant survives any interleaving. The ORDERING is last-writer-wins.**

A normalise computed one write behind persists the slightly older order, and the
next mutation's normalise corrects it. It can never produce a duplicate or a gap.
Closing the ordering window properly needs a per-person document to hold the
queue — which the old app does not share.

---

## 15.3 · `normalizePrioritiesAllUsers()` — admin/debug, no UI

One scan of `cowork_tasks`, grouped by holder via `holdersOf` (so somebody behind
a cross-department gate is repaired too — exactly the person whose queue nobody
has been looking at), each person normalised independently.

- **`system_admin` only**, through `maySettings`.
- Reports `{ scanned, users, changed, perUser }` — per user, so a repair is
  auditable rather than a bare count.
- **One batch per person**: Firestore caps a batch at 500 writes, and a partial
  commit that renumbered half a queue is worse than not running.
- One person's failure does not abandon the rest.
- **Completed history is never touched** — only `queue.changes` is written, and
  that contains active tasks only.

---

## 15.4 · Files changed

| File | Change |
|---|---|
| `lib/repositories/legacy/index.ts` | `#normalizeAfterWrite` hooked into `#write`; `priorHolders` parameter; `changePriority` and `reorderPriorities` wired; `normalizePrioritiesAllUsers`; the concurrency reasoning recorded at the write |
| `lib/repositories/mock/index.ts` | `#renumber` funnel wired into cancel, confirm, complete, `changePriority`, `reorderPriorities`; `normalizePrioritiesAllUsers` |
| `lib/repositories/types.ts` | `normalizePrioritiesAllUsers` declared |

No rule module changed — `priorityQueue.ts` was already the authority.

---

## 15.5 · Tests

**1896 passing.** `queueMutation.test.ts` is the nine required scenarios plus the
funnel guards. The behavioural half drives `normalizePriorityQueue` (the function
both repositories call); the wiring half is asserted on source, because "every
mutation path calls it" is a claim about the code rather than about one calculation.

**The comment-anchor mistake, for the fourth time.** Two slices were bounded by
`"\n  /** One task, read back"` — a comment, which `code()` strips, so the slice
ran to end of file and picked up an unrelated `return { ok: false }`. Anchors must
be **code constructs**, never comments. That is now four sessions running; it is
the single most repeated error in this codebase's tests.

---

## 15.6 · Not verified, and the known cost

**Nothing seen in a browser.** In order:

1. **Change a priority** and confirm the queue is renumbered — then again, and
   confirm no write happens the second time.
2. **Complete a P2** and confirm P3 becomes P2 with no write to the completed task.
3. **`normalizePrioritiesAllUsers()` from a console** as the CEO. Check
   `perUser` names the people repaired, and that a second run reports `changed: 0`.

### ⚠ The cost, named rather than hidden

`normalizePriorities` runs **two Firestore queries per affected holder, on every
lifecycle mutation.** For a user with fifty tasks that is a hundred document reads
per mutation, and a reassignment doubles it.

The obvious optimisation is already available and not taken: `#write` →
`#readTaskView` → `#activeQueueOf` **already fetches the subject's whole queue**,
so the candidates could be reused instead of re-queried. Doing it needs
`#activeQueueOf` to return its entries as well as the order, which is a small
change I did not make blind — it touches the read path every screen depends on,
and I would rather it be done with a profiler than on inference.

### Still open

- **The >10 stored-rank limit** from §14.3, unchanged.
- **`cancelTask` is not implemented on legacy** (`NotConnectedError`), so
  cancellation is not a live write path there. The mock's is wired.

---

# Session 9 — 2026-07-30 · low-end device mode

Verify at handoff: **tsc clean · lint clean · 1954 tests, 0 failed · `next build`
exit 0 · check-secrets clean.**

---

## 16.0 · The real cost was not the one being looked for

The question was whether the frosted surfaces would break integrated graphics.
The audit found something larger.

**`IridescentField` renders ten permanently-composited layers behind every
page** — six blobs at `46vw` with `filter: blur(46px)`, plus four specular bands
at `blur(14px)` — every one carrying `will-change: transform` and
`animation: … infinite alternate`. Its own comment says it: *"the only thing in
Cowork that moves at rest."*

It never stops. It costs whether or not anybody is interacting, and on
shared-memory graphics the ten pinned layers are VRAM as well as fill rate. It
outweighs every `backdrop-filter` in the app combined.

**Second: `.frost-bar` is `backdrop-filter: blur(28px) saturate(1.6)` on the top
bar — always visible — over `rgba(248,248,250,0.94)`.** The full cost of a wide
blur to reveal **6%** of what is behind it.

**Third, and biggest of all, and not CSS:** going Online requires sharing your
**entire screen**, continuously, all day. That is capture plus encode, and on a
weak machine it dwarfs everything above. **No mode turns it off**, because
presence depends on it — but the monitor says so, since somebody debugging a
slow laptop needs to weigh it first.

---

## 16.1 · Three modes, and the line they do not cross

`lib/rules/performance/deviceMode.ts`. `high` / `balanced` / `low`, in
**Settings → Performance**, stored per DEVICE in `localStorage`.

> Per device, not per account: one person uses a fast desktop and a slow laptop,
> and putting it on their record would carry the laptop's compromise to the
> desktop — and let an administrator set it for somebody else.

**A mode may change how much work the browser does to draw a thing. It may not
change what is true.** Three guards, each with a test:

| Guard | Why |
|---|---|
| `heartbeatIntervalMs` returns the constant for every mode | "Reduce polling" is the obvious saving and it is a **trap**: `readDutyMode` treats a beat older than `STALE_AFTER_MS` as offline, so slowing it marks working people away — and the offline gate then refuses to start their timer |
| A test bans `heartbeat`/`stale`/`duty`/`presence` from `PerformanceProfile` | So a reviewer can satisfy themselves from the interface alone |
| `mayThrottle` clamps any correctness-critical interval below the window | Belt and braces, if such a field is ever added |

**The timer tick IS throttled — 1s to 2s — and that is safe for one specific
reason**: `elapsedSecs` derives the figure from `startedAt` and the wall clock on
every tick, so a slower interval shows a coarser number and never a wrong one. A
test bans accumulator-style `setSecs(s => s + 1)`, which would make throttling
start losing seconds.

---

## 16.2 · The saving is in CSS, so nothing has to remember

`<html data-perf="low">` is set by an **inline script before first paint** —
otherwise a weak machine paints one frosted, animated frame and drops it, which
is the most expensive frame in the session.

`globals.css` then keys off it: `backdrop-filter: none` everywhere (including
every Tailwind `backdrop-blur-*` utility, by clearing the filter variable),
transitions to `0.01ms`, decorative shadows off, and the field `display: none`.

**A component that never asks the context still gets the saving.** The React
profile handles only what CSS cannot express: whether to MOUNT a chart, how often
to redraw a timer, how many rows to render.

`IridescentField` additionally **returns null** rather than only being hidden —
`will-change: transform` asks the compositor for a layer whether or not the
element paints, and the layers are the cost.

**Low mode is coherent rather than merely cheaper.** The field exists so the
frosted surfaces have something to look through — *"glass over a flat backdrop is
not glass, it is grey."* With the blur gone there is nothing for it to be behind,
so both go together and the result is a deliberate flat interface rather than a
broken effect.

---

## 16.3 · Detection suggests; it never imposes

`readDeviceSignals()` reads `hardwareConcurrency`, `deviceMemory`,
`prefers-reduced-motion` and `saveData`. **A missing signal is unknown, never a
slow machine** — Safari reports no `deviceMemory`, and reading absent as zero
would put half of Safari into low mode on no evidence.

Low mode is **offered** where cores ≤ 2, memory ≤ 4GB, reduced-motion, or
save-data — with a sentence saying which. Never applied: the signals say nothing
about the GPU, which is what actually struggles. A test asserts `setMode("low")`
appears nowhere in the provider — only behind a button.

The settings screen states the limits plainly, because a reader comparing
`deviceMemory` to their spec sheet will otherwise think the product is wrong.

---

## 16.4 · The monitor is off by default

FPS from `requestAnimationFrame` deltas, sampled **once a second** (a counter
re-rendering React sixty times a second is the cost it measures), JS heap where
Chrome reports it, the live profile's expensive features, and the screen-share
note.

Off until asked, and stopped on close: an FPS counter left running on the machine
least able to afford it is the observer changing what it observes. Each figure
carries its caveat — heap excludes the GPU layers that a blur actually costs, and
FPS on an idle page is not a complaint.

---

## 16.5 · Files

| File | Change |
|---|---|
| `lib/rules/performance/deviceMode.ts` | **New.** Modes, profile, guards, detection |
| `app/globals.css` | `:root[data-perf="low"]` layer |
| `components/layout/shell/DeviceModeContext.tsx` | **New.** Provider + pre-paint boot script |
| `components/features/settings/DeviceModeSection.tsx` | **New.** The setting and the suggestion |
| `components/features/settings/PerformanceMonitor.tsx` | **New.** |
| `components/ui/IridescentField.tsx` | Returns null in low mode |
| `app/layout.tsx`, `AppShell.tsx`, `UserAreas.tsx` | Wiring |
| `TimerControl.tsx`, `PriorityAckGate.tsx` | Read the profile's intervals |

---

## 16.6 · Not verified — and this one matters more than usual

**No frame rate has been measured. Nothing was run in a browser.** Every claim
above is a static read of what the code asks the compositor to do. The reasoning
is sound and the costs are real, but **"this fixes your laptop" is not something
this session can assert.**

What would settle it: a Chrome performance trace on the target machine, on the
task list and task detail, in each mode, with and without an active screen share.
That last variable is the one I would look at first.

### Deliberately not done

- **Balanced is currently identical to high.** It exists as the named default and
  as the place to put a measured trim — putting a guess there would be inventing
  a threshold nobody has profiled.
- **`listChunkSize`, `richCharts`, `previewFps` are in the profile and not yet
  read by any component.** They are the obvious next wiring; I left them declared
  rather than threading them blind through chart and monitoring code I have not
  been able to watch render.
- **No `prefers-reduced-transparency` media query.** `prefers-reduced-motion`
  already suggests low mode, and the transparency query has thin support; worth
  adding when it lands more widely.
