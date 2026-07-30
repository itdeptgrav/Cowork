# Firestore index deploy — verification

**Deployment status: DID NOT HAPPEN. The index is still missing.**

Not building, not partially applied — absent.

## Evidence

### 1 · The query still fails

```
FAIL  approverId==E000   + orderBy updatedAt desc -> 9 FAILED_PRECONDITION: The query requires an index.
FAIL  approverId==GR0045 + orderBy updatedAt desc -> 9 FAILED_PRECONDITION: The query requires an index.
```

This alone is not conclusive — Firestore returns `FAILED_PRECONDITION` for an
index that is still `CREATING` as well as one that does not exist. So I checked
the index state directly rather than inferring it.

### 2 · `firebase firestore:indexes` could not be run

```
firebase           -> not found
npx firebase       -> not a local devDependency
~/.config/configstore/firebase-tools.json -> absent
```

**The Firebase CLI is not installed on this machine and has never been
authenticated here.** No `firebase deploy` has run from this repository. That is
almost certainly the whole story: the command could not have succeeded because
the command does not exist here.

### 3 · Authoritative index state, from the Firestore Admin API

Queried with the backend's service-account credential —
`GET /v1/projects/grav-cms-38f45/databases/(default)/collectionGroups/cowork_tasks/indexes`:

```
total indexes returned: 16
states: {"READY": 16}
indexes containing approverId: 0
--- any index still CREATING? ---
(none)
```

**Sixteen indexes, every one READY, zero mentioning `approverId`, nothing
building.** The index was never created.

## Declared vs deployed

| Index | Declared in repo | Deployed | State |
|---|---|---|---|
| `cowork_tasks` · `assigneeIds` CONTAINS + `updatedAt` DESC | ✅ | ✅ | READY |
| `cowork_tasks` · `assignedBy` ASC + `updatedAt` DESC | ✅ | ✅ | READY |
| **`cowork_tasks` · `approverId` ASC + `updatedAt` DESC** | ✅ | ❌ | **ABSENT** |
| `cowork_notifications` · `recipientEmployeeId` ASC + `createdAt` DESC | ✅ | ✅ | READY |

Three of four are live. The one the audit named as the cause of "That didn't
load" is the one that is missing — unchanged from the previous report.

## Item 6 — not performed, and why

I did not re-run the app query as CEO or check `/tasks`. The precondition for
that step was "if deployed", and it is not. Running it would only reproduce the
same `FAILED_PRECONDITION` I already have above, and reporting a green result
from a page that cannot work would be worse than reporting nothing.

## Code changes

**None.** Your instruction was not to modify code unless the index is genuinely
missing. It is missing — but the code side is already correct from the previous
change: `firebase.json`, `.firebaserc` and the declaration in
`firestore.indexes.json` are all in place and covered by six tests. Nothing in
the repository needs another edit. What is missing is the deploy itself.

## What to do next

The repository is ready; it needs one authenticated command. Two options.

**Option A — deploy from the repo (reproducible, and what the config is for):**

```
npm i -g firebase-tools      # or: npx firebase-tools@latest
firebase login               # interactive — must be you
cd /Users/risheeray/Documents/cowork
firebase deploy --only firestore:indexes
```

Tip: run `firebase login` via `! firebase login` in this session so its output
lands in the conversation and I can pick up from there.

**Option B — I create it directly.** The backend's service account already has
Firestore admin rights, so I can `POST` the index definition to the Admin API
without any CLI or login. It is additive and reversible — no existing index or
document is touched.

I have not done this. It is a change to your production database and you asked
me to verify, not to deploy. **Say the word and it is one command.** Option A is
still worth doing afterwards so the config and the project stay in step.

## After the deploy

An index build is asynchronous. `cowork_tasks` is small, so expect minutes
rather than hours, and until the state reaches `READY`:

- a CEO's `/tasks` keeps showing "That didn't load"
- everyone else is unaffected — no other role issues this query

To confirm completion, re-run exactly what is above: the state must read
`READY` **and** the `approverId` query must return rows rather than
`FAILED_PRECONDITION`. I can re-verify both on request.

## Remaining issues

- **Root cause of the failed deploy is environmental**, not configuration: no
  CLI, no login. Worth installing `firebase-tools` as a devDependency so the
  deploy is available to anyone working in this repo rather than depending on a
  global install.
- The 16 deployed indexes include several this app never queries — `from`,
  `isDraft`, `sentAt`, `threadId`, `starredBy`, `participants`, `cc` — which
  belong to the mail and messaging features of the wider monolith sharing this
  Firestore project. They cost write throughput on every document in these
  collections. Not this migration's to clean up, but worth knowing the project
  is shared.
