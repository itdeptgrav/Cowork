import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { anyUnread, badgeFor, tabBadges } from "./tabBadges.ts";

/**
 * **Reported 17 Aug 2026.** A task's tabs gave no sign that anything had
 * happened on them — a message arrived, work was submitted, a reviewer sent it
 * back, and the only way to find out was to open each tab. The tab bar already
 * had a `count` slot and the legacy mapper hardcoded it to `0`, so the
 * affordance existed and had never once shown anything.
 */

const at = (h: number, m = 0) =>
  `2026-08-17T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00+05:30`;

test("nothing has happened, so nothing is shown", () => {
  assert.deepEqual(
    badgeFor({ activity: { lastAt: null }, seenAt: null, viewerId: "GR1" }),
    { count: 0, dot: false },
  );
  /* And an absent tab is absent, not a zero — so a caller cannot render a
     badge for a tab the engine said nothing about. */
  assert.deepEqual(tabBadges({ activity: {}, seen: {}, viewerId: "GR1" }), {});
});

test("a tab never opened counts everything as new", () => {
  /**
   * Treating an absent mark as "seen just now" would hide every message that
   * arrived before somebody's first visit — which is most of them, on a task
   * they have just been given.
   */
  const b = badgeFor({
    activity: {
      lastAt: at(16, 30),
      items: [
        { at: at(15, 0), by: "GR2" },
        { at: at(16, 30), by: "GR2" },
      ],
    },
    seenAt: null,
    viewerId: "GR1",
  });
  assert.equal(b.count, 2);
  assert.equal(b.dot, true);
});

test("only events after the mark count", () => {
  const b = badgeFor({
    activity: {
      lastAt: at(16, 30),
      items: [
        { at: at(14, 0), by: "GR2" },
        { at: at(16, 0), by: "GR2" },
        { at: at(16, 30), by: "GR2" },
      ],
    },
    seenAt: at(15, 0),
    viewerId: "GR1",
  });
  assert.equal(b.count, 2, "the 14:00 event was already read");
});

test("your own doing is not news to you", () => {
  /* A badge on Chat for the message you just sent teaches people to ignore
     badges. */
  const b = badgeFor({
    activity: {
      lastAt: at(16, 30),
      items: [
        { at: at(16, 0), by: "GR1" },
        { at: at(16, 30), by: "GR2" },
      ],
    },
    seenAt: null,
    viewerId: "GR1",
  });
  assert.equal(b.count, 1, "only the other person's message is news");
});

test("an unattributed event still counts", () => {
  /* Suppressing it would hide somebody else's. The engine does not name an
     author for every kind of event, and silence is not a claim of authorship. */
  const b = badgeFor({
    activity: { lastAt: at(16, 30), items: [{ at: at(16, 30), by: null }] },
    seenAt: null,
    viewerId: "GR1",
  });
  assert.equal(b.count, 1);
});

test("a tab that changed but cannot be counted shows a dot, not a number", () => {
  /**
   * The engine reports `lastAt` for every tab and itemises only some.
   * Inventing "1" would be a figure nobody could check.
   */
  const b = badgeFor({
    activity: { lastAt: at(16, 30) },
    seenAt: at(15, 0),
    viewerId: "GR1",
  });
  assert.equal(b.count, 0);
  assert.equal(b.dot, true);
  /* And once read, the dot goes. */
  assert.equal(
    badgeFor({ activity: { lastAt: at(16, 30) }, seenAt: at(17, 0), viewerId: "GR1" }).dot,
    false,
  );
});

test("reading a tab clears it, and reading it again changes nothing", () => {
  const activity = {
    lastAt: at(16, 30),
    items: [{ at: at(16, 30), by: "GR2" }],
  };
  assert.equal(badgeFor({ activity, seenAt: at(16, 31), viewerId: "GR1" }).count, 0);
  assert.equal(badgeFor({ activity, seenAt: at(18, 0), viewerId: "GR1" }).count, 0);
});

test("an event exactly at the mark is already read", () => {
  /* The mark is written when the tab is opened, so an event carrying that same
     instant was on screen. Counting it would leave a badge that never clears. */
  const b = badgeFor({
    activity: { lastAt: at(16, 0), items: [{ at: at(16, 0), by: "GR2" }] },
    seenAt: at(16, 0),
    viewerId: "GR1",
  });
  assert.equal(b.count, 0);
});

test("every tab is keyed by the engine's own id", () => {
  /* The rule names no tab. A tab added later gets a badge from the engine
     reporting activity for it, with nothing changed here. */
  const badges = tabBadges({
    activity: {
      chat: { lastAt: at(16, 0), items: [{ at: at(16, 0), by: "GR2" }] },
      review: { lastAt: at(15, 0), items: [{ at: at(15, 0), by: "GR2" }] },
      /* A tab this file has never heard of. */
      whatever_comes_next: { lastAt: at(17, 0) },
      quiet: { lastAt: null },
    },
    seen: { review: at(15, 30) },
    viewerId: "GR1",
  });
  assert.deepEqual(Object.keys(badges).sort(), ["chat", "whatever_comes_next"]);
  assert.equal(badges.chat.count, 1);
  assert.equal(badges.whatever_comes_next.dot, true);
  assert.equal(anyUnread(badges), true);
});

test("the rule hardcodes no tab name", () => {
  /* The fault this shape avoids: a switch here would have to be edited every
     time the product grew a tab, and forgetting is silent. */
  const code = readFileSync("lib/rules/tasks/tabBadges.ts", "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
  for (const name of ['"chat"', '"review"', '"submission"', '"meetings"']) {
    assert.equal(
      code.includes(name),
      false,
      `the rule mentions ${name} — it must stay keyed by whatever the engine sends`,
    );
  }
});

test("bad instants are ignored rather than counted", () => {
  const b = badgeFor({
    activity: {
      lastAt: at(16, 0),
      items: [{ at: "not a date", by: "GR2" }, { at: at(16, 0), by: "GR2" }],
    },
    seenAt: null,
    viewerId: "GR1",
  });
  assert.equal(b.count, 1);
  /* An unparseable `lastAt` is nothing having happened, not everything. */
  assert.deepEqual(
    badgeFor({ activity: { lastAt: "rubbish" }, seenAt: null, viewerId: "GR1" }),
    { count: 0, dot: false },
  );
});

test("the badge hooks run before the early returns", () => {
  /**
   * **Nearly shipped, 17 Aug 2026.** The activity query and the mark-on-open
   * effect were first placed below `if (isLoading) return` / `if (error)
   * return` / `if (!data) return`, which makes them CONDITIONAL hook calls:
   * React sees a different number of hooks between renders and throws the
   * moment a task fails to load. Caught by the typechecker complaining about
   * something else entirely.
   */
  const src = readFileSync("components/features/tasks/TaskDetail.tsx", "utf8");
  const query = src.indexOf("readTaskTabActivity");
  const effect = src.indexOf("markTaskTabSeen");
  const firstReturn = src.indexOf("if (isLoading) return");
  assert.ok(query > 0 && effect > 0 && firstReturn > 0, "the wiring is gone");
  assert.ok(
    query < firstReturn,
    "the activity query sits below an early return — a conditional hook call",
  );
  assert.ok(
    effect < firstReturn,
    "the mark-on-open effect sits below an early return — a conditional hook call",
  );
});

test("the open tab never wears its own badge", () => {
  /* It is being read right now; a badge there would sit under the reader's
     eyes until they navigated away. */
  const src = readFileSync("components/features/tasks/TaskDetail.tsx", "utf8");
  assert.match(src, /if \(t\.id === tab\) return t;/);
});

test("a dot is shown only when there is no number", () => {
  /* Both at once would say the same thing twice. */
  const src = readFileSync("components/ui/Workspace.tsx", "utf8");
  assert.match(src, /t\.count !== undefined && t\.count > 0 \? \(/);
  assert.match(src, /\) : \(\s*\n?\s*t\.dot && \(/);
});
