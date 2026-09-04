import type { MailMessage, MailParty } from "@/lib/domain";

export type ReplyMode = "reply" | "replyAll" | "forward";

/** Drop repeat addresses, keeping the first — case-insensitive on the address,
 *  which is the identity that decides "the same person" across fields. */
function dedupeByAddress(parties: MailParty[]): MailParty[] {
  const seen = new Set<string>();
  const out: MailParty[] = [];
  for (const p of parties) {
    const k = p.address.toLowerCase();
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(p);
  }
  return out;
}

/**
 * The To/Cc a reply pre-fills.
 *
 * The rules, stated once so both Reply and Reply All read from the same place:
 *
 *  · You never reply to YOURSELF — the viewer is removed from every field, so a
 *    Reply All to a thread you are on does not address you.
 *  · Bcc is NEVER carried. The blind copies on the message you are replying to
 *    are not yours to re-disclose, and on anything but your own sent message
 *    they were already redacted away before this ran.
 *  · Reply goes to the sender, and KEEPS the visible Cc — dropping it silently
 *    removes people from a conversation they were part of.
 *  · Reply All additionally puts everyone who was in To onto the reply, deduped
 *    against the sender and against Cc.
 *  · Forward pre-fills nobody; the point is choosing a new recipient.
 */
export function replySeed(
  mode: ReplyMode,
  replyTo: Pick<MailMessage, "from" | "to" | "cc"> | undefined,
  viewerId: string | null | undefined,
): { to: MailParty[]; cc: MailParty[] } {
  if (!replyTo || mode === "forward") return { to: [], cc: [] };
  const notMe = (p: MailParty) =>
    !(p.employeeId && viewerId && p.employeeId === viewerId);

  if (mode === "reply") {
    return {
      to: dedupeByAddress([replyTo.from].filter(notMe)),
      cc: dedupeByAddress(replyTo.cc.filter(notMe)),
    };
  }
  // replyAll
  const to = dedupeByAddress([replyTo.from, ...replyTo.to].filter(notMe));
  const inTo = new Set(to.map((p) => p.address.toLowerCase()));
  const cc = dedupeByAddress(replyTo.cc.filter(notMe)).filter(
    (p) => !inTo.has(p.address.toLowerCase()),
  );
  return { to, cc };
}
