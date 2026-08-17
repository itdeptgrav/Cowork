# Employee hierarchy — parity report

Verify: **exit 0, 695 tests** (683 before).

## The headline finding

**Old Cowork has no employee hierarchy tree.** No org chart, no nesting, no
expand/collapse, no depth. Searching the old frontend for "hierarchy" returns
*task* hierarchy — parent tasks and subtasks — in everyy case but one.

The single employee-relationship surface is
`GET /cowork/employee/my-managers/:employeeId`, called by `CoworkingShell.js:2264`
and `sop/page.js:2747` to render one card: **who my manager is**. Upward, one
level, one person at a time.

So items 2 and 3 of the brief describe behaviour that has no counterpart to
match. What I built instead is the tree legacy's *data* supports, derived
honestly — not a tree copied from a screen that does not exist.

---

## Where the data actually lives

| Concern | Store | Field |
|---|---|---|
| Reporting manager | **MongoDB** HR `Employee` | `primaryManager.managerId` (ObjectId → `Employee`), `secondaryManager.managerId` |
| Cowork identity | **Firestore** `cowork_employees` | `employeeId`, `name`, `role`, `department` |
| Join key | — | HR `biometricId` **is** the Cowork `employeeId` |

The reporting tree is in a different database from the Cowork directory, joined
by a string. That seam is the whole reason this was missing.

**Departments are not a hierarchy.** `cowork_employees.department` is a flat
string, and there is no department entity, no parent department, and no team
concept anywhere in Cowork. `resolveDepartmentApprover` (`taskForward.js:86`)
finds "a TL in this department" with `where("department","==",d).where("role","==","tl").limit(1)`
— a flat lookup that takes whichever TL comes first, and only falls back to the
primary manager. There are no folders in the employee sense; `isFolder` is a
task flag.

**Nothing in `/cowork/*` ever queries downward.** Queries against
`{"primaryManager.managerId": id}` exist only in `employeeAuth.js`,
`leaveRoutes.js` and `HrRoutes/Employee-Section.js` — the HR product inside the
monolith, behind the HR JWT, unreachable from a Cowork token.

### Live data (production, 2026-07-29)

16 employees in `cowork_employees`; **15 have a linked primary manager**, 1 is
absent from HR. `GR0000` is the root; four TLs report to it; employees report to
TLs. GR0045 — you — is a TL with GR0067 reporting to you. The tree is real and
fully populated; nothing was missing at the source.

---

## Why new Cowork had none

Not a missing API call, not a wrong mapping, not the UI. `map.ts:104-115`
returned `hierarchyIds: []` and `directReportIds: []` **deliberately**, with a
comment saying so: legacy exposes only "who are my managers" and no endpoint in
the other direction, so building either list means one call per employee — and
that was judged not to belong hidden inside every `getViewer()`.

That reasoning was right about the cost and wrong about the conclusion. The fix
is not to hide N calls inside `getViewer`, but to make the tree its own lazily
cached derivation that a screen pays for only when it asks.

Second cause: `SessionProvider` passed `hasManager: false` hardcoded, with a
comment admitting it was withholding a control rather than answering the
question. That is now read from the tree.

---

## Implementation

Legacy cannot be asked for a tree, so the tree is **derived**: ask every
employee in the directory who their manager is, then invert.

| File | Change |
|---|---|
| `lib/legacy/hierarchy.ts` | new — `fetchMyManagers`, `buildReportingTree`, `readDepth`, `descendantsOf` |
| `lib/repositories/legacy/index.ts` | `#reportingTree()` lazy cache; `getViewer` closure; `listReportingLines`; `listDirectReports` |
| `lib/legacy/hierarchy.test.ts` | new — 12 tests |

Decisions worth stating:

- **Only the primary line forms the tree.** Secondary managers are recorded
  because legacy stores them and a profile shows them, but they create no
  parent-child edge — two edges would put one person in two branches and make
  depth ambiguous. `resolveDepartmentApprover` consults the primary line alone,
  so this matches the engine.
- **Unresolvable depth is `null`, never `0`.** A cycle, or a manager outside the
  directory, means we do not know where somebody sits. Rendering them at depth 0
  places them beside the CEO — a specific wrong claim rather than an absence.
- **"Named but unlinkable" is kept distinct from "no manager".** The handler
  falls back to a bare `managerName` when the ObjectId ref is missing, returning
  `biometricId: ""`. A tree cannot draw an edge to a name, but a profile can
  still say who someone reports to.
- **Per-employee failure costs one edge, not the tree.** Legacy already returns
  `success: true` with null managers for someone absent from HR, so unknown and
  absent arrive indistinguishable.
- **Bounded concurrency (8).** A few hundred simultaneous sockets would be
  rate-limited into looking like an outage.

---

## Task hierarchy dependency (item 3)

Audited, and the finding is that **tasks barely use the reporting tree at all**:

| Surface | Uses reporting tree? | Actual rule |
|---|---|---|
| TL task visibility | ❌ No | `assignedBy == me` + `assigneeIds array-contains me` |
| CEO task visibility | ❌ No | those two + `approverId == me` |
| Descendant matching | ❌ No | **task** parent/child via `subtaskIds`, not employees |
| Department approval | ⚠️ Partly | department TL first; primary manager only as fallback |
| `My team` scope | ✅ Yes | `viewer.hierarchyIds` — which was empty, so it returned nothing |

So the one task surface that was actually broken by the empty closure is the
**My team** scope, and it now resolves. TL and CEO visibility were never
hierarchy-driven and are unchanged — widening them to the closure would have
been a real permission change dressed up as a parity fix.

---

## Parity status

| Item | Status |
|---|---|
| Hierarchy data source identified | ✅ Mongo `primaryManager`, joined by `biometricId` |
| Every employee mapped | ✅ 15/16 linked; the 16th is absent from HR upstream |
| employeeId, name, role, department | ✅ already mapped by `toEmployee` |
| Reporting manager | ✅ primary + secondary |
| Parent-child | ✅ derived and inverted |
| Depth | ✅ with honest nulls |
| `My team` scope | ✅ closure resolves |
| Permissions | ✅ closure under-shows rather than leaks |
| Tree rendering, expand/collapse, search | ⬜ **no legacy counterpart to match** |

**Not marking hierarchy complete.** The data layer is done and tested; there is
no hierarchy *screen* in either app. If you want one in new Cowork it is a new
feature, and I would rather build it to the new design system deliberately than
claim parity with something legacy never had. Say the word and I will — the
repository now returns everything such a screen needs.

One caveat to weigh first: `#reportingTree()` costs one HTTP call per employee
on first use. At 16 employees that is trivial; at 500 it is not, and the right
fix then is a backend endpoint that returns the tree in one call — a small
addition to `cowork.js`, in the repo you have asked me not to modify.
