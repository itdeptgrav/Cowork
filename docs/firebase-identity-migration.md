# Firebase Identity Migration — Option A

One login. Firebase becomes the identity layer; the Cowork product, its shell,
its routes and its design system are untouched.

End state: **new Cowork app + Firebase identity + legacy backend data.**

## The seam that makes this small

`components/features/auth/SessionProvider.tsx` already publishes a
`SessionState` that everything downstream consumes:

```ts
{ status, employeeId, displayName, email, archetype, landing, refresh, signOut }
```

`ShellFrame`, `ProfileSwitcher`, `SignOutButton` and — critically — the mock
repository's acting identity all read *that contract*, not the cookie. So the
change is to **re-source the provider, keeping the contract identical**.
Everything downstream keeps working without edits.

That is the whole strategy. Anything that instead rewrites consumers is doing
more work than the problem requires.

## The one thing that looked like a blocker and is not

Server-side and Edge code must verify a Firebase ID token. The obvious way is
the Admin SDK, which needs `LEGACY_FIREBASE_SERVICE_ACCOUNT` — which we do not
have.

It is not required. A Firebase ID token is an RS256 JWT signed by Google, and
Google publishes the public keys. Verification needs only:

- the JWKS at
  `https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com`
- `iss === "https://securetoken.google.com/grav-cms-38f45"`
- `aud === "grav-cms-38f45"`
- unexpired `exp`

Web Crypto can do this, so it works in middleware on the Edge as well as in
route handlers. **No service account, no new secret.** The service account stays
needed only for Firestore writes, which is a separate concern.

## What changes, file by file

### Phase 1 — Firebase login in the real app

| File | Change |
|---|---|
| `lib/auth/firebaseToken.ts` | **New.** JWKS fetch + cache, RS256 verify, claim checks. Pure, testable |
| `components/features/auth/SessionProvider.tsx` | Source identity from Firebase + `GET /cowork/me` instead of `/api/auth/session`. **Contract unchanged** |
| `app/signin/page.tsx` | Email/password to Firebase rather than `/api/auth/signin` |
| `middleware.ts` | Verify the Firebase token instead of the scrypt cookie signature. Drop the `/legacy` dev exemption |
| `components/layout/shell/ShellFrame.tsx` | Drop the `/legacy` exemption. Otherwise unchanged |
| `lib/legacy/session.tsx` | Becomes a thin re-export of the app session — one session object, not two |

**Not changed:** `AppShell`, `WorkspaceShell`, navigation, every page, every
component, the whole design system.

**Archetype.** The engine gives `ceo | tl | employee`; the app's `RoleArchetype`
is richer. One mapping function, in `lib/auth/roleMap.ts`, applied at the
provider boundary — so `mayOpenAdmin()` and every existing permission call keeps
working untouched.

### Phase 2 — Home

`/home` and `/` already render `components/features/dashboard/Home.tsx`. That
component stays; only its **data source** moves from `getRepository()` to the
adapter, card by card, each card showing its real state until its source is
verified.

`components/features/legacy/LegacyHome.tsx` is **deleted**, not moved. It was a
second dashboard and should never have existed.

### Phase 3 — the rest

`/profile`, `/people`, `/team`, `/tasks`, `/score`, `/attendance`: same pattern —
same page, same components, data source swapped, one at a time, each verified at
`/legacy/validate` before the next.

### `/legacy` after this

Only `health` and `validate`. `page.tsx`, `people/`, `profile/`, `layout.tsx`,
`LegacyShell.tsx` and `navigation.ts` are deleted once their replacements are
verified — not before.

## Order, and why

1. **Token verification** (`firebaseToken.ts`) — everything depends on it, and it
   is pure, so it can be tested before anything is wired.
2. **`SessionProvider`** — the seam. When this works, the whole app is on
   Firebase identity while still reading mock data. One change, fully reversible,
   nothing else touched.
3. **Middleware** — only after the provider works, so a failure is never
   ambiguous between the two.
4. **Sign-in page** — last in Phase 1, because until then the existing local
   sign-in still works and nobody is locked out.
5. Then Phases 2 and 3, one screen at a time.

## What breaks, honestly

**The four local accounts stop working.** `rakesh.biswal@grav.in` and the others
in `.data/identity.json` authenticate against scrypt, not Firebase. After Phase 1
the only way in is a legacy Cowork account. That is the point of one login, but
it means **everyone testing needs a Firebase account before this ships**.

**`/api/auth/*` becomes vestigial.** Eight routes — signin, signup, redeem,
session, signout, directory, two admin. They are left in place through Phase 1
and removed only once nothing calls them.

**Twelve server routes still read the local session** — mail, Gmail, LiveKit,
meetings, admin. These are new-product features with no legacy equivalent. They
keep working through Phase 1 and move to Firebase verification in Phase 3, since
none of them is on the identity critical path.

**Firestore writes still need the service account.** Unchanged by this migration;
presence, timers and any write screen stay blocked on it.

## Verification per phase

`npm run verify` after each step, plus:

- Phase 1 — sign in with a legacy account, land on `/home`, shell renders,
  `ProfileSwitcher` and `SignOutButton` work, `/admin` still gated by archetype.
- Phase 2 — Home's connected cards match the old Cowork app.
- Phase 3 — each screen checked at `/legacy/validate` before the next begins.

## Open decisions

1. **Archetype mapping.** `ceo → system_admin`? `tl → manager`? The app's model
   is richer than the engine's three roles, and the mapping decides who sees
   `/admin`.
2. **Accounts for testing.** One per role — `ceo`, `tl`, `employee` — still
   outstanding, and now on the critical path rather than a nice-to-have.
3. **`/signup` and `/reset-password`.** Firebase owns both once this lands.
   Legacy creates employees through `POST /cowork/employee/create` (CEO or TL),
   so self-signup may need to be removed rather than re-pointed.
