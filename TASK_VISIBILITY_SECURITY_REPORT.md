# Task visibility — security report

Verify: **exit 0, 718 tests**.

## Finding: T620 is not reachable by GR0045, and I could not make it be

I ran the exact queries `#taskDocuments` issues, against production, as GR0045
(role `tl`, department IT):

| Query | Rows | Contains T620 |
|---|---|---|
| `assignedBy == GR0045` | 3 | **no** |
| `assigneeIds array-contains GR0045` | **0** | **no** |
| `status == pending_department_approval` | **0** | **no** |
| `approverId == GR0045` | — | not run: missing composite index (see below) |

T620's own fields put GR0045 nowhere near it:

```
status: open        assigneeIds: ["GR0002"]     assignedBy: "E000"
approverId: null    visibleTo: []               isSelfAssigned: false
pendingAssigneeId: "GR0002"   tlHoursSetBy: "GR0002"   parentTaskId: null
```

So on the current code and the current data, **T620 cannot enter GR0045's
list.** I could not reproduce the leak.

## The most probable explanation, and why I am not certain

`pendingAssigneeId` and `tlHoursSetBy` are set on T620, which means it **was**
once a cross-department task held at `pending_department_approval` and has since
been approved to `open`.

The query that reads held tasks is org-wide by necessity — Firestore cannot
filter on a field inside `departmentApprovals[]`, so legacy itself
(`page.js:3596`) queries by status and narrows client-side. If you looked while
T620 was still held, an org-wide result is exactly what you would have seen.

I added that query and its scoping predicate in the same change, so a build with
one and not the other should not exist. I cannot rule out that you were running
a partially-reloaded dev bundle. **What I can say is that the predicate is
present now, is enforced at the repository layer, and is tested.**

## Old vs new visibility logic

Documented in full, since you asked for every filter.

| Scope | Old Cowork (`page.js`) | New Cowork | Match |
|---|---|---|---|
| Firestore queries, employee | `assigneeIds array-contains me` | same | ✅ |
| …TL | + `assignedBy == me` | same | ✅ |
| …CEO | + `approverId == me` | same | ✅ |
| Held tasks | `status == pending_department_approval`, org-wide, narrowed client-side (`:3596`, `:6932`) | same query, narrowed at the repository | ✅ |
| Assigned to me | `:6016` — self-assigned → mine only if I raised it; else assigned to me and not by me; else a non-forwarded descendant is | same | ✅ |
| Assigned out | `:6033` — self-assigned → approver or named viewer; else `assignedBy == me`; or `tlHoursSetBy == me` | same | ✅ |
| Self tasks | `:6040` — `isSelfAssigned && assignees ∋ me` | same | ✅ |
| Submitted | `:1015` — six-stage lifecycle, not cancelled, and I am party to it; CEO sees all | same | ✅ |
| My team | `viewer.hierarchyIds` | same | ✅ |

**Task visibility does not consult the reporting tree.** A manager does not see
a report's tasks in their task list — only the separate `My team` employee scope
uses the closure. I did not widen the task queries to the hierarchy; that would
be a permission change wearing a parity fix's clothes.

## Where filtering happens

At the repository, not the UI. `LegacyRepository.listTasks` applies the gate
scoping **before** any mapping, and the scope predicates before any view is
built. `TaskTable` and `TaskBoard` receive an already-filtered page.

One honest caveat: the held-task query returns org-wide rows **into the client**
before the predicate drops them. That is legacy's own design and Firestore's
constraint, not a choice — but it means the documents cross the wire. The real
boundary is Firestore security rules, which live in a repo I have not modified.
If held-task titles must never reach an unauthorised browser, that is where it
has to be enforced.

## A real gap found on the way

`approverId == me` **fails with a missing-index error**:

```
9 FAILED_PRECONDITION: The query requires an index.
  cowork_tasks: approverId ASC, updatedAt DESC
```

`firestore.indexes.json` declares it; it has not been deployed. For a CEO this
query throws — and `#taskDocuments` deliberately raises rather than swallowing,
so **the whole task list fails for a CEO** rather than silently under-showing.
Deploy with `firebase deploy --only firestore:indexes`.

## Security impact

**Low, and bounded.** The leak is unreproducible on current code and data, and
the one query that can over-return is scoped at the repository with tests. The
adjacent finding — that documents cross the wire before being filtered — is
inherited from legacy and bounded by Firestore rules.

## Files changed

None for this issue. The scoping predicate and its tests were already in place;
this change adds the regression tests you asked for.

| File | Change |
|---|---|
| `lib/repositories/legacy/security.test.ts` | new — 8 tests |

## Tests added

- **T620 is not reachable by GR0045** through any of the four queries — the
  exact scenario requested, using the real document.
- T620 **is** reachable by GR0002 (assignee) and E000 (creator).
- A task assigned to GR0045 is visible; one created by GR0045 is visible.
- **A report's task is not visible merely because I manage them** — GR0067
  reports to GR0045, and their task stays out of GR0045's list.
- A held task reaches its sender, pending assignee and approvers, and **not** an
  unrelated TL.
