# The legacy adapter layer

```
NEW COWORK UI  →  lib/legacy/*  →  Existing Firebase + Existing APIs + Existing DB
```

The legacy engine stays. This layer moves data between it and the new UI, and
**does not own a single business rule**. Deadline maths, scoring, SOP
accumulation and permission decisions all stay where they already work.

Reference: [`docs/legacy-system-map.md`](../../docs/legacy-system-map.md).

## Rules

1. **No component imports `firebase/*`.** One import site: `firebase.ts`. The
   legacy client imports Firebase in 61 files and writes to Firestore from 29 of
   them, which is why its rules are advisory — anything the browser reaches, the
   browser bypasses.
2. **Names and shapes are preserved on the wire.** Collections, fields and enum
   values are written exactly as legacy writes them. Renaming happens only at the
   TypeScript boundary, for the UI.
3. **No new business logic.** If a calculation exists in legacy, call it.
4. **Accept both spellings** wherever legacy has two.
5. **Query `biometricId`, never `employeeId`** — the latter is a Mongoose
   virtual and is not queryable.
6. **Nothing throws on an HTTP failure.** Every call returns `LegacyResult<T>`,
   a union the caller cannot forget to check.

## Two tokens, not one

| Routes | Auth | Token |
|---|---|---|
| `/cowork/*` | `verifyCoworkToken` | **Firebase ID token** |
| `/api/hr/*`, `/hr/*` | `EmployeeAuthMiddlewear` | **Self-issued JWT** (cookie `auth_token` or Bearer) |

Separate systems over separate identity stores. A Firebase token on an HR route
is rejected and vice versa — so HR functions take an `hrToken` parameter, named
differently on purpose.

⚠ `EmployeeAuthMiddlewear` falls back to a hard-coded secret when `JWT_SECRET`
is unset: `process.env.JWT_SECRET || "grav_clothing_secret_key"`. If the
deployment does not set it, HR tokens can be forged by anyone who has read the
repository.

## Modules

### `config.ts` — is the adapter configured
Reads `NEXT_PUBLIC_LEGACY_API_URL` and the six `NEXT_PUBLIC_FIREBASE_*`
variables. Refuses with the first missing name rather than half-building, so a
misconfiguration surfaces at startup instead of deep inside a request.

### `envelope.ts` — one shape from four
Legacy answers as `{employees:[...]}`, `{success,data}`, `{error}`, or bare.
`unwrap()` normalises. **`success:false` with HTTP 200 is a failure** — the trap
that otherwise shows "no employees" when the answer was "not allowed". Errors
carry a `kind` so a 403 does not get a retry button that cannot work.

### `wire.ts` — legacy's vocabulary, contained
The only module that knows legacy's field names. Pins the traps:
- `TERMINAL_STATUSES` transcribed verbatim from `taskForward.service.js:2200`,
  including that it checks `status` against values that otherwise live on
  `completionStatus`. Preserved wrong deliberately — the engine wins.
- Both live spellings of each rejection (`tl_rejected` / `rejected_by_tl`).
- **The credit/debit inversion.** `"credit"` = violation, `"debit"` = reward,
  `isCredit:true` maps to `"debit"`. Converted to signed points where positive
  is a penalty, matching `totalDeducted`'s direction so sums reproduce it.
- SOP entries spanning **all four** components, not just C3.
- Duplicated field names (`totalSecs`/`totalSeconds`, `windowSecs`/`winSecs`).
- `cowork_task_timers` is a **subcollection** — a flat query finds nothing.
- `cowork_duty_status` already implements the availability-delta model:
  `latenessMs`, `breakGapAppliedMs`, `pendingBreakGapMs`, `lastDeadlineShiftMs`.

### `firebase.ts` — authentication only
Named app `cowork-legacy`. Exports sign-in, sign-out, `idToken()`, `watchAuth()`.
**Deliberately does not export Firestore** — data goes through proxy routes that
hold the Admin credential and perform the authorisation legacy omits.

### `http.ts` — the one way to call the engine
| | |
|---|---|
| Collection/API | The legacy Express backend, all paths |
| Transformations | Envelope unwrapping, error classification, query building |
| Refuses | `force-repair-self-assign`, `self-assign-debug` — unauthenticated debug routes |

```ts
const r = await legacyFetch<Doc[]>({ path: "/cowork/employee/list",
                                     envelopeKey: "employees", token });
if (!r.ok) return <ErrorState error={r.error} />;
```

### `auth.ts` — identity (priority 1)
| | |
|---|---|
| API | `GET /cowork/me`, `POST /cowork/change-password` |
| Fields | `authUid`, `employeeId`, `role`, `name`, `passwordChanged` |
| Transformations | `role` → `LegacyRole` (unknown ⇒ `employee`); `passwordChanged:false` → `mustChangePassword`; `employeeId` branded `BiometricId` |

Three identities, one person:
```
Firebase uid → cowork_employees.employeeId → Employee.biometricId
                (Firestore, role)             (Mongo, HR/SOP)
```
**The third link can be missing** — see `employees.ts`.

`ROLE_CACHE_TTL_MS` / `ROLE_CHANGE_NOTICE`: the engine caches roles per process
for five minutes and never invalidates on update, so a role change is not
reliably in force until it expires. A UI that changes a role must say so.

```ts
const token = await idToken();
const me = await fetchIdentity(token!);
if (me.ok && me.data.mustChangePassword) redirect("/change-password");
```

### `permissions.ts` — legacy's three predicates (priority 1)
| | |
|---|---|
| Source | `Middlewear/coworkAuth.js` |
| Transformations | none — mirrors the engine |

`isCeo`, `isCeoOrTl`, `isAuthenticated`, `allows(gate, role)`,
`gateRefusal()` (legacy's exact strings: `"CEO only"`, `"CEO or TL only"`),
`tlSharesDepartment()` (the one real scope check, on `/sop/bleach`).

**This mirrors legacy rather than improving on it.** Using `lib/auth/can.ts`
here would hide controls the engine allows, or show ones it refuses. While
legacy is the source of truth, ask this module what the engine will do.

`UNGATED_LEGACY_ENDPOINTS` lists what the proxy must close:
`review-completion` (no authorisation — any employee can approve any task and
fire its score), `change-role` and `change-department` (authentication only —
privilege escalation).

### `employees.ts` — directory and hierarchy (priority 2)
| | |
|---|---|
| Collections | Firestore `cowork_employees`; Mongo `Employee.primaryManager` |
| APIs | `/cowork/employee/list` (CEO/TL), `/list-members` (everyone), `/:id`, `/my-managers/:employeeId` |
| Fields | `employeeId`, `name`, `email`, `mobile`, `department`, `role`, `profilePicUrl`, `authUid`, `passwordChanged` |
| Transformations | id falls back to the Firestore doc id (the CEO is seeded at `E000`); rows with no identifier are dropped; name falls back to id; `designation` falls back to `jobTitle` |

`inHrSystem: false` — the person exists in Cowork but has **no HR record**, so
no managers, department of record, attendance or SOP ledger. The engine reports
this as `success: true` with a message. Rendering it as "no managers" tells
somebody their reporting line is empty when their HR record is missing; those
need different words.

`directReports()` and `reportingChain()` work over a resolved list because
**legacy has no endpoint for either direction but upward**. Both use PRIMARY
lines only, and `reportingChain` **stops on a cycle** — legacy has no constraint
against cycles or self-reporting, so a trusting walker hangs the browser.

```ts
const list = isCeoOrTl(me.role)
  ? await listEmployees(token)      // full directory
  : await listMembers(token);       // what everyone may see
```

### `departments.ts` — departments and designations (priority 3)
| | |
|---|---|
| Collection | Mongo `Department` (nested `designations[].managers[]`) |
| APIs | `/api/hr/departments`, `/with-designations`, `/:id` — **HR token** |
| Transformations | `status` absent ⇒ active; designations reduced to `managerCount` |

The nested manager records are **not** the reporting hierarchy — that is
`employees.fetchHierarchy`. Surfacing them would give a second, conflicting
answer to "who manages whom".

`Employee` carries both `department` (string) and `departmentId` (ObjectId), and
the Firestore mirror carries only the string — so **the string is the join**.
`unknownDepartments()` reports drift; it never repairs it.

`allDesignations()` matters because **designation determines the scoring band**
(`BandConfig.getBandMaxForEmployee`), and the band determines an employee's
maximum score.

## Still to build

`tasks.ts`, `sop.ts`, `scoring.ts`, `attendance.ts`, `settings.ts`, and the
server-side proxy routes. Priority order 4–8.

`hr.ts` is deliberately **not** a module: HR is not one surface. Attendance,
leave and holidays go in `attendance.ts`; departments already have their own
module; employee records are `employees.ts`. A single `hr.ts` would be a
grab-bag spanning two auth systems and two databases.
