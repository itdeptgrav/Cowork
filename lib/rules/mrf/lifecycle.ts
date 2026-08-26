/**
 * MRF lifecycle rules — pure, so the same checks run in the UI and the store.
 *
 * The cowork-side flow is small: a request is created PENDING (or auto-approved
 * when no manager resolves), the approver approves or rejects it, and the
 * requester may withdraw it while it is still open.
 */

import type {
  MrfImage,
  MrfPriority,
  MrfRequest,
  MrfRequestType,
} from "../../domain/mrf.ts";

export interface NewMrfItemInput {
  name: string;
  sku?: string | null;
  isUnmatched?: boolean;
  requestedQty: number;
  unit: string;
  description?: string | null;
  /** Set when the line was chosen from the catalogue. */
  rawItemId?: string | null;
  variantId?: string | null;
  variantCombination?: string[];
  /** Reference photos, and (for a new/uncatalogued item) a category. */
  images?: MrfImage[];
  category?: string | null;
}

export interface NewMrfInput {
  requestType: MrfRequestType;
  priority?: MrfPriority;
  reason: string;
  neededBy?: string | null;
  deadline?: string | null;
  items: NewMrfItemInput[];
}

export type MrfValidation =
  | { ok: true }
  | { ok: false; field: string; message: string };

/**
 * A requester may withdraw only while nothing downstream has acted.
 *
 * **`approved` used to count, and it should not have.** The comment above has
 * always said "nothing downstream has acted", but the condition allowed
 * `approved` — which is precisely the state meaning the approver HAS acted and
 * the store now owns the request. Worse, `approved` covers everything after
 * that too: a request showing "Part-issued · Issued 400 of 570" was still
 * offering Withdraw, so a requester could retract something the store had
 * already picked, counted and handed over. Nothing in the stock ledger would
 * have known.
 *
 * Pending is the whole window. Once somebody else has committed to the
 * request, cancelling it is a conversation with the store — the Chat on the
 * same row — rather than a button.
 */
export function canCancelMrf(request: MrfRequest, viewerId: string): boolean {
  return request.requesterId === viewerId && request.status === "pending";
}

/** Only the resolved approver decides, and only while it is still pending. */
export function canDecideMrf(request: MrfRequest, viewerId: string): boolean {
  return request.status === "pending" && request.approverId === viewerId;
}

export function validateNewMrf(input: NewMrfInput): MrfValidation {
  if (!input.reason || !input.reason.trim())
    return { ok: false, field: "reason", message: "Give a reason for the request." };

  if (!input.items || input.items.length === 0)
    return { ok: false, field: "items", message: "Add at least one item." };

  if (input.requestType === "time_based" && !input.deadline)
    return {
      ok: false,
      field: "deadline",
      message: "A borrowed (time-based) request needs a return date.",
    };

  for (const [i, item] of input.items.entries()) {
    if (!item.name || !item.name.trim())
      return { ok: false, field: `items.${i}.name`, message: "Every item needs a name." };
    if (!item.unit || !item.unit.trim())
      return { ok: false, field: `items.${i}.unit`, message: "Every item needs a unit." };
    if (!Number.isFinite(item.requestedQty) || item.requestedQty <= 0)
      return {
        ok: false,
        field: `items.${i}.requestedQty`,
        message: "Every item needs a quantity above zero.",
      };
  }
  return { ok: true };
}

export interface MrfStats {
  total: number;
  pending: number;
  approved: number;
  closed: number;
}

export function mrfStats(requests: MrfRequest[]): MrfStats {
  return {
    total: requests.length,
    pending: requests.filter((r) => r.status === "pending").length,
    approved: requests.filter((r) => r.status === "approved").length,
    closed: requests.filter(
      (r) => r.status === "rejected" || r.status === "cancelled",
    ).length,
  };
}

/** The approver's queue counts. */
export interface MrfApprovalStats {
  awaiting: number;
  approved: number;
  rejected: number;
  total: number;
}

export function mrfApprovalStats(requests: MrfRequest[]): MrfApprovalStats {
  return {
    awaiting: requests.filter((r) => r.status === "pending").length,
    approved: requests.filter((r) => r.status === "approved").length,
    rejected: requests.filter((r) => r.status === "rejected").length,
    total: requests.length,
  };
}

/**
 * The approver-queue counts as the server counted them.
 *
 * ## Why the list cannot be counted instead
 *
 * `mrfApprovalStats` answers "how many of *these* requests are awaiting me",
 * which is the right answer only when "these" is the whole queue. Over a list
 * fetched from the server it is the wrong question twice over: that list is
 * one page of at most twenty rows, and it has already been narrowed to the
 * status the reader picked from the Queue filter. Counting it says "0 approved"
 * to somebody filtering by Awaiting — not because they have approved nothing,
 * but because approved requests were never fetched — and caps a queue of
 * twenty-three at twenty.
 *
 * The badge on the Approvals tab is the sharpest case: it is read while the
 * reader is on another tab, precisely so they can decide whether to switch. A
 * number capped at the page size is a number that stops rising exactly when
 * the queue is worth switching for.
 *
 * The server runs its own aggregate across the whole queue, unfiltered and
 * unpaginated, and sends it alongside the page. This reads that.
 *
 * ## Why it can return null
 *
 * A backend that does not send counts is not an error — it is an older
 * deployment. Null lets the caller fall back to counting the page, which is
 * approximate but never zero. Reporting an empty queue to an approver who has
 * work waiting is the one failure worth going out of the way to avoid.
 */
export function readMrfApprovalStats(raw: unknown): MrfApprovalStats | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  /* Whole counts only. A negative or fractional count is a broken aggregate,
     not a small one, and falling back beats rendering it. */
  const count = (v: unknown): number | null =>
    typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : null;

  /* The server's vocabulary is the status name, `pending`; ours is the
     reader's word for it, `awaiting`. Renamed here so the difference stops at
     this boundary. */
  const awaiting = count(r.pending);
  const total = count(r.total);
  /* These two decide whether the payload is counts at all — without them there
     is nothing worth showing. The other two default, because a queue that has
     never had a rejection legitimately omits the key. */
  if (awaiting === null || total === null) return null;

  return {
    awaiting,
    approved: count(r.approved) ?? 0,
    rejected: count(r.rejected) ?? 0,
    total,
  };
}

/** A short, human label for a status. */
export function mrfStatusLabel(status: MrfRequest["status"]): string {
  switch (status) {
    case "pending":
      return "Awaiting approval";
    case "approved":
      return "Approved — with the store";
    case "rejected":
      return "Rejected";
    case "cancelled":
      return "Withdrawn";
  }
}
