# Gmail Integration Spec

Per-employee OAuth2, as legacy did it. **No service account.** The service
account path is dead for Gmail — see `MAIL_MIGRATION_SPEC.md` §5 for the live
verification — and `GOOGLE_SERVICE_ACCOUNT_KEY` is not read by anything here.

---

## 1. OAuth flow

Three-legged OAuth, one connection per employee, initiated by them.

```
Employee → Settings → "Connect Gmail"
   │
   ├─ GET  /api/mail/gmail/connect
   │     server builds Google's consent URL
   │     · access_type=offline   ← without this Google returns no refresh token
   │     · prompt=consent        ← without this a re-connect returns none either
   │     · state=<HMAC-signed, 10-min>  ← binds the callback to this session
   │     → 302 to accounts.google.com
   │
   ├─ Employee consents on Google
   │
   ├─ GET  /api/mail/gmail/callback?code=…&state=…
   │     · verify state signature + expiry + that it names THIS session
   │     · exchange code → { access_token, refresh_token, expiry_date }
   │     · read the granted address from userinfo
   │     · encrypt both tokens, store a GmailConnection
   │     → 302 back to settings
   │
   └─ POST /api/mail/gmail/disconnect
         revoke at Google, then delete the record
```

**Why `prompt=consent` matters.** Google issues a refresh token only on the
*first* authorisation. A person who disconnects and reconnects gets no refresh
token without it, and the connection silently becomes unusable an hour later
when the access token expires. Legacy hit this — hence its error string,
`"No refresh_token returned. Try disconnecting and reconnecting Gmail."`

**Scopes**, the minimum for send + unified inbox:

| Scope | For |
|---|---|
| `gmail.send` | sending |
| `gmail.readonly` | inbox/sent sync |
| `userinfo.email` | recording *which* mailbox was connected |

---

## 2. Schema — `GmailConnection`

Lives in the **server-side identity store**, never the client workspace store.
It holds credentials, and the workspace store is `localStorage`.

| Field | Note |
|---|---|
| `id` | |
| `employeeId` | one connection per employee |
| `email` | the connected Gmail address, from `userinfo` — not typed by hand |
| `accessTokenEnc` | AES-256-GCM |
| `refreshTokenEnc` | AES-256-GCM |
| `expiryDate` | ISO. When the access token dies |
| `scopes` | what was actually granted, which can be less than asked |
| `status` | `active` \| `expired` \| `revoked` |
| `createdAt` / `updatedAt` | |

`status` is a fact, not a guess: `revoked` is written when Google rejects the
refresh token (`invalid_grant`), which is what happens when somebody removes
Cowork from their Google account. The UI then says "reconnect" instead of
failing every send with the same opaque error.

---

## 3. Security model

- **Tokens never reach the browser.** No route returns one. The client learns
  only `{ connected, email, status }`.
- **Encrypted at rest** with AES-256-GCM. The key derives from
  `COWORK_SESSION_SECRET` via HKDF with a distinct `info` label, so the mail
  key and the session-signing key are different keys from one secret — a leaked
  session signature tells you nothing about a mailbox.
- **GCM, not CBC.** Authenticated: a tampered ciphertext fails to decrypt
  rather than decrypting to rubbish that then gets sent to Google.
- **`state` is signed and session-bound**, so a callback cannot be replayed
  against a different account — the OAuth-flow equivalent of CSRF.
- **Production refuses a weak secret**, exactly as `lib/server/session.ts` does.
- Revocation calls Google *before* deleting locally: deleting first would leave
  a live grant nobody can see.

---

## 4. Provider architecture

```
MailProvider (interface)
  send(), fetchThreads(), fetchMessages()
      │
      ├── CoworkMailProvider  — internal, repository-backed
      └── GmailMailProvider   — external, Gmail API
```

The unified layer picks between them with `transportFor(recipients)` from
`lib/mail/transport.ts`. Neither provider knows the other exists, and the UI
knows neither — it talks to the repository. That is what keeps a Gmail outage
from touching internal mail, and what makes background sync a matter of calling
`fetchThreads()` on a schedule instead of a rewrite.

```
lib/mail/gmail/
  gmailAuth.ts    consent URL, code exchange, refresh, revoke
  gmailClient.ts  authorised fetch — refreshes on 401, once
  gmailSendService.ts  RFC-2822 MIME → users.messages.send
  gmailSyncService.ts  list/get → MailThread + MailMessage
```

---

## 5. Migration from legacy

| Legacy | New |
|---|---|
| `cowork_employees/{id}.gmailToken` in Firestore, plaintext | `GmailConnection` in the identity store, AES-256-GCM |
| `google.auth.OAuth2` (`googleapis`) | Direct `fetch` to Google's REST endpoints — no dependency |
| `buildMimeMessage()` | `gmailSendService.buildMime()`, same RFC-2822 shape and `In-Reply-To`/`References` handling |
| Errors to `console.warn` | Typed results the UI renders |
| Two mail pages | One mailbox; transport is a message property |

Legacy stored the refresh token **in plaintext in Firestore**. Anyone with read
access to that collection could send mail as any connected employee. That is the
single most important thing this migration fixes.

---

## 6. Configuration required

Per-employee OAuth needs a **Web application** OAuth client — a different
credential from the service account, and self-service in GCP (no Workspace
super-admin needed):

```
GOOGLE_CLIENT_ID=…
GOOGLE_CLIENT_SECRET=…
GOOGLE_REDIRECT_URI=http://localhost:3000/api/mail/gmail/callback
```

GCP Console → APIs & Services → Credentials → Create OAuth client ID → Web
application, with that exact redirect URI registered. Enable the Gmail API on
the project.

`GMAIL_ENABLED=true` is already set. Until the three above exist,
`gmailAvailable` is false: external sends are refused with a reason and kept as
drafts, and internal mail is unaffected.
