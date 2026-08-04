/**
 * This tab's identity, for as long as it lives.
 *
 * **What it is for.** Two tabs are open and one of them holds the screen share.
 * The other has no room, so its honest view of the world is "nothing is being
 * shared" — and if it published that, it would put its own user offline while
 * their screen was still going out to a watching manager. The presence document
 * therefore records WHICH connection claimed `online`, and a tab may only clear
 * a claim it owns. This is that identifier.
 *
 * **Why per-tab rather than per-session or per-user.** The thing that can die
 * without warning is a tab. A per-user id could not tell two tabs apart, which
 * is the whole problem; a per-room id would not exist until a room did, and the
 * claim has to be attributable from the moment it is written.
 *
 * **Why not persisted.** A reload is a new claim on purpose. The old tab's room
 * is gone with it, so its claim should not survive — it would be a live-looking
 * id with nothing publishing behind it, and the staleness window would be the
 * only thing left to catch it. A fresh id makes the reload honest immediately.
 *
 * Lazy, because module scope runs on the server during prerender where there is
 * no tab to identify and no `crypto` guarantee.
 */

let id: string | null = null;

export function connectionId(): string {
  if (id !== null) return id;
  id =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : /* Older Safari and any non-secure context. Collision here would mean
           one tab clearing another's claim, which the staleness window would
           correct within its window rather than permanently. */
        `c-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e9).toString(36)}`;
  return id;
}

/** Test seam. A new tab, as far as ownership is concerned. */
export function resetConnectionId(): void {
  id = null;
}

/**
 * Did THIS DEVICE most recently claim `online`?
 *
 * **Why this exists, separate from `connectionId()`.** The presence document
 * is one shared answer, read by every device a person owns. Opening it on a
 * phone while a laptop is sharing must not make the phone think it has a
 * reconnect of its own to offer — there was never a share here to resume. But
 * `connectionId()` is deliberately fresh on every load (see above), so it
 * cannot answer "was it THIS device" after a reload of the very tab that WAS
 * sharing. This is a second, PERSISTED flag for exactly that question — not a
 * claim of ownership over the live document, just this browser's memory of
 * whether it was the one that last put itself online.
 *
 * `localStorage` rather than the module scope: it must survive the reload
 * `restorePresence` exists to handle, and it must NOT be visible to any other
 * device — which is what makes a phone and a laptop answer this differently
 * for the same person.
 */
const CLAIMED_ONLINE_KEY = "cowork:presence:claimedOnlineHere";

/** Record that this device just published `online` for itself. */
export function markClaimedOnlineHere(): void {
  try {
    window.localStorage.setItem(CLAIMED_ONLINE_KEY, "1");
  } catch {
    /* Private browsing, storage disabled — worst case this device stops
       offering a reconnect prompt it would have been entitled to. */
  }
}

/** Record that this device deliberately left `online` (break/emergency/offline). */
export function clearClaimedOnlineHere(): void {
  try {
    window.localStorage.removeItem(CLAIMED_ONLINE_KEY);
  } catch {
    /* See markClaimedOnlineHere. */
  }
}

export function claimedOnlineHere(): boolean {
  try {
    return window.localStorage.getItem(CLAIMED_ONLINE_KEY) === "1";
  } catch {
    return false;
  }
}
