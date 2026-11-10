import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import type { MrfRequest } from "@/lib/domain/mrf";
import { arrangeApprovalQueue, matchesQueueSearch } from "./queueOrder.ts";

/* Rishee Ray's live queue on 10 Nov 2026, in the shape that hid 0196: thirteen
   older URGENT requests, then the new NORMAL one. */
const req = (n: string, priority: MrfRequest["priority"], day: number, extra: Partial<MrfRequest> = {}) =>
  ({
    id: n,
    mrfNumber: `MRF/2026-27/${n}`,
    priority,
    createdAt: new Date(2026, 9, day).toISOString(),
    requesterName: "TRINAYAN DOLEY",
    requesterDepartment: "Production",
    reason: "Sewing Machine Parts",
    items: [{ name: "Pressure Foot 1/8 CR(SP)" }],
    ...extra,
  }) as unknown as MrfRequest;

const urgentOld = ["0143", "0127", "0109", "0071", "0069", "0030", "0018", "0017", "0013", "0012", "0011", "0010", "0009"].map(
  (n, i) => req(n, "urgent", 20 - i),
);
const fresh = req("0196", "normal", 31);
const queue = [...urgentOld, fresh, req("0195", "normal", 30)];

test("a request just raised is at the top by default, whatever is urgent", () => {
  const out = arrangeApprovalQueue(queue, { sort: "newest", query: "" });
  assert.equal(out[0].mrfNumber, "MRF/2026-27/0196");
});

test("Urgent first keeps the old order: urgent, then newest", () => {
  const out = arrangeApprovalQueue(queue, { sort: "urgent", query: "" });
  assert.equal(out[0].mrfNumber, "MRF/2026-27/0143");
  assert.equal(out.findIndex((m) => m.id === "0196"), 13);
});

test("search finds a request by number, person or item", () => {
  assert.equal(arrangeApprovalQueue(queue, { sort: "urgent", query: "0196" })[0].id, "0196");
  assert.equal(matchesQueueSearch(fresh, "trinayan"), true);
  assert.equal(matchesQueueSearch(fresh, "pressure foot"), true);
  assert.equal(matchesQueueSearch(fresh, "nothing like it"), false);
});

test("nothing is dropped by ordering, and the input is not mutated", () => {
  const before = queue.map((m) => m.id).join();
  assert.equal(arrangeApprovalQueue(queue, { sort: "newest", query: "" }).length, queue.length);
  assert.equal(queue.map((m) => m.id).join(), before);
});

test("the Approvals screen uses it, newest first by default", () => {
  const src = readFileSync("components/features/mrf/MrfArea.tsx", "utf8");
  assert.match(src, /useState<MrfQueueSort>\("newest"\)/);
  assert.match(src, /arrangeApprovalQueue\(data\?\.requests \?\? \[\], \{ sort, query \}\)/);
  assert.match(src, /\{shown\.map\(\(m\) => \(\s*<ApprovalCard/);
});
