import assert from "node:assert/strict";
import { budgetTurn } from "../../../lib/rules/tasks/budgetNegotiation.ts";
import { test } from "node:test";
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * The time-budget negotiation, end to end.
 *
 * Either side may counter; whoever is waited on may also accept; there is no
 * reject. The turn is the engine's own `waitingFor` field, checked identically
 * in the UI rule and inside the endpoint's transaction — so "you cannot decide
 * your own proposal" cannot be true on one side and false on the other.
 */

const code = (p: string) =>
  readFileSync(p, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

const CARD = "components/features/tasks/BudgetNegotiationCard.tsx";
const RULE = "lib/rules/tasks/budgetNegotiation.ts";
const BACKEND = "/Users/risheeray/Documents/cowork-old-backend";
const SERVICE = join(BACKEND, "services/budgetNegotiation.service.js");
const ROUTE = join(BACKEND, "routes/task_routes/budgetNegotiation.js");
const haveBackend = () => {
  try {
    return statSync(SERVICE).isFile();
  } catch {
    return false;
  }
};

/* ── One card, both sides ─────────────────────────────────────────────────── */

test("a single card serves assignee and assignor", () => {
  /* Two cards each with their own conditions is how an assignee came to be
     offered an accept over their own proposal. */
  const src = code(CARD);
  assert.match(src, /const turn = budgetTurn\(view, viewerId\)/);
  assert.match(src, /turn\.canAccept \?/);
  for (const gone of ["AssignorWindowCard", "DeadlineProposalCard"]) {
    let exists = true;
    try {
      statSync(`components/features/tasks/${gone}.tsx`);
    } catch {
      exists = false;
    }
    assert.equal(exists, false, `${gone} still exists alongside the new card`);
  }
});

test("whoever is waited on may accept OR counter", () => {
  /* The symmetry is the loop. Asserted on the ANSWER rather than on the literal
     `canAccept: mine, canPropose: mine` that used to sit in this module — the
     judgement moved into `getExtensionActions`, which is now the one place that
     decides it for both the negotiation and the extension records. Pinning the
     old expression would pin the duplication we removed. */
  const rule = code(RULE);
  assert.match(rule, /getExtensionActions\(viewerId, \{ negotiation: n \}\)/);
  assert.match(rule, /canAccept: actions\.canAccept/);
  assert.match(rule, /canPropose: actions\.canNegotiate/);

  const turn = budgetTurn(
    {
      budgetNegotiation: {
        state: "WAITING_FOR_ASSIGNEE",
        currentSecs: 7200,
        proposedById: "GR0000",
        proposedByName: "",
        waitingForId: "GR0002",
        round: 1,
        history: [],
      },
    } as never,
    "GR0002",
  );
  assert.equal(turn.canAccept, true);
  assert.equal(turn.canPropose, true, "either side may counter — that is the loop");
});

test("everyone else is told whose turn it is, not shown dead buttons", () => {
  /* A disabled control reads as "you may do this" and then refuses. */
  const src = code(CARD);
  assert.match(src, /waitingOnLabel\(turn, nameOf\)/);
});

test("no refusal exists anywhere in the flow", () => {
  /* A reject that ends the negotiation leaves work carrying a budget one side
     never agreed to. */
  for (const path of [CARD, RULE]) {
    const src = code(path);
    assert.equal(/canRefuse|reject/i.test(src), false, `${path} offers a refusal`);
  }
  if (haveBackend()) {
    assert.equal(/reject/i.test(code(ROUTE)), false, "a reject route exists");
  }
});

/* ── The engine ───────────────────────────────────────────────────────────── */

test("the turn passes to the other side on every counter", (t) => {
  if (!haveBackend()) return t.skip("backend not present");
  const src = code(SERVICE);
  assert.match(src, /const waitingFor = role === "assignee" \? assignor : assignee/);
});

test("the turn IS the permission, so nobody answers their own proposal", (t) => {
  if (!haveBackend()) return t.skip("backend not present");
  /* After proposing you are never the one waited on, so one check delivers
     both rules and they cannot disagree. */
  const src = code(SERVICE);
  const fn = src.slice(src.indexOf("function assertTurn("));
  assert.match(fn.slice(0, 900), /String\(negotiation\.waitingFor \|\| ""\) !== String\(employeeId\)/);
  assert.match(fn.slice(0, 900), /NOT_YOUR_TURN/);
});

test("a non-party can never act", (t) => {
  if (!haveBackend()) return t.skip("backend not present");
  const src = code(SERVICE);
  assert.match(src, /NOT_A_PARTY/);
  assert.match(src, /if \(!role\) \{/);
});

test("the turn is checked inside a transaction", (t) => {
  if (!haveBackend()) return t.skip("backend not present");
  /* Two concurrent moves would otherwise both pass a check made before either
     wrote. */
  const src = code(SERVICE);
  for (const fn of ["counterBudgetProposal", "acceptBudgetProposal"]) {
    const block = src.slice(src.indexOf(`async function ${fn}(`));
    assert.match(block.slice(0, 600), /db\.runTransaction/, `${fn} is unguarded`);
  }
});

test("an agreed budget cannot be reopened", (t) => {
  if (!haveBackend()) return t.skip("backend not present");
  const src = code(SERVICE);
  assert.match(src, /ALREADY_SETTLED/);
});

test("every round is recorded, never overwritten", (t) => {
  if (!haveBackend()) return t.skip("backend not present");
  const src = code(SERVICE);
  assert.match(src, /history: \[\.\.\.\(negotiation\.history \|\| \[\]\), entry\]/);
  const entry = src.slice(src.indexOf("function historyEntry("));
  for (const field of [
    "roundNumber", "previousBudgetSeconds", "proposedBudgetSeconds",
    "proposedBy", "proposedByName", "waitingFor", "reason",
    "createdAt", "decision", "decidedBy",
  ]) {
    assert.ok(entry.slice(0, 1200).includes(field), `history lacks ${field}`);
  }
});

test("acceptance writes the agreed figure where the product reads it", (t) => {
  if (!haveBackend()) return t.skip("backend not present");
  /* Not a second source of truth for how long the work is worth. */
  const src = code(SERVICE);
  const fn = src.slice(src.indexOf("async function acceptBudgetProposal("));
  assert.match(fn.slice(0, 2200), /senderTimerWindowSecs: secs/);
});

test("an implausible budget is refused before it reaches the arithmetic", (t) => {
  if (!haveBackend()) return t.skip("backend not present");
  const src = code(SERVICE);
  const fn = src.slice(src.indexOf("function readSeconds("));
  assert.match(fn.slice(0, 700), /n <= 0/);
  assert.match(fn.slice(0, 700), /2000 \* 3600/);
});

test("existing tasks join the loop without a migration", (t) => {
  if (!haveBackend()) return t.skip("backend not present");
  /* A task created with a sender window is ALREADY mid-negotiation, so the
     opening state is derived rather than needing a backfill. */
  const src = code(SERVICE);
  const fn = src.slice(src.indexOf("function currentNegotiation("));
  assert.match(fn.slice(0, 900), /senderTimerWindowSecs/);
  assert.match(fn.slice(0, 900), /opening > 0 \? WAITING_FOR_ASSIGNEE : null/);
});
