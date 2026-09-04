import assert from "node:assert/strict";
import { test } from "node:test";
import { sheetsLoadError, sheetsLoadRetryable } from "./loadError.ts";

test("signing in is named as the fix when that is the fix", () => {
  assert.equal(sheetsLoadError("unauthorized"), "Sign in to see your sheets.");
});

test("a 404 on the listing says the SERVICE is missing, not the sheets", () => {
  /* The reported case: `/cowork/workbooks` answers 404 on the running engine
     while every sibling route answers 401. The old line said "Couldn't load
     your sheets", which reads as "your sheets are gone". */
  const m = sheetsLoadError("not-found");
  assert.match(m, /aren’t available on this server/);
  assert.match(m, /Nothing of yours is lost/);
  assert.doesNotMatch(m, /Couldn’t load your sheets/);
});

test("each kind gets its own sentence", () => {
  const kinds = [
    "unauthorized",
    "not-found",
    "forbidden",
    "network",
    "server",
  ] as const;
  const seen = kinds.map((k) => sheetsLoadError(k));
  assert.equal(new Set(seen).size, kinds.length);
  /* None of them falls through to the sentence that started this. */
  for (const m of seen) assert.notEqual(m, "Couldn’t load your sheets.");
});

test("an unrecognised failure still says something true", () => {
  assert.equal(sheetsLoadError(null), "Couldn’t load your sheets.");
  assert.equal(sheetsLoadError("conflict"), "Couldn’t load your sheets.");
  assert.equal(sheetsLoadError("bad-request"), "Couldn’t load your sheets.");
});

test("retry is offered only where pressing it could work", () => {
  /* A missing endpoint is still missing on the next press, and a signed-out
     reader needs to sign in rather than retry. */
  assert.equal(sheetsLoadRetryable("network"), true);
  assert.equal(sheetsLoadRetryable("server"), true);
  assert.equal(sheetsLoadRetryable(null), true);
  assert.equal(sheetsLoadRetryable("not-found"), false);
  assert.equal(sheetsLoadRetryable("unauthorized"), false);
  assert.equal(sheetsLoadRetryable("forbidden"), false);
});
