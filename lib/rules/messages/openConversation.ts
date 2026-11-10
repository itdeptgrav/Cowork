/**
 * Which conversation the address bar names (10 Nov 2026).
 *
 * Opening a chat used to be a full route change to `/messages/[id]`, a
 * server-rendered page, so every click waited on the server to render a new
 * page before anything moved — about a second in development, a network round
 * trip on the live site, on top of loading the messages. Rows now switch in
 * place with `history.pushState`, which Next.js syncs into `usePathname`, so
 * the page reads the open conversation from the PATH rather than from the
 * route's props: after an in-place switch the props still describe the page
 * the browser first loaded.
 *
 * `/messages/[id]` is still a real route, so a refresh, a shared link and a
 * new tab all land on the same conversation.
 *
 * @param pathname  `usePathname()`; null before it resolves
 * @param routed    the id the server route was rendered with, if any
 */
export function conversationIdFromPath(
  pathname: string | null | undefined,
  routed?: string,
): string | undefined {
  if (!pathname) return routed;
  const m = /^\/messages\/([^/?#]+)/.exec(pathname);
  if (m) {
    try {
      return decodeURIComponent(m[1]);
    } catch {
      return m[1];
    }
  }
  /* Back on the list itself: nothing is open, whatever the route was first
     rendered with. */
  if (pathname === "/messages" || pathname === "/messages/") return undefined;
  return routed;
}

/**
 * Whether a click on a conversation link should switch in place rather than
 * let the browser follow it. A modified or non-primary click keeps its usual
 * meaning — open in a new tab or window — because that is what a link is for.
 */
export function switchesInPlace(e: {
  button: number;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  defaultPrevented: boolean;
}): boolean {
  return (
    !e.defaultPrevented &&
    e.button === 0 &&
    !e.metaKey &&
    !e.ctrlKey &&
    !e.shiftKey &&
    !e.altKey
  );
}
