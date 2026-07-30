# Legacy Environment Setup

How to point the new Cowork UI at the existing Cowork engine.

Nothing here changes the legacy system. Every value already exists — the task is
finding where it lives and copying it.

Check your work at **`/legacy/health`**, which reports `CONNECTED`,
`FAILED` or `NOT CONFIGURED` with the exact reason.

## The two systems you are connecting to

Legacy authenticates **two different ways**, and the adapter needs both.

| Routes | Middleware | Credential |
|---|---|---|
| `/cowork/*` | `verifyCoworkToken` | **Firebase ID token** |
| `/api/hr/*`, `/hr/*` | `EmployeeAuthMiddlewear` | **Self-issued JWT** (cookie `auth_token`) |

The Firebase half covers identity, employees, tasks, SOP and scores. The JWT
half covers departments, attendance, leave and policies. A token from one is
rejected by the other.

## Required variables

Copy `.env.example` to `.env.local` and fill these in.

### `NEXT_PUBLIC_LEGACY_API_URL`

The base URL of the running legacy Express backend — the same value the legacy
frontend uses as `NEXT_PUBLIC_API_URL`.

**The production value is `https://grav-cms-backend.onrender.com`.**

**How it was found, and why nowhere else worked.** It is in *neither repository*
— the frontend only ever reads `process.env.NEXT_PUBLIC_API_URL` with a
`http://localhost:5000` fallback, and there are no deployment files. But
`NEXT_PUBLIC_*` values are **compiled into the JavaScript at build time**, so
the deployed app is the authoritative record: the URL appears 15 times in the
chunks served from `https://cowork.grav.in/coworking`, always with
`Bearer ${idToken}` on `/cowork/*` paths.

**Verified:** `GET /cowork/me` unauthenticated returns
`401 {"error":"Missing token"}` — byte-for-byte what `Middlewear/coworkAuth.js`
sends.

> Render free instances sleep when idle, so the first request after a quiet
> period can take 30–60 seconds. A timeout on first load is not a failure.

No trailing slash needed — the adapter normalises it either way.

### The six `NEXT_PUBLIC_FIREBASE_*` values

```
NEXT_PUBLIC_FIREBASE_API_KEY
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN
NEXT_PUBLIC_FIREBASE_PROJECT_ID
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID
NEXT_PUBLIC_FIREBASE_APP_ID
```

**Where to find them:** the legacy frontend reads exactly these names in
`lib/firebase.js`, all from its environment with no inline fallback. Take them
from that deployment, or from the Firebase console under
**Project settings → Your apps → Web app → SDK setup and configuration**.

**Which project:** the legacy backend's `config/firebaseAdmin.js` carries a
fallback database URL of `https://grav-cms-38f45-default-rtdb.firebaseio.com`,
so the Cowork project appears to be **`grav-cms-38f45`**. Confirm against the
running deployment before trusting that — a fallback is evidence, not proof.

> There is a **second, unrelated Firebase project** in the legacy frontend:
> `grav-office-monitor`, hard-coded in `lib/liveScreenshot.js` and used only for
> screen monitoring. It is not the Cowork project and its values must not be
> used here.

These are `NEXT_PUBLIC_*` and therefore ship to the browser. That is normal for
Firebase web configuration — it identifies the project rather than granting
access, and access is decided by Firebase security rules. Which leads to the
warning below.

### `LEGACY_FIREBASE_SERVICE_ACCOUNT` — server-side, writes only

The Admin SDK credential, as a single-line JSON string.

**Where to find it:** the legacy backend reads the same credential under the
name `FIREBASE_SERVICE_ACCOUNT`. Take that value, or mint a new key from
**Firebase console → Project settings → Service accounts → Generate new private
key**.

**This is a real secret.** It bypasses all security rules. It must never appear
in a `NEXT_PUBLIC_*` variable, in client code, or in a commit. `npm run verify`
runs `check-secrets`, which fails the build if a server-only secret reaches the
client bundle.

**Not needed to start.** Every read-only screen works without it. It is required
before any screen that *writes*, because writes go through the server-side proxy
— which is also where the authorisation legacy omits gets applied.

## Authentication flow

```
1. Browser signs in via the Firebase client SDK  (NEXT_PUBLIC_FIREBASE_*)
2. Firebase issues an ID token
3. Adapter sends it as  Authorization: Bearer <token>
4. verifyCoworkToken verifies it, then looks up cowork_employees by authUid
   (falling back to a match on email)
5. GET /cowork/me returns { authUid, employeeId, role, name, passwordChanged }
6. employeeId is also the HR biometricId — the join to MongoDB
```

Three behaviours of the engine that will surprise you, all documented in
`docs/legacy-system-map.md`:

- **Roles are cached for five minutes**, per server process, and the
  employee-update paths never invalidate that cache. A role change is not
  reliably in force until it expires.
- **A valid token with no `cowork_employees` record gets a 403**, not a 401:
  *"Employee not found in Firestore. Ask your CEO."* The health page quotes this
  back to you, because it means the account is fine and the record is missing.
- **`passwordChanged: false`** means the person is still on the engine's
  temporary password, and legacy blocks the app until it is changed.

## Local development

```bash
cp .env.example .env.local     # then fill in the values above
npm install
npm run dev
```

Then open **`/legacy/health`**. You want `CONNECTED`. If not, every failed
check names the variable, endpoint or account responsible.

Then open **`/legacy`** to see who the engine says you are: name, employee
ID, role, department, reporting line, and what your role can reach.

### When credentials are missing

The adapter **refuses to start rather than showing empty screens**. An
unconfigured deployment reports:

> **Cowork is not connected** — the legacy backend address and Firebase
> configuration are not set. This is a deployment setting, not a problem with
> your account.

That distinction is the point. "Your company has no staff" and "this deployment
has no backend address" are different sentences, and only one of them is ever
true.

### CORS

The legacy backend must allow this origin. If the health page reports the API
unreachable while the URL is right, check the backend's CORS configuration in
`server.js` — the new UI runs on a different origin from the legacy frontend.

## What you also need, beyond variables

1. **A legacy Cowork account.** The engine authenticates against
   `cowork_employees`; a Firebase user with no record there is refused.
2. **Ideally one account per role** — `ceo`, `tl`, `employee`. The access
   summary differs for each, and only a real account proves the gates match the
   route files.
3. **Firestore security rules.** They are in **neither legacy repository** and
   are the real permission boundary for everything the legacy browser writes.
   Until they are produced, no claim about what legacy permits can be verified.

## Security notes found during setup

Not introduced by this work; recorded because setting up an environment is when
they matter.

| Finding | Where | Action |
|---|---|---|
| **eTimeOffice credentials committed in plain text** | `services/BiometricSyncService.js:8-10` | Rotate. A repository copy on any machine carries them |
| **Hard-coded JWT signing fallback** — `process.env.JWT_SECRET \|\| "grav_clothing_secret_key"` | `Middlewear/EmployeeAuthMiddlewear.js` | Confirm `JWT_SECRET` is set in production. If it is not, HR tokens can be forged by anyone who has read the repo |
| **`ACCOUNTANT_AUTH_BYPASS`** env flag | legacy backend | Confirm it is unset in production |
| Three endpoints with no authorisation | `review-completion`, `change-role`, `change-department` | The adapter's proxy routes gate these; do not call them directly |
| Two endpoints with no middleware at all | `force-repair-self-assign`, `self-assign-debug` | The adapter refuses these by path |

## Variable reference

| Variable | Side | Needed for | Source |
|---|---|---|---|
| `NEXT_PUBLIC_LEGACY_API_URL` | client | everything | legacy frontend's `NEXT_PUBLIC_API_URL` |
| `NEXT_PUBLIC_FIREBASE_API_KEY` | client | sign-in | Firebase console → web app |
| `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN` | client | sign-in | same |
| `NEXT_PUBLIC_FIREBASE_PROJECT_ID` | client | sign-in | same |
| `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET` | client | sign-in | same |
| `NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID` | client | sign-in | same |
| `NEXT_PUBLIC_FIREBASE_APP_ID` | client | sign-in | same |
| `LEGACY_FIREBASE_SERVICE_ACCOUNT` | **server** | writes, Firestore proxy | legacy backend's `FIREBASE_SERVICE_ACCOUNT` |
