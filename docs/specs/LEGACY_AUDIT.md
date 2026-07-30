# Legacy Audit — Cowork

**Date:** 2026-07-25
**Auditor scope:** read-only analysis of `cowork-old-frontend` (250 files) and `cowork-old-backend` (361 files), compared against `PRODUCT.md` and the new `cowork` project.
**Status:** Audit only. No code was modified. Migration has not begun.

---

## 0. Executive Summary

### 0.1 What the legacy system actually is

The legacy backend is **not a Cowork backend**. It is a single Express monolith (`grav-backend`) serving an entire garment-manufacturing ERP — accounting, inventory, manufacturing, QC, dispatch, sales/CRM, HR, payroll, vendor and customer portals, and barcode-scanner hardware. Cowork is **one module inside it**, mounted under the `/cowork` path prefix.

Of 174 route mounts in `server.js`, **20 are Cowork**. Of ~110 Mongoose models, **roughly 8 are Cowork-relevant**. The other ~90% is ERP that has no place in the new product.

The legacy frontend is narrower: `app/coworking/*` is essentially all Cowork, plus a small amount of leaked ERP surface (`mrf/`, `lib/patternGradingEngine.js`).

**Consequence for migration:** this is not a port. It is an **extraction**. The single most important scoping decision in this audit is drawing the line around `/cowork` and the Firestore `cowork_*` collections and leaving the ERP behind.

### 0.2 The architecture nobody wrote down

Cowork runs on a **split datastore**, and this is the defining technical fact of the legacy system:

| Concern | Store |
|---|---|
| Identity, auth | **Firebase Auth** (custom claims) |
| Employees, tasks, groups, messages, meets, notifications, timers, C1/C2 score caches | **Firestore** (`cowork_*` collections) |
| HR employee master, designations, reporting chain, attendance, payroll, **SOP points ledger (C3 + C4 source of truth)** | **MongoDB** (Mongoose) |
| Live meetings | **LiveKit** |
| Media | **Cloudinary** + **Google Drive** |
| Desktop surveillance | **A second, separate Firebase project** (`grav-office-monitor`) |

The join key between Firestore and MongoDB is `employeeId`, which **is** the HR `biometricId` (`models/Employee.js:457` exposes `employeeId` as a read-only virtual over `biometricId`). It is not queryable in Mongo — a fact that silently broke the timer engine for an unknown period (`services/timerSop.service.js:14-18`).

Every performance score is a **dual-read across both databases with no transaction**. C1 lives in Firestore but writes its ledger entries into MongoDB `Employee.sopPoints`. C3 and C4 are computed entirely from that MongoDB array. There is no reconciliation and no consistency guarantee.

### 0.3 The five "explicitly undecided" items in PRODUCT.md are all decided in legacy code

This is the highest-value finding in the audit. `PRODUCT.md:85-92` lists five open questions. **Four are implemented in legacy code, and the fifth is partly implemented.** They were decided in code and never written down.

| PRODUCT.md says undecided | Legacy reality | Source |
|---|---|---|
| C1–C4 weight values | C1 max 35, C2 max 30; **quarterly weights Q1 10% / Q2 20% / Q3 30% / Q4 40%** | `services/pmpService.js:20`, `models/BandConfig.js:17,25` |
| What qualifies as a C3 breach + magnitude | SOP severity tiers: `minor`, `moderate`, `serious`, `falsification`, `idle_pool`, each with a point value, referencing "PDF §3.4 C3 table" | `models/sopmodel/sop_model.js:8-14` |
| How C4 attendance is measured | Points-per-day model: +1/day present, −1 late (>15 min), −3 absent, −1 early departure | `models/HR_Models/C4Config.js:23-32` |
| Whether C2 can exceed target | No — capped by a hard 100% weightage pool with pre-creation validation | `routes/task_routes/c2Band.routes.js:189-233` |
| The scoring period | **Quarterly**, with a weighted annual roll-up; C2 is annual-running | `services/pmpService.js:20,71-79,439-508` |

There is also an **external authoritative spec** the code repeatedly cites but which is not in either repo:

- **`CW-DEV-PMP-01 v1.0, June 2026`** — the PMP scoring specification (`services/pmpService.js:8`). Referenced by section: "PDF Section 03" (quarter weights), "Section 05" (gap to next rating), "Section 09" (dashboard flags).
- **"PDF §3.4 C3 table"** — the C3 severity/deduction table (`models/sopmodel/sop_model.js:8`).

**Recommendation:** obtain `CW-DEV-PMP-01 v1.0` before any scoring work. It is the actual product specification for the scoring engine, and `PRODUCT.md` currently contradicts it (see §11).

### 0.4 Headline risks

1. **Live credentials in source.** `services/BiometricSyncService.js:8-10` contains working eTimeOffice credentials in a comment block. These must be rotated regardless of migration.
2. **Three route files fight over the same URLs.** `taskForward.js`, `coworkEnhanced.js`, and `taskTree.routes.js` are all mounted at `/cowork` and collectively define `POST /task/create` and ~30 other identical paths. Express first-match means ~96KB of `taskTree.routes.js` is unreachable.
3. **The composite score can go negative and exceed the documented model.** `computeBaseScore` returns `mean(C1,C2,C4) + C3` with no floor and no cap (`services/pmpService.js:417-424`), directly contradicting `PRODUCT.md:59` ("floors at 0% and caps at 100%").
4. **C1's extension deduction is multiplied by zero.** `services/c1Service.js:63` reads `- 0 * extensionsFiled`. The configured deduction never applies at task-score level.
5. **No client-side route guard.** `app/coworking/layout.js:36` renders children when `!user` instead of redirecting.
6. **Employee desktop surveillance.** Office Monitor captures screenshots and categorises application usage, flagging Terminal/VPN/screen-recorder as suspicious. It is a significant product, legal, and ethical decision whether this migrates at all.

---

## 1. Complete Feature Inventory

### 1.1 Tasks — the core module

By far the largest and most sophisticated area. `app/coworking/tasks/page.js` alone is **10,794 lines**.

**Task types**
- Standard assigned task
- **Folder** task (`isFolder`) — grouping container
- **Subtask** — arbitrary-depth hierarchy via `parentTaskId`
- **Repeat** task (`isRepeat` + `repeatConfig`) with a confirm/submit cycle
- **Third-party** task (`isThirdParty` + `thirdPartyConfig`) — external vendor work with a payment-action step
- **Goal / Gold task** (`isGoal`, `isGoldTask` + `c2Config`) — the C2 vehicle, with `goalActivities` components, per-component deadlines, and multi-user variants (`isMultiUserGold` + `perUserStatus`)
- **Self-assigned** task (`isSelfAssigned`) requiring approver sign-off

**Lifecycle states observed** (`open`, `pending`, `in_progress`, `submitted`, `done`, `cancelled`, `approved`, `rejected`, `pending_tl_approval`, `pending_tl_hours`, `pending_tl_review`, `pending_ceo_review`, `pending_department_approval`, `pending_approval`, `pending_deadline_approval`, `deadline_approved`, `repeat_pending_confirmation`, `repeat_active`, `confirmed`)

**Deadline negotiation** — a full multi-round protocol, and the richest single workflow in the system:
1. Creator sets a fixed deadline, or a timer window (`senderTimerWindowSecs`), or leaves it open
2. Employee proposes a deadline (`propose-deadline`)
3. TL approves / rejects the sender timer, or counters (`tl-counter-deadline`)
4. Employee responds to the counter (`respond-tl-counter`)
5. Employee confirms and starts
6. Employee may request an extension (`request-deadline-extension`)
7. TL reviews the extension and **chooses whether to waive the C1 penalty** — waiving sets `c1.officialDeadline` so the new date becomes the scored deadline

**Completion & review**
- Submit completion with message, images, PDF attachments
- TL review → approve / **rework** (loops back, increments `c1.reworksReceived`) / reject
- Optional second-stage CEO review
- Daily reports against a task
- Parent-progress roll-up

**Supporting**
- Task chat threads + **draft chat** (autosaved unsent drafts, `draft_chat`)
- Priority management with acknowledgement (`PriorityChangeAckModal`, `PrioritySwapPanel`) and a P1 conflict checker
- Task forwarding with a **forward budget**
- Move to folder, edit details, reset to draft
- Work commits + timers (`cowork_task_timers`, `cowork_work_commits`, `cowork_timer_events`)
- Workload calendar and capacity view

### 1.2 Performance / PMP ("My Score")

- Per-quarter C1, running C2, per-quarter C3 and C4
- Composite quarter score, live annual, projected annual
- Rating bands: ≥95 Exceptional, ≥85 Strong, ≥70 Solid, ≥50 Developing, <50 Critical (`services/pmpService.js:48-60`)
- Gap-to-next-rating
- Dashboard flags: `PACE-CRITICAL`, `PACE-WARNING`, `C2-WARNING`, `ANNUAL-CRITICAL`, `ON-TRACK`
- Per-task C1 breakdown; per-component C2 breakdown
- Band configuration (role bands mapping designations → per-band C1–C4 maxima)

### 1.3 SOP / Compliance

- SOP catalogue with folders, approval workflow (`pending` → `approved`/`rejected`), severity tiers
- **Bleach ledger** — the points ledger written to `Employee.sopPoints[year].bleaches[]`
- **Recheck** — employee disputes a deduction; reviewer confirms or overturns
- Task suggestions derived from attendance signals, with dismissal
- Timer-SOP engine — converts accumulated work deficit/overtime into SOP points

### 1.4 Messaging

- Direct messages (1:1) with conversations list
- Group messaging
- Media messages (images, files, audio) via Cloudinary + Drive
- Reply-to, swipeable message actions, link detection, lightbox
- Typing indicators, read state
- Audio calls with global incoming-call receiver, ringing toast, accept/reject/end, rejoin

### 1.5 Meetings

- Schedule, edit, cancel meetings with participants
- In-app meeting room via LiveKit + PiP controls
- **Guest join by token** (`/coworking/join/[token]`) with guest sessions
- Recording (start/pause/stop) with participant notification
- **Transcription** and **AI meeting summaries** via Gemini
- **"Ask AI" over meeting audio** — question-answering across recordings
- Summary export to DOCX

### 1.6 Mail & Google Workspace

- Gmail inbox, unread, search, message detail; "my inbox" and "all inbox" variants
- Google Tasks — lists, flat view, create, subtasks, update
- Google Calendar — calendars, events, today, create
- Google Drive — files, search
- Google Chat — spaces, messages, members
- OAuth connect flow per employee

### 1.7 Employees & Admin

- Create employee (picks a `biometricId` from the HR MongoDB pool), auto temp password, welcome email
- List / view / delete employees
- Change role, change department, change employee ID (destructive doc copy+delete)
- Reset password with forced session revocation
- Change own email/password
- Duty status toggle (on/off duty), team status widget
- "My managers" — reads the reporting chain from HR MongoDB

### 1.8 Groups

- Create/update/delete groups, add/remove members, group chat, group task manager

### 1.9 Office Monitor (surveillance)

- Desktop agent reporting per-device activity to a **separate Firebase project**
- Application categorisation (Video, Social Media, Development, Work—Document, AI Tool, …)
- Explicitly flagged categories: Terminal, System Tool, Virtual Machine, Screen Recorder, VPN, Remote Desktop
- Live screenshots
- Agent tamper detection: `UNINSTALLED`, `PROCESS_KILLED_OR_STOPPED`, `MANUALLY_STOPPED_VIA_CMD`, `AGENT_CRASHED`, `LAPTOP_SLEEP`
- Device online/warning/offline heartbeat

### 1.10 Other

- Notifications (in-app, FCM push, web push, Expo push, email)
- Emergency approvals panel
- Notes sidebar
- Docs / documentation page
- MRF (Material Request Form) — **ERP leakage into the Cowork frontend**
- Status tracking, welcome celebration, join codes

---

## 2. Routes / Pages

### 2.1 Frontend pages

| Route | File | Purpose | Role gate |
|---|---|---|---|
| `/` | `app/page.js` | Login (Firebase email/password) | public |
| `/coworking` | `app/coworking/page.js` (1,650 ln) | Dashboard | all |
| `/coworking/tasks` | `tasks/page.js` (10,794 ln) | Task workspace — the monolith | all |
| `/coworking/direct-messages` | `direct-messages/page.js` (2,491 ln) | DM list | all |
| `/coworking/direct-messages/[conversationId]` | `[conversationId]/page.js` | DM thread | all |
| `/coworking/audio-call/[convId]` | `audio-call/[convId]/page.js` | Audio call room | all |
| `/coworking/groups` | `groups/page.js` (1,461 ln) | Group list | all |
| `/coworking/create-group` | `create-group/page.js` | Group creation/admin | CEO/TL |
| `/coworking/schedule-meet` | `schedule-meet/page.js` (1,777 ln) | Meetings list | all |
| `/coworking/schedule-meet/new` | `new/page.js` | Create meeting | CEO/TL |
| `/coworking/cowork-meeting/[meetId]` | `[meetId]/page.js` | Meeting room | participants |
| `/coworking/join/[token]` | `join/[token]/page.js` | **Guest meeting join** | public (token) |
| `/coworking/mail` | `mail/page.js` (1,376 ln) | Mail | all |
| `/coworking/mail/gmail` | `gmail/page.js` (1,593 ln) | Gmail client | all |
| `/coworking/calendar` | `calendar/page.js` | Workload calendar | CEO/TL |
| `/coworking/calendar/[employeeId]` | `[employeeId]/page.js` | Per-employee workload | CEO/TL |
| `/coworking/pmp` | `pmp/page.js` | **"My Score"** | all |
| `/coworking/sop` | `sop/page.js` (3,171 ln) | SOP & compliance | all (write: CEO/TL) |
| `/coworking/status-tracking` | `status-tracking/page.js` (1,708 ln) | Team status | CEO/TL |
| `/coworking/office-monitor` | `office-monitor/page.js` | Device surveillance list | CEO |
| `/coworking/office-monitor/[id]` | `[id]/page.js` | Per-device detail | CEO |
| `/coworking/create-employee` | `create-employee/page.js` | Employee admin | CEO |
| `/coworking/task-settings` | `task-settings/page.js` | Task/scoring settings | CEO |
| `/coworking/settings` | `settings/page.js` | Own profile | all |
| `/coworking/docs` | `docs/page.js` | Documentation | all |
| `/coworking/mrf` | `mrf/page.js` | **Material requests (ERP leak)** | all |
| `/coworking/fix-priorities` | `fix-priorities/page.js` | **Debug/repair utility** | — |
| `/google-task` | `app/google-task/page.js` | Google Tasks standalone | all |
| `/workspace/google-panel` | `google-panel/page.js` | Google Workspace panel | all |
| `/privacy` | `privacy/page.js` | Privacy policy | public |

Navigation is defined at `components/coworking/layout/CoworkingShell.js:2391-2406`.

**Route-guard gap:** `app/coworking/layout.js:36` — `if (!user) return children;`. Unauthenticated users are not redirected; the page component renders and only fails when its API calls 401.

### 2.2 Frontend API routes (Next.js)

| Route | File |
|---|---|
| `POST /api/cloudinary/upload` | `app/api/cloudinary/upload/route.js` |
| `POST /api/delete-screenshot` | `app/api/delete-screenshot/route.js` |
| `POST /api/upload-to-drive` | `pages/api/upload-to-drive.js` (**Pages Router — orphaned, see §12**) |

---

## 3. API Endpoints

All Cowork endpoints are mounted under the `/cowork` prefix. Non-Cowork ERP endpoints (`/api/cms/*`, `/api/hr/*`, `/api/ceo/*`, `/api/customer/*`, `/api/accountant/*`, …) are **out of scope** and not enumerated.

### 3.1 Mount order in `server.js` — the collision

```
line  432   app.use("/cowork", transcriptModule.router)
line  818   app.use("/cowork/sop", sopRoutes)
line  819   app.use("/cowork", bandConfig.routes)
line 1301   app.use("/cowork", taskForward.js)        ← WINS all shared paths
line 1303   app.use("/cowork", mediaUpload.js)
line 1306   app.use("/cowork", coworkEnhanced.js)     ← shadowed on ~8 paths
line 1315   app.use("/cowork", taskTree.routes.js)    ← shadowed on ~30 paths
line 1318   app.use("/cowork", cowork.js)
line 1320   app.use("/cowork", c2Band.routes)
line 1321   app.use("/cowork", c1Routes)
line 1323   app.use("/cowork", workloadroutes)
line 1324   app.use("/cowork", pmpRoutes)
line 1326   app.use("/cowork", livekit.routes)
line 1328   app.use("/cowork", meetingSummary.routes)
line 1330   app.use("/cowork", audioRecording.routes(io))
line 1335   app.use("/cowork", askAI.routes)
line 2063   app.use("/cowork", timerSop.routes)
```

### 3.2 Identity & employees — `routes/task_routes/cowork.js`

| Method | Path | Auth |
|---|---|---|
| POST | `/setup/seed-ceo` | **none — unauthenticated bootstrap** |
| GET | `/me` | employee |
| GET | `/employee/list-members` | employee |
| GET | `/employee/list` | CEO/TL |
| GET | `/employee/:id` | employee |
| POST | `/employee/create` | CEO/TL |
| DELETE | `/employee/:id` | CEO/TL |
| PATCH | `/employee/:id/update-id` | CEO/TL |
| POST | `/employee/:id/reset-password` | CEO/TL |
| POST | `/employee/:employeeId/change-role` | CEO (checked in body) |
| POST | `/employee/:employeeId/change-department` | CEO (checked in body) |
| GET | `/employee/biometric-ids` | CEO/TL |
| GET | `/employee/my-managers/:employeeId` | employee |
| POST | `/employee/fcm-token` | employee |
| POST | `/change-password` | employee |
| POST | `/change-email` | CEO |
| GET | `/scheduling/blocked-dates` | token only |
| GET | `/test-email` | CEO — **debug endpoint in production** |

### 3.3 Groups, messaging, meets — `cowork.js`

`POST /group/create` (CEO/TL) · `PATCH|DELETE /group/:groupId` (CEO) · `GET /group/list` · `GET /group/:groupId` · `GET /group/:groupId/members` · `POST /group/:groupId/members` (CEO) · `DELETE /group/:groupId/members/:employeeId` (CEO) · `POST|GET /group/:groupId/message[s]` · `POST /group/:groupId/notify`
`POST /direct-message/send` · `POST /direct-message/notify` · `GET /direct-message/conversations` · `GET /direct-message/:convId/messages`
`POST /schedule-meet/create` (CEO/TL) · `GET /schedule-meet/list` · `GET /schedule-meet/:meetId` · `PATCH /schedule-meet/:meetId/edit` (CEO/TL) · `PATCH /schedule-meet/:meetId/cancel` (CEO/TL)
`GET /notifications` · `PATCH /notifications/read-all` · `POST /notify-request-response`
`POST /task/assign` (CEO) · `PATCH /task/:taskId/progress` · `GET /task/list` · `POST /task/:taskId/approve` (TL)

### 3.4 Task engine — `taskForward.js` (authoritative) / `taskTree.routes.js` (shadowed)

Both define: `POST /task/create` · `/task/create-parent` · `/task/:taskId/confirm` · `/self-assign-approve` · `/repeat-confirm` · `/repeat-submit` · `/third-party-update` · `/third-party-complete` · `/third-party-payment-action` · `/goal-update` · `/start` · `/approve` · `/forward` · `/subtask` · `/daily-report` · `/chat` (GET+POST) · `/details` · `/full` · `/daily-reports` · `/deadline` · `DELETE /task/:taskId` · `/submit-completion` · `/rework` · `/extension-deduction` · `/review-completion` · `/ceo-review` · `/parent-progress` · `/thread-message` · `/propose-deadline` · `/approve-sender-timer` · `/reject-sender-timer` · `/approve-deadline` · `/tl-counter-deadline` · `/respond-tl-counter` · `/request-deadline-extension` · `/review-deadline-extension` · `/draft-chat` (GET+POST) · `/update-vendor-config` · `/goal-activities` (GET+POST) · `/goal-activity/:activityId/request-report` · `/goal-activity/:activityId/submit-report` · `GET /task/list-hierarchy`

**Only in `taskForward.js`:** `/department-approve` · `/department-tl-set-hours` · `/forward-budget` (**registered twice in the same file**) · `/move-to-folder` · `/edit-details` · `/reset-to-draft` · `POST /task/p1-conflict-check`

**Only in `taskTree.routes.js`** (therefore the only reachable part of that file): `GET /task/dump/:taskId` (**registered twice**) · `GET /employee/dump/:employeeId` — both debug endpoints.

**Repair/debug endpoints shipped in both:** `GET /task/force-repair-self-assign` · `GET /task/self-assign-debug/:employeeId` · `POST /task/self-assign-repair`

### 3.5 Scoring

**C1** — `GET /c1/config` · `GET /c1/scores/:employeeId` · `GET /c1/scores` (CEO/TL) · `POST /c1/preview` (CEO/TL)
**C2** — `GET /c2/config` · `GET /c2/gold-tasks` (CEO/TL) · `GET /c2/scores/:employeeId` · `GET /c2/scores` (CEO/TL) · `POST /c2/validate-weightage` (CEO/TL)
**PMP** — `GET /pmp/:employeeId/dashboard` · `GET /pmp/:employeeId/c1` · `GET /pmp/:employeeId/c2` · `GET /pmp/employees`
**Bands** — `GET|POST /band-config` · `GET /band-config/designations` · `GET /band-config/employee-bands`
**Timer SOP** — `POST /timer-sop/evaluate` · `GET /timer-sop/accum/:employeeId` · `POST /timer-sop/test-finalize/:employeeId` (**test endpoint in production**)
**Workload** — `GET /workload/summary` · `GET /workload/employee/:employeeId/calendar`

### 3.6 SOP — `/cowork/sop/*`

`GET|POST /folders` · `DELETE /folders/:id` · `GET /` · `GET /all-categories` · `POST /` · `PATCH|DELETE /:id` · `PATCH /:id/approve` · `PATCH /:id/reject` · `POST /bleach` · `GET /bleach/:employeeId` · `GET /recheck/pending-list` · `GET /recheck/pending-count` · `POST|PATCH /bleach/:employeeId/:bleachId/recheck` · `GET /task-suggestions` · `POST /task-suggestions/dismiss` · `POST /goal-credit` · `POST /settings/sync` · `GET /performance-summary`

### 3.7 Meetings, media, AI

`GET /public/meeting-info/:token` (**public**) · `POST /public/guest-join` (**public**) · `POST /audio/guest-finalize` · `GET /audio/summary/:meetId/public` (**public**) · `GET /audio/test-gemini` (**test endpoint**) · `POST /audio/ask/:meetId` · `GET /media/view/:fileId` · `/deadline-availability/blocked-dates`

### 3.8 Google Workspace — `/cowork` (via `task_routes/googleWorkspaceRoutes.js`)

`GET /auth/url` · `GET /auth/callback` · `GET /dashboard` · `GET /tasks/lists` · `/tasks/flat` · `/tasks` · `/tasks/list/:listId` · `POST /tasks` · `POST /tasks/subtask` · `PATCH /tasks/:listId/:taskId` · `GET /gmail/inbox` · `/gmail/message/:id` · `/gmail/unread` · `/gmail/search` · `/gmail/my-inbox` · `/gmail/all-inbox` · `GET /calendar/calendars` · `/calendar/events` · `/calendar/today` · `POST /calendar/events` · `GET /drive/files` · `/drive/search` · `GET /chat/spaces` · `/chat/spaces/all` · `/chat/spaces/:spaceId/messages` · `/chat/spaces/:spaceId/members`

### 3.9 Socket.IO events (`server.js`)

**Two separate `io.on("connection")` handlers are registered** (lines 79 and 101) — see §11.

Handler 1 (ERP): `join-workorder`, `leave-workorder`, `disconnect`
Handler 2 (Cowork): `join_cowork`, `typing`, `join_group`, `leave_group`, `join_dm`, `leave_dm`, `join_meeting_room`, `leave_meeting_room`, `recording_start`, `recording_stop`, call signalling (`call_reject`, `call_end`, `call_rejoin_token`), `workspace-set-online`, `disconnect`

---

## 4. Database Models and Relationships

### 4.1 Firestore — the Cowork store

| Collection | Contents |
|---|---|
| `cowork_employees` | Employee profile. **Doc ID = `employeeId` = HR `biometricId`.** Fields: `authUid`, `name`, `email`, `mobile`, `city`, `department`, `role`, `profilePicUrl`, `fcmTokens[]`, `passwordChanged`, `tempPassword`, `isActive`/`status` |
| `cowork_tasks` | **The central object.** `taskId`, `title`, `description`, `notes`, `requirements`, `assigneeIds[]`, `status`, `priority`, `parentTaskId`, `groupId`, `dueDate`/`fixedDeadline`, `etcHours`, `quarter`, `year`, `isFolder`, `isRepeat`+`repeatConfig`, `isThirdParty`+`thirdPartyConfig`, `isGoal`+`goalConfig`, `isGoldTask`+`c2Config`, `goalActivities[]`, `isMultiUserGold`, `isSelfAssigned`, `visibleTo`, `approverId`, `senderTimerWindowSecs`, `deadlineWindowSecs`, `deadlineExtRequest{}`, `tlReview{}`, `ceoReview{}`, `createdByCeo`, and the embedded **`c1{}`** sub-object |
| `cowork_tasks.c1{}` | `taskScore`, `deadlinesMissed`, `extensionsFiled`, `reworksReceived`, `rejectionsReceived`, `c1Status`, `isExcluded`, `isRejected`, `officialDeadline`, `scoreCalculatedAt` |
| `cowork_groups` | `name`, `description`, `memberIds[]`, `createdBy` |
| `cowork_conversations`, `cowork_direct_messages` | DM threads and messages |
| `chat`, `messages`, `draft_chat` | Task chat threads and unsent drafts |
| `cowork_scheduled_meets`, `cowork_meeting_participants`, `cowork_guest_sessions`, `cowork_join_codes` | Meetings and guest access |
| `meeting_audio_recordings`, `meeting_summaries`, `meeting_transcripts`, `meeting_gemini_files` | Recording/AI pipeline |
| `cowork_notifications`, `cowork_fcm_tokens` | Notifications |
| `cowork_c1_scores`, `cowork_c2_scores` | **Denormalised score caches** keyed by `employeeId` |
| `cowork_sop_settings/task_events` | **Live C1/C2 tuning config** (`c1MaxPoints`, `c1BaseScore`, `c1DeadlineDeduction`, `c1ExtensionDeduction`, `c1ReworkDeduction`, `c1RejectScore`, `c2GlobalMaxPoints`) |
| `cowork_sop_applied` | Applied SOP records |
| `cowork_task_timers`, `cowork_work_commits`, `cowork_timer_events` | Time tracking |
| `cowork_settings` (`/office`) | Office hours, `outTime`, weekly-off schedule |
| `cowork_meta/counters` | Sequence counters: `employeeSeq`, `groupSeq`, `taskSeq`, `meetSeq` |
| `cowork_duty_status`, `cowork_requests`, `cowork_notes`, `cowork_mails`, `cowork_goal_status`, `cowork_emergency_approvals` | Supporting features |

### 4.2 MongoDB — Cowork-relevant models

| Model | Role in Cowork |
|---|---|
| `Employee` (`models/Employee.js`) | **The bridge.** `biometricId` (unique, indexed) joins to Firestore. `designation` drives band lookup. `primaryManager`/`secondaryManager` are the reporting chain. **`sopPoints[]` is the C3 + C4 source of truth.** |
| `Employee.sopPoints[]` | `{ year, totalDeducted, bleaches[] }`. Each bleach: `sopName`, `type` (`C1`\|`C2`\|`C3`\|`C4`), `points` (always positive), `bleachType` (`credit`=penalty, `debit`=reward), `isCredit`, `folderName`, `description`, `date`, `cutBy`, `cutByName`, `cutByRole`, `taskId`, `policyId`, `recheck{}` |
| `BandConfig` | Singleton. `bands{}` (designation → C1–C4 maxima) + `globalSettings` defaults |
| `Sop`, `SopFolder` | SOP catalogue with `severity` tiers |
| `Policy` (`HR_Models/Policy.js`) | **Hard-locked to category `C4`** (`enum: ["C4"]`). Attendance triggers: `absent_no_notice`, `late_arrival`, `early_departure`, `present_on_time`, `manual` |
| `C4Config` | Singleton attendance point config |
| `Attendance`, `Dailyattendance`, `Attendancesettings` | Attendance source for C4 |
| `Departments`, `LeaveManagement`, `CompanyHoliday`, `LeaveApplication` | Deadline blocked-date calculation |

### 4.3 Relationship map

```
Firebase Auth user
  └─ uid ──────────────► cowork_employees.authUid
                          cowork_employees.employeeId (doc ID)
                                    │
                    ┌───────────────┴───────────────┐
                    ▼ (Firestore)                   ▼ (MongoDB, join on biometricId)
        cowork_tasks.assigneeIds[]          Employee.biometricId
        cowork_c1_scores/{employeeId}         ├─ designation ──► BandConfig.bands
        cowork_c2_scores/{employeeId}         ├─ primaryManager / secondaryManager
        cowork_groups.memberIds[]             └─ sopPoints[year].bleaches[]
        cowork_task_timers                          ├─ type C1 ◄── written by c1Service
                                                    ├─ type C3 ──► computeC3ForEmployee
cowork_tasks                                        └─ type C4 ──► computeC4ForEmployee
  ├─ parentTaskId ──► cowork_tasks (self, arbitrary depth)
  ├─ groupId ───────► cowork_groups
  ├─ c1{} ──────────► cowork_c1_scores (cache)
  └─ c2Config / goalActivities[] ──► cowork_c2_scores (cache)
```

**Structural weaknesses**
- No referential integrity across the Firestore/Mongo boundary.
- `PATCH /employee/:id/update-id` copies the doc to a new ID and deletes the old, but **does not rewrite `assigneeIds[]`, `memberIds[]`, or any `sopPoints` entry** — it orphans every historical reference.
- Score caches (`cowork_c1_scores`, `cowork_c2_scores`) can drift from `cowork_tasks` with no reconciliation job.

---

## 5. Authentication Flow

### 5.1 Sign-in (client) — `lib/coworkAuth.js`

1. `signInWithEmailAndPassword(firebaseAuth, email, password)`
2. `user.getIdTokenResult(true)` → read `claims.role`
3. Query Firestore `cowork_employees` by `authUid`, falling back to `email`
4. Not found → `signOut` + `cowork/employee-not-found`
5. `isActive === false` or `status` in (`inactive`, `suspended`) → `signOut` + `cowork/account-inactive`
6. Return `{ user, role, employee }`

### 5.2 Request authorisation (server) — `Middlewear/coworkAuth.js`

1. Require `Authorization: Bearer <idToken>`
2. `auth.verifyIdToken(token)`
3. **In-memory cache, 5-minute TTL, keyed by uid** — cache hit skips Firestore entirely
4. Cache miss → Firestore lookup by `authUid`, fallback by `email`
5. Not found **and** custom claim `role === "ceo"` → **auto-provision `E000`** with role `ceo`
6. Not found otherwise → `403 "Employee not found in Firestore. Ask your CEO."`
7. Backfill `authUid` on the doc if absent
8. Attach `req.coworkUser = { authUid, employeeId, role, name, employeeData }`

### 5.3 Bootstrap

`POST /cowork/setup/seed-ceo` — **completely unauthenticated**. Creates a Firebase Auth user, sets `role: "ceo"` custom claim, writes `cowork_employees/E000`, initialises `cowork_meta/counters`.

### 5.4 Session invalidation

`auth.revokeRefreshTokens(authUid)` is called on password reset and role change, plus `invalidateEmployeeCache(uid)` to clear the 5-minute cache.

### 5.5 Weaknesses

- **`setup/seed-ceo` is unauthenticated.** It fails only if the email already exists in Firebase Auth. On a fresh or partially-provisioned environment it is a full admin-account takeover.
- **The 5-minute role cache is a privilege-revocation delay.** Role changes explicitly call `invalidateEmployeeCache`, but a direct Firestore edit or any other path leaves stale elevated permissions for up to 5 minutes.
- **Email fallback lookup.** Both client and server fall back to matching on `email` when `authUid` misses. Firebase does not guarantee email uniqueness across providers.
- **No client-side route guard** (`app/coworking/layout.js:36`).
- **Client-side Firestore access.** The frontend reads `cowork_employees` and many `cowork_*` collections directly. Security depends entirely on Firestore rules, which are **not present in this repository** — they could not be audited.
- **`role` lives in two places** — Firebase custom claims and the Firestore doc — and they are updated separately in `change-role`. Any partial failure desynchronises them.
- `tempPassword` is stored in **plaintext** in Firestore (`cowork.js:399-401`).

---

## 6. User Roles and Permissions

### 6.1 Roles

Exactly three, hard-coded (`Middlewear/coworkAuth.js:78-80`):

| Role | Meaning |
|---|---|
| `ceo` | Full administrator. Employee `E000` is reserved. |
| `tl` | Team Lead. Task approval, review, deadline arbitration. |
| `employee` | Individual contributor. |

Guards: `verifyCoworkToken` (authenticate) → `verifyEmployeeToken` (any) / `verifyCeoOrTL` / `verifyCeoToken`.

### 6.2 Permission matrix

| Capability | employee | tl | ceo |
|---|:--:|:--:|:--:|
| View own tasks / submit / chat | ✅ | ✅ | ✅ |
| Create task | ✅ (self-assign, needs approval) | ✅ | ✅ |
| Approve / rework / reject completion | — | ✅ | ✅ |
| CEO second-stage review | — | — | ✅ |
| Edit task deadline | — | — | ✅ |
| Create group | — | ✅ | ✅ |
| Modify/delete group, manage members | — | — | ✅ |
| Schedule / edit / cancel meeting | — | ✅ | ✅ |
| Create / delete employee | — | ✅ | ✅ |
| Change role / department | — | — | ✅ |
| Reset another's password | — | ✅ | ✅ |
| View own C1/C2 score | ✅ | ✅ | ✅ |
| View **all** scores | — | ✅ | ✅ |
| Gold-task management, weightage validation | — | ✅ | ✅ |
| Band config | — | ✅ | ✅ |
| Workload / status tracking | — | ✅ | ✅ |
| Office Monitor | — | — | ✅ |
| Task settings | — | — | ✅ |

### 6.3 Findings

- **`verifyCeoOrTL` on destructive employee operations.** Delete employee, reset password, and change employee ID all accept TL. A TL can reset the CEO's password and take the account over. `DELETE /employee/:id` blocks only `E000` and self.
- **Role checks inconsistently placed.** `change-role` and `change-department` use `verifyCoworkToken` then check `req.coworkUser?.role !== "ceo"` inside the handler, rather than the `verifyCeoToken` middleware used elsewhere.
- **The manager hierarchy is not enforced.** `PRODUCT.md:66-70` specifies visibility down a reporting chain. Legacy has that chain (`Employee.primaryManager`/`secondaryManager`) and surfaces it read-only at `/employee/my-managers/:employeeId`, but **no scoring or task authorisation uses it**. Any TL sees every employee's scores, not just their reports.
- **No people-ops role.** `PRODUCT.md:70` requires a designated people-operations role. There is no such role; HR functions live in the separate ERP auth system.
- **Role vocabulary is hard-coded**, contradicting `PRODUCT.md:115` (Principle 5). `ceo`/`tl` are string literals throughout, and `E000` is a magic employee ID.

---

## 7. Business Logic

### 7.1 C1 · Task Execution — `services/c1Service.js`

**Documented formula** (file header):
```
taskScore   = base − (deadlineDeduction × missed) − (extensionDeduction × filed) − (reworkDeduction × reworks)
qualityRate = MAX( Σ(taskScore × etcHours) ÷ Σ(etcHours), 0 )
C1 Net      = qualityRate × c1MaxPoints
```

**Implemented formula** (`c1Service.js:58-95`) — differs on three counts:
```js
// line 63:  the extension term is multiplied by ZERO
taskScore = MAX(0, base − (deadline × missed) − 0*extensions − (rework × reworks) − (rejectScore × rejections))
// lines 85-89: unweighted mean, not ETC-weighted
qualityRate = MAX( Σ(taskScore) ÷ count, 0 )
// line 94: c1MaxPoints accepted then ignored
c1Net = qualityRate × 100
```

Defaults (`c1Service.js:23-30`): `c1MaxPoints 35`, `c1BaseScore 1.0`, `c1DeadlineDeduction 0.5`, `c1ExtensionDeduction 0.2`, `c1ReworkDeduction 0.2`, `c1RejectScore 0`. Overridable live from `cowork_sop_settings/task_events` and per-band from `BandConfig`.

Rules: rejected → `c1RejectScore`; cancelled → excluded (`isExcluded`, score `null`); scoring window is **quarterly** (`c1Service.js:281-288`); deadline miss determined against `c1.officialDeadline` (set when a TL waives an extension penalty) falling back to `dueDate`/`fixedDeadline`.

Every C1 event also writes a ledger entry into MongoDB `Employee.sopPoints` via `_writeC1BleachEntries`, `writeReworkDeduction`, `writeExtensionDeduction`, `writeDeadlineDeduction`.

### 7.2 C2 · Goals ("Gold Tasks") — `pmpService.js:148-267`, `c2Band.routes.js`

- A Gold Task carries `c2Config.weightagePercent`. **All active Gold Tasks must sum to ≤ 100%**, validated before creation (`POST /c2/validate-weightage`) — a hard block.
- Gold Tasks decompose into `goalActivities[]` components, each with points and its own deadline. Multi-user gold tasks track `perUserStatus[employeeId]`.
- A component earns points only when `status === "done"` **and** `lateSubmission !== true`.
- `C2 Score = ptsEarned / ptsAssigned`; `c2Net = c2Score × 100`.
- C2 is **annual-running**, not quarterly — the same value is reused for every quarter in the annual roll-up.

### 7.3 C3 · Conduct breaches — `pmpService.js:279-318`

Reads MongoDB `Employee.sopPoints[year].bleaches[]` where `type === "C3"` and `bleachType === "credit"`, within the quarter's month range, skipping entries whose `recheck.status === "confirmed"` (overturned). Returns `c3Net = 0 − totalDeductions` — always ≤ 0, correctly deduction-only.

**Naming collision with PRODUCT.md:** `PRODUCT.md:58` labels C3 "Policy". In legacy, C3 is the **SOP** system, and the model literally named `Policy` is **hard-locked to C4/attendance** (`Policy.js:45`). Migrating on the word "policy" will wire the wrong subsystem.

### 7.4 C4 · Attendance — `pmpService.js:332-379`, `C4Config.js`

```
basePoints  = (distinct days with a C4 ledger entry this quarter) × basePointsPerDay
penalty     = Σ points of non-"debit" C4 entries this quarter
finalPoints = basePoints − penalty
c4Net       = (finalPoints ÷ basePoints) × 100
```
Config: `basePointsPerDay 1`, `lateArrivalPoints 1`, `absencePoints 3`, `earlyDeparturePoints 1`, `lateThresholdMins 15`, `nonWorkingStatuses ["WO"]`. An always-on presence engine credits the daily base point hourly with a 7-day lookback, throttled by `lastPresenceRunAt`.

**Fragility:** `dayCount` is derived from *days that happen to have a ledger entry*, not from a working-day calendar. If the presence engine misses a run, the denominator shrinks and the score silently inflates.

### 7.5 Composite score — `pmpService.js:417-433`

```js
function computeBaseScore({ c1Net, c2Net, c4Net, c3 = 0 }) {
  const components = [c1Net, c2Net, c4Net].filter(v => v !== null && v !== undefined);
  const avg = components.length ? components.reduce((s,v) => s+v, 0) / components.length : 0;
  if (components.length === 0 && (c3 || 0) === 0) return null;
  return +(avg + (c3 || 0)).toFixed(2);
}
```

- **Unweighted mean** of whichever of C1/C2/C4 are non-null, plus raw C3.
- **No floor at 0, no cap at 100.** A large C3 deduction drives the composite negative.
- Whichever components are null are *dropped from the divisor*, so a new employee with only C4 data scores purely on attendance.
- `computePaceScore` and `computeQuarterScore` are **identical passthroughs** to `computeBaseScore`. The header comment above them (`pmpService.js:270`) documents a completely different pace formula that is not implemented.

### 7.6 Annual roll-up — `pmpService.js:439-508`

Quarter weights `{1: 0.10, 2: 0.20, 3: 0.30, 4: 0.40}`. Only started quarters are included; the sum is normalised by `weightUsed`. `liveAnnual` and `projectedAnnual` are computed from **identical inputs** (`rawScore` and `projScore` call the same function with the same arguments, lines 468 and 487) — the projection is not a projection.

### 7.7 Ratings, gap, flags

Ratings ≥95/≥85/≥70/≥50/else. Gap-to-next-threshold. Flags: `PACE-CRITICAL` (<30 after day 30), `PACE-WARNING` (<60), `C2-WARNING` (hit rate <0.5), `ANNUAL-CRITICAL` (<50 after day 45), `ON-TRACK` (≥85, no other flags).

### 7.8 Deadline negotiation

Full protocol described in §1.1. The commercially significant rule: **a TL may waive the C1 penalty when granting an extension**, which promotes the new date to `c1.officialDeadline`, so the original deadline no longer scores.

### 7.9 Timer / work-commit engine — `services/timerSop.service.js`

Day-by-day finalisation with a `lastFinalizedDate` watermark, max 60 days per run. Deficit measured against a daily minimum; overtime is clock-based against `cowork_settings/office.outTime` plus all work on weekly-off days. Both counters accrue independently and convert into SOP points.

**Hard-codes IST** (`IST_OFFSET_MS = 5.5 * 60 * 60 * 1000`) — contradicts `PRODUCT.md:115`.

---

## 8. Integrations

| Integration | Purpose | Notes |
|---|---|---|
| **Firebase Auth** | Identity, custom claims | Core |
| **Firebase Firestore** | Primary Cowork datastore | Core. Security rules absent from repo |
| **Firebase RTDB** | Presence | `FIREBASE_DATABASE_URL` |
| **Firebase Cloud Messaging** | Push | `fcmPush.service.js` |
| **MongoDB / Mongoose** | HR master + SOP ledger | Core |
| **Socket.IO** | Realtime chat, calls, meetings, typing | Two connection handlers registered |
| **LiveKit** | Meeting audio/video, guest tokens | `LIVEKIT_URL/API_KEY/API_SECRET` |
| **Google Gemini** | Meeting summaries, transcript Q&A | `gemini-3-flash-preview` → `2.5-flash` → `2.5-flash-lite` → `2.0-flash` fallback chain |
| **Google Workspace** | Gmail, Calendar, Drive, Tasks, Chat | Per-employee OAuth |
| **Google Drive** | Recording + attachment storage | Service account and OAuth paths both present |
| **Cloudinary** | Image/media CDN | Two accounts — main and `OM_*` for Office Monitor |
| **Brevo** | Transactional email | `BREVO_API_KEY`, gated by `ENABLE_EMAILS` |
| **Web Push (VAPID)** | Browser push | `web-push` |
| **Expo Push** | Mobile push | `expo-server-sdk` — mobile app not in these repos |
| **eTimeOffice / TeamOffice** | Biometric attendance sync → C4 | ⚠️ **credentials hardcoded in source comments** |
| **`grav-office-monitor` Firebase project** | Desktop surveillance | Separate project, config hardcoded in `lib/liveScreenshot.js:6-13` |
| **Setu AA** | Account aggregator | ERP/accounting — out of scope |
| **Tally** | Accounting import | ERP — out of scope |
| **GSTIN lookup** | Tax validation | ERP — out of scope |

**PRODUCT.md conflict:** `PRODUCT.md:30` and `:99` state Cowork "is explicitly **not an AI product**" and must not be presented as one. Legacy ships two user-facing Gemini features — AI meeting summaries and "Ask AI" over meeting audio. This needs an explicit product decision (see §14, Phase 6).

---

## 9. Environment Variables

### 9.1 Backend — Cowork-relevant

| Variable | Purpose |
|---|---|
| `PORT`, `NODE_ENV` | Server |
| `MONGODB_URI` | Mongo connection (**see duplicate below**) |
| `MONGO_URI` | ⚠️ Duplicate — used only by `backfill_leaves.js`, `fix-propagation.js`, `fix-attendance-index.js` |
| `FIREBASE_SERVICE_ACCOUNT` | Admin SDK JSON, single-line |
| `FIREBASE_DATABASE_URL` | RTDB (defaults to a hardcoded project URL) |
| `JWT_SECRET` | Legacy ERP auth |
| `COWORK_APP_URL`, `COWORK_FRONTEND_URL`, `FRONTEND_URL`, `SELF_API_URL`, `WEBSITE_URL` | ⚠️ Five overlapping URL vars |
| `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` | Meetings |
| `GEMINI_API_KEY` | AI features |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`, `GOOGLE_REDIRECT_URI_EMPLOYEE`, `GOOGLE_REFRESH_TOKEN`, `GOOGLE_SERVICE_ACCOUNT_KEY`, `GOOGLE_DRIVE_FOLDER_ID` | Workspace/Drive |
| `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `GOOGLE_OAUTH_REDIRECT_URI` | ⚠️ Second, overlapping OAuth set |
| `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` | Media |
| `BREVO_API_KEY`, `ENABLE_EMAILS`, `HR_SENDER_EMAIL`, `HR_REPLY_TO_EMAIL` | Email |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_EMAIL`, `VAPID_SUBJECT` | ⚠️ `VAPID_EMAIL` and `VAPID_SUBJECT` overlap |
| `ETIMEOFFICE_URL`, `ETIMEOFFICE_USERNAME`, `ETIMEOFFICE_PASSWORD` | Biometric — ⚠️ **hardcoded fallbacks in comments** |
| `TEAMOFFICE_BASE_URL`, `TEAMOFFICE_CORP_ID`, `TEAMOFFICE_USERNAME`, `TEAMOFFICE_PASSWORD`, `TEAMOFFICE_AUTH_TOKEN` | Second biometric provider |
| `SHIFT_START`, `SHIFT_END`, `LATE_THRESHOLD_MINS`, `EARLY_OUT_THRESHOLD_MINS`, `HALF_DAY_THRESHOLD_MINS` | Attendance → C4. ⚠️ Duplicates `C4Config` and `Policy.thresholdMins` |
| `BIOMETRIC_SYNC_INTERVAL_MINUTES`, `C4_CRON_KEY` | Scheduled jobs |
| `SALARY_ENCRYPTION_KEY` | Payroll (ERP) |
| `APP_MIN_VERSION`, `APP_LATEST_VERSION` | Mobile version gate |
| `COMPANY_LOGO_BASE64`, `COMPANY_SIGNATURE_BASE64` | Document generation |

**ERP-only, not needed by new Cowork:** `ACCOUNTANT_APP_URL`, `ACCOUNTANT_AUTH_BYPASS` (⚠️ auth bypass flag), `BACKUP_CRON_SECRET`, `CUSTOMER_PORTAL_URL`, `CUSTOMER_SENDER_EMAIL`, `DATABASE_URL`, `GOOGLE_DRIVE_BACKUP_FOLDER_ID`, `GOOGLE_DRIVE_VOUCHER_FOLDER_ID`, `GSTIN_LOOKUP_*` (4), `PM_APPROVAL_FOR_MRF`, `SETU_AA_*` (6).

### 9.2 Frontend

| Variable | Purpose |
|---|---|
| `NEXT_PUBLIC_API_URL` | Backend base (defaults to `http://localhost:5000`) |
| `NEXT_PUBLIC_FIREBASE_API_KEY`, `_AUTH_DOMAIN`, `_PROJECT_ID`, `_STORAGE_BUCKET`, `_MESSAGING_SENDER_ID`, `_APP_ID`, `_DATABASE_URL` | Firebase web SDK |
| `NEXT_PUBLIC_FIREBASE_VAPID_KEY` | Web push |
| `NEXT_PUBLIC_LIVEKIT_URL` | Meetings |
| `NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME`, `NEXT_PUBLIC_CLOUDINARY_UPLOAD_PRESET` | Unsigned upload |
| `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` | ⚠️ Server-side secrets in the frontend repo |
| `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY`, `GOOGLE_SERVICE_ACCOUNT` | ⚠️ Admin credentials in the frontend repo |
| `NEXT_PUBLIC_MONITOR_BACKEND`, `NEXT_PUBLIC_OM_CLOUDINARY_CLOUD_NAME`, `OM_CLOUDINARY_API_KEY`, `OM_CLOUDINARY_API_SECRET` | Office Monitor |
| `DRIVE_FOLDER_ID` | Drive upload |
| `SUPABASE_PONG_CHANNEL`, `SUPABASE_SNAKE_CHANNEL` | ⚠️ **Supabase — no Supabase dependency exists.** Vestigial |

**No `.env.example` exists in either repo.** Every variable above was recovered by static analysis.

---

## 10. Technical Debt

### 10.1 Critical

| # | Issue | Location |
|---|---|---|
| 1 | **Live third-party credentials in source** — eTimeOffice username/password in a comment block | `services/BiometricSyncService.js:8-10` |
| 2 | **Unauthenticated CEO bootstrap** — anyone can seed an admin on a fresh environment | `routes/task_routes/cowork.js:17-36` |
| 3 | **No client route guard** — `if (!user) return children;` | `app/coworking/layout.js:36` |
| 4 | **Firestore security rules absent from the repo** — the frontend reads collections directly; the entire client-side authorisation model is unauditable | — |
| 5 | **Admin credentials in the frontend repo** — `FIREBASE_PRIVATE_KEY`, `GOOGLE_SERVICE_ACCOUNT`, `CLOUDINARY_API_SECRET` | `lib/coworkFirebaseAdmin.js`, `app/api/*` |
| 6 | **TL can reset the CEO's password** — destructive employee ops gated on `verifyCeoOrTL` | `cowork.js:379`, `:716`, `:765` |
| 7 | **Plaintext temp passwords in Firestore** | `cowork.js:399-401` |
| 8 | **Hardcoded Firebase config for a second project** | `lib/liveScreenshot.js:6-13` |

### 10.2 Correctness

| # | Issue | Location |
|---|---|---|
| 9 | **Extension deduction multiplied by zero** — `- 0 * extensionsFiled`. The configured value never applies at task level, yet it *is* written to the SOP ledger separately, so the same event is inconsistently accounted | `c1Service.js:63` |
| 10 | **Composite score has no floor and no cap** — `avg + c3` can go negative; contradicts `PRODUCT.md:59` | `pmpService.js:417-424` |
| 11 | **`c1MaxPoints` computed, passed, and discarded** — `calculateC1Net` ignores its second parameter and returns `qualityRate × 100`. All band-specific C1 maxima are dead for scoring | `c1Service.js:92-95`, `pmpService.js:116` |
| 12 | **Documented C1 formula ≠ implemented formula** — header claims ETC-weighted; code is an unweighted mean | `c1Service.js:14` vs `:85-89` |
| 13 | **`liveAnnual` and `projectedAnnual` are computed identically** — the projection is not a projection | `pmpService.js:468,487` |
| 14 | **Conflicting default deduction values** — `c1Service` says deadline 0.5 / extension 0.2 / reject 0; `BandConfig` says 0.2 / 0.1 / 0.3. Two sources of truth | `c1Service.js:23-30` vs `BandConfig.js:17-22` |
| 15 | **Two sign conventions in one file** — `computeC3ForEmployee` filters on `bleachType`; `getSOPBreakdown` derives sign from `isCredit` | `pmpService.js:295` vs `:404` |
| 16 | **`c1/preview` omits `rejectionsReceived`** from its `calculateTaskScore` call, so preview diverges from the committed score | `c1Routes.js:107` |
| 17 | **C1 cache refresh gated on `etcHours > 0`** while the quality-rate calculation no longer requires it — employees whose tasks all have zero ETC never get a cache update | `c1Service.js:259` vs `:75-77` |
| 18 | **`empDoc.exists()` called as a function** — it is a property on Admin SDK snapshots; this throws on every call | `cowork.js:957` |
| 19 | **Two `io.on("connection")` handlers** registered on the same server | `server.js:79` and `:101` |
| 20 | **`update-id` orphans all references** — copies the employee doc to a new ID but never rewrites `assigneeIds[]`, `memberIds[]`, or `sopPoints` | `cowork.js:716-762` |
| 21 | **C4 denominator derived from ledger entries, not a working-day calendar** — a missed presence-engine run silently inflates the score | `pmpService.js:345-367` |
| 22 | **Comment documents a pace formula that is not implemented** | `pmpService.js:270-275` |

### 10.3 Structural

| # | Issue |
|---|---|
| 23 | **`server.js` is 78,710 bytes** with inline route logic, socket handlers, and cron registration |
| 24 | **`app/coworking/tasks/page.js` is 10,794 lines** — a single client component holding the entire task domain |
| 25 | **`CoworkingShell.js` is 4,202 lines** — layout, nav, notifications, and duty status in one file |
| 26 | **`taskForward.js` / `taskForward.service.js` are 118KB each** and near-identical (2,368 vs 2,412 lines) |
| 27 | **Misspelled directory `Middlewear/`** coexists with a correctly-spelled `middleware/` |
| 28 | **No test suite.** `npm test` exits 1. `test.js` (94KB), `c1_interactive_test.js`, `c2_interactive_test.js`, `p1_conflict_test.js`, `verifyTimerSop.js` are manual scripts |
| 29 | **Debug/repair endpoints in production** — `/task/dump/:taskId`, `/employee/dump/:employeeId`, `/task/force-repair-self-assign`, `/task/self-assign-debug/:employeeId`, `/task/self-assign-repair`, `/test-email`, `/audio/test-gemini`, `/timer-sop/test-finalize/:employeeId`, and the `/coworking/fix-priorities` page |
| 30 | **Ad-hoc migration scripts at repo root** — `backfill_leaves.js`, `fix-attendance-index.js`, `fix-propagation.js`, `syncIdentityID.js`, `update_from_excel.js` (140KB), `cleanup_test_data.js` |
| 31 | **`console.log` left in request paths** — e.g. `cowork.js:41` (`"yugyu"`), `pmpService.js:369` (`[C4 DEBUG]`) |
| 32 | **Mixed language/module systems** — backend CommonJS with a stray `tsconfig.json`; frontend mixes `.js`/`.jsx`/`.ts`/`.tsx` and App Router with one orphaned Pages Router file |
| 33 | **Hardcoded organisational assumptions** — IST offset, `E000`, `ceo`/`tl` literals, `"Management"` department, INR/India tax logic |
| 34 | **Empty placeholder file** — `employee_import_template.xlsx` is 0 bytes |
| 35 | **Frontend package still named `my-v0-project`** |

---

## 11. PRODUCT.md Comparison

| `PRODUCT.md` statement | Legacy reality | Verdict |
|---|---|---|
| `:52` Codes shown alongside labels — "C1 · Task Execution" | Legacy uses bare `C1`/`C2`/`C3`/`C4` plus "Gold Task", "Bleach", "PMP", "Band" | ⚠️ New requirement |
| `:56` C1 = task completion quality incl. rework and extension | Implemented — but the extension term is zeroed (§10.2 #9) | ⚠️ Partly broken |
| `:57` C2 = goal attainment | Implemented as Gold Tasks with a 100% weightage pool | ✅ Aligned |
| `:58` C3 = **policy breaches, deduction only** | C3 = **SOP conduct breaches**. The model named `Policy` is locked to **C4** | ⚠️ **Naming collision** |
| `:59` C4 = attendance | Implemented, points-per-day | ✅ Aligned |
| `:61` **Weights fixed product-wide, not configurable** | Live-configurable via `cowork_sop_settings/task_events` **and** per-band via `BandConfig` | ❌ **Direct contradiction** |
| `:62` **Score floors at 0, caps at 100** | `computeBaseScore` has neither floor nor cap | ❌ **Direct contradiction** |
| `:63` C1 measures *how*, not merely *whether* | Correct — deadline, rework, extension, rejection are distinct signals | ✅ Aligned |
| `:66` Individual sees **own score only** | Enforced on `/c1/scores/:id` and `/c2/scores/:id` | ✅ Aligned |
| `:67` Manager sees **their reports**, including comparison | TL/CEO see **all** employees. The reporting chain exists but is unused for authorisation | ⚠️ **Too permissive** |
| `:70` Skip-level + designated **people-ops role** | No such role in Cowork | ❌ Missing |
| `:46` Score is **ambient and persistently present** | Score lives on a separate `/coworking/pmp` page | ❌ Contradiction |
| `:30`,`:99` **Not an AI product** | Ships Gemini meeting summaries and "Ask AI" | ❌ **Direct contradiction** |
| `:76` Next.js App Router, React, TypeScript, Tailwind | Next.js 16 App Router + React 19 + Tailwind 4 ✅, but **almost entirely JavaScript, not TypeScript** | ⚠️ Partly |
| `:78` Scalable component-based architecture | 10,794-line page component; 4,202-line shell | ❌ Contradiction |
| `:98` Premium, minimal, Apple-inspired, subtle glassmorphism | shadcn/Radix defaults, inline styles, `lib/coworkStyles.js` + `lib/designTokens.js` | ❌ **Legacy styling explicitly not to be carried over** |
| `:115` Don't hard-code today's company | IST offset, `ceo`/`tl`, `E000`, INR/GST | ❌ Contradiction |
| `:87` **Weight values undecided** | C1 max 35, C2 max 30; quarter weights 10/20/30/40 | 🔴 **Decided in code** |
| `:88` **C3 breach definition undecided** | Severity tiers minor/moderate/serious/falsification/idle_pool | 🔴 **Decided in code** |
| `:89` **C4 measurement undecided** | +1/day, −1 late (>15m), −3 absent, −1 early | 🔴 **Decided in code** |
| `:90` **C2 over-target undecided** | Capped by a hard 100% pool | 🔴 **Decided in code** |
| `:91` **Scoring period undecided** | Quarterly, weighted annual roll-up | 🔴 **Decided in code** |
| `:103` Repo contains only `create-next-app` starter | Now has shell, home, score card, five primitives | ℹ️ Stale — update |

### 11.1 Product decisions required before migration

1. **Obtain `CW-DEV-PMP-01 v1.0` (June 2026)** and reconcile it with `PRODUCT.md`. One of the two is authoritative; today they contradict each other.
2. **Fixed vs configurable weights.** `PRODUCT.md:61` says fixed; legacy has two layers of configurability. Choosing "fixed" means deleting `BandConfig` and the settings surface.
3. **Floor/cap.** Adopt `PRODUCT.md:59` (0–100) and fix the composite, or adopt legacy's unbounded model.
4. **C3 vocabulary.** Decide whether C3 is "Policy" (PRODUCT.md) or "SOP/Conduct" (legacy), and rename consistently in one direction.
5. **Manager scoping.** Enforce the reporting chain per `PRODUCT.md:67`, or keep legacy's all-visible model.
6. **People-ops role.** Introduce it, or amend `PRODUCT.md:70`.
7. **AI features.** Drop Gemini summaries/Ask-AI, or amend `PRODUCT.md:30`.
8. **Office Monitor.** Decide whether desktop surveillance is part of the product at all. This has legal and ethical dimensions beyond engineering.
9. **Ambient score.** `PRODUCT.md:46` requires the score to be persistently present; legacy hides it on one page. This is an architectural constraint on the new shell.

---

## 12. Unused Code

### 12.1 Frontend — unreferenced

| File | Note |
|---|---|
| `components/coworking/tasks/CreateSubtaskModal.js` | 9,590 B, **0 references** — superseded by the `.jsx` twin |
| `components/DashboardLayout.js` | **0 references** |
| `lib/patternGradingEngine.js` | 544 lines, **0 references** — garment-manufacturing logic in the Cowork frontend |
| `services/schedulingService.js` | **0 references** |
| `setup-ceo.js` | **0 references** — root-level bootstrap script |
| `pages/api/upload-to-drive.js` | Pages Router file in an App Router project |
| `styles/globals.css` | 4,353 B, duplicates `app/globals.css` (4,280 B) |

### 12.2 Frontend — vestigial

- `SUPABASE_PONG_CHANNEL`, `SUPABASE_SNAKE_CHANNEL` — no Supabase dependency in `package.json`
- `public/uireferences/*.mp4` — design reference assets shipped in `public/`
- Heavy unused-in-Cowork dependencies: `three`, `dxf-parser`, `jsbarcode`, `react-barcode`, `qrcode`, `html2pdf.js`, `@react-pdf/renderer`, `pdf-lib`, `jspdf`, `jspdf-autotable`

### 12.3 Backend — dead by route shadowing

- **`routes/task_routes/taskTree.routes.js` (96,217 B)** — all ~30 shared paths are shadowed by `taskForward.js` (mounted 14 lines earlier). Only `/task/dump/:taskId` and `/employee/dump/:employeeId` are reachable, and both are debug endpoints.
- **`routes/task_routes/coworkEnhanced.js`** — ~8 of its 12 paths (`/task/:taskId/subtask`, `/chat`, `/full`, `/deadline`, `DELETE /task/:taskId`, `/submit-completion`, `/review-completion`, `/ceo-review`) are shadowed. Only its media and `conversations-v2` routes are reachable.
- `routes/task_routes/taskForward.js` — `GET /task/:taskId/forward-budget` registered **twice**; the second is unreachable.

### 12.4 Backend — dev/ops scripts at repo root

`backfill_leaves.js`, `c1_interactive_test.js`, `c2_interactive_test.js`, `cleanup_test_data.js`, `fix-attendance-index.js`, `fix-propagation.js`, `p1_conflict_test.js`, `seed.js`, `syncIdentityID.js`, `test.js` (94 KB), `update_from_excel.js` (140 KB), `verifyTimerSop.js`, `scripts/migrate_*.js`, `scripts/seedAccountant.js`, `employee_import_template.xlsx` (0 bytes), `grav-logo.png`

### 12.5 Backend — out of scope for new Cowork (~90%)

Entire trees: `models/Accountant_model/` (14), `models/CMS_Models/` (43), `models/Customer_Models/` (4), `models/Vendor_Models/` (2), `models/Barcode_Scanner_Device/` (2), plus `routes/Accountant_Routes/` (37), `routes/CMS_Routes/` (~60), `routes/CEO_Routes/` (13), `routes/Customer_Routes/` (12), `routes/Vendor_Routes/` (5), `routes/HrRoutes/` (18, except attendance feeding C4), and the Tally/Setu/GSTIN service cluster.

---

## 13. Duplicate Implementations

| # | Duplication | Detail |
|---|---|---|
| 1 | **`taskForward.js` ↔ `taskForward.service.js`** | 118,822 B vs 118,839 B; 2,368 vs 2,412 lines. Different MD5, near-identical content. Both headers claim to be the "full rewrite" |
| 2 | **`taskForward.js` ↔ `taskTree.routes.js` ↔ `coworkEnhanced.js`** | Three files, one mount point, ~30 identical paths. Silent shadowing |
| 3 | **`taskTree.routes.js` ↔ `taskTree.service.js`** | Parallel route/service split with overlapping logic |
| 4 | **`middleware/` ↔ `Middlewear/`** | Two directories, one misspelled |
| 5 | **`hooks/use-toast.ts` ↔ `components/ui/use-toast.ts`** | Byte-identical (3,945 B) |
| 6 | **`hooks/use-mobile.ts` ↔ `components/ui/use-mobile.tsx`** | 566 B vs 565 B |
| 7 | **`hooks/useCoworkGroups.js` ↔ `.ts`** | 1,939 B vs 522 B, **both referenced** — different consumers get different implementations |
| 8 | **`CreateSubtaskModal.js` ↔ `.jsx`** | 9,590 B vs 8,605 B; the `.js` is dead |
| 9 | **Three toast systems** | `hooks/useToast.js` + `utils/toast.js` + `components/ToastProvider.js`, alongside `sonner` and `react-hot-toast` in `package.json` |
| 10 | **`app/globals.css` ↔ `styles/globals.css`** | 4,280 B vs 4,353 B |
| 11 | **C1 defaults in two places** | `c1Service.C1_DEFAULTS` vs `BandConfig.globalSettings.c1` — **conflicting values** |
| 12 | **`computePaceScore` ↔ `computeQuarterScore`** | Identical passthroughs to `computeBaseScore` |
| 13 | **Attendance thresholds in three places** | `LATE_THRESHOLD_MINS` env, `C4Config.lateThresholdMins`, `Policy.thresholdMins` |
| 14 | **Two Google OAuth env sets** | `GOOGLE_CLIENT_*` and `GOOGLE_OAUTH_CLIENT_*` |
| 15 | **`MONGO_URI` ↔ `MONGODB_URI`** | Both live |
| 16 | **Four+ frontend URL env vars** | `COWORK_APP_URL`, `COWORK_FRONTEND_URL`, `FRONTEND_URL`, `WEBSITE_URL` |
| 17 | **Two Cloudinary accounts** | Main + `OM_*` |
| 18 | **`routes/services/` ↔ `services/`** | Google service wrappers in both; `googleTasksService.js` exists in each |
| 19 | **Two `googleWorkspaceRoutes.js`** | `routes/googleWorkspaceRoutes.js` and `routes/task_routes/googleWorkspaceRoutes.js` |
| 20 | **Two production-completion route files** | `CMS_Routes/Manufacturing/Production/` and `.../WorkOrder/` (ERP, noted for completeness) |
| 21 | **Two `PurchaseOrder` models** | `Inventory/Operations/` and `Store/` (ERP) |
| 22 | **Two DM conversation endpoints** | `/direct-message/conversations` and `/direct-message/conversations-v2` |
| 23 | **Two subtask creation paths** | `coworkEnhanced.js` and `taskForward.js`, same URL |
| 24 | **Two chat systems** | Firestore `chat`/`messages` collections plus Socket.IO events |

---

## 14. Route Mapping — Old → New

The new project currently has **one route** (`app/page.tsx`). This table is therefore a **proposal**, not a reconciliation of two existing route tables.

Guiding principles, drawn from `PRODUCT.md`:
- The score must be **ambient** (`:46`), so `/coworking/pmp` does not survive as a destination — it decomposes into an always-present shell element plus a detail view.
- **Two lenses, one product** (`:113`) — individual and manager views are a lens toggle (already modelled as `Lens` in `lib/types.ts:74` and the `LensContext`), not separate route trees.
- **Don't hard-code today's company** (`:115`) — no `ceo`/`tl` in URLs.

| Legacy route | Proposed new route | Notes |
|---|---|---|
| `/` (login) | `/login` | Rebuild on the Impeccable system |
| `/coworking` | `/` | Home; score ambient in the shell |
| `/coworking/tasks` | `/tasks`, `/tasks/[taskId]` | **Must be decomposed** — 10,794 lines becomes a route group with server components |
| — | `/tasks/[taskId]/deadline` | Deadline negotiation deserves its own surface |
| `/coworking/direct-messages` | `/messages` | |
| `/coworking/direct-messages/[conversationId]` | `/messages/[conversationId]` | |
| `/coworking/audio-call/[convId]` | `/messages/[conversationId]/call` | Nest under the conversation |
| `/coworking/groups` + `/coworking/create-group` | `/groups`, `/groups/[groupId]` | Merge list and admin |
| `/coworking/schedule-meet` | `/meetings` | |
| `/coworking/schedule-meet/new` | `/meetings/new` | |
| `/coworking/cowork-meeting/[meetId]` | `/meetings/[meetId]` | |
| `/coworking/join/[token]` | `/join/[token]` | Public — keep outside the app shell |
| `/coworking/calendar` | `/team/workload` | Manager lens |
| `/coworking/calendar/[employeeId]` | `/team/[personId]/workload` | |
| `/coworking/status-tracking` | `/team` | Manager lens landing |
| `/coworking/pmp` | `/score` **+ ambient shell element** | Split per `PRODUCT.md:46` |
| — | `/score/[channel]` | C1–C4 decomposition per `PRODUCT.md:112` |
| `/coworking/sop` | `/policy` *(pending §11.1 decision 4)* | Name follows the C3 vocabulary decision |
| `/coworking/create-employee` | `/admin/people` | |
| `/coworking/task-settings` | `/admin/settings` | Scope depends on §11.1 decision 2 |
| `/coworking/settings` | `/settings` | |
| `/coworking/docs` | `/docs` | |
| `/coworking/mail`, `/mail/gmail` | `/mail` *(defer)* | Phase 6 — evaluate whether to keep |
| `/google-task`, `/workspace/google-panel` | *(fold into `/mail` or drop)* | Redundant surfaces |
| `/coworking/office-monitor[/[id]]` | **Deferred — decision required** | §11.1 decision 8 |
| `/coworking/mrf` | **Drop** | ERP leakage |
| `/coworking/fix-priorities` | **Drop** | Debug utility |
| `/privacy` | `/privacy` | |

### 14.1 API surface mapping

Legacy exposes the Cowork API under a bare `/cowork` prefix with **no version segment**. Recommend `/api/v1/*` for the new backend, and renaming to match the new route vocabulary (`/task/*` → `/api/v1/tasks/*`, `/pmp/*` → `/api/v1/score/*`, `/sop/*` → `/api/v1/policy/*`).

---

## 15. Phased Migration Plan

Nothing in this plan begins until you approve this audit. Phases 0 and 1 are prerequisites, not optional groundwork.

### Phase 0 — Decisions & security (blocking, no app code)

1. **Rotate the exposed eTimeOffice credentials** (`BiometricSyncService.js:8-10`). Independent of migration — do this regardless.
2. **Obtain `CW-DEV-PMP-01 v1.0`** and the "PDF §3.4 C3 table".
3. **Resolve the nine product decisions in §11.1.**
4. **Update `PRODUCT.md`** — move the five "undecided" items to confirmed (or explicitly override legacy), and correct the stale "Evidence on Hand" note at `:103`.
5. **Locate the Firestore security rules.** They govern all client-side data access and are not in this repo.
6. Decide the **backend strategy**: extract `/cowork` into a standalone service, or rebuild. This audit's finding that ~90% of the backend is unrelated ERP argues strongly for extraction into a new service.

**Exit criteria:** written answers to all nine decisions; credentials rotated; scoring spec in hand.

### Phase 1 — Foundations

1. Write `.env.example` for both new services from §9.
2. Establish the data contract: TypeScript types for `Employee`, `Task`, `Task.c1`, `Goal`/`GoalActivity`, `SopEntry`/`Bleach`, `ScoreSnapshot` — extending `lib/types.ts`.
3. **Resolve the split-datastore question.** Recommend consolidating onto one store; the Firestore/Mongo dual-write is the root cause of findings #14, #15, #20, #21.
4. Stand up auth: Firebase Auth + a **server-side route guard** (fixing #3), a real reporting-chain permission model (`PRODUCT.md:67`), and a people-ops role (`:70`).
5. Define the role vocabulary as configurable data, not string literals (`PRODUCT.md:115`).

**Exit criteria:** a user can log in, land on `/`, and be correctly denied a route they lack permission for.

### Phase 2 — Score, ambient (the product's reason to exist)

`PRODUCT.md:111` — execution and measurement are one system — so the score comes before the work surfaces that feed it.

1. Port the C1 engine **with the bugs fixed**: restore the extension term (#9), decide ETC-weighted vs unweighted (#12), and either honour `c1MaxPoints` or delete it (#11).
2. Port C2 (Gold Tasks), C3 (breaches), C4 (attendance) against the reconciled spec.
3. Implement the composite **with the 0–100 floor/cap** (`PRODUCT.md:59`, fixing #10).
4. Build the ambient score element in the shell — `ScoreCard` and `ComponentBand` already exist.
5. Build `/score` and `/score/[channel]` for decomposition (`PRODUCT.md:112` — a score must always be traceable to its components and the actions beneath them).
6. Enforce visibility: own score only for individuals; reports-only for managers (`PRODUCT.md:66-69`).

**Exit criteria:** a score is visible everywhere in the app, decomposes to C1–C4, traces to individual actions, and never leaves 0–100.

### Phase 3 — Tasks

The largest phase. `PRODUCT.md:38` makes extensions and rework first-class states, so the deadline protocol is in scope, not an add-on.

1. Task CRUD, hierarchy (`parentTaskId`), folders.
2. The full lifecycle state machine (§1.1).
3. **Deadline negotiation** — propose, approve, counter, respond, extend, waive.
4. Submit → review → rework/reject → CEO review, wired to C1.
5. Task chat, draft chat, daily reports.
6. Timers and work commits.
7. Task types: repeat, third-party, self-assigned, gold.

**Explicitly rebuild, do not port:** `tasks/page.js` must become a route group of server components with client islands (`PRODUCT.md:78`).

**Exit criteria:** a task can be created, negotiated, worked, submitted, reworked, approved — and the resulting C1 movement is correct and traceable.

### Phase 4 — Collaboration

Groups; direct and group messaging with media; notifications (in-app, push, email); duty status and team presence.

### Phase 5 — Meetings

Scheduling, LiveKit room, guest join by token, recording. **Transcription and AI summaries are gated on §11.1 decision 7.**

### Phase 6 — Peripheral, each gated on a decision

| Surface | Gate |
|---|---|
| Mail / Google Workspace | Is a Gmail client in scope, or is Google integration limited to Calendar/Drive? |
| Office Monitor | §11.1 decision 8 — product, legal, ethical |
| AI features | §11.1 decision 7 — `PRODUCT.md:30` says no |
| Documentation page | Low priority |

### Phase 7 — Data migration & cutover

1. Map `cowork_*` collections to the new schema.
2. **Reconcile the score caches against source tasks before migrating** — they may already have drifted (#21).
3. Backfill `sopPoints` history.
4. **Repair `employeeId` orphans** created by past `update-id` calls (#20).
5. Parallel-run and reconcile scores between old and new.
6. Cut over; retain the legacy ERP backend for its non-Cowork modules.

### Explicitly out of scope

The entire ERP: accounting, inventory, manufacturing, QC, dispatch, sales/CRM, payroll, vendor and customer portals, barcode hardware, Tally/Setu/GSTIN integrations, and the MRF surface leaking into the Cowork frontend.

### Never carry over

Per the standing constraint that the new project's design system is the visual source of truth: **no legacy CSS, inline styles, `lib/coworkStyles.js`, `lib/designTokens.js`, shadcn/Radix component defaults, or layout structures.** Legacy is a behavioural specification. `DESIGN.md` and the Impeccable system are the visual authority.

---

## 16. Audit Coverage & Limits

**Read in full:** `cowork.js` (979 ln), `c1Service.js` (467), `pmpService.js` (partial — 600 of ~900), `c2Band.routes.js` (235), `c1Routes.js` (124), `coworkAuth.js` (82), `firebaseAdmin.js` (30), `BandConfig.js` (73), `C4Config.js` (54), `Policy.js` (113), `sop_model.js` (44), `coworkApi.js` (138), `coworkAuth.js` (52), `coworking/layout.js` (62), both `package.json`, `PRODUCT.md`, `lib/types.ts`.

**Analysed structurally** (route/endpoint/collection/env extraction, not line-by-line): `server.js` (78 KB), `taskForward.js` (118 KB), `taskTree.routes.js` (96 KB), `taskForward.service.js` (118 KB), `taskTree.service.js`, `timerSop.service.js`, `cowork.service.js`, `coworkEnhanced.service.js`, `tasks/page.js` (10,794 ln), `CoworkingShell.js` (4,202 ln), all 110 models, all 250 frontend files.

**Not covered:**
- **Firestore security rules** — absent from the repository. The client-side authorisation model could not be audited. This is a material gap.
- **Git history** — neither repo contains a `.git` directory, so no commit history, blame, or churn analysis was possible.
- **The mobile app** — `expo-server-sdk` and `Appversion.js` imply one exists; it is not in these repos.
- **The Office Monitor desktop agent** — only the web-facing half is present.
- **`CW-DEV-PMP-01 v1.0`** and the C3 severity table — cited by code, not present.
- **Runtime behaviour** — this is a static audit. No code was executed and the live app was not exercised.
- Line-by-line review of the ~90% ERP surface, which was scoped out deliberately.
