# Authentication and Permissions Audit

Read-only audit. Nothing here is a recommendation to copy — several items are
recorded specifically so the rebuild asserts the opposite.

## Two authentication systems in one backend

| | Cowork + SOP | HR + Employee self-service |
|---|---|---|
| Mechanism | **Firebase Auth ID token** | **Self-issued JWT** |
| Verified by | `Middlewear/coworkAuth.js` → `auth.verifyIdToken()` | `jsonwebtoken` + `bcryptjs` |
| Identity store | Firestore `cowork_employees` | Mongo `Employee` |
| Transport | `Authorization: Bearer` | Cookie `employee_token`, Bearer fallback, manual cookie parse |
| Login route | Firebase client SDK (browser) | `routes/Employee_Routes/login.js` |

A person therefore has **two credentials and two identity records**, joined by
`biometricId === employeeId`. Signing out of one does not sign out of the other.

## Middleware usage across Cowork/HR/SOP routes

| Middleware | Uses |
|---|---:|
| `verifyCoworkToken` | 237 |
| `verifyEmployeeToken` | 181 |
| `verifyCeoOrTL` | 36 |
| `verifyCeoToken` | 30 |
| `verifyHRToken` | 26 |

`verifyCoworkToken` and `verifyEmployeeToken` are stacked on most routes —
authentication twice, authorisation zero times. **Role checks appear on 92 of
~470 in-scope endpoints.** The rest authenticate and then trust.

## `verifyCoworkToken` in detail

`Middlewear/coworkAuth.js`:

1. Requires `Authorization: Bearer <firebase-id-token>`; else 401.
2. `auth.verifyIdToken()`.
3. **In-memory cache keyed by `uid`, 5-minute TTL.** On hit, Firestore is skipped
   entirely.
4. On miss, looks up `cowork_employees` by `authUid`, then falls back to `email`.
5. If still absent and the Firebase custom claim `role === "ceo"`, it
   **creates employee `E000` on the fly** with `department: "Management"`,
   `role: "ceo"`, and writes it to Firestore.
6. Otherwise 403.
7. Back-fills `authUid` onto the employee document when missing.

Four problems, each of which the new architecture must not reproduce:

- **The 5-minute cache is a stale-permission window.** Deactivating somebody or
  demoting them takes effect up to five minutes later, per server process, with
  no invalidation on write (`invalidateEmployeeCache` exists but is not called
  from the employee-update paths).
- **The cache is per-process in-memory** — inconsistent across instances.
- **Auto-provisioning a CEO from a custom claim is privilege creation inside an
  authentication middleware.** Whoever can set that claim can mint the highest
  role in the product.
- **Email fallback matching** means a re-used address inherits an identity.

## Roles

Effectively three, as string literals compared inline: `ceo`, `tl` (team lead),
`employee`. Counted across Cowork routes: `tl` 57, `ceo` 51, `employee` 19.
Plus `verifyHRToken` for HR staff.

There is **no permission model** — no capability list, no scope, no matrix.
Authorisation is a string comparison against a role at each call site, and only
where somebody remembered to write one.

## Passwords

`routes/Employee_Routes/login.js`:

```js
// Default password = employee's mobile number
const generateDefaultPassword = (phone) => phone?.trim() ?? null;
```

**The default password is the employee's mobile number** — a value stored in the
same record, visible in the HR UI, and usually known to colleagues. There is no
forced rotation on first login in this path.

Storage is bcrypt, which is fine. `temporaryPassword` is a second field on
`Employee`.

**Do not port.** The new project already uses scrypt with HMAC-signed HTTP-only
cookies and an invite-redemption flow.

## Endpoints with no authorisation at all

| Endpoint | Impact |
|---|---|
| `POST /cowork/task/:id/review-completion` | Any authenticated employee may approve or reject **any** task and fire its C1 score |
| `POST /cowork/force-repair-self-assign` | No auth middleware. Full-collection scan-and-write |
| `GET /cowork/self-assign-debug/:employeeId` | No auth middleware. Reads any employee |

## The real boundary is missing

Because the frontend performs **151 direct Firestore writes**, the effective
permission boundary for most Cowork data is **Firestore security rules** — and
those rules are in neither repository.

Until they are produced, no statement of the form "legacy allowed X" can be
verified for anything the browser writes: tasks, priority, timers, duty status,
messages, groups, requests. **This is the single largest blocking unknown in the
audit.** It does not block the rebuild — the new model is stricter by
construction — but it blocks any claim of behavioural parity, and it blocks
knowing what data an attacker could already have altered.

## Organisation isolation

None. See [LEGACY_DATABASE_SCHEMA.md](LEGACY_DATABASE_SCHEMA.md) — the concept
does not exist outside the accounting product. Every Cowork and HR query is
implicitly global.

## Committed secrets

`services/BiometricSyncService.js:8-10` contains eTimeOffice credentials in
plain text, committed. **Rotate them regardless of whether the migration
proceeds.** A repository copy on any developer machine carries them.

A scan for other committed credentials was not performed as part of this pass and
should be, before either legacy repo is archived or shared.

## What the new project already does instead

Recorded so Phase 3 is understood as *finishing* rather than starting:

| Legacy | New |
|---|---|
| Two auth systems | One — `lib/server/session.ts`, scrypt + HMAC-signed HTTP-only cookies |
| Role string compared inline | `lib/auth/can.ts` — capabilities × scopes × administrative floor |
| 5-minute permission cache | No cache |
| No tenant | `organisationId` on Tier-A entities; acting context in the repository |
| Default password = mobile | Invite redemption, `/api/auth/redeem` |
| No audit | Append-only event logs |

The honest gap: **30 `#deny()` calls run client-side in the mock repository
against a single real server route.** Phase 3 is where that inverts.
