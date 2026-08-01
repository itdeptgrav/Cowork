import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import {
  allRecipients,
  mailVisibleTo,
  maySeeBcc,
  recipientRefusal,
  redactBcc,
  redactBccAll,
  threadParticipants,
} from "./blindCopy.ts";
import type { MailMessage, MailParty } from "../../domain/index.ts";

const emp = (id: string): MailParty => ({
  kind: "employee",
  employeeId: id,
  address: `${id.toLowerCase()}@grav.in`,
  displayName: id,
});
const ext = (address: string): MailParty => ({
  kind: "external",
  employeeId: null,
  address,
  displayName: address,
});

/** Only the fields the rule reads. */
const msg = (over: Partial<Pick<MailMessage, "from" | "to" | "cc" | "bcc">> = {}) => ({
  from: emp("SENDER"),
  to: [emp("TO")],
  cc: [emp("CC")],
  bcc: [emp("BCC")],
  ...over,
});

/* ── The blind half ───────────────────────────────────────────────────────── */

test("the sender sees who they blind-copied", () => {
  /* A blind copy nobody can audit afterwards is a different problem. */
  const m = msg();
  assert.equal(maySeeBcc(m, "SENDER"), true);
  assert.deepEqual(redactBcc(m, "SENDER").bcc, [emp("BCC")]);
});

test("nobody else does — including the other blind-copied people", () => {
  for (const viewer of ["TO", "CC", "BCC", "STRANGER", null]) {
    assert.equal(maySeeBcc(msg(), viewer), false, `${viewer} could see bcc`);
    assert.deepEqual(redactBcc(msg(), viewer).bcc, [], `${viewer} got the list`);
  }
});

test("a bcc'd person cannot see the OTHER bcc'd people", () => {
  /* The failure that makes a bcc'd list into a disclosed one: everybody
     blind-copied learns who else was. */
  const m = msg({ bcc: [emp("BCC1"), emp("BCC2")] });
  assert.deepEqual(redactBcc(m, "BCC1").bcc, []);
});

test("redaction is indistinguishable from having had no bcc", () => {
  /* If a reader could tell "empty" from "hidden", the absence of the field
     would itself be the signal that there was one. */
  const hidden = redactBcc(msg(), "TO");
  const none = redactBcc(msg({ bcc: [] }), "TO");
  assert.deepEqual(hidden.bcc, none.bcc);
  assert.deepEqual(hidden.bcc, []);
});

/* ── The delivered half ───────────────────────────────────────────────────── */

test("a blind-copied person can still open their own mail", () => {
  /* The other direction of the same rule. Leaving bcc out of the visibility
     check delivers a message its recipient cannot read — not a blind copy but
     a lost one. */
  assert.equal(mailVisibleTo(msg(), "BCC"), true);
  assert.equal(mailVisibleTo(msg(), "TO"), true);
  assert.equal(mailVisibleTo(msg(), "CC"), true);
  assert.equal(mailVisibleTo(msg(), "SENDER"), true);
  assert.equal(mailVisibleTo(msg(), "STRANGER"), false);
  assert.equal(mailVisibleTo(msg(), null), false);
});

test("allRecipients spans every field", () => {
  assert.deepEqual(
    allRecipients(msg()).map((p) => p.employeeId),
    ["TO", "CC", "BCC"],
  );
});

/* ── The thread must not leak it ──────────────────────────────────────────── */

test("thread participants never include the blind-copied", () => {
  /* The thread list and its search both read participants. Putting bcc there
     discloses it to everybody on the conversation. */
  const parties = threadParticipants(emp("SENDER"), [emp("TO")], [emp("CC")]);
  assert.deepEqual(
    parties.map((p) => p.employeeId),
    ["SENDER", "TO", "CC"],
  );
});

test("thread participants dedupe by address", () => {
  const parties = threadParticipants(emp("A"), [emp("A"), emp("B")], [emp("B")]);
  assert.deepEqual(
    parties.map((p) => p.employeeId),
    ["A", "B"],
  );
});

/* ── Refusals ─────────────────────────────────────────────────────────────── */

test("somebody in both To and Bcc is refused", () => {
  /* Two copies, and a "blind" copy of a person the message already names —
     which is a visible copy plus a second delivery, not a blind one. */
  const why = recipientRefusal({ to: [emp("A")], cc: [], bcc: [emp("A")] });
  assert.match(why ?? "", /both To and Bcc/);
});

test("somebody in both Cc and Bcc is refused", () => {
  const why = recipientRefusal({ to: [emp("X")], cc: [emp("A")], bcc: [emp("A")] });
  assert.match(why ?? "", /both Cc and Bcc/);
});

test("a Bcc-only message is allowed", () => {
  /* Mailing a list without disclosing it is the usual reason to reach for Bcc,
     and it has an empty To by design. */
  assert.equal(recipientRefusal({ to: [], cc: [], bcc: [emp("A")] }), null);
});

test("a message addressed to nobody at all is refused", () => {
  assert.equal(
    recipientRefusal({ to: [], cc: [], bcc: [] }),
    "Choose at least one recipient.",
  );
});

test("an external address is matched by address, not by employee id", () => {
  /* Both external parties have a null employeeId, so an id-based dedupe would
     see them as the same person. */
  const why = recipientRefusal({
    to: [ext("a@x.com")],
    cc: [],
    bcc: [ext("b@x.com")],
  });
  assert.equal(why, null);
});

/* ── Every read path redacts ──────────────────────────────────────────────── */

test("redactBccAll maps the whole list", () => {
  const out = redactBccAll([msg(), msg()], "TO");
  assert.deepEqual(out.map((m) => m.bcc), [[], []]);
});

test("both repositories redact on the message read path", () => {
  /* The rule cannot enforce its own use — the field is on the type, so this
     asserts the discipline instead: every `listMailMessages` calls redactBcc.
     Comments stripped first, so mentioning it in prose cannot satisfy this. */
  const code = (p: string) =>
    readFileSync(p, "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
  for (const p of [
    "lib/repositories/mock/index.ts",
    "lib/repositories/legacy/index.ts",
  ]) {
    const src = code(p);
    const at = src.indexOf("listMailMessages");
    assert.ok(at > 0, `${p} has no listMailMessages`);
    const body = src.slice(at, at + 1400);
    assert.match(body, /redactBcc/, `${p} listMailMessages does not redact bcc`);
  }
});
