import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { test } from "node:test";

/**
 * A budget decision has to REACH the person being waited on.
 *
 * The reported fault: a self-assigned task said "Waiting for RAKESH BISWAL to
 * decide", and Rakesh's Actionable tab said "Nothing waiting on you". Two
 * screens reading the same record and disagreeing.
 *
 * The rule was never wrong. `actionable.ts` already has a branch for exactly
 * this — `budgetTurn` names the manager, and the comment there describes the
 * self-assigned case in full. It had nothing to run ON: the task document was
 * never fetched for that viewer, and when it was, a filter threw it away.
 *
 * **Two independent blockers, either of which alone reproduces the bug**, which
 * is why both are pinned here. A self-assigned task is raised by and assigned
 * to the same person, so every existing query and every existing clause names
 * THEM — and the one person who must act appears in none of it.
 */

const LEGACY = "lib/repositories/legacy/index.ts";
const ACTIONABLE = "lib/rules/tasks/actionable.ts";

function code(path: string): string {
  return readFileSync(path, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[^\S\n]*\/\/.*$/gm, "");
}

/* ── Blocker 1: the document was never fetched ────────────────────────────── */

test("tasks whose budget is waiting on the viewer are queried", () => {
  /* `assignedBy` and `assigneeIds` both name the assignee on a self-assigned
     task, and `approverId` is queried for the CEO only — so a manager's copy of
     the record was never read at all. */
  assert.match(
    code(LEGACY),
    /where\("budgetNegotiation\.waitingForId", "==", viewerId\)/,
    "no query reaches a task whose budget decision is owed by this viewer",
  );
});

test("that query carries no orderBy, so it needs no composite index", () => {
  /* A `where` on one field ordered by another needs a deployed composite index.
     Without one the query throws at runtime and the tab silently empties — the
     same trade the cross-department gate query already makes. */
  const src = code(LEGACY);
  const at = src.indexOf('where("budgetNegotiation.waitingForId"');
  assert.ok(at > 0, "the query is missing");
  const call = src.slice(src.lastIndexOf("query(", at), src.indexOf("),\n", at) + 2);
  assert.doesNotMatch(call, /orderBy/);
});

/* ── Blocker 2: the document was fetched and then discarded ───────────────── */

test("a task waiting on the viewer is never rolled up into its parent", () => {
  /* The roll-up collapses a child into its parent for anybody it does not
     belong to — and for a TL or the CEO it does so UNCONDITIONALLY. A manager
     deciding the hours on a self-assigned task inside a project is neither its
     assignee nor its creator, so that clause dropped the one row they needed. */
  assert.match(
    code(LEGACY),
    /if \(t\.budgetNegotiation\?\.waitingForId === viewerId\) return true;/,
    "a task the viewer owes a budget decision on is still rolled up",
  );
});

test("the exemption is checked BEFORE the unconditional role clause", () => {
  /* Order is the whole fix. `if (isCeo || role === "tl") return false` returns
     without appeal, so an exemption placed after it can never run. */
  const src = code(LEGACY);
  const exempt = src.indexOf("if (t.budgetNegotiation?.waitingForId === viewerId) return true;");
  const roleClause = src.indexOf('if (isCeo || String(this.#ctx.legacyRole ?? "") === "tl") return false;');
  assert.ok(exempt > 0 && roleClause > 0, "one of the clauses moved");
  assert.ok(
    exempt < roleClause,
    "the exemption sits after the role clause, which returns first",
  );
});

test("nothing else about the roll-up widened", () => {
  /* A manager who is NOT being waited on must still see the parent stand in for
     the child, exactly as before. */
  const src = code(LEGACY);
  assert.match(src, /if \(assignedOrPendingToMe\(t\) \|\| t\.createdById === viewerId\) return true;/);
  assert.match(src, /return t\.isForwardedTask \|\| !byId\.has\(t\.parentTaskId\);/);
});

/* ── The rule itself was always right ─────────────────────────────────────── */

test("the actionable rule still defers to budgetTurn", () => {
  /* Recomputing "whose turn" here is how this list and the task screen would
     come to disagree — which is the fault being fixed, not a new way to have
     it. */
  const src = code(ACTIONABLE);
  assert.match(src, /const budget = budgetTurn\(view, viewerId\);/);
  assert.match(src, /budget\.ownerId === viewerId &&/);
  assert.match(src, /\(budget\.canAccept \|\| budget\.canPropose\)/);
});

test("an unowned turn is still not offered as an action", () => {
  /* A turn the record cannot assign to anybody is a fault with its own notice.
     Listing it would offer an action no screen behind the link can perform. */
  assert.match(code(ACTIONABLE), /!budget\.unowned &&/);
});
