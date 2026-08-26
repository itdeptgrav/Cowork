import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";

/**
 * The Approvals tab carries the count of requests waiting on you.
 *
 * **Why this is asserted rather than trusted.** The badge is read from the
 * *other* tab — that is its entire purpose, knowing whether to switch without
 * switching. So the one reader who depends on it is the one reader who cannot
 * see what it was counted from, and a wrong number looks exactly like a right
 * one. It has already been wrong once: the count was recomputed from the rows
 * the server returned, which are a single page of at most twenty, already
 * narrowed to the Queue filter. A queue of twenty-three read "20", and with the
 * filter on Awaiting the Approved tile read "0" over requests that existed.
 *
 * These read source rather than render, in the style of the other wiring tests:
 * what is protected is that the badge is fed from the queue-wide count and from
 * the same field as the tile beside it — which a rendering test over an empty
 * prototype queue cannot show.
 */

const strip = (p: string) =>
  readFileSync(p, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

const AREA = strip("components/features/mrf/MrfArea.tsx");
const REPO = strip("lib/repositories/legacy/index.ts");
const MOCK = strip("lib/repositories/mock/index.ts");

/* ── The badge ────────────────────────────────────────────────────────────── */

test("the count is fetched above the tabs, not inside the Approvals view", () => {
  /* A query living inside `Approvals` only runs once that tab is open, which
     is precisely when the badge has stopped being useful. */
  const area = AREA.slice(
    AREA.indexOf("export function MrfArea"),
    AREA.indexOf("function MyRequests"),
  );
  assert.match(area, /useQuery\(\s*\(r\)\s*=>\s*r\.listMrfApprovals\("pending"\)/);
});

test("the badge and the tile read the same field", () => {
  /* Two counts of one thing is two things to disagree. Both are `awaiting`. */
  assert.match(AREA, /pendingApprovals\s*=\s*approvalsData\?\.stats\.awaiting/);
  assert.match(AREA, /label:\s*"Awaiting you",\s*value:\s*data\.stats\.awaiting/);
});

test("the badge renders on the Approvals tab and shows the number", () => {
  assert.match(AREA, /t\.id === "approvals" && pendingApprovals > 0 &&/);
  assert.match(AREA, /\{pendingApprovals\}/);
});

test("an empty queue shows no badge rather than a zero", () => {
  /* A pill that reads "0" whenever there is nothing to do teaches the reader
     to stop looking at it, which costs exactly the case it exists for. */
  assert.match(AREA, /pendingApprovals > 0/);
});

/* ── What the count is counted from ───────────────────────────────────────── */

test("the queue counts come from the server, not from the page of rows", () => {
  const method = REPO.slice(
    REPO.indexOf("async listMrfApprovals("),
    REPO.indexOf("async getMrf("),
  );
  assert.notEqual(method, "", "listMrfApprovals not found in the legacy repository");
  /* The served aggregate first; counting the returned page is the fallback for
     a backend too old to send one, never the primary source. */
  assert.match(method, /readMrfApprovalStats\(r\.data\.stats\)/);
  assert.match(method, /served \?\? mrfApprovalStats\(requests\)/);
});

test("the prototype counts the whole queue too, not the filtered slice", () => {
  /* The mock is the contract other implementations are read against: `requests`
     is narrowed by `status`, `stats` is not. */
  const method = MOCK.slice(
    MOCK.indexOf("async listMrfApprovals("),
    MOCK.indexOf("async getMrf("),
  );
  assert.notEqual(method, "", "listMrfApprovals not found in the mock repository");
  assert.match(method, /stats:\s*mrfApprovalStats\(mine\)/);
  assert.match(method, /status === "all" \|\| m\.status === status/);
});
