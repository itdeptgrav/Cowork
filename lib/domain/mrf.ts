/**
 * MRF — Material Request Form.
 *
 * A requester asks the store for materials; it routes to their reporting
 * manager to approve or reject; an approved request is handed on to the store.
 * This is the cowork-facing slice — request and approval. Store issue/return and
 * live stock are a separate concern and are not modelled here.
 */

import type { EmployeeId } from "./identity";

export type MrfRequestType = "uses_based" | "time_based";
export type MrfPriority = "low" | "normal" | "high" | "urgent";

/** Request-level lifecycle. Store-side downstream states collapse to `approved`.
 *
 * `approved` means "with the store" — and a request reaches the store as soon
 * as ONE of its items is approved, while others may still be waiting. How far
 * the manager has got is `MrfApprovalStatus`, not this. */
export type MrfStatus = "pending" | "approved" | "rejected" | "cancelled";

/**
 * The manager's decisions on a request, rolled up from its items.
 *
 *   awaiting             nothing decided yet
 *   partially_processed  some items decided, some still waiting
 *   approved             every item approved in full
 *   partially_approved   all decided; some rejected, or approved for less
 *   rejected             every item rejected
 *   cancelled            withdrawn while items still waited
 */
export type MrfApprovalStatus =
  | "awaiting"
  | "partially_processed"
  | "approved"
  | "partially_approved"
  | "rejected"
  | "cancelled";

/** The manager's decision on one item. */
export type MrfItemDecision = "pending" | "approved" | "rejected";

/**
 * What the manager decided about one item, and who, when and why.
 *
 * Approving LESS than was asked is an approval: `approvedQty` is what the store
 * will supply and `rejectedQty` the part that was refused, with `reason`.
 */
export interface MrfItemApproval {
  decision: MrfItemDecision;
  /** What the requester asked for — kept when the approved quantity is less. */
  requestedQty: number;
  approvedQty: number;
  rejectedQty: number;
  reason: string | null;
  decidedByName: string | null;
  decidedById: string | null;
  decidedAt: string | null;
  /** True when no manager was involved (auto-forwarded, raised by the store). */
  automatic: boolean;
}

/** Item-level lifecycle, including the store's issue/return states (read-only). */
export type MrfItemStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "partially_issued"
  | "issued"
  | "partially_returned"
  | "returned"
  | "overdue"
  | "unfulfilled";

export type MrfAvailability =
  | "unreviewed"
  | "available"
  | "partial"
  | "not_available"
  | "alternative";

export interface MrfItem {
  id: string;
  name: string;
  sku: string | null;
  /** True when typed free-hand — not in the catalogue yet. */
  isUnmatched: boolean;
  requestedQty: number;
  unit: string;
  description: string | null;
  status: MrfItemStatus;
  /** Store progress, read-only here (the store app sets these). */
  issuedQty?: number;
  returnedQty?: number;
  availability?: MrfAvailability;
  availableQty?: number | null;
  availabilityNote?: string | null;
  /** Set when the line was picked from the catalogue rather than typed. */
  rawItemId?: string | null;
  variantId?: string | null;
  variantCombination?: string[];
  /** Reference photos attached to the line. */
  images?: MrfImage[];
  /** The manager's decision on this item. Absent from an older backend; read
   * it through `itemApprovalOf`, which falls back to `status`. */
  approval?: MrfItemApproval;
}

export interface MrfImage {
  url: string;
  name: string | null;
  /** The Drive file id — load-bearing for rendering reliably (see DriveImage);
   * absent for an image attached before the uploader moved off Cloudinary. */
  fileId?: string | null;
}

/** One stock variant of a catalogue item — e.g. a colour — with its stock. */
export interface RawItemVariant {
  id: string;
  combination: string[];
  /** Stock on hand, in the item's base unit. */
  quantity: number;
  sku: string | null;
}

/** One catalogue item a search returns, with its variants and stock. */
export interface RawItemHit {
  id: string;
  name: string;
  sku: string | null;
  baseUnit: string;
  /** Total stock on hand, in the base unit. */
  quantity: number;
  /** Units the requester may pick — the base unit plus any conversions. */
  units: string[];
  variants: RawItemVariant[];
}

export interface MrfEvent {
  at: string;
  action: string;
  actorName: string;
  detail: string | null;
}

export interface MrfRequest {
  organisationId: string;
  id: string;
  mrfNumber: string;
  requesterId: EmployeeId;
  requesterName: string;
  requesterDepartment: string | null;
  requestType: MrfRequestType;
  priority: MrfPriority;
  reason: string;
  neededBy: string | null;
  /** Return date — time-based requests only. */
  deadline: string | null;
  status: MrfStatus;
  /** How far the manager has got, item by item. Absent from an older backend;
   * read it through `approvalStatusOf`. */
  approvalStatus?: MrfApprovalStatus;
  /** The reporting manager who approves; null means it auto-forwarded. */
  approverId: EmployeeId | null;
  approverName: string | null;
  /** True when no manager resolved and the request skipped approval. */
  autoForwarded: boolean;
  rejectionNote: string | null;
  /** A note the store left on the request, where any. */
  storeNote?: string | null;
  items: MrfItem[];
  history: MrfEvent[];
  createdAt: string;
  updatedAt: string;
}

/** One message on a request's thread. The store, requester and approver share it. */
export interface MrfChatMessage {
  id: string;
  mrfId: string;
  /** Null for a system line. */
  senderId: EmployeeId | null;
  senderName: string;
  senderRole: "employee" | "tl" | "store" | "system";
  body: string;
  isSystem: boolean;
  createdAt: string;
}
