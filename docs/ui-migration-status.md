# UI Migration Status

Replacing mock-repository data with legacy adapter data, screen by screen.

```
New UI Components  →  lib/legacy/*  →  Existing Firebase / APIs / Database
```

**Status** — `done` migrated and verified against a live backend ·
`wired` adapter connected, loading/error states in place, **not yet verified
against live data** · `partial` some data migrated · `pending` still on the mock
repository · `blocked` cannot proceed, reason given

## The blocker that governs every row

**No credentials are configured.** `.env.local` has no
`NEXT_PUBLIC_LEGACY_API_URL` and no `NEXT_PUBLIC_FIREBASE_*` values, so no
screen has ever received a real legacy response.

Nothing below can honestly reach `done` until that changes. `wired` is the
ceiling, and it means: the adapter call is in place, every state renders, and
the code is ready — but "verify data matches legacy", step 4 of the migration
rules, has not happened for any screen.

The adapter refuses to start rather than rendering empty screens, so an
unconfigured deployment says *"Cowork is not connected — this is a deployment
setting, not a problem with your account"* rather than showing a company with
no staff.

## Screens

| Screen | Old source | New source | Status |
|---|---|---|---|
| `/legacy` — identity + access | *(new)* | `legacy/session`, `legacy/profile` | **wired** |
| `/legacy/health` — connection checks | *(new)* | `legacy/health` | **wired** |
| `/legacy/people` — HR directory | *(new)* | `legacy/directory` | **wired** |
| Sign-in / current user | `SessionProvider` (server identity) | `legacy/session` | **wired** |
| `/people`, `/people/[employeeId]` | `mockRepository` | `legacy/employees` | pending |
| `/team`, `/team/[employeeId]` | `mockRepository` | `legacy/employees` | pending |
| `/admin/people` | `mockRepository` | `legacy/employees` | pending |
| `/admin/organisation` | `mockRepository` | `legacy/departments` | pending |
| `/home` — dashboard | `mockRepository` | `legacy/scoring`, `legacy/tasks`, `legacy/attendance` | pending |
| `/tasks`, `/tasks/[taskId]` | `mockRepository` | `legacy/tasks` | pending |
| `/tasks/[taskId]/deadline` etc. | `mockRepository` | `legacy/tasks` | pending |
| `/score`, `/score/c1`–`c4` | `mockRepository` | `legacy/scoring` | pending |
| `/score/c3`, SOP ledger | `mockRepository` | `legacy/sop` | pending |
| `/attendance`, `/attendance/history` | `mockRepository` | `legacy/attendance` | pending |
| `/settings`, `/admin/settings` | `mockRepository` | `legacy/settings` | pending |
| `/admin/scoring-rules` | `mockRepository` | `legacy/sop` (bands) | pending |
| `/admin/roles` | `mockRepository` | `legacy/permissions` | pending |
| `/goals` | `mockRepository` | *(no adapter yet)* | blocked — goal endpoints not bridged |
| `/messages`, `/groups` | `mockRepository` | *(no adapter yet)* | blocked — messaging not bridged |
| `/notifications` | `mockRepository` | *(no adapter yet)* | blocked — not bridged |
| `/mail` | Gmail OAuth (new) | — | excluded — new-product feature |
| `/meetings` | LiveKit (new) | — | excluded — new-product feature |
| `/music`, `/yt` | new | — | excluded |

## Step 1 — Authentication and current user

**Wired.** The pieces:

| Piece | What it does |
|---|---|
| `lib/legacy/session.tsx` | `LegacySessionProvider` + `useLegacySession()`. Five states: `unconfigured`, `loading`, `anonymous`, `error`, `authenticated` |
| `lib/legacy/profile.ts` | Composes identity + directory row + reporting lines into one shape |
| `components/features/legacy/LegacyConnection.tsx` | Renders who / role / department / reporting line / access |
| `app/legacy/page.tsx` | The verification surface |

Answers the three questions the brief asks:

- **Who am I?** `GET /cowork/me` → name, employee ID, department, reporting line.
- **What role do I have?** From `cowork_employees`, via the engine. An
  unrecognised role reads as `employee`, matching the engine's own fallthrough.
- **What can I access?** `accessSummary()` — twelve surfaces, each showing the
  gate it checks, evaluated with `permissions.ts`, which mirrors
  `verifyCeoToken` / `verifyCeoOrTL` / `verifyEmployeeToken` exactly.

Three behaviours worth noting, each of which exists because the engine does
something a naive client would get wrong:

- **`getToken()` is a function, not a value.** The Firebase SDK refreshes on its
  own schedule; a token captured into state goes stale while the page is open.
- **A 401 from the engine renders as "sign in", not as an error.** It means the
  Firebase session outlived the engine's view of it.
- **"No HR record" is its own empty state**, distinct from "no manager". The
  engine reports both as a success, and conflating them tells somebody their
  reporting line is empty when their HR record is simply missing.

### Not replaced

`SessionProvider` still serves every other screen, and `getRepository()` still
backs them. Removing either now would break the fourteen screens still on the
mock repository. They come out per-screen, as each migrates — which is the
instruction, and also the only safe order.

## Migration rules — where each screen must get to

1. Remove the mock dependency
2. Add the adapter call
3. Add loading / error / empty states
4. **Verify the data matches legacy** ← blocked for every screen
5. Run `npm run verify`

## Verification log

| Date | Scope | Result |
|---|---|---|
| 2026-07-28 | `npm run verify` after step 1 | exit 0 — lint, tsc, 580 tests, build, secret check |
| 2026-07-28 | `npm run verify` after health checker | exit 0 — 597 tests |
| 2026-07-28 | `npm run verify` after HR directory | exit 0 — 608 tests |
| 2026-07-28 | Environment gate | **7 of 7 required variables missing** |
| — | Live legacy responses | **not performed — no credentials** |

## What is needed to unblock

1. `NEXT_PUBLIC_LEGACY_API_URL` — the legacy backend's base URL.
2. The six `NEXT_PUBLIC_FIREBASE_*` values from the legacy frontend's own
   environment.
3. A test account on the legacy system, ideally one per role (`ceo`, `tl`,
   `employee`), since the access summary differs for each and only a real
   account proves the gates match.
4. `LEGACY_FIREBASE_SERVICE_ACCOUNT` before any *write* screen migrates — the
   proxy routes need it, and they are where the authorisation legacy omits
   (`review-completion`, `change-role`, `change-department`) gets applied.

The first three unblock every read-only screen: people, departments, dashboard,
scores, SOP history, attendance. Writes need the fourth.
