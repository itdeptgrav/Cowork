/**
 * Reading the engine's rework line out of a task-chat system message.
 *
 * When a reviewer sends work back, the engine writes a system message into the
 * task chat — "🔄 {name} sent this task back for rework (rework #N). 📝 Reason:
 * …". The frontend does not build that text, so it is parsed rather than
 * constructed, and parsed TOLERANTLY: the emojis, the exact punctuation and the
 * middle wording may drift, so this keys off the three stable parts — the phrase
 * "back for rework", the "#N" occurrence, and everything after "Reason:".
 *
 * Anything that is not a rework line returns null, and the caller renders it the
 * way it rendered every other system message before — so an unrecognised shape
 * degrades to the quiet line, never to a broken card.
 */
export interface ReworkNotice {
  /** Which rework this is — the "#N". 0 when the text carried no number. */
  occurrence: number;
  /** The reviewer's reason — the "Reason:" text, WITHOUT the deduction line. */
  reason: string;
  /** Who sent it back, where the line names them before "sent … back". */
  byName: string;
  /**
   * The score outcome, where the engine wrote one on its own line: whether the
   * deduction was waived, and how many points it costs when it is not.
   *
   * Null for a line written before the engine stated the outcome — an old
   * rework whose waive decision was never recorded — so the card shows the
   * reason and simply omits the score line rather than guessing.
   */
  deduction: { waived: boolean; points: number } | null;
}

export function parseReworkNotice(text: string): ReworkNotice | null {
  if (typeof text !== "string" || !/back for rework/i.test(text)) return null;

  const occ = text.match(/rework\s*#?\s*(\d+)/i);
  const by = text.match(/^\s*[^\p{L}\p{N}]*\s*(.+?)\s+sent this task back for rework/iu);

  /* The deduction outcome — a line the engine appends after the reason. */
  let deduction: { waived: boolean; points: number } | null = null;
  if (/deduction\s+waived/i.test(text)) {
    deduction = { waived: true, points: 0 };
  } else {
    const pts = text.match(/deduction\s+applied[^\n]*?([\d.]+)\s*points?\s*cut/i);
    if (pts) deduction = { waived: false, points: Number(pts[1]) };
  }

  /* Reason: everything after "Reason:", minus the deduction line the engine
     appended after it (matched on the "deduction … cut/waived" wording, never
     on the reviewer's own words). */
  let reason = "";
  const rm = text.match(/reason:\s*([\s\S]*)$/i);
  if (rm) {
    reason = rm[1]
      .replace(/\n[^\n]*deduction[^\n]*$/i, "")
      .trim();
  }

  return {
    occurrence: occ ? Number(occ[1]) : 0,
    reason,
    byName: by ? by[1].trim() : "",
    deduction,
  };
}
