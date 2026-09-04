import assert from "node:assert/strict";
import { test } from "node:test";
import {
  activeMention,
  matchMentions,
  insertMention,
  mentionToken,
  resolveMentionIds,
  mentionSegments,
} from "./mentions.ts";

const people = [
  { id: "e1", displayName: "Pramod Biswal" },
  { id: "e2", displayName: "Soumya Ray" },
  { id: "e3", displayName: "Ann Marie" },
  { id: "e4", displayName: "Ann" },
];

test("activeMention finds the @-query, but not an email's @", () => {
  // caret after "hi @pra"
  assert.deepEqual(activeMention("hi @pra", 7), { start: 3, query: "pra" });
  // @ at start
  assert.deepEqual(activeMention("@so", 3), { start: 0, query: "so" });
  // an email's @ does not open a token (preceded by a non-space)
  assert.equal(activeMention("mail me@x.com", 13), null);
  // a newline in the run ends it
  assert.equal(activeMention("@a\nb", 4), null);
});

test("matchMentions matches every whitespace term, case-insensitively", () => {
  assert.deepEqual(matchMentions(people, "pra").map((p) => p.id), ["e1"]);
  assert.deepEqual(matchMentions(people, "ann").map((p) => p.id), ["e3", "e4"]);
  assert.deepEqual(matchMentions(people, "soumya ray").map((p) => p.id), ["e2"]);
});

test("insertMention replaces the token, no double space before existing text", () => {
  // Following " rest" already has a space, so none is added.
  const r = insertMention("hi @pra rest", 7, 3, people[0]);
  assert.equal(r.text, "hi @Pramod Biswal rest");
  assert.equal(r.caret, "hi @Pramod Biswal".length);
  // At end of text, a trailing space IS added.
  const end = insertMention("hi @pra", 7, 3, people[0]);
  assert.equal(end.text, "hi @Pramod Biswal ");
  assert.equal(end.caret, "hi @Pramod Biswal ".length);
});

test("resolveMentionIds keeps a pick only while its token survives", () => {
  const picks = [
    { id: "e1", token: mentionToken(people[0]) },
    { id: "e2", token: mentionToken(people[1]) },
  ];
  assert.deepEqual(resolveMentionIds("hi @Pramod Biswal", picks), ["e1"]);
  assert.deepEqual(resolveMentionIds("hi @Pramod Biswal @Soumya Ray", picks).sort(), ["e1", "e2"]);
  assert.deepEqual(resolveMentionIds("nobody here", picks), []);
});

test("mentionSegments highlights the longest matching token first", () => {
  const segs = mentionSegments("hey @Ann Marie and @Ann", ["@Ann", "@Ann Marie"]);
  const mentions = segs.filter((s) => s.mention).map((s) => s.text);
  assert.deepEqual(mentions, ["@Ann Marie", "@Ann"]);
  // no tokens → one plain segment
  assert.deepEqual(mentionSegments("plain", []), [{ text: "plain", mention: false }]);
});
