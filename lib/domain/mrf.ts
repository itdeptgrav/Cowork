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

/** Request-level lifecycle. Store-side downstream states collapse to `approved`. */
export type MrfStatus = "pending" | "approved" | "rejected" | "cancelled";

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
}

export interface MrfImage {
  url: string;
  name: string | null;
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
