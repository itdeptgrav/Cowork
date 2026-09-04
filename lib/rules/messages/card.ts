import type { EmployeeId, MessageCard, MessagePollOption } from "@/lib/domain";

/**
 * Reading and writing a message's structured `card` — a shared location, a
 * shared contact, or a poll. Kept apart from the message readers because both
 * the conversation thread and the task chat store the same shape and must read
 * it back identically, and because the render path must never throw on a
 * malformed document: a partial or hand-edited card reads as "no card" rather
 * than crashing the bubble.
 */

const str = (v: unknown): string | null =>
  typeof v === "string" && v.trim() ? v : null;

const num = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

const ids = (v: unknown): EmployeeId[] =>
  Array.isArray(v)
    ? [...new Set(v.filter((x): x is string => typeof x === "string" && !!x))]
    : [];

/** Defensively read a stored card off a message document. `undefined` for
 *  anything that is not a well-formed card of a known kind. */
export function readMessageCard(raw: unknown): MessageCard | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const c = raw as Record<string, unknown>;
  if (c.kind === "location") {
    const lat = num(c.lat);
    const lng = num(c.lng);
    if (lat === null || lng === null) return undefined;
    return { kind: "location", lat, lng, label: str(c.label) };
  }
  if (c.kind === "contact") {
    const name = str(c.name);
    if (!name) return undefined;
    return {
      kind: "contact",
      employeeId: str(c.employeeId),
      name,
      role: str(c.role),
      email: str(c.email),
      phone: str(c.phone),
    };
  }
  if (c.kind === "poll") {
    const question = str(c.question);
    const options = readPollOptions(c.options);
    /* A poll worth showing has a question and at least two choices. */
    if (!question || options.length < 2) return undefined;
    return { kind: "poll", question, options, multiple: c.multiple === true };
  }
  return undefined;
}

function readPollOptions(raw: unknown): MessagePollOption[] {
  if (!Array.isArray(raw)) return [];
  const out: MessagePollOption[] = [];
  for (const o of raw) {
    if (!o || typeof o !== "object") continue;
    const r = o as Record<string, unknown>;
    const id = str(r.id);
    const text = str(r.text);
    if (!id || !text) continue;
    out.push({ id, text, votes: ids(r.votes) });
  }
  return out;
}

/** Normalise a card for storage: Firestore rejects `undefined`, so every
 *  optional field is written as an explicit `null`, and vote arrays are
 *  deduped. Returns a plain object safe to hand straight to a write. */
export function messageCardForWrite(card: MessageCard): Record<string, unknown> {
  if (card.kind === "location") {
    return { kind: "location", lat: card.lat, lng: card.lng, label: card.label ?? null };
  }
  if (card.kind === "contact") {
    return {
      kind: "contact",
      employeeId: card.employeeId ?? null,
      name: card.name,
      role: card.role ?? null,
      email: card.email ?? null,
      phone: card.phone ?? null,
    };
  }
  return {
    kind: "poll",
    question: card.question,
    multiple: card.multiple === true,
    options: card.options.map((o) => ({
      id: o.id,
      text: o.text,
      votes: [...new Set(o.votes ?? [])],
    })),
  };
}

/** A one-line preview of a card for a conversation-list row or a reply quote,
 *  where the message itself has no text. */
export function cardPreview(card: MessageCard): string {
  switch (card.kind) {
    case "location":
      return card.label ? `Location · ${card.label}` : "Location";
    case "contact":
      return `Contact · ${card.name}`;
    case "poll":
      return `Poll · ${card.question}`;
  }
}

/** Apply one person's vote to a poll, returning fresh options. Selecting an
 *  option they already picked removes it; on a single-choice poll a new pick
 *  replaces the old. Pure, so both repositories and the tests share it. */
export function togglePollVote(
  options: readonly MessagePollOption[],
  optionId: string,
  voterId: EmployeeId,
  multiple: boolean,
): MessagePollOption[] {
  const had = options.find((o) => o.id === optionId)?.votes.includes(voterId);
  return options.map((o) => {
    const without = o.votes.filter((v) => v !== voterId);
    if (o.id === optionId) {
      /* Toggle this one. */
      return { ...o, votes: had ? without : [...without, voterId] };
    }
    /* On a single-choice poll, picking one clears the others. */
    return { ...o, votes: multiple ? o.votes : without };
  });
}

/** Total distinct voters across a poll, for the "N votes" summary. */
export function pollVoterCount(options: readonly MessagePollOption[]): number {
  const all = new Set<EmployeeId>();
  for (const o of options) for (const v of o.votes) all.add(v);
  return all.size;
}
