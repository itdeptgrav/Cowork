/**
 * "Meet about it before you agree the hours."
 *
 * A suggestion, never an obligation. The whole point of a task meeting is that
 * it happens BEFORE the work — you find out what is actually being asked, and
 * the conversation costs you nothing because its length is added back to your
 * deadline. But nothing on the task said so, so the ordinary path was to agree
 * a time budget for work you had not discussed, and discover the shape of it
 * afterwards.
 *
 * **It sits under the next action rather than replacing it.** Somebody is on the
 * other side of that deadline decision waiting for an answer; hiding their
 * request behind a suggestion would make this feature cost somebody else their
 * day. The obligation stays first and largest, and this is a second line.
 *
 * **It stops the moment a meeting has been held.** A hint that keeps suggesting
 * something you have already done reads as a system that is not paying
 * attention, and people stop reading the line it is printed on.
 */

export interface MeetingHint {
  /** The sentence, phrased as a reason rather than an instruction. */
  text: string;
  label: string;
  href: string;
}

export function meetingFirstHint(input: {
  taskId: string;
  /** Whose move it is. A suggestion aimed at somebody with nothing to do is noise. */
  actor: "you" | "them" | "nobody";
  /**
   * Whether the time budget has been agreed.
   *
   * The one stage where a meeting still changes what you decide: you are being
   * asked how long the work will take, and you have not been told what it is.
   * Read from the negotiation rather than from `nextAction`, which carries a
   * label and an actor but no notion of WHY it is your move.
   */
  budgetSettled: boolean;
  /** Any meeting at all, ever — credited or not. */
  everMet: boolean;
}): MeetingHint | null {
  if (input.actor !== "you") return null;
  if (input.budgetSettled) return null;
  if (input.everMet) return null;

  return {
    text:
      "Not sure what this involves? Hold the meeting first — the time it takes " +
      "is added back to your deadline, so it costs you nothing.",
    label: "Open the meeting room",
    href: `/tasks/${input.taskId}/meetings`,
  };
}
