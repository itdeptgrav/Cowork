/**
 * The matching rule behind the global message search — one place, so the mock
 * store, the Firestore fan-out and the result UI all agree on what "matches"
 * means and highlight the same run. Case-insensitive substring; a blank query
 * matches nothing (the caller shows the chat list instead of every message).
 */

export function matchesQuery(text: string, query: string): boolean {
  const q = query.trim().toLowerCase();
  return q.length > 0 && text.toLowerCase().includes(q);
}

/** A short window of text centred on the first match, elided at each end where
 *  it was cut — so a long message shows the hit rather than its opening words. */
export function snippetAround(text: string, query: string, radius = 36): string {
  const q = query.trim().toLowerCase();
  if (!q) return text;
  const i = text.toLowerCase().indexOf(q);
  if (i < 0) return text;
  const start = Math.max(0, i - radius);
  const end = Math.min(text.length, i + q.length + radius);
  return `${start > 0 ? "…" : ""}${text.slice(start, end)}${end < text.length ? "…" : ""}`;
}

/** Split text into matching and non-matching runs, for bolding the hit in a
 *  result row. Every occurrence of the query splits out, in order. */
export function searchSegments(
  text: string,
  query: string,
): { text: string; match: boolean }[] {
  const q = query.trim();
  if (!q) return [{ text, match: false }];
  const lc = text.toLowerCase();
  const lq = q.toLowerCase();
  const out: { text: string; match: boolean }[] = [];
  let i = 0;
  while (i < text.length) {
    const found = lc.indexOf(lq, i);
    if (found < 0) {
      out.push({ text: text.slice(i), match: false });
      break;
    }
    if (found > i) out.push({ text: text.slice(i, found), match: false });
    out.push({ text: text.slice(found, found + q.length), match: true });
    i = found + q.length;
  }
  return out.length ? out : [{ text, match: false }];
}
