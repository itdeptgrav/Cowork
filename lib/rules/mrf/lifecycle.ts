/**
 * MRF lifecycle rules — pure, so the same checks run in the UI and the store.
 *
 * The cowork-side flow is small: a request is created PENDING (or auto-approved
 * when no manager resolves), the approver approves or rejects it, and the
 * requester may withdraw it while it is still open.
 */

import type {
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

/** A requester may withdraw only while nothing downstream has acted. */
export function canCancelMrf(request: MrfRequest, viewerId: string): boolean {
  return (
    request.requesterId === viewerId &&
    (request.status === "pending" || request.status === "approved")
  );
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
