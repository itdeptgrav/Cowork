# Auth fallback — identity separation

**Status: fixed and verified.** Verify: exit 0, 765 tests (757 before).

One Firestore field change on E000. **No task, notification, message, mail,
duty-status, integration or audit reference was touched.**

---

## The risk

`Middlewear/coworkAuth.js` resolves a Firebase login in three steps:

```js
40:  where("authUid", "==", decoded.uid).limit(1)      // primary
43:  where("email",   "==", decoded.email).limit(1)    // fallback
51:  employeeId: "E000", authUid: decoded.uid          // last resort — creates E000
67:  if (!data.authUid) ref.update({ authUid: decoded.uid })   // self-heal
```

Both queries are `.limit(1)` **with no ordering**, so two documents matching one
predicate is a coin flip decided by Firestore's internal ordering — and it can
differ between requests.

After the identity migration, `E000` and `GR0000` both carried
`email: "ray@grav.in"`. The primary lookup hid this, because `GR0000` matched on
`authUid` first. But the exposure was one lost or rotated uid away: with the
primary miss, the fallback would pick one of the two at random, and **line 67
would then stamp `authUid` back onto `E000`** — silently reverting the migration
and handing a login to a system account.

Severity: **latent, not live.** It could not fire while `GR0000` held the uid.
It is the kind of fault that surfaces during a credential rotation, which is
exactly when nobody is looking for it.

---

## The fix

`E000`'s login-matching fields are now unresolvable, and nothing else changed.

```
~ email           : "ray@grav.in"  →  "system.e000@cowork.invalid"
+ legacyEmail     : "ray@grav.in"          (original preserved)
+ isSystemIdentity: true
~ _note           : expanded — see below
~ updatedAt
```

`.invalid` is reserved by **RFC 2606**. It is guaranteed never routable, so it
can never be a Firebase account, so the email fallback can never match E000 —
not by policy but by construction.

The original address is preserved in `legacyEmail`, so no information is lost
and the historical record still says who E000 belonged to.

`_note` now reads:

> E000 = legacy/system identity. NOT a login identity. Login-matching fields are
> deliberately non-resolvable: authUid removed, email set to a reserved
> `.invalid` address (original preserved in legacyEmail). Retained permanently
> as the hardcoded default cross-department approver (taskForward.js) and the
> historical record for ~130 references across 14 collections. Do not delete,
> reassign, or restore email/authUid.

Pre-flight guards aborted the write unless `E000.email === "ray@grav.in"` **and**
`authUid` was already absent — so it could not run twice or against an
unexpected state.

### Why a data change rather than a code change

`coworkAuth.js` lives in `cowork-old-backend`, which this migration does not
modify. But the data fix is the better one regardless: it holds for every
consumer of that collection, including any future code path that resolves an
employee by email, rather than only for the one function that was audited.

---

## Audit of `coworkAuth.js` (item 3)

| Line | Behaviour | Assessment |
|---|---|---|
| 40 | `authUid` lookup, `.limit(1)`, unordered | ⚠️ Correct only while uids are unique. Now enforced by data — a test asserts no two documents share one |
| 43 | `email` fallback, `.limit(1)`, unordered | ⚠️ Same. Now safe: exactly one document is reachable by any real login email |
| 51-57 | Creates `E000` for any unmatched Firebase user | ⚠️ **This is what E000 is.** It is a catch-all bucket, not a person — and it is how the CEO ended up there. Unchanged: it is also how a new Firebase user legitimately gets a Cowork record |
| 67 | Self-heals a missing `authUid` onto the matched document | ⚠️ The amplifier. It turns a one-off wrong match into a persistent one. Harmless once matches are unique |

**Recommendation for whoever owns the backend** (out of scope here): exclude
system identities from both lookups explicitly — `.where("isSystemIdentity","!=",true)`
— so the invariant is enforced in code as well as in data. The field is now
present on E000 for exactly that purpose.

I did not modify the backend.

---

## Verification, by replaying the middleware's own queries

| # | Query | Result |
|---|---|---|
| 1 | `where("authUid","==",UID).limit(1)` | **GR0000** |
| 2 | `where("email","==","ray@grav.in").limit(1)` | **GR0000** |
| 3 | All docs with `email == "ray@grav.in"` | **1 → GR0000** |
| 4 | `E000` | `email=system.e000@cowork.invalid`, `legacyEmail=ray@grav.in`, `isSystemIdentity=true`, `authUid` absent, `role=ceo`, `gmailToken` **kept** |
| 5 | History | tasks **17**, notifications **300+** — unchanged |

Both auth paths now converge on GR0000. E000 is unreachable by either.

---

## Tests added (8)

Both required scenarios, plus the failure mode they exist to prevent:

- signing in with `ray@grav.in` resolves to **GR0000**
- **E000 is never returned** — through the primary path, the fallback path, and
  with the uid absent entirely
- the email fallback cannot reach E000 **even if GR0000 loses its uid** — the
  precise scenario that was open
- exactly one document is reachable by the login email
- no two documents share an `authUid`
- E000 carries no login-matching field: no `authUid`, an address matching
  `/\.invalid$/`, `isSystemIdentity: true`
- ordinary employees still resolve by uid *and* by email, so the self-heal path
  is not broken for anyone else
- an unknown user still falls through to the E000 bootstrap — unchanged, and
  worth having stated, since that is how the CEO became E000 originally

The test replays `coworkAuth.js`'s resolution order against the real post-
migration document shapes, so it asserts legacy's rule rather than ours.

---

## What was not touched

`cowork_tasks` · `cowork_notifications` · `cowork_direct_messages` ·
`cowork_mails` · `cowork_duty_status` · `cowork_fcm_tokens` ·
`cowork_scheduled_meets` · `cowork_join_codes` · `cowork_groups` ·
`cowork_settings` · `cowork_sop_settings` · `cowork_emergency_approvals` ·
`meeting_audio_recordings` — all ~130 E000 references intact.

On the E000 document itself: `role`, `name`, `department`, `city`, `mobile`,
`profilePicUrl`, `fcmTokens`, **`gmailToken`**, `tempPassword`,
`passwordChanged`, `createdAt` all unchanged.

---

## Rollback

```js
await db.collection("cowork_employees").doc("E000").update({
  email: "ray@grav.in",
  legacyEmail: admin.firestore.FieldValue.delete(),
  isSystemIdentity: admin.firestore.FieldValue.delete(),
});
```

**Not recommended** — it restores the duplicate-email condition. If the goal is
to undo the whole identity migration, follow the rollback in
`IDENTITY_MIGRATION_EXECUTION_REPORT.md` instead, which restores E000's
`authUid` as well.

## Still unverified

Signing in as `ray@grav.in` in a browser and confirming the session reports
`GR0000`. The queries above are the middleware's own, replayed against live
data, so the resolution is confirmed — the render is not.
