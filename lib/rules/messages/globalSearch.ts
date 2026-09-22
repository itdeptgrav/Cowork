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

/* ── People ───────────────────────────────────────────────────────────────── */

/**
 * The fields a person is findable by. Structural rather than `Employee`, so the
 * rule can be tested without a directory record and so a caller with a thinner
 * person — a participant row, say — can use the same matcher.
 */
export interface SearchablePerson {
  id: string;
  displayName: string;
  designation?: string | null;
  departmentName?: string | null;
  employeeCode?: string | null;
  email?: string | null;
  exitedAt?: string | null;
}

/**
 * How well a person answers to a query, lower being better, or `null` for not
 * at all.
 *
 * **Why a rank and not a boolean.** Typing "ra" into a directory of two hundred
 * people matches RAKESH by his name and a dozen others by a department called
 * Production — and a plain filter would hand back whoever the directory
 * happened to list first. The person whose NAME you typed has to come first, or
 * the feature is a list to scroll rather than an answer.
 *
 * The order is the order somebody means it in: the whole name they typed, then
 * a name that starts that way, then any word of the name (people search a
 * surname as readily as a first name), then the name containing it at all, then
 * the identifiers they might have pasted, then the job and the department —
 * which is a real way to search, and never a better match than a name.
 */
export function personRank(person: SearchablePerson, query: string): number | null {
  const q = query.trim().toLowerCase();
  if (!q) return null;

  const name = person.displayName.toLowerCase();
  if (name === q) return 0;
  if (name.startsWith(q)) return 1;
  if (name.split(/\s+/).some((word) => word.startsWith(q))) return 2;
  if (name.includes(q)) return 3;

  const code = (person.employeeCode ?? "").toLowerCase();
  const email = (person.email ?? "").toLowerCase();
  if (code && code.includes(q)) return 4;
  if (email && email.includes(q)) return 4;

  const designation = (person.designation ?? "").toLowerCase();
  const department = (person.departmentName ?? "").toLowerCase();
  if (designation.includes(q)) return 5;
  if (department.includes(q)) return 6;

  return null;
}

/**
 * Everybody matching, best first — the employee half of the search.
 *
 * Blank matches nobody, exactly as `matchesQuery` does: a search box with
 * nothing in it is not a request for the whole directory.
 *
 * **Who is left out, and why it is the same list the New message dialog
 * offers.** Yourself, because `createConversation` refuses a thread with one
 * person in it, and a result that cannot be opened is worse than no result.
 * Anyone who has left, because the only thing a search result here does is
 * start a conversation, and starting one with somebody who has gone is an offer
 * the product cannot honour. `includeExited` is there for a caller that wants
 * to LOOK somebody up rather than write to them.
 */
export function matchPeople<T extends SearchablePerson>(
  people: T[],
  query: string,
  options: { excludeId?: string | null; includeExited?: boolean } = {},
): T[] {
  if (!query.trim()) return [];
  const { excludeId = null, includeExited = false } = options;

  const ranked: { person: T; rank: number }[] = [];
  for (const person of people) {
    if (excludeId && person.id === excludeId) continue;
    if (!includeExited && person.exitedAt) continue;
    const rank = personRank(person, query);
    if (rank === null) continue;
    ranked.push({ person, rank });
  }

  /* Alphabetical within a rank, so the list does not reshuffle itself between
     two reads of the same directory. */
  ranked.sort(
    (a, b) =>
      a.rank - b.rank ||
      a.person.displayName.localeCompare(b.person.displayName),
  );
  return ranked.map((r) => r.person);
}
