import assert from "node:assert/strict";
import { test } from "node:test";
import {
  approvalStatusOf,
  awaitingItems,
  canCancelMrf,
  canDecideMrf,
  itemApprovalOf,
  itemDecisionLabel,
  matchesApprovalFilter,
  mrfApprovalStats,
  mrfRequestLabel,
  mrfStats,
  draftItemProblem,
  newMrfChecklist,
  readMrfApprovalStats,
  readMrfStats,
  validateItemDecisions,
  validateNewMrf,
  type NewMrfInput,
} from "./lifecycle.ts";
import type { MrfItem, MrfItemApproval, MrfRequest } from "../../domain/mrf.ts";

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
  assert.deepEqual(s, { total: 4, pending: 1, approved: 1, partiallyApproved: 0, closed: 2 });
});

test("approval stats count the approver's queue", () => {
  const s = mrfApprovalStats([
    request({ status: "pending" }),
    request({ status: "pending" }),
    request({ status: "approved" }),
    request({ status: "rejected" }),
  ]);
  assert.deepEqual(s, { awaiting: 2, approved: 1, partiallyApproved: 0, rejected: 1, total: 4 });
});

test("served counts rename pending to awaiting", () => {
  assert.deepEqual(
    readMrfApprovalStats({ total: 9, pending: 4, approved: 3, rejected: 2 }),
    { awaiting: 4, approved: 3, partiallyApproved: 0, rejected: 2, total: 9 },
  );
});

test("served counts survive an aggregate that omits a status", () => {
  /* A queue that has never had a rejection: the key is absent, not zero. */
  assert.deepEqual(readMrfApprovalStats({ total: 4, pending: 4 }), {
    awaiting: 4,
    approved: 0,
    partiallyApproved: 0,
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
  assert.deepEqual(s, { awaiting: 1, approved: 3, partiallyApproved: 0, rejected: 1, total: 5 });
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
    partiallyApproved: 0,
    rejected: 0,
    total: 0,
  });
});

/* ── Item-wise approval ───────────────────────────────────────────────────── */

let n = 0;
function item(over: Partial<MrfItem> = {}): MrfItem {
  n += 1;
  return {
    id: `i-${n}`,
    name: `Material ${n}`,
    sku: null,
    isUnmatched: false,
    requestedQty: 10,
    unit: "Pcs",
    description: null,
    status: "pending",
    ...over,
  };
}

const decision = (
  d: MrfItemApproval["decision"],
  over: Partial<MrfItemApproval> = {},
): MrfItemApproval => ({
  decision: d,
  requestedQty: 10,
  approvedQty: d === "approved" ? 10 : 0,
  rejectedQty: d === "rejected" ? 10 : 0,
  reason: d === "rejected" ? "Not needed" : null,
  decidedByName: d === "pending" ? null : "Rakesh",
  decidedById: null,
  decidedAt: d === "pending" ? null : "2026-10-09T10:00:00Z",
  automatic: false,
  ...over,
});

/** 5 items, A B D approved and C E rejected — the example in the brief. */
function fiveDecided(): MrfRequest {
  return request({
    status: "approved",
    items: [
      item({ status: "approved", approval: decision("approved") }),
      item({ status: "approved", approval: decision("approved") }),
      item({ status: "rejected", approval: decision("rejected") }),
      item({ status: "approved", approval: decision("approved") }),
      item({ status: "rejected", approval: decision("rejected", { reason: "Duplicate" }) }),
    ],
  });
}

test("3 approved and 2 rejected is PARTIALLY APPROVED, with every item's own outcome", () => {
  const r = fiveDecided();
  assert.equal(approvalStatusOf(r), "partially_approved");
  assert.equal(mrfRequestLabel(r), "Partially approved");
  assert.deepEqual(
    r.items.map((it) => itemApprovalOf(it, r).decision),
    ["approved", "approved", "rejected", "approved", "rejected"],
  );
  assert.equal(itemApprovalOf(r.items[4], r).reason, "Duplicate");
  assert.equal(awaitingItems(r).length, 0);
  assert.equal(canDecideMrf(r, "e-01"), false);
});

test("the approval status follows the decisions, not the store status", () => {
  const all = (d: MrfItemApproval["decision"], status: MrfRequest["status"]) =>
    request({ status, items: [item({ approval: decision(d) }), item({ approval: decision(d) })] });
  assert.equal(approvalStatusOf(all("approved", "approved")), "approved");
  assert.equal(approvalStatusOf(all("rejected", "rejected")), "rejected");
  assert.equal(approvalStatusOf(all("pending", "pending")), "awaiting");
  /* With the store already — one item approved — and one still waiting. */
  const mixed = request({
    status: "approved",
    items: [item({ approval: decision("approved") }), item({ approval: decision("pending") })],
  });
  assert.equal(approvalStatusOf(mixed), "partially_processed");
  assert.equal(mrfRequestLabel(mixed), "Partially processed");
  /* The server's word wins when it sends one. */
  assert.equal(approvalStatusOf({ ...mixed, approvalStatus: "approved" }), "approved");
});

test("the approver can still decide an item while its siblings are with the store", () => {
  const r = request({
    status: "approved",
    items: [item({ approval: decision("approved") }), item({ approval: decision("pending") })],
  });
  assert.equal(canDecideMrf(r, "e-01"), true);
  assert.equal(canDecideMrf(r, "e-02"), false); // the requester, never
  assert.deepEqual(awaitingItems(r).map((it) => it.id), [r.items[1].id]);
  /* And it stays in the Awaiting queue. */
  assert.equal(matchesApprovalFilter(r, "pending"), true);
  assert.equal(matchesApprovalFilter(r, "approved"), false);
});

test("nothing is waiting on a withdrawn request", () => {
  const r = request({ status: "cancelled", items: [item(), item()] });
  assert.equal(awaitingItems(r).length, 0);
  assert.equal(approvalStatusOf(r), "cancelled");
  assert.equal(mrfRequestLabel(r), "Withdrawn");
});

test("an older backend's items are read from their status", () => {
  const r = request({
    status: "approved",
    rejectionNote: "Too many",
    items: [item({ status: "issued" }), item({ status: "rejected" }), item({ status: "pending" })],
  });
  assert.deepEqual(
    r.items.map((it) => itemApprovalOf(it, r).decision),
    ["approved", "rejected", "pending"],
  );
  assert.equal(itemApprovalOf(r.items[1], r).reason, "Too many");
});

test("an item approved for less says so", () => {
  const a = decision("approved", { approvedQty: 6, rejectedQty: 4 });
  assert.equal(itemDecisionLabel(a, "Pcs"), "Approved 6 of 10 Pcs");
  assert.equal(itemDecisionLabel(decision("approved"), "Pcs"), "Approved");
  assert.equal(itemDecisionLabel(decision("rejected"), "Pcs"), "Rejected");
  assert.equal(itemDecisionLabel(decision("pending"), "Pcs"), "Awaiting approval");
  const r = request({ status: "approved", items: [item({ approval: a })] });
  assert.equal(approvalStatusOf(r), "partially_approved");
});

/* ── Validating the approver's drafts ─────────────────────────────────────── */

function waitingFive(): MrfRequest {
  return request({ items: [item(), item(), item(), item(), item()] });
}

test("3 to approve and 2 to reject (with reasons) is a valid submission", () => {
  const r = waitingFive();
  const [a, b, c, d, e] = r.items.map((it) => it.id);
  const v = validateItemDecisions(r, [
    { itemId: a, decision: "approved" },
    { itemId: b, decision: "approved" },
    { itemId: c, decision: "rejected", reason: "Not needed" },
    { itemId: d, decision: "approved" },
    { itemId: e, decision: "rejected", reason: "Duplicate" },
  ]);
  assert.equal(v.ok, true);
  if (v.ok) assert.equal(v.decisions.length, 5);
});

test("some items may be left for later", () => {
  const r = waitingFive();
  const v = validateItemDecisions(r, [{ itemId: r.items[0].id, decision: "approved" }]);
  assert.equal(v.ok, true);
});

test("a rejection needs a reason — its own, or the shared one from Reject all", () => {
  const r = waitingFive();
  const id = r.items[0].id;
  const v = validateItemDecisions(r, [{ itemId: id, decision: "rejected" }]);
  assert.equal(v.ok, false);
  if (!v.ok) {
    assert.equal(v.itemId, id);
    assert.equal(v.field, "reason");
  }
  const shared = validateItemDecisions(r, [{ itemId: id, decision: "rejected" }], "Over budget");
  assert.equal(shared.ok, true);
  if (shared.ok) assert.equal(shared.decisions[0].reason, "Over budget");
});

test("a reduced quantity needs a reason and must stay between 0 and what was asked", () => {
  const r = waitingFive();
  const id = r.items[0].id;
  const cut = validateItemDecisions(r, [{ itemId: id, decision: "approved", approvedQty: 4 }]);
  assert.equal(cut.ok, false);
  if (!cut.ok) assert.equal(cut.field, "reason");
  assert.equal(
    validateItemDecisions(r, [{ itemId: id, decision: "approved", approvedQty: 4, reason: "Four is enough" }]).ok,
    true,
  );
  for (const q of [0, -2, 11, Number.NaN]) {
    const v = validateItemDecisions(r, [{ itemId: id, decision: "approved", approvedQty: q, reason: "x" }]);
    assert.equal(v.ok, false, `approvedQty ${q} was accepted`);
    if (!v.ok) assert.equal(v.field, "approvedQty");
  }
  /* Blank is "all of it". */
  const full = validateItemDecisions(r, [{ itemId: id, decision: "approved", approvedQty: null }]);
  assert.equal(full.ok, true);
  if (full.ok) assert.equal(full.decisions[0].approvedQty, undefined);
});

test("an already-decided item, a duplicate and an empty submission are refused", () => {
  const r = request({
    status: "approved",
    items: [item({ approval: decision("approved") }), item({ approval: decision("pending") })],
  });
  const [done, open] = r.items.map((it) => it.id);
  assert.equal(validateItemDecisions(r, [{ itemId: done, decision: "approved" }]).ok, false);
  assert.equal(
    validateItemDecisions(r, [
      { itemId: open, decision: "approved" },
      { itemId: open, decision: "rejected", reason: "x" },
    ]).ok,
    false,
  );
  assert.equal(validateItemDecisions(r, []).ok, false);
});

/* ── Counting by decisions ────────────────────────────────────────────────── */

test("requester counts: a half-approved request is still pending", () => {
  const halfway = request({
    status: "approved",
    items: [item({ approval: decision("approved") }), item({ approval: decision("pending") })],
  });
  const s = mrfStats([halfway, fiveDecided(), request({ status: "rejected", items: [item({ approval: decision("rejected") })] })]);
  assert.deepEqual(s, { total: 3, pending: 1, approved: 0, partiallyApproved: 1, closed: 1 });
});

test("served requester counts are read only from a backend that counts by decisions", () => {
  assert.deepEqual(
    readMrfStats({ total: 6, pending: 2, approved: 1, partiallyApproved: 1, rejected: 1, cancelled: 1 }),
    { total: 6, pending: 2, approved: 1, partiallyApproved: 1, closed: 2 },
  );
  /* An older backend: counts by status — the page is closer to the truth. */
  assert.equal(readMrfStats({ total: 6, pending: 2, approved: 3, issued: 1 }), null);
  assert.equal(readMrfStats(null), null);
});

test("served approval counts carry the partly-approved figure", () => {
  assert.deepEqual(
    readMrfApprovalStats({ total: 5, pending: 1, approved: 2, partiallyApproved: 1, rejected: 1 }),
    { awaiting: 1, approved: 2, partiallyApproved: 1, rejected: 1, total: 5 },
  );
});

test("the shared Reject-all reason covers rejected items only, never an approved one", () => {
  const r = waitingFive();
  const [a, b] = r.items.map((it) => it.id);
  const v = validateItemDecisions(
    r,
    [
      { itemId: a, decision: "approved" },
      { itemId: b, decision: "rejected" },
    ],
    "Not needed for this run",
  );
  assert.equal(v.ok, true);
  if (v.ok) {
    assert.equal(v.decisions[0].reason, undefined);
    assert.equal(v.decisions[1].reason, "Not needed for this run");
  }
});

/* ── The new-request checklist ─────────────────────────────────────────────── */

const blankDraft = () => ({
  requestType: "uses_based" as const,
  reason: "",
  neededBy: "",
  deadline: "",
  items: [] as { name: string; requestedQty: string; unit: string }[],
});

test("an empty form lists a reason and an item as missing, and is not ready", () => {
  const c = newMrfChecklist(blankDraft());
  assert.equal(c.ready, false);
  assert.equal(c.missing, 2);
  assert.deepEqual(
    c.lines.filter((l) => l.state === "missing").map((l) => l.key),
    ["reason", "items"],
  );
  /* The needed-by date never blocks sending. */
  assert.equal(c.lines.find((l) => l.key === "neededBy")?.state, "optional");
});

test("a borrowed request asks for a return date; a consumed one does not", () => {
  const borrowed = newMrfChecklist({ ...blankDraft(), requestType: "time_based", reason: "Shoot" });
  assert.ok(borrowed.lines.some((l) => l.key === "deadline" && l.state === "missing"));
  assert.equal(borrowed.purposeDone, false);
  const dated = newMrfChecklist(
    { ...blankDraft(), requestType: "time_based", reason: "Shoot", deadline: "2026-10-20" },
    () => "20 Oct",
  );
  assert.equal(dated.lines.find((l) => l.key === "deadline")?.label, "Return by 20 Oct");
  assert.equal(dated.purposeDone, true);
  assert.ok(!newMrfChecklist({ ...blankDraft(), reason: "x" }).lines.some((l) => l.key === "deadline"));
});

test("each item says exactly what it still needs", () => {
  assert.equal(draftItemProblem({ name: "Button", requestedQty: "", unit: "Pcs" }), "Needs a quantity");
  assert.equal(
    draftItemProblem({ name: "", requestedQty: "0", unit: "" }),
    "Needs a name, a quantity and a unit",
  );
  assert.equal(draftItemProblem({ name: "Button", requestedQty: "12", unit: "Pcs" }), null);
  const c = newMrfChecklist({
    ...blankDraft(),
    reason: "Production",
    items: [
      { name: "Button", requestedQty: "12", unit: "Pcs" },
      { name: "Thread", requestedQty: "", unit: "Cone" },
    ],
  });
  assert.equal(c.lines.find((l) => l.key === "item-0")?.label, "Button \u00b7 12 Pcs");
  assert.equal(c.lines.find((l) => l.key === "item-1")?.label, "Thread \u2014 needs a quantity");
  assert.equal(c.lines.find((l) => l.key === "item-1")?.itemIndex, 1);
  assert.equal(c.itemsDone, false);
  assert.equal(c.ready, false);
});

test("a complete form is ready, and agrees with the send-time validation", () => {
  const draft = {
    ...blankDraft(),
    reason: "Production",
    items: [{ name: "Button", requestedQty: "12", unit: "Pcs" }],
  };
  const c = newMrfChecklist(draft);
  assert.equal(c.ready, true);
  assert.equal(c.missing, 0);
  const v = validateNewMrf({
    requestType: draft.requestType,
    reason: draft.reason,
    items: draft.items.map((it) => ({ ...it, requestedQty: Number(it.requestedQty) })),
  });
  assert.equal(v.ok, true);
});
