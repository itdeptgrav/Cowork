import type { EmployeeId, MailMessage, MailParty } from "@/lib/domain";

/**
 * Blind carbon copy — the one mail rule that is a privacy guarantee rather than
 * a convenience.
 *
 * ## What "blind" has to mean, stated exactly
 *
 * A bcc'd person **receives the message**. Everybody else — including the other
 * bcc'd people — **must never learn they did**. Those two sentences pull in
 * opposite directions, and every bcc bug is one of them winning:
 *
 *  · Store bcc and return it with the message, and the blind copy is not blind.
 *    This is the failure that matters, because it is silent: the sender is told
 *    the copy was blind, and it was not.
 *  · Leave bcc off the message, and the bcc'd person cannot see their own mail.
 *
 * So the list is **stored once and redacted on the way out**. `bcc` is on the
 * message because the SENDER has to be able to see who they copied — a blind
 * copy you cannot audit afterwards is a different problem — and every read by
 * anybody else strips it.
 *
 * ## Redaction is not the same as hiding the field
 *
 * `redactBcc` returns `bcc: []`, not `bcc: undefined`. A reader cannot tell an
 * empty list from a redacted one, which is the point: "this message had no
 * bcc" and "you are not allowed to see its bcc" must be indistinguishable, or
 * the absence of the field becomes the signal that there was one.
 *
 * ## Where this must be called
 *
 * On every path that hands a `MailMessage` to a caller. There is deliberately
 * no "safe by construction" trick here — the field exists on the type, so the
 * discipline is that reads go through `redactBcc` and a test asserts each read
 * path does.
 *
 * ## What this does NOT guarantee, said plainly
 *
 * **On the real backend the redaction runs in the browser, so it is not a
 * security boundary.** `LegacyRepository` reads `cowork_mails` directly with
 * the reader's own Firebase credentials: the whole document — `bcc` included —
 * arrives at their machine and this function removes it afterwards. Somebody
 * who opens devtools, or queries Firestore themselves, sees the blind copies.
 *
 * The same is true of `participantIds`, which MUST contain the blind-copied
 * employee ids or they could never query their own mail.
 *
 * What would actually enforce it is a Firestore security rule on `cowork_mails`
 * that projects the field away, or a server-side read path. Neither exists —
 * the collection is shared with the live legacy app, and a rule that refused
 * its reads would break it. Same shape as the limitation recorded on
 * `app/api/admin/settings/route.ts`.
 *
 * So this is honest about what it is: bcc is blind **in the product** — no
 * screen, list, thread, search or notification discloses it — and not blind
 * against somebody deliberately reading the store. Written down rather than
 * implied, because a privacy guarantee whose limits are undocumented gets
 * relied on as though it had none.
 */

/** Everybody who receives the message, in every field. */
export function allRecipients(
  message: Pick<MailMessage, "to" | "cc" | "bcc">,
): MailParty[] {
  return [...message.to, ...message.cc, ...message.bcc];
}

/**
 * Whether this person may see the message at all.
 *
 * **`bcc` counts.** A bcc'd person is a recipient; leaving them out here would
 * deliver a message to somebody who then cannot open it, which is not a blind
 * copy but a lost one.
 */
export function mailVisibleTo(
  message: Pick<MailMessage, "from" | "to" | "cc" | "bcc">,
  viewerId: EmployeeId | null,
): boolean {
  if (!viewerId) return false;
  if (message.from.employeeId === viewerId) return true;
  return allRecipients(message).some((p) => p.employeeId === viewerId);
}

/** Whether this person is allowed to know who was blind-copied. */
export function maySeeBcc(
  message: Pick<MailMessage, "from">,
  viewerId: EmployeeId | null,
): boolean {
  return Boolean(viewerId) && message.from.employeeId === viewerId;
}

/**
 * The message as this person may see it.
 *
 * Returns the SAME object when nothing needs removing, so the common read —
 * a message with no bcc — allocates nothing.
 */
export function redactBcc<T extends Pick<MailMessage, "from" | "bcc">>(
  message: T,
  viewerId: EmployeeId | null,
): T {
  if (message.bcc.length === 0) return message;
  if (maySeeBcc(message, viewerId)) return message;
  return { ...message, bcc: [] };
}

/** Every message as this person may see it. */
export function redactBccAll<T extends Pick<MailMessage, "from" | "bcc">>(
  messages: readonly T[],
  viewerId: EmployeeId | null,
): T[] {
  return messages.map((m) => redactBcc(m, viewerId));
}

/**
 * Who is named on the THREAD.
 *
 * Never the bcc'd. A thread carries its participants so the list can show who
 * is in a conversation and so search can match on a name — both of which would
 * disclose a blind copy to everyone else on it. This is a separate function
 * from `allRecipients` precisely so the difference is stated once and cannot be
 * closed by somebody spreading the wrong list.
 */
export function threadParticipants(
  from: MailParty,
  to: readonly MailParty[],
  cc: readonly MailParty[],
): MailParty[] {
  const seen = new Set<string>();
  const out: MailParty[] = [];
  for (const p of [from, ...to, ...cc]) {
    if (seen.has(p.address)) continue;
    seen.add(p.address);
    out.push(p);
  }
  return out;
}

/**
 * Why these recipient fields cannot be sent, or null.
 *
 * The duplicate check is the load-bearing one, and it runs ACROSS the three
 * fields rather than within each. Somebody in both `to` and `bcc` would receive
 * two copies and be blind-copied on a message that already names them, which is
 * not a blind copy at all — it is a visible one plus a second delivery.
 */
export function recipientRefusal(input: {
  to: readonly MailParty[];
  cc: readonly MailParty[];
  bcc: readonly MailParty[];
}): string | null {
  if (input.to.length === 0 && input.cc.length === 0 && input.bcc.length === 0) {
    return "Choose at least one recipient.";
  }
  /* Cc or Bcc with an empty To is a real shape — a Bcc-only announcement is the
     usual way to mail a list without disclosing it — so only a total absence is
     refused above. */
  const seen = new Map<string, "To" | "Cc" | "Bcc">();
  const fields: [ReadonlyArray<MailParty>, "To" | "Cc" | "Bcc"][] = [
    [input.to, "To"],
    [input.cc, "Cc"],
    [input.bcc, "Bcc"],
  ];
  for (const [list, label] of fields) {
    for (const p of list) {
      const first = seen.get(p.address);
      if (first) {
        return first === label
          ? `${p.displayName} is in ${label} twice.`
          : `${p.displayName} is in both ${first} and ${label}. Remove one — a blind copy of somebody already named is not blind.`;
      }
      seen.set(p.address, label);
    }
  }
  return null;
}
