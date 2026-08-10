/**
 * Who is who in the monitoring room.
 *
 * This module exists because the rule was previously written down twice and the
 * two copies disagreed. The publisher joined under a fixed `"employee"` string,
 * while the manager's viewer looked for a track belonging to
 * `presenceIdentityFor(employeeId)` — which returned that fixed string for
 * exactly one seeded employee and `employee-<id>` for everybody else. So a
 * screen shared by anyone other than that one person matched nothing and the
 * viewer showed "No screen is reaching this room", and a screen shared by
 * anyone at all appeared under THAT person's name, which is the mis-attribution
 * the identity match exists to prevent.
 *
 * One function, imported by both sides. A publisher and a watcher cannot
 * disagree about who a track belongs to if neither of them owns the answer.
 *
 * Deliberately dependency-free: the mock repository, the browser publisher and
 * the server-side token route all import it, and it must not drag `fetch`, the
 * store or a React hook into any of them.
 */

/** Everyone in this prototype shares one demo room. */
export const ROOM_NAME = "cowork-demo";

/**
 * The room one person's screen is published into.
 *
 * **One room per employee, not one for the company.** `ROOM_NAME` above is what
 * presence used to use, and it made the permission a rendering decision: every
 * watcher's token could subscribe to everybody's track, and only the viewer's
 * identity match decided what appeared on screen. A room per person means the
 * seat itself carries the permission — `/api/stream/token` will not mint one
 * for a room the caller is not entitled to be in, so a mistake in a component
 * cannot put the wrong screen in front of anybody.
 *
 * Derived from the employee id rather than stored, for the same reason
 * `presenceIdentityFor` is: there is no table to fall out of date and nothing to
 * migrate when somebody joins.
 */
export function presenceRoomName(employeeId: string): string {
  return `cowork-presence-${employeeId}`;
}

/**
 * The watching identity.
 *
 * Distinct from any employee's on purpose: a manager joins to subscribe, never
 * to publish, and the token route reads this prefix to decide which grants a
 * seat gets.
 *
 * **Kept as the prefix, no longer used as a whole identity.** LiveKit treats
 * identity as unique within a room and evicts the existing participant when a
 * second one joins under the same string. Every watcher used to join as exactly
 * `"manager"`, so the second manager to open a monitoring page silently
 * disconnected the first — who saw their screen go blank with no explanation,
 * having done nothing. Watchers now carry a per-seat suffix; see
 * `watcherIdentity`.
 */
export const MANAGER_IDENTITY = "manager";

const MANAGER_PREFIX = "manager-";
const EMPLOYEE_PREFIX = "employee-";

/**
 * A unique seat for one watcher.
 *
 * The suffix only has to be unique among concurrent watchers, and it is never
 * shown to anybody or matched against anything — the viewer matches tracks by
 * the PUBLISHER's identity, never the subscriber's. So any distinct string
 * does, and a random one avoids needing a registry of who is watching.
 */
export function watcherIdentity(seat: string): string {
  return `${MANAGER_PREFIX}${seat}`;
}

/**
 * Whether an identity is a watching seat — the subscribing half of the room.
 *
 * Accepts the bare legacy string as well as the prefixed form, because a token
 * minted before this change is still valid and its holder is still watching.
 */
export function isWatcherIdentity(identity: string): boolean {
  if (identity === MANAGER_IDENTITY) return true;
  return (
    identity.startsWith(MANAGER_PREFIX) && identity.length > MANAGER_PREFIX.length
  );
}

/**
 * The room identity an employee publishes their screen under.
 *
 * Derived from the employee id rather than assigned, so there is nothing to
 * keep in sync and no table to fall out of date. Every employee resolves to a
 * distinct identity, which is what lets a viewer ask for one person's screen
 * and be certain it did not get somebody else's.
 */
export function presenceIdentityFor(employeeId: string): string {
  return `${EMPLOYEE_PREFIX}${employeeId}`;
}

/** Whether an identity is an employee seat — the publishing half of the room. */
export function isPresenceIdentity(identity: string): boolean {
  return identity.startsWith(EMPLOYEE_PREFIX) && identity.length > EMPLOYEE_PREFIX.length;
}
