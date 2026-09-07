/**
 * Why a meeting-chat message did not send, in words somebody can act on.
 *
 * ## The bug this was extracted for
 *
 * `MeetingChat` called `void send(text)` and cleared the draft on the very next
 * line — no `await`, no `catch`. A rejected send threw into nothing while the
 * box emptied, so a failure and a success looked identical from the outside:
 * the text vanished either way, and the only signal was the message never
 * appearing, which reads as somebody else's problem.
 *
 * ## And it rejects for a reason guaranteed to bite this team
 *
 * `livekit-client` mints the outgoing stream id with `crypto.randomUUID()`,
 * which is **secure-context only** — `undefined` on plain http. The dev script
 * binds `-H 0.0.0.0`, so a colleague opening `http://<lan-ip>:3000` is on plain
 * http and EVERY send throws, while the developer on `localhost` sees it work,
 * because localhost is a secure context. That is the whole of "chat works
 * sometimes".
 *
 * It lives here rather than in the component for the ordinary reason pure rules
 * do: a `.tsx` module cannot be imported by the test runner, and a sentence
 * somebody is shown when their message disappears deserves a test.
 */

/**
 * Detected by CAPABILITY, not by matching the thrown message.
 *
 * The text of the error differs between browsers and would change on a library
 * upgrade; `isSecureContext` is the actual condition, and it is the thing that
 * can be fixed.
 */
export function sendFailureReason(err: unknown): string {
  if (typeof window !== "undefined" && !window.isSecureContext) {
    return "Chat needs a secure connection (https). This page is on plain http, so the message could not be sent — open Cowork over https and try again.";
  }
  const detail = err instanceof Error && err.message ? ` (${err.message})` : "";
  return `That message did not send${detail}. It is still in the box — try again.`;
}
