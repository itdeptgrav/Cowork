"use client";

import { type ReactNode } from "react";
import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";
import { SupportShortcut } from "@/components/features/support/SupportShortcut";
import { SessionProvider } from "@/components/features/auth/SessionProvider";

/**
 * The workspace, fetched only by somebody who is in it.
 *
 * `ShellFrame` renders this on exactly one of its two branches, but a static
 * import would put the whole workspace tree — LiveKit, the music engine, the
 * help assistant, the meeting recorder — into the chunk the SIGN-IN page
 * downloads, because bundlers follow imports rather than branches. Measured, it
 * was ~1.7MB of LiveKit reaching a page that opens no meeting. `next/dynamic`
 * is a genuine split point, so that weight now follows the person who needs it.
 *
 * Server rendering is left ON. See `WorkspaceShell.tsx` for why.
 */
const WorkspaceShell = dynamic(() =>
  import("./WorkspaceShell").then((m) => m.WorkspaceShell),
);

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

/**
 * `/offline` is here for a different reason than the others.
 *
 * It is served by the service worker when the network is gone. Under
 * `SessionProvider` it would try to resolve a session — three network calls
 * that cannot succeed — and sit on "Signing you in…" forever, which is the one
 * thing an offline page must never do.
 */
const AUTH_ROUTES = new Set([
  "/signin",
  "/signup",
  "/reset-password",
  // Forgotten-password recovery. Reached with no session and existing to make
  // one possible, so it needs the bare shell for the same reason /signin does.
  // Kept in step with `PUBLIC_PATHS` in `proxy.ts` — a route in one gate and
  // not the other is the "redirects for no reason" bug.
  "/forgot-password",
  "/offline",
  // The SSO handoff from the CMS onboarding page arrives with a Firebase
  // custom token and no session yet — it exists to CREATE one, same as
  // /signin, so it needs the same bare shell rather than WorkspaceShell
  // bouncing it to /signin the instant it sees `anonymous`.
  "/sso",
]);

/**
 * Route prefixes that must render without a session.
 *
 * Guest meeting links (`/meetings/guest/[token]`) are public: someone outside
 * the company follows a share link and should land directly in a lobby, not a
 * sign-in wall.
 *
 * `/share/invite/` and `/share/view/` are the same shape for external
 * document/sheet/mindmap sharing: the person opening either may have no
 * Cowork account at all, so `WorkspaceShell` below — which bounces anyone
 * without a session to `/signin` — must never see these routes.
 */
const PUBLIC_PREFIXES = [
  "/meetings/guest/",
  "/share/invite/",
  "/share/view/",
];

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
  if (process.env.NODE_ENV !== "production" && pathname === "/legacy/health")
    return true;
  return PUBLIC_PREFIXES.some((p) => pathname.startsWith(p));
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
        {/* Ctrl+S reaches support from the sign-in screen too — the one place
            somebody may be unable to get any further, and the reason this is
            mounted on BOTH branches rather than inside the workspace. */}
        <SupportShortcut />
      </SessionProvider>
    );
  }

  return (
    <SessionProvider>
      <WorkspaceShell>{children}</WorkspaceShell>
      {/* A SIBLING of the workspace shell, not a child: the shell renders only
          a sentence while a session is resolving or has stalled, and those are
          exactly the moments support has to be reachable. */}
      <SupportShortcut />
    </SessionProvider>
  );
}

