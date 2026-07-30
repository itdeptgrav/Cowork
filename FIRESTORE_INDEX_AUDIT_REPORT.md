# Firestore index audit

Verify: **exit 0, 729 tests** (723 before).

## The failing query

Every Firestore query this app issues, run against production:

| Query | Collection | Result |
|---|---|---|
| `approverId == me` + `orderBy updatedAt desc` | `cowork_tasks` | **FAILED_PRECONDITION — index missing** |
| `assignedBy == me` + `orderBy updatedAt desc` | `cowork_tasks` | OK — 3 docs |
| `assigneeIds array-contains me` + `orderBy updatedAt desc` | `cowork_tasks` | OK |
| `status == pending_department_approval` + `limit` | `cowork_tasks` | OK |
| `recipientEmployeeId == me` + `orderBy createdAt desc` | `cowork_notifications` | OK — 50 docs |
| `recipientEmployeeId == me` + `read == false` | `cowork_notifications` | OK |

**`cowork_tasks: approverId ASC, updatedAt DESC` is the one and only missing
index.**

It runs only for `role === "ceo"` (`index.ts:1084`). You are signed in as
`ray@grav.in` — **E000, Admin CEO** — so the CEO branch fires, the query throws,
and `#taskDocuments` raises it deliberately rather than swallowing. That raise
is why you saw "That didn't load" instead of a silently short task list.

## Root cause: the index was declared and never deployable

`firestore.indexes.json` already listed this index. Its own header said why it
did not matter:

> "This project does not deploy Firestore config — the indexes live in the
> Firebase console"

There was **no `firebase.json` and no `.firebaserc`**, so
`firebase deploy --only firestore:indexes` had nothing to read. The file was
documentation wearing the filename of configuration — written down and absent
from the project at the same time. That is the actual defect, and it is exactly
what you asked to have fixed rather than clicked past.

## Legacy comparison

Legacy issues the **identical** query at
`app/coworking/tasks/page.js:3927`:

```js
const qApprover = query(tasksRef, where("approverId", "==", employeeId),
                        orderBy("updatedAt", "desc"), limit(100));
unsubApprover = onSnapshot(qApprover, snap => { ... }, () => { });
```

Note the third argument: `() => { }`. **An empty error callback.** Legacy hits
the same missing index and discards the error, so a CEO there silently never
receives self-assign approval tasks and nothing indicates why.

Neither legacy repository versions Firestore config at all — no
`firestore.indexes.json`, no `firebase.json`. Every index in that project was
created by clicking a console link, which is how one came to be absent with no
record of it.

So: **the missing index is inherited, not introduced by the migration.** What
the migration changed is that the failure is now visible.

## Fix

| File | Change |
|---|---|
| `firebase.json` | new — points `firestore.indexes` at the definitions file |
| `.firebaserc` | new — default project `grav-cms-38f45` |
| `firestore.indexes.json` | added the `cowork_notifications` index; corrected the header that declared the file undeployable |
| `lib/repositories/legacy/firestoreIndexes.test.ts` | new — 6 tests |

No query was simplified and no filter removed. The `approverId` listener is how
a CEO sees self-assign tasks awaiting their approval; dropping it to avoid an
index would delete a permission surface to hide a config gap.

**You must run the deploy — I cannot.** It needs your Firebase credentials:

```
firebase deploy --only firestore:indexes
```

Index builds are asynchronous; `/tasks` will keep failing for a CEO until the
build completes (minutes, for a collection this size). Everyone else is
unaffected — their queries do not touch it.

## Tests

Six, asserting the config stays honest rather than that it exists:

- `firebase.json` points at the indexes file and `.firebaserc` names the project
  — the regression itself
- every composite query in `#taskDocuments` and `taskWatch` has a declaration
- the notifications query has one
- the department-gate query has **no** `orderBy`, so it needs no composite index
  — recorded so that adding one later is a deliberate act
- no declaration exists for a query the code does not issue: a stale index costs
  write throughput on every task mutation
- every declared index orders its timestamp `DESCENDING`, matching the
  `orderBy(..., "desc")` in the code — an `ASCENDING` declaration would not
  serve the query and would fail only at runtime

## Full audit — all five areas

| Area | Firestore queries | Composite index needed | Status |
|---|---|---|---|
| **Tasks** | 4 (3 role-scoped + gate) | 3 | ✅ declared; one needs deploying |
| **Notifications** | 3 | 1 | ✅ declared, present |
| **Team** | none — HTTP (`/employee/list-members`, `/my-managers`) | — | ✅ n/a |
| **Score** | none — HTTP (`/pmp/:id/dashboard`) | — | ✅ n/a |
| **Goals** | none — not connected | — | ✅ n/a |
| **Messages** | none — not connected | — | ✅ n/a |
| **Timers** | `cowork_task_timers/{id}/sessions` — subcollection, no filter | none | ✅ n/a |

Only Tasks and Notifications touch Firestore. Team, Score, Goals and Messages
either go over HTTP or are not connected, so nothing else can fail this way.

## One related risk worth naming

`getSubtasks` reads `subtaskIds` from the parent document rather than querying
`where("parentTaskId","==",id)`. That was chosen to stay consistent with the
array the engine maintains — and it also avoids a fourth composite index. Worth
remembering before anyone "simplifies" it into a query.
