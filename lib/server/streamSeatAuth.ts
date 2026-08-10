import "server-only";
import { readFirebaseCookie } from "@/lib/auth/firebaseCookie";
import { fetchIdentity } from "@/lib/legacy/auth";
import { fetchHierarchy } from "@/lib/legacy/employees";

/**
 * May this caller have a seat in this person's presence room?
 *
 * **One answer, used by every route that touches a screen.** It lives here
 * rather than in the token route because the presence check needs exactly the
 * same rule, and a second copy of an authorisation rule is how the two come to
 * disagree — the weaker one then becomes the way in.
 *
 *  · **publish** — only for yourself. The subject must be the caller.
 *  · **watch** — only the subject's PRIMARY manager. Not a secondary manager,
 *    not somebody further up the chain, not an administrator. That is narrower
 *    than most surfaces in this product and it is deliberate: a live screen is
 *    the most intrusive thing Cowork shows, so the audience is the one person
 *    whose job it is to know, and everybody else gets the same refusal a
 *    stranger does.
 *
 * Decided from the engine's own answer to `/cowork/employee/my-managers/:id`,
 * on this request, with this caller's token. Nothing is read from the client
 * and nothing is cached: a reporting line that changed a minute ago decides
 * this seat.
 */

export type SeatRole = "publish" | "watch";

export interface SeatRefusal {
  ok: false;
  message: string;
  status: number;
}
export interface SeatGranted {
  ok: true;
  /** The caller's own employee id, resolved by the engine. */
  caller: string;
  /** Their display name, for the participant list in the room. */
  name: string;
  /** The Firebase ID token, for any further engine call this request needs. */
  idToken: string;
}

export async function authoriseSeat(
  request: Request,
  input: { subject: string; role: SeatRole },
): Promise<SeatGranted | SeatRefusal> {
  const refuse = (message: string, status: number): SeatRefusal => ({
    ok: false,
    message,
    status,
  });

  if (!input.subject) return refuse("No employee was named.", 400);

  /**
   * The Firebase ID token, and why this needs THAT rather than any signed-in
   * session.
   *
   * Both of the product's sign-in paths prove somebody is real, but only this
   * one can be exchanged for an employee id and a reporting line — the engine
   * takes the same token. A caller holding only a `cowork_session` is refused
   * rather than waved through, because the alternative is issuing a seat
   * without being able to name whose it is.
   */
  const idToken = readFirebaseCookie(request.headers.get("cookie"));
  if (!idToken) return refuse("Not authenticated.", 401);

  const me = await fetchIdentity(idToken);
  if (!me.ok) {
    /* The engine refusing the token IS the authentication answer; it verified
       the signature to produce it. */
    return refuse(
      "Your sign-in could not be matched to an employee record, so a room seat cannot be issued.",
      401,
    );
  }
  const caller = String(me.data.employeeId);

  if (input.role === "publish") {
    if (input.subject !== caller)
      return refuse("You can only share your own screen.", 403);
    return { ok: true, caller, name: me.data.name, idToken };
  }

  const hierarchy = await fetchHierarchy({
    token: idToken,
    employeeId: input.subject,
  });
  if (!hierarchy.ok) {
    return refuse(
      "Their reporting line could not be read, so this screen cannot be opened.",
      502,
    );
  }
  const primary = hierarchy.data.primaryManager?.employeeId;
  if (!primary) {
    /* A person with no primary manager has nobody entitled to watch them. Said
       in the words the situation deserves rather than as a generic refusal:
       this is an incomplete HR record, and somebody can fix it. */
    return refuse(
      hierarchy.data.inHrSystem
        ? "Nobody is recorded as their primary manager, so their screen cannot be opened. Ask an administrator to set their reporting line."
        : "They have no HR record, so their reporting line is unknown and their screen cannot be opened.",
      403,
    );
  }
  if (String(primary) !== caller) {
    return refuse("Only their primary manager can watch this screen.", 403);
  }

  return { ok: true, caller, name: me.data.name, idToken };
}
