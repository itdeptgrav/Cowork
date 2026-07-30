# Task module — lifecycle verification report

**Date:** 2026-07-29
**Verify:** `npm run verify` exit 0 — lint clean, tsc clean, **894 tests**, production build compiled, `check-secrets` clean.

---

## 1 · What the audit found

The Change Priority modal was one symptom of **29 unconnected repository
methods** in the task module. `toCoworkRepository` substitutes a throwing stub
for any interface method `LegacyRepository` does not define, so the message
people saw — *"changePriority is not connected to the Cowork engine yet"* — was
the proxy announcing a gap, not a sentence anybody wrote for a screen.

The audit was done mechanically rather than by grep, because a name-based search
misses exactly the cases that matter: enumerate the 191 methods
`CoworkRepository` declares, enumerate what `LegacyRepository` defines, diff, and
intersect with what the task module actually calls.

| | Before | After |
|---|---:|---:|
| Task-module methods reaching a throwing stub | **29** | **0** |
| Connected to a real legacy source | 0 | **24** |
| Intentionally unavailable, explained in product language | 0 | **5** |

`lib/repositories/legacy/taskActions.test.ts` now runs that same diff as a test,
so the gap cannot silently reopen.

---

## 2 · Action-by-action

### Task creation

| Action | Connected? | Backend source | Tested? |
|---|:--:|---|:--:|
| Create task | ✅ | `POST /cowork/task/create` | ✅ |
| Create subtask | ✅ **new** | `POST /cowork/task/:id/subtask` | ✅ |
| Assignee picker | ✅ | `/employee/list-members` + assignment gates | ✅ |
| Departments | ✅ **new** | Derived from `cowork_employees.department` — legacy has no department entity; every join in the engine is a string comparison on this field | ✅ |
| Hierarchy validation | ✅ | `my-managers` closure → `assignmentRelationship` | ✅ |

### Assignment lifecycle

| Action | Connected? | Backend source | Tested? |
|---|:--:|---|:--:|
| Confirm receipt | ✅ | `POST /cowork/task/:id/confirm` | ✅ |
| Start work | ✅ | `POST /cowork/task/:id/start` | ✅ |
| Manager sees state | ✅ | `cowork_tasks` via `onSnapshot` | ✅ |
| Effort estimate (cross-dept) | ✅ **new** | `POST /cowork/task/:id/department-tl-set-hours` | ✅ |
| Reassignment | ⛔ | **Legacy removed forwarding** (D33). Subtasks replace it — `createSubtask` is connected | ✅ |

### Deadline lifecycle

| Action | Connected? | Backend source | Tested? |
|---|:--:|---|:--:|
| Propose deadline | ✅ | `POST /cowork/task/:id/propose-deadline` | ✅ |
| Accept assignor window | ✅ | `POST /cowork/task/:id/approve-sender-timer` | ✅ |
| Reject assignor window | ✅ | `POST /cowork/task/:id/reject-sender-timer` | ✅ |
| Manager approve/reject | ✅ | `POST /cowork/task/:id/approve-deadline` | ✅ |
| Manager counter-proposes | ✅ **new** | `POST /cowork/task/:id/tl-counter-deadline` | ✅ |
| Employee answers counter | ✅ **new** | `POST /cowork/task/:id/respond-tl-counter` | ✅ |
| Request extension | ✅ **new** | `POST /cowork/task/:id/request-deadline-extension` | ✅ |
| Decide extension | ✅ **new** | `POST /cowork/task/:id/review-deadline-extension` | ✅ |
| History | ✅ **new** | `cowork_tasks.deadlineHistory[]` — **two shapes**, both read | ✅ |
| Blocked dates | ✅ **new** | `GET /cowork/deadline-availability/blocked-dates` | ✅ |
| Waive the deduction | ⛔ | Separate route (`extension-deduction`), not wired. The decide call **refuses** rather than silently dropping the waiver | ✅ |

Two traps are pinned by tests: `request-deadline-extension` **400s without
`proposedDate` and derives nothing from a window**, and `respond-tl-counter`
tests `typeof accepted !== "boolean"` rather than coercing.

### Priority lifecycle — the reported fault

| Requirement | Status | How |
|---|:--:|---|
| Calls the real engine mutation | ✅ | **There is no priority route.** `PERMISSIONS_AND_ROLES_SPEC.md` §2 records it as *"none — client-side Firestore write"* (defect P6). The contract is the document shape, and it now matches `page.js:1806-1811` field for field |
| Updates task ordering | ✅ | `priority` (clamped 1–10, legacy's own clamp) + `order = (idx+1) * 1000` on reorder |
| Per-person ranks preserved | ✅ | `assigneePriorities.{employeeId}` written with **dot notation** via `updateDoc`. Writing the map whole would erase every other assignee's rank — legacy's own comment says the dot form "leaves other employees' priorities untouched" |
| Reason recorded | ⛔ | **`cowork_tasks` has no field for it and legacy never captured one.** See §3 |
| Affected users shown | ⛔ | Returns `null` rather than a fabricated cascade. See §3 |
| Audit/history | ⛔ | `listPriorityChanges` **throws** rather than returning `[]`. See §3 |
| Instant UI update | ✅ | `notifyRepositoryChanged()` on success, ahead of the `onSnapshot` |
| No local-only state | ✅ | Every write goes to `cowork_tasks`; nothing is held in a component |

### Timer lifecycle

| Action | Connected? | Backend source | Tested? |
|---|:--:|---|:--:|
| Start | ✅ | `cowork_task_timers/{emp}/sessions/{task}` — **no REST endpoint exists**; this is the documented exception | ✅ |
| Pause | ✅ | Same, banking `totalSeconds + floor((now - lastStartTime)/1000)` | ✅ |
| Resume | ✅ | **Not a separate operation** — starting a task with accumulated seconds continues from that total, which is what resuming is. A `resumeTimer` would be a second timer system | ✅ |
| Read one task's session | ✅ **new** | `getTimer` — was missing, and `TimerControl` calls it for **every row it renders** | ✅ |
| Active timer | ✅ | Same subcollection | ✅ |
| Switching tasks pauses previous | ✅ | `switched_task`, matching `useTaskTimer:219-225` | ✅ |
| Offline restriction | ✅ | `presenceWriteRefusal` **inside `startTimer`**, before the write | ✅ |

No second timer system: one subcollection, one event log, legacy's field names.

### Completion lifecycle

| Action | Connected? | Backend source | Tested? |
|---|:--:|---|:--:|
| Submit completion | ✅ | `POST /cowork/task/:id/submit-completion` | ✅ |
| Owner review | ✅ | `POST /cowork/task/:id/review-completion` | ✅ |
| CEO final review | ✅ | `POST /cowork/task/:id/ceo-review` | ✅ |
| Read submission | ✅ **new** | `cowork_tasks.completionSubmission` — **one record**; legacy overwrites on resubmission | ✅ |
| Read reviews | ✅ **new** | `tlReview` / `ceoReview` — two named slots, not a list | ✅ |
| Rework requests | ✅ **new** | Derived from rejections; a rejection **is** the rework request in legacy | ✅ |
| Comments (task thread) | ✅ **new** | `POST /cowork/task/:id/chat`; read from `cowork_tasks/{id}/chat` **subcollection** | ✅ |
| Work commits | ✅ **new** | `cowork_work_commits` | ✅ |
| Daily reports | ✅ **new** | `cowork_tasks/{id}/dailyReports` subcollection | ✅ |
| Draft thread | ⛔ | Separate legacy route. **Refuses** rather than posting to the main thread, which would put a private note in front of everyone on the task | ✅ |

### Inbox, emergency, permissions, presence

| Action | Connected? | Backend source | Tested? |
|---|:--:|---|:--:|
| Action inbox | ✅ **new** | `actionableFor` over `listTasks` — one resolver, repository-side | ✅ |
| Emergency requests | ✅ **new** | `cowork_emergency_approvals` (browser-written, no route) | ✅ |
| Decide emergency | ✅ **new** | Same collection. Does **not** move deadlines — the employee's own client applies `pendingEmergencyGapMs` on next online, so doing it here too would shift twice | ✅ |
| Role permissions | ✅ | `lib/auth/systemRoles.ts` — CEO / TL / Employee via the mapping fixed earlier. Not bypassed anywhere | ✅ |
| Offline restrictions | ✅ | `presenceRefusal` at banner, control **and** write | ✅ |

---

## 3 · Intentionally unavailable — and why

Five methods have nothing behind them. **None is unfinished wiring**: the engine
has no field, collection or route for any of them. They no longer reach the
proxy, so the sentence a reader gets is about the product rather than about our
build.

| Concept | Why absent | What a user sees |
|---|---|---|
| Priority **reason** and **history** | `cowork_tasks` has no field; legacy never captured one. Spec P6 proposes adding it | History panel states the engine keeps no priority audit trail |
| Priority **cascade** | Legacy computes none. `listPendingAcknowledgements` is empty, so the gate never fires | Unreachable; the button would say the engine records no cascades |
| Task **event log** | No `cowork_task_events` collection exists. What legacy does keep is in `deadlineHistory[]` and the thread's system messages | Points at those two, rather than claiming nothing happened |
| **Attachments** as records | Legacy stores files as URLs inline on the message or submission that carries them | Empty id list returns empty — the caller already holds the URL |
| Subtask **requirements** | New-product concept, no legacy field | "Break the work out as a subtask instead" — and `createSubtask` works |

**Why the priority audit is left absent rather than improvised.** Recording the
reason would mean writing a field the engine does not read. That is defensible
for presence — the old app ignores unknown keys and the data is ours — but not
here: priority is scored, and an audit trail only this app can see is worse than
an acknowledged absence, because it looks complete while the old app keeps
changing ranks without it. `listPriorityChanges` therefore **throws** rather than
returning `[]`: an empty list is the claim *"this task's priority has never been
changed"*, and that is false for every task the old app has ever reordered.

---

## 4 · Architecture rules — held

- ❌ No new task engine — every write is a legacy route or legacy's own Firestore document
- ❌ No new task statuses — `ALL_STATUSES` unchanged
- ❌ No duplicate collections — `cowork_tasks`, `cowork_task_timers`, `cowork_work_commits`, `cowork_emergency_approvals`, and the `chat` / `dailyReports` subcollections are all legacy's
- ❌ No backend rebuilt
- ✅ Reads follow the existing Firestore patterns, writes the existing mutation patterns, with the timer and the three browser-written collections as legacy's own documented exceptions

---

## 5 · What is NOT verified

Everything above is verified by types, lint, 894 tests and a production build.
**None of it has been exercised against live production data in a browser.**

The tests that cover the new wiring are source-level and contract-level: they
prove the right endpoint is called with the right payload, and that the document
shapes match legacy's field for field. They cannot prove the engine accepts a
given call today.

Highest-risk items to exercise first, because they write to shared documents the
old app also reads:

1. **Change Priority** on a task with two assignees — confirm the other
   assignee's rank in `assigneePriorities` is untouched
2. **Reorder** a queue — confirm `order` strides by 1000 and the old app agrees
3. **Counter a deadline**, then answer it — the two-step the panel now offers
4. **Request an extension** without a date — confirm the local refusal names the
   field rather than surfacing a bare 400
5. **Submit → review → reject** — confirm `tlReview` populates and the rework
   request derives from it
