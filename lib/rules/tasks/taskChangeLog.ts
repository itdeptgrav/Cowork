import { formatEt } from "./etAdjustment";
import type { RequirementEdit } from "./requirementEdits";

/**
 * The line a requirement/ET change writes into the history and the task thread.
 *
 * ## One wording, three places
 *
 * A change to a task has to appear in the History tab, in the Task Chat, and in
 * the notification the assignee receives — the request is explicit that all
 * three show the same thing. Building the sentence here, once, is what stops the
 * three drifting into three slightly different accounts of one event.
 *
 * ## What the sentence carries, and what it does NOT
 *
 * It carries what changed and by how much: the requirement, the time added or
 * subtracted, and the estimate before and after. It does not carry WHO or WHEN —
 * those are metadata on the surfaces that render it. A chat message already
 * shows its sender and time; a history event already shows its actor and
 * timestamp. Baking "by Ray at 10:45" into the string would either duplicate
 * that or, worse, let an untrusted client assert an author. The who comes from
 * the verified token on the server, the when from its clock.
 *
 * ## The ET figures are the CALLER's, and each caller's are authoritative
 *
 * `etBeforeSecs`/`etAfterSecs` are passed in rather than derived, because the
 * one number that matters — what the estimate actually became — is decided by
 * whoever wrote it: the engine on the real path, the mock on the prototype. The
 * builder renders the figures it is given; it does not compute a budget.
 */

export interface ChangeSummaryInput {
  kind: RequirementEdit["kind"];
  /** Added/removed text, or the text AFTER an edit. */
  subject: string;
  /** The text BEFORE an edit. Ignored for add and remove. */
  before?: string | null;
  /** The estimate before this change, in seconds. */
  etBeforeSecs: number;
  /** The estimate after it. Equal to `etBeforeSecs` when the time was left
   *  alone (a rewording, or an add/remove whose time prompt was cancelled). */
  etAfterSecs: number;
}

/** Minutes/hours, signed, e.g. "+1h 30m" / "−30m". Uses a real minus sign. */
function signedTime(deltaSecs: number): string {
  const sign = deltaSecs >= 0 ? "+" : "−";
  return `${sign}${formatEt(Math.abs(deltaSecs))}`;
}

/**
 * The event/notification summary — one line, ` · `-separated so it renders in a
 * history row, a chat bubble and a push notification without newlines.
 *
 *   Requirement added: "Create barcode validation" · Time +1h 30m · ET 6h → 7h 30m
 *   Requirement removed: "Old validation logic" · Time −30m · ET 7h 30m → 7h
 *   Requirement edited: "Create login page" → "Create responsive login page" · Time +1h · ET 7h → 8h
 *
 * When the estimate did not move, the time and ET clauses collapse to a single
 * "ET unchanged" rather than showing "+0m" and an arrow to the same figure.
 */
export function buildChangeSummary(input: ChangeSummaryInput): string {
  const head = requirementClause(input);

  const delta =
    Math.max(0, Math.round(input.etAfterSecs)) -
    Math.max(0, Math.round(input.etBeforeSecs));

  if (delta === 0) {
    return `${head} · ET unchanged (${formatEt(input.etBeforeSecs)})`;
  }

  return (
    `${head} · Time ${signedTime(delta)}` +
    ` · ET ${formatEt(input.etBeforeSecs)} → ${formatEt(input.etAfterSecs)}`
  );
}

function requirementClause(input: ChangeSummaryInput): string {
  const subject = String(input.subject ?? "").trim();
  if (input.kind === "added") return `Requirement added: “${subject}”`;
  if (input.kind === "removed") return `Requirement removed: “${subject}”`;
  const before = String(input.before ?? "").trim();
  return `Requirement edited: “${before}” → “${subject}”`;
}

/**
 * Which `TaskEvent` type a change is filed under.
 *
 * These are values the `TaskEventType` union already carries — `requirement_added`
 * and `edited` predate this feature — so the History panel's existing per-type
 * rendering keeps working. A removal reuses `edited` rather than inventing a
 * `requirement_removed` the panel would not recognise: the summary already says
 * "removed", and the type only groups, it does not caption.
 */
export function changeEventType(
  kind: RequirementEdit["kind"],
): "requirement_added" | "edited" {
  return kind === "added" ? "requirement_added" : "edited";
}

/**
 * The structured record kept ALONGSIDE the sentence, on the event's payload.
 *
 * The sentence is for a person; this is for anything that later wants the
 * numbers without parsing prose — a report, a filter, a test. Nothing renders
 * it today, which is exactly why it must be captured now: the figures are here
 * at the moment of the change and nowhere afterwards.
 */
export function changePayload(input: ChangeSummaryInput): Record<string, unknown> {
  return {
    change: input.kind,
    requirement: input.subject,
    ...(input.kind === "edited" ? { requirementBefore: input.before ?? null } : {}),
    etBeforeSecs: Math.max(0, Math.round(input.etBeforeSecs)),
    etAfterSecs: Math.max(0, Math.round(input.etAfterSecs)),
    etDeltaSecs:
      Math.max(0, Math.round(input.etAfterSecs)) -
      Math.max(0, Math.round(input.etBeforeSecs)),
  };
}

/** The parts of a change line, for a surface that wants to render it as a card
 *  rather than a sentence. */
export interface ParsedChange {
  action: "added" | "removed" | "edited";
  /** The requirement text (the AFTER text for an edit). */
  requirement: string;
  /** The BEFORE text, on an edit only. */
  before?: string;
  /** "+1h 30m" / "−30m", or null when the estimate did not move. */
  time: string | null;
  /** "2h" and "3h", or null when the estimate did not move. */
  etFrom: string | null;
  etTo: string | null;
  /** The estimate when it was left unchanged — "2h". */
  etUnchanged: string | null;
}

/**
 * Read a change line back into its parts, or null if it is not one.
 *
 * ## Why parse at all, rather than carry the structure
 *
 * A system chat message stores only `text`. To render the line as a card the
 * task thread has to recover the parts, and the safe way to do that is to split
 * on the ` · ` separators THIS module inserts — never on the wording inside a
 * clause, which a requirement's own text could contain. `buildChangeSummary` is
 * the only thing that writes these, so the shape is known and stable.
 *
 * Anything that is not one of our change lines — an approval, a deadline
 * decision, some future system message — returns null, and the caller renders
 * it as the plain quiet line it was before. So a wording the parser does not
 * recognise degrades to the old behaviour rather than to a broken card.
 */
export function parseChangeSummary(text: string): ParsedChange | null {
  const clauses = String(text ?? "").split(" · ");
  const head = clauses[0] ?? "";

  const m = /^Requirement (added|removed|edited): (.+)$/.exec(head);
  if (!m) return null;
  const action = m[1] as ParsedChange["action"];
  const rest = m[2];

  const unquote = (t: string) => t.trim().replace(/^[“"]|[”"]$/g, "").replace(/^[“"]|[”"]$/g, "");

  let requirement: string;
  let before: string | undefined;
  if (action === "edited") {
    const arrow = rest.split(" → ");
    before = unquote(arrow[0] ?? "");
    requirement = unquote(arrow[1] ?? "");
  } else {
    requirement = unquote(rest);
  }

  let time: string | null = null;
  let etFrom: string | null = null;
  let etTo: string | null = null;
  let etUnchanged: string | null = null;

  for (const clause of clauses.slice(1)) {
    const c = clause.trim();
    if (c.startsWith("Time ")) {
      time = c.slice("Time ".length).trim();
    } else if (c.startsWith("ET unchanged")) {
      const u = /\(([^)]+)\)/.exec(c);
      etUnchanged = u ? u[1] : null;
    } else if (c.startsWith("ET ")) {
      const parts = c.slice("ET ".length).split(" → ");
      etFrom = (parts[0] ?? "").trim() || null;
      etTo = (parts[1] ?? "").trim() || null;
    }
  }

  return { action, requirement, before, time, etFrom, etTo, etUnchanged };
}
