import type { DutyMode } from "./duty.ts";

/**
 * What a person may do with their own work while they are not online.
 *
 * **Legacy's rule, and it is a rule rather than a disabled button.** From
 * `app/coworking/tasks/page.js:8571`, the entire action banner is replaced:
 *
 *     {(isAssignee && myDutyMode && myDutyMode !== "online") ? (
 *        …Offline notice…
 *     ) : (
 *        <TaskActionBanner … />
 *     )}
 *
 * Three things in that expression are load-bearing and all three are reproduced
 * below rather than approximated:
 *
 *  1. **`isAssignee`.** The gate is about doing the work, not about seeing it.
 *     A manager reviewing a submission, a creator deciding a deadline, anyone
 *     reading a task — none of that is withheld. Only the person carrying the
 *     work is stopped from advancing it while they are away from it.
 *
 *  2. **`myDutyMode !== "online"`**, not `=== "offline"`. Break and emergency
 *     block exactly as being offline does. That is the point of them: the
 *     minutes are being credited back to this person's deadlines, so working
 *     through them would have the clock paying twice.
 *
 *  3. **`myDutyMode &&`** — a null mode is permissive. Null is the listener
 *     still attaching, and refusing during that window would flash a refusal at
 *     everybody on every page load. Unknown is not the same as away.
 *
 * The old app spent this rule across six inline conditions in one 10,000-line
 * file. Here it is one function, so the banner, the timer control and the
 * repository cannot reach different conclusions — which they would, eventually,
 * because six copies of a condition are six things to remember to change.
 */

/** Why the work cannot advance. Null when it can. */
export type PresenceBlock = "offline" | "break" | "emergency";

export interface PresenceRefusal {
  block: PresenceBlock;
  /** The state's name, as the person sees it on their own pill. */
  stateLabel: string;
  /** One sentence, for a banner that replaces the actions. */
  message: string;
  /** The shorter form, for a control that has no room for a sentence. */
  short: string;
}

/**
 * The three states' own words.
 *
 * Legacy names the state and then says what follows from it, in that order, and
 * the wording is kept: a person who reads "Offline — the timer is paused" on
 * the old app and something else here has to work out whether they are two
 * different rules. They are one rule.
 */
const REFUSAL: Record<PresenceBlock, PresenceRefusal> = {
  offline: {
    block: "offline",
    stateLabel: "Offline",
    message:
      "Offline — the timer is paused and no task actions can be taken right now. Go online from the top bar to resume.",
    short: "Offline — go online to continue",
  },
  break: {
    block: "break",
    stateLabel: "On Break",
    message:
      "On Break — the timer is paused and no task actions can be taken right now. Your break time is being credited back to your deadlines. End the break from the top bar to resume.",
    short: "On break — end it to continue",
  },
  emergency: {
    block: "emergency",
    stateLabel: "Emergency Mode",
    message:
      "Emergency Mode — the timer is paused and no task actions can be taken right now. Go online from the top bar to resume; the time will be sent to your manager for approval.",
    short: "Emergency Mode — go online to continue",
  },
};

/**
 * The gate. `null` means the work may proceed.
 *
 * `mode` is nullable on purpose — see point 3 above. Pass the mode straight
 * through from the presence listener without substituting a default, because
 * substituting "offline" for "not known yet" is precisely the bug the null
 * carries information about.
 */
export function presenceRefusal(
  mode: DutyMode | null,
  isAssignee: boolean,
): PresenceRefusal | null {
  if (!isAssignee) return null;
  if (mode === null || mode === "online") return null;
  return REFUSAL[mode];
}

/** True when this person may act on work they are carrying. */
export function mayActOnOwnWork(
  mode: DutyMode | null,
  isAssignee: boolean,
): boolean {
  return presenceRefusal(mode, isAssignee) === null;
}

/**
 * The refusal a WRITE returns, in the repository's vocabulary.
 *
 * The rule has to hold at the data layer and not only on screen. Legacy's did
 * not — its gate was six render conditions, so the same write reached Firestore
 * untouched from anywhere the conditions had been forgotten, and the timer was
 * startable from a task row while the detail page refused it.
 *
 * `invalid_state` rather than `permission_denied`: the person is entitled to
 * this action and will be able to take it in a moment. Nothing about their
 * permissions is wrong, and telling them it is would send them to an
 * administrator who has nothing to fix.
 */
export function presenceWriteRefusal(
  mode: DutyMode | null,
  isAssignee = true,
): { ok: false; code: "invalid_state"; message: string } | null {
  const refusal = presenceRefusal(mode, isAssignee);
  if (!refusal) return null;
  return { ok: false, code: "invalid_state", message: refusal.message };
}
