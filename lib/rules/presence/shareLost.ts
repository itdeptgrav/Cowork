/**
 * Online, with nothing actually going out — and who should be told.
 *
 * **A browser always drops a screen share on reload.** No page can restart one
 * without a fresh click; that is the browser's own rule, not a choice this
 * product makes. So the state this module names is not an edge case, it is what
 * happens every time somebody refreshes while online: the durable claim in
 * `cowork_duty_status` still says online — correctly, because nothing takes a
 * status away from the person who chose it — and the capture behind it is gone.
 *
 * Left unsaid, that is the worst possible presence bug: the person believes
 * they are being watched and their manager sees nothing, and neither of them
 * finds out. Nothing here changes the status. It decides only whether to
 * INTERRUPT somebody about it.
 */

export interface ShareLostInput {
  /** The account's own presence has been read at least once. */
  hydrated: boolean;
  /** The account claims online — this device's status, or the published mode. */
  accountOnline: boolean;
  /** A capture is live in THIS browser. */
  sharingHere: boolean;
  /**
   * This device is the one that put the account online.
   *
   * **The whole reason a phone does not scream.** Presence belongs to a person,
   * not a browser: somebody online from their laptop and reading Cowork on
   * their phone is online, correctly, and the phone has no screen share of its
   * own and never did. Alerting there would be a false alarm about a share that
   * is running perfectly well three feet away. Only the device that claimed the
   * session can tell that the share it was holding has gone — the flag survives
   * a reload for exactly this reason (`claimedOnlineHere`).
   */
  claimedHere: boolean;
  /** A share is being started right now, so the gap is expected and momentary. */
  starting: boolean;
}

/**
 * Should this browser interrupt the person about a share that is not running?
 *
 * True only where every part is true: the account is online, this device is the
 * one that made it so, nothing is being captured, and nothing is in the middle
 * of starting. Any of them false and there is either no problem or nobody here
 * who can fix it.
 */
export function shareLostHere(input: ShareLostInput): boolean {
  if (!input.hydrated) return false;
  if (!input.accountOnline) return false;
  if (input.sharingHere) return false;
  if (!input.claimedHere) return false;
  return !input.starting;
}

/**
 * What the alert says.
 *
 * The words the owner asked for, kept in one place so the popup, the pill's
 * notice line and the help article cannot drift apart — a help article that
 * describes a warning in different words than the warning is hard to match
 * against the screen.
 */
export const SHARE_LOST_TITLE = "Your screen is not being shared.";

export const SHARE_LOST_DETAIL =
  "You are still Online, and nobody has been told otherwise — but your manager cannot see anything. Reloading a page always ends a screen share, and only you can start a new one.";
