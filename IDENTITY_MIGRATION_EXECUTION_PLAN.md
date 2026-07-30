# Identity migration — dry run and execution plan

**No writes have been made.** Everything below is read-only observation.

---

## 1 · Current documents

### `cowork_employees/E000` — exists

```json
{
  "employeeId": "E000",
  "authUid":    "paHxne71GZQR7Qt89STzj8XHXmq2",
  "email":      "ray@grav.in",
  "name":       "Admin CEO",
  "role":       "ceo",
  "department": "Admin\n",
  "city": "", "mobile": "", "profilePicUrl": null,
  "passwordChanged": true,
  "tempPassword": null,
  "fcmTokens":  [],
  "gmailToken": "<present — redacted>",
  "createdAt":  2026-04-01T…,
  "updatedAt":  2026-04-12T…
}
```

Two things worth noting before anything else:

- **`department: "Admin\n"`** carries a trailing newline. Harmless now —
  `departmentSlug()` trims — but it is the kind of hand-entry defect that made
  normalising the right call.
- **`gmailToken` is present.** The CEO's Gmail integration is bound to *this
  document*. See §3.

### `cowork_employees/GR0000` — **does not exist**

Confirmed absent. GR0000 exists only in MongoDB HR (RISHEE RAY, CEO, Corporate)
where eight employees report to it.

---

## 2 · Every reference to `E000`

Scanned all 27 Firestore collections across 18 id-shaped fields and 6 array
fields.

| Collection | References |
|---|---|
| `cowork_tasks` | `assignedBy` **17**, `originalAssignedBy` **17**, `approverId` **7**, `visibleTo[]` **7** |
| `cowork_notifications` | `recipientEmployeeId` **≥50** *(query capped at 50 — actual count is higher)* |
| `cowork_direct_messages` | `participantIds[]` **9** |
| `cowork_scheduled_meets` | `createdBy` 4, `participants[]` 4, `updatedBy` 1 |
| `cowork_join_codes` | `createdBy` **6** |
| `meeting_audio_recordings` | `employeeId` **6** |
| `cowork_mails` | `participants[]` 2 |
| `cowork_emergency_approvals` | `employeeId` 2 |
| `cowork_duty_status` | `employeeId` 1, **document id `E000`** |
| `cowork_fcm_tokens` | `employeeId` 1, **document id `E000`** |
| `cowork_groups` | `createdBy` 1 |
| `cowork_settings` | `updatedBy` 1 |
| `cowork_sop_settings` | `updatedBy` 1 |
| `cowork_employees` | **document id `E000`** |

**14 collections. Roughly 130+ references, three of them document ids.**

Plus the backend hardcodes: `taskForward.js:199,203,246,250` (default approver —
absence hard-blocks cross-department assignment), `pmpRoutes.js:213` and
`workloadroutes.js:180` (excluded from lists by id).

This settles the approach beyond doubt: **any merge or delete of E000 would
require rewriting 130+ references across 14 collections plus code I am not to
modify.** Option A — additive, leave E000 wholly intact — is the only safe
shape.

---

## 3 · Does the migration break anything?

| Area | Verdict | Why |
|---|---|---|
| Existing tasks | ✅ Safe | All 48 task references keep pointing at E000, which still exists |
| Approvals | ✅ Safe | The E000 fallback approver document is untouched |
| Task assignment | ✅ Safe | Same — the hard-block only fires if E000 is *absent* |
| Score calculations | ⚠️ **Changes** | `pmpRoutes.js:213` excludes `E000` by id. GR0000 is not excluded, so **the CEO will now appear in score and workload lists** |
| Admin access | ✅ Safe | `role: "ceo"` on the new document; `canAccessAdminSettings` reads role, not id |
| Audit history | ⚠️ **Splits** | See below |

### The one real cost: a split history

This is the honest headline, and it is a decision rather than a risk to
mitigate.

After migration the human signs in as **GR0000**. Everything already recorded
against **E000 stays there**:

- **≥50 notifications** — their existing notification history disappears from
  the bell
- **9 direct-message threads** and **2 mail threads** — they will not appear as
  a participant under the new id
- **`cowork_duty_status/E000`** — their attendance/duty document is keyed by the
  old id; a new one begins for GR0000
- **`cowork_fcm_tokens/E000`** — push notifications keep going to the old id
  until re-registered
- **`gmailToken` on E000** — the Gmail integration is bound to the old document
  and will need reconnecting under GR0000
- **6 meeting recordings**, **6 join codes**, **4 scheduled meets**

Their *tasks* remain visible (via E000's `assignedBy`/`visibleTo`), but their
*communications, attendance and integrations* effectively restart.

**There is no way to avoid this without rewriting those 130+ references**, which
is a far riskier migration touching live message and attendance data. My
recommendation is to accept the split and keep E000 as the historical + system
record — but you should make that call knowingly, not discover it afterwards.

---

## 4 · Execution plan

### Before state

```
cowork_employees/E000    authUid = paHxne71GZQR7Qt89STzj8XHXmq2   ← login
cowork_employees/GR0000  (absent)
identityMap.ts           IDENTITY_ALIASES = { E000: "GR0000" }
Team as CEO              empty (E000 has no reports)
```

### After state

```
cowork_employees/E000    authUid = ""            ← system approver, not a login
cowork_employees/GR0000  authUid = paHxne71…     ← the human's login
identityMap.ts           IDENTITY_ALIASES = {}
Team as CEO              GR0002, GR0045 (direct reports only)
```

### Write 1 — create the canonical record

```js
await db.collection("cowork_employees").doc("GR0000").set({
  employeeId:  "GR0000",
  authUid:     "paHxne71GZQR7Qt89STzj8XHXmq2",
  email:       "ray@grav.in",
  name:        "Rishee Ray",
  role:        "ceo",
  department:  "Corporate",
  city: "", mobile: "", profilePicUrl: null,
  fcmTokens: [],
  passwordChanged: true,
  tempPassword: null,
  createdAt: admin.firestore.FieldValue.serverTimestamp(),
  updatedAt: admin.firestore.FieldValue.serverTimestamp(),
});
```

`name` and `department` are taken from the HR record (RISHEE RAY, Corporate).
`gmailToken` is deliberately **not** copied — an OAuth token belongs to the
document it was issued against, and moving it would be silently reassigning a
credential.

### Write 2 — retire the old login (**not optional**)

```js
await db.collection("cowork_employees").doc("E000").update({
  authUid: "",
  updatedAt: admin.firestore.FieldValue.serverTimestamp(),
});
```

`coworkAuth.js:40` is `where("authUid","==",uid).limit(1)` with no ordering.
Two documents sharing a uid is a coin flip **on every request**, and the losing
outcome is the CEO silently resolving to the wrong identity. Both writes must
land in the same session.

### Write 3 — remove the compatibility layer

`lib/legacy/identityMap.ts`: empty `IDENTITY_ALIASES`. The test asserting one
entry becomes an assertion of zero — which is the signal that the workaround is
retired.

### Verification, in order

1. `cowork_employees/GR0000` exists with the uid; `E000.authUid === ""`
2. Sign in as `ray@grav.in` → `/cowork/me` returns `employeeId: "GR0000"`
3. Team shows **GR0002 and GR0045** — direct reports only, not GR0067/GR0108
4. `/admin` still opens
5. Create a cross-department task → the E000 fallback approver still resolves
6. `npm run verify`

### Rollback

Reversible in full; no reference data is touched in either direction.

```js
// 1 — restore the login
await db.collection("cowork_employees").doc("E000")
  .update({ authUid: "paHxne71GZQR7Qt89STzj8XHXmq2" });

// 2 — remove the new record
await db.collection("cowork_employees").doc("GR0000").delete();

// 3 — restore the alias
//     IDENTITY_ALIASES = { E000: "GR0000" }
```

Record `paHxne71GZQR7Qt89STzj8XHXmq2` somewhere outside this repo before
starting — rollback depends on it, and Write 2 overwrites it.

**Note on ordering:** if rollback is needed *after* signing in as GR0000, some
new activity (duty status, notifications) will have accrued under GR0000. That
data is orphaned by the rollback, not destroyed.

---

## Decision needed

Two questions before I execute anything:

1. **Do you accept the split history** — notifications, DMs, duty status, FCM
   and the Gmail token staying with E000?
2. **Is "Rishee Ray" / "Corporate" the right name and department** for the new
   record? I took them from HR rather than inventing them, but they will be what
   colleagues see.

On your go-ahead I will run Writes 1 and 2 together and verify. I have made no
writes.
