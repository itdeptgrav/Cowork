import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";

import { orderSignals, type Signal } from "./signals";

/**
 * What the "Needs you" card shows, and in what order.
 *
 * Ordering used to be whatever sequence the `out.push` calls happened to run
 * in. That was roughly right and guaranteed nothing — and it stopped being
 * harmless the moment the list was capped, because from then on the order
 * decides what is SEEN rather than only where it sits.
 */

const code = (p: string) =>
  readFileSync(p, "utf8")
    .replace(/\r\n/g, "\n")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

const CARD = "components/features/dashboard/AttentionCard.tsx";

function sig(id: string, urgency: Signal["urgency"]): Signal {
  return { id, label: id, count: 1, action: "Open", href: "/", urgency };
}

test("urgent work leads, then unread, then everything else", () => {
  const ordered = orderSignals([
    sig("project", "attention"),
    sig("unread", "steady"),
    sig("confirm", "attention"),
    sig("overdue", "critical"),
    sig("t-stalled", "steady"),
    sig("approval:T1", "critical"),
  ]).map((s) => s.id);

  assert.deepEqual(ordered.slice(0, 2), ["overdue", "approval:T1"]);
  assert.equal(ordered[2], "unread", "unread fell below the softer work rows");
  assert.deepEqual(ordered.slice(3), ["project", "confirm", "t-stalled"]);
});

test("the sort is stable inside a band", () => {
  /* Conflicts before approvals before overdue is the order the pushes express,
     and it is deliberate. A sort that reshuffled equals would lose it. */
  const ordered = orderSignals([
    sig("conflict", "critical"),
    sig("approval:T1", "critical"),
    sig("approval:T2", "critical"),
    sig("overdue", "critical"),
  ]).map((s) => s.id);
  assert.deepEqual(ordered, ["conflict", "approval:T1", "approval:T2", "overdue"]);
});

test("an empty list orders to an empty list", () => {
  assert.deepEqual(orderSignals([]), []);
});

test("ordering does not mutate its input", () => {
  /* The card renders what it is handed; a sort in place would reorder the
     caller's array as a side effect of reading it. */
  const input = [sig("unread", "steady"), sig("overdue", "critical")];
  orderSignals(input);
  assert.deepEqual(input.map((s) => s.id), ["unread", "overdue"]);
});

test("the card shows six rows and then ends", () => {
  /* CHANGED ON PURPOSE — this asserted a "+N more waiting" strip under the
     list. That strip has gone, and with it the card's stretch to the bottom of
     the column: together they put a line about rows that were not there above a
     band of card holding nothing either. The header's "View all" is the route
     to the rest and says so in words. */
  const src = code(CARD);
  assert.match(src, /const VISIBLE_SIGNALS = 6;/);
  assert.match(src, /signals\.slice\(0, VISIBLE_SIGNALS\)/);
  assert.equal(
    /more waiting/.test(src),
    false,
    "the footer strip is back under the list",
  );
  /* And the card packs to its rows rather than filling the column. */
  assert.equal(
    /deck:h-full/.test(src),
    false,
    "the card stretches past its own content again",
  );
});

test("the header carries a way out, not a tally", () => {
  /* "N urgent" repeated what the rows already say, in the one slot in the
     header that could carry an action. */
  const src = code(CARD);
  assert.match(src, /View all/);
  assert.equal(
    /urgent<\/span>|\{critical\} urgent/.test(src),
    false,
    "the urgent count badge is back",
  );
  /* And exactly one control to that destination — the card's own icon-only
     CardLink would be a second. */
  assert.equal(
    /hrefLabel=/.test(src),
    false,
    "the card grew a second link beside View all",
  );
});

/* ── Recent messages ──────────────────────────────────────────────────────── */

test("messages band with unread, whatever their ids", () => {
  /* The rows carry `unread:<id>` now that there is one per message, so a band
     rule keyed on the exact string "unread" would drop them to the bottom. */
  const ordered = orderSignals([
    sig("confirm", "attention"),
    { ...sig("unread:n1", "steady"), icon: "chat" },
    { ...sig("unread:n2", "steady"), icon: "chat" },
    sig("overdue", "critical"),
  ]).map((s) => s.id);
  assert.deepEqual(ordered, ["overdue", "unread:n1", "unread:n2", "confirm"]);
});

test("three messages, and the newest ones", () => {
  const src = code("components/features/dashboard/signals.ts");
  assert.match(src, /const RECENT_MESSAGES = 3;/);
  assert.match(src, /unread\.slice\(0, RECENT_MESSAGES\)/);
  /* `listNotifications` is already `createdAt desc`. A sort here would be a
     second opinion about recency and the two would eventually disagree. */
  const at = src.indexOf("for (const n of unread.slice");
  assert.ok(at > 0, "the message loop is gone");
  assert.equal(
    /\.sort\(/.test(src.slice(at, src.indexOf("});", at))),
    false,
    "the card is re-sorting notifications it was handed in order",
  );
  /* The tally it replaced must not come back alongside them. */
  assert.equal(
    /"unread notifications"/.test(src),
    false,
    "the aggregate unread row is back",
  );
});

test("a message row carries no count", () => {
  /* Three rows each stamped "1" say nothing three times, in the column the eye
     uses to weigh the list. */
  const src = code("components/features/dashboard/signals.ts");
  const at = src.indexOf("id: `unread:${n.id}`");
  assert.ok(at > 0, "the message row is gone");
  const row = src.slice(at, src.indexOf("});", at));
  assert.equal(/count:/.test(row), false, "a message row grew a count");
  assert.match(row, /icon: "chat"/);
  /* And it goes where the message is about, not always to the list. */
  assert.match(row, /notificationHref\(notificationTarget\(n\.type, n\.data\)\)/);
  assert.match(row, /\?\? "\/notifications"/);
});

test("the row renders a glyph exactly when there is no count", () => {
  const src = code(CARD);
  assert.match(src, /signal\.count !== undefined \? \(/);
  assert.match(src, /signal\.icon \? \(/);
  assert.match(src, /<Glyph name=\{signal\.icon\} \/>/);
});

test("the brief adds up rows that share a label, and pluralises them", () => {
  /* The urgent rows are one-per-task now, so two approvals arrive as two rows
     carrying identical words. Read straight out that became "1 task waiting on
     your approval and 1 task waiting on your approval". */
  const src = code("components/features/dashboard/Chrome.tsx");
  assert.match(src, /const byLabel = new Map</);
  assert.match(src, /at\.n \+= u\.count \?\? 1/);
  assert.match(src, /u\.n === 1 \? u\.one : u\.many/);
  assert.equal(
    /\.map\(\(u\) => `\$\{u\.count\} \$\{u\.label\}`\)/.test(src),
    false,
    "the brief reads the rows straight out again",
  );
  /* And the plural exists to be read. */
  const signals = code("components/features/dashboard/signals.ts");
  assert.match(signals, /pluralLabel: "tasks waiting on your approval"/);
});
