# Legacy Frontend Map

Reference for `~/Documents/cowork-old-frontend` — what each screen does and
where its data comes from. Companion to [backend-map.md](backend-map.md).

## Shape

Next.js App Router, **JavaScript (not TypeScript)**, 252 files, **30 pages**.
All but three sit under `/coworking/*`. Unlike the backend, this client is
Cowork-only; the manufacturing, accounting and HR products have their own UIs.

**There is no HR screen here.** Employee listing, departments, attendance,
leave, payroll and reports have no legacy UI in this repository.

## The finding that governs Step 2

**This frontend is not primarily a client of the Express backend. It is a client
of Firestore.**

| Access path | Files |
|---|---:|
| `firebase` imported | **61** |
| `firestore` used | 46 |
| `fetch()` to the API | 46 |
| `onSnapshot` live listeners | 21 |
| `localStorage` | 13 |
| react-query | 2 |
| axios / SWR | 0 |

Direct browser writes to Firestore, across 29 files: `updateDoc` 62, `setDoc` 49,
`arrayUnion` 13, `writeBatch` 11, `increment` 6, `addDoc` 5, `deleteDoc` 4,
`arrayRemove` 1 — **151 business-data writes with no server in the path.**

### The split is not arbitrary

| Goes through the API | Stays in Firestore |
|---|---|
| Task create / confirm / start / submit / review | Task **reads** (live lists) |
| Deadline negotiation | **Timers** and pause/resume |
| Scoring (`/pmp`, `/c1`, `/c2`) | **Priority rank** |
| SOP rules, bleaches, recheck | **Duty status**, break, emergency |
| Employee create / role / department | Presence and monitoring |
| Notifications *send* | Notifications *read* |
| Meetings, LiveKit tokens, uploads | Messages and groups (live) |
| Google Workspace, Gmail | Settings documents |

The rule in practice: **anything with a consequence somebody audits goes to the
server; anything on the hot path is written straight from the browser.**

Which means the hot path — the part that actually needs enforcing — is the part
with no enforcement.

## Per-page data sources

Counts are call sites in each `page.js`. Pages showing `0 0` delegate to
components (see below).

| Page | fetch | Firestore | writes |
|---|---:|---:|---:|
| `/coworking/tasks` | 10 | **65** | **35** |
| `/coworking` (dashboard) | 0 | 24 | 5 |
| `/coworking/direct-messages` | 3 | 31 | 18 |
| `/coworking/groups` | 1 | 21 | 10 |
| `/coworking/mail` | 5 | 17 | 6 |
| `/coworking/status-tracking` | 0 | 12 | 0 |
| `/coworking/sop` | **11** | 10 | 3 |
| `/coworking/direct-messages/[conversationId]` | 1 | 9 | 7 |
| `/coworking/schedule-meet` | 0 | 9 | 0 |
| `/coworking/mail/gmail` | **10** | 0 | 0 |
| `/coworking/mrf` | 7 | 0 | 0 |
| `/coworking/create-employee` | 4 | 0 | 0 |
| `/coworking/settings` | 3 | 2 | 2 |
| `/workspace/google-panel` | 3 | 0 | 0 |
| `/coworking/task-settings` | 0 | 2 | 2 |
| `/coworking/fix-priorities` | 0 | 2 | 2 |
| `/coworking/create-group` | 1 | 6 | 0 |
| `/coworking/office-monitor/[id]` | 1 | 0 | 0 |
| `/google-task` | 1 | 0 | 0 |
| `/coworking/schedule-meet/new` | 0 | 1 | 0 |
| `/coworking/pmp`, `/calendar`, `/calendar/[employeeId]`, `/office-monitor`, `/docs`, `/audio-call/[convId]`, `/cowork-meeting/[meetId]`, `/join/[token]`, `/`, `/privacy` | 0 | 0 | 0 |

`/coworking/tasks` — the product's main surface — issues **35 direct Firestore
writes against 10 API calls**.

`/coworking/fix-priorities` is a screen whose entire purpose is repairing
corrupted priority data with a batch write. Its existence is evidence that the
client-side priority model does not hold.

## Components carrying data logic

| File | fetch | Firestore |
|---|---:|---:|
| `components/coworking/layout/CoworkingShell.js` | 11 | **49** |
| `components/coworking/messaging/GroupChatView.jsx` | 2 | 10 |
| `hooks/useCoworkNotifications.ts` | 2 | 7 |
| `components/coworking/shared/DutyStatusToggle.jsx` | 0 | 7 |
| `hooks/useTaskTimer.js` | 0 | **6** |
| `components/coworking/tasks/GoalTask.jsx` | 5 | 2 |
| `components/coworking/tasks/ReceivedRequests.jsx` | 2 | 4 |
| `components/coworking/tasks/CreateTaskModal.jsx` | 0 | 3 |
| `components/coworking/shared/EmergencyApprovalsPanel.jsx` | 0 | 3 |
| `components/coworking/notes/NotesSidebarPanel.jsx` | 2 | 3 |
| `hooks/usePushNotifications.js` | 0 | 3 |
| `components/coworking/meets/CoworkMeetingRoom.jsx` | 0 | 3 |

**`CoworkingShell.js` is the application.** 11 API calls and 49 Firestore
references in the layout component — session bootstrap, employee directory,
notifications, presence and duty status all live in the shell, which is why so
many pages read `0 0`. A new UI must decide deliberately where this belongs;
reproducing a 60-call layout component would be porting the defect.

`useTaskTimer.js` (6 Firestore, 0 fetch) and `DutyStatusToggle.jsx` (7 Firestore,
0 fetch) are the two files that matter most for the new availability/timer work —
**both write straight to Firestore with no server involvement.**

## API wrapper modules

Thin `fetch` wrappers, no shared client, no interceptor, no retry:
`lib/coworkApi.js`, `lib/taskForwardApi.js`, `lib/taskTreeApi.js` (4 — calls the
**dead** taskTree routes), `lib/monitorApi.js` (4), `lib/livekitApi.js`,
`lib/mediaUploadApi.js`, `lib/emergencyApproval.js`, `lib/googleWorkspaceApi.js`,
`lib/cloudinaryUpload.js`, `lib/coworkPushNotifications.js`.
Hooks: `useCoworkTasks.ts`, `useCoworkGroups.ts`, `useCoworkMeets.ts`,
`useCoworkNotifications.ts`, `useTaskTimer.js`, `useMeetingRecording.js`,
`usePushNotifications.js`.

Endpoint paths observed in client code:

```
/cowork/me                          /cowork/employees/list
/cowork/task/create                 /cowork/task/:id
/cowork/task/:id/start              /cowork/task/:id/confirm
/cowork/task/:id/update             /cowork/task/:id/delete
/cowork/task/:id/forward            /cowork/task/:id/deadline
/cowork/task/:id/complete/submit    /cowork/task/:id/complete/tl-review
/cowork/task/:id/complete/ceo-review
/cowork/task/:id/report/submit      /cowork/task/:id/reports
/cowork/task/:id/tree               /cowork/task/:id/breadcrumb
/cowork/task/:id/chat/messages      /cowork/task/:id/chat/send
/cowork/task/:id/chat/upload-image|upload-pdf|upload-voice
/cowork/task/:id/chat/notify-subtask
/cowork/tasks/visible               /cowork/tasks/roots
/cowork/tasks/by-creator/:id        /cowork/tasks/batch-update
/api/cowork/mrf/*                   /api/cowork/notifications/*
```

Several of these (`/complete/submit`, `/tree`, `/breadcrumb`, `/chat/messages`)
belong to **`taskTree.routes.js`, which is shadowed and never executes**. Those
calls either fail or fall through to `taskForward.js`'s equivalents. **Verify
each against live traffic before reproducing it** — the client is not a reliable
witness to which endpoints work.

## Authentication flow

1. Browser signs in with the **Firebase client SDK** (`NEXT_PUBLIC_FIREBASE_*`).
2. Firebase ID token attached as `Authorization: Bearer` on API calls.
3. `GET /cowork/me` bootstraps `{ employeeId, role, name, tempPassword,
   passwordChanged }`.
4. `passwordChanged === false` forces a password change.
5. The same Firebase session authorises **direct Firestore access** — which is
   why the browser can write 151 times without the server.

**A new UI must run Firebase Auth.** `verifyCoworkToken` accepts nothing else.

## Role-based rendering

Role comes from `/cowork/me` and is compared inline (`role === "ceo"`,
`role === "tl"`). No permission map, no capability list — the same pattern as the
backend. Rendering is hidden-if-not-allowed, and because the underlying writes go
straight to Firestore, **hiding a control is frequently the only thing stopping
the action.**

## Hierarchy

`GET /cowork/employee/my-managers/:employeeId` returns an employee's managers;
`GET /cowork/employee/list` returns the directory. The tree is assembled
client-side by repeated traversal — there is no endpoint returning a subtree or
a reporting chain.

## Loading, error and empty states

Spot-checked. The prevailing pattern is a boolean `loading` flag with an inline
spinner and **no error branch** — a failed read leaves stale state on screen.
Retry is a page reload. There is no shared query layer, so this cannot be fixed
in one place.

## Route mapping — legacy → new

The new project's routes already cover most of this. Behaviour must match even
where names change.

| Legacy | New | Note |
|---|---|---|
| `/coworking` | `/home` | Dashboard |
| `/coworking/tasks` | `/tasks`, `/tasks/[taskId]` | New splits detail into sub-routes |
| `/coworking/tasks` (create modal) | `/tasks/new` | Modal → page |
| — | `/tasks/[taskId]/deadline|review|submission|history|chat` | **New** — legacy had modals |
| `/coworking/pmp` | `/score`, `/score/c1..c4`, `/score/history` | |
| `/coworking/sop` | — | **Missing in new** |
| `/coworking/create-employee` | `/admin/people` | |
| `/coworking/settings`, `/task-settings` | `/settings`, `/admin/settings` | |
| `/coworking/direct-messages`, `/[conversationId]` | `/messages`, `/messages/[conversationId]` | |
| `/coworking/groups`, `/create-group`, `/[groupId]` | `/groups`, `/groups/[groupId]` | |
| `/coworking/mail`, `/mail/gmail` | `/mail` | Unified |
| `/coworking/schedule-meet`, `/new`, `/cowork-meeting/[meetId]` | `/meetings`, `/meetings/new`, `/meetings/[meetingId]` | |
| `/coworking/office-monitor`, `/[id]` | `/team/[employeeId]` | |
| `/coworking/status-tracking` | `/team`, `/people` | |
| `/coworking/calendar`, `/[employeeId]` | `/attendance`, `/attendance/history` | |
| `/coworking/join/[token]` | `/join/[token]` | Same |
| `/coworking/docs` | `/docs` | Same |
| `/privacy` | `/privacy` | Same |
| `/coworking/fix-priorities` | — | **Do not port** — a data-repair screen |
| `/coworking/mrf` | — | Manufacturing — out of scope |
| `/google-task`, `/workspace/google-panel` | — | Owner decision |
| — | `/signin`, `/signup`, `/reset-password` | Legacy used Firebase UI |
| — | `/goals`, `/admin/roles`, `/admin/workflows`, `/admin/scoring-rules`, `/admin/organisation`, `/manager`, `/employee`, `/notifications`, `/profile`, `/music`, `/yt` | **New** |

## What Step 2 has to reckon with

Connecting the new UI to "the existing backend" is straightforward for scores,
SOP, employee administration, meetings and uploads — those are real HTTP
endpoints.

It is **not possible as stated** for tasks, timers, priority, duty status,
presence, messages and notifications, because for those the legacy backend is
Firestore accessed from the browser. Reaching them means one of:

- **(A)** the new frontend also talks to Firestore directly — which abandons the
  repository boundary, server-side permissions and organisation isolation;
- **(B)** new endpoints are written in the legacy backend to cover them — which
  the brief's "do not create new backend architecture" rule appears to forbid,
  though it is the smallest change that preserves both the legacy database and
  the new architecture;
- **(C)** the new project's own API routes proxy to Firestore server-side —
  same database, same documents, but enforcement returns to a server.

**(C) is the recommendation**: legacy data and legacy semantics are preserved
exactly, no legacy file is touched, and the new architecture's guarantees
survive. It is the only option that satisfies both this brief and the
already-approved rules.

This decision blocks Step 2 and is the first thing to settle.
