import assert from "node:assert/strict";
import { test } from "node:test";
import { clusterSubmissionAttempts } from "./submissionAttempts.ts";

const f = (name: string, uploadedAt: string | null) => ({ name, uploadedAt });
const rw = (requestedAt: string) => ({ requestedAt });
/** 2 Sep 2026, at HH:MM IST — the shape the reported case used. */
const t = (hhmm: string) => `2026-09-02T${hhmm}:00+05:30`;
const names = (attempts: { files: { name: string }[] }[]) =>
  attempts.map((a) => a.files.map((x) => x.name));

test("one burst of files is a single current attempt", () => {
  /* Same submit: uploads seconds apart, nothing to break them. */
  const attempts = clusterSubmissionAttempts(
    [f("a", t("10:00")), f("b", `2026-09-02T10:00:08+05:30`)],
    [],
  );
  assert.equal(attempts.length, 1);
  assert.equal(attempts[0].isCurrent, true);
  assert.deepEqual(names(attempts), [["a", "b"]]);
});

test("a minutes-long gap splits attempts even with NO rework recorded", () => {
  /* The reported case: three files at 17:15, 17:21, 17:52 — three submits, no
     rework records came back, yet they must not read as one submission. */
  const attempts = clusterSubmissionAttempts(
    [
      f("Invoice.pdf", t("17:15")),
      f("testing-sa.json", t("17:21")),
      f("prod-sa.json", t("17:52")),
    ],
    [],
  );
  assert.deepEqual(names(attempts), [
    ["Invoice.pdf"],
    ["testing-sa.json"],
    ["prod-sa.json"],
  ]);
  assert.deepEqual(
    attempts.map((a) => a.isCurrent),
    [false, false, true],
  );
});

test("only the last attempt is current", () => {
  const attempts = clusterSubmissionAttempts(
    [f("a", t("10:00")), f("b", t("10:30")), f("c", t("11:00"))],
    [],
  );
  assert.deepEqual(
    attempts.map((a) => a.attempt),
    [1, 2, 3],
  );
  assert.equal(attempts.at(-1)?.isCurrent, true);
  assert.equal(attempts[0].isCurrent, false);
});

test("a rework between two close uploads also starts a new attempt", () => {
  /* Even inside the gap window, a recorded rework is a hard boundary — and it is
     attached to the attempt it ended. */
  const attempts = clusterSubmissionAttempts(
    [f("a", t("10:00")), f("b", `2026-09-02T10:00:30+05:30`)],
    [rw(`2026-09-02T10:00:15+05:30`)],
  );
  assert.deepEqual(names(attempts), [["a"], ["b"]]);
  assert.ok(attempts[0].rework, "the first attempt carries the rework that ended it");
  assert.equal(attempts[1].rework, null);
});

test("multiple files within one submit stay together", () => {
  const attempts = clusterSubmissionAttempts(
    [
      f("a1", t("10:00")),
      f("a2", `2026-09-02T10:00:05+05:30`),
      f("b1", t("11:00")),
    ],
    [],
  );
  assert.deepEqual(names(attempts), [["a1", "a2"], ["b1"]]);
});

test("an undated file falls to the current attempt rather than vanishing", () => {
  const attempts = clusterSubmissionAttempts(
    [f("dated", t("10:00")), f("later", t("11:00")), f("undated", null)],
    [],
  );
  assert.deepEqual(names(attempts), [["dated"], ["later", "undated"]]);
});

test("no files at all is one empty current attempt", () => {
  const attempts = clusterSubmissionAttempts([], []);
  assert.equal(attempts.length, 1);
  assert.equal(attempts[0].isCurrent, true);
  assert.deepEqual(attempts[0].files, []);
});
