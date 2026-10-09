/**
 * MRF lifecycle rules — pure, so the same checks run in the UI and the store.
 *
 * The cowork-side flow is small: a request is created PENDING (or auto-approved
 * when no manager resolves), the approver approves or rejects it, and the
 * requester may withdraw it while it is still open.
 */

import type {
  MrfApprovalStatus,
  MrfImage,
  MrfItem,
  MrfItemApproval,
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

/**
 * Only the resolved approver decides, and only while something is still
 * waiting.
 *
 * Not "while the request is pending": a request reaches the store the moment
 * its first item is approved, and its other items are still the approver's to
 * decide. A request carrying no items (an older payload) falls back to its
 * status.
 */
export function canDecideMrf(request: MrfRequest, viewerId: string): boolean {
  if (request.approverId !== viewerId) return false;
  if (!request.items.length) return request.status === "pending";
  return awaitingItems(request).length > 0;
}

/* ── Item-wise approval ─────────────────────────────────────────────────── */

const CLOSED: ReadonlySet<MrfRequest["status"]> = new Set(["rejected", "cancelled"]);

/**
 * The manager's decision on one item.
 *
 * The server sends it on every item. An older backend does not, and then the
 * item's own status is the best evidence: still `pending` is undecided,
 * `rejected` was refused, anything further along was approved in full.
 */
export function itemApprovalOf(item: MrfItem, request: MrfRequest): MrfItemApproval {
  if (item.approval) return item.approval;
  const decision =
    item.status === "pending"
      ? "pending"
      : item.status === "rejected"
        ? "rejected"
        : "approved";
  return {
    decision,
    requestedQty: item.requestedQty,
    approvedQty: decision === "approved" ? item.requestedQty : 0,
    rejectedQty: decision === "rejected" ? item.requestedQty : 0,
    reason: decision === "rejected" ? request.rejectionNote : null,
    decidedByName: decision === "pending" ? null : request.approverName,
    decidedById: null,
    decidedAt: null,
    automatic: request.autoForwarded,
  };
}

/** Items the approver can still decide — none on a closed request. */
export function awaitingItems(request: MrfRequest): MrfItem[] {
  if (CLOSED.has(request.status)) return [];
  return request.items.filter(
    (it) => itemApprovalOf(it, request).decision === "pending",
  );
}

/** Items that have been decided, in the order they appear on the request. */
export function decidedItems(request: MrfRequest): MrfItem[] {
  return request.items.filter(
    (it) => itemApprovalOf(it, request).decision !== "pending",
  );
}

/**
 * The request's approval status — the server's, or derived from its items by
 * the same rules the server uses (services/mrfItemApproval.service.js).
 */
export function approvalStatusOf(request: MrfRequest): MrfApprovalStatus {
  if (request.approvalStatus) return request.approvalStatus;
  const lines = request.items.map((it) => itemApprovalOf(it, request));
  if (!lines.length) {
    if (request.status === "pending") return "awaiting";
    if (request.status === "rejected") return "rejected";
    if (request.status === "cancelled") return "cancelled";
    return "approved";
  }
  const pending = lines.filter((l) => l.decision === "pending").length;
  const approved = lines.filter((l) => l.decision === "approved").length;
  const cut = lines.some((l) => l.rejectedQty > 0);
  if (request.status === "cancelled" && pending > 0) return "cancelled";
  if (pending === lines.length) return "awaiting";
  if (pending > 0) return "partially_processed";
  if (approved === 0) return "rejected";
  return cut ? "partially_approved" : "approved";
}

/** Words for an approval status, as both the requester and the manager read them. */
export function approvalStatusLabel(status: MrfApprovalStatus): string {
  switch (status) {
    case "awaiting":
      return "Awaiting approval";
    case "partially_processed":
      return "Partially processed";
    case "approved":
      return "Approved — with the store";
    case "partially_approved":
      return "Partially approved";
    case "rejected":
      return "Rejected";
    case "cancelled":
      return "Withdrawn";
  }
}

/** The one label a request card shows: withdrawn wins, then the decisions. */
export function mrfRequestLabel(request: MrfRequest): string {
  if (request.status === "cancelled") return "Withdrawn";
  return approvalStatusLabel(approvalStatusOf(request));
}

const fmtQty = (n: number): string =>
  String(Math.round((Number(n) || 0) * 1000) / 1000);

/** Short words for one item's decision — "Approved 10 of 12 Pcs". */
export function itemDecisionLabel(a: MrfItemApproval, unit: string): string {
  if (a.decision === "pending") return "Awaiting approval";
  if (a.decision === "rejected") return "Rejected";
  if (a.automatic) return "Sent to the store";
  return a.rejectedQty > 0
    ? `Approved ${fmtQty(a.approvedQty)} of ${fmtQty(a.requestedQty)} ${unit}`.trim()
    : "Approved";
}

/** One item's draft decision on the approver's screen, before it is sent. */
export interface MrfItemDecisionDraft {
  itemId: string;
  decision: "approved" | "rejected";
  /** Null or absent means "the full quantity". */
  approvedQty?: number | null;
  reason?: string;
}

/** What is sent for one item. */
export interface MrfItemDecisionInput {
  itemId: string;
  decision: "approved" | "rejected";
  approvedQty?: number;
  reason?: string;
}

export type MrfDecisionValidation =
  | { ok: true; decisions: MrfItemDecisionInput[] }
  | { ok: false; itemId: string | null; field: string; message: string };

export const MRF_REASON_MAX = 500;

/**
 * Check the approver's drafts the way the server will, so Submit can say what
 * is missing before anything is sent. The server checks all of it again.
 *
 * A rejection needs a reason; so does approving less than was asked — in both
 * the requester is refused something and is told why. A shared reason (from
 * "Reject all") covers any rejected item without its own.
 */
export function validateItemDecisions(
  request: MrfRequest,
  drafts: MrfItemDecisionDraft[],
  sharedReason = "",
): MrfDecisionValidation {
  if (!drafts.length)
    return {
      ok: false,
      itemId: null,
      field: "decisions",
      message: "Choose Approve or Reject for at least one item.",
    };
  const waiting = new Map(awaitingItems(request).map((it) => [it.id, it]));
  const seen = new Set<string>();
  const out: MrfItemDecisionInput[] = [];
  for (const d of drafts) {
    const item = waiting.get(d.itemId);
    if (!item)
      return {
        ok: false,
        itemId: d.itemId,
        field: "decision",
        message: "This item has already been decided.",
      };
    if (seen.has(d.itemId))
      return {
        ok: false,
        itemId: d.itemId,
        field: "decision",
        message: `“${item.name}” is listed twice.`,
      };
    seen.add(d.itemId);

    /* The shared reason is for REJECTED items only — an approved item keeps
       just what was typed against it. */
    const own = (d.reason ?? "").trim();
    const reason = d.decision === "rejected" ? own || sharedReason.trim() : own;
    if (reason.length > MRF_REASON_MAX)
      return {
        ok: false,
        itemId: d.itemId,
        field: "reason",
        message: `Keep the reason for “${item.name}” under ${MRF_REASON_MAX} characters.`,
      };

    if (d.decision === "rejected") {
      if (!reason)
        return {
          ok: false,
          itemId: d.itemId,
          field: "reason",
          message: `Give a reason for rejecting “${item.name}” — the requester sees it.`,
        };
      out.push({ itemId: d.itemId, decision: "rejected", reason });
      continue;
    }

    const asked = itemApprovalOf(item, request).requestedQty;
    const q = d.approvedQty;
    if (q === null || q === undefined) {
      out.push({ itemId: d.itemId, decision: "approved", ...(reason ? { reason } : {}) });
      continue;
    }
    if (!Number.isFinite(q))
      return {
        ok: false,
        itemId: d.itemId,
        field: "approvedQty",
        message: `Enter a number for “${item.name}”.`,
      };
    if (q <= 0)
      return {
        ok: false,
        itemId: d.itemId,
        field: "approvedQty",
        message: `Approve more than 0 of “${item.name}”, or reject it instead.`,
      };
    if (q > asked + 1e-6)
      return {
        ok: false,
        itemId: d.itemId,
        field: "approvedQty",
        message: `At most ${fmtQty(asked)} ${item.unit} of “${item.name}” can be approved — that is what was asked for.`,
      };
    if (q < asked - 1e-6 && !reason)
      return {
        ok: false,
        itemId: d.itemId,
        field: "reason",
        message: `Say why only ${fmtQty(q)} of ${fmtQty(asked)} ${item.unit} of “${item.name}” is approved — the requester sees it.`,
      };
    out.push({
      itemId: d.itemId,
      decision: "approved",
      approvedQty: q,
      ...(reason ? { reason } : {}),
    });
  }
  return { ok: true, decisions: out };
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

/**
 * The requester's counts, by the manager's decisions.
 *
 * `pending` is "still has an item waiting" — a request three of whose five
 * items reached the store is still pending for the other two. `approved` is
 * approved in full; `partiallyApproved` had something refused or cut.
 */
/* ── The new-request checklist ─────────────────────────────────────────────── */

/** An item on the new-request form, as typed — quantity is still a string. */
export interface MrfDraftItemInput {
  name: string;
  requestedQty: string | number;
  unit: string;
}

/** What one draft item still lacks, in the order the person fills it in. */
export type MrfDraftGap = "name" | "quantity" | "unit";

export function draftItemGaps(item: MrfDraftItemInput): MrfDraftGap[] {
  const gaps: MrfDraftGap[] = [];
  if (!item.name.trim()) gaps.push("name");
  const qty = Number(item.requestedQty);
  if (String(item.requestedQty).trim() === "" || !Number.isFinite(qty) || qty <= 0)
    gaps.push("quantity");
  if (!item.unit.trim()) gaps.push("unit");
  return gaps;
}

const GAP_WORDS: Record<MrfDraftGap, string> = {
  name: "a name",
  quantity: "a quantity",
  unit: "a unit",
};

/** "Needs a quantity and a unit" — or null when the item is complete. */
export function draftItemProblem(item: MrfDraftItemInput): string | null {
  const gaps = draftItemGaps(item).map((g) => GAP_WORDS[g]);
  if (!gaps.length) return null;
  const words =
    gaps.length === 1 ? gaps[0] : `${gaps.slice(0, -1).join(", ")} and ${gaps[gaps.length - 1]}`;
  return `Needs ${words}`;
}

export interface MrfNewDraft {
  requestType: MrfRequestType;
  reason: string;
  /** yyyy-mm-dd or "" */
  neededBy: string;
  /** yyyy-mm-dd or "" — only asked for a borrowed request. */
  deadline: string;
  items: MrfDraftItemInput[];
}

/** One line of "Ready to send?". `optional` lines never block sending. */
export interface MrfChecklistLine {
  /** Stable key — also says which field a click on the line should focus. */
  key: string;
  label: string;
  state: "done" | "missing" | "optional";
  /** For an item line, its position on the form. */
  itemIndex?: number;
}

export interface MrfChecklist {
  lines: MrfChecklistLine[];
  missing: number;
  ready: boolean;
  /** Section completeness, for the step markers on the form. */
  purposeDone: boolean;
  itemsDone: boolean;
}

/**
 * Everything the new-request form still needs, in the order it is filled in.
 *
 * The same rules `validateNewMrf` applies on send — a reason, a return date for
 * a borrowed request, at least one item, and a name, quantity above zero and
 * unit on every item — shown as they are met, so nobody presses Send to find
 * out what was missing. `formatDate` words the dates; the rule stays pure.
 */
export function newMrfChecklist(
  d: MrfNewDraft,
  formatDate: (iso: string) => string = (x) => x,
): MrfChecklist {
  const lines: MrfChecklistLine[] = [];
  const reasonOk = !!d.reason.trim();
  lines.push({
    key: "reason",
    label: reasonOk ? "Reason given" : "Say what it\u2019s for",
    state: reasonOk ? "done" : "missing",
  });
  lines.push({
    key: "type",
    label: d.requestType === "time_based" ? "Borrowed \u2014 returned later" : "Consumed \u2014 used up",
    state: "done",
  });
  let returnOk = true;
  if (d.requestType === "time_based") {
    returnOk = !!d.deadline;
    lines.push({
      key: "deadline",
      label: returnOk ? `Return by ${formatDate(d.deadline)}` : "Pick a return date",
      state: returnOk ? "done" : "missing",
    });
  }
  lines.push({
    key: "neededBy",
    label: d.neededBy ? `Needed by ${formatDate(d.neededBy)}` : "Needed-by date (optional)",
    state: d.neededBy ? "done" : "optional",
  });

  let itemsOk = d.items.length > 0;
  if (!d.items.length) {
    lines.push({ key: "items", label: "Add at least one item", state: "missing" });
  } else {
    d.items.forEach((it, i) => {
      const problem = draftItemProblem(it);
      if (problem) itemsOk = false;
      const name = it.name.trim() || `Item ${i + 1}`;
      lines.push({
        key: `item-${i}`,
        itemIndex: i,
        label: problem
          ? `${name} \u2014 ${problem.charAt(0).toLowerCase()}${problem.slice(1)}`
          : `${name} \u00b7 ${String(it.requestedQty).trim()} ${it.unit.trim()}`,
        state: problem ? "missing" : "done",
      });
    });
  }

  const missing = lines.filter((l) => l.state === "missing").length;
  return {
    lines,
    missing,
    ready: missing === 0,
    purposeDone: reasonOk && returnOk,
    itemsDone: itemsOk,
  };
}

export interface MrfStats {
  total: number;
  pending: number;
  approved: number;
  partiallyApproved: number;
  closed: number;
}

const isWaiting = (r: MrfRequest) => {
  const s = approvalStatusOf(r);
  return (s === "awaiting" || s === "partially_processed") && !CLOSED.has(r.status);
};

export function mrfStats(requests: MrfRequest[]): MrfStats {
  return {
    total: requests.length,
    pending: requests.filter(isWaiting).length,
    approved: requests.filter((r) => approvalStatusOf(r) === "approved").length,
    partiallyApproved: requests.filter(
      (r) => approvalStatusOf(r) === "partially_approved",
    ).length,
    closed: requests.filter(
      (r) => r.status === "rejected" || r.status === "cancelled",
    ).length,
  };
}

/**
 * The requester's counts as the server counted them, across every request —
 * not just the page the list holds. Null for a backend that does not send
 * them; the caller then counts the page.
 */
export function readMrfStats(raw: unknown): MrfStats | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const count = (v: unknown): number | null =>
    typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : null;
  const total = count(r.total);
  const pending = count(r.pending);
  /* `partiallyApproved` is what says this backend counts by decisions. An
     older one sends `pending`/`approved` by STATUS, where "approved" includes
     a request half of which is still waiting — counting the page is closer. */
  const partiallyApproved = count(r.partiallyApproved);
  if (total === null || pending === null || partiallyApproved === null) return null;
  return {
    total,
    pending,
    approved: count(r.approved) ?? 0,
    partiallyApproved,
    closed: (count(r.rejected) ?? 0) + (count(r.cancelled) ?? 0),
  };
}

/** The approver's queue counts. */
export interface MrfApprovalStats {
  awaiting: number;
  approved: number;
  partiallyApproved: number;
  rejected: number;
  total: number;
}

export function mrfApprovalStats(requests: MrfRequest[]): MrfApprovalStats {
  return {
    awaiting: requests.filter(isWaiting).length,
    approved: requests.filter((r) => approvalStatusOf(r) === "approved").length,
    partiallyApproved: requests.filter(
      (r) => approvalStatusOf(r) === "partially_approved",
    ).length,
    rejected: requests.filter((r) => approvalStatusOf(r) === "rejected").length,
    total: requests.length,
  };
}

/** The approver's queue filter. "pending" is everything with an item still waiting. */
export type MrfApprovalFilter =
  | "pending"
  | "approved"
  | "partially_approved"
  | "rejected"
  | "all";

/** Does a request belong under a queue filter? (The prototype filters with this.) */
export function matchesApprovalFilter(
  request: MrfRequest,
  filter: MrfApprovalFilter,
): boolean {
  if (filter === "all") return true;
  if (filter === "pending") return isWaiting(request);
  return approvalStatusOf(request) === filter;
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
    partiallyApproved: count(r.partiallyApproved) ?? 0,
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
