/**
 * What "Create task" is doing, at each point of the wait.
 *
 * Creating a task is the one action on this app that is genuinely several
 * round trips rather than one, and they happen in an order the permission
 * model forces rather than the order anybody would guess:
 *
 *  1. the task is written — and the engine tells everyone on it and renumbers
 *     their priority lists before it replies;
 *  2. its outputs and its reference files go up, which cannot happen sooner
 *     because permission for an upload is checked against the task and there
 *     was no task to check against;
 *  3. the page opens.
 *
 * So the honest thing to show while somebody waits is which of those is
 * happening, not one unchanging "Creating…". This is the copy for that, kept in
 * one pure place so the words can be read and tested without rendering a form.
 *
 * Nothing here guesses or simulates. Each stage is set by the handler at the
 * moment it actually enters that stage, and the counts are the counts of what
 * is really being sent.
 */

export type CreateStage = "task" | "extras" | "opening";

/** Plural that reads as English rather than as "1 file(s)". */
const count = (n: number, one: string, many: string): string =>
  `${n} ${n === 1 ? one : many}`;

export function createWaitNote(
  stage: CreateStage,
  files: number,
  outputs: number,
): string {
  if (stage === "task")
    return "Still working — this is normal. Creating a task is more than a save: it is written, everyone it was assigned to is notified, and their priority lists are put back in order before the server replies.";

  if (stage === "extras") {
    const doing: string[] = [];
    if (files > 0) doing.push(count(files, "file", "files"));
    if (outputs > 0) doing.push(count(outputs, "output", "outputs"));
    if (doing.length === 0) return "The task exists. Opening it…";
    return `The task exists — sending its ${doing.join(" and ")}. These go up after the task rather than before it, because the engine checks permission against the task.`;
  }

  return "Opening the task…";
}

/**
 * The button's own label for the stage.
 *
 * The label and the line say different things on purpose: the label is what is
 * happening, in two words, for somebody glancing; the line is why it is taking
 * a moment, for somebody who has started to wonder.
 */
export function createStageLabel(stage: CreateStage): string {
  return stage === "task"
    ? "Creating…"
    : stage === "extras"
      ? "Attaching…"
      : "Opening…";
}
