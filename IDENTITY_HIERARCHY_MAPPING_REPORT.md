# Identity → hierarchy mapping

Verify: **exit 0, 757 tests** (747 before), lint clean.

## Root cause

Four identities across three stores, joined by string equality:

```
Firebase auth (uid, email)         — Firebase
      ↓  GET /cowork/me
Cowork employee (employeeId, role) — Firestore cowork_employees
      ↓  employeeId === biometricId      ← the join that breaks
HR employee (biometricId)          — MongoDB Employee
      ↓  primaryManager.managerId
Hierarchy node                     — derived
```

That second join is two independently-maintained records agreeing on a string.
**It holds for 15 of 16 Cowork employees and fails for exactly one — the CEO.**

| Id | HR record | `cowork_employees` | Reports pointing at it |
|---|---|---|---|
| `GR0000` | RISHEE RAY, CEO, Corporate | **absent** | **8** |
| `E000` | **absent** | Admin CEO, `ray@grav.in` | 0 |

Signing in as `ray@grav.in` resolves to `E000`, a node nobody reports to. The
CEO's Team was empty while eight people reported to a record the Cowork
directory has never heard of.

## Audit of every identity join (item 3)

I checked all 16 Cowork employees for an HR record under the same id, and where
that failed, for one matching by any email field:

```
MISMATCH E000 (ray@grav.in) -> byId: NONE | byEmail: NONE
done
```

**One mismatch. And it is not resolvable from data:** `GR0000`'s HR record
carries `email: ""` and `personalEmail: ""`. No shared uid, no shared code, no
email. Nothing joins these two records.

## Mapping solution

Because nothing derives it, the mapping is **written down as reviewable
configuration** rather than inferred at runtime:

```ts
export const IDENTITY_ALIASES = {
  E000: "GR0000",   // Admin CEO (ray@grav.in) is RISHEE RAY in HR
};
```

A heuristic — "the `ceo`-role account is whichever HR record has designation
CEO" — would be the same guess with nowhere to disagree with it. A reader of
`lib/legacy/identityMap.ts` can see the claim and check it.

**This is a workaround for a data defect, not a design.** The table should be
emptied once the stores agree, and a test asserts it holds exactly one entry so
it cannot grow quietly.

### The structural half of the fix

The alias alone was not enough: `GR0000` was not a node in the tree at all,
because the tree was built only from employees we could ask about — and `GR0000`
has no Cowork account to ask.

`buildReportingTree` now **creates a node for any manager named by an edge**,
marked `isDirectoryMember: false`. That is a general correctness fix, not a
CEO special case: any manager without a Cowork account previously left their
reports at unresolvable depth and had no `directReportIds` to read.

Consequence, stated plainly: the tree is now connected. `GR0045`'s depth moves
from `null` to `1`, and `rootIds` becomes `["E000", "GR0000"]` — two roots,
where `E000` being a root **is** the identity defect, now visible rather than
hidden.

## Admin-as-TL preserved (item 2)

Unchanged. `hierarchyIds` is still direct reports only. After resolution:

```
CEO/Admin (E000 → GR0000)
 ├── GR0002   ← sees
 └── GR0045   ← sees
      ├── GR0067   ← does NOT see
      └── GR0108   ← does NOT see
```

The identity fix changes **who the CEO is** in the tree, not **how far** anyone
sees. A test asserts both halves.

## Validation (item 4)

`checkIdentity()` returns a **problem, not a boolean**, because the two failures
need different words and lead to different fixes:

- `no_hierarchy_node` — signed in, nothing in the tree corresponds. This is the
  E000 case. It must never render as "you have no reports", which is a claim
  about the organisation when the truth is a broken join. The message says so
  explicitly: *"This is not the same as having no reports."*
- `no_manager` — a real node with nobody above it. Correct at the top, a gap
  anywhere else.

Both are **reported, never repaired**. Guessing a manager is exactly what must
not happen — receiving somebody is a decision, not a default.

## Files changed

| File | Change |
|---|---|
| `lib/legacy/identityMap.ts` | new — alias table, `toHierarchyId`, `fromHierarchyId`, `checkIdentity`, `describeIdentityProblem` |
| `lib/legacy/hierarchy.ts` | managers named by an edge become nodes; `isDirectoryMember` |
| `lib/repositories/legacy/index.ts` | `getViewer` resolves through `toHierarchyId` before reading the tree |
| `lib/legacy/identityMap.test.ts` | new — 10 tests |
| `lib/legacy/hierarchy.test.ts`, `lib/repositories/legacy/security.test.ts` | two assertions updated to the now-connected tree |

**Two tests were changed, and I want to be explicit about why.** They asserted
that a manager outside the directory leaves depth unresolvable and that
`GR0000` has no node — the old, broken behaviour. That behaviour is what this
change fixes, so the assertions were updated to the new truth rather than
weakened around it.

## Database changes

**None. I have not written to either legacy store.**

The durable fix is one of two data decisions, both yours:

1. **Give `GR0000` a `cowork_employees` record** and sign in as it. Cleanest —
   one person, one identity, and the alias table empties.
2. **Repoint the 8 HR edges from `GR0000` to `E000`.** Keeps the current login
   working but leaves a CEO record in HR that nobody reports to.

Option 1 is better: `GR0000` is the identity the rest of the HR system already
uses, including for the 91 employees with managers who are outside Cowork.

## Tests added (10)

Mapping: the CEO resolves to `GR0000`; everyone else maps to themselves; the
mapping reverses; exactly one alias exists.

Effect: `E000` has no reports and the resolved node has two — the before and
after of the bug in one test. Admin-as-TL still holds: the CEO sees `GR0045`
and not `GR0067`/`GR0108`.

Validation: an unmappable account reports `no_hierarchy_node` with a message
naming both ids and denying the "no reports" reading; a resolved root reports
`no_manager`; a fully-placed employee reports nothing.

## Not done

**Admin Settings is not started**, as you instructed. The identity resolution is
in place and tested, so permissions now resolve against the correct hierarchy
identity — but the underlying data still disagrees, and until you pick option 1
or 2 the alias is load-bearing. I would rather you resolve that first, since
`/admin/settings` will be built on exactly this identity.
