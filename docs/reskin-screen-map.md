# Re-skin Screen Map

**Same application, new skin.** `cowork-old-frontend` is the functional source of
truth: its routes, its data sources, its listeners and its API calls are kept as
they are. Only the visual layer is replaced.

Not a migration. Nothing moves to a repository, nothing becomes an API call that
is a Firestore write today, and no listener is replaced by a fetch.

## The rule that decides every question below

> If the old screen reads Firestore, the new screen reads Firestore.
> If the old screen calls the API, the new screen calls the API.
> Same collection, same document, same query, same write.

Where this document says "reuse the hook", it means literally: the existing
`.js`/`.jsx` module keeps its data logic and the new component renders its
output.

## What the old app is, in numbers

| | |
|---|---|
| Pages | 30, all but three under `/coworking/*` |
| Files importing Firebase | 61 |
| `onSnapshot` live listeners | 21 files |
| Direct Firestore writes | 131 |
| Files calling the Express API | 45 |
| Global state store | **none** — React state + Context + Firestore listeners |

State *is* the listener. A component subscribes and Firestore pushes. That is why
there is no Redux and why introducing one would be a rewrite, not a re-skin.

## Component inventory (old)

| Area | Components |
|---|---:|
| `coworking/tasks` | **31** |
| `coworking/messaging` | 11 |
| `coworking/shared` | 7 |
| `coworking/meets` | 7 |
| `coworking/layout` | 1 — `CoworkingShell.js` |
| `coworking/calendar`, `notes`, `mrf` | 1 each |

## Screen map

### Shell — the first thing to rebuild

| | |
|---|---|
| **Old** | `components/coworking/layout/CoworkingShell.js` |
| **Data** | **11 fetch + 49 Firestore refs.** Session, employee directory, notifications, presence, duty status — all in the layout |
| **Children** | `CoworkNotifBell`, `DutyStatusToggle`, `TeamStatusWidget`, `TopLoadingBar`, `PageLoader`, `EmergencyApprovalsPanel` |
| **New structure** | `AppShell` → `ShellFrame` → `WorkspaceShell` (existing), with `TopBar` rendering the same four widgets re-skinned |
| **Keep** | Every listener and fetch in `CoworkingShell.js`. Extract them into a hook the new shell consumes — **move the code, do not rewrite it** |

The shell is first because six screens depend on what it provides, and because
its 60 data calls are the largest single concentration in the app.

### Home

| | |
|---|---|
| **Old route** | `/coworking` |
| **Old data** | 24 Firestore refs, 5 writes, 0 fetch |
| **New route** | `/home` — `components/features/dashboard/Home.tsx` |
| **New structure** | Existing 8/4 dashboard composition. Cards fed by the old page's listeners rather than by `useQuery` |

### Tasks — the main surface

| | |
|---|---|
| **Old route** | `/coworking/tasks` |
| **Old data** | **65 Firestore refs, 35 writes, 10 fetch** — the densest screen in the app |
| **Old components** | 31, incl. `TaskCard`, `CoworkTaskCard`, `CreateTaskModal`, `SubmitCompletionModal`, `ReviewCompletionModal`, `PrioritySwapPanel`, `PriorityChangeAckModal`, `WorkCommitModal`, `DeadlineBadge`, `DeadlineBreakdown`, `ForwardTaskModal`, `MoveToFolderModal` |
| **New route** | `/tasks`, `/tasks/[taskId]` — `TasksArea`, `TaskDetail` |
| **Keep** | `useTaskTimer.js` (6 Firestore, 0 fetch) **verbatim**. Timer state is a live document; re-implementing it is how a timer comes to disagree with the commit it produces |
| **Note** | `ForwardTaskModal` and `MoveToFolderModal` back forwarding and folders — removed from the new design by D33. Under "same app" they **must be kept** |

### Messages and groups

| | |
|---|---|
| **Old** | `/coworking/direct-messages`, `/[conversationId]`, `/groups`, `/create-group` |
| **Old data** | 31 + 21 Firestore refs, 28 writes; `GroupChatView.jsx` (10 Firestore) |
| **Old components** | 11 in `coworking/messaging` |
| **New** | `/messages`, `/messages/[conversationId]`, `/groups` — `MessagesArea`, `CollabAreas` |
| **Keep** | `onSnapshot` subscriptions. A chat that polls is a different product |

### Score

| | |
|---|---|
| **Old route** | `/coworking/pmp` — **API only**, no Firestore |
| **Old data** | `GET /cowork/pmp/:employeeId/dashboard` |
| **New** | `/score`, `/score/c1`–`c4` — `ScoreArea` |
| **Status** | Already connected through `getScoreOverview()`. The one place the repository work carries over unchanged |

### SOP

| | |
|---|---|
| **Old route** | `/coworking/sop` — 11 fetch, 10 Firestore, 3 writes |
| **New** | **No equivalent route exists.** Needs building |

### Presence, break, emergency

| | |
|---|---|
| **Old** | `DutyStatusToggle.jsx` (7 Firestore, 0 fetch), `EmergencyApprovalsPanel.jsx`, `/coworking/status-tracking` (12 Firestore) |
| **New** | `StatusButton`, `/team` |
| **Keep** | `cowork_duty_status` reads and writes **exactly as they are** — `breakStartedAtMs`, `latenessMs`, `breakGapAppliedMs`, `lastDeadlineShiftMs`. This is the availability model, already implemented |

### Meetings, mail, calendar, monitoring

| Old | New | Data |
|---|---|---|
| `/coworking/schedule-meet`, `/cowork-meeting/[meetId]` (7 components) | `/meetings`, `/meetings/[meetingId]` | Firestore + LiveKit |
| `/coworking/mail`, `/mail/gmail` | `/mail` | 17 Firestore + 15 fetch |
| `/coworking/calendar`, `/[employeeId]` | `/attendance` | Uses the blocked-dates bridge |
| `/coworking/office-monitor`, `/[id]` | `/team/[employeeId]` | LiveKit + Firestore |
| `/coworking/create-employee` | `/admin/people` | **Writes both stores** |
| `/coworking/mrf` | — | Manufacturing. Out of scope |
| `/coworking/fix-priorities` | — | Data-repair screen. Do not port |

## What this reverses

Recent sessions built a repository layer reading `/cowork/*` through
`LegacyRepository`. Under option A most of that is superseded:

| Built | Under option A |
|---|---|
| `LegacyRepository` (8 methods) | **Score keeps working.** The rest are replaced by the old app's own Firestore reads |
| `lib/legacy/*` API client | **Keep** — the old app calls these same endpoints |
| `lib/repositories/mock/` | Unused at runtime already |
| `lib/rules/*` | Superseded — the old app's logic is the logic |

Nothing needs deleting today. It stops being the path, and can be removed once
each screen is re-skinned and verified.

## Order

1. **Shell** — port `CoworkingShell.js`'s data into a hook; render with the new
   `AppShell`. Six screens depend on it.
2. **Home** — new dashboard composition over the old page's listeners.
3. **Tasks** — 31 components, the densest screen. Timer hook verbatim.
4. **Messages**, **Score**, **Presence**, then the rest.

## The dependency that gates everything

The old frontend is **JavaScript**; the new project is **TypeScript with
`strict`**. Reusing a hook verbatim means either allowing `.js` alongside
(`allowJs`) or adding types at the boundary without touching the logic.

**Recommendation: `allowJs`, and port the file unchanged.** Re-typing a hook is
re-writing it, and a re-written listener is exactly the class of change this
objective forbids.
