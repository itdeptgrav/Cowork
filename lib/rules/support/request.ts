/**
 * A support request, before anything is sent anywhere.
 *
 * The panel is a front-end preview: nothing is delivered, no record is
 * written, and the panel says so in as many words. What is real here is the
 * SHAPE of a request and the rules about when one is complete — so when a
 * backend does arrive, the form it feeds already agrees with itself about what
 * it is collecting, and the wording of every refusal is already written down
 * where a test can hold it.
 */

/** What the request is about. The reader picks one; it is never guessed. */
export const SUPPORT_TOPICS = [
  { id: "signin", label: "Signing in" },
  { id: "tasks", label: "Tasks & projects" },
  { id: "messages", label: "Messages" },
  { id: "attendance", label: "Attendance & score" },
  { id: "broken", label: "Something is broken" },
  { id: "other", label: "Something else" },
] as const;

export type SupportTopicId = (typeof SUPPORT_TOPICS)[number]["id"];

/**
 * How much it is holding them up.
 *
 * Three, not five. A scale with more steps than a person can distinguish
 * collects noise: everybody picks the middle or the top, and the field stops
 * meaning anything to whoever reads the queue.
 */
export const SUPPORT_URGENCIES = [
  { id: "low", label: "Whenever", hint: "Not blocking me" },
  { id: "normal", label: "Soon", hint: "Slowing me down" },
  { id: "blocking", label: "Blocking", hint: "I cannot work" },
] as const;

export type SupportUrgencyId = (typeof SUPPORT_URGENCIES)[number]["id"];

export interface SupportDraft {
  topic: SupportTopicId | null;
  subject: string;
  detail: string;
  /** How to reach them. Asked for rather than assumed — before sign-in there
   *  is no identity to read it from, which is the case this panel is for. */
  email: string;
  urgency: SupportUrgencyId;
}

export const EMPTY_SUPPORT_DRAFT: SupportDraft = {
  topic: null,
  subject: "",
  detail: "",
  email: "",
  urgency: "normal",
};

/** The shortest useful description. Below this it is a subject, not a report. */
const MIN_DETAIL = 10;

export interface SupportRefusals {
  topic?: string;
  subject?: string;
  detail?: string;
  email?: string;
}

/**
 * What is still missing, field by field.
 *
 * Returns a map rather than the first problem, so the form can mark every
 * unfinished field at once instead of sending somebody round the loop three
 * times. An empty object means it is ready to send.
 *
 * The email check is deliberately loose — one `@`, something either side, no
 * spaces. A stricter pattern rejects addresses that genuinely exist, and the
 * cost of accepting a wrong-looking one is a reply that bounces, against the
 * cost of refusing a real one, which is a person who cannot ask for help.
 */
export function supportRefusals(draft: SupportDraft): SupportRefusals {
  const out: SupportRefusals = {};
  if (!draft.topic) out.topic = "Choose what this is about.";
  if (!draft.subject.trim()) out.subject = "Give this a one-line summary.";
  const detail = draft.detail.trim();
  if (!detail) out.detail = "Describe what happened.";
  else if (detail.length < MIN_DETAIL)
    out.detail = "A sentence or two helps — what did you expect, and what happened instead?";
  const email = draft.email.trim();
  if (!email) out.email = "We need somewhere to reply.";
  else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    out.email = "That does not look like an email address.";
  return out;
}

/** Whether the draft can be sent. */
export function supportDraftReady(draft: SupportDraft): boolean {
  return Object.keys(supportRefusals(draft)).length === 0;
}

/**
 * The reference a submitted request is given, e.g. `SUP-7K2Q`.
 *
 * Derived from the instant and the subject rather than from a random number,
 * for one reason that matters beyond tidiness: a component may not call
 * `Math.random()` during a render, and a reference that changed every time
 * React re-drew the confirmation would be a number nobody could write down.
 * Same inputs, same reference.
 *
 * **It is a placeholder.** Nothing is stored against it, and when a real
 * backend issues references this is replaced by the one it returns.
 */
export function supportReference(atMs: number, seed: string): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no I/O/0/1 to misread
  let hash = Math.abs(Math.trunc(atMs)) % 1_048_576;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) % 1_048_576;
  }
  let out = "";
  for (let i = 0; i < 4; i++) {
    out += alphabet[hash % alphabet.length];
    hash = Math.floor(hash / alphabet.length) + 7;
  }
  return `SUP-${out}`;
}
