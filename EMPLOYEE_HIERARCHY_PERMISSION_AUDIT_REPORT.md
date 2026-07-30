# Employee hierarchy vs department — permission audit

Verify: **exit 0, 738 tests** (729 before).

## Headline: the permission model was already manager-based

I audited every place department could act as a permission input. **The
hierarchy is not department-based, and I found no `department === department`
gate standing in for a reporting line.**

| Surface | What it actually keys on | Department involved? |
|---|---|---|
| `can()` / scope resolution (`lib/auth/can.ts`) | `hierarchyIds`, `directReportIds` | **zero references to department in the file** |
| Reporting tree (`lib/legacy/hierarchy.ts`) | `primaryManager` only | no |
| Team page | `viewer.hierarchyIds` | no |
| Assignee picker | everyone but self | no |
| Task list queries | `assignedBy`, `assigneeIds`, `approverId` | no |
| Score / PMP | employee id, engine-scoped | no |
| Deadline model (budget vs fixed) | `insideHierarchy` | no |
| Department approval gate | departments **and** direct-manager check | yes — correctly (item 4) |
| Approval workflows (`lib/auth/workflow.ts`) | `department_hod` stages | yes — correctly (item 4) |

`lib/auth/assignment.ts` already carries the exact fix your brief describes,
with the defect documented in its own comment:

> `crossesDepartment` was a plain department comparison, and the deadline rule
> read `crossesDepartment || !insideHierarchy`. So a department boundary
> overrode a reporting line that genuinely spanned it.

It now reads `crossesDepartment = departmentsDiffer && !isDirectManager`, and
the deadline rule is `insideHierarchy ? "timer" : "fixed"` — no department term
at all. That matches legacy, which skips its own gate when
`assignerIsTargetsManager`.

## The real bug: department data was never mapped

`toEmployee` set **`departmentId: ""` for every employee**, with a comment
explaining that legacy joins departments by name and has no id to give. True,
and still wrong in effect:

```ts
const departmentsDiffer =
  !!creatorDepartmentId && assigneeIds.some((id) => {
    const dept = input.departmentOf(id);
    return !!dept && dept !== creatorDepartmentId;      // "" !== "" → false
  });
```

With every value empty, **no two people were ever in different departments.**
So the symptom is the inverse of the one reported — not "hierarchy wrongly
gated by department", but **department not functioning at all**:

- the cross-department approval gate could never fire in the UI (the backend
  still enforced it, so work was still held — the interface just never said why)
- the picker's department filter matched nobody
- a department-scoped workflow had no department to resolve

Real data was there the whole time: `cowork_employees.department` holds "IT",
"Accounts", "Designing", "HR", "Production", "Marketing", "Merchandiser",
"Admin".

### Fix

`departmentId` is now the department **name, normalised** — because in legacy
the name *is* the identity: `taskForward.js:94` queries
`where("department","==",person.department)`. Normalised rather than raw,
because these strings are hand-typed into HR records and "IT" vs "it " must not
become a departmental boundary between two colleagues.

An employee with no department keeps `""`, which is correct rather than a gap:
legacy's gate requires both sides non-empty, and `departmentsDiffer` mirrors
that, so an unknown department raises no boundary instead of inventing one.

## Schema audit (item 5)

| Field | Store | Role |
|---|---|---|
| `primaryManager.managerId` | **MongoDB** HR `Employee` (ObjectId ref) | **the source of truth for hierarchy** |
| `secondaryManager.managerId` | MongoDB HR | recorded; forms **no** tree edge |
| `biometricId` | MongoDB HR | join key — equals the Cowork `employeeId` |
| `department` | **Firestore** `cowork_employees` | flat string; operational grouping only |
| `role` | Firestore `cowork_employees` | `ceo` / `tl` / `employee` |
| `hierarchyIds` | derived, never stored | transitive closure of the primary line |

**The tree is generated from manager relationships, not department membership.**
`buildReportingTree` reads `primaryManager` and nothing else; department is
never consulted. Only the primary line forms edges — two edges would put one
person in two branches and make depth ambiguous, and legacy's own
`resolveDepartmentApprover` consults the primary line alone.

## Your example, against the real records

Your illustration has Soumya in Finance and Rakesh in Operations. In production
they are **both IT** — Soumya Ranjan (GR0067, IT) reports to Rakesh Biswal
(GR0045, tl, IT) — so the cross-department case is not exercised by current
data. The tests below construct it explicitly rather than relying on records
that happen not to cover it.

Worth noting: **no reporting pair in the live data crosses a department.** The
rule matters, and nothing today exercises it.

## Files changed

| File | Change |
|---|---|
| `lib/repositories/legacy/map.ts` | `departmentSlug()`; `departmentId` derived from the name; `departmentName` trimmed |
| `lib/auth/hierarchyNotDepartment.test.ts` | new — 9 tests |

No permission logic was changed — it was already correct. What changed is that
the department field it depends on now holds a value.

## Rules, stated

1. **Reporting line decides reach.** Team, hierarchy-scoped permissions, the
   deadline model and monitoring all read the closure of `primaryManager`.
2. **A department boundary never overrides a reporting line.** A direct manager
   assigning to their own report raises no gate, whatever the departments say.
3. **Sharing a department grants nothing.** It is not a permission.
4. **Assignment is consent, not permission.** Anyone may assign to anyone; what
   changes is what must happen before work starts.
5. **Departments still decide approvals** — cross-department gates, HOD
   workflow stages, operational grouping and dashboards.
6. **A skip-level manager across a department still needs the heads.** Being two
   levels up is not the same as being accountable for that individual — the
   deadline model uses the full line, the gate uses one level.

## Tests added (9)

- **Case 1** — cross-department direct report: in the closure, `insideHierarchy`
  true, `crossesDepartment` **false** despite differing departments, budget
  deadline.
- **Case 2** — same department, no reporting line: not in the closure, no gate,
  **fixed** deadline; assignment still permitted.
- **Case 3** — indirect report `A → B → C`: in the closure at depth 2; a
  skip-level cross-department assignment gets a budget **and** the gate.
- `departmentId` is the normalised name, not `""`.
- Spelling variants collapse to one department; different names do not.
- An absent department raises no boundary.
