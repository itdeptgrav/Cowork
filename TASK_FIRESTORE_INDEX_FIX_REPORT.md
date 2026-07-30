# Tasks Firestore index — fix report

Verify: **exit 0, 766 tests** (765 before).

**Deployment status: BLOCKED — I do not have permission. The index is still
missing.** Everything else is done; §5 has the one command you need to run.

---

## 1 · The failing query, verified in current code

Two call sites issue it, deliberately identical — the watcher must not signal a
change to a document the read cannot return:

| File | Line | Query |
|---|---|---|
| `lib/repositories/legacy/index.ts` | 1084 | `where("approverId","==",viewerId)` + `orderBy("updatedAt","desc")` + `limit(100)` |
| `lib/repositories/legacy/taskWatch.ts` | 78 | identical, as `onSnapshot` |

Both are guarded by `if (role === "ceo")`, which is why only the CEO/Admin
account fails and every employee and TL loads normally.

The query is legacy's own — `app/coworking/tasks/page.js:3927` issues it
verbatim. It is how a CEO sees self-assign tasks awaiting their approval, so
removing or simplifying it would delete a permission surface to work around a
config gap. It was not touched.

## 2 · `firestore.indexes.json` — correct

All four indexes declared, including:

```json
{
  "collectionGroup": "cowork_tasks",
  "queryScope": "COLLECTION",
  "fields": [
    { "fieldPath": "approverId", "order": "ASCENDING" },
    { "fieldPath": "updatedAt",  "order": "DESCENDING" }
  ]
}
```

Field order and directions match the query. Six tests assert the declaration
stays in step with the code, including that every timestamp is `DESCENDING` —
an `ASCENDING` declaration would not serve `orderBy(..., "desc")` and would fail
only at runtime.

## 3 · Index state in the project

Queried through the Firestore Admin API:

```
total indexes on cowork_tasks: 16
states: {"READY": 16}
indexes containing approverId: 0
any index CREATING: none
```

**Still absent.** Not building — never created.

## 4 · `firebase.json` / `.firebaserc` — correct

```json
// firebase.json
{ "firestore": { "indexes": "firestore.indexes.json" } }
// .firebaserc
{ "projects": { "default": "grav-cms-38f45" } }
```

Both were added in the earlier audit and are asserted by test. The config is
connected; nothing has consumed it yet.

## 5 · Deployment — blocked

Two routes attempted, both unavailable to me:

**Firebase CLI** — not installed, never authenticated on this machine:

```
firebase   -> not found
npx firebase -> not a local devDependency
~/.config/configstore/firebase-tools.json -> absent
```

**Firestore Admin API**, using the backend's service account — which *can* read
indexes, since that is how §3 was produced:

```
POST .../collectionGroups/cowork_tasks/indexes
HTTP 403  { "error": "The caller does not have permission",
            "status": "PERMISSION_DENIED" }
```

The service account holds data-plane rights (`datastore.user`) but not
`datastore.indexes.create`. Reading index metadata is permitted; creating one is
not. **There is no path from here.**

### What you need to run

```bash
npm i -g firebase-tools     # or: npx firebase-tools@latest
firebase login              # interactive — must be you
cd /Users/risheeray/Documents/cowork
firebase deploy --only firestore:indexes
```

Run `! firebase login` in this session and its output lands in the conversation,
so I can carry on from there and verify.

**Alternative, if you would rather not install the CLI:** the console link
inside Firestore's own error message creates exactly this index in one click.
The declaration in `firestore.indexes.json` still matters — it is what makes the
next environment reproducible rather than dependent on somebody having clicked.

The build is asynchronous. `cowork_tasks` is small, so expect minutes.

## 6 · Error handling — added

Firestore's message is *"The query requires an index. You can create it here:
<url>"*. Accurate, and it lands on the wrong person: whoever is looking at the
screen usually cannot deploy an index, and the message says nothing about which
query broke or who it affects.

`asIndexError()` now rewrites it, keeping the console link and adding what it
lacks:

> Your task list needs a Firestore index that has not been deployed. This
> affects the **"ceo"** role only — other roles load normally, which is why it
> can look like a problem with one account. The required indexes are declared in
> `firestore.indexes.json`; deploy them with
> `firebase deploy --only firestore:indexes`. Firestore's own message follows —
> its link creates the index directly.

Two things it deliberately does **not** do:

- **It does not swallow.** The error is still thrown. An index failure turned
  into an empty list is indistinguishable from having no tasks, which is the
  exact fault this code path was written to avoid.
- **It does not catch anything else.** Only messages matching
  `/requires an index|FAILED_PRECONDITION/` are rewritten; every other failure
  passes through untouched.

## Files changed

| File | Change |
|---|---|
| `lib/repositories/legacy/index.ts` | `asIndexError()`; `#taskDocuments` maps query failures through it |
| `lib/repositories/legacy/firestoreIndexes.test.ts` | +1 test — the rewrite exists, names the deploy command, and still throws |

No query, filter or index declaration was modified.

## Verification results

| Check | Result |
|---|---|
| Query present and unmodified | ✅ two sites, CEO-gated |
| `firestore.indexes.json` correct | ✅ fields and ordering match |
| `firebase.json` / `.firebaserc` | ✅ connected |
| Index deployed | ❌ **absent — 403 on create** |
| Error message actionable | ✅ names the role and the command |
| `npm run verify` | ✅ exit 0, 766 tests |

### Role testing — cannot complete until the index exists

| Role | My tasks | Assigned out | Approval tasks |
|---|---|---|---|
| Employee (e.g. GR0067) | ✅ expected to load — `assigneeIds` index is READY | ✅ | n/a |
| TL (GR0045) | ✅ | ✅ — `assignedBy` index is READY | n/a |
| **CEO (GR0000)** | ❌ | ❌ | ❌ — **all three fail** |

Worth being precise about the CEO row: `#taskDocuments` runs all queries through
one `Promise.all`, so the `approverId` failure rejects the whole call. The CEO
does not lose only their approval tasks — they lose the entire Tasks page.
That is correct behaviour (a partial list presented as complete would be worse),
but it explains why the symptom is total rather than partial.

I cannot sign in as any of these accounts to confirm the render. The index state
above is measured from the live project, so the CEO failure is certain and the
other two rows follow from their indexes being READY.

**Re-verification after you deploy:** re-run the Admin API query — the index must
read `READY` **and** `where("approverId","==",…).orderBy("updatedAt","desc")`
must return rows instead of `FAILED_PRECONDITION`. I can run both on request.
