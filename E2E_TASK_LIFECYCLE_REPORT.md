# End-to-end task lifecycle — test plan and results

**Date:** 2026-07-29
**Verify:** lint clean · tsc clean · **900 tests, 0 failed** · production build compiled · secrets clean.

---

## 1 · Safe test plan — environment confirmed

Established by reading both halves' configuration and probing the running
services, not by assumption.

| Question | Answer | Evidence |
|---|---|---|
| Which Firebase project? | **`grav-cms-38f45`** | `NEXT_PUBLIC_FIREBASE_PROJECT_ID` (frontend) **and** the backend service account's `project_id` — the same project |
| Where is the legacy engine? | **Local**, `node server.js` on `:5050` | `NEXT_PUBLIC_LEGACY_API_URL=http://localhost:5050`; PID confirmed listening |
| Is there an emulator? | **No** | No `FIRESTORE_EMULATOR_HOST` / `FIREBASE_AUTH_EMULATOR` in either environment |
| **Do writes reach production Firestore?** | **YES** | `config/firebaseAdmin.js` initialises the Admin SDK with a `grav-cms-38f45` service account and no emulator. A local API server in front of a production database is still a production write |
| Do notifications fan out for real? | **Yes** | The same admin app exports `messaging` (FCM) against the live project |

**The important consequence:** "the backend is running locally" does **not** mean
sandboxed. There is no safe database here. Any lifecycle write — task creation,
priority change, completion, approval — lands in the live Firestore that the
running product reads, and approval writes real C1 scoring data about a real
person's quarter.

### Test-flow safety rules adopted

1. **Never touch an existing task.** Every mutation targets a task created by
   this test and no other.
2. **Unmistakably marked.** Title prefix `[TEST]` plus a run stamp, so it is
   identifiable in Firestore and in anybody's task list at a glance.
3. **Cleanup path confirmed before writing** — `deleteTask` is wired
   (`DELETE /cowork/task/:id`, probed live, see §2).
4. **Read-only reconnaissance first**, then one write at a time with
   verification between.

---

## 2 · What WAS verified — route reachability, no auth required

One link of the chain can be tested without a session, and it is the link that
silently rots: **does the path this app calls exist in the engine?** A 404 means
no route; a 401 means the route is there and wants credentials. Probed all 20
`/cowork/...` paths this repository calls against the running engine.

**19 of 20 answered 401 — route present.** One answered **404**.

### Defect found and fixed: `blocked-dates` called a dead route

| | |
|---|---|
| **Symptom** | `GET /cowork/deadline-availability/blocked-dates` → **404** |
| **Root cause** | The backend *does* define that route — in `routes/task_routes/deadlineAvailability.routes.js` — but **that file is never `require`d or mounted**. Dead code, exactly like `taskTree.routes.js`'s `/task/create` |
| **Live equivalent** | `GET /cowork/scheduling/blocked-dates` (`cowork.js:60`) → **401** |
| **Second bug underneath** | Different response shape. The live route returns `blockedDates` as an **object keyed by date**; `readBlockedDates` iterated it as an **array**, which yields nothing. Fixing the path alone would still have returned zero results |
| **Third difference** | Parameters: the live route takes `from`/`to` and 400s without both; the dead one took `fromDate` + a day count |
| **Impact** | Silent, and in the dangerous direction. A failed read meant *no blocked dates*, so the deadline picker offered dates on **public holidays and on somebody's approved leave**, and the engine accepted them |

This is a pre-existing defect, not one introduced this session — the wrong path
had been there as long as `fetchBlockedDates` has. It surfaced only because the
probe asked the engine instead of reading the source; a route declared in an
unmounted file is indistinguishable from a live one by grep, which is how it
survived.

**Regression cover added.** `lib/legacy/routesExist.test.ts` probes every called
path against the engine and fails on a 404. Building it surfaced four false
positives that are themselves worth recording, because each would have made the
test untrustworthy:

- `my-managers/:id` and `pmp/:id/dashboard` — a static mount-graph walk reported
  both as missing; both are live. The static approach was abandoned for probing.
- `change-password` (POST-only), `edit-details` (PATCH), task delete (DELETE) —
  404 to a GET is a fact about the probe, not the route. It now tries every verb
  and flags only when all of them 404.

---

## 3 · What was NOT tested — and why

**No lifecycle step was executed.** Nothing was written to Firestore. No task was
created, no priority changed, no timer started.

**Blocker: authentication.** The middleware bounced `/tasks` to `/signin`, and
the browser holds no `cowork_fb` cookie. Your credentials are autofilled in the
form, but authenticating as you with your password is not something I will do —
that needs your own click.

**Second blocker, for steps 3–6.** Employee confirm, timer start, pause/resume
and submit require the *assignee's* authenticated session. I checked whether the
dev profile switcher could stand in: it cannot, deliberately — `setActingId()` is
inert against the legacy backend so it "cannot silently act as somebody the token
does not authorise" (`lib/repositories/legacy/index.ts:3284`). That is a safety
property, not an obstacle to route around.

**Third blocker, for independent verification.**
`LEGACY_FIREBASE_SERVICE_ACCOUNT` is commented out (`.env.local:93`), so I cannot
read Firestore server-side to confirm a mutation landed. Verification would have
to come from the app's own reads — weaker evidence, because a read broken the
same way as its write shows agreement rather than truth.

### Status against the ten requested steps

| # | Step | Status |
|---|---|:--|
| 1 | Manager creates task | **Not run** — blocked on sign-in |
| 2 | Employee receives | **Not run** |
| 3 | Employee accepts/confirms | **Not run** — needs assignee session |
| 4 | Start timer | **Not run** — needs assignee session |
| 5 | Pause/resume | **Not run** — needs assignee session |
| 6 | Submit completion | **Not run** — needs assignee session |
| 7 | Manager reviews | **Not run** — needs a submission from step 6 |
| 8 | Approve/reject | **Not run** |
| 9 | Priority change | **Not run** |
| 10 | Deadline negotiation | **Not run** |

Route reachability for the endpoints behind steps 1–10 **is** confirmed (§2):
create, confirm, start, submit-completion, review-completion, approve-deadline,
propose-deadline, tl-counter-deadline, respond-tl-counter,
request-deadline-extension, review-deadline-extension, subtask, chat,
department-tl-set-hours — all 401, all present.

---

## 4 · Files changed

| File | Change |
|---|---|
| `lib/legacy/attendance.ts` | **Root-cause fix.** `fetchBlockedDates` now calls `/cowork/scheduling/blocked-dates` with `from`/`to`; `readBlockedDates` reads the object-keyed-by-date shape, keeping array support for the build that sends one |
| `lib/repositories/legacy/index.ts` | `listBlockedDates` passes the date range straight through instead of deriving a day count for the dead route |
| `lib/legacy/routesExist.test.ts` | **New.** Probes every called `/cowork` path against the running engine; fails on 404. Skips cleanly when no engine is listening |
| `lib/legacy/modules.test.ts` | Three tests for the corrected response shape — object form, array form, and empty |

No UI file was touched: the fault was in the data layer, and patching a screen
would have hidden it.

---

## 5 · Remaining blockers

1. **Sign in as the manager** — your click, at `localhost:3000/signin`.
2. **Assignee session for steps 3–6** — either the colleague signs in on this
   machine when we reach step 3, or we re-scope to a self-assigned task, where I
   can drive 1–6 and 9–10 and record 7–8 as legacy's correct self-approval
   refusal (defect P1).
3. **Optional but valuable:** set `LEGACY_FIREBASE_SERVICE_ACCOUNT` so mutations
   can be confirmed in Firestore independently of the app's own reads.

Once (1) is done I can execute steps 1, 9 and 10 immediately, and verify step 2
at the data level, marking the `[TEST]` task for cleanup afterwards.
