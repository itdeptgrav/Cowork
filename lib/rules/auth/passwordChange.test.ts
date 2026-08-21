import assert from "node:assert/strict";
import { test } from "node:test";
import {
  MIN_PASSWORD_LENGTH,
  canSubmitPasswordChange,
  passwordChangeProblems,
  problemFor,
} from "./passwordChange.ts";

const ok = { current: "old-one", next: "brand-new", confirm: "brand-new" };

test("a well-formed change has nothing to say about it", () => {
  assert.deepEqual(passwordChangeProblems(ok), []);
  assert.equal(canSubmitPasswordChange(ok), true);
});

test("the current password is required — a session is not authority to change it", () => {
  const problems = passwordChangeProblems({ ...ok, current: "" });
  assert.equal(problemFor(problems, "current"), "Enter your current password.");
  assert.equal(canSubmitPasswordChange({ ...ok, current: "" }), false);
});

test("a new password shorter than the engine's minimum is refused here first", () => {
  const short = "a".repeat(MIN_PASSWORD_LENGTH - 1);
  const problems = passwordChangeProblems({
    current: "old-one",
    next: short,
    confirm: short,
  });
  assert.match(problemFor(problems, "next") ?? "", /at least 6 characters/);
});

test("exactly the minimum is accepted — the boundary is inclusive", () => {
  const exact = "a".repeat(MIN_PASSWORD_LENGTH);
  assert.deepEqual(
    passwordChangeProblems({ current: "old-one", next: exact, confirm: exact }),
    [],
  );
});

test("reusing the current password is refused", () => {
  const same = { current: "repeated", next: "repeated", confirm: "repeated" };
  assert.equal(
    problemFor(passwordChangeProblems(same), "next"),
    "Your new password must be different from your current one.",
  );
});

test("a too-short password is not ALSO reported as reused", () => {
  /* Both would be true for `next: "abc"` against `current: "abc"`. Saying two
     things about one field means the component picks one arbitrarily; the
     length is the one they can act on. */
  const problems = passwordChangeProblems({
    current: "abc",
    next: "abc",
    confirm: "abc",
  });
  const forNext = problems.filter((p) => p.field === "next");
  assert.equal(forNext.length, 1);
  assert.match(forNext[0]!.message, /at least 6 characters/);
});

test("a mismatched confirmation is reported", () => {
  const problems = passwordChangeProblems({ ...ok, confirm: "something-else" });
  assert.equal(
    problemFor(problems, "confirm"),
    "This does not match your new password.",
  );
});

test("an empty confirmation is not an error, but is not submittable either", () => {
  const typing = { ...ok, confirm: "" };
  assert.deepEqual(
    passwordChangeProblems(typing).filter((p) => p.field === "confirm"),
    [],
    "must not scold somebody for a field they have not reached",
  );
  assert.equal(canSubmitPasswordChange(typing), false);
});

test("every problem is reported at once, not one per attempt", () => {
  const problems = passwordChangeProblems({
    current: "",
    next: "abc",
    confirm: "xyz",
  });
  assert.deepEqual(
    problems.map((p) => p.field).sort(),
    ["confirm", "current", "next"],
  );
});
