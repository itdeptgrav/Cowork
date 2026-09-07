import assert from "node:assert/strict";
import { test } from "node:test";
import { eventByViewer } from "./eventSide.ts";

const PEOPLE = [
  { id: "GR0045", displayName: "KRISHNA BEHERA" },
  { id: "GR0108", displayName: "Umung Arora" },
];

test("a submission is sided by the id it was posted under", () => {
  /* The engine posts a submission AS the submitter, so the sender is the
     actor and no name matching is needed. */
  assert.equal(
    eventByViewer({
      actorId: "GR0045",
      viewerId: "GR0045",
      people: PEOPLE,
    }),
    true,
  );
  assert.equal(
    eventByViewer({
      actorId: "GR0045",
      viewerId: "GR0108",
      people: PEOPLE,
    }),
    false,
  );
});

test("a rework is sided by the name the engine wrote into the line", () => {
  /* Posted as `system`, so the only trace of the reviewer is their name. */
  assert.equal(
    eventByViewer({
      actorName: "Umung Arora",
      viewerId: "GR0108",
      people: PEOPLE,
    }),
    true,
  );
  assert.equal(
    eventByViewer({
      actorName: "Umung Arora",
      viewerId: "GR0045",
      people: PEOPLE,
    }),
    false,
  );
});

test("the name match ignores case and surrounding space", () => {
  /* The engine's casing is not something this can depend on — the same person
     appears as "KRISHNA BEHERA" in one line and "Krishna Behera" in another. */
  assert.equal(
    eventByViewer({
      actorName: "  krishna behera ",
      viewerId: "GR0045",
      people: PEOPLE,
    }),
    true,
  );
});

test("two people sharing a display name resolve to neither", () => {
  /* An ambiguous name is unresolved, not resolved to whoever is first: putting
     a reviewer's decision on the assignee's side is worse than centring it. */
  const twins = [
    { id: "GR0045", displayName: "Alex Ray" },
    { id: "GR0099", displayName: "Alex Ray" },
  ];
  assert.equal(
    eventByViewer({ actorName: "Alex Ray", viewerId: "GR0045", people: twins }),
    false,
  );
});

test("an unknown name is not the viewer", () => {
  assert.equal(
    eventByViewer({
      actorName: "Somebody Else",
      viewerId: "GR0045",
      people: PEOPLE,
    }),
    false,
  );
});

test("no viewer yet keeps every card on the leading edge", () => {
  /* Otherwise every card flips sides the moment the identity read lands. */
  assert.equal(
    eventByViewer({ actorId: "GR0045", viewerId: null, people: PEOPLE }),
    false,
  );
});

test("a nameless line is not attributed", () => {
  /* An older rework the parser could not read a name out of. */
  assert.equal(
    eventByViewer({ actorName: "", viewerId: "GR0045", people: PEOPLE }),
    false,
  );
  assert.equal(
    eventByViewer({ viewerId: "GR0045", people: PEOPLE }),
    false,
  );
});

test("the literal sender `system` is never the viewer", () => {
  assert.equal(
    eventByViewer({ actorId: "system", viewerId: "GR0045", people: PEOPLE }),
    false,
  );
});
