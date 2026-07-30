import type { MailParty } from "@/lib/domain";

/**
 * Which parties on an inbound message are the person who synced it.
 *
 * Extracted so the rule is testable. It exists because of a silent failure:
 * visibility is decided by `employeeId`, an imported party only gains one by
 * matching, and inbound Gmail is addressed to the CONNECTED MAILBOX
 * (`GmailConnection.email`) — not to `Employee.email`. When those differed,
 * every synced message imported cleanly and was then invisible to its own
 * recipient. The sync said "12 new messages" and the inbox stayed empty.
 *
 * The mailbox address is checked BEFORE the directory, so a connected Gmail
 * that also appears in the directory still resolves to the right person.
 */
export function resolveInboundParty(
  party: MailParty,
  ctx: {
    mailboxAddress: string;
    viewerEmployeeId: string;
    viewerDisplayName: string;
    directory: Map<string, { id: string; email: string; displayName: string }>;
  },
): MailParty {
  const address = party.address.toLowerCase();
  const mailbox = ctx.mailboxAddress.trim().toLowerCase();

  if (mailbox && address === mailbox)
    return {
      kind: "employee",
      employeeId: ctx.viewerEmployeeId,
      address: party.address,
      displayName: ctx.viewerDisplayName,
    };

  const emp = ctx.directory.get(address);
  return emp
    ? {
        kind: "employee",
        employeeId: emp.id,
        address: emp.email,
        displayName: emp.displayName,
      }
    : party;
}

/** The visibility rule the mailbox applies. Mirrors `#mailVisible`. */
export function reachesViewer(
  message: { from: MailParty; to: MailParty[]; cc: MailParty[] },
  viewerEmployeeId: string,
): boolean {
  if (message.from.employeeId === viewerEmployeeId) return true;
  return [...message.to, ...message.cc].some(
    (p) => p.employeeId === viewerEmployeeId,
  );
}
