# Permissions and Roles Spec — Cowork

**Date:** 2026-07-25
**Purpose:** Document legacy permissions exactly as enforced, then define the configurable role and hierarchy model that replaces them.

---

## 1. Legacy Roles

Exactly three, hard-coded as string literals throughout (`Middlewear/coworkAuth.js:78-80`):

```js
const verifyCeoToken    = (req,res,next) => req.coworkUser?.role === "ceo" ? next() : res.status(403)…
const verifyCeoOrTL     = (req,res,next) => ["ceo","tl"].includes(req.coworkUser?.role) ? next() : res.status(403)…
const verifyEmployeeToken = (req,res,next) => req.coworkUser ? next() : res.status(401)…
```

| Role | Meaning | Notes |
|---|---|---|
| `ceo` | Full administrator | Employee **`E000`** is a reserved magic ID |
| `tl` | Team Lead | Approval, review, deadline arbitration |
| `employee` | Individual contributor | Default |

`verifyEmployeeToken` means **"any authenticated user"** — its name implies a role check it does not perform. Several routes rely on it as if it were one.

Role is stored in **two** places — Firebase Auth custom claims and the Firestore `cowork_employees` doc — updated separately in `change-role` (`cowork.js:839, 842`). A partial failure desynchronises them permanently.

**No People Operations role, no skip-level concept, no system-administrator distinction.** The HR functions live in the separate ERP auth system with its own middleware (`AllEmployeeAppMiddleware`, `EmployeeAuthMiddlewear`, …).

---

## 2. Legacy Permission Matrix — As Actually Enforced

Derived from middleware on each reachable route plus in-handler checks. **Bold** entries mark defects, detailed in §3.

| Capability | employee | tl | ceo | Enforcement |
|---|:--:|:--:|:--:|---|
| **Tasks — read** |
| See own assigned tasks | ✅ | ✅ | ✅ | `listTasksWithHierarchy` |
| See tasks I created | ✅ | ✅ | ✅ | `taskForward.js:1330-1346` |
| See tasks where I'm approver / in `visibleTo` | ✅ | ✅ | ✅ | same |
| See *all* tasks | ❌ | ❌ | ❌ | CEO sees only own-created + assigned + approver |
| **Tasks — write** |
| Create task | ✅ | ✅ | ✅ | `taskForward.js:146` |
| Create parent task | ❌ | ✅ | ✅ | `:436` (backward-compat alias) |
| Create subtask | ✅ if parent assignee/creator | ✅ | ✅ | `:1210` |
| Forward task | ✅ if assignee/creator | ✅ | ✅ | `service:528` |
| **Change priority** | **✅ anyone** | **✅** | **✅** | **none — client-side Firestore write** |
| Propose deadline | ✅ if assignee | ✅ | ✅ | `service:1531` |
| Approve/reject a deadline proposal | creator only | creator only | creator only | `service:1717` |
| Counter-propose a deadline | ✅ any authenticated | ✅ | ✅ | **no role check** |
| Request extension | ✅ if assignee | ✅ | ✅ | `:1901` |
| Review extension | ❌ | ✅ | ✅ | `:1989` |
| Set extension deduction / waive | ❌ | ✅ | ✅ | `:1525` |
| Confirm receipt | ✅ if assignee | ✅ | ✅ | `service:431` |
| Start task | ✅ if assignee + confirmed | ✅ | ✅ | `service:470-471` |
| Submit completion | ✅ if assignee | ✅ | ✅ | `service:1195` |
| **Approve / reject completion** | **✅ anyone** | **✅** | **✅** | **`review-completion` has NO check** |
| Request rework | ❌ | ✅ | ✅ | `:1503` |
| CEO final review | ❌ | ❌ | ✅ | `verifyCeoToken` |
| Edit task details (pre-draft) | ❌ | ✅ | ✅ | `:1434` |
| Edit task details (post-draft) | sender only | sender only | sender only | `:1435` |
| Edit deadline directly | ❌ | ❌ | ✅ | `verifyCeoToken` |
| Move to folder | ❌ | ✅ | ✅ | `:1385` |
| Reset to draft | sender only | sender only | sender only | `:1465` |
| Delete task (recursive, hard) | ❌ | **✅** | ✅ | `:1373` |
| Approve TL-assigned task | ❌ | ✅ (assignee) | ❌ | `:980` |
| Department approval | named approver only | named approver only | named approver only | `:1026` |
| Set department hours | ❌ | ✅ own dept only | ❌ | `:1133` |
| Third-party complete / payment action | ❌ | ✅ | ✅ | `:823`, `:872` |
| Goal component: request report | ❌ | ✅ | ✅ | `:2181` |
| Goal component: submit report | ✅ if assignee | ✅ | ✅ | `:2296` |
| **Scores** |
| View own C1/C2 | ✅ | ✅ | ✅ | `c1Routes.js:37` |
| View another's C1/C2 | ❌ | **✅ anyone's** | **✅ anyone's** | `verifyCeoOrTL` |
| View all scores | ❌ | **✅** | ✅ | `verifyCeoOrTL` |
| View PMP dashboard | own | any | any | `pmpRoutes.js` |
| Gold-task list / weightage validation | ❌ | ✅ | ✅ | `c2Band.routes.js` |
| Read/write band config | ❌ | ✅ | ✅ | `bandConfig.routes.js` |
| Change score configuration (`cowork_sop_settings`) | ❌ | ❌ | ✅ | `/coworking/task-settings` gated on `isCEO` |
| **SOP / conduct** |
| Read SOP catalogue | ✅ | ✅ | ✅ | |
| Create / approve / reject SOP | ❌ | ✅ | ✅ | `soproute.js` |
| Apply a bleach (deduction) | ❌ | ✅ | ✅ | `POST /sop/bleach` |
| Request recheck | ✅ own | ✅ | ✅ | |
| Review recheck | ❌ | ✅ | ✅ | |
| **People** |
| Create employee | ❌ | **✅** | ✅ | `verifyCeoOrTL` |
| Delete employee | ❌ | **✅** | ✅ | `verifyCeoOrTL` |
| **Reset another's password** | ❌ | **✅ — including the CEO's** | ✅ | `verifyCeoOrTL`, `cowork.js:379` |
| Change employee ID | ❌ | **✅** | ✅ | `verifyCeoOrTL`, blocks only `E000` |
| Change role | ❌ | ❌ | ✅ | in-handler check, `cowork.js:830` |
| Change department | ❌ | ❌ | ✅ | in-handler check, `:892` |
| Change own password | ✅ | ✅ | ✅ | |
| Change own email | ❌ | ❌ | ✅ | `verifyCeoToken` |
| List employees (full) | ❌ | ✅ | ✅ | `/employee/list` |
| List members (safe subset) | ✅ | ✅ | ✅ | `/employee/list-members` |
| Biometric ID picker | ❌ | ✅ | ✅ | |
| **Groups** |
| Create group | ❌ | ✅ | ✅ | `cowork.js:341` |
| Update / delete group | ❌ | ❌ | ✅ | `verifyCeoToken` |
| Add / remove members | ❌ | ❌ | ✅ | `verifyCeoToken` |
| Send group message | ✅ if member | ✅ | ✅ | |
| **Meetings** |
| Schedule / edit / cancel | ❌ | ✅ | ✅ | `verifyCeoOrTL` |
| Join | ✅ if participant | ✅ | ✅ | |
| Guest join by token | **public** | — | — | no auth by design |
| Recording control | ✅ any participant | ✅ | ✅ | socket, unauthenticated payload |
| **Other** |
| Workload / status tracking | ❌ | ✅ | ✅ | FE nav gate only |
| Office Monitor | ❌ | ❌ | ✅ | FE nav gate only |
| Test email | ❌ | ❌ | ✅ | `verifyCeoToken` |
| **`force-repair-self-assign`** | **public** | **public** | **public** | **no middleware at all** |
| **`self-assign-debug/:employeeId`** | **public** | **public** | **public** | **no middleware at all** |
| **`setup/seed-ceo`** | **public** | **public** | **public** | **no middleware at all** |

---

## 3. Legacy Permission Defects

| # | Defect | Location | Severity |
|---|---|---|---|
| P1 | **`POST /task/:id/review-completion` has no authorisation check.** Any authenticated employee can approve or reject any task's completion — including their own — and that fires the C1 score | `taskForward.js:1576`; `service:1245` has no role/creator/assignee check | **Critical** |
| P2 | **`GET /task/force-repair-self-assign` has no auth middleware** and performs a full-collection scan-and-write over `cowork_tasks` | `taskForward.js:464` | **Critical** |
| P3 | **`GET /task/self-assign-debug/:employeeId` has no auth middleware** and dumps task data | `taskForward.js:507` | **Critical** |
| P4 | **`POST /setup/seed-ceo` is unauthenticated** and creates a `role: "ceo"` account | `cowork.js:17` | **Critical** |
| P5 | **A TL can reset the CEO's password** — `verifyCeoOrTL` on `/employee/:id/reset-password`, which also revokes the target's sessions | `cowork.js:379` | **Critical** |
| P6 | **Priority changes bypass the backend entirely** — client writes Firestore directly; no role check, no audit | `page.js:1810`, `:1761` | **High** |
| P7 | **Timers and work commits bypass the backend** — client writes `cowork_task_timers` and `cowork_work_commits` directly, and these feed the timer-SOP scoring engine | `page.js:1889`, `hooks/useTaskTimer.js` | **High** |
| P8 | **A TL can delete any task recursively and permanently**, despite the code comment saying CEO-only | `taskForward.js:1373` | **High** |
| P9 | **A TL can delete employees and change employee IDs** | `cowork.js:716`, `:765` | **High** |
| P10 | **Any TL can see every employee's scores**, contradicting `PRODUCT.md:67` | `c1Routes.js:64`, `c2Band.routes.js:165` | **High** |
| P11 | **`tl-counter-deadline` has no role check** — any authenticated user can counter-propose | `taskForward.js:1848` | Medium |
| P12 | **5-minute in-memory role cache** delays privilege revocation | `coworkAuth.js:6-18` | Medium |
| P13 | **Auto-provision of `E000` as CEO** when a Firebase claim says `ceo` but no Firestore doc exists | `coworkAuth.js:49-62` | Medium |
| P14 | **Email-fallback identity lookup** on both client and server | `coworkAuth.js:42`, `lib/coworkAuth.js:23` | Medium |
| P15 | **Role stored in two places**, updated non-atomically | `cowork.js:839, 842` | Medium |
| P16 | **No client route guard** — `if (!user) return children;` | `app/coworking/layout.js:36` | Medium |
| P17 | **Role checks placed inconsistently** — `change-role`/`change-department` check inside the handler instead of using `verifyCeoToken` | `cowork.js:830`, `:892` | Low |
| P18 | **Firestore security rules absent from the repository** — the entire client-write surface (priority, timers, commits, acknowledgements, messages) is governed by rules that could not be audited | — | **Unknown, potentially critical** |
| P19 | **The reporting hierarchy exists but is never used for authorisation.** `Employee.primaryManager`/`secondaryManager` is read only to *display* managers and to resolve approval-gate approvers | `cowork.js:207`, `taskForward.js:67` | **High** |

---

## 4. The New Model — Configurable Roles and Hierarchy

Per `PRODUCT.md:115` ("Don't hard-code today's company") and `:72` (the *shape* is durable; "manager", "skip-level", "HR" are this organisation's titles), roles are **data**, not string literals in code.

### 4.1 Role archetypes

Five archetypes, each a configurable role record rather than a hard-coded constant:

| Archetype | Purpose | Scope |
|---|---|---|
| **employee** | Individual contributor | Self |
| **manager** | Direct people-manager | Own direct reports (configurable depth = 1) |
| **skip-level manager** | Manager of managers | Transitive reports beneath them |
| **People Operations** | Designated people function | Organisation-wide read of people and scores; conduct and attendance administration |
| **system administrator** | Platform owner | Configuration, integrations, role assignment |

These are **seed data**, not enum members. An organisation renames them freely; the permission set is what is durable.

### 4.2 Scope model — this is the core change

Permission = **capability × scope**. Legacy has capabilities only.

| Scope | Resolves to |
|---|---|
| `self` | The acting user |
| `direct_reports` | Users whose `managerId` is the actor |
| `hierarchy` | Transitive closure beneath the actor |
| `organisation` | Everyone |

**Binding rules:**

1. **A manager sees only their reporting hierarchy.** The legacy behaviour — any TL sees everyone — does not carry forward. Every people-scoped and score-scoped query is filtered by the reporting closure.
2. **A manager must never be able to take over the highest administrator account.** No capability granted to any non-administrator archetype may target a user with an equal-or-higher administrative level. Concretely: password reset, role change, employee-ID change, session revocation and deletion are all barred against the system administrator and against one's own manager chain.
3. **Comparison flows one way.** Comparative views exist only looking *down* the chain (`PRODUCT.md:69`).
4. **People Operations is read-broad, write-narrow** — organisation-wide visibility of people and scores; conduct and attendance administration; but not task administration and not role assignment.

### 4.3 Proposed capability matrix

Scope notation: `self` · `reports` (direct) · `hier` (transitive) · `org` · `—` (denied).

| Capability | employee | manager | skip-level | People Ops | sys admin |
|---|---|---|---|---|---|
| **Tasks** |
| View task | self + participating | hier | hier | — | org |
| Create / assign task | self | hier | hier | — | org |
| Change priority | self *(own tasks, audited)* | hier | hier | — | org |
| Propose deadline | self | self | self | — | — |
| Approve/reject/counter deadline | — | reports | hier | — | — |
| Request extension | self | self | self | — | — |
| Review extension | — | reports | hier | — | — |
| Submit completion | self | self | self | — | — |
| **Approve / reject completion** | **—** | reports | hier | — | — |
| Request rework | — | reports | hier | — | — |
| Second-stage review | — | — | hier | — | — |
| Forward task | self *(own tasks)* | hier | hier | — | org |
| Edit task | creator | hier | hier | — | org |
| Cancel task | — | hier | hier | — | org |
| Delete (soft) task | — | — | hier | — | org |
| **Scores** |
| View own score | ✅ | ✅ | ✅ | ✅ | ✅ |
| View others' scores | **—** | reports | hier | org | org |
| Comparative view across reports | — | reports | hier | org | org |
| Change score configuration | — | — | — | **proposal only** | ✅ |
| Apply conduct event | — | reports *(if delegated)* | hier | org | org |
| Review conduct dispute | — | — | hier | org | org |
| **People** |
| View directory | org *(safe subset)* | org | org | org | org |
| Create employee | — | — | — | org | org |
| Deactivate employee | — | — | — | org | org |
| **Delete employee** | — | — | — | — | org |
| **Reset password** | self | **—** | **—** | org *(never sys admin)* | org |
| Change role | — | — | — | proposal only | org |
| Change reporting line | — | — | — | org | org |
| Change department | — | — | — | org | org |
| **Integrations** |
| Connect own Google account | ✅ | ✅ | ✅ | ✅ | ✅ |
| Configure org integrations | — | — | — | — | ✅ |
| **Meetings** |
| Schedule meeting | ✅ | ✅ | ✅ | ✅ | ✅ |
| Edit / cancel any meeting | organiser | organiser + reports | hier | — | org |
| Control recording | organiser | organiser | organiser | — | org |
| **Groups** |
| Create group | ✅ | ✅ | ✅ | ✅ | ✅ |
| Manage members | owner | owner | owner | — | org |
| **Notifications** |
| Read own | ✅ | ✅ | ✅ | ✅ | ✅ |
| Send system announcement | — | — | — | org | org |

### 4.4 Changes from legacy, explicitly

| Legacy | New | Reason |
|---|---|---|
| Any TL sees everyone's scores | Manager sees reports only | `PRODUCT.md:67`; owner-confirmed |
| TL can reset the CEO's password | No manager can reset any password; People Ops can, never against sys admin | Owner-confirmed |
| TL can delete employees | People Ops deactivates; only sys admin deletes | Least privilege |
| TL can hard-delete tasks recursively | Soft-delete, skip-level and above | Recoverability |
| Anyone can approve completion | Manager of the assignee, up the chain | Fixes P1 |
| Priority written client-side, unaudited | Server-mediated, permission-checked, audited | Fixes P6 |
| Timers/commits written client-side | Server-mediated, since they feed scoring | Fixes P7 |
| `ceo` / `tl` string literals | Configurable role records | `PRODUCT.md:115` |
| `E000` magic ID | No magic IDs | `PRODUCT.md:115` |
| No People Operations role | First-class | `PRODUCT.md:70` |
| Role in claims **and** Firestore | Single authoritative store, claims derived | Fixes P15 |
| 5-minute role cache | Short TTL with explicit invalidation, or no cache | Fixes P12 |
| Unauthenticated bootstrap | Provisioned out-of-band | Fixes P4 |
| Unauthenticated repair/debug endpoints | Do not exist in production | Fixes P2, P3 |

---

## 5. Reporting Hierarchy

### 5.1 Legacy

`Employee.primaryManager{managerId, managerName}` and `secondaryManager{…}` in MongoDB, referencing another `Employee`. Used in exactly three places, **none of which is authorisation**:

1. `GET /cowork/employee/my-managers/:employeeId` — display only (`cowork.js:207`)
2. `_getPrimaryManagerApprover` — resolving a cross-department approval gate (`taskForward.js:67`)
3. Skip conditions in the gates — "the assigner already *is* the target's manager" (`taskForward.js:185`, `:237`)

### 5.2 New

A `ReportingRelationship` becomes a first-class, time-bounded record:

```
{ id, employeeId, managerId, type: "primary" | "secondary" | "dotted",
  effectiveFrom, effectiveTo | null, createdBy, createdAt }
```

**Why time-bounded:** a score computed for 2026-Q2 must be visible to whoever managed that person *in Q2*, not whoever manages them today. Legacy cannot express this, which is a real problem for any retrospective review.

Requirements:
- Transitive closure resolved server-side, cached, invalidated on change
- **Cycle detection on write** — legacy has none
- Orphan handling: an employee with no manager is visible to People Operations and system administrators only
- Secondary/dotted lines grant task-scope visibility but **not** score visibility unless explicitly configured — score visibility follows the primary line
- The gate-approver resolution in `taskForward.js:86` becomes a query against this model rather than a department-string match

---

## 6. Authentication Requirements

| Requirement | Rationale |
|---|---|
| Server-side session/token verification on **every** state-changing request | Legacy has client-only writes for priority, timers, commits, acknowledgements |
| **No unauthenticated bootstrap.** First administrator provisioned out-of-band | Fixes P4 |
| **No plaintext passwords** anywhere, including temporary ones | Legacy stores `tempPassword` in Firestore (`cowork.js:399`) |
| Password reset issues a **single-use, expiring token**, never a stored password | |
| Role resolved from **one** authoritative store | Fixes P15 |
| Session revocation on role change, deactivation and password reset | Legacy already does this — preserve |
| Route guards **server-side**, not only in a client layout | Fixes P16 |
| Identity lookup by **stable ID only** — never email fallback | Fixes P14 |
| Datastore access rules committed to the repository and reviewable | Fixes P18 |
| Every permission decision derived from `(capability, scope, actor, target)` — no ad-hoc in-handler role strings | Fixes P17 |
| **No secrets in the frontend bundle or repository** | Legacy has `FIREBASE_PRIVATE_KEY`, `GOOGLE_SERVICE_ACCOUNT`, `CLOUDINARY_API_SECRET` in the frontend |

---

## 7. Owner Decisions Required

| # | Decision |
|---|---|
| R1 | Are the five archetypes right, and what are this organisation's names for them? |
| R2 | Does a manager's score visibility follow only the primary reporting line, or also secondary/dotted? |
| R3 | How many levels does "skip-level" span — one, or the full transitive closure? |
| R4 | Can People Operations *apply* conduct deductions, or only administer the catalogue? |
| R5 | May a manager change priority on a report's task, or only request it? |
| R6 | Who may cancel a task, and may an employee cancel their own? |
| R7 | May managers delegate approval while on leave? Legacy has no delegation concept |
| R8 | Should secondary managers approve deadlines, or only view? |
| R9 | Should score-configuration changes require two-person approval, given they rewrite everyone's history? |
| R10 | Retention: how long are ledger and task history kept, and who may export them? |
