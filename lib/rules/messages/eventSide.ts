/**
 * Which side of the task thread an event card sits on.
 *
 * ## Why an event has a side at all
 *
 * A submission and a rework are not announcements from the room — they are two
 * people answering each other. One person hands work over, the other sends it
 * back, and until now both landed in the middle of the thread looking like the
 * same impersonal notice. Reading down a task you could not tell, at a glance,
 * which of you had done which: the name was there, but it was the last line of
 * a centred card, in 11px, after the reason.
 *
 * Side is the channel a chat already uses for exactly this question, and it
 * costs no ink. So these cards take the same one their messages take — yours on
 * the trailing edge, theirs on the leading edge — and the thread reads as the
 * exchange it is.
 *
 * ## Why the actor cannot simply be read off the message
 *
 * The two events arrive differently, and that is the whole reason this is a
 * function rather than a comparison written at the call site.
 *
 *   · A **submission** is posted by the engine AS THE SUBMITTER — it carries
 *     their id, which is what lets their proof attachments be theirs — so the
 *     sender IS the actor and `actorId` answers it exactly.
 *   · A **rework** is posted as `system`. The sender id names nobody, and the
 *     only trace of who decided is their NAME inside the sentence the engine
 *     wrote. So that name is matched back to a person, and the match has to be
 *     careful, because a wrong answer here does not degrade — it puts a
 *     reviewer's decision on the assignee's side of their own thread.
 *
 * An unresolved actor is answered `false`, never guessed. The leading edge is
 * where every message from somebody else already sits, so an event that cannot
 * be attributed reads as "not yours" — which is the truthful thing to say when
 * the alternative is claiming somebody wrote something they did not.
 */

/** Just enough of an employee to match a name back to an id. */
export interface EventPerson {
  id: string;
  displayName: string;
}

export function eventByViewer(input: {
  /** The message's sender, where it carries a real one rather than `system`. */
  actorId?: string | null;
  /** The name the engine wrote into the line, for events posted as `system`. */
  actorName?: string | null;
  viewerId: string | null;
  people: readonly EventPerson[];
}): boolean {
  const { actorId, actorName, viewerId, people } = input;
  /* No viewer resolved yet. Every card would otherwise flip sides the moment
     the identity read lands, which is worse than opening on one side. */
  if (!viewerId) return false;

  /* The direct answer, when there is one. `system` is not an employee id, so
     it can never equal a viewer and needs no special case. */
  if (actorId) return actorId === viewerId;

  const wanted = actorName?.trim().toLowerCase();
  if (!wanted) return false;

  /* **Exactly one match, or none.** Two people can share a display name, and
     the engine's sentence carries nothing to tell them apart — so an ambiguous
     name is treated as unresolved rather than resolved to whichever happened to
     be first in the list. */
  const matches = people.filter(
    (p) => p.displayName.trim().toLowerCase() === wanted,
  );
  return matches.length === 1 && matches[0].id === viewerId;
}
