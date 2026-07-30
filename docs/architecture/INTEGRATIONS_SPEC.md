# Integrations Spec — Cowork

**Date:** 2026-07-25
**Purpose:** Document every legacy integration, its actual usage, and its classification for the new system.

Classification: **required** (v1 cannot ship without it) · **optional** (ships behind a flag) · **defer** (post-v1) · **replace** (capability kept, provider changes) · **drop** (excluded).

---

## 1. Summary Table

| Integration | Purpose in Cowork | Class | Owner decision needed |
|---|---|---|---|
| Firebase Auth | Identity, custom claims | **replace or keep** | Yes — see §2.1 |
| Firebase Firestore | Primary Cowork datastore | **replace** | Yes — §2.2 |
| Firebase RTDB | Presence | defer | |
| Firebase Cloud Messaging | Push notifications | required | |
| MongoDB / Mongoose | HR master + SOP ledger | **replace** | Yes — §2.2 |
| Socket.IO | Realtime chat, calls, meetings, typing | required | |
| LiveKit | Meeting audio/video, guest tokens | required | |
| Google Gemini | Meeting summaries, transcript Q&A | **defer — gated** | Yes — §3.1 |
| Google Workspace (Gmail/Calendar/Drive/Tasks/Chat) | Embedded productivity surfaces | **defer — scope decision** | Yes — §3.2 |
| Google Drive | Recording + attachment storage | replace | |
| Cloudinary | Image/media CDN | required | |
| Brevo | Transactional email | required | |
| Web Push (VAPID) | Browser push | defer | |
| Expo Push | Mobile push | **drop** | |
| eTimeOffice | Biometric attendance → C4 | required *(credentials must rotate)* | |
| TeamOffice | Second biometric provider | defer | Yes — §4.2 |
| `grav-office-monitor` Firebase project | Desktop surveillance | **drop** (owner-confirmed) | |
| Setu AA, Tally, GSTIN | ERP accounting | **drop** — never part of Cowork | |
| Supabase | — | **drop** — vestigial, no dependency exists | |

---

## 2. Core Platform

### 2.1 Firebase Auth — *replace or keep*

**Legacy usage.** `signInWithEmailAndPassword` on the client (`lib/coworkAuth.js:7`); server verifies via `auth.verifyIdToken` (`Middlewear/coworkAuth.js:30`). Role carried in custom claims, set by `auth.setCustomUserClaims` (`cowork.js:24`, `:839`). Session revocation via `auth.revokeRefreshTokens`.

**What must change regardless of provider:**
- No unauthenticated bootstrap (`POST /setup/seed-ceo`)
- No plaintext `tempPassword` in the datastore
- No auto-provisioning of a CEO from a claim
- Role in **one** authoritative store, with claims derived — not dual-written
- No email-fallback identity resolution

**Decision:** Firebase Auth is competent and the migration cost of leaving it is real. Keeping it is defensible. But if the datastore moves off Firestore (§2.2), the coupling that made Firebase Auth natural disappears, and the cross-store identity join becomes the same problem in a new place. **OWNER DECISION REQUIRED.**

### 2.2 Datastore — *replace*

**Legacy usage.** The split described in [LEGACY_BEHAVIOUR_SPEC.md](LEGACY_BEHAVIOUR_SPEC.md) §4.2: Firestore holds tasks, employees, groups, messages, meetings, timers and score caches; MongoDB holds the HR master, designations, the reporting chain, attendance and the `Employee.sopPoints` ledger that is the source of truth for C3 and C4. Joined on `employeeId` ≡ `biometricId`.

**Why this must not carry forward:**

| Problem | Evidence |
|---|---|
| No transaction spans the two stores | C1 computes in Firestore, writes its ledger to MongoDB |
| No reconciliation job | Score caches drift silently |
| The join key is a Mongoose **virtual** and is not queryable | `models/Employee.js:457`; broke the timer engine entirely (`timerSop.service.js:14-18`) |
| Firestore query constraints force awkward client-side filtering | `listTasksWithHierarchy` post-filters in the route (`taskForward.js:1328-1346`) |
| Client-side writes to score-relevant collections | Priority, timers, work commits, acknowledgements |
| Ledger nested in a document array; unbounded growth; read-modify-write races | `Employee.sopPoints` |

**Requirement (owner-confirmed):** one authoritative datastore. The immutable score ledger in particular needs transactional appends, efficient range queries by `(employeeId, component, periodKey)`, and enforceable integrity — all of which point to a relational store. See [NEW_COWORK_ARCHITECTURE.md](NEW_COWORK_ARCHITECTURE.md) §1.

### 2.3 Socket.IO — *required*

Realtime chat, typing indicators, call signalling, meeting rooms, recording broadcast, task events. Two `io.on("connection")` handlers are registered (`server.js:79` and `:101`) — one ERP, one Cowork. Only the Cowork handler carries forward.

**Required changes:** authenticate the socket handshake (legacy accepts unauthenticated payloads on call and recording events); scope room membership to permission, not to whatever ID the client sends; make `join_cowork` derive the employee from the verified token rather than from a parameter.

### 2.4 Firebase Cloud Messaging — *required*

`services/fcmPush.service.js`, tokens in `cowork_employees.fcmTokens[]` and `cowork_fcm_tokens`. Saved via `POST /cowork/employee/fcm-token`. Fire-and-forget from both `_notify` and `_notifyMany`. Carry forward; add delivery-failure handling and token pruning, which legacy lacks.

### 2.5 Firebase RTDB — *defer*

Presence only. `FIREBASE_DATABASE_URL` defaults to a **hard-coded project URL** (`config/firebaseAdmin.js:19`). Presence can be served by the Socket.IO layer in v1.

---

## 3. Google

### 3.1 Gemini — *defer, gated on an owner decision*

**Legacy usage.** Two user-facing features:

| Feature | Endpoint | Implementation |
|---|---|---|
| AI meeting summaries | `meetingSummary.routes.js` | Streams recordings from Drive → Gemini File API → `generateContent` |
| Ask-AI over recordings | `POST /cowork/audio/ask/:meetId` (`askAI.routes.js`) | Same pipeline; each question is independent, no memory |

Model fallback chain (`askAI.routes.js:36-40`): `gemini-3-flash-preview` → `gemini-2.5-flash` → `gemini-2.5-flash-lite` → `gemini-2.0-flash`. Files are uploaded to the Gemini File API, polled until `ACTIVE`, then deleted.

**The conflict.** `PRODUCT.md:30` and `:99` state Cowork "is explicitly **not an AI product**" and "must not be presented as one". The owner has since confirmed: *AI meeting assistance may remain optional; Cowork must not be positioned as an AI product.*

**Resolution:** these are permitted as **optional, opt-in features** that must not appear in product narrative, navigation prominence, or interface framing. They are a meeting-notes convenience, not a positioning pillar.

**OWNER DECISION REQUIRED:** does this ship in v1, or post-v1? Recommendation: post-v1 — it is the least load-bearing feature and carries a data-residency question (meeting audio leaves the tenant).

### 3.2 Google Workspace — *defer, scope decision required*

**Legacy usage** (`routes/task_routes/googleWorkspaceRoutes.js`, 26 endpoints):

| Surface | Endpoints |
|---|---|
| Gmail | `inbox`, `unread`, `search`, `message/:id`, `my-inbox`, `all-inbox` |
| Tasks | `lists`, `flat`, `tasks`, `list/:listId`, create, subtask, update |
| Calendar | `calendars`, `events`, `today`, create |
| Drive | `files`, `search` |
| Chat | `spaces`, `spaces/all`, `spaces/:id/messages`, `spaces/:id/members` |
| OAuth | `auth/url`, `auth/callback` — per-employee |

Frontend surfaces: `/coworking/mail`, `/coworking/mail/gmail` (1,593 ln), `/google-task`, `/workspace/google-panel`.

**Problems:**
- **Two overlapping OAuth env sets** — `GOOGLE_CLIENT_*` and `GOOGLE_OAUTH_CLIENT_*`
- **Two service directories** — `routes/services/` and `services/`, both with `googleTasksService.js`
- **Two route files** — `routes/googleWorkspaceRoutes.js` and `routes/task_routes/googleWorkspaceRoutes.js`
- **`gmail/all-inbox`** implies reading *other* employees' mail — a significant privacy surface with no visible scope check
- Building a Gmail client inside Cowork duplicates a tool every user already has

**OWNER DECISION REQUIRED.** Recommended v1 scope: **Calendar (read + create) and Drive (attachment picker) only.** Gmail, Google Tasks and Google Chat are duplicative of the product's own messaging and task surfaces and pull large amounts of code and consent scope for little differentiated value. If a Gmail client is genuinely required, it should be its own decision with its own justification.

### 3.3 Google Drive — *replace*

Used for recordings, pattern uploads (`utils/googleDrivePatternUpload.js` — ERP), voucher uploads (ERP), and task attachments. `GOOGLE_DRIVE_FOLDER_ID`, service-account and OAuth paths both present.

Cowork's own attachments should go to a single first-party store (see §5). Drive remains only as an *optional user-facing picker*, not as Cowork's storage backend.

---

## 4. Attendance / Biometric

### 4.1 eTimeOffice — *required, credentials must be rotated*

`services/BiometricSyncService.js`. Polls `DownloadPunchData`, writes `DailyAttendance`, which drives C4.

**Critical:** working credentials are committed in a comment block:
```
services/BiometricSyncService.js:8-10
  ETIMEOFFICE_URL=https://api.etimeoffice.com/api/DownloadPunchData
  ETIMEOFFICE_USERNAME=<redacted — present in the file>
  ETIMEOFFICE_PASSWORD=<redacted — present in the file>
```
**These must be rotated immediately, independent of this project.** They are not reproduced here and must not be copied into the new system.

Also present as hard-coded fallbacks at `:31-33`, so the service works even with no env configured — meaning a misconfigured deployment silently authenticates with the committed credentials.

**New system:** attendance arrives through a defined ingestion boundary — a provider adapter producing normalised `AttendanceEvent` records. C4 must never read a vendor payload shape directly.

### 4.2 TeamOffice — *defer*

A second provider (`TEAMOFFICE_BASE_URL`, `_CORP_ID`, `_USERNAME`, `_PASSWORD`, `_AUTH_TOKEN`). Whether both run simultaneously is not determinable from the code. **OWNER DECISION REQUIRED:** which provider is live?

### 4.3 Threshold configuration — consolidate

Attendance thresholds are defined in **three** places:
- Env: `LATE_THRESHOLD_MINS`, `EARLY_OUT_THRESHOLD_MINS`, `HALF_DAY_THRESHOLD_MINS`, `SHIFT_START`, `SHIFT_END`
- `C4Config` singleton: `lateThresholdMins`, `earlyThresholdMins`
- `Policy.thresholdMins` per policy record

The new system holds these in **one** versioned scoring-rule record, snapshotted into every ledger entry.

---

## 5. Media and Files

### 5.1 Cloudinary — *required*

Two accounts in legacy: the main one and `OM_*` for Office Monitor (**dropped**). Frontend has `NEXT_PUBLIC_CLOUDINARY_UPLOAD_PRESET` for unsigned uploads **and** `CLOUDINARY_API_KEY`/`API_SECRET` — server secrets in the frontend repository. The new system uses **signed, server-issued upload credentials only**; no secret reaches the browser.

### 5.2 Attachment model

Legacy scatters attachments across `imageUrls[]`, `pdfAttachments[{url,name,embedUrl,downloadUrl}]`, `files[]`, `attachments[]` and `vendorUpdates[].files[]`, with no lifecycle: **deleting a task does not delete its files** (`service:1071`).

New system: one `Attachment` entity with owner, scope, MIME type, size, storage key, virus-scan status and a soft-delete lifecycle tied to its parent.

---

## 6. Email

**Brevo** (`BREVO_API_KEY`), via `services/emailNotifications.service.js` with a per-recipient cooldown, gated by `ENABLE_EMAILS`. Sender identities: `HR_SENDER_EMAIL`, `HR_REPLY_TO_EMAIL`, `CUSTOMER_SENDER_EMAIL` (ERP).

**Carry forward, with fixes:** the route-layer `_notify` never sends email while the service-layer `_notifyMany` does ([LEGACY_BEHAVIOUR_SPEC.md](LEGACY_BEHAVIOUR_SPEC.md) §3.1), so the same event class is emailed or not depending on which layer raised it. One notification pipeline, one policy.

---

## 7. Push

| Channel | Class | Notes |
|---|---|---|
| FCM | required | Primary |
| Web Push (VAPID) | defer | `VAPID_EMAIL` and `VAPID_SUBJECT` overlap — consolidate |
| Expo | **drop** | No mobile app in scope; `Appversion.js` and `APP_MIN_VERSION`/`APP_LATEST_VERSION` imply one exists outside these repos |

---

## 8. Meetings — LiveKit — *required*

`LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`; client via `NEXT_PUBLIC_LIVEKIT_URL`. Room tokens, guest tokens (`POST /cowork/public/guest-join`), recording control over Socket.IO.

**Required changes:** guest tokens must be single-use, scoped to one meeting, and expiring — legacy's `GET /public/meeting-info/:token` and `POST /public/guest-join` are unauthenticated by design and their token lifecycle is not enforced in the reachable code.

---

## 9. Dropped

| Integration | Reason |
|---|---|
| **Office Monitor** (`grav-office-monitor` Firebase project) | Owner-confirmed exclusion. Desktop screenshot capture, application categorisation, tamper detection. Config hard-coded in `lib/liveScreenshot.js:6-13`. Separate Cloudinary account `OM_*`. Frontend surfaces `/coworking/office-monitor[/[id]]` |
| **MRF** (material requests) | Owner-confirmed. ERP leakage into the Cowork frontend |
| **Setu AA** | ERP accounting |
| **Tally** (importers, mappers, trial balance, day book, B-sheet) | ERP accounting |
| **GSTIN lookup** | ERP tax |
| **Supabase** | `SUPABASE_PONG_CHANNEL`, `SUPABASE_SNAKE_CHANNEL` exist as env references with **no Supabase dependency** in `package.json`. Vestigial |
| **Barcode scanner hardware** | ERP manufacturing |

---

## 10. Credentials — Do Not Copy

Present in the legacy repositories and **excluded from the new system**:

| Item | Location | Action |
|---|---|---|
| eTimeOffice username and password | `services/BiometricSyncService.js:8-10`, fallbacks at `:31-33` | **Rotate immediately** |
| `grav-office-monitor` Firebase web config | `lib/liveScreenshot.js:6-13` | Project dropped |
| Default RTDB URL | `config/firebaseAdmin.js:19` | Must be configuration |
| `FIREBASE_PRIVATE_KEY`, `GOOGLE_SERVICE_ACCOUNT`, `CLOUDINARY_API_SECRET`, `OM_CLOUDINARY_API_SECRET` in the **frontend** repo | frontend env surface | Server-side only |
| `ACCOUNTANT_AUTH_BYPASS` | ERP | Never introduce an auth-bypass flag |

**No `.env.example` exists in either repository.** Every environment variable was recovered by static analysis ([LEGACY_AUDIT.md](LEGACY_AUDIT.md) §9). The new system ships a complete, documented `.env.example` with no real values.

---

## 11. Integration Boundaries

Every external system sits behind an adapter. No domain code imports a vendor SDK directly.

```
Domain ──► Port (interface)          ──► Adapter (vendor)
─────────────────────────────────────────────────────────
Identity      IdentityProvider           Firebase Auth | other
Persistence   Repository per aggregate   one datastore
Notification  NotificationChannel        FCM | Brevo | Socket.IO
Media         MediaStore                 Cloudinary
Realtime      RealtimeGateway            Socket.IO
Meetings      MeetingProvider            LiveKit
Attendance    AttendanceSource           eTimeOffice | TeamOffice
Calendar      CalendarProvider           Google Calendar
AI (optional) SummaryProvider            Gemini
```

**Why this matters concretely:** legacy's C4 engine reads `DailyAttendance` documents whose shape is dictated by the eTimeOffice payload. Changing provider means rewriting the scoring engine. With an `AttendanceSource` port emitting normalised `AttendanceEvent`s, it means writing one adapter.

---

## 12. Owner Decisions Required

| # | Decision | Recommendation |
|---|---|---|
| I1 | Keep Firebase Auth, or move identity with the datastore? | Decide together with I2 |
| I2 | Which single authoritative datastore? | Relational — the ledger needs transactional appends and range queries |
| I3 | Do AI meeting features ship in v1? | Post-v1, opt-in, never in positioning |
| I4 | Google Workspace v1 scope? | Calendar + Drive picker only |
| I5 | Is a Gmail client genuinely required? | Recommend dropping |
| I6 | Is `gmail/all-inbox` (reading others' mail) intended? | Needs an explicit privacy decision |
| I7 | eTimeOffice or TeamOffice — which is live? | |
| I8 | Meeting recording retention and residency? | Especially if Gemini processes them |
| I9 | Web push in v1, or FCM only? | FCM only |
| I10 | Does a mobile app exist that consumes this API? | `expo-server-sdk` and `Appversion.js` suggest yes; not in these repos |
