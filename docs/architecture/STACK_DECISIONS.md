# Stack Decisions — legacy vs current vs production

Companion to `DATABASE_MIGRATION_BLUEPRINT.md`. That document covers *what the
data looks like*; this one covers *what we run it on*.

Principle: **keep the ecosystem choices that were sound, rebuild the
implementations that were not.** Legacy is a reference for business intent and
for which vendors were already paid for and integrated — not for architecture.

---

## 1. Old Cowork — what was used and why

### Backend (Express, ~34 runtime deps)

| Technology | Why it was there | Verdict |
|---|---|---|
| **Express + Node** | The API | **Replace** — Next.js route handlers already serve this role; a second HTTP server is a second deployment |
| **MongoDB + Mongoose** | HR/ERP: `Employee`, `Attendance`, `C4Config`, 53 models | **Migrate off, keep as a source** — the ERP half (42 CMS models) is a different product |
| **firebase-admin (Firestore)** | The *entire* workspace domain, ~25 `cowork_*` collections | **Replace at runtime, keep for migration** — see §3 |
| **jsonwebtoken + bcryptjs** | Custom auth middleware | **Already replaced** — scrypt + HMAC-signed httpOnly cookies, no dependency |
| **socket.io + ws** | Realtime chat/presence | **Replace** — see §4 |
| **livekit-server-sdk** | Meetings, screen monitoring | **KEEP** — already in use and correct |
| **googleapis** | Gmail, Drive | **KEEP the service, drop the SDK** — the Gmail integration uses four documented REST endpoints via `fetch`; the whole SDK is more to patch in a module that handles credentials |
| **cloudinary + multer** | File uploads | **Replace** — see §5 |
| **node-cron** | Scheduled jobs | **Replace** — see §4 |
| **web-push, expo-server-sdk** | Push notifications | **Defer** — real requirement, no consumer yet |
| **@google/genai** | Meeting summaries, Ask-AI | **KEEP** — already present as `@google/generative-ai`. D22 caps how far it goes |
| **pdfkit, docx, exceljs, xlsx** | Report export | **Defer** — belongs to the ERP half |

### Frontend (Next.js, ~60 runtime deps)

| Technology | Why | Verdict |
|---|---|---|
| **firebase (client SDK)** | Direct Firestore reads *and writes* from the browser | **Replace — this is the architectural sin.** Every unchecked write traces to it |
| **Radix UI** (28 packages) + cva/clsx/tailwind-merge/vaul/cmdk/sonner | Component primitives | **Do not reintroduce.** Cowork's design system is built and documented in `DESIGN.md`; adding a headless kit now means two vocabularies |
| **@tanstack/react-query** | Server-state caching | **Reconsider at Phase 4** — `useQuery`/`useAction` in `lib/hooks/useRepository.ts` cover today's needs. Worth adopting *if* real network latency makes cache invalidation the hard problem |
| **react-hook-form + zod** | Forms and validation | **Adopt zod, skip RHF.** Validation predicates are already pure functions; zod would give them runtime parsing at the API boundary. Forms are controlled and small |
| **@react-oauth/google** | Google sign-in | **Not needed** — the OAuth flow is server-side by design; the client never touches a token |
| **socket.io-client** | Realtime | **Replace** — §4 |
| **react-dnd** (3 packages) | Drag and drop | **Not needed** — native HTML5 DnD already does the priority reorder |
| **moment** | Dates | **Do not reintroduce** — deprecated; `lib/format.ts` covers what is used |
| **three, recharts, html2canvas, jspdf, jsbarcode, dxf-parser…** | ERP features | **Out of scope** |

---

## 2. Current Cowork — the existing stack

**9 runtime dependencies.** Next.js 16 (App Router, Turbopack), React 19,
TypeScript, Tailwind v4, the four LiveKit packages, `@google/generative-ai`,
`server-only`.

Auth, crypto, storage and persistence are **all Node built-ins or hand-written
behind interfaces**: scrypt password hashing, HMAC-signed sessions,
AES-256-GCM at rest, a file-backed `IdentityStore`.

Two properties worth protecting:

- **`CoworkRepository` is a real seam.** A production backend implements the
  interface; nothing above it changes. This was designed for exactly this move.
- **The business rules are already pure functions** — `lib/auth/*`,
  `lib/tasks/*`, `lib/meetings/access.ts`, `lib/mail/transport.ts`. They run
  server-side unchanged.

The leanness is a feature. Every dependency added to a codebase that handles
credentials and payroll-adjacent scoring is attack surface and patch burden.

---

## 3. The database decision

**Recommend PostgreSQL.** Not because Firestore is bad, but because the domain
stopped being document-shaped:

- **The reporting closure is a recursive graph walk.** `closureOf()` walks
  transitively and governs every visibility rule in the product. That is a
  `WITH RECURSIVE` query, and it is the single hottest read.
- **24 arrays become join tables** (blueprint §3.3), several carrying their own
  columns — `task_assignment` has `rank` and `is_score_subject`.
- **Constraints the application should not be trusted with**: at most one live
  primary reporting line, append-only audit tables, an immutable score ledger.
  Postgres expresses these; Firestore cannot.
- **Time-bounded relationships and multi-tenant isolation** want row-level
  security, not client-side filtering.

**Firestore's real failure in legacy was not Firestore** — it was *browser-direct
writes with authorisation delegated to security rules that were never in the
repository*. Keeping Firestore behind a proper server would have been defensible.
But the shape of the data has moved, so this is a genuine fit decision rather
than a reaction to the old bug.

**Supabase is the recommended concrete form** — it is Postgres, so nothing here
is a lock-in bet, and it supplies the three things otherwise hand-rolled:
row-level security (tenant isolation), realtime over Postgres replication (§4),
and S3-compatible object storage (§5).

**Keep `firebase-admin` and `mongodb` as one-time migration dependencies**, in a
`scripts/migrate/` directory, never in the runtime bundle. Legacy data lives in
both and has to come across.

---

## 4. Realtime and background work

Legacy used **socket.io + ws** for presence/chat and **node-cron** for
schedules. Both were reasonable for a long-lived Express process; neither
survives serverless deployment.

Currently there is **no realtime at all** — `PriorityAckGate` polls every 2.5s
and Gmail sync is a button. Both were deliberate stand-ins.

Recommended:
- **Postgres logical replication / Supabase Realtime** for presence, mail and
  notifications. It replaces socket.io *and* the polling, with one subscription
  model and no second stateful service.
- **A queue for background jobs** (Gmail sync, score recomputation, deadline
  cascades). `gmailSyncService` was written caller-agnostic for this.
- **Keep LiveKit** for media. It is the right tool, already integrated, and the
  token routes are correct.

---

## 5. Files and storage

Legacy used **Cloudinary + multer**. Current `Attachment.storageKey` is a
synthetic handle documented as "never a real upload".

Recommend **S3-compatible object storage with presigned URLs** — bytes never
pass through the application server. Cloudinary is justified only if image
transformation is a real requirement; for PDFs and DOCX (emergency evidence,
task attachments) it is a media CDN doing a filing cabinet's job.

---

## 6. Authentication — already ahead of legacy

Legacy: Firebase Auth + `jsonwebtoken` + `bcryptjs` + role strings compared
inline (`role !== "ceo" && role !== "tl"`).

Current: scrypt at OWASP parameters, HMAC-signed httpOnly session cookies, a
server-side session store, and a capability × scope model with an administrative
floor.

**Keep as is.** Do not reintroduce Firebase Auth — it would mean two identity
systems again, which is the exact seam causing today's per-browser problems.

The one gap is not auth but *enforcement location*: 30 permission checks run
client-side (blueprint §3.5). Phase 3/4 fixes that by re-running the same pure
predicates on the server.

---

## 7. Recommended production architecture

```
Next.js (App Router)         ← unchanged; one deployment, not two
  ├── Route handlers (API)   ← re-run the pure predicates server-side
  ├── ApiRepository          ← implements CoworkRepository
  │
  ├── PostgreSQL / Supabase  ← workspace + identity, one store, RLS per tenant
  ├── Object storage (S3)    ← presigned uploads
  ├── Queue                  ← Gmail sync, score recompute, cascades
  ├── LiveKit                ← meetings + monitoring          [KEPT]
  ├── Gmail REST (OAuth2)    ← per-employee tokens, sealed    [KEPT]
  └── Gemini                 ← help assistant, opt-in         [KEPT]
```

**Kept from legacy:** LiveKit, Gmail via user OAuth, Gemini, and the business
logic itself.
**Replaced:** Express, Firestore-at-runtime, Firebase client SDK, socket.io,
node-cron, Cloudinary, jsonwebtoken/bcryptjs, Radix, react-query, moment.
**Net new:** Postgres, object storage, a queue.

Dependency count lands around **15–20 runtime**, versus legacy's ~94 across two
repos.

---

## 8. Minimising rewrites

What does **not** change: the domain types, the pure rule modules, every
component, `CoworkRepository`'s shape, the design system, the test suite.

What changes: one new `ApiRepository`, route handlers wrapping predicates that
already exist, and the Phase-1 field additions in the blueprint.

The single highest-value preparatory step remains **`organisationId` on every
workspace entity**. Without it no database is safe to point at; with it, most of
the rest is mechanical.
