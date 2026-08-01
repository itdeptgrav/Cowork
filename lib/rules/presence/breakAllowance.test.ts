import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import {
  dayKeyOf,
  grantBreakCredit,
  readBreakLedger,
  type BreakLedger,
} from "./breakAllowance.ts";

const MIN = 60_000;
const NOW = Date.parse("2026-08-01T14:00:00.000Z");
const EMPTY: BreakLedger = { dayKey: null, creditedMs: 0 };

test("a break inside the allowance is credited in full", () => {
  const g = grantBreakCredit({
    spanMs: 30 * MIN,
    maxMinutesPerDay: 60,
    ledger: EMPTY,
    nowMs: NOW,
  });
  assert.equal(g.grantedMs, 30 * MIN);
  assert.equal(g.deniedMs, 0);
  assert.equal(g.exhausted, false);
});

test("the day's total is what is capped, not the single break", () => {
  /* A cap with no ledger is not a cap: three twenty-minute breaks are each
     under a sixty-minute allowance and together exceed it. */
  let ledger: BreakLedger = EMPTY;
  const taken: number[] = [];
  for (let i = 0; i < 4; i++) {
    const g = grantBreakCredit({
      spanMs: 20 * MIN,
      maxMinutesPerDay: 60,
      ledger,
      nowMs: NOW,
    });
    taken.push(g.grantedMs / MIN);
    ledger = g.ledger;
  }
  assert.deepEqual(taken, [20, 20, 20, 0]);
  assert.equal(ledger.creditedMs, 60 * MIN);
});

test("a break that crosses the limit is granted in PART, not refused whole", () => {
  /* Somebody with thirty minutes left is owed those thirty. Refusing the lot
     because forty does not fit is arithmetic nobody would accept on a payslip. */
  const g = grantBreakCredit({
    spanMs: 40 * MIN,
    maxMinutesPerDay: 60,
    ledger: { dayKey: dayKeyOf(NOW), creditedMs: 30 * MIN },
    nowMs: NOW,
  });
  assert.equal(g.grantedMs, 30 * MIN);
  assert.equal(g.deniedMs, 10 * MIN);
  assert.equal(g.exhausted, true);
});

test("yesterday's total does not spend today's allowance", () => {
  /* What makes "per day" true rather than "per lifetime". */
  const g = grantBreakCredit({
    spanMs: 45 * MIN,
    maxMinutesPerDay: 60,
    ledger: { dayKey: "2026-07-31", creditedMs: 60 * MIN },
    nowMs: NOW,
  });
  assert.equal(g.grantedMs, 45 * MIN);
  assert.equal(g.ledger.dayKey, dayKeyOf(NOW));
});

test("an allowance of zero credits nothing, and is not read as unset", () => {
  /* An administrator who sets zero means zero. Falling back to the default
     would silently overrule them. */
  const g = grantBreakCredit({
    spanMs: 30 * MIN,
    maxMinutesPerDay: 0,
    ledger: EMPTY,
    nowMs: NOW,
  });
  assert.equal(g.grantedMs, 0);
  assert.equal(g.deniedMs, 30 * MIN);
});

test("an absent policy falls back to legacy's own sixty minutes", () => {
  const g = grantBreakCredit({
    spanMs: 90 * MIN,
    maxMinutesPerDay: undefined,
    ledger: EMPTY,
    nowMs: NOW,
  });
  assert.equal(g.grantedMs, 60 * MIN);
});

test("the day is LOCAL, or the allowance resets mid-afternoon in India", () => {
  const d = new Date(NOW);
  const pad = (n: number) => String(n).padStart(2, "0");
  assert.equal(
    dayKeyOf(NOW),
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
  );
});

test("a duty document written before the ledger existed reads as unspent", () => {
  assert.deepEqual(readBreakLedger({}), { dayKey: null, creditedMs: 0 });
  assert.deepEqual(readBreakLedger({ breakCreditedMs: "60" }), {
    dayKey: null,
    creditedMs: 0,
  });
});

test("only BREAK time is capped by this allowance", () => {
  /* Emergency time is reviewed and approved on its own terms, and an offline
     span is not an allowance somebody spends. Asserted against the source
     because the mistake would be summing all three before capping. */
  const src = readFileSync("lib/repositories/legacy/index.ts", "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
  const at = src.indexOf("grantBreakCredit(");
  assert.ok(at > 0, "the allowance is not applied");
  assert.match(src.slice(at, at + 200), /spanMs: breakToCreditMs/);
  /* Emergency is not summed in at all now — it waits for a manager. */
  assert.match(src, /endedSpanMs = creditedBreakMs;/);
});
