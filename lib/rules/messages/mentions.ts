import type { EmployeeId } from "@/lib/domain";

/**
 * @-mentions of internal people, shared by the message thread and the task chat.
 *
 * Design choice, stated once: a mention is tracked as the person's id PLUS the
 * exact `@DisplayName` token inserted, not re-parsed from free text on send.
 * Re-parsing "@Ann Marie Jones" out of a sentence is ambiguous (where does the
 * name end?); tracking the inserted token and checking it still appears is not.
 * So the composer records picks, and `resolveMentionIds` keeps only the picks
 * whose token survives edits — delete the "@name" and the mention is gone.
 */

export interface MentionPerson {
  id: EmployeeId;
  displayName: string;
}

/** The @-query being typed at the caret, or null. The "@" must OPEN a token —
 *  at the start, or right after whitespace — so an email address's "@" is never
 *  a mention. The query runs to the caret, stops at a newline, and is length-
 *  capped so a stray "@" does not turn the rest of the line into a search. */
export function activeMention(
  text: string,
  caret: number,
): { start: number; query: string } | null {
  const upto = text.slice(0, Math.max(0, caret));
  const at = upto.lastIndexOf("@");
  if (at < 0) return null;
  const before = at === 0 ? "" : upto[at - 1];
  if (before && !/\s/.test(before)) return null;
  const query = upto.slice(at + 1);
  if (query.includes("\n") || query.length > 40) return null;
  return { start: at, query };
}

/** People whose display name contains every whitespace-split term of the query,
 *  case-insensitively. An empty query offers the first few. */
export function matchMentions(
  people: readonly MentionPerson[],
  query: string,
  limit = 6,
): MentionPerson[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  const out = people.filter((p) => {
    const name = p.displayName.toLowerCase();
    return terms.every((t) => name.includes(t));
  });
  return out.slice(0, limit);
}

/** The token a mention inserts and is tracked by. */
export function mentionToken(person: MentionPerson): string {
  return `@${person.displayName}`;
}

/** Replace the active @-token with the picked person's mention, returning the
 *  new text and where the caret should sit (just after the trailing space). */
export function insertMention(
  text: string,
  caret: number,
  start: number,
  person: MentionPerson,
): { text: string; caret: number } {
  const token = mentionToken(person);
  const after = text.slice(caret);
  /* One space after the mention — unless the following text already starts with
     one, which would otherwise leave a double space. */
  const sep = after.startsWith(" ") ? "" : " ";
  return {
    text: text.slice(0, start) + token + sep + after,
    caret: start + token.length + sep.length,
  };
}

/** From the picks, the ids whose token still appears in the final text. */
export function resolveMentionIds(
  text: string,
  picked: readonly { id: EmployeeId; token: string }[],
): EmployeeId[] {
  const ids = picked.filter((p) => text.includes(p.token)).map((p) => p.id);
  return [...new Set(ids)];
}

/** Split text into plain and mention runs for highlighting on read. A run is a
 *  mention when it equals one of the known `@DisplayName` tokens; longest tokens
 *  match first so "@Ann Marie" wins over "@Ann". */
export function mentionSegments(
  text: string,
  tokens: readonly string[],
): { text: string; mention: boolean }[] {
  const real = tokens.filter(Boolean);
  if (real.length === 0) return [{ text, mention: false }];
  const sorted = [...new Set(real)].sort((a, b) => b.length - a.length);
  const esc = sorted.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const re = new RegExp(`(${esc.join("|")})`, "g");
  const out: { text: string; mention: boolean }[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push({ text: text.slice(last, m.index), mention: false });
    out.push({ text: m[0], mention: true });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last), mention: false });
  return out.length ? out : [{ text, mention: false }];
}
