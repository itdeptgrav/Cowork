# Auth and Team — security report

Verify: **exit 0, 718 tests** (705 before).

---

# Issue 1 · Authentication

## What I could and could not reproduce

**I could not reproduce an unauthenticated bypass.** Against the running dev
server with no cookie at all, every named route already redirected:

```
GET /team   -> 307  /signin?next=%2Fteam
GET /home   -> 307  /signin?next=%2Fhome
GET /tasks  -> 307  /signin?next=%2Ftasks
```

**I did find a real bypass, of a different kind.** The gate checked the token's
*claims* and never its *signature*. A JWT payload is base64, not a secret, and
the session cookie is written by client JavaScript so it is not `httpOnly` —
so anyone could mint a credential:

```
header  {"alg":"RS256","kid":"fake"}
payload {"iss":"https://securetoken.google.com/grav-cms-38f45",
         "aud":"grav-cms-38f45","sub":"GR0045","exp":<now+3600>}
sig     not-a-real-signature
```

Sent as `cowork_fb`, that returned **`200` on `/team`** — the entire workspace
shell rendered for a forged credential. This is very likely what you saw: not
"no session", but "a session the gate never checked".

## Root cause

`middleware.ts` called `checkClaims` alone. The code comment defended it as a
"cheap first gate" that never claims to authorise, with real authority
established later when the legacy engine verifies the token.

That reasoning protects the **data** — and it did: the engine rejects a forged
token, so no record is returned. It does not protect the **application**, and a
gate whose only job is turning away unauthenticated requests must not accept a
credential anyone can type. The latency objection it rested on does not hold
either: `fetchCertificates` caches Google's keys for as long as their
`Cache-Control` allows, so verification costs one fetch per cache period for the
whole deployment, not one per navigation.

`verifyIdToken` — full RS256 verification against Google's JWKS, Edge-compatible
via Web Crypto — already existed in `lib/auth/firebaseToken.ts`. It simply was
not being called.

## Fix, verified

`middleware.ts` now checks claims (free, rejects expired and wrong-audience
without a network call) and **then the signature**. Failure is closed: if the
certificates cannot be fetched, the request is unauthenticated.

```
forged -> /team    307  /signin?next=%2Fteam     (was 200)
forged -> /home    307  /signin?next=%2Fhome
forged -> /tasks   307  /signin?next=%2Ftasks
forged -> /score   307  /signin?next=%2Fscore
no cookie -> /team 307  /signin?next=%2Fteam
garbage -> /home   307  /signin?next=%2Fhome
/signin            200  (still reachable)
```

## Security impact

**High before the fix.** A forged cookie granted the full authenticated UI:
navigation, layouts, every protected route rendering. Company records did not
leak — the legacy engine verifies properly and returns nothing for a bad token —
but any data the client could reach without the engine was exposed, and the
application presented itself as signed in to someone who was not.

## Still open

- **The cookie is not `httpOnly`**, because client JavaScript writes it. It is
  now signature-checked, so forging is closed, but a stolen token is replayable
  until expiry. Moving the write to a server route with `httpOnly; Secure;
  SameSite=Lax` is the follow-on fix.
- **Expired-token handling** is enforced server-side (`checkClaims`), but the
  client keeps rendering until Firebase refreshes. A 401 from the engine should
  end the session rather than surface as a failed query.
- Next reports `middleware` is deprecated in favour of `proxy`. Unchanged here
  — renaming during a security fix would mix two concerns.

---

# Issue 2 · Team

## The screen was right about the data and wrong about the reason

"You have no direct or indirect reports" was rendered because
`viewer.hierarchyIds` was `[]`. `TeamArea` filters the directory by that list,
so an empty closure reads as "no team" — and `toViewer` hardcoded it empty.

**GR0045 has two direct reports.** From production:

| Employee | Primary manager |
|---|---|
| GR0067 | **GR0045** |
| GR0108 | **GR0045** |

GR0045 (Rakesh Biswal, role `tl`, department IT) reports to GR0000.

This was already fixed by the hierarchy work in the previous change —
`getViewer` now derives the closure from `my-managers` — and this report adds
the regression test that pins it to the real edges.

## A finding worth acting on

**`GR0000` is not in `cowork_employees`.** Eight of the sixteen Cowork employees
name GR0000 as their manager, and that record does not exist in the Cowork
directory. Consequences:

- Their `depth` is `null`, not `0` — deliberately. Placing them at 0 would draw
  eight co-equal roots and assert a structure nobody configured.
- The only genuine root is `E000`, the default approver.
- Any org-chart screen will show eight disconnected branches until GR0000 is
  added to `cowork_employees` or the HR records are repointed.

That is a **data** gap in the legacy system, not a bug in this app. I have not
changed either store.

---

# Files changed

| File | Change |
|---|---|
| `middleware.ts` | signature verification; `hasLiveFirebaseToken` now async, fails closed |
| `lib/auth/forgedToken.test.ts` | new — 5 tests |
| `lib/repositories/legacy/security.test.ts` | new — 8 tests |

No UI was hidden and no error was suppressed. The auth fix closes the hole; the
Team fix computes the closure that was always derivable.

# Tests added

**Auth (5).** A forged token passes `checkClaims` — asserted deliberately, to
record that the old gate verified attacker-chosen values; the same token fails
signature verification; expired tokens refused; wrong-project tokens refused;
malformed cookies decode to null rather than throwing, because a throwing Edge
function fails requests in ways much harder to reason about than a redirect.

**Team (3).** GR0045's two reports; a peer manager's reports stay out of the
closure; GR0000's absence yields null depth and `E000` as the only root.
