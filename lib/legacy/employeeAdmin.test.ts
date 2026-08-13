import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { generateTempPassword } from "./employeeAdmin.ts";

/**
 * Admin account actions: creating one, and rescuing one.
 *
 * The second is why this file exists. Everything on the Add employees panel was
 * about accounts that do NOT yet exist, so somebody who already had one — locked
 * out, forgotten password, a welcome email that never arrived — hit a green
 * "Linked" chip and nothing to press, and the answer was to open the Firebase
 * console.
 */

test("a temporary password is random, long enough, and readable aloud", () => {
  /**
   * **No lookalikes.** This is transcribed from a message or read down a phone
   * line, and `l1I` / `0O` in a password somebody has to type is a support
   * request per use. Twelve characters from a 30-symbol alphabet is ~59 bits,
   * far beyond what a password living for one sign-in needs.
   */
  const seen = new Set<string>();
  for (let i = 0; i < 200; i++) {
    const pw = generateTempPassword();
    /* Three readable groups, not one run of twelve. */
    assert.match(pw, /^[a-z2-9]{4}-[a-z2-9]{4}-[a-z2-9]{4}$/, pw);
    assert.ok(
      !/[l1io0]/.test(pw),
      `a lookalike character got into a password somebody has to type: ${pw}`,
    );
    /* The engine refuses anything under six characters; this is comfortably
       past it even counting only the letters. */
    assert.ok(pw.replace(/-/g, "").length >= 6);
    seen.add(pw);
  }
  assert.equal(seen.size, 200, "two draws collided — this is not random");
});

test("the password is drawn from crypto, never Math.random", () => {
  /* A predictable temporary password is a way into somebody's account, and the
     modulo bias of a naive mapping is why the biased tail of each byte is
     rejected rather than folded in. */
  const src = readFileSync("lib/legacy/employeeAdmin.ts", "utf8")
    /* Comments mention `Math.random` to say it is not used; the code is what
       is being asserted about. */
    .replace(/\/\*[\s\S]*?\*\//g, "");
  assert.match(src, /crypto\.getRandomValues/);
  assert.ok(!/Math\.random/.test(src));
  assert.match(src, /if \(b >= limit\) continue;/);
});

test("the reset addresses the CoWork account, not the HR record", () => {
  /**
   * **The two ids are not the same thing, and confusing them would sign the
   * wrong person out.** A biometric id becomes the CoWork id where one exists,
   * but an account provisioned without one is matched by email and given a
   * generated id. The engine answers with the document it actually matched, and
   * the button is only offered where it did.
   */
  const src = readFileSync("lib/legacy/employeeAdmin.ts", "utf8");
  assert.match(src, /coworkEmployeeId: string \| null;/);
  assert.match(
    src,
    /path: `\/cowork\/employee\/\$\{encodeURIComponent\(input\.employeeId\)\}\/reset-password`/,
  );

  const panel = readFileSync(
    "components/features/admin/AddFromHrPanel.tsx",
    "utf8",
  );
  assert.match(
    panel,
    /done && emp\.coworkEmployeeId && \(/,
    "the reset is offered without knowing which account it would hit",
  );
  assert.ok(
    !/employeeId=\{emp\.biometricId\}/.test(panel),
    "the biometric id is being passed as the account id again",
  );
});

test("a row HR cannot describe fully is not offered Add", () => {
  /**
   * **The refusal used to arrive after the click.** HR records one address per
   * person under either `email` or `personalEmail` and fills whichever it was
   * given; the engine read only the first, so half the directory arrived
   * looking address-less. The row showed a blank where the address goes,
   * offered Add anyway, and the engine answered "Name, email and department are
   * required" — naming a department it had all along, and an email HR was
   * holding under the other field.
   *
   * The engine now resolves both addresses and says what is genuinely absent.
   * What is left is a record only HR can fix, so the row says so instead.
   */
  const panel = readFileSync(
    "components/features/admin/AddFromHrPanel.tsx",
    "utf8",
  );

  /* No button where there is nothing a click could achieve. */
  assert.match(panel, /gaps\.length === 0 \? \(/);
  assert.match(panel, /Add \{listGaps\(gaps\)\} in HR/);
  /* And the blank that used to render as a bare "· GR0123" now says why. */
  assert.match(panel, /No email in HR/);

  /* Not sweepable into a bulk create that would half-fail on them. */
  assert.match(panel, /disabled=\{pending \|\| gaps\.length > 0\}/);
  assert.match(
    panel,
    /hrGaps\(e\)\.length === 0 && statuses\.get\(e\.hrId\)\?\.kind !== "done"/,
    "Select all no longer excludes rows the engine cannot provision",
  );
  assert.match(
    panel,
    /selected\.has\(e\.hrId\) && !e\.hasCoworkAccount && hrGaps\(e\)\.length === 0/,
    "the bulk create no longer excludes rows the engine cannot provision",
  );

  /* An empty selectable set must not read as "all selected" — a ticked box
     over nothing, where every row needs HR edited first. */
  assert.match(panel, /selectable\.length > 0 &&\s*selectable\.every/);
});

test("an engine that predates missingInHr leaves every row addable", () => {
  /* The engine deploys separately. Absent means "this engine does not report
     gaps", which is how the panel behaved before — not "every row is broken",
     which would take Add away from the whole list. */
  const src = readFileSync("lib/legacy/employeeAdmin.ts", "utf8");
  assert.match(src, /missingInHr\?: string\[\];/);

  const panel = readFileSync(
    "components/features/admin/AddFromHrPanel.tsx",
    "utf8",
  );
  assert.match(panel, /return emp\.missingInHr \?\? \[\];/);
});

test("what the reset costs is stated before it is done, not after", () => {
  /* It revokes every refresh token the person holds: they are signed out of
     every device within moments, mid-task if they were working. An admin should
     read that on the button, not discover it from the person they just cut
     off. */
  const dialog = readFileSync(
    "components/features/admin/ResetPasswordDialog.tsx",
    "utf8",
  );
  assert.match(dialog, /signs \{displayName\} out of every device immediately/);
  assert.match(dialog, /Reset and sign them out/);
  /* And the new password is shown afterwards, because somebody has to pass it
     on — the engine's email is not always the fastest route. */
  assert.match(dialog, /navigator\.clipboard/);
});
