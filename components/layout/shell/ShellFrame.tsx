"use client";

import { useEffect, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { TopBar } from "./TopBar";
import { DemoBar } from "./DemoBar";
import { PlayerEngine } from "@/components/features/music/PlayerEngine";
import { PresenceRoom } from "@/components/features/status/PresenceRoom";
import { DutySync } from "@/components/features/status/DutySync";
import { HelpAssistant } from "@/components/layout/help/HelpAssistant";
import { PriorityAckGate } from "@/components/features/tasks/PriorityAckGate";
import { SessionProvider, useSession } from "@/components/features/auth/SessionProvider";

/**
 * Which shell a route gets.
 *
 * The sign-in and sign-up routes are inside the application but outside the
 * workspace: they need the iridescent field and the type, and they must not get
 * the navigation bar, the presence room, the music engine or the help
 * assistant. Every one of those reads an identity, and on the auth routes there
 * is not one yet — mounting them there would fire queries as the seeded default
 * behind a page whose whole purpose is to establish who you are.
 *
 * Done with `usePathname` rather than by moving fifty routes into an `(app)`
 * route group. The route-group version is the tidier long-term shape and it is
 * a large mechanical move; this is one file and reversible.
 */

const AUTH_ROUTES = new Set(["/signin", "/signup", "/reset-password"]);

/**
 * The one route that must render without a session: the connection diagnostic.
 *
 * `/legacy/health` reports whether Firebase and the backend can be reached at
 * all, so it cannot depend on a session — if it did, the page you open when
 * sign-in is broken would itself be broken.
 *
 * **`/legacy/validate` is deliberately NOT here any more.** It was, and that was
 * the bug: `<SessionProvider anonymous>` makes `load()` return immediately, so
 * the status is permanently `anonymous` by construction. A page reading
 * `useSession()` under it can never see a signed-in user, however signed in
 * they are. Validation exists to exercise authenticated calls, so it belongs
 * inside the real session like every other screen.
 *
 * The exemption dates from when this app had its own local accounts and the
 * legacy pages needed to bypass them. Firebase is the application's login now,
 * so the same account works everywhere and there is nothing left to bypass.
 */
function rendersWithoutSession(pathname: string): boolean {
  return (
    process.env.NODE_ENV !== "production" && pathname === "/legacy/health"
  );
}

export function ShellFrame({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const isAuthRoute =
    AUTH_ROUTES.has(pathname) || rendersWithoutSession(pathname);

  if (isAuthRoute) {
    return (
      <SessionProvider anonymous>
        <main id="main" className="min-h-dvh">
          {children}
        </main>
      </SessionProvider>
    );
  }

  return (
    <SessionProvider>
      <WorkspaceShell>{children}</WorkspaceShell>
    </SessionProvider>
  );
}

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
function WorkspaceShell({ children }: { children: ReactNode }) {
  const session = useSession();
  const anonymous = session.status === "anonymous";

  /* In an effect, not in the render body: navigating IS a side effect, and one
     performed during render runs twice under StrictMode and races the commit. */
  useEffect(() => {
    if (anonymous) window.location.href = "/signin";
  }, [anonymous]);

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
            Signing you in did not finish
          </p>
          <p className="mt-1.5 text-xs leading-relaxed text-ink-muted">
            {session.stallReason ??
              "The workspace could not confirm who you are."}{" "}
            Your work is safe — this is about this browser&rsquo;s saved
            sign-in, not about your account.
          </p>
          <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
            <button
              type="button"
              onClick={() => void session.refresh()}
              className="rounded-full bg-ink px-3.5 py-1.5 text-xs font-medium text-[var(--body-bg)] transition-opacity hover:opacity-90"
            >
              Try again
            </button>
            <button
              type="button"
              onClick={() => void session.signOut()}
              className="rounded-full bg-[var(--control)] px-3.5 py-1.5 text-xs font-medium text-ink transition-colors hover:bg-[var(--control-hover)]"
            >
              Sign in again
            </button>
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
      <div className="flex min-h-dvh flex-col">
        <TopBar />
        <main
          id="main"
          className="flex-1 px-[clamp(12px,3vw,32px)] pt-[clamp(14px,2vw,22px)] pb-[clamp(32px,5vw,64px)]"
        >
          <div className="mx-auto max-w-[1360px]">{children}</div>
        </main>
        <DemoBar />
      </div>
      {/* The player lives HERE, in the shell, not in a route — which is
        what lets audio keep playing across navigations. It reserves no
        space and shrinks no page: on `/yt` it is drawn into that page's
        video slot, and everywhere else it runs audio-only behind a quiet
        bar. See `PlayerEngine` for what that costs. */}
      <PlayerEngine />
      {/* Presence, for the same reason and with the same shape: a sibling of
        the shell rather than a wrapper around it, so a token arriving does
        not remount every page. It renders nothing until someone has agreed
        to share a screen, and nothing visible even then. */}
      <PresenceRoom />
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
    </>
  );
}
