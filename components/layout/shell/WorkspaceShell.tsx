"use client";

import { useEffect, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { TopBar } from "./TopBar";
import { NotificationToasts } from "./NotificationToasts";
import { DemoBar } from "./DemoBar";
import { GlobalCommandPalette } from "./GlobalCommandPalette";
import { PlayerEngine } from "@/components/features/music/PlayerEngine";
import { MeetingEngine } from "@/components/features/meetings/MeetingEngine";
import { PendingAudioDrain } from "@/components/features/meetings/PendingAudioDrain";
import { MeetingReloadGuard } from "@/components/features/meetings/MeetingReloadGuard";
import { TaskMeetingLifecycle } from "@/components/features/meetings/TaskMeetingLifecycle";
import { DutySync } from "@/components/features/status/DutySync";
import { HelpAssistant } from "@/components/layout/help/HelpAssistant";
import { PriorityAckGate } from "@/components/features/tasks/PriorityAckGate";
import { NewAssignmentGate } from "@/components/features/tasks/NewAssignmentGate";
import { PtsChangePopup } from "@/components/features/score/PtsChangePopup";
import { NotificationPrompt } from "@/components/features/notifications/NotificationPrompt";
import { useSession } from "@/components/features/auth/SessionProvider";

/**
 * The workspace shell, in its OWN module so that it can be its own bundle.
 *
 * It used to live at the bottom of `ShellFrame.tsx`, and the split is not
 * tidying — it is the fix for a measured bandwidth problem.
 *
 * **The auth routes were downloading the entire workspace.** `ShellFrame`
 * renders either the bare auth frame or this, and its own header explains that
 * the sign-in routes "must not get the navigation bar, the presence room, the
 * music engine or the help assistant". At RUNTIME that was true. In the BUNDLE
 * it was not: a bundler follows imports, not branches, so every module reached
 * from here was in the chunk `/signin` loaded. Measured against a production
 * build, the sign-in page pulled ~3.2MB of uncompressed JavaScript, of which
 * roughly 1.7MB was the LiveKit conferencing SDK and ~0.6MB Firebase — before
 * anybody could type a password, on a page that opens a meeting for nobody.
 *
 * Now `ShellFrame` reaches this through `next/dynamic`, which is a real split
 * point, so the workspace's dependencies are fetched when somebody is actually
 * in the workspace. Nothing here changed except the file it lives in.
 *
 * **Server rendering is deliberately kept** (no `ssr: false`). The gate below
 * is what holds the tree back until the session resolves, and turning this into
 * a client-only island would trade a bundle win for a blank first paint on
 * every authenticated route — which is the same complaint from the other side.
 *
 * Keep the mount ORDER as it is; several of the siblings at the bottom depend
 * on it, and each says so where it is mounted.
 */

/**
 * Whether the prototype control bar is shown. Off unless asked for.
 *
 * `DemoBar` is a development tool — it forces the offline, error and
 * permission-denied states, counts unresolved provisional rules, and resets the
 * sample data. It used to render for everybody on every page, which put a
 * **Reset data** button and a fake-denial switch in front of real users.
 *
 * Opt-in rather than a `NODE_ENV` check, because the two questions are
 * different: "is this a development build" is not the same as "do I want the
 * prototype controls on screen right now", and the bar was in the way even in
 * development. Set `NEXT_PUBLIC_SHOW_PROTOTYPE_BAR=1` in `.env.local` to bring
 * it back — the component is untouched and nothing else has to change.
 *
 * Resolved once at module scope, so the answer is fixed for the life of the
 * page and nothing at runtime can turn the bar on — `process` is not even
 * reachable from the browser console.
 */
const SHOW_PROTOTYPE_BAR = process.env.NEXT_PUBLIC_SHOW_PROTOTYPE_BAR === "1";

/**
 * The workspace, held back until the session has resolved.
 *
 * The gate is the point. Rendering the tree while `status` is `loading` would
 * let every page mount and run its queries against whatever identity the
 * repository currently holds — the seeded default — and then swap when the
 * session landed. That is not a flicker to tidy up later: those first queries
 * really would have read another person's tasks, scores and messages.
 *
 * Middleware has already turned away anyone without a validly-signed cookie, so
 * `anonymous` here means the signature passed but the session did not resolve —
 * revoked, expired between the two checks, or the account suspended. A hard
 * navigation clears the module singletons on the way out.
 */
/**
 * Routes that fill the window rather than sitting in the reading column.
 *
 * The shell centres pages in a 1360px column with its own padding, which is
 * right for reading-width pages and wrong for a work surface: every column a
 * spreadsheet cannot show is one you have to scroll to. Opting the route out
 * HERE — rather than having the page fight back with negative viewport-unit
 * margins — is what keeps it exact: `vw` counts the scrollbar and percentage
 * margins do not, so the break-out trick lands a few pixels off and overflows
 * sideways. The shell simply not adding the column has no such seam.
 */
const FULL_BLEED_ROUTES = new Set(["/sheets"]);

export function WorkspaceShell({ children }: { children: ReactNode }) {
  const session = useSession();
  const anonymous = session.status === "anonymous";
  const pathname = usePathname();
  const fullBleed = FULL_BLEED_ROUTES.has(pathname);

  /* In an effect, not in the render body: navigating IS a side effect, and one
     performed during render runs twice under StrictMode and races the commit. */
  useEffect(() => {
    if (anonymous) window.location.href = "/signin";
  }, [anonymous]);

  /**
   * **A file dropped ANYWHERE is not a navigation.**
   *
   * A browser handed a file it was not told to keep opens it, which on a
   * desktop reads as the file landing in Downloads and the workspace being
   * replaced by a PDF viewer. The composers now take a drop, but a drop lands
   * where the pointer is, not where it was aimed — release fifteen pixels
   * outside the box and the default fires with the page still open behind it.
   *
   * So the window refuses the default for file drags, and every real drop zone
   * keeps working because it calls `preventDefault` first and this listener
   * only ever sees what nothing else claimed.
   *
   * Scoped to file drags by `types.includes("Files")`: the task list reorders
   * by dragging rows, and those carry `text/plain`. Blanket-preventing every
   * drop would break them.
   */
  useEffect(() => {
    const onlyFiles = (e: DragEvent) =>
      Boolean(e.dataTransfer?.types?.includes("Files"));
    const block = (e: DragEvent) => {
      if (onlyFiles(e)) e.preventDefault();
    };
    window.addEventListener("dragover", block);
    window.addEventListener("drop", block);
    return () => {
      window.removeEventListener("dragover", block);
      window.removeEventListener("drop", block);
    };
  }, []);

  if (session.status === "loading") {
    return (
      <div
        className="grid min-h-dvh place-items-center"
        role="status"
        aria-label="Signing you in"
      >
        <span className="text-sm text-ink-muted">Signing you in…</span>
      </div>
    );
  }

  /**
   * The way out of a sign-in that did not finish.
   *
   * This screen exists because the one above used to be permanent. Restoring a
   * session waits on the Firebase SDK, a token refresh and `/cowork/me`, and
   * any of the three can fail without ever returning — so "Signing you in…"
   * was where people stayed, in a normal browser but not in incognito, because
   * incognito has no saved session to fail on.
   *
   * Two ways out, in the order most likely to work. **Try again** re-asks, which
   * clears a transient failure. **Sign in again** discards the saved session
   * and starts fresh — that is `signOut`, which drops the Firebase credential,
   * the mirrored cookie and the per-browser identity keys. It is deliberately a
   * button rather than an instruction: nobody should be told to clear their
   * cookies to use their own workspace.
   */
  if (session.status === "stalled") {
    return (
      <div className="grid min-h-dvh place-items-center px-6">
        <div className="max-w-[42ch] text-center">
          <p className="text-[15px] font-medium text-ink">
            {session.stallKind === "network"
              ? "Could not reach the workspace"
              : "Signing you in did not finish"}
          </p>
          <p className="mt-1.5 text-xs leading-relaxed text-ink-muted">
            {session.stallReason ??
              "The workspace could not confirm who you are."}{" "}
            {session.stallKind === "network"
              ? "This will retry on its own as soon as the connection is back."
              : "Your work is safe — this is about this browser’s saved sign-in, not about your account."}
          </p>
          <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
            <button
              type="button"
              onClick={() => void session.refresh()}
              className="rounded-full bg-ink px-3.5 py-1.5 text-xs font-medium text-[var(--body-bg)] transition-opacity hover:opacity-90"
            >
              Try again
            </button>
            {/* **Not offered for a network fault.** Signing out throws away
                the Firebase credential, the mirrored cookie and the per-browser
                identity keys — and when the only problem was an unreachable
                server, that destroys a perfectly good session and makes the
                person type their password to fix somebody else's outage. It
                stays for a genuinely stale stored session, which is the case it
                actually repairs. */}
            {session.stallKind !== "network" && (
              <button
                type="button"
                onClick={() => void session.signOut()}
                className="rounded-full bg-[var(--control)] px-3.5 py-1.5 text-xs font-medium text-ink transition-colors hover:bg-[var(--control-hover)]"
              >
                Sign in again
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  if (anonymous) {
    return (
      <div className="grid min-h-dvh place-items-center">
        <span className="text-sm text-ink-muted">Redirecting to sign in…</span>
      </div>
    );
  }

  return (
    <>
      {/* Full-bleed pins the frame to exactly one viewport so the grid's own
          scroller takes the overflow instead of the page. Deliberately NOT
          `overflow-hidden`: the top bar's menus are positioned against this
          frame, and clipping them to it would cut them off. */}
      <div className={fullBleed ? "flex h-dvh flex-col" : "flex min-h-dvh flex-col"}>
        <TopBar />
        {/* Mounted once for the whole app: a notification that arrives while
            somebody is looking at the screen has to appear ON the screen. */}
        <NotificationToasts />
        <main
          id="main"
          /* Full-bleed marks itself so globals.css can drop the reading-page
             bottom padding + music-bar clearance — the work surface scrolls
             internally and must reach the bottom edge. */
          data-fullbleed={fullBleed ? "" : undefined}
          className={
            fullBleed
              ? "flex min-h-0 flex-1 flex-col"
              : "flex-1 px-[clamp(12px,3vw,32px)] pt-[clamp(14px,2vw,22px)] pb-[clamp(32px,5vw,64px)]"
          }
        >
          <div className={fullBleed ? "flex min-h-0 flex-1 flex-col" : "mx-auto max-w-[1360px]"}>
            {/* Asked once, on whichever page they happen to be on, and never
                again once answered. In the shell rather than on one route
                because the first visit is not reliably to /notifications —
                somebody who never opens that page would never be asked. */}
            <NotificationPrompt />
            {children}
          </div>
        </main>
        {/* The prototype bar and the music bar float over the bottom edge, which
            is dead space over a full-bleed work surface — hide both on the sheet
            so the workbook owns the whole viewport. */}
        {SHOW_PROTOTYPE_BAR && !fullBleed && <DemoBar />}
      </div>
      {/* The player lives HERE, in the shell, not in a route — which is
        what lets audio keep playing across navigations. It reserves no
        space and shrinks no page: on `/yt` it is drawn into that page's
        video slot, and everywhere else it runs audio-only behind a quiet
        bar. See `PlayerEngine` for what that costs. */}
      <PlayerEngine showBar={!fullBleed} />
      {/* **The meeting, for the same reason and by the same mechanism.** It is
        mounted once here and positioned over whatever rectangle the meeting
        page publishes, so navigating away — Back included — moves the picture
        into the corner and leaves the connection, the microphone and the
        recording exactly where they were. It renders nothing at all when
        nobody is in a meeting. */}
      <MeetingEngine />
      {/* **Sends audio that never made it, from wherever the reader is.** A
        recording is written to the browser's disk before it is uploaded, so a
        dropped connection never loses it — but the retry used to live inside
        the meeting room, so it only ran if the person joined ANOTHER meeting.
        Somebody whose network died mid-call and who then went back to their
        tasks kept a finished recording nothing would ever send, until it
        expired after seven days. A sibling of the shell, so opening Cowork at
        all is enough. Renders nothing. */}
      <PendingAudioDrain />
      {/* **The beat that keeps a task meeting's credited session alive.** It
        has to live beside the room rather than on the task page: the floating
        window means the room outlives the page, and a beat that stopped with
        the page would let the deadline credit lapse ninety seconds into a
        conversation still happening. Renders nothing, and does nothing at all
        unless a task meeting is open. */}
      <TaskMeetingLifecycle />
      {/* **Asks before a reload takes somebody out of a meeting.** A sibling of
        the engine because the meeting is: it must ask whether the room is on
        this page or floating in the corner. The recorder registers its own
        guard as well, but that one is gated on a recording being live — this
        one is gated on there being a meeting at all. Renders nothing. */}
      <MeetingReloadGuard />
      {/* **No presence room here any more, and that is the point.** Sharing a
        screen used to need a Grav Stream iframe mounted beside the shell,
        because the capture prompt can only be opened from inside the frame
        that calls it. Their publisher SDK runs in THIS document, so the status
        menu's own button opens the picker and there is nothing to render —
        see `lib/integrations/grav/publisher.ts`. Watching still uses an
        iframe, and that one belongs to the monitoring panel that shows it. */}
      {/* Publishes what the room decided to `cowork_duty_status`, so a
        colleague, a manager and the old app read one presence rather than
        three. Separate from the room because presence has to be published
        when there ISN'T one — going offline is a state to report, and a
        component mounted inside the room could not report its own absence. */}
      <DutySync />
      {/* Help, on every route. A sibling of the shell like the others: it
        reserves no space, shrinks no page, and explains only — there is no
        path from it to a mutation. */}
      <HelpAssistant />
      {/* Blocking acknowledgement for cascaded deadlines — see the component
        for why it cannot be dismissed. */}
      <PriorityAckGate />
      {/* "You have new work", once, on opening Cowork after being assigned
        something. Deliberately dismissable, unlike the gate above: new work
        arriving is not a silent change to something already agreed, and the
        task is on their list either way. Mounted AFTER the priority gate so
        that when both are due, the one that cannot be dismissed is the one
        underneath — clearing it first, then this. */}
      <NewAssignmentGate />
      <PtsChangePopup />
      {/* Global ⌘K palette — available on every authenticated route.
          On /workspace routes the shortcut is handed off to the workspace's
          own CommandPalette; the two never register at the same time. */}
      <GlobalCommandPalette />
    </>
  );
}
