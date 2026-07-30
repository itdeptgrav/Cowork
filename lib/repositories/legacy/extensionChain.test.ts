import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { toGrantedExtensions } from "./deadlineMap.ts";
import { formatPercent } from "../../utils/format.ts";

/**
 * The extension chain, and the NaN that came with it.
 *
 * **`listExtensions` returned the wrong SHAPE.** Its contract says
 * `DeadlineExtension[]`; the implementation returned `DeadlineProposal[]`. The
 * renderer reads three fields a proposal does not have — `newWindowSecs`,
 * `penaltyWaived`, `elapsedPercentAtRequest` — so every one arrived
 * `undefined`. That is the whole of:
 *
 *     +00:00:00   00:00:00 → 00:00:00   Penalty charged   at NaN% elapsed
 *
 * Three zeroes from `formatDurationTimer(undefined)`, "charged" from
 * `undefined` being falsy, and the NaN from `Math.round(undefined)`.
 */

const code = (p: string) =>
  readFileSync(p, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
const H = 3600;

const GRANTED = {
  newDueDate: "2026-07-30T12:00:00.000Z",
  editedAt: "2026-07-30T09:00:00.000Z",
  editedBy: "TL",
  previousWindowSecs: 7200,
  addedSecs: 7200,
  proposedWindowSecs: 14400,
  elapsedPercent: 62.5,
  isPenaltyWaived: true,
};

test("a granted extension maps to the shape the chain renders", () => {
  const [e] = toGrantedExtensions([GRANTED], "T646");
  assert.equal(e.addedSecs, 2 * H);
  assert.equal(e.previousWindowSecs, 2 * H);
  assert.equal(e.newWindowSecs, 4 * H);
  assert.equal(e.elapsedPercentAtRequest, 62.5);
  assert.equal(e.penaltyWaived, true);
  assert.equal(e.approvedById, "TL");
  /* Every field the renderer touches is a real number, not undefined. */
  for (const k of ["addedSecs", "previousWindowSecs", "newWindowSecs", "elapsedPercentAtRequest"] as const) {
    assert.equal(Number.isFinite(e[k]), true, `${k} is not a finite number`);
  }
});

test("the total is derived when only the parts were stored", () => {
  const [e] = toGrantedExtensions(
    [{ ...GRANTED, proposedWindowSecs: undefined }],
    "T646",
  );
  assert.equal(e.newWindowSecs, 4 * H);
});

test("an unreadable elapsed figure never becomes NaN", () => {
  for (const bad of [undefined, null, "", "abc", NaN]) {
    const [e] = toGrantedExtensions([{ ...GRANTED, elapsedPercent: bad }], "T646");
    assert.equal(Number.isFinite(e.elapsedPercentAtRequest), true);
    assert.equal(e.elapsedPercentAtRequest, 0);
  }
});

test("records without an amount are skipped, not shown as zeroes", () => {
  /* A row of 00:00:00 reads as an extension that added nothing. */
  const rows = toGrantedExtensions(
    [{ newDueDate: "2026-07-30T12:00:00.000Z", editedBy: "TL" }, GRANTED],
    "T646",
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].addedSecs, 2 * H);
});

test("a pending request is not listed as a granted extension", () => {
  /* It is a question, not a record, and it already appears under negotiation
     history — with an approver it does not have if listed here. */
  const src = code("lib/repositories/legacy/index.ts");
  const at = src.indexOf("async listExtensions(");
  const fn = src.slice(at, at + 900);
  assert.match(fn, /Promise<DeadlineExtension\[\]>/);
  assert.match(fn, /toGrantedExtensions\(history, id\)/);
  assert.equal(
    /toPendingExtension/.test(fn),
    false,
    "the pending request is in the granted chain again",
  );
});

/* ── The NaN guard ────────────────────────────────────────────────────────── */

test("formatPercent refuses to render a non-number", () => {
  for (const bad of [NaN, undefined, null, Infinity, "abc" as never]) {
    assert.equal(formatPercent(bad), null, `formatPercent(${String(bad)}) rendered`);
  }
  assert.equal(formatPercent(0), "0%");
  assert.equal(formatPercent(62.5), "63%");
  assert.equal(formatPercent(-5), "−5%");
});

test("the chain renders a percentage only where one was measured", () => {
  const src = code("components/features/tasks/DeadlinePanel.tsx");
  assert.match(src, /formatPercent\(e\.elapsedPercentAtRequest\) !== null &&/);
  assert.equal(
    /Math\.round\(e\.elapsedPercentAtRequest\)/.test(src),
    false,
    "the unguarded round is back",
  );
});

test("no task surface rounds a number straight into the DOM", () => {
  /* `Math.round(undefined)` is NaN and templates without complaint. Anything
     rounded for display goes through a formatter that can refuse. */
  const dir = "components/features/tasks";
  for (const f of readdirSync(dir)) {
    if (!f.endsWith(".tsx")) continue;
    const src = code(join(dir, f));
    const bad = src.match(/\{Math\.round\([^}]*\)\}%/g) ?? [];
    assert.deepEqual(bad, [], `${f} templates a rounded number directly`);
  }
});

/* ── Wording ──────────────────────────────────────────────────────────────── */

test("a missing legacy amount is not described as a failed request", () => {
  const src = code("components/features/tasks/DeadlinePanel.tsx");
  assert.match(src, /Previous extension request/);
  for (const wrong of [
    "amount not recorded",
    "Legacy extension",
    "unavailable",
    "Historical extension record",
  ]) {
    assert.equal(
      src.includes(wrong),
      false,
      `"${wrong}" is back — it reads as something having gone wrong`,
    );
  }
});

test("a negotiation row names who asked", () => {
  const src = code("components/features/tasks/DeadlinePanel.tsx");
  assert.match(src, /nameOf\(p\.proposedById\)/);
  assert.match(src, /const nameOf = \(id: string\) =>/);
});

test("no task surface can render the string NaN or undefined", () => {
  /* A sweep, because these reach the screen through templating rather than
     through a call anybody reviews. */
  const dir = "components/features/tasks";
  for (const f of readdirSync(dir)) {
    if (!f.endsWith(".tsx") || statSync(join(dir, f)).isDirectory()) continue;
    /* `typeof x === "undefined"` is an environment guard, not a rendered
       string. Stripped before the check so the sweep stays about display. */
    const src = code(join(dir, f)).replace(/typeof \w+ [!=]==? "undefined"/g, "");
    for (const literal of ['"NaN"', "'NaN'", '"undefined"', "'undefined'"]) {
      assert.equal(
        src.includes(literal),
        false,
        `${f} contains the literal ${literal}`,
      );
    }
  }
});
