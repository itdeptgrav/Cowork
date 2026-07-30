# Current Gap Analysis

Legacy capability against the current Cowork implementation, feature by feature.

## Where the new project actually stands

| Measure | Value |
|---|---|
| Repository interface methods | **187** |
| Repository implementations | **1** — `MockRepository` (228 KB, client-side, localStorage) |
| Real server routes | **19** (`app/api/*`) — auth, mail/Gmail, LiveKit, meetings, music, help |
| Server-side persistence | **1 file** — `.data/identity.json` |
| Pages | 58 |
| Domain modules | 17 |
| Tests | 475 passing |

### The one sentence that frames everything below

**187 repository methods are backed by browser localStorage; 19 routes are
backed by a server; one JSON file is the only thing that survives a different
browser.**

The new project has a *better* architecture than legacy — repository boundary,
pure domain rules, capability-based permissions, organisation scoping, audit
trails. What it does not have is a **backend**. Legacy, for all its faults, has
1454 endpoints and two real databases.

This is the inverse of the usual migration risk. The danger is not that the new
code is unprincipled — it is that the principles are enforced in a place an
attacker controls. `#deny()` runs 30 times in the mock repository, client-side.

### The seam this creates today

Two stores — server-side identity (shared) and client-side workspace (per
browser). It already explains four reported bugs: monitoring gaps, employee
visibility gaps, undeliverable internal mail across browsers, and data that
"disappears" on another machine. **Phase 2 closes it; nothing else will.**

## Classification

`implemented` · `partial` · `mock only` · `missing` · `redesign` · `obsolete`

### Tasks — the strongest area

| Feature | Legacy | New | Status |
|---|---|---|---|
| Task CRUD, assign, accept/reject | `taskForward.js` | full domain + UI | **mock only** |
| Single-assignee rule | absent | `lib/rules/tasks/assignment.ts` | **implemented** (better) |
| `self_assigned` = creator | absent | enforced in domain | **implemented** (better) |
| Recurring = multi-assignee | absent | `MULTI_ASSIGNEE_TYPES` | **implemented** |
| Priority rank per queue | client-side, no auth, no audit | domain + acknowledgement | **mock only** (much better) |
| Priority cascade | `checkAndExtendForP1` | `priorityCascade.ts`, relative shift | **implemented** |
| Timer / play-pause | Firestore | `timer.ts` | **mock only** |
| Work commits | `cowork_work_commits` | partial | **partial** |
| Deadline negotiation | two mechanisms | one, `deadlines.ts` | **mock only** (better) |
| Office-hours deadlines | scattered, IST hard-coded ×4 | `officeCalendar.ts`, 35 tests | **partial** — built, not wired |
| After-duty consumes budget | opposite (rewards it) | designed | **missing** — and **conflicts with legacy** |
| Deadline-or-budget termination | absent | designed | **missing** |
| Availability ledger | watermarks in `timerSop` | `ledger.ts`, 31 tests | **partial** — built, not wired |
| Two state axes | `status` + `completionStatus` | one `status` | **redesign** — migration transform needed |
| Subtask tree | `taskTree.routes.js` | projects + subtasks | **obsolete** (dead in legacy too) |
| Forwarding, folders | present | removed (D33) | **obsolete** — deliberate |

### Scoring

| Feature | Legacy | New | Status |
|---|---|---|---|
| C1–C4 model | `pmpService`, `c1Service` | `lib/domain/scoring.ts` | **partial** |
| Deduction constants (0.2/0.1/0.2/0.3) | `BandConfig.globalSettings` | provisional rules | **partial** |
| **Role bands → per-designation maxima** | `BandConfig`, `getBandMaxForEmployee` | — | **missing** |
| Points-over-points aggregate | confirmed | implemented | **implemented** |
| Score history / ledger | partial | append-only ledger | **implemented** (better) |
| `CW-DEV-PMP-01 v1.0` spec | cited, absent | — | **blocking unknown** |

### SOP Points — see [SOP_POINTS_AUDIT.md](SOP_POINTS_AUDIT.md)

| Feature | Legacy | New | Status |
|---|---|---|---|
| Policy rule + severity enum | `Sop` | `ConductPolicy` — enum **identical** | **implemented** |
| Points on a policy | `Sop.points` | — | **missing** |
| Approval gate (CEO only) | ✓ | — | **missing** |
| Folders | `SopFolder` | — | **missing** |
| Per-year ledger | `Employee.sopPoints[]` | — | **missing** |
| Component tag C1–C4 | `type` | — | **missing** |
| Credit/debit sign | inverted vocabulary | — | **redesign** — one signed value |
| Dispute | mutates `recheck` | reversal, never mutation | **implemented** (better) |
| Timer idle-pool / overtime | `timerSop.service.js` | — | **missing** |
| Manual arbitrary deduction | ✓ | — | **missing** — owner decision |

### HR — the largest gap

| Feature | Legacy eps | New | Status |
|---|---:|---|---|
| Employee CRUD / search | 11 | admin/people UI | **mock only** |
| Bulk import/export (XLSX) | 4 | — | **missing** |
| Departments | 8 | referenced, no entity | **missing** |
| Designations | field | — | **missing** |
| Hierarchy | `primary`/`secondary` manager | `closureOf()` | **implemented** (better) — but client-side |
| No cycles / no self-report | **absent in legacy** | domain-level | **partial** — needs server enforcement |
| Attendance | 28+3 | pages exist | **mock only** |
| Biometric sync | service | — | **missing** — owner decision |
| Leave + holidays | 33 | — | **missing** |
| **Leave → deadline bridge** | 1 | half (org holidays only) | **partial** — real correctness gap |
| Policies | 14 | `ConductPolicy` | **partial** |
| Payroll / payslips | 17 | — | **missing** — owner decision |
| Recruitment | 9 | — | **missing** — owner decision |
| Overtime | 3 | — | **missing** |
| Employment-change history | **absent in legacy** | — | **missing** (new requirement) |
| Qualifications / skills / documents | **absent in legacy** | — | **missing** (new scope) |
| HR reports | 11 | — | **missing** |

### Identity, auth, tenancy

| Feature | Legacy | New | Status |
|---|---|---|---|
| Authentication | two systems (Firebase + JWT) | one, scrypt + signed cookies | **implemented** (better) |
| Default password = mobile | ✓ | invite redemption | **implemented** (better) |
| Permission model | role strings, 92/470 endpoints | capabilities × scopes | **implemented** (better) |
| 5-min permission cache | ✓ | none | **implemented** (better) |
| **Server-side enforcement** | partial | **30 `#deny()` client-side** | **missing** — the core Phase 3 gap |
| Organisation isolation | **none** | `organisationId` on Tier-A | **partial** — no cross-tenant tests |
| Audit trail | none | append-only logs | **implemented** (better) |
| Firestore security rules | **not in repo** | n/a | **blocking unknown** |

### Communication and meetings

| Feature | Legacy | New | Status |
|---|---|---|---|
| Direct messages / groups | Firestore realtime | full UI | **mock only** — undeliverable across browsers |
| Notifications | `cowork_notifications` | full UI | **mock only** |
| Mail (internal) | `cowork_mails` | full UI | **mock only** — same defect |
| Gmail integration | per-employee OAuth | per-employee OAuth, encrypted | **implemented** |
| Meetings / LiveKit | `livekit.routes.js` | `/api/meetings/token` | **implemented** |
| Screen monitoring | office-monitor | implemented | **partial** |
| Push (FCM/web/Expo) | three channels | — | **missing** — owner decision |
| Sockets | Socket.IO | — | **missing** |

### Out of scope

CMS/manufacturing (503 eps), Accountant (308), Customer (55), Vendor (26),
Barcode (5). **Obsolete for Cowork** — different products in the same monolith.

## Highest migration risks

1. **Scope.** 1454 endpoints, ~1000 of them another product. If "production
   Cowork" silently means "the whole ERP", every estimate is wrong by 3×.
2. **No database at all in the new project.** 187 methods on localStorage. This
   is not a port — it is building a backend from scratch behind an existing
   interface. The interface being good is what makes it feasible.
3. **Permissions run client-side.** Until Phase 3, every rule is advisory.
4. **Firestore security rules are missing**, so legacy's real permission
   boundary is unknown and parity is unverifiable.
5. **Dual-write with no transaction** (Mongo + Firestore, from the browser)
   guarantees orphans on both sides. The importer must report, never guess.
6. **The join key is a virtual field** that already caused silent production
   failures. It must become a real constrained column.
7. **Two state axes** (`status` + `completionStatus`) need per-row transform
   rules, not a rename.
8. **After-duty work: legacy rewards it (C4 "Overtime Reward"), the new product
   charges it against budget.** A direct contradiction. Migrating history under
   the new rule reinterprets past scores.
9. **Promotion silently changes score maxima** via designation → band, with no
   history. Any score recomputation over migrated data will disagree with what
   employees were told.
10. **`CW-DEV-PMP-01 v1.0` is absent** from both repos — exact scoring parity
    cannot be verified.
11. **Per-employee leave does not affect deadlines** in the new office calendar.
    A live correctness gap, not just a migration one.
12. **Committed eTimeOffice credentials** — rotate now, independent of migration.

## Recommended implementation order

Each step is independently valuable and leaves the product working.

**0. Decide scope and rotate credentials.** Confirm Cowork+HR+SOP only. Rotate
the eTimeOffice secrets. Obtain the Firestore rules and `CW-DEV-PMP-01`.

**1. Database + repository (Phase 2).** Schema, migrations, `DatabaseRepository`
behind the existing 187-method interface, `DATABASE_MODE`, no silent fallback.
Highest risk, unblocks everything.

**2. Server-side permissions and org isolation (Phase 3).** Move the 30 `#deny()`
calls behind the API. Cross-tenant tests. Closes the largest security gap.

**3. HR core (Phase 4).** Employees, departments, designations, hierarchy with
the constraints legacy lacked. Everything else depends on the people table.

**4. Attendance, leave, holidays — and the leave→deadline bridge.** Closes the
correctness gap and completes checkpoints 3–5 of the task/settings work.

**5. Availability ledger wiring.** The calculation layer exists and is tested;
wire presence capture, break and emergency onto it.

**6. SOP Points.** Points on policies, approval gate, per-year signed ledger,
component tag, timer-derived sources.

**7. Migration importer.** Dry-run first, validate, preserve IDs, report
failures, never delete.

**8. Frontend connection (Phase 6).** Replace mock reads; loading, error, empty,
retry, permissions on every screen.

**9. Owner-decision modules.** Payroll, recruitment, biometric sync, push, bands.

Bands (step 9) should be decided *before* step 6 if adopted, since they change
what every score means.
