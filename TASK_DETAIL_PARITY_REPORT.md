# Task detail — parity report

Verify: **exit 0, 705 tests** (699 before).

## Root cause

**`getTask` was never implemented on `LegacyRepository`.**

The repository proxy substitutes a throwing function for any method the legacy
repository does not define (`index.ts` — `toCoworkRepository`), so every detail
page failed identically, for every task id, from the moment the app was pointed
at the engine. Proven rather than inferred:

```
THREW: NotConnectedError | getTask is not connected to the Cowork engine yet.
```

`getSubtasks` was missing for the same reason.

This is the third instance of one pattern: `listAssignableEmployees` emptied the
assignee picker, and before that `listScoreHistory` returned a hardcoded `[]`.
An unimplemented method does not announce itself at the call site — it looks
like absent data.

## There is no ID mismatch

The report suspected `task.id` vs `task.taskId` vs a document id. Checked
against the real T620 in production:

```
T620 exists: true
  docId === taskId : true | taskId field: T620
```

`taskForward.service.js:378` writes with `.doc(taskId).set(task)`, so the
Firestore document id, the `taskId` field and the `:taskId` route parameter are
**the same string by construction**. `#taskDocuments` attaches `id: d.id` and
`#readTaskView` looks up that same string. Nothing renames anything.

| Claim in the report | Finding |
|---|---|
| Cards navigate with a wrong identifier | ❌ No — `view.task.id` is the document id |
| URL parameter does not match backend | ❌ No — identical strings |
| List mapping renames fields | ❌ No |
| Detail query inconsistent with list query | ❌ No — the detail query did not exist |

## Old vs new

| | Old Cowork | New Cowork |
|---|---|---|
| Route | `/coworking/tasks` with a selected task in page state | `/tasks/[taskId]` |
| Fetch | already-loaded Firestore listener document, or `getFullTask(taskId)` → `GET /cowork/task/:taskId/details` | `getDoc(cowork_tasks/{taskId})` |
| Identifier | `taskId` (= document id) | same |

New Cowork reads the document directly rather than calling `/details`,
consistent with how the list reads: legacy's visibility lives in its queries,
and the detail page is reached only from a list that already applied them.

## Files changed

| File | Change |
|---|---|
| `lib/repositories/legacy/index.ts` | `getTask` (reuses `#readTaskView`), `getSubtasks` (reads `subtaskIds` off the raw document) |
| `components/features/tasks/TaskDetail.tsx` | error handling separated from absence; failure logged |
| `lib/repositories/legacy/taskDetail.test.ts` | new — 6 tests |

`getSubtasks` reads `subtaskIds` rather than querying
`where("parentTaskId","==",id)`: the array is what the engine maintains and the
rest of the code reads, and a query would need another composite index and
could disagree with it. A child id naming a deleted task is skipped, so one
stale entry cannot empty the list.

## Error handling (item 5)

"Task not found — it may have been deleted" now appears **only** when the
request completed, did not error, and returned null. A failed or unwired read
gets its own state:

- `isUnavailable` → "Not available yet", no retry offered (retrying cannot help)
- any other error → "Could not open this task", with a retry
- both are `console.error`'d with the task id, because the on-screen copy is
  deliberately short and the underlying message is what a developer needs

Telling somebody their work may have been deleted when it is sitting in the
database is the worst available failure mode, and it was the one on screen.

## Tests added

6, including two that pin the shape of the fix rather than just its effect:

- `getTask`/`getSubtasks` are present, so the proxy no longer intercepts them
- **an unimplemented method still throws** — the fix was implementing the
  method, not softening the proxy into resolving null, which would have turned
  every future gap into a silent "not found"
- list id === detail id, end to end through `readTask` → `toTaskView`
- `readTask` returns null without `id`, pinning the loader's `id: d.id` as
  load-bearing
- a task with no resolvable assignees still renders, with `myRank: null` rather
  than a fabricated P1
- `subtaskIds` filtering drops empty and non-string entries

## One thing worth your attention

T620 has `assigneeIds: ["GR0002"]` and `assignedBy: "E000"` — neither is
GR0045. On the role queries (`assignedBy == me`, `assigneeIds array-contains
me`, `approverId == me`, plus the department-gate query, and its status is
`open`) **T620 should not appear in GR0045's list at all.**

Either you were signed in as another account, or a list is showing more than
its queries should. I could not tell which from here. If you saw T620 in your
own list while signed in as GR0045, say so — that is a visibility bug worth
chasing separately, and it is the opposite of the one you reported.

## Not verified

The end-to-end pass — open the list, click a task, confirm the detail loads the
same task — needs a browser session with a Firebase token. The identifier
invariant and the method wiring are covered by tests; the render is not.
