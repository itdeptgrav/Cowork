/**
 * Reading the engine's "submitted for review" line out of a task-chat message.
 *
 * When someone submits work, the engine posts a chat message AS THAT PERSON —
 * "✅ {name} submitted work for completion review.\n{their note}" — so it lands
 * as a right-aligned bubble with read ticks and reads like something they typed.
 * It is not: it is an event the system wrote. This recognises it so the chat can
 * render it as an event card instead of a personal message.
 *
 * Parsed rather than flagged because the engine does not mark it `system` (it
 * carries the submitter's own id, for the proof attachments to be theirs), and
 * because this must also reclaim the messages already sitting in every thread.
 * Anything that is not a submission line returns null and stays a normal bubble.
 */
export interface SubmissionNotice {
  /** Who submitted — named before "submitted work …". */
  byName: string;
  /** Their note — the "What you completed" text, below the first line. */
  note: string;
}

export function parseSubmissionNotice(text: string): SubmissionNotice | null {
  if (
    typeof text !== "string" ||
    !/submitted work for completion review/i.test(text)
  ) {
    return null;
  }

  const by = text.match(
    /^\s*[^\p{L}\p{N}]*\s*(.+?)\s+submitted work for completion review/iu,
  );
  /* The note is whatever the engine put after the fixed sentence — usually on
     the next line. Split on the sentence so the reviewer's own words, whatever
     they are, are never matched against. */
  const after = text.split(/submitted work for completion review\.?/i)[1] ?? "";

  return {
    byName: by ? by[1].trim() : "",
    note: after.replace(/^[\s\n]+/, "").trim(),
  };
}
