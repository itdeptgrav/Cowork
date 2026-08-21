import assert from "node:assert/strict";
import { test } from "node:test";

import {
  attendanceReport,
  attendanceRow,
  clockLabel,
  dayLabelFor,
  durationLabel,
  istDayWindow,
  sessionLabel,
  stampLabel,
} from "./attendanceDay.ts";
import type { DutyHistoryEntry } from "./duty.ts";
import type { DutyFacts, RosterPerson } from "./roster.ts";

/* IST is UTC+05:30. 09:30 IST on 18 Aug 2026 is 04:00 UTC. */
const ist = (day: number, hour: number, minute = 0): number =>
  Date.UTC(2026, 7, day, hour - 5, minute - 30);

const NOW = ist(18, 19); // 7:00 PM IST on the 18th
const DAY = istDayWindow(NOW);

const person = (id = "a", displayName = "Ada"): RosterPerson => ({
  id,
  displayName,
  initials: "AD",
  hue: 1,
});

const facts = (over: Partial<DutyFacts> = {}): DutyFacts => ({
  mode: "offline",
  closedSecs: 0,
  sinceMs: null,
  ...over,
});

/** History is stored newest-first, which is how `spanRows` reads it. */
const log = (
  ...rows: { mode: DutyHistoryEntry["mode"]; at: number }[]
): DutyHistoryEntry[] =>
  rows
    .map((r, i) => ({ id: `h${i}`, mode: r.mode, at: r.at, reason: null }))
    .sort((a, b) => b.at - a.at);

const row = (input: {
  facts?: DutyFacts;
  entries?: DutyHistoryEntry[];
  nowMs?: number;
}) =>
  attendanceRow({
    person: person(),
    facts: input.facts ?? facts(),
    entries: input.entries ?? [],
    day: istDayWindow(input.nowMs ?? NOW),
    nowMs: input.nowMs ?? NOW,
  });

/* ── The day window ───────────────────────────────────────────────────────── */

test("the day is the IST calendar day, not the UTC one", () => {
  /* 01:00 IST on the 18th is 19:30 UTC on the 17th. A window computed in UTC
     would put it in the previous day and print times under the wrong date. */
  const w = istDayWindow(ist(18, 1));
  assert.equal(w.startMs, ist(18, 0));
  assert.equal(w.endMs, ist(19, 0));
  assert.equal(w.endMs - w.startMs, 86_400_000);
});

/* ── The reported bug: a session that outlives the day ────────────────────── */

test("a session running since last week does not report 233 hours today", () => {
  /* The reported failure. Presence is never revoked by a clock, so somebody
     who closed their laptop nine days ago is still online — but a figure
     labelled "today" that exceeds a day is wrong on its face. */
  const r = row({
    facts: facts({ mode: "online", sinceMs: ist(9, 10) }),
  });
  assert.ok(
    r.onlineSecs <= 86_400,
    `today's total must fit in a day, got ${r.onlineSecs}s`,
  );
  /* Midnight to 7pm IST is nineteen hours. */
  assert.equal(r.onlineSecs, 19 * 3600);
  assert.equal(r.sessions.length, 1);
  assert.equal(r.sessions[0].fromMs, DAY.startMs);
  assert.equal(r.sessions[0].carriedIn, true);
  assert.equal(r.sessions[0].toMs, null);
});

test("a stretch that began yesterday contributes only its part of today", () => {
  const r = row({
    facts: facts({ mode: "offline" }),
    entries: log(
      { mode: "online", at: ist(17, 22) },
      { mode: "offline", at: ist(18, 2) },
    ),
  });
  /* Midnight → 2am IST, not 10pm → 2am. */
  assert.equal(r.onlineSecs, 2 * 3600);
  assert.equal(r.sessions[0].fromMs, DAY.startMs);
  assert.equal(r.sessions[0].carriedIn, true);
});

/* ── The ordinary day ─────────────────────────────────────────────────────── */

test("a normal day reads as first on, last off, and the hours between", () => {
  const r = row({
    facts: facts({ mode: "offline" }),
    entries: log(
      { mode: "online", at: ist(18, 9, 30) },
      { mode: "offline", at: ist(18, 18, 30) },
    ),
  });
  assert.equal(clockLabel(r.firstOnMs), "9:30 AM");
  assert.equal(clockLabel(r.lastOffMs), "6:30 PM");
  assert.equal(r.onlineSecs, 9 * 3600);
  assert.equal(dayLabelFor(r), "9:30 AM → 6:30 PM");
  assert.equal(durationLabel(r.onlineSecs), "9h 00m");
});

test("a break splits the day into two stretches and is not counted as duty", () => {
  const r = row({
    facts: facts({ mode: "offline" }),
    entries: log(
      { mode: "online", at: ist(18, 9) },
      { mode: "break", at: ist(18, 13) },
      { mode: "online", at: ist(18, 14) },
      { mode: "offline", at: ist(18, 18) },
    ),
  });
  assert.equal(r.sessions.length, 2);
  /* Four hours, then four — the hour of break is not duty time. */
  assert.equal(r.onlineSecs, 8 * 3600);
  assert.equal(clockLabel(r.firstOnMs), "9:00 AM");
  assert.equal(clockLabel(r.lastOffMs), "6:00 PM");
});

test("a running session says so rather than printing an end that has not happened", () => {
  const r = row({
    facts: facts({ mode: "online", sinceMs: ist(18, 9, 30) }),
    entries: log({ mode: "online", at: ist(18, 9, 30) }),
  });
  assert.equal(r.live, true);
  assert.equal(r.lastOffMs, null);
  assert.equal(dayLabelFor(r), "9:30 AM → still on duty");
  assert.equal(r.sessions[0].toMs, null);
  assert.equal(r.onlineSecs, 9.5 * 3600);
});

test("somebody who never came on today is stated, not shown as zero hours", () => {
  const r = row({ facts: facts({ mode: "offline" }) });
  assert.equal(r.sessions.length, 0);
  assert.equal(r.onlineSecs, 0);
  assert.equal(dayLabelFor(r), "Not on duty today");
});

test("a person on a break with no history today shows no invented session", () => {
  /* Only an ONLINE mode may be carried in from the duty document — a break
     that began yesterday is not duty time today. */
  const r = row({ facts: facts({ mode: "break", sinceMs: ist(17, 15) }) });
  assert.equal(r.sessions.length, 0);
  assert.equal(r.onlineSecs, 0);
  assert.equal(dayLabelFor(r), "No sessions today");
});

test("duplicate transitions from a retry or a second device collapse", () => {
  /* `spanRows` merges consecutive same-mode rows; without it a real day is
     dozens of "Offline · 0m" rows and the two facts that matter are buried. */
  const r = row({
    facts: facts({ mode: "offline" }),
    entries: log(
      { mode: "online", at: ist(18, 9) },
      { mode: "online", at: ist(18, 9, 1) },
      { mode: "online", at: ist(18, 9, 2) },
      { mode: "offline", at: ist(18, 17) },
    ),
  });
  assert.equal(r.sessions.length, 1);
  assert.equal(clockLabel(r.sessions[0].fromMs), "9:00 AM");
  assert.equal(r.onlineSecs, 8 * 3600);
});

/* ── Order ────────────────────────────────────────────────────────────────── */

test("on duty first, then most time worked, then by name", () => {
  const rows = attendanceReport({
    people: [
      person("a", "Ada"),
      person("b", "Ben"),
      person("c", "Cara"),
      person("d", "Dev"),
    ],
    facts: new Map([
      ["a", facts({ mode: "offline" })],
      ["b", facts({ mode: "online", sinceMs: ist(18, 18) })],
      ["c", facts({ mode: "break" })],
      ["d", facts({ mode: "online", sinceMs: ist(18, 9) })],
    ]),
    history: new Map(),
    nowMs: NOW,
  });
  /* Both online people lead; the one who has been on since 9am outranks the
     one who arrived at 6pm. */
  assert.deepEqual(rows.map((r) => r.id), ["d", "b", "c", "a"]);
});

/* ── Wording ──────────────────────────────────────────────────────────────── */

test("times read as they were asked for, in IST and twelve-hour", () => {
  assert.equal(clockLabel(ist(18, 9, 30)), "9:30 AM");
  assert.equal(clockLabel(ist(18, 18, 30)), "6:30 PM");
  assert.equal(clockLabel(ist(18, 0, 5)), "12:05 AM");
  assert.equal(clockLabel(ist(18, 12)), "12:00 PM");
  assert.equal(clockLabel(null), "—");
  assert.equal(stampLabel(ist(18, 9, 30)), "18 Aug, 9:30 AM");
});

test("a session label names its two ends, and says when one is missing", () => {
  assert.equal(
    sessionLabel({ fromMs: ist(18, 9), toMs: ist(18, 17), carriedIn: false }),
    "9:00 AM → 5:00 PM",
  );
  assert.equal(
    sessionLabel({ fromMs: ist(18, 9), toMs: null, carriedIn: false }),
    "9:00 AM → now",
  );
  /* Carried in from before midnight — "from" rather than a start time nobody
     chose. */
  assert.equal(
    sessionLabel({ fromMs: DAY.startMs, toMs: ist(18, 2), carriedIn: true }),
    "from 12:00 AM → 2:00 AM",
  );
});

test("durations are padded so a column of figures lines up", () => {
  assert.equal(durationLabel(0), "0m");
  assert.equal(durationLabel(45 * 60), "45m");
  assert.equal(durationLabel(8 * 3600 + 5 * 60), "8h 05m");
  assert.equal(durationLabel(9 * 3600), "9h 00m");
});
