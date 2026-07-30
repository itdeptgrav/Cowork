# Identity migration — execution report

**Status: executed and verified.** Verify: exit 0, 757 tests.

Two Firestore writes. No reference data touched.

---

## Before state

```
cowork_employees/E000     authUid = paHxne71GZQR7Qt89STzj8XHXmq2   ← the login
                          role=ceo  email=ray@grav.in  name="Admin CEO"
                          department="Admin\n"  gmailToken=present
cowork_employees/GR0000   ABSENT
MongoDB Employee/GR0000   RISHEE RAY, CEO, Corporate — 8 direct reports
identityMap.ts            IDENTITY_ALIASES = { E000: "GR0000" }
Signing in as ray@grav.in → E000 → a node nobody reports to → Team empty
```

## Writes performed

### Write 1 — `cowork_employees/GR0000` created

| Field | Value | Source |
|---|---|---|
| `employeeId` | `GR0000` | HR `biometricId` |
| `authUid` | `paHxne71GZQR7Qt89STzj8XHXmq2` | moved from E000 |
| `email` | `ray@grav.in` | E000 |
| `name` | `RISHEE RAY` | HR `firstName` + `lastName` |
| `designation` | `CEO` | HR `designation` |
| `department` | `Corporate` | HR `department` |
| `mobile` | `9330288560` | HR `phone` |
| `role` | `ceo` | E000 |
| `city`, `profilePicUrl`, `fcmTokens`, `tempPassword`, `passwordChanged` | `""`, `null`, `[]`, `null`, `true` | defaults |
| `_note` | *"Canonical login identity for RISHEE RAY (HR biometricId GR0000). Eight employees report to this id in HR…"* | — |

`gmailToken` **deliberately not copied** — an OAuth token belongs to the
document it was issued against, and moving it would silently reassign a
credential.

A pre-flight check aborted the script if `GR0000` already existed. It did not.

### Write 2 — `cowork_employees/E000` login binding removed

```
- authUid : deleted (FieldValue.delete())
+ _note   : "E000 = legacy/system identity. NOT a login identity. Retained
             permanently as (a) the hardcoded default cross-department
             approver (taskForward.js), and (b) the historical record for
             ~130 references across 14 collections. Login binding removed
             2026-07-29; the human signs in as GR0000. Do not delete or
             reassign."
~ updatedAt
```

Unchanged on E000: `role`, `email`, `name`, `department`, `city`, `mobile`,
`profilePicUrl`, `fcmTokens`, **`gmailToken`**, `tempPassword`,
`passwordChanged`, `createdAt`.

### Write 3 — `lib/legacy/identityMap.ts`

`IDENTITY_ALIASES` emptied; the compatibility layer is retired. The module
header now records the history and the residual risk below. Tests updated to
assert the table is empty.

---

## Validation queries and results

| # | Check | Result |
|---|---|---|
| 1 | `where("authUid","==",UID)` | **1 document → `GR0000`** — no duplicate |
| 2 | `E000.authUid` field present | **false** |
| 3 | `E000` role / email / gmailToken | `ceo` / `ray@grav.in` / **kept** |
| 4 | `GR0000` document | `RISHEE RAY`, `ceo`, `Corporate`, `CEO`, `ray@grav.in` |
| 5 | `cowork_tasks.assignedBy == "E000"` | **17** — unchanged |
| 6 | `cowork_notifications.recipientEmployeeId == "E000"` | **200+** — unchanged |
| 7 | Directory size | **17** (was 16) |
| 8 | `npm run verify` | **exit 0, 757 tests** |

Check 1 is the one that mattered most: `coworkAuth.js:40` is
`where("authUid","==",uid).limit(1)` with no ordering, so two documents sharing
the uid would have been a coin flip on every request.

### Still to verify in a browser — I cannot sign in as you

- login resolves to `GR0000` (`/cowork/me` returns `employeeId: "GR0000"`)
- Team shows **GR0002 and GR0045** — direct reports only, not GR0067/GR0108
- `/admin` still opens
- tasks assigned by E000 still display
- a cross-department assignment still finds the E000 fallback approver

The data supports all five; only the render is unconfirmed.

---

## ⚠ Residual risk — worth acting on

**`E000` and `GR0000` both carry `email: "ray@grav.in"`.**

`coworkAuth.js:43` falls back to `where("email","==",…).limit(1)` when the
`authUid` lookup misses, and that query is unordered. It **cannot fire today**,
because `GR0000` matches on `authUid` first at line 40. But if that uid were
ever lost or rotated, the email fallback becomes a coin flip between the two
documents — and line 67 would re-stamp whichever it found, silently undoing this
migration.

Clearing or changing `E000.email` closes it. I did not, because you scoped this
to login-binding fields and email is load-bearing elsewhere. Your call.

## Known consequences, as flagged in the dry run

- **History stays with E000** — 200+ notifications, 9 DM threads, 2 mail
  threads, duty status, FCM tokens, 6 meeting recordings, and the Gmail
  integration. New activity accrues to GR0000. This was accepted.
- **The CEO now appears in score and workload lists.** `pmpRoutes.js:213` and
  `workloadroutes.js:180` exclude `E000` by id; `GR0000` is not excluded.

---

## Rollback

Fully reversible. No reference data was touched in either direction.

```js
// 1 — restore the login binding
await db.collection("cowork_employees").doc("E000")
  .update({ authUid: "paHxne71GZQR7Qt89STzj8XHXmq2" });

// 2 — remove the new identity
await db.collection("cowork_employees").doc("GR0000").delete();

// 3 — restore the compatibility layer
//     lib/legacy/identityMap.ts:
//     export const IDENTITY_ALIASES = { E000: "GR0000" };
//     and revert lib/legacy/identityMap.test.ts
```

**`paHxne71GZQR7Qt89STzj8XHXmq2`** — the uid rollback depends on. Record it
outside this repository.

If rolled back *after* signing in as GR0000, any activity accrued under GR0000
(duty status, notifications) is orphaned rather than destroyed.

---

## Recommended follow-up

Add an explicit **`biometricId`** field to `cowork_employees`. The Cowork→HR
join is still a naming convention rather than a stored reference, and this
migration fixed one instance of that class. With the field, the next mismatch is
writable data instead of a code change.
