# Vertical Slice Validation — Employee Identity

The first end-to-end flow: **login → current user → profile → department →
hierarchy → permissions.**

## Status: PASS — owner-verified 2026-07-28

Environment configured, Firebase live, backend reachable and accepting tokens.
The one skipped check is Firestore, which needs
`LEGACY_FIREBASE_SERVICE_ACCOUNT` and is only required for writes.

**Provenance.** The comparison was run by the owner at `/legacy/validate`, which
fetches each endpoint raw, maps it through the adapter and reports a verdict per
check. The owner reported the suite passing. I did not observe the output
myself — no assistant session holds the Firebase token — so these rows record a
reported pass, not one I measured. Anything that later contradicts them should
be trusted over this page.

| Feature | Source | Status |
|---|---|---|
| Employee identity | `GET /cowork/me` | **PASS** |
| Employee profile | `GET /cowork/employee/:id` | **PASS** |
| Department | `cowork_employees.department` | **PASS** |
| Reporting hierarchy | `GET /cowork/employee/my-managers/:id` | **PASS** |
| Directory | `GET /cowork/employee/list` \| `/list-members` | **PASS** |
| Role permissions | `permissions.ts` vs `coworkAuth.js` | **PASS** (one role) |
| Firestore | proxy | **SKIPPED** — service account not set |

**Still only one role proven.** `accessSummary()` was evaluated against the
signed-in account. Confirming the other two columns needs a `ceo`, a `tl` and an
`employee` account, and it matters most before SOP and scoring, where the gates
actually bite.

Environment gate at first check (2026-07-28, superseded): 7 of 7 variables
missing. Now configured — see [`legacy-environment-setup.md`](legacy-environment-setup.md).

---

## Feature: Employee Identity

**Source** — Firebase Auth → `GET /cowork/me`

**Legacy response** (from `routes/task_routes/cowork.js`):
```json
{ "authUid": "...", "employeeId": "E001", "role": "tl",
  "name": "…", "tempPassword": null, "passwordChanged": true }
```

**Adapter transformation** — `auth.readIdentity()`
- `employeeId` → branded `BiometricId` (it is also the HR join key)
- `role` → `LegacyRole`; anything unrecognised becomes `employee`, matching the
  engine's own fallthrough
- `passwordChanged: false` → `mustChangePassword: true`

**New UI output** — `/legacy`: name, employee ID, role.

**Status: PENDING** — needs a real sign-in.

---

## Feature: Employee Profile

**Source** — `GET /cowork/employee/:id` *(envelope key `employee` is **inferred**)*

**Legacy response** — a `cowork_employees` document. `createCoworkEmployee`
writes `employeeId`, `authUid`, `role`, `profilePicUrl`, `fcmTokens`,
`passwordChanged`, `createdAt`, plus `name`, `email`, `mobile`, `city`,
`department` from the request body.

**Adapter transformation** — `employees.readEmployee()`
- `employeeId` falls back to the Firestore document id (the CEO is seeded at
  `E000`, where the two are equal)
- a row with neither is **dropped**, not rendered as a person with no identity
- `name` falls back to the id rather than rendering blank
- `passwordChanged: false` → `pendingFirstSignIn`

**New UI output** — `/legacy/people`: name, email, employee ID.

**Status: PENDING** — and the envelope key is the specific risk. If `employee`
is wrong the profile silently renders empty rather than erroring.

---

## Feature: Department

**Source** — `cowork_employees.department` (a plain string)

**Adapter transformation** — trimmed; empty becomes `null`.

**New UI output** — a column, plus a per-department count on
`/legacy/people`.

**Note.** The count is derived from **the people in the directory**, not from
the HR department master (`GET /api/hr/departments`). Those answer different
questions, and the gap between them is real data drift — `Employee` carries both
`department` (string) and `departmentId` (ObjectId) while the Firestore mirror
carries only the string, so the join is a free-text match.
`departments.unknownDepartments()` reports the drift and never repairs it.

**Status: PENDING**

---

## Feature: Reporting Hierarchy

**Source** — `GET /cowork/employee/my-managers/:employeeId`, which bridges to
MongoDB by `biometricId`

**Legacy response**:
```json
{ "success": true,
  "primaryManager": { "name": "…", "biometricId": "…", "department": "…",
                      "designation": "…", "jobTitle": "…", "email": "…" },
  "secondaryManager": null }
```
and, for somebody absent from HR:
```json
{ "success": true, "primaryManager": null,
  "message": "Employee not found in HR system" }
```

**Adapter transformation** — `employees.readHierarchy()`
- a manager without `biometricId` is discarded
- `designation` falls back to `jobTitle`
- the message is matched against `/not found in hr/i` → `inHrSystem: false`

**New UI output** — `/legacy` shows "Reports to" and "Also reports to". A
person with no HR record gets a distinct empty state, **not** "no managers".

**Status: PENDING** — and one check matters more than the rest: **the message
wording is the only signal the engine gives.** If it has changed, a missing HR
record silently becomes "no manager".

---

## Feature: Role Permissions

**Source** — `Middlewear/coworkAuth.js`, transcribed:
```js
verifyCeoToken      → role === "ceo"
verifyCeoOrTL       → ["ceo","tl"].includes(role)
verifyEmployeeToken → req.coworkUser exists
```

**Adapter transformation** — `permissions.ts` mirrors these exactly. It does
**not** use the new project's richer `lib/auth/can.ts`: while legacy is the
engine, a richer model would hide controls the engine allows or show ones it
refuses. Refusal strings are legacy's own — `"CEO only"`, `"CEO or TL only"` —
so the page and the network say the same sentence.

**New UI output** — `/legacy` lists twelve surfaces with Allowed / No.

**Status: PENDING** — needs one account per role (`ceo`, `tl`, `employee`);
one account only proves one column.

---

## Fields the directory cannot supply

Step 4 asked for designation, reporting manager and status in the employee list.
**Legacy does not hold the first and third in the Cowork directory at all**, and
holds the second only one person at a time.

| Field | Where it lives | Why not in the list |
|---|---|---|
| Designation | `Employee.designation` (Mongo) | HR API — **different token** (JWT, not Firebase) |
| Employment status | `Employee.status` / `isActive` (Mongo) | same |
| Reporting manager | `Employee.primaryManager` (Mongo) | `my-managers` is **one call per employee**; legacy has no bulk equivalent |

Rather than invent them or drop the columns silently, the screen marks them
**explicitly unavailable and names the source**. A blank cell reads as "none"; a
named absence reads as "not here", and only one of those is true.

The one lifecycle state the Cowork directory genuinely knows is
`passwordChanged: false` — first sign-in not completed. It is shown as
"Not signed in yet" and deliberately **not** called *status*: conflating it with
`Employee.status` would report somebody as inactive because they had not yet
changed a temporary password.

Supplying the three properly needs either the HR JWT alongside the Firebase
token, or N+1 requests. Both are decisions, not omissions.

---

## Step 5 · Field-by-field verification

Fill in when connected. **Any mismatch is an adapter bug** — legacy is correct
by definition.

| Field | Legacy source | Adapter | UI | Match? |
|---|---|---|---|---|
| Name | `cowork_employees.name` | `LegacyEmployee.name` | People, row 1 | ☐ |
| Employee ID | `cowork_employees.employeeId` | `.employeeId` | People, col 2 | ☐ |
| Email | `cowork_employees.email` | `.email` | under the name | ☐ |
| Department | `cowork_employees.department` | `.department` | col 3 | ☐ |
| Role | `cowork_employees.role` | `.role` | col 4 | ☐ |
| First sign-in | `passwordChanged` | `.pendingFirstSignIn` | col 5 | ☐ |
| Directory count | legacy `/coworking` list | `rows.length` | header | ☐ |
| Reports to | `primaryManager.name` | `.primaryManager` | `/legacy` | ☐ |
| No HR record | `"…not found in HR system"` | `inHrSystem: false` | empty state | ☐ |
| Access — CEO | `verifyCeoToken` | `isCeo()` | access list | ☐ |
| Access — TL | `verifyCeoOrTL` | `isCeoOrTl()` | access list | ☐ |

## Highest-risk assumptions in this slice

1. **`GET /cowork/employee/:id` envelope key `employee`** — inferred. Wrong ⇒
   the profile renders empty with no error.
2. **`GET /cowork/employee/list-members` key `employees`** — inferred. Wrong ⇒
   ordinary employees see an empty directory while CEO/TL see a full one, which
   looks like a permission feature rather than a bug.
3. **The "not found in HR system" wording** — the only signal for a missing HR
   record.

`GET /cowork/employee/list` (key `employees`) and `GET /cowork/me` (bare) are
**read from source**, not inferred, which is why the directory list is the
safest thing in the slice to have built first.

## Success criteria

> A real employee can log in and see their actual company information from the
> legacy system inside the new Cowork UI without mock data.

**Not met.** Code path complete; no credentials, so no real employee has logged
in. When the seven variables are set, this document is the checklist.

## Step 3 · Mock replacement — scope

Migrated to the adapter, on new routes:

| Screen | Source |
|---|---|
| `/legacy` | `legacy/session`, `legacy/profile` |
| `/legacy/health` | `legacy/health` |
| `/legacy/people` | `legacy/directory` |

**No existing screen changed.** `/people`, `/team` and the rest still read the
mock repository, and `SessionProvider` still serves them. The new screens sit
beside the old ones rather than replacing them — swapping a route before its
replacement has been verified would remove a working screen and leave an
unverified one in its place. The swap happens per screen, after its rows above
read PASS.
