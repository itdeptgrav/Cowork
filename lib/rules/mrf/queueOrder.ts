import type { MrfPriority, MrfRequest } from "@/lib/domain/mrf";

/**
 * How an approver's queue is ordered and searched (10 Nov 2026).
 *
 * The engine sends the queue urgent-first, then newest. With old urgent
 * requests still waiting, a NEW normal request landed below all of them —
 * Rishee Ray's queue had MRF/2026-27/0196 fourteenth of thirty-two, under
 * thirteen urgent requests going back to 0009, and it read as "not showing".
 * So the queue now opens newest first (urgent ones keep their Urgent chip),
 * "Urgent first" is one click away, and a search finds any request directly.
 *
 * Done here rather than by the engine because the app now holds the whole
 * queue (`#allMrfPages`), so re-ordering and filtering it costs nothing.
 */

export type MrfQueueSort = "newest" | "urgent";

const RANK: Record<MrfPriority, number> = { urgent: 3, high: 2, normal: 1, low: 0 };

const byNewest = (a: MrfRequest, b: MrfRequest) => b.createdAt.localeCompare(a.createdAt);

/** Does a request match what the approver typed? Number, requester, reason or an item. */
export function matchesQueueSearch(m: MrfRequest, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const fields = [
    m.mrfNumber,
    m.requesterName,
    m.requesterDepartment ?? "",
    m.reason,
    ...m.items.map((i) => i.name),
  ];
  return fields.some((f) => String(f ?? "").toLowerCase().includes(q));
}

export function arrangeApprovalQueue(
  requests: readonly MrfRequest[],
  { sort, query }: { sort: MrfQueueSort; query: string },
): MrfRequest[] {
  const shown = requests.filter((m) => matchesQueueSearch(m, query));
  return sort === "urgent"
    ? shown.sort((a, b) => RANK[b.priority] - RANK[a.priority] || byNewest(a, b))
    : shown.sort(byNewest);
}
