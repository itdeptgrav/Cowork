#!/usr/bin/env node
/**
 * What is actually in a Firebase project.
 *
 * The companion to `firebase-copy.mjs`, and worth having separately: a copy
 * script reporting its own success is the one witness you should not rely on.
 * This connects fresh, counts what is there, and checks the one join the whole
 * product depends on.
 *
 * **Read-only.** No write method is called anywhere in this file.
 *
 *   node scripts/firebase-inspect.mjs --key D:/secrets/testing-sa.json
 *
 * Flags:
 *   --key PATH    service-account JSON for the project to inspect  (required)
 *   --no-auth     skip the Auth listing (it is the slow part on a big project)
 */

import { readFileSync } from "node:fs";
import { cert, deleteApp, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

const args = process.argv.slice(2);
const keyPath = args[args.indexOf("--key") + 1];
const skipAuth = args.includes("--no-auth");

if (!keyPath || keyPath.startsWith("--")) {
  console.error("\n  ✖ --key PATH is required (a service-account JSON).\n");
  process.exit(1);
}

let key;
try {
  key = JSON.parse(readFileSync(keyPath, "utf8"));
} catch (e) {
  console.error(`\n  ✖ Could not read ${keyPath}: ${e.message}\n`);
  process.exit(1);
}

const app = initializeApp({ credential: cert(key) }, "inspect");
console.log(`\n── ${key.project_id} ──────────────────────────────────────\n`);

let authUids = null;

try {
  if (!skipAuth) {
    /**
     * **`listUsers` can throw on a record it cannot deserialise, and one bad
     * record takes the whole page with it.**
     *
     * A phone-provider account imported into a project where Phone
     * authentication is switched off comes back as
     * `INTERNAL ASSERT FAILED: Invalid user info response` — the account is
     * there and perfectly fine, the SDK just cannot build a `UserInfo` for a
     * provider the project does not have enabled.
     *
     * Reported rather than swallowed, and rather than allowed to kill the run:
     * the interesting question is not "can this list be enumerated" but "can
     * the people who need to sign in, sign in", and that is answered per
     * employee further down whether or not this succeeds.
     */
    try {
      const users = [];
      let token;
      do {
        const page = await getAuth(app).listUsers(1000, token);
        users.push(...page.users);
        token = page.pageToken;
      } while (token);
      authUids = new Set(users.map((u) => u.uid));
      const withPassword = users.filter((u) => u.passwordHash).length;
      console.log(`Auth users            ${users.length}`);
      console.log(`  can use a password  ${withPassword}`);
      console.log(
        `  federated / no pw   ${users.length - withPassword}` +
        `   (Google or phone sign-in, or never set one)`,
      );
    } catch (e) {
      console.log(`Auth users            could not be listed`);
      console.log(`  ${e.message.slice(0, 72)}`);
      console.log(
        `  This is usually a phone-provider account in a project where Phone\n` +
        `  authentication is disabled. It does NOT affect email/password\n` +
        `  sign-in — the per-employee check below is the one that matters.`,
      );
    }
  }

  const db = getFirestore(app);
  const collections = await db.listCollections();
  console.log(`\nFirestore collections ${collections.length}`);
  if (collections.length === 0) console.log("  (empty)");
  for (const c of collections) {
    /* `count()` is an aggregation query: one billed read per 1000 documents
       rather than one per document, so this stays cheap on a full database. */
    const snap = await c.count().get();
    console.log(`  ${c.id.padEnd(34)} ${String(snap.data().count).padStart(7)}`);
  }

  /**
   * The join that decides whether anybody can sign in.
   *
   * `Middlewear/coworkAuth.js` verifies the Firebase token, then finds the
   * caller in `cowork_employees` by `authUid` — and refuses with "Employee not
   * found in Firestore. Ask your CEO." when it cannot. So an Auth account and
   * an employee row are each individually useless; it is the link between them
   * that is the login. Counting rows on either side would report a healthy
   * project that nobody can get into.
   */
  const employees = await db.collection("cowork_employees").get();
  if (!employees.empty) {
    console.log(`\nSign-in readiness`);
    console.log(`  employee rows                 ${employees.size}`);

    /* Asked one row at a time, deliberately. `getUser` on a single uid answers
       for that person even when listing the whole directory would fail on
       somebody else's record, so the verdict below survives exactly the fault
       that makes `listUsers` unusable. 18 employees is 18 calls. */
    const missing = [];
    const noUid = [];
    let ok = 0;
    for (const d of employees.docs) {
      const uid = d.data().authUid;
      if (!uid) { noUid.push(d); continue; }
      try {
        await getAuth(app).getUser(uid);
        ok++;
      } catch {
        missing.push(d);
      }
    }
    console.log(`  can sign in                   ${ok}   ← these people are ready`);
    if (noUid.length) {
      console.log(`  no authUid on the row         ${noUid.length}`);
      for (const d of noUid.slice(0, 5)) {
        console.log(`      ${d.id} — ${d.data().email ?? "no email"}`);
      }
    }
    if (missing.length) {
      console.log(`  authUid has no Auth account   ${missing.length}`);
      for (const d of missing.slice(0, 5)) {
        console.log(`      ${d.id} — ${d.data().email ?? "no email"}`);
      }
    }
  }
} finally {
  await deleteApp(app);
}

console.log("");
