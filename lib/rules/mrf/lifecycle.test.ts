import assert from "node:assert/strict";
import { test } from "node:test";
import {
  canCancelMrf,
  canDecideMrf,
  mrfApprovalStats,
  mrfStats,
  validateNewMrf,
  type NewMrfInput,
} from "./lifecycle.ts";
import type { MrfRequest } from "../../domain/mrf.ts";

function request(over: Partial<MrfRequest> = {}): MrfRequest {
  return {
    organisationId: "org-1",
    id: "mrf-1",
    mrfNumber: "MRF-0001",
    requesterId: "e-02",
    requesterName: "Sam",
    requesterDepartment: null,
    requestType: "uses_based",
    priority: "normal",
    reason: "Restock",
    neededBy: null,
    deadline: null,
    status: "pending",
    approverId: "e-01",
    approverName: "Lee",
    autoForwarded: false,
    rejectionNote: null,
    items: [],
    history: [],
    createdAt: "2026-08-01",
    updatedAt: "2026-08-01",
    ...over,
  };
}

const input = (over: Partial<NewMrfInput> = {}): NewMrfInput => ({
  requestType: "uses_based",
  reason: "Restock",
  items: [{ name: "Bolts", requestedQty: 10, unit: "pcs" }],
  ...over,
});

test("the requester can withdraw only while pending", () => {
  assert.equal(canCancelMrf(request({ status: "pending" }), "e-02"), true);
  assert.equal(canCancelMrf(request({ status: "rejected" }), "e-02"), false);
  assert.equal(canCancelMrf(request({ status: "cancelled" }), "e-02"), false);
  assert.equal(canCancelMrf(request(), "e-99"), false); // not the requester
});

test("an APPROVED request can no longer be withdrawn", () => {
  /* **This assertion was inverted, and it encoded the bug.** The test read
     "pending or approved" while the function's own comment said "only while
     nothing downstream has acted" — and `approved` is exactly the state where
     the approver HAS acted and the store owns the request.

     It also covers everything after approval, so a request reading
     "Part-issued · Issued 400 of 570" still offered Withdraw. A requester could
     retract stock that had already been picked and handed over, and nothing in
     the ledger would have known. */
  assert.equal(canCancelMrf(request({ status: "approved" }), "e-02"), false);
});

test("only the approver decides, and only while pending", () => {
  assert.equal(canDecideMrf(request(), "e-01"), true);
  assert.equal(canDecideMrf(request(), "e-02"), false); // requester, not approver
  assert.equal(canDecideMrf(request({ status: "approved" }), "e-01"), false);
});

test("a request needs a reason and at least one item", () => {
  assert.equal(validateNewMrf(input({ reason: "  " })).ok, false);
  assert.equal(validateNewMrf(input({ items: [] })).ok, false);
});

test("a time-based request needs a return date", () => {
  const r = validateNewMrf(input({ requestType: "time_based" }));
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.field, "deadline");
});

test("an item needs a name, a unit and a positive quantity", () => {
  assert.equal(
    validateNewMrf(input({ items: [{ name: "", requestedQty: 1, unit: "pcs" }] })).ok,
    false,
  );
  assert.equal(
    validateNewMrf(input({ items: [{ name: "X", requestedQty: 0, unit: "pcs" }] })).ok,
    false,
  );
  assert.equal(validateNewMrf(input()).ok, true);
});

test("stats count by status", () => {
  const s = mrfStats([
    request({ status: "pending" }),
    request({ status: "approved" }),
    request({ status: "rejected" }),
    request({ status: "cancelled" }),
  ]);
  assert.deepEqual(s, { total: 4, pending: 1, approved: 1, closed: 2 });
});

test("approval stats count the approver's queue", () => {
  const s = mrfApprovalStats([
    request({ status: "pending" }),
    request({ status: "pending" }),
    request({ status: "approved" }),
    request({ status: "rejected" }),
  ]);
  assert.deepEqual(s, { awaiting: 2, approved: 1, rejected: 1, total: 4 });
});
