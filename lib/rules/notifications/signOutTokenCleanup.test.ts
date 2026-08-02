import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

/**
 * Sign-out must drop this device's push token, and must do it first.
 *
 * Both properties fail silently if broken, which is why they are pinned here
 * rather than left to review:
 *
 * - **Removed at all.** A token identifies a browser, not an account. Left
 *   behind, it keeps delivering the previous person's notifications to whoever
 *   signs in next at that machine. Nothing on screen would ever explain it.
 * - **Removed BEFORE `firebaseSignOut`.** The Firestore write is authorised by
 *   the session being ended. Move it one line later and it is refused, the
 *   entry stays, and the only symptom is the leak above — the sign-out itself
 *   still looks perfectly successful.
 */

const SRC = readFileSync(
  "components/features/auth/SessionProvider.tsx",
  "utf8",
);

test("sign-out unregisters this device's push token", () => {
  assert.match(
    SRC,
    /unregisterFCMToken\(/,
    "signOut does not remove the FCM token — it would keep ringing for the previous person on this browser",
  );
});

test("it happens before the credential is dropped", () => {
  const unregister = SRC.indexOf("unregisterFCMToken(state.employeeId)");
  const signOut = SRC.indexOf("firebaseSignOut()");
  assert.ok(unregister > 0, "unregisterFCMToken is not called in signOut");
  assert.ok(signOut > 0, "firebaseSignOut is not called in signOut");
  assert.ok(
    unregister < signOut,
    "unregisterFCMToken runs after firebaseSignOut — the Firestore write needs the session it is cleaning up, so it would be refused and the token left behind",
  );
});

test("the token is invalidated at FCM, not only removed from Firestore", () => {
  /* FCM returns the SAME token for a browser forever. Removing the row without
     `deleteToken` means the next sign-in mints nothing new, `arrayUnion` is a
     no-op, and the document does not change — which is indistinguishable from
     the write never happening, and is exactly the "token not stored after
     logout and login" report this was written for. */
  const hook = readFileSync("lib/hooks/useFCMToken.ts", "utf8");
  assert.match(
    hook,
    /deleteToken\(/,
    "the token is not deleted at FCM, so a re-registration after sign-out writes the same value and appears to do nothing",
  );
  assert.match(
    hook,
    /arrayRemove\(/,
    "the token is not removed from the tokens array",
  );
  assert.match(
    hook,
    /deleteField\(\)/,
    "the per-device field is not cleared, leaving a dead token pointing at this machine",
  );
});
