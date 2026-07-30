# Mail Migration Spec

How legacy's two mail systems become one mailbox in Cowork, and what is
blocking the external half.

---

## 1. Old architecture

Legacy ran **two unrelated mail products** behind two routes.

| | Internal mail | Gmail |
|---|---|---|
| Route | `/coworking/mail` (1,376 lines) | `/coworking/mail/gmail` (1,593 lines) |
| Store | Firestore `cowork_mails` | Gmail, via the Gmail API |
| Written by | **The browser, directly** | `routes/services/googleEmployeeGmailService.js` |
| Auth | Firebase session | **Per-employee OAuth2 refresh token**, held at `cowork_employees/{id}.gmailToken` |
| Recipients | `/cowork/employee/list-members` | Free-text addresses |
| Attachments | `/cowork/upload/image`, `/cowork/upload/pdf` | MIME parts built in `buildMimeMessage()` |
| Notifications | `cowork_notifications` | None |

Consequences a user actually felt:

- **Two inboxes, two sent folders, two searches.** You had to know which system
  a message lived in before you could look for it.
- **The transport was chosen by opening a page**, before a single recipient had
  been typed. Choosing wrong meant starting again.
- Internal mail was a **client-side Firestore write** — same shape as legacy's
  priority and emergency features, with the same absence of server validation.

Reusable from legacy: the MIME builder's structure, the thread/`References`
header handling, and the recipient-directory idea. Not reusable: the two-page
split, the client-side writes, and the auth model (see §5).

---

## 2. New architecture

**One mailbox. The recipient decides the transport.**

```
compose → transportFor(recipients) ─┬─ all employees → internalMailService
                                    └─ any external  → gmailMailService
                                              │
                                    mailThreadService (one thread list)
                                              │
                                        attachmentService
```

- `lib/mail/transport.ts` — pure. Decides the transport AND produces the
  compose banner, so the label and the routing cannot disagree.
- The sidebar's **Internal** and **External** views filter on `transport`; the
  Inbox, Sent, Drafts, Trash and Search do not. Transport is a property of a
  message, not a partition of the mailbox.
- Typing a colleague's own work address resolves to that **employee**, so it
  sends internally rather than leaving through Gmail and coming back — which
  would lose their profile and their Cowork notification.

---

## 3. Schema mapping

`lib/domain/mail.ts`. Every relationship is an id, every timestamp an ISO
string, nothing depends on client ordering — so the move to SQL is mechanical.

| Legacy | New | Note |
|---|---|---|
| `cowork_mails.{from,to}` (employee ids) | `MailMessage.from` / `.to` as `MailParty[]` | One shape covers employees and addresses |
| *(none — Gmail had no local record)* | `MailMessage.transport` | `internal` \| `gmail` |
| Gmail `threadId` | `MailThread.gmailThreadId` | Null internally; how a later Gmail reply rejoins its thread |
| Gmail `id` | `MailMessage.gmailMessageId` | |
| `cowork_mails.readBy[]` | `MailMessage.readBy[]` | → `mail_message_state(messageId, employeeId)` in SQL |
| Folder as a field | `trashedBy[]` / `archivedBy[]` / `sentAt` | Per-person and soft. Trash is a view, never a delete |
| Upload routes | `MailAttachment` | Synthetic `storageKey`, like every Cowork attachment |

**Future database path.** `MailThread`, `MailMessage`, `MailAttachment` become
three tables with two foreign keys. The four `*By[]` arrays become one
`mail_message_state` table keyed by `(messageId, employeeId)` — the only shape
change, and it is the standard denormalisation for a per-person mailbox.

---

## 4. API mapping

| Legacy | New |
|---|---|
| Client → Firestore `cowork_mails` | `CoworkRepository` mail methods (no direct store access from components) |
| `POST /cowork/gmail/send` | `gmailMailService`, server-side only |
| `GET /cowork/gmail/messages` | `gmailMailService.sync()` → unified threads |
| `/cowork/employee/list-members` | Existing `listEmployees()` |
| `cowork_notifications` | Existing `#notify` |

---

## 5. BLOCKER — the Gmail transport cannot authenticate

The brief specifies `GOOGLE_SERVICE_ACCOUNT_KEY`
(`grav-cowork@grav-cms-38f45.iam.gserviceaccount.com`) for Gmail. **A service
account cannot send Gmail this way.** Verified against Google's live endpoints
on 2026-07-28:

```
[1] SA's own identity, gmail.send scope   → token OK
    → GET gmail/v1/users/me/profile       → HTTP 400 "Precondition check failed"
[2] impersonating ray@grav.in             → HTTP 401 "unauthorized_client"
```

- **[1]** A service account has **no Gmail mailbox**. It can mint a token for
  the scope and every Gmail call then fails — `failedPrecondition` is exactly
  that.
- **[2]** Sending *as a person* requires **domain-wide delegation**.
  `unauthorized_client` is the specific error for DWD not being configured.

**What unblocks it** — a Google Workspace super-admin action, not a code change:

1. Admin Console → Security → Access and data control → **API controls** →
   Domain-wide delegation.
2. Add the service account's **OAuth client ID** with scopes
   `https://www.googleapis.com/auth/gmail.send` and `.../gmail.readonly`.
3. `grav.in` must be a **Google Workspace** domain. Consumer `gmail.com`
   accounts can never be impersonated.
4. Code then signs a JWT with `sub: "<real-user>@grav.in"`.

**Legacy did not use a service account** — it used a per-employee OAuth2
refresh token per mailbox. That still works and needs no Workspace admin, at
the cost of each person connecting their own Gmail once. It is the fallback if
DWD is not available.

Until one of those is resolved, `gmailAvailable` is false: external sends are
**refused with a reason and kept as drafts**, and internal mail is unaffected.
Nothing pretends to have sent.

---

## 6. Status

**Built and verified:** the schema, the transport decision, and its tests
(9 tests, part of `npm run verify`).

**Not built:** the repository methods, the four services, and the `/mail` UI.
The external half is blocked on §5, and building the internal half alone would
have shipped the two-system split this spec exists to remove.
