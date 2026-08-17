# User identity mapping — report

Verify: **exit 0, 723 tests** (718 before).

> The screenshot did not come through, so this traces the flow from the code and
> from production data rather than from what was on screen.

## Root cause: one endpoint, gated to the wrong audienceee

`LegacyRepository.#employeesById()` fetched the directory with
`GET /cowork/employee/list`. The engine gates that route **`verifyCeoOrTL`**
(`cowork.js:322`).

Soumya Ranjan is **GR0067**, role `employee`. So:

```
employee signs in → /cowork/me returns GR0067 correctly
                  → directory fetch → 403 Forbidden
                  → result.ok === false → empty Map (silently)
                  → getCurrentEmployee() → map.get("GR0067") → null
                  → TopBar renders no name, no id, no avatar
```

The identity resolution was never wrong. `/cowork/me` returned GR0067 the whole
time. What failed was the **lookup of that id in a directory the employee was
not allowed to read** — and the failure was swallowed into an empty map, so it
presented as absence rather than refusal.

**`GET /cowork/employee/list-members` (`cowork.js:49`) serves the same data**,
from the same `listCoworkEmployees()` call, gated only on holding a valid
employee token — and it additionally strips `tempPassword`, `authUid` and
`fcmTokens`.

Two things make this worth dwelling on:

- **`listMembers` already existed** in `lib/legacy/employees.ts`, with a
  docstring that predicts this exact failure: *"A screen available to everybody
  must use this one, or it will render an empty list with a permission error for
  most of the company."* The repository called the other one.
- **It is invisible to a TL or the CEO.** Every account used for testing so far
  — GR0045 (`tl`) — passes the gate. The bug only exists for ordinary
  employees, which is most of the company.

## Blast radius

The same empty map feeds everything that needs the directory. This one line
explains several symptoms reported separately:

| Symptom | Cause |
|---|---|
| No name / id / avatar in the top bar | `getCurrentEmployee()` → null |
| Assignee picker empty | `listAssignableEmployees()` → `[]` |
| Team shows nobody | `reports` filters an empty directory |
| Task rows show no assignee names | every id unresolved |

## Old vs new flow

| Step | Old Cowork | New Cowork (before) | New Cowork (after) |
|---|---|---|---|
| Who am I | `GET /cowork/me` → `{authUid, employeeId, role, name}` | same | same |
| Directory | `listAllEmployees()` — reads `cowork_employees` from Firestore, falls back to **`/list-members`** | **`/employee/list`** (CEO/TL only) | **`/list-members`** |
| Name shown | from the directory record | — | from the directory record |

Legacy never calls `/employee/list` from the client at all.

## Files changed

| File | Change |
|---|---|
| `lib/repositories/legacy/index.ts` | directory via `listMembers`; a failed fetch now **throws** instead of resolving empty; cache cleared so a retry is possible; stale docstring corrected |
| `components/features/auth/SessionProvider.tsx` | sign-out clears `cowork-dev-profile` and `cowork-lens` |
| `components/layout/shell/LensContext.tsx` | exports `LENS_STORAGE_KEY` |
| `lib/legacy/identity.test.ts` | new — 5 tests |

**The swallow was as much the bug as the endpoint.** `if (result.ok)` turned a
403 into "this company has no employees", and every caller treated that as fact.
It now throws, so a directory failure surfaces as an error instead of as an
identity that quietly does not exist.

## Item 5 — account switching

`signOut` already did a hard navigation (`window.location.href`), which drops
React state and every module singleton including the repository and its caches.
Firebase persistence is ended by `firebaseSignOut()`, and the cookie is cleared.

**`localStorage` was not.** Two keys survived a sign-out:

- `cowork-dev-profile` — the acting-profile id from `ProfileSwitcher`
- `cowork-lens` — the saved team/self lens

Both are per-browser, not per-account, so the next person to sign in on the same
machine inherited them. On a shared desk that reads as the app showing somebody
else's identity. Both are now removed on sign-out.

## Accounts tested

Honestly: **none end-to-end.** Signing in as Soumya needs their credential,
which I do not have and would not use.

What I verified instead, against production data:

| Account | Id | Role | Passes `/employee/list`? | Directory before | after |
|---|---|---|---|---|---|
| Rakesh Biswal | GR0045 | `tl` | ✅ | worked | works |
| **Soumya Ranjan** | **GR0067** | **`employee`** | ❌ **403** | **empty** | works |
| Pramod Biswal | GR0108 | `employee` | ❌ 403 | empty | works |
| Admin CEO | E000 | `ceo` | ✅ | worked | works |

Eight of the sixteen employees are role `employee`, so **half the company had no
identity in the UI**.

## Tests added (5)

- The repository fetches with `listMembers`, and the CEO/TL-gated call is not
  reachable from it — asserted against the source, because a TL-shaped runtime
  test cannot see this bug.
- Soumya's real record maps to id, name, role and department, trailing space in
  `name` and all.
- All sixteen directory rows map without loss — a silently-dropped row is
  somebody who vanishes from the directory and their own top bar.
- A record with no `employeeId` is dropped rather than keyed on `""`, which
  would collide and overwrite a colleague.
- Sign-out clears both `localStorage` identity carriers.

## What still needs a browser

Sign in as Soumya and confirm the top bar shows *Soumya Ranjan · GR0067*, the
assignee picker lists 15 people, and Team shows their manager's line. Then sign
out, sign in as GR0045, and confirm nothing of Soumya's remains.
