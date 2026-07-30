# Legacy Behaviour Spec — Cowork

**Date:** 2026-07-25
**Status:** Analysis and documentation only. No code written, no migration begun.
**Method:** Every claim below was traced through frontend handler → API call → *reachable* backend route → service → database field → notification/socket → score event. Route reachability was determined from mount order in `server.js`, not from filenames.

**Companion documents:** [TASK_LOGIC_SPEC.md](TASK_LOGIC_SPEC.md) · [SCORING_LOGIC_SPEC.md](SCORING_LOGIC_SPEC.md) · [PERMISSIONS_AND_ROLES_SPEC.md](PERMISSIONS_AND_ROLES_SPEC.md) · [INTEGRATIONS_SPEC.md](INTEGRATIONS_SPEC.md) · [MIGRATION_DECISIONS.md](MIGRATION_DECISIONS.md) · [NEW_COWORK_ARCHITECTURE.md](NEW_COWORK_ARCHITECTURE.md)

---

## 0. Validation Labels

Every behavioural claim in these documents carries one of:

| Label | Meaning |
|---|---|
| **CONFIRMED WORKING** | Traced end-to-end; the reachable route executes it and it writes what it claims |
| **INTENDED BUT BROKEN** | Code exists and is reachable, but a defect prevents the intended effect |
| **UNREACHABLE (SHADOWED)** | Code exists but a route mounted earlier claims the same path |
| **FE/BE CONTRADICTION** | Frontend and backend disagree about the rule |
| **OWNER-CONFIRMED NEW RULE** | Supplied by the owner in this engagement; overrides legacy |
| **OWNER DECISION REQUIRED** | Legacy does not answer it, or answers it in a way that must not be assumed correct |

---

## 1. Route Reachability — The Foundation

Three files are mounted at the same `/cowork` prefix and define overlapping paths. Express resolves first-match, so mount order is the whole story.

```
server.js:1301   app.use("/cowork", require("./routes/task_routes/taskForward.js"))     ← AUTHORITATIVE
server.js:1303   app.use("/cowork", require("./routes/task_routes/mediaUpload.js"))
server.js:1306   app.use("/cowork", require("./routes/task_routes/coworkEnhanced.js"))  ← partly shadowed
server.js:1315   app.use("/cowork", taskTreeModule)                                      ← almost fully shadowed
server.js:1318   app.use("/cowork", require("./routes/task_routes/cowork"))
```

### 1.1 What is actually reachable

| File | Status |
|---|---|
| `routes/task_routes/taskForward.js` (2,368 ln) | **The live task engine.** Every shared path resolves here. |
| `routes/task_routes/taskTree.routes.js` (96 KB) | **UNREACHABLE (SHADOWED)** for ~30 paths. Only `GET /task/dump/:taskId` and `GET /employee/dump/:employeeId` survive — both debug endpoints. |
| `routes/task_routes/coworkEnhanced.js` | **UNREACHABLE (SHADOWED)** for `/task/:taskId/subtask`, `/chat`, `/full`, `/deadline`, `DELETE /task/:taskId`, `/submit-completion`, `/review-completion`, `/ceo-review`. Reachable only for `/message/group-media`, `/message/direct-media`, `/direct-message/conversations-v2`. |
| `services/taskForward.service.js` (2,412 ln) | **The live service.** Required by `taskForward.js:17`. |
| `services/taskTree.service.js` | Dead — only `taskTree.routes.js` requires it. |

### 1.2 Consequence

Any behavioural difference between `taskTree.routes.js` and `taskForward.js` is **not a behavioural question** — `taskForward.js` wins unconditionally. `taskTree.routes.js` should be read as an abandoned earlier draft, never as a specification.

`taskForward.js` is the superset: it alone has `/department-approve`, `/department-tl-set-hours`, `/forward-budget`, `/move-to-folder`, `/edit-details`, `/reset-to-draft`, `/p1-conflict-check`, `/update-vendor-config`.

### 1.3 In-file anomalies in the authoritative file

| Finding | Location | Label |
|---|---|---|
| `module.exports = router` appears at line 2173, with three more routes registered *after* it (lines 2177, 2258, 2284) | `taskForward.js:2173` | **CONFIRMED WORKING** — `router` is exported by reference and `require()` runs the whole module body first, so the later routes do attach. Fragile, not broken. |
| `GET /task/:taskId/forward-budget` registered **twice**, identically | `taskForward.js:1184` and `:1191` | Second is dead. Harmless. |
| `request-report` handler references `submitterName`, `text`, `files` — **none are in scope** | `taskForward.js:2222,2232,2246` | **INTENDED BUT BROKEN** — the email block throws `ReferenceError` on every call, swallowed by its own `try/catch`. The status update itself succeeds. |
| That same block is a copy-paste of `submit-report`'s emails — it would send "component done" and "report submitted" when a report is merely *requested* | `taskForward.js:2208-2251` | Contradictory intent; currently masked by the bug above. |
| `empDoc.exists()` called as a function (it is a property on Admin SDK snapshots) | `routes/task_routes/cowork.js:957` | **INTENDED BUT BROKEN** — `/notify-request-response` email branch always throws. |
| Two `io.on("connection")` handlers registered on one server | `server.js:79` and `:101` | **CONFIRMED WORKING** but duplicated — both fire for every socket. |

---

## 2. Complete Feature Inventory

Classification: **preserve** (behaviour and shape carry over) · **preserve with redesign** (behaviour carries, UI rebuilt) · **rebuild** (behaviour carries, logic rewritten because legacy is broken or unsafe) · **defer** (post-v1) · **drop** (excluded).

### 2.1 Authentication & Identity

| Feature | Legacy implementation | Class | Notes |
|---|---|---|---|
| Email/password login | `lib/coworkAuth.js:5-48` → Firebase Auth `signInWithEmailAndPassword` | preserve with redesign | |
| Role from custom claims | `getIdTokenResult(true).claims.role` | rebuild | Role duplicated in claims + Firestore doc; they desync |
| Employee-exists check | Firestore `cowork_employees` by `authUid`, fallback `email` | rebuild | Email fallback is unsafe |
| Deactivation check | `isActive === false \|\| status ∈ {inactive, suspended}` | preserve | |
| Server token verification | `Middlewear/coworkAuth.js:25-76` | rebuild | |
| 5-minute in-memory role cache | `coworkAuth.js:6-18` | rebuild | Privilege-revocation delay |
| Auto-provision CEO on claim | `coworkAuth.js:49-62` | **drop** | Silent admin creation |
| Unauthenticated CEO seed | `POST /cowork/setup/seed-ceo`, `cowork.js:17` | **drop** | No auth whatsoever |
| Forced logout on role/password change | `auth.revokeRefreshTokens` | preserve | |
| Temp password stored plaintext | `cowork.js:399-401` | **drop** | |
| Change own password / email | `POST /change-password`, `/change-email` | preserve | |
| Client-side route guard | `app/coworking/layout.js:36` — `if (!user) return children;` | rebuild | No redirect; unguarded |

### 2.2 Employees, Departments, Hierarchy

| Feature | Legacy | Class |
|---|---|---|
| Create employee (picks `biometricId` from HR Mongo pool) | `POST /employee/create`, `cowork.js:270` | preserve with redesign |
| Auto temp password + welcome email | `svc.createCoworkEmployee` + `sendWelcomeEmail` | rebuild (no plaintext) |
| List / get employee | `GET /employee/list` (CEO/TL), `/employee/list-members` (all), `/employee/:id` | preserve |
| Delete employee (Auth + Firestore) | `DELETE /employee/:id`, `cowork.js:765` | rebuild (CEO-only) |
| Change role | `POST /employee/:id/change-role` | rebuild |
| Change department | `POST /employee/:id/change-department` | preserve |
| Change employee ID | `PATCH /employee/:id/update-id`, `cowork.js:716` | **rebuild** — orphans every `assigneeIds`/`memberIds`/`sopPoints` reference |
| Reset another's password | `POST /employee/:id/reset-password` — **CEO/TL** | rebuild (must never reach the top admin) |
| Biometric ID picker (available vs used) | `GET /employee/biometric-ids` | defer |
| "My managers" (read-only) | `GET /employee/my-managers/:employeeId` → Mongo `primaryManager`/`secondaryManager` | **rebuild** — hierarchy exists but is never used for authorisation |
| Departments | Free-text string on the Firestore employee doc | rebuild (first-class entity) |
| Duty status on/off | `cowork_duty_status` collection, `DutyStatusToggle.jsx` | preserve with redesign |
| Team status widget | `TeamStatusWidget.jsx` | preserve with redesign |

### 2.3 Tasks — see [TASK_LOGIC_SPEC.md](TASK_LOGIC_SPEC.md) for full traces

| Feature | Class |
|---|---|
| Normal assigned task | preserve |
| Folder task | preserve |
| Subtask (arbitrary depth) | preserve |
| Repeat task + daily slot submissions | preserve with redesign |
| Third-party / vendor task + payment actions | defer |
| Goal task (additive progress) | preserve |
| Gold task (C2 vehicle) + `goalActivities[]` components | preserve |
| Multi-user gold (`perUserStatus`) | preserve |
| Self-assigned task + approver gate | preserve |
| Forwarded task + forward budget | preserve |
| Cross-department approval gate (two-stage) | preserve |
| CEO-assignment approval gate | preserve |
| `pending_tl_hours` — receiving TL sets ETC | preserve |
| Priority (numeric rank, per-person) | **rebuild** — client-only writes, no server validation |
| P1 conflict cascade | preserve with redesign |
| Priority acknowledgement modal | preserve |
| Priority swap panel (drag) | **rebuild** — contradicts drag-reorder semantics |
| Deadline negotiation (propose/approve/counter/respond) | preserve |
| Deadline extension + penalty-waiver | preserve |
| Timers, work commits | preserve |
| Daily reports | preserve |
| Task chat | preserve |
| Draft chat (pre-start negotiation thread) | preserve |
| Attachments (images, PDFs, files) | preserve with redesign |
| Submit completion | preserve |
| Review: approve / rework / reject | **rebuild** — no permission check today |
| CEO second-stage review | preserve |
| Parent progress roll-up | preserve |
| Move to folder | preserve |
| Edit details | preserve |
| Reset to draft | preserve |
| Delete (recursive, hard) | **rebuild** — must become soft-delete |
| Cancellation | rebuild — no first-class endpoint exists |
| `/task/assign`, `PATCH /task/:taskId/progress`, `GET /task/list` (`cowork.js:639-652`) | **drop** — superseded by the `taskForward` engine; legacy dual API |

### 2.4 Workload & Calendar

| Feature | Legacy | Class |
|---|---|---|
| Workload summary | `GET /cowork/workload/summary` | preserve with redesign |
| Per-employee calendar | `GET /cowork/workload/employee/:employeeId/calendar` | preserve with redesign |
| Blocked dates (holidays + approved leave) | `GET /cowork/scheduling/blocked-dates` → Mongo `CompanyHoliday` + `LeaveApplication` | preserve |
| Duplicate blocked-dates endpoint | `GET /cowork/deadline-availability/blocked-dates` | drop (duplicate) |
| Office schedule + breaks | `cowork_settings/office` — `schedule[day].{inTime,outTime,isOff}`, `breaks[]` | preserve |
| Status tracking | `/coworking/status-tracking` | preserve with redesign |

### 2.5 Messaging

| Feature | Legacy | Class |
|---|---|---|
| Direct messages | `cowork_conversations` / `cowork_direct_messages`; `POST /direct-message/send` | preserve with redesign |
| Group messages | `cowork_groups`; `POST /group/:groupId/message` | preserve with redesign |
| Media messages | `POST /message/direct-media`, `/message/group-media` (reachable in `coworkEnhanced.js`) | preserve |
| Notify-only endpoints (client already wrote Firestore) | `POST /direct-message/notify`, `/group/:groupId/notify` | rebuild — writes and notifications must not be split across trust boundaries |
| Typing indicators | socket `typing` | preserve |
| Reply-to, swipe actions, link detection, lightbox | `MessageBubble.jsx`, `SwipeableMessage.jsx`, `LinkedText.jsx`, `ImageLightbox.jsx` | preserve with redesign |
| Two conversation endpoints | `/direct-message/conversations` and `/conversations-v2` | drop v1 |

### 2.6 Groups

Create (CEO/TL), update/delete (CEO), add/remove members (CEO), list, members, group chat, group task manager. **preserve with redesign.**

### 2.7 Meetings

| Feature | Legacy | Class |
|---|---|---|
| Schedule / edit / cancel | `POST /schedule-meet/create`, `PATCH .../edit`, `.../cancel` | preserve with redesign |
| In-app room | LiveKit, `CoworkMeetingRoom.jsx` (1,926 ln) | preserve with redesign |
| PiP controls | `PipRoomControls.jsx`, `lib/pipMeetingStore.js` | preserve |
| Guest join by token | `GET /public/meeting-info/:token`, `POST /public/guest-join` | preserve |
| Recording start/pause/stop + broadcast | socket `recording_start` / `recording_stop` | preserve |
| Transcription | `meeting_transcripts`, `transcript.routes.js` | defer |
| AI summaries (Gemini) | `meetingSummary.routes.js` | **defer — gated on owner decision** |
| Ask-AI over recordings | `POST /cowork/audio/ask/:meetId` | **defer — gated on owner decision** |
| DOCX summary export | `generateSummaryDocx.js` | defer |
| Audio calls (1:1) | socket call signalling + LiveKit | preserve with redesign |
| Global incoming-call receiver | `GlobalCallReceiver.jsx`, `IncomingCallToast.jsx` | preserve |

### 2.8 Notifications

| Channel | Legacy | Class |
|---|---|---|
| In-app | `cowork_notifications` docs + `GET /notifications`, `PATCH /notifications/read-all` | preserve |
| Socket | `_socket.emitToMany(ids, "new_notification", …)` | preserve |
| FCM push | `services/fcmPush.service.js` | preserve |
| Email | `services/emailNotifications.service.js` via Brevo, cooldown-gated | preserve |
| Web push (VAPID) | `utils/sendWebPush.js` | defer |
| Expo push | `utils/sendExpoPush.js` | drop (no mobile app in scope) |

### 2.9 SOP / Conduct

Catalogue with folders, approval workflow, severity tiers, the **bleach ledger** (`Employee.sopPoints[year].bleaches[]`), recheck/dispute flow, attendance-derived task suggestions, timer-SOP deficit/overtime engine. **rebuild** — the ledger concept is right, the storage and dual-write are not. See [SCORING_LOGIC_SPEC.md](SCORING_LOGIC_SPEC.md).

### 2.10 Attendance

Biometric sync (eTimeOffice/TeamOffice) → `DailyAttendance` → C4 policy triggers → SOP ledger. Always-on hourly presence engine with 7-day lookback. **preserve with redesign** (integration boundary changes).

### 2.11 Score / PMP

`/coworking/pmp` "My Score" page, C1–C4, quarter and annual roll-up, ratings, gap-to-next, flags, band config. **rebuild** — see [SCORING_LOGIC_SPEC.md](SCORING_LOGIC_SPEC.md).

### 2.12 Google Workspace

Gmail (inbox/unread/search/message/my-inbox/all-inbox), Tasks (lists/flat/create/subtask/update), Calendar (calendars/events/today/create), Drive (files/search), Chat (spaces/messages/members), per-employee OAuth. **defer** — see [INTEGRATIONS_SPEC.md](INTEGRATIONS_SPEC.md).

### 2.13 Admin Settings

Task settings (`/coworking/task-settings`, CEO-only) writing `cowork_sop_settings/task_events`; band config; office schedule. **rebuild** — scope depends on the fixed-vs-configurable weights decision.

### 2.14 Hidden, repair, debug and unused features

| Item | Location | Class |
|---|---|---|
| `GET /task/force-repair-self-assign` — **no auth middleware at all**, rewrites every task in the collection | `taskForward.js:464` | **drop** |
| `GET /task/self-assign-debug/:employeeId` — **no auth**, dumps task data | `taskForward.js:507` | **drop** |
| `POST /task/self-assign-repair` | `taskForward.js:531` | drop |
| `GET /task/dump/:taskId`, `GET /employee/dump/:employeeId` | `taskTree.routes.js` (only reachable routes there) | drop |
| `GET /cowork/test-email` | `cowork.js:806` | drop |
| `GET /cowork/audio/test-gemini` | `meetingSummary.routes.js` | drop |
| `POST /cowork/timer-sop/test-finalize/:employeeId` | `timerSop.routes.js` | drop |
| `/coworking/fix-priorities` page | frontend | drop |
| Office Monitor (desktop surveillance) | separate Firebase project | **drop** (owner-confirmed) |
| MRF (material requests) | `/coworking/mrf` | **drop** (owner-confirmed) |
| `console.log("yugyu", …)` in `/me` | `cowork.js:41` | drop |
| `[C4 DEBUG]` log per score computation | `pmpService.js:369` | drop |
| `+6h "BRANDED PROBE"` fallback in due-date math | `taskForward.js:1625,1707` | drop — a silent 6-hour deadline shift used as a debug marker |

**Note on the two `force-repair`/`self-assign-debug` endpoints:** neither has `verifyCoworkToken`. They are reachable unauthenticated by anyone who can reach the server. `force-repair-self-assign` performs a full-collection scan and write. This is the single most dangerous reachable endpoint found. **CONFIRMED WORKING — and that is the problem.**

---

## 3. Notifications and Realtime Events

### 3.1 Delivery mechanism

Two near-identical fan-out helpers exist:

- `taskForward.js:23` `_notify({recipientIds, type, title, body, data, senderId, senderName})` — batch-writes `cowork_notifications` docs, emits socket `new_notification`, then fires FCM via `setImmediate`.
- `services/taskForward.service.js:145` `_notifyMany(...)` — same contract, plus email via `sendNotificationEmail` and richer title/body building (`_buildTitle`, `_buildRichBody`).

**Duplicate implementation.** Routes use `_notify`; services use `_notifyMany`. Same event class gets different treatment depending on which layer raised it — notably, `_notify` never sends email.

Notification document shape (`cowork_notifications`):
```
recipientEmployeeId, type, title, body, data{}, read: false, createdAt
```
Read state is **all-or-nothing**: `PATCH /notifications/read-all` only. There is no per-notification read endpoint. **CONFIRMED WORKING** — and a real gap.

### 3.2 Task notification catalogue

| Trigger | Type | Recipients | Channels | Source |
|---|---|---|---|---|
| Cross-dept task created | `department_approval_request` | both approvers | app+socket+FCM | `taskForward.js:386` |
| Sender-side approved | `department_approval_your_turn` | receiver-side approver | app+socket+FCM | `:1093` |
| Dept approval rejected | `department_approval_rejected` | `assignedBy` | app+socket+FCM | `:1090` |
| Both approved | `department_approval_completed` | `assignedBy` + assignee | app+socket+FCM | `:1105` |
| Draft needs hours | `department_draft_needs_hours` | receiving dept TL | app+socket+FCM | `:400`, `:1100` |
| Hours set | `department_draft_activated` | assignee + `assignedBy` | app+socket+FCM | `:1162` |
| Self-assign created | `self_assign_pending` | chosen approver | app+socket+FCM | `:413` |
| Self-assign approved | `self_assign_approved` | assignees | app+socket+FCM | `:584` |
| Self-assign rejected | `self_assign_rejected` | assignees | app+socket+FCM | `:607` |
| Task assigned | `task_assigned` | assignees | app+socket+FCM+**email** | `service:395` |
| Task confirmed | `task_confirmed` | `assignedBy`, `originalAssignedBy` | +socket `task_confirmed` | `service:457` |
| Task started | `task_started` | `assignedBy`, `originalAssignedBy` | +socket `task_started` | `service:480` |
| Deadline proposed | `deadline_proposed` | creator(s) | +socket `deadline_proposed` | `service:1630` |
| Deadline approved | `deadline_approved` | assignees | app+email | `service:1825` |
| Sender timer approved | `sender_timer_approved` | `assignedBy` | **FCM only** | `taskForward.js:1747` |
| Sender timer rejected | `sender_timer_rejected` | `assignedBy` | **FCM only** | `:1818` |
| Extension requested | `deadline_extension_requested` | `assignedBy` | app+socket+FCM | `:1963` |
| Extension reviewed | `deadline_extension_reviewed` | assignees | app+socket+FCM | `:2020` |
| Deadline changed (CEO edit) | `deadline_changed` | assignees except editor | app+email | `service:1055` |
| **Deadlines auto-extended by P1** | `deadline_auto_extended` | **`assignedBy` only** | app+email | `service:2364` |
| Completion submitted | `completion_submitted` | flow-dependent reviewers | +socket `task_completion_submitted` | `service:1226` |
| TL approved (→CEO) | `completion_tl_approved` | CEO + submitter | +socket `task_completion_tl_approved` | `service:1293` |
| Fully approved | `completion_ceo_approved` | assignees + `assignedBy` + submitter | +socket `task_completed` | `service:1267,1281,1480` |
| Rejected | `completion_rejected` | submitter | +socket `task_completion_rejected` | `service:1322` |
| CEO rejected | `completion_ceo_rejected` | assignees + submitter | +socket | `service:1492` |
| Rework | `task_rework` | submitter | app+email | `service:1427` |
| Task deleted | `task_deleted` | assignees | +socket `task_deleted` | `service:1115` |
| Goal roadmap submitted | `goal_final_submit` | heads | **email only** | `taskForward.js:2132` |
| Goal component done | `goal_component_done` | heads | **email only** | `:2334` |
| Goal report submitted | `goal_report_submitted` | heads | **email only** | `:2349` |

### 3.3 Notification gaps

| Gap | Label |
|---|---|
| **P1 cascade notifies the manager, not the employee whose deadlines moved.** The employee learns via `PriorityChangeAckModal` polling the task array — no notification record exists for them. | **CONFIRMED WORKING** (as written) — design gap |
| **No notification on priority change** at all. Priority writes go client→Firestore directly; nothing raises an event. | **FE/BE CONTRADICTION** |
| **No notification on rework-waived vs rework-charged** — the employee is never told a deduction was applied. | Gap |
| Sender-timer approve/reject send **FCM only** — no in-app record, so the event vanishes if push is off. | Gap |
| Goal events send **email only** — no in-app record. | Gap |
| `_notify` (route layer) never sends email; `_notifyMany` (service layer) does. | Duplicate implementation |
| No per-notification read; only read-all. | Gap |
| `/notify-request-response` email branch always throws (`empDoc.exists()`). | **INTENDED BUT BROKEN** |

### 3.4 Socket.IO events

**Server → client (task domain):** `new_notification`, `task_confirmed`, `task_started`, `task_completion_submitted`, `task_completion_tl_approved`, `task_completed`, `task_completion_rejected`, `task_deleted`, `deadline_proposed`, `timer_blocked`

**Client → server (`server.js:101-420`):** `join_cowork`, `typing`, `join_group`, `leave_group`, `join_dm`, `leave_dm`, `join_meeting_room`, `leave_meeting_room`, `recording_start`, `recording_stop`, `call_reject`, `call_end`, `call_rejoin_token`, `workspace-set-online`, `disconnect`

**Client → server (ERP handler, `server.js:79-95`):** `join-workorder`, `leave-workorder`, `disconnect` — out of scope, but note both handlers run.

`timer_blocked` is notable: emitted when a deadline extension is proposed while `in_progress`, telling the client to stop the running timer (`service:1607`). The block is **advisory** — enforcement is entirely client-side.

---

## 4. Data Model — Existing Fields

### 4.1 `cowork_tasks` — the central document

Grouped by concern, from `createTask` (`service:224-425`) and every observed `update()`.

**Identity & content**
`taskId`, `title`, `description`, `notes`, `requirements[]`, `path`, `createdAt`, `createdAtISO`, `updatedAt`, `quarter`, `year`

**Assignment**
`assignedBy`, `assignedByName`, `assignedByRole`, `rootCreatedByRole`, `originalAssignedBy`, `assigneeIds[]`, `confirmedBy[]`, `groupId`, `createdByTl`, `createdByCeo`, `isForwardedTask`, `forwardedBy`

**Hierarchy**
`parentTaskId`, `subtaskIds[]`, `isFolder`

**Status (two independent axes)**
`status` — workflow position
`completionStatus` — review position (`submitted`, `tl_approved`, `tl_final_approved`, `ceo_approved`, `tl_rejected`, `ceo_rejected`, `approved`, `null`)
`reviewFlow` — `tl_final` \| `ceo_direct` \| `tl_then_ceo`
`progressPercent`

**Priority**
`priority` (shared numeric), `assigneePriorities{employeeId: number}` (per-person), `order` (`(rank)*1000`), `autoExtendedDueToP1`, `cascadeEstimatedDueDate`, `cascadeEstimatedAtMs`, `cascadeAssumedP1FinishMs`, `deadlineAutoExtendedHistory[]`

**Deadline & timing**
`dueDate`, `fixedDeadline`, `hasTimer`, `senderTimerWindowSecs`, `deadlineWindowSecs`, `originalWindowSecs`, `deadlineWindowSecsBeforeProposal`, `etcHours`, `deadlineStatus`, `deadlineColor`, `startedAt`
`proposedDeadline`, `proposedDeadlineBy`, `proposedDeadlineByName`, `proposedDeadlineAt`, `prevStatusBeforeDeadlineProposal`, `deadlineProposalRejected`, `deadlineRejectionReason`
`deadlineApprovedBy`, `deadlineApprovedByName`, `deadlineApprovedAt`
`pendingExtensionSecs`, `pendingExtensionPrevWindowSecs`, `extensions[]`, `awaitingExtensionStart`, `lastExtensionSecs`
`senderTimerApprovedBy/ByName/At`, `senderTimerRejected`, `senderTimerRejectionReason`, `senderTimerRejectedBy/ByName`
`tlCounterDeadline…`, `deadlineExtRequest{proposedDate, reason, requestedBy, requestedByName, requestedAt, extensionFiledAt, elapsedPercent, status, isPenaltyWaived, reviewedBy, reviewedByName, reviewedAt, approvedDate, counterDate}`
`deadlineHistory[]`

**Approval gates**
`pendingAssigneeId`, `pendingAssigneeName`, `departmentApprovals[{approverId, approverName, side, source, status, respondedAt, rejectionReason}]`, `tlApprovedBy/ByName/At`, `tlHoursSetBy/ByName/At`

**Self-assign**
`isSelfAssigned`, `approverId`, `approverName`, `visibleTo[]`, `selfAssignApproved`, `selfAssignApprovedAt/By/ByName`, `selfAssignRejectedAt/By/ByName`, `selfAssignRejectionReason`

**Review**
`completionSubmission{submittedBy, submittedByName, message, imageUrls[], pdfAttachments[], submittedAt}`, `tlReview{}`, `ceoReview{}`, `reworkHistory[]`, `approvedBy/ByName/At`

**Scoring**
`c1{taskScore, deadlinesMissed, extensionsFiled, reworksReceived, rejectionsReceived, c1Status, isExcluded, isRejected, officialDeadline, scoreCalculatedAt}`
`isGoldTask`, `c2Config{weightagePercent, taskMaxPoints, globalMaxPointsAtCreation}`, `goalActivities[]`, `isMultiUserGold`

**Type-specific**
`isRepeat`, `repeatConfig`, `repeatSubmissions{date:{slot_N:{…}}}`, `repeatConfirmedBy/ByName/At`
`isThirdParty`, `thirdPartyConfig`, `thirdPartyStatus`, `vendorUpdates[]`
`isGoal`, `goalConfig{targetValue, unit, goalType}`, `goalUpdates[]`, `goalAchieved`, `goalActivitiesSubmitted/At/UpdatedAt`

**Chat**
`chatMessageCount`, `lastChatAt`, `lastChatPreview`
Subcollections: `chat/`, `draft_chat/`, `dailyReports/`

### 4.2 Cross-store join

```
Firebase Auth uid
   └─► cowork_employees.authUid   (doc ID = employeeId)
             │
             └── employeeId ≡ MongoDB Employee.biometricId
                        ├─ designation ─► BandConfig.bands
                        ├─ primaryManager / secondaryManager   (exists, unused for authz)
                        └─ sopPoints[year].bleaches[]  ◄── C1 writes here
                                    ├─ type "C3" ─► computeC3ForEmployee
                                    └─ type "C4" ─► computeC4ForEmployee
```

`Employee.employeeId` is a **read-only Mongoose virtual over `biometricId`** (`models/Employee.js:457`) and is therefore **not queryable**. Querying `{employeeId}` silently returns null — a defect that disabled the timer-SOP engine entirely until fixed (`timerSop.service.js:14-18`). Any new code touching this boundary must query `{biometricId}`.

---

## 5. Validation Summary — Major Workflows

| Workflow | FE handler | API | Reachable route | Service | DB write | Notify | Score | Label |
|---|---|---|---|---|---|---|---|---|
| Login | `coworkSignIn` | Firebase SDK | — | — | — | — | — | CONFIRMED WORKING |
| Create task | `CreateTaskModal.jsx` | `POST /cowork/task/create` | `taskForward.js:135` | `createTask` | `cowork_tasks` | `task_assigned` | none | CONFIRMED WORKING |
| Confirm receipt | tasks page | `POST /task/:id/confirm` | `:452` | `confirmTaskReceipt` | `confirmedBy[]`, `status:confirmed` | `task_confirmed` | none | CONFIRMED WORKING |
| Start | tasks page | `POST /task/:id/start` | `:968` | `markTaskStarted` | `status:in_progress`, `startedAt` | `task_started` | none | CONFIRMED WORKING |
| **Change priority** | `handleUpdatePriority` / `executeDrop` | **none — direct Firestore write** | — | — | `priority`, `assigneePriorities.*`, `order` | **none** | none | **FE/BE CONTRADICTION** |
| P1 cascade | drag modal confirm | `POST /task/p1-conflict-check` | `:2258` | `checkAndExtendForP1` | deadlines + `deadlineAutoExtendedHistory[]` | `deadline_auto_extended` → **manager only** | none | CONFIRMED WORKING |
| Propose deadline | `EditDeadlineModal.jsx` | `POST /task/:id/propose-deadline` | `:1655` | `proposeDeadline` | `status:pending_deadline_approval` + window fields | `deadline_proposed`, socket `timer_blocked` | none | CONFIRMED WORKING |
| Approve deadline | tasks page | `POST /task/:id/approve-deadline` | `:1832` | `approveDeadline` | `dueDate`, `deadlineWindowSecs`, `extensions[]` | `deadline_approved` | none | CONFIRMED WORKING |
| Submit completion | `SubmitCompletionModal.jsx` | `POST /task/:id/submit-completion` | `:1490` | `submitCompletionRequest` | `completionStatus:submitted`, `completionSubmission{}`, `reviewFlow` | `completion_submitted` | none yet | CONFIRMED WORKING |
| **Approve completion** | `ReviewCompletionModal.jsx` | `POST /task/:id/review-completion` | `:1576` | `reviewCompletion` | `completionStatus`, `status:done` | `completion_ceo_approved` | **C1 fires** | **CONFIRMED WORKING — but no permission check** |
| Rework | `ReviewCompletionModal.jsx` | `POST /task/:id/rework` | `:1499` | `reworkTask` | `completionStatus:null`, `status:in_progress`, `c1.reworksReceived+1`, deadline re-granted | `task_rework` | −0.2 SOP entry unless waived | CONFIRMED WORKING |
| Reject | `ReviewCompletionModal.jsx` | `POST /task/:id/review-completion` (`approved:false`) | `:1576` | `reviewCompletion` | `completionStatus:tl_rejected`, `status:in_progress` | `completion_rejected` | **C1 fires with `isRejected`** | CONFIRMED WORKING |
| CEO review | tasks page | `POST /task/:id/ceo-review` | `:1586` | `ceoReviewCompletion` | `completionStatus:ceo_approved\|ceo_rejected` | `completion_ceo_*` | C1 on approve **only** | CONFIRMED WORKING (asymmetric) |
| Forward | `ForwardTaskModal.jsx` | `POST /task/:id/forward` | `:1168` | `forwardTask` | child tasks + parent `status:in_progress` | `task_assigned` per child | none | CONFIRMED WORKING |
| Delete | tasks page | `DELETE /task/:taskId` | `:1372` | `deleteTask` | **hard recursive delete** | `task_deleted` | none | CONFIRMED WORKING |
| Timer start/pause | `useTaskTimer.js` | **none — direct Firestore** | — | — | `cowork_task_timers/{emp}/sessions/{task}` | none | via timer-SOP | **FE/BE CONTRADICTION** |
| Work commit | tasks page `:1889` | **none — direct Firestore** | — | — | `cowork_work_commits/{emp}/logs` | none | via timer-SOP | **FE/BE CONTRADICTION** |

---

## 6. Open Questions Carried Forward

Collected here; each is repeated in context in the relevant spec.

| # | Question | Where |
|---|---|---|
| 1 | Rejection score effect — legacy sets the whole task to `c1RejectScore` (default 0) | SCORING §4 |
| 2 | Missed-deadline deduction magnitude | SCORING §4 |
| 3 | Extension deduction magnitude | SCORING §4 |
| 4 | Cancellation treatment (excluded vs zero) | SCORING §4 |
| 5 | Late-submission deduction, separate from deadline miss | SCORING §4 |
| 6 | Does priority affect score? (legacy: no) | TASK §3 |
| 7 | Goal (C2) deduction rules | SCORING §4 |
| 8 | Conduct (C3) deduction values | SCORING §4 |
| 9 | Attendance lateness rate, grace period, absence, half-day, early departure | SCORING §4 |
| 10 | Component weights across C1–C4 | SCORING §4 |
| 11 | Reporting period and score finalisation | SCORING §4 |
| 12 | Credits and bonuses — do they exist? | SCORING §4 |
| 13 | Multi-assignee scoring — legacy scores `assigneeIds[0]` only | TASK §7 |
| 14 | Whether rework may be waived at all, and by whom | TASK §8 |
| 15 | Whether a rejected task may be resubmitted (legacy: yes, silently) | TASK §8 |
| 16 | Whether the 70% elapsed threshold for extension penalty is a real rule | TASK §5 |
| 17 | Whether AI meeting features remain | INTEGRATIONS §3 |
| 18 | Google Workspace scope for v1 | INTEGRATIONS §3 |
| 19 | Third-party/vendor tasks — in or out of Cowork | LEGACY §2.3 |
| 20 | Repeat-task slot model — keep or generalise | TASK §2 |
