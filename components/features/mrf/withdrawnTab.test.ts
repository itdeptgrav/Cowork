import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { matchesApprovalFilter } from "@/lib/rules/mrf/lifecycle";
import type { MrfRequest } from "@/lib/domain/mrf";

/**
 * The Withdrawn tab (10 Nov 2026): the requester's withdrawn requests and the
 * ones withdrawn from the viewer's approval queue — shown, never acted on.
 */

const SRC = readFileSync("components/features/mrf/MrfArea.tsx", "utf8");

function body(name: string): string {
  const at = SRC.indexOf(`function ${name}(`);
  assert.ok(at > 0, `${name} not found`);
  const next = SRC.indexOf("\nfunction ", at + 10);
  return SRC.slice(at, next > 0 ? next : undefined);
}

test("there is a Withdrawn tab beside My requests and Approvals", () => {
  assert.match(SRC, /\{ id: "withdrawn", label: "Withdrawn" \}/);
  assert.match(SRC, /<Withdrawn \/>/);
});

test("it reads both sides: the requester's own, and the approver's", () => {
  const w = body("Withdrawn");
  assert.match(w, /r\.listMyMrfs\(\{ status: "cancelled" \}\)/);
  assert.match(w, /r\.listMrfApprovals\("withdrawn"\)/);
});

test("nothing on a withdrawn request can be acted on, on either side", () => {
  const card = body("WithdrawnCard");
  for (const forbidden of [/decideMrfItems/, /cancelMrf/, /useAction/, /DecisionToggle/, /MrfChat/, /<Button/, /Withdraw<\/button>/]) {
    assert.doesNotMatch(card, forbidden, `the withdrawn card offers an action: ${forbidden}`);
  }
});

test("withdrawn means the request's own status, not the approval roll-up", () => {
  /* Withdrawn after every item was approved: rolls up as approved, is withdrawn. */
  const approvedThenWithdrawn = {
    status: "cancelled",
    items: [{ approval: { decision: "approved" } }],
  } as unknown as MrfRequest;
  assert.equal(matchesApprovalFilter(approvedThenWithdrawn, "withdrawn"), true);
  const live = { status: "approved", items: [] } as unknown as MrfRequest;
  assert.equal(matchesApprovalFilter(live, "withdrawn"), false);
});
