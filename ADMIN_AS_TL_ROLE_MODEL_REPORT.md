# Admin/CEO as TL + settings — role model report

Verify: **exit 0, 747 tests** (738 before), lint clean.

## The data finding that explains the empty Team page

Before any refactor, this is why the CEO sees nobody — and it is **not** an
architecture problem:

```
GR0000 | HR: RISHEE RAY (CEO, Corporate) | cowork_employees: MISSING
E000   | HR: NOT IN HR                   | cowork_employees: YES (ceo)
```

**There are two CEO records for one person.** `GR0000` is the real CEO in the HR
database and is who eight employees report to. `E000` "Admin CEO" is the record
in `cowork_employees` carrying `ray@grav.in` — the account you sign in with — and
**nothing in the reporting tree points at it.**

So the session resolves to E000, E000 has no reports, and Team is correctly
empty. The hierarchy engine is working; it is being asked about an identity the
org chart has never heard of.

**No code change fixes this.** Either `GR0000` gains a `cowork_employees` record
and you sign in as it, or the 8 HR edges are repointed from `GR0000` to `E000`.
Both are data changes in the legacy stores, which I have not touched. Until one
happens, the CEO account has no reports no matter what the role model says.

## Old behaviour

| Concern | Before |
|---|---|
| Hierarchy resolution | `primaryManager` only — already role-blind |
| CEO reach | `hierarchyIds` = **full transitive closure** |
| TL reach | `hierarchyIds` = **full transitive closure** |
| Admin gate | `archetype === "system_admin"` |
| "Admin sees everyone" rule | **none existed** |

Two things the audit settled rather than assumed:

1. **The hierarchy engine never read a role.** `buildReportingTree` takes
   manager answers and nothing else — there is no role parameter to pass, which
   is a structural guarantee rather than a convention. Requirement 1 was already
   met.
2. **There was no `admin = view everyone` to remove.** `lib/auth/can.ts`
   contains zero department references and resolves scope purely from
   `hierarchyIds`/`directReportIds`; and against the legacy backend
   `listRoles()` returns `[]`, so `can()` denies everything and `scopeFor()`
   returns null for every capability. Reach came from the tree alone.

## New model

```
Employee
 └── Manager (TL)          ← reach = direct reports, from the reporting tree
      └── Admin/CEO        ← same reach, plus /admin
```

### 1 · Hierarchy — unchanged, because it was already right

Admin/CEO resolves through the identical code path as a TL. No role branch, no
special-casing, no separate CEO tree.

### 2 · Visibility narrowed to direct reports — **this is a real change**

`hierarchyIds` was the full closure and is now **one level, for everyone**:

```ts
hierarchyIds: node?.directReportIds ?? [],
```

A CEO above a TL sees the TL and not the TL's people. A TL sees their own people
and nobody further down.

**Flagging this plainly: it narrows existing behaviour for TLs too**, which
requirement 2 asks for ("Indirect visibility disabled for now") and Case 3
confirms ("Works exactly the same"). It affects Team, live monitoring and every
hierarchy-scoped permission. `descendantsOf` is kept and tested for an org-chart
surface — a diagram and a permission list are different things and should not
share a source — but it no longer grants access.

### 3 · Admin settings as a separate capability

`canAccessAdminSettings(role)` in `lib/auth/roleMap.ts`, read from
`cowork_employees.role`. It unlocks `/admin` and grants **no reach over people**.

Recorded next to `mayOpenAdmin` as `ADMIN_GRANTS_NO_HIERARCHY_REACH`, with the
reasoning that matters most here: a CEO with no direct reports sees no team
exactly as a TL with no direct reports does. That is the model working, not a
bug to be patched by special-casing the administrator. **The fix for an empty
team is a reporting line, not a role.**

### 4 · Permission architecture

| Question | Source | Never consults |
|---|---|---|
| Whose work may I see? | reporting tree (`primaryManager`) | role, department |
| May I open `/admin`? | `canAccessAdminSettings(role)` | the tree |

Holding the admin flag adds nobody to your team. If a future capability needs to
bypass the hierarchy it must say so as its own capability with its own scope —
widening the admin predicate would silently turn "may configure the system" into
"may read everybody", which are different powers.

## Schema audit

| Field | Store | Present | Role in the model |
|---|---|---|---|
| `primaryManager.managerId` | MongoDB HR | ✅ 91 employees | **source of truth for hierarchy** |
| `biometricId` | MongoDB HR | ✅ | join key = `employeeId` |
| `role` | Firestore `cowork_employees` | ✅ `ceo`/`tl`/`employee` | admin capability only |
| `department` | Firestore | ✅ | grouping, approval gates |
| `managerId` / `primaryManagerId` | Firestore | ❌ **absent** | — hierarchy is not in Firestore |
| `hierarchyIds` | derived | n/a | never stored |

`cowork_employees` holds **no manager field at all**. The hierarchy lives
entirely in MongoDB HR and is joined by `biometricId`. That split is what allows
`E000` to exist in one store and `GR0000` in the other with nothing reconciling
them.

## Files changed

| File | Change |
|---|---|
| `lib/auth/roleMap.ts` | `canAccessAdminSettings()` — admin capability, separate from archetype |
| `lib/repositories/legacy/index.ts` | `hierarchyIds` = direct reports only; `descendantsOf` no longer grants access |
| `lib/server/session.ts` | `ADMIN_GRANTS_NO_HIERARCHY_REACH` documenting the boundary |
| `lib/auth/adminAsTl.test.ts` | new — 9 tests |

## Tests added (9)

- **Case 1** — admin with two direct employees sees both.
- **Case 2** — admin above a TL sees the TL only; the closure still knows the
  employee is beneath them, and that is explicitly not what grants access.
- **Case 3** — a TL resolves by the identical rule; and admin vs TL with
  identical trees get identical reach, which is the model's whole claim
  asserted rather than described.
- **Case 4** — only `ceo` unlocks settings; the archetype the route gates on
  agrees with the flag, so there is one answer rather than two.
- An admin with no reports sees nobody — the current production state.
- Admin access grants no reach over people.
- `buildReportingTree.length === 1` — the engine takes manager answers and
  nothing else, so a role structurally cannot influence reach.

## Not done

- **The `/admin/settings` sections** (Organization, User Management, Task Rules,
  Security) are not built. `/admin` exists and is gated; the four sections are a
  UI surface, and I would rather build them deliberately to the design system
  than stub four empty panels. Say the word.
- **The E000/GR0000 reconciliation** is a data decision in the legacy stores —
  yours to make, and the one thing that will actually put people on the CEO's
  Team page.
