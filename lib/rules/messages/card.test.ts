import assert from "node:assert/strict";
import { test } from "node:test";
import {
  readMessageCard,
  messageCardForWrite,
  cardPreview,
  togglePollVote,
  pollVoterCount,
} from "./card.ts";
import type { MessagePollOption } from "@/lib/domain";

test("readMessageCard reads a location, defaulting a missing label to null", () => {
  assert.deepEqual(readMessageCard({ kind: "location", lat: 12.3, lng: 45.6 }), {
    kind: "location",
    lat: 12.3,
    lng: 45.6,
    label: null,
  });
  assert.equal(readMessageCard({ kind: "location", lat: "x", lng: 1 }), undefined);
});

test("readMessageCard reads a contact, requiring only a name", () => {
  assert.deepEqual(
    readMessageCard({ kind: "contact", name: "Pramod", employeeId: "e1", role: "Eng" }),
    { kind: "contact", employeeId: "e1", name: "Pramod", role: "Eng", email: null, phone: null },
  );
  assert.equal(readMessageCard({ kind: "contact", name: "  " }), undefined);
});

test("readMessageCard reads a poll only with a question and two+ options", () => {
  const poll = readMessageCard({
    kind: "poll",
    question: "Lunch?",
    multiple: true,
    options: [
      { id: "a", text: "Pizza", votes: ["e1", "e1"] },
      { id: "b", text: "Sushi" },
      { bad: true },
    ],
  });
  assert.equal(poll?.kind, "poll");
  assert.equal(poll?.kind === "poll" && poll.multiple, true);
  assert.deepEqual(poll?.kind === "poll" && poll.options.map((o) => o.id), ["a", "b"]);
  assert.deepEqual(poll?.kind === "poll" && poll.options[0].votes, ["e1"]); // deduped
  // one option is not a poll
  assert.equal(readMessageCard({ kind: "poll", question: "?", options: [{ id: "a", text: "x" }] }), undefined);
});

test("readMessageCard rejects unknown or malformed input", () => {
  assert.equal(readMessageCard(null), undefined);
  assert.equal(readMessageCard({ kind: "sticker" }), undefined);
  assert.equal(readMessageCard("nope"), undefined);
});

test("messageCardForWrite writes explicit nulls, never undefined", () => {
  const body = messageCardForWrite({
    kind: "contact",
    employeeId: null,
    name: "Ann",
    role: null,
    email: null,
    phone: null,
  });
  assert.equal(Object.values(body).includes(undefined), false);
  assert.equal(body.employeeId, null);
  assert.equal(body.name, "Ann");
});

test("cardPreview names each kind", () => {
  assert.equal(cardPreview({ kind: "location", lat: 1, lng: 2, label: "Office" }), "Location · Office");
  assert.equal(cardPreview({ kind: "location", lat: 1, lng: 2, label: null }), "Location");
  assert.equal(cardPreview({ kind: "contact", employeeId: null, name: "Ann", role: null, email: null, phone: null }), "Contact · Ann");
  assert.equal(cardPreview({ kind: "poll", question: "Lunch?", options: [], multiple: false }), "Poll · Lunch?");
});

const opts = (): MessagePollOption[] => [
  { id: "a", text: "A", votes: [] },
  { id: "b", text: "B", votes: [] },
];

test("togglePollVote adds, toggles off, and (single-choice) replaces", () => {
  let o = togglePollVote(opts(), "a", "e1", false);
  assert.deepEqual(o.map((x) => x.votes), [["e1"], []]);
  // same option again → removed
  o = togglePollVote(o, "a", "e1", false);
  assert.deepEqual(o.map((x) => x.votes), [[], []]);
  // pick a, then b, single-choice → only b
  o = togglePollVote(togglePollVote(opts(), "a", "e1", false), "b", "e1", false);
  assert.deepEqual(o.map((x) => x.votes), [[], ["e1"]]);
});

test("togglePollVote on a multiple-choice poll keeps both", () => {
  const o = togglePollVote(togglePollVote(opts(), "a", "e1", true), "b", "e1", true);
  assert.deepEqual(o.map((x) => x.votes), [["e1"], ["e1"]]);
});

test("pollVoterCount counts distinct voters across options", () => {
  const o: MessagePollOption[] = [
    { id: "a", text: "A", votes: ["e1", "e2"] },
    { id: "b", text: "B", votes: ["e2", "e3"] },
  ];
  assert.equal(pollVoterCount(o), 3);
});
