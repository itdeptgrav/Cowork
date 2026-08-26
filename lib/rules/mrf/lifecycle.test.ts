import assert from "node:assert/strict";
import { test } from "node:test";
import {
  canCancelMrf,
  canDecideMrf,
  mrfApprovalStats,
  mrfStats,
  readMrfApprovalStats,
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

test("served counts rename pending to awaiting", () => {
  assert.deepEqual(
    readMrfApprovalStats({ total: 9, pending: 4, approved: 3, rejected: 2 }),
    { awaiting: 4, approved: 3, rejected: 2, total: 9 },
  );
});

test("served counts survive an aggregate that omits a status", () => {
  /* A queue that has never had a rejection: the key is absent, not zero. */
  assert.deepEqual(readMrfApprovalStats({ total: 4, pending: 4 }), {
    awaiting: 4,
    approved: 0,
    rejected: 0,
    total: 4,
  });
});

test("served counts ignore keys the queue counts do not use", () => {
  /* The aggregate also carries `issued`, which belongs to the store, not to
     the approver's queue. */
  const s = readMrfApprovalStats({
    total: 5,
    pending: 1,
    approved: 3,
    rejected: 1,
    issued: 2,
  });
  assert.deepEqual(s, { awaiting: 1, approved: 3, rejected: 1, total: 5 });
});

test("served counts are refused when the payload is not counts", () => {
  for (const raw of [null, undefined, "12", 12, [], {}, { pending: 3 }, { total: 3 }])
    assert.equal(readMrfApprovalStats(raw), null, JSON.stringify(raw) ?? "undefined");
});

test("served counts are refused when a count is not a whole count", () => {
  /* Broken, not small — falling back to counting the page beats rendering it. */
  assert.equal(readMrfApprovalStats({ total: 4, pending: -1 }), null);
  assert.equal(readMrfApprovalStats({ total: 4, pending: 1.5 }), null);
  assert.equal(readMrfApprovalStats({ total: 4, pending: "2" }), null);
  assert.equal(readMrfApprovalStats({ total: NaN, pending: 2 }), null);
});

test("a served zero is kept, not treated as missing", () => {
  /* The difference the fallback must not swallow: an empty queue the server
     counted, against a server that sent nothing. */
  assert.deepEqual(readMrfApprovalStats({ total: 0, pending: 0 }), {
    awaiting: 0,
    approved: 0,
    rejected: 0,
    total: 0,
  });
});
