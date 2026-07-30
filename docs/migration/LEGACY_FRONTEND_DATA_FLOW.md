# Legacy Frontend Data Flow

Audit of `~/Documents/cowork-old-frontend`. Read-only.

## Shape

Next.js App Router, JavaScript (not TypeScript), 252 files, **30 pages** — all
but three under `/coworking/*`. Unlike the backend, this frontend **is**
Cowork-only. The manufacturing and accounting products have their own clients.

## The finding that determines the whole migration

**The legacy frontend is not a client of the legacy backend. It is a client of
Firestore.**

| Access path | Files |
|---|---:|
| `firebase` imported | **61** |
| `firestore` used | 46 |
| `fetch()` to the Express API | 46 |
| `onSnapshot` real-time listeners | 21 |
| `localStorage` | 13 |
| `useQuery` (react-query) | 2 |
| `axios`, SWR | 0 |

Direct **writes** from the browser to Firestore, across 29 files:

| Operation | Occurrences |
|---|---:|
| `updateDoc` | 62 |
| `setDoc` | 49 |
| `arrayUnion` | 13 |
| `writeBatch` | 11 |
| `increment` | 6 |
| `addDoc` | 5 |
| `deleteDoc` | 4 |
| `arrayRemove` | 1 |
| **Total** | **151** |

151 business-data writes issued from the browser with no server in the path.
The Express API is used for the things Firestore cannot do — scoring maths, HR
data in Mongo, SOP, LiveKit tokens, uploads — and for nothing else.

### What that means concretely

- **Every business rule enforced in the browser is advisory.** Anyone with the
  Firebase config — which ships to the client by definition — can write directly
  and skip it. The rules only hold because the UI is the only thing writing.
- Priority is the clearest case: rank is computed as `openTaskCount + 1` and
  written straight to Firestore with **no permission check and no audit record**.
  There is no server endpoint for it to bypass, because there is no server
  endpoint at all.
- Firestore security rules are the only real enforcement boundary, and they are
  not in either repository. **They must be obtained or reconstructed before
  anyone reasons about what legacy actually permitted.** Blocking unknown.

This is the pattern the new architecture already rejects — server-side
permissions, repository boundary, pure domain rules. Nothing here is worth
preserving structurally. Only the *behaviour* is.

## Collections the browser touches

Ranked by reference count in the frontend:

| Collection | Refs | Also written by backend |
|---|---:|:--:|
| `cowork_tasks` | 92 | ✓ |
| `cowork_direct_messages` | 31 | ✓ |
| `cowork_requests` | 30 | ✗ |
| `cowork_groups` | 27 | ✓ |
| `cowork_employees` | 27 | ✓ |
| `cowork_notifications` | 18 | ✓ |
| `cowork_settings` | 17 | ✓ |
| `cowork_mails` | 10 | ✗ |
| `cowork_task_timers` | 8 | ✓ |
| `cowork_sop_settings` | 8 | ✓ |
| `cowork_duty_status` | 7 | ✗ |
| `cowork_work_commits` | 6 | ✓ |
| `cowork_notes` | 6 | ✗ |
| `cowork_scheduled_meets` | 4 | ✓ |
| `cowork_goal_status` | 4 | ✗ |
| `cowork_emergency_approvals` | 4 | ✗ |
| `cowork_login_toast` / `cowork_logout_toast` | 6 | ✗ |
| `cowork_timer_events` | 2 | ✓ |
| `cowork_fcm_tokens` | 1 | ✓ |

Backend-only collections the frontend never reads: `cowork_conversations`,
`cowork_audio`, `cowork_guest_sessions`, `cowork_join_codes`,
`cowork_meeting_participants`, `cowork_meta`, `cowork_sop_applied`,
`cowork_default`.

`cowork_login_toast` / `cowork_logout_toast` are Firestore documents used to pass
a toast message between pages. Noted only so nobody migrates them.

## Pages and their dependencies

| Page | Primary source | Notes |
|---|---|---|
| `/coworking` | Firestore | Dashboard |
| `/coworking/tasks` | Firestore (`onSnapshot`) | The main surface. Real-time task list, timers, commits |
| `/coworking/pmp` | API | Score — the one major read-only API consumer |
| `/coworking/sop` | API | SOP points and history |
| `/coworking/task-settings`, `/settings` | Firestore `cowork_settings` | Office hours, break allowance |
| `/coworking/office-monitor`, `/[id]` | Firestore + LiveKit | Screen monitoring |
| `/coworking/calendar`, `/calendar/[employeeId]` | Firestore + API | Uses the blocked-dates bridge |
| `/coworking/direct-messages`, `/[conversationId]` | Firestore `onSnapshot` | Chat |
| `/coworking/groups`, `/create-group`, `/[groupId]` | Firestore | |
| `/coworking/mail`, `/mail/gmail` | Firestore + API | |
| `/coworking/schedule-meet`, `/new`, `/cowork-meeting/[meetId]` | Firestore + LiveKit API | |
| `/coworking/audio-call/[convId]` | LiveKit + sockets | |
| `/coworking/create-employee` | API (Mongo) + Firestore | **Writes both stores** — the seam |
| `/coworking/status-tracking` | Firestore `cowork_duty_status` | Presence |
| `/coworking/fix-priorities` | Firestore batch write | **A UI whose purpose is repairing corrupted priority data.** Its existence is evidence the client-side priority model does not hold |
| `/coworking/docs`, `/mrf`, `/join/[token]`, `/privacy` | mixed | |
| `/google-task`, `/workspace/google-panel` | API | |

## Loading, error and empty states

Spot-checked rather than exhaustively verified. The prevailing pattern is a
boolean `loading` flag with an inline spinner and **no error branch** — a failed
Firestore read leaves the previous state on screen. Retry is manual (reload).
There is no shared query layer to change this in one place, which is why the new
requirement for loading/error/empty/retry on every screen is a rewrite rather
than a port.

## `NEXT_PUBLIC_*` surface

`NEXT_PUBLIC_API_URL` (59 uses), six `NEXT_PUBLIC_FIREBASE_*`, two Cloudinary,
`NEXT_PUBLIC_LIVEKIT_URL`. All client-visible by construction — which is exactly
why browser-side Firestore access cannot be secured by hiding configuration.

## What carries forward

**Behaviour** — the task board, timer/commit model, real-time message and
notification feel, presence, the calendar's blocked-date awareness.

**Not the mechanism** — no direct client database access, no
`onSnapshot`-as-architecture, no localStorage as source of truth, no
`fix-priorities` repair screen. The new project's repository boundary already
forbids all of it.
