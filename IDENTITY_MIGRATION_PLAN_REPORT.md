# Identity model — audit and permanent migration plan

No code changed. This is the audit and recommendation you asked for before
Admin Settings.

## 1 · The identity graph, as it actually is

| Join | Mechanism | Health |
|---|---|---|
| Firebase user → Cowork employee | `cowork_employees.authUid` | ✅ **16/16 populated** — an explicit field |
| Cowork employee → HR employee | `employeeId === biometricId` | ⚠️ **15/16** — a naming convention, not a field |
| HR employee → hierarchy | `primaryManager.managerId` (ObjectId) | ✅ 91 of 96 have a manager |

Population:

- **32 Firebase auth users**
- **16 Cowork employees** — so 16 auth users have no Cowork record
- **96 HR employees** — Cowork is a *subset* of HR; 80 HR staff have no Cowork
  account

**The weak link is the middle join.** Firebase→Cowork is an explicit field.
HR→hierarchy is an explicit reference. Cowork→HR is two independently-maintained
records agreeing on a string, with nothing enforcing it.

## 2 · What E000 actually is — this reframes everything

`Middlewear/coworkAuth.js`:

```js
40:  let snap = await db.collection("cowork_employees")
                        .where("authUid","==",decoded.uid).limit(1).get();
43:  snap = await db.collection("cowork_employees")
                        .where("email","==",decoded.email).limit(1).get();
51:  employeeId: "E000", authUid: decoded.uid,
57:  await db.collection("cowork_employees").doc("E000").set(ceoData,{merge:true});
```

**E000 is not a person. It is a catch-all bootstrap identity** that the auth
middleware creates — and stamps the caller's uid onto — for any authenticated
Firebase user it cannot match by `authUid` or by `email`.

`ray@grav.in` became E000 because no Cowork record matched either way: GR0000
has no Cowork record, and GR0000's HR record has no email to match on.

So the situation is not "two CEO records that should be merged". It is **one
real identity (GR0000) and one fallback bucket (E000) that the human fell
into.**

### E000 is load-bearing and must not be deleted

| Dependency | Where |
|---|---|
| Default cross-department approver | `taskForward.js:199, 203, 246, 250` — absence **hard-blocks** assignment with "no default approver (E000) is configured" |
| Excluded from score lists | `pmpRoutes.js:213` |
| Excluded from workload lists | `workloadroutes.js:180` |
| `assignedBy` | **17 tasks** |
| `originalAssignedBy` | **17 tasks** |
| `approverId` | **7 tasks** |

**Option B (merge E000 into GR0000) is rejected.** It would break the fallback
approver in a backend I am not to modify, and orphan 41 task field references.

## 3 · Recommendation — Option A, refined

**Give the human their real identity; leave E000 as the system account.**

1. **Create `cowork_employees/GR0000`** with
   `authUid: "paHxne71GZQR7Qt89STzj8XHXmq2"`, `email: "ray@grav.in"`,
   `role: "ceo"`, `name: "Rishee Ray"`, `department: "Corporate"`.
2. **Clear `authUid` on `cowork_employees/E000`.**
3. **Delete the alias** from `lib/legacy/identityMap.ts`.

Why this works, from the middleware itself: the `authUid` lookup at line 40
runs **first**, so once GR0000 carries the uid it matches there and the E000
branch at line 51 is never reached. E000 survives untouched for every backend
dependency above, and stops being a login.

**Step 2 is not optional.** That query is `.limit(1)` with no ordering — two
documents sharing a uid is a coin flip on every request, and the losing outcome
is the CEO silently resolving to the wrong identity.

After this, E000 is what it always was in practice: a system approver account,
now visibly so rather than a person's login.

### Affected

| Collection / field | Change |
|---|---|
| `cowork_employees/GR0000` | **created** |
| `cowork_employees/E000.authUid` | **cleared** |
| `cowork_tasks.*` | **none** — E000 keeps its 41 references |
| MongoDB `Employee` | **none** — GR0000 already correct |
| `lib/legacy/identityMap.ts` | alias removed |

### Risks

| Risk | Severity | Mitigation |
|---|---|---|
| Middleware re-stamps E000's `authUid` | Medium | Cannot happen once GR0000 matches at line 40 — verify by signing in and re-reading E000 |
| Two records share the uid mid-migration | **High** | Do step 2 in the same session as step 1; the window is the exposure |
| GR0000 appears in score/workload lists | Low | E000 is filtered out by employeeId; GR0000 is not. The CEO will now appear in those lists — arguably correct, but it is a visible change |
| The CEO's 3 existing tasks stay under E000 | Low | They remain visible via E000; the new identity starts clean. Reassigning is optional and touches production task data |

### Rollback

1. Restore `authUid` on E000 (record the value first).
2. Delete `cowork_employees/GR0000`.
3. Restore the alias entry.

Fully reversible; no task data is touched in either direction.

## 4 · The permanent fix for the class of bug

Option A repairs one person. The *class* of bug — a join by naming convention —
stays. The durable fix is to **make the Cowork→HR link an explicit field**:

```
cowork_employees.biometricId   ← added, populated from employeeId
```

Then the join is a stored reference rather than a coincidence, and a mismatch
becomes writable data instead of a hardcoded alias. That is a schema change in
the legacy project, so it is a recommendation rather than something I can do —
but it is the answer to "one human, one canonical identity" as a property of the
system rather than of this repository.

Until then, `identityMap.ts` is the honest place for the exception: it is one
table, tested, and asserted to hold exactly one entry.

## 5 · Admin-as-TL after cleanup — unchanged

Nothing in this plan touches the role model:

- Hierarchy reach: **direct reports only**, from `primaryManager`
- Admin Settings: `canAccessAdminSettings(role === "ceo")`
- **No hierarchy bypass** — `ADMIN_GRANTS_NO_HIERARCHY_REACH`

After migration the CEO signs in as GR0000, which already has real reports, so
Team populates from the reporting tree with no special-casing. The alias
disappears and the behaviour is identical — which is the test that the alias was
a compatibility layer and not a load-bearing rule.

## 6 · Integrity checks — already built, one gap

`checkIdentity()` (`lib/legacy/identityMap.ts`) returns a typed problem rather
than a boolean, and `describeIdentityProblem()` renders it. Ten tests cover it.
It distinguishes:

- `no_hierarchy_node` — signed in, nothing in the tree corresponds. **Never
  rendered as "you have no reports"**, which is a claim about the organisation
  when the truth is a broken join.
- `no_manager` — a real node with nobody above it.

**The gap: it is not yet wired into a screen.** The function exists and is
tested; no component calls it, so the configuration error is not yet on screen.
That is the one piece of item 5 outstanding, and it is a UI change I would
rather make deliberately than bolt on now.

I also cannot check the third leg — "one HR employee" — from the browser: the
app has no HR credential, so it sees the Cowork directory and the derived tree,
not the Mongo records. The audit above is the check, run server-side.

## Recommendation

Do **Option A**, both steps together. It is additive, reversible, breaks nothing
that depends on E000, and removes the alias. Then, when convenient, add
`biometricId` to `cowork_employees` so the next mismatch is data rather than
code.

I have made no writes to either legacy store. Say the word and I will run the
two Firestore operations, or hand you the exact commands.

**Admin Settings remains not started**, per your instruction.
