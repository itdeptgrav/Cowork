# Shell Dependency Map

`CoworkingShell.js` → data sources → hooks → new components.

The shell is first because six screens depend on what it provides, and because
it holds the largest single concentration of data logic in the old app.

## Scale

`components/coworking/layout/CoworkingShell.js` — **4,202 lines**, 11 `fetch`
calls, 49 Firestore references.

That size is the finding. It is not a layout component; it is the application's
data spine with a layout attached. Any plan that treats it as "the nav bar"
underestimates it by an order of magnitude.

## Hooks it depends on

Each keeps its data logic **verbatim**. `allowJs` is already enabled and
`checkJs` is off, so these are consumed as-is rather than re-typed — re-typing a
listener is re-writing it.

| Hook | Firestore | fetch | Lines | Provides |
|---|---:|---:|---:|---|
| `useCoworkNotifications.ts` | 7 | 2 | 390 | Live notification feed, unread count, mark-read |
| `useTaskTimer.js` | 7 | 0 | 431 | Running timer, base/anchor seconds, commit |
| `usePushNotifications.js` | 3 | 0 | 174 | Web push registration, foreground toasts |
| `useDutyStatus.js` | 3 | 0 | 26 | Presence, break, emergency from `cowork_duty_status` |
| `useFCMToken.ts` | 1 | 0 | 123 | FCM token registration |
| `useCoworkGroups.js` | 0 | 0 | 63 | Group list |
| `useCoworkTasks.ts` | 0 | 1 | 10 | Task list via API |
| `useCoworkMeets.ts` | 0 | 1 | 10 | Meeting list via API |

**`useTaskTimer.js` and `useDutyStatus.js` are the two that must not be
touched.** Both are pure Firestore-listener state: the timer is a live document
that work commits are measured against, and duty status carries the availability
model (`latenessMs`, `breakGapAppliedMs`, `lastDeadlineShiftMs`). A
reimplementation of either produces numbers that disagree with the engine.

## Child components

| Old | Renders | New home |
|---|---|---|
| `DutyStatusToggle.jsx` | Presence pill, break, emergency | `StatusButton` |
| `CoworkNotifBell.jsx` | Bell + unread badge | `TopBar` notification control |
| `TeamStatusWidget.jsx` | Who is online | `TopBar` / `/team` |
| `TopLoadingBar.jsx` | Route-change progress | Shell chrome |
| `PageLoader.jsx` | Full-page pending | `ShellFrame` pending state |
| `EmergencyApprovalsPanel.jsx` | Manager approvals | `TopBar` panel |
| `NotesSidebarPanel.jsx` | Notes drawer | Shell drawer |
| `IncomingCallToast.jsx` | Call notification | Shell toast |

## Other dependencies

`lib/coworkFirebase` (app, auth, db) · `lib/coworkUtils` (`timeAgo`) ·
`lib/pipMeetingStore` (picture-in-picture meeting state) ·
`firebase/auth` `signOut` · `usePathname`, `useRouter`.

## The port

**Extract data, keep it whole; rebuild only the rendering.**

```
CoworkingShell.js  (4,202 lines)
        │
        ├── data logic  →  lib/legacy-ui/useShellData.js   ← ported VERBATIM
        │                    · the 8 hooks above
        │                    · the 11 fetch calls
        │                    · the 49 Firestore references
        │
        └── rendering   →  discarded; the new AppShell already exists
```

`useShellData.js` is `.js`, not `.ts`, and is a **move rather than a rewrite**.
The moment it is re-typed it stops being the old app's behaviour and starts
being an interpretation of it.

New components consume it:

```
AppShell (existing)
  └── ShellFrame (existing)
       └── WorkspaceShell (existing)
            ├── TopBar        ← notifications, team status, emergency panel
            ├── StatusButton  ← useDutyStatus, verbatim
            └── {children}
```

## What has to change in the new project

| Change | Why |
|---|---|
| `SessionProvider` stops installing `LegacyRepository` | Screens read Firestore directly again, as the old app does |
| `StatusButton` reads `useDutyStatus` | Instead of `getBreakBudget()`, which has no endpoint |
| `TopBar` reads `useCoworkNotifications` | Instead of `listNotifications()` |
| Firebase config points at the legacy project | Already does — `grav-cms-38f45` |
| `lib/legacy/firebase.ts` exports Firestore | Currently auth-only by design; option A requires the db handle |

That last row is the concrete reversal. It was deliberately auth-only, and under
option A the old app's direct reads need `firebaseDb`.

## Order

1. Port `useShellData.js` verbatim; verify it compiles and its listeners attach.
2. `StatusButton` → `useDutyStatus`.
3. `TopBar` → `useCoworkNotifications`.
4. Remove `setRepository(LegacyRepository)` from `SessionProvider` **last**,
   once the shell reads Firestore directly — removing it first leaves every
   screen with no data source at all.

## Two things worth deciding before step 1

**Copy or import?** The old repo is a sibling directory, not a package. Either
copy the hooks into `lib/legacy-ui/` (a fork that will drift) or add a path
alias to `../cowork-old-frontend` (no drift, but the build depends on a
directory outside the project). **Copying is the safer default**; drift is
visible in review, a cross-directory build dependency is not.

**`useTaskTimer.js` imports `firebaseDb` from `lib/coworkFirebase`.** That module
must be ported too, or the import re-pointed at the new project's Firebase
instance. Re-pointing is one line and keeps a single Firebase app; porting keeps
the file untouched but creates a second app on the same project. **Re-pointing is
better** — two apps on one project means two auth states.
