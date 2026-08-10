import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { test } from "node:test";

/**
 * **The redirect loop between the shell and the middleware.**
 *
 * Reported as two screens alternating for ever — "Signing you in…" then
 * "Redirecting to sign in…" — with the sign-in form unreachable. The mechanism
 * is a disagreement between two correct-looking decisions:
 *
 *  1. `readIdentityPayload` writes the Firebase cookie BEFORE asking
 *     `/cowork/me`, so middleware's copy stays fresh through the SDK's silent
 *     refreshes. Right on its own.
 *  2. The engine refuses the token — an `auth` or `permission` answer, meaning
 *     this person is not an employee of this Cowork — and the session resolves
 *     `anonymous`. Also right on its own.
 *  3. The shell navigates to `/signin`. `proxy.ts` sees the still-valid cookie
 *     and redirects back to `/home`. Round and round.
 *
 * The person cannot reach the one page that would fix it. So the credential is
 * dropped where the refusal is handled, and the redirect lands where it was
 * aimed.
 */

const PROVIDER = readFileSync(
  "components/features/auth/SessionProvider.tsx",
  "utf8",
);
const PROXY = readFileSync("proxy.ts", "utf8");

function code(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

test("resolving anonymous drops the cookie that would bounce the redirect back", () => {
  const src = code(PROVIDER);
  const at = src.indexOf("if (!data.authenticated || !data.employeeId)");
  assert.ok(at > 0, "the anonymous branch is gone");
  const branch = src.slice(at, src.indexOf("return;", at));
  assert.match(
    branch,
    /clearFirebaseCookie\(\)/,
    "an anonymous resolution leaves a valid cookie behind, so /signin redirects " +
      "straight back to /home and the sign-in form is unreachable",
  );
  assert.match(branch, /clearCachedIdentity\(\)/);
});

test("an account the workspace refuses is told why, rather than bounced silently", () => {
  /**
   * The other half of the same fault, and the one that survives the loop being
   * fixed. A correct password for an account that is not an employee of this
   * Cowork lands back on the sign-in form having done everything right — and
   * with nothing said, that is indistinguishable from a button that did nothing.
   *
   * Only for `refused`. A browser that simply was not signed in has nothing to
   * explain, and greeting it with an error would be a lie about what happened.
   */
  const src = code(PROVIDER);
  const at = src.indexOf("if (!data.authenticated || !data.employeeId)");
  const branch = src.slice(at, src.indexOf("return;", at));
  assert.match(branch, /if \(data\.reason === "refused"\)\s*leaveSignInNotice\(/);

  /* And the form has to actually read it — a sentence left in storage that
     nothing displays is the silent bounce with extra steps. */
  const form = code(
    readFileSync("components/features/auth/SignInForm.tsx", "utf8"),
  );
  assert.match(form, /useState\(readSignInNotice\)/);
  assert.match(form, /InlineError message=\{\(error \?\? bounced\)!\}/);
  /* Read while rendering, cleared in an effect: a read that also removed would
     leave React's second development render with nothing to show. */
  assert.match(form, /useEffect\(clearSignInNotice, \[\]\)/);
});

test("the middleware still sends a signed-in browser away from /signin", () => {
  /* This half is correct and must stay: somebody with a live session who opens
     the sign-in page is asking for something they already have. It is only a
     trap when the app disagrees about whether the session is live, which is
     what the test above prevents. */
  assert.match(
    code(PROXY),
    /pathname === "\/signin"[\s\S]{0,120}redirect/,
    "the signed-in bounce is gone — check the loop guard above still makes sense",
  );
});
