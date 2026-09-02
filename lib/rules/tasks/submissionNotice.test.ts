import assert from "node:assert/strict";
import { test } from "node:test";
import { parseSubmissionNotice } from "./submissionNotice.ts";

test("parses the submission line — who, and their note", () => {
  const got = parseSubmissionNotice(
    "✅ Pramod Biswal submitted work for completion review.\nmeeting done",
  );
  assert.deepEqual(got, { byName: "Pramod Biswal", note: "meeting done" });
});

test("a submission with no note parses to an empty note", () => {
  const got = parseSubmissionNotice(
    "✅ Pramod Biswal submitted work for completion review.",
  );
  assert.equal(got?.byName, "Pramod Biswal");
  assert.equal(got?.note, "");
});

test("tolerates a missing emoji", () => {
  const got = parseSubmissionNotice(
    "Rakesh submitted work for completion review.\nall done",
  );
  assert.equal(got?.byName, "Rakesh");
  assert.equal(got?.note, "all done");
});

test("a multi-line note is kept whole", () => {
  const got = parseSubmissionNotice(
    "✅ X submitted work for completion review.\nline one\nline two",
  );
  assert.equal(got?.note, "line one\nline two");
});

test("anything else is null — an ordinary message stays a bubble", () => {
  assert.equal(parseSubmissionNotice("meeting done"), null);
  assert.equal(parseSubmissionNotice("🔄 X sent this task back for rework (rework #1)."), null);
  assert.equal(parseSubmissionNotice(""), null);
});
