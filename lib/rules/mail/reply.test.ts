import assert from "node:assert/strict";
import { test } from "node:test";
import type { MailMessage, MailParty } from "@/lib/domain";
import { replySeed } from "./reply.ts";

const emp = (id: string): MailParty => ({
  kind: "employee",
  employeeId: id,
  address: `${id}@cowork.local`,
  displayName: id,
});

const base: Pick<MailMessage, "from" | "to" | "cc"> = {
  from: emp("A"),
  to: [emp("B"), emp("C")],
  cc: [emp("D")],
};

const addrs = (ps: MailParty[]) => ps.map((p) => p.employeeId).sort();

test("Reply goes to the sender and keeps the Cc", () => {
  const seed = replySeed("reply", base, "B");
  assert.deepEqual(addrs(seed.to), ["A"]);
  assert.deepEqual(addrs(seed.cc), ["D"]);
});

test("Reply All adds everyone who was in To, minus the viewer", () => {
  const seed = replySeed("replyAll", base, "B");
  // B is the viewer, so B drops out of To; A (sender) and C remain.
  assert.deepEqual(addrs(seed.to), ["A", "C"]);
  assert.deepEqual(addrs(seed.cc), ["D"]);
});

test("Reply All never addresses YOU, in To or Cc", () => {
  const seed = replySeed("replyAll", { ...base, cc: [emp("D"), emp("B")] }, "B");
  assert.ok(!addrs(seed.to).includes("B"));
  assert.ok(!addrs(seed.cc).includes("B"));
});

test("a person in both To and Cc is not doubled; Cc yields to To", () => {
  const seed = replySeed(
    "replyAll",
    { from: emp("A"), to: [emp("C")], cc: [emp("C"), emp("D")] },
    "B",
  );
  assert.deepEqual(addrs(seed.to), ["A", "C"]);
  assert.deepEqual(addrs(seed.cc), ["D"], "C already in To is not re-Cc'd");
});

test("Forward pre-fills nobody", () => {
  const seed = replySeed("forward", base, "B");
  assert.deepEqual(seed.to, []);
  assert.deepEqual(seed.cc, []);
});

test("bcc is never carried into a reply, even when present on the source", () => {
  const withBcc = { ...base, bcc: [emp("Z")] } as unknown as Pick<
    MailMessage,
    "from" | "to" | "cc"
  >;
  const seed = replySeed("replyAll", withBcc, "B");
  assert.ok(!addrs(seed.to).includes("Z"));
  assert.ok(!addrs(seed.cc).includes("Z"));
});
