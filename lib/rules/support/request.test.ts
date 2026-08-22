import assert from "node:assert/strict";
import { test } from "node:test";

import {
  EMPTY_SUPPORT_DRAFT,
  SUPPORT_TOPICS,
  SUPPORT_URGENCIES,
  supportDraftReady,
  supportReference,
  supportRefusals,
  type SupportDraft,
} from "./request.ts";

const complete: SupportDraft = {
  topic: "signin",
  subject: "Cannot sign in",
  detail: "My password is refused even though it works in the old app.",
  email: "ada@example.com",
  urgency: "blocking",
};

test("a complete draft is ready and refuses nothing", () => {
  assert.deepEqual(supportRefusals(complete), {});
  assert.equal(supportDraftReady(complete), true);
});

test("an empty draft names every missing field at once", () => {
  /* All of them, not the first: sending somebody round the loop one field at
     a time is three round trips for one form. */
  const r = supportRefusals(EMPTY_SUPPORT_DRAFT);
  assert.deepEqual(Object.keys(r).sort(), ["detail", "email", "subject", "topic"]);
  assert.equal(supportDraftReady(EMPTY_SUPPORT_DRAFT), false);
});

test("whitespace is not a subject, and not a description", () => {
  const r = supportRefusals({ ...complete, subject: "   ", detail: "   " });
  assert.ok(r.subject);
  assert.ok(r.detail);
});

test("a two-word description is refused with a question, not a rule number", () => {
  const r = supportRefusals({ ...complete, detail: "it broke" });
  assert.match(r.detail ?? "", /what did you expect/);
});

test("an address without an @ or a dot is refused", () => {
  assert.ok(supportRefusals({ ...complete, email: "ada" }).email);
  assert.ok(supportRefusals({ ...complete, email: "ada@localhost" }).email);
  assert.ok(supportRefusals({ ...complete, email: "a b@c.com" }).email);
});

test("an ordinary address with a plus tag or a subdomain is accepted", () => {
  /* A stricter pattern refuses addresses that genuinely exist, and the person
     it refuses is the one who cannot ask for help. */
  for (const email of ["a+support@example.co.in", "first.last@mail.example.com"])
    assert.equal(
      supportRefusals({ ...complete, email }).email,
      undefined,
      `${email} should be accepted`,
    );
});

test("the urgency defaults to the middle and is never missing", () => {
  assert.equal(EMPTY_SUPPORT_DRAFT.urgency, "normal");
  assert.equal(supportRefusals(EMPTY_SUPPORT_DRAFT).topic !== undefined, true);
});

test("every topic and urgency has a distinct id and a label", () => {
  const topicIds = SUPPORT_TOPICS.map((t) => t.id);
  assert.equal(new Set(topicIds).size, topicIds.length);
  for (const t of SUPPORT_TOPICS) assert.ok(t.label.length > 0);
  const urgencyIds = SUPPORT_URGENCIES.map((u) => u.id);
  assert.equal(new Set(urgencyIds).size, urgencyIds.length);
});

/* ── The reference ────────────────────────────────────────────────────────── */

test("a reference is stable for the same request", () => {
  /* It must not change when React re-draws the confirmation — a number that
     moves is one nobody can write down. */
  const a = supportReference(1_755_000_000_000, "Cannot sign in");
  const b = supportReference(1_755_000_000_000, "Cannot sign in");
  assert.equal(a, b);
});

test("a reference reads as one, and avoids letters that misread", () => {
  const ref = supportReference(1_755_000_000_000, "Cannot sign in");
  assert.match(ref, /^SUP-[A-HJ-NP-Z2-9]{4}$/);
});

test("different requests get different references", () => {
  const a = supportReference(1_755_000_000_000, "Cannot sign in");
  const b = supportReference(1_755_000_000_000, "Messages are slow");
  const c = supportReference(1_755_000_900_000, "Cannot sign in");
  assert.notEqual(a, b);
  assert.notEqual(a, c);
});
