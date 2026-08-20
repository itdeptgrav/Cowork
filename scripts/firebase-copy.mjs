#!/usr/bin/env node
/**
 * One-way copy of a Firebase project into another one.
 *
 * Written for a single job: seeding a testing project from production so that
 * the people who already have accounts can sign in to it. It copies Auth users
 * (with their password hashes, so existing passwords keep working), every
 * Firestore collection including subcollections, and the Realtime Database.
 *
 * ## It is deliberately hard to run backwards
 *
 * A copy script that can be pointed the wrong way is a production incident with
 * a flag typo. Three separate guards:
 *
 *  1. `PROTECTED` lists projects that may never be a TARGET. Production is on
 *     it, so `--target` naming it is refused before a credential is even read.
 *  2. Source and target must differ.
 *  3. Nothing is written without `--execute`. The default is a dry run that
 *     reads everything, counts it, and writes nothing — run that first, always.
 *
 * The source project is only ever read from. No write method is called on it
 * anywhere in this file, and that is worth keeping true.
 *
 * ## What it does NOT do
 *
 *  · It does not delete. Documents already in the target are overwritten by id;
 *    anything extra there is left alone. Run against an empty target unless you
 *    mean to merge.
 *  · It does not copy Cloud Storage. Cowork's files go to Google Drive through
 *    `uploadToDrive`, not to a Firebase bucket, so there is nothing here.
 *  · It does not copy security rules or indexes. Deploy those separately:
 *      npx firebase-tools deploy --only firestore:indexes --project <target>
 *
 * ## Usage
 *
 *   # 1. Dry run — reads production, writes nothing, prints what it would copy
 *   node scripts/firebase-copy.mjs \
 *     --source  D:/secrets/prod-sa.json \
 *     --target  D:/secrets/testing-sa.json \
 *     --source-rtdb https://grav-cms-38f45-default-rtdb.firebaseio.com \
 *     --target-rtdb https://testing-63656-default-rtdb.firebaseio.com \
 *     --hash-params D:/secrets/hash-params.json
 *
 *   # 2. The real thing — same command plus --execute
 *
 * Flags:
 *   --source PATH        service-account JSON for the project to READ    (required)
 *   --target PATH        service-account JSON for the project to WRITE   (required)
 *   --source-rtdb URL    source Realtime Database URL   (required for --only rtdb)
 *   --target-rtdb URL    target Realtime Database URL   (required for --only rtdb)
 *   --hash-params PATH   password hash parameters JSON  (required for --only auth)
 *   --only LIST          comma-separated: auth,firestore,rtdb   (default: all three)
 *   --collections LIST   comma-separated ROOT collections       (default: all)
 *   --execute            actually write. Without it, nothing is written.
 *
 * ## Just enough to sign in
 *
 * A full copy takes as long as the database is big. Signing in does not need
 * one — it needs the Auth accounts, and the single Firestore collection that
 * `coworkAuth.js` looks the caller up in. Everything else can follow later, and
 * the app renders empty lists rather than failing while it is missing:
 *
 *   node scripts/firebase-copy.mjs --source ... --target ... --hash-params ... \
 *     --only auth,firestore --collections cowork_employees --execute
 *
 * Re-running afterwards without `--collections` copies the rest. Documents are
 * written by id, so the second pass simply rewrites what the first one did.
 *
 * `--hash-params` is a small JSON file you fill in from the SOURCE project's
 * console — Authentication → Users → ⋮ → "Password hash parameters":
 *
 *   {
 *     "algorithm": "SCRYPT",
 *     "base64_signer_key": "...",
 *     "base64_salt_separator": "...",
 *     "rounds": 8,
 *     "mem_cost": 14
 *   }
 *
 * Without it users still import, but every password is dead and everybody needs
 * a reset. There is no way to recover the signer key afterwards, so get it
 * before you start.
 */

/* The MODULAR entry points, not the `admin.credential.cert(...)` namespace the
   backend's `config/firebaseAdmin.js` uses. `firebase-admin` v14 — the version
   in this repository — no longer exports that namespace from the package root:
   `require("firebase-admin").credential` is `undefined`, and the first thing
   that happens is a "Cannot read properties of undefined" three frames deep in
   argument parsing. The backend is on v13, where both styles work, which is why
   copying its import here looks right and is not. */
import { readFileSync } from "node:fs";
import { cert, deleteApp, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getDatabase } from "firebase-admin/database";
import { getFirestore } from "firebase-admin/firestore";

/**
 * Projects that may never be written to by this script.
 *
 * The point of the list is that adding a project to it is easy and removing one
 * is a deliberate act somebody has to justify in a diff.
 */
const PROTECTED = new Set(["grav-cms-38f45"]);

/** Firestore's own cap is 500 operations per batch; leave headroom. */
const BATCH_LIMIT = 400;

/** `importUsers` accepts at most 1000 records per call. */
const AUTH_CHUNK = 1000;

/* ── Arguments ────────────────────────────────────────────────────────────── */

function parseArgs(argv) {
  const out = { only: "auth,firestore,rtdb", execute: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--execute") { out.execute = true; continue; }
    if (!a.startsWith("--")) continue;
    const key = a.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    out[key] = argv[++i];
  }
  return out;
}

function fail(message) {
  console.error(`\n  ✖ ${message}\n`);
  process.exit(1);
}

function readJson(path, label) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (e) {
    fail(`Could not read ${label} at ${path}: ${e.message}`);
  }
}

/* ── Value mapping ────────────────────────────────────────────────────────── */

/**
 * A document's fields, made safe to write into the OTHER project.
 *
 * Almost everything crosses unchanged — `Timestamp`, `GeoPoint`, byte fields and
 * plain JSON are value objects that mean the same thing in either database. A
 * `DocumentReference` does not: it carries the Firestore instance it came from,
 * so writing one verbatim either throws or silently stores a pointer into the
 * project you were copying away from. It is re-rooted onto the target by path.
 *
 * Detected by shape rather than by `instanceof`, because the two apps can end up
 * holding separate copies of the Firestore classes and an `instanceof` across
 * them quietly returns false — which would put the very reference this exists to
 * fix straight through unmodified.
 */
function remap(value, targetDb) {
  if (value === null || typeof value !== "object") return value;
  if (Buffer.isBuffer(value)) return value;
  /* Timestamp and GeoPoint: value objects, safe as they are. */
  if (typeof value.toDate === "function" && typeof value.seconds === "number") return value;
  if (typeof value.latitude === "number" && typeof value.longitude === "number") return value;
  /* DocumentReference: has a path, an id, and its own Firestore handle. */
  if (typeof value.path === "string" && typeof value.id === "string" && value.firestore) {
    return targetDb.doc(value.path);
  }
  if (Array.isArray(value)) return value.map((v) => remap(v, targetDb));
  const out = {};
  for (const [k, v] of Object.entries(value)) out[k] = remap(v, targetDb);
  return out;
}

/* ── Firestore ────────────────────────────────────────────────────────────── */

/**
 * Copy one collection, then everything beneath it.
 *
 * **`listDocuments()`, not `get()`** — and the difference is a whole class of
 * silently missing data. A Firestore path can hold a subcollection under a
 * document that was never itself written; `get()` on the collection does not
 * return those "phantom" parents, so recursing from a `get()` never finds what
 * hangs off them. Cowork has exactly this shape: `cowork_task_timers/{id}` is
 * usually written only as `.../{id}/sessions/{taskId}`, so a `get()`-based copy
 * would come back reporting zero timers and look like it had worked.
 *
 * Subcollections are queued and walked AFTER this collection's own batch has
 * committed, so one batch never spans two levels of the tree.
 */
async function copyCollection(sourceCollection, targetDb, opts, stats, depth = 0) {
  const indent = "  ".repeat(depth + 1);
  const queue = [];
  let copied = 0;

  /**
   * **Paged with `startAfter`, rather than one `get()` on the collection.**
   *
   * A whole collection in a single `get()` is one round trip, which is the right
   * instinct — but it also materialises every document in memory at once, and
   * the collections that matter here (`cowork_tasks`, and the `messages` under
   * every conversation) are exactly the ones large enough to make that the
   * moment a long copy dies. Ordering by document id gives a stable cursor, so
   * a page is one round trip and memory stays flat however big the collection
   * turns out to be.
   *
   * Reading a page at a time also happens to match the write side: one page in,
   * one batch out.
   */
  let cursor = null;
  for (;;) {
    let page = sourceCollection.orderBy("__name__").limit(BATCH_LIMIT);
    if (cursor) page = page.startAfter(cursor);
    const snapshot = await page.get();
    if (snapshot.empty) break;

    if (opts.execute) {
      const batch = targetDb.batch();
      for (const doc of snapshot.docs) {
        batch.set(targetDb.doc(doc.ref.path), remap(doc.data(), targetDb));
      }
      await batch.commit();
    }
    copied += snapshot.size;
    stats.documents += snapshot.size;
    cursor = snapshot.docs[snapshot.docs.length - 1];
    if (snapshot.size < BATCH_LIMIT) break;
  }

  /**
   * The second pass exists for the documents the first one cannot see.
   *
   * `listDocuments()` returns every id under the collection INCLUDING paths that
   * hold only subcollections and were never written as documents themselves —
   * `cowork_task_timers/{employeeId}` is normally one of these, written only as
   * `.../{employeeId}/sessions/{taskId}`. A query cannot return them, so a copy
   * that recursed from the query alone would silently bring across no timers at
   * all and still report success.
   */
  const allRefs = await sourceCollection.listDocuments();
  /* Every id here that the query above did not return is one of those
     subcollection-only paths. Counted so the summary can say so — a run that
     reports thousands of them is telling you something real about the shape of
     the data, not reporting a fault. */
  stats.emptyParents += Math.max(0, allRefs.length - copied);
  for (const ref of allRefs) {
    const subs = await ref.listCollections();
    for (const sub of subs) queue.push(sub);
  }

  if (copied > 0 || queue.length > 0) {
    console.log(`${indent}${sourceCollection.path} — ${copied} document(s)`);
  }

  for (const sub of queue) {
    await copyCollection(sub, targetDb, opts, stats, depth + 1);
  }
}

async function copyFirestore(sourceApp, targetApp, opts, stats) {
  console.log("\n── Firestore ──────────────────────────────────────────────");
  const sourceDb = getFirestore(sourceApp);
  const targetDb = getFirestore(targetApp);
  targetDb.settings({ ignoreUndefinedProperties: true });

  const all = await sourceDb.listCollections();
  if (all.length === 0) {
    console.log("  (no collections in the source project)");
    return;
  }

  /**
   * `--collections` narrows the copy to named ROOT collections.
   *
   * A full copy walks everything and takes as long as it takes, which is the
   * right default and the wrong thing to be waiting on when all you need is for
   * people to be able to sign in. Signing in reads exactly one collection —
   * `coworkAuth.js` looks the caller up in `cowork_employees` and refuses with
   * "Employee not found in Firestore" if it is not there — so naming that one
   * turns an hour into a minute.
   *
   * Root collections only. Subcollections beneath a named one still come with
   * it, because they belong to it; there is no way to ask for half a document's
   * children and no reason to want one.
   */
  const wanted = opts.collections
    ? new Set(String(opts.collections).split(",").map((s) => s.trim()).filter(Boolean))
    : null;

  const roots = wanted ? all.filter((c) => wanted.has(c.id)) : all;

  if (wanted) {
    const missing = [...wanted].filter((id) => !all.some((c) => c.id === id));
    /* Named but absent is worth saying out loud. A typo here copies nothing and
       otherwise looks exactly like a collection that happened to be empty. */
    for (const id of missing) {
      console.log(`  ⚠ "${id}" was asked for but does not exist in the source.`);
    }
    console.log(`  ${roots.length} of ${all.length} root collection(s) selected\n`);
  } else {
    console.log(`  ${all.length} root collection(s)\n`);
  }

  for (const c of roots) await copyCollection(c, targetDb, opts, stats, 0);
}

/* ── Realtime Database ────────────────────────────────────────────────────── */

/**
 * Copy the Realtime Database, one top-level child at a time.
 *
 * The whole tree is read in one call — the Admin SDK has no shallow read — but
 * it is WRITTEN child by child rather than as a single `set('/')`. A one-shot
 * root write is atomic and therefore has to hold the entire database in one
 * request, which is where a large copy fails; per-child writes also mean a
 * failure halfway through names the branch it stopped on.
 */
async function copyRtdb(sourceApp, targetApp, opts, stats) {
  console.log("\n── Realtime Database ──────────────────────────────────────");
  const snapshot = await getDatabase(sourceApp).ref("/").once("value");
  const root = snapshot.val();
  if (!root || typeof root !== "object") {
    console.log("  (source Realtime Database is empty)");
    return;
  }
  const targetRtdb = getDatabase(targetApp);
  for (const [key, value] of Object.entries(root)) {
    const count =
      value && typeof value === "object" ? Object.keys(value).length : 1;
    console.log(`  /${key} — ${count} child node(s)`);
    if (opts.execute) await targetRtdb.ref(key).set(value);
    stats.rtdbRoots++;
  }
}

/* ── Authentication ───────────────────────────────────────────────────────── */

/**
 * Copy every Auth user, keeping their UID and their password.
 *
 * **The UID is the part that must not change.** `cowork_employees.authUid` is
 * how a Firestore employee record is matched to the person signing in — see
 * `Middlewear/coworkAuth.js`, which looks the employee up by it. Import with
 * fresh UIDs and every record in the copied database points at nobody: sign-in
 * gets as far as Firebase and then answers "Employee not found in Firestore".
 * `importUsers` preserves whatever UID it is given, which is why this passes the
 * source's through untouched.
 *
 * **The password hash is the reason this is not just `createUser` in a loop.**
 * `listUsers` returns each account's hash and salt, but they are only meaningful
 * alongside the SOURCE project's signer key and scrypt parameters, which are not
 * readable through any API — they live in that project's console. Supply them
 * with `--hash-params` and existing passwords keep working; omit them and the
 * accounts arrive intact but unopenable, and everyone needs a reset link.
 *
 * `password` is dropped from `providerData` deliberately: the hash carries that
 * provider, and listing it again makes the import reject the record.
 */
async function copyAuth(sourceApp, targetApp, opts, stats) {
  console.log("\n── Authentication ─────────────────────────────────────────");

  const sourceAuth = getAuth(sourceApp);
  const users = [];
  let pageToken;
  do {
    const page = await sourceAuth.listUsers(1000, pageToken);
    users.push(...page.users);
    pageToken = page.pageToken;
  } while (pageToken);

  const withPassword = users.filter((u) => u.passwordHash).length;
  console.log(`  ${users.length} user(s), ${withPassword} with a password hash`);

  if (users.length === 0) return;

  let hash;
  if (opts.hashParams) {
    const p = readJson(opts.hashParams, "hash parameters");
    const key = p.base64_signer_key ?? p.signerKey;
    const sep = p.base64_salt_separator ?? p.saltSeparator;
    if (!key) fail("The hash parameters file has no `base64_signer_key`.");
    hash = {
      algorithm: p.algorithm ?? "SCRYPT",
      key: Buffer.from(key, "base64"),
      saltSeparator: Buffer.from(sep ?? "", "base64"),
      rounds: Number(p.rounds ?? 8),
      memoryCost: Number(p.mem_cost ?? p.memoryCost ?? 14),
    };
    console.log(`  hash: ${hash.algorithm}, rounds ${hash.rounds}, mem_cost ${hash.memoryCost}`);
  } else {
    console.log(
      "  ⚠ No --hash-params given. Users will import but NO password will work,\n" +
      "    and the signer key cannot be recovered afterwards. Stop and fetch it\n" +
      "    unless you intend to reset every password.",
    );
  }

  const records = users.map((u) => {
    const r = {
      uid: u.uid,
      email: u.email,
      emailVerified: u.emailVerified,
      displayName: u.displayName,
      photoURL: u.photoURL,
      phoneNumber: u.phoneNumber,
      disabled: u.disabled,
      customClaims: u.customClaims,
      metadata: {
        creationTime: u.metadata?.creationTime,
        lastSignInTime: u.metadata?.lastSignInTime,
      },
    };
    if (u.passwordHash) r.passwordHash = Buffer.from(u.passwordHash, "base64");
    if (u.passwordSalt) r.passwordSalt = Buffer.from(u.passwordSalt, "base64");
    const federated = (u.providerData ?? [])
      .filter((p) => p.providerId !== "password")
      .map((p) => ({
        uid: p.uid,
        providerId: p.providerId,
        email: p.email,
        displayName: p.displayName,
        photoURL: p.photoURL,
      }));
    if (federated.length) r.providerData = federated;
    /* Firestore rejects `undefined`; the Auth import is stricter still. */
    for (const k of Object.keys(r)) if (r[k] === undefined) delete r[k];
    return r;
  });

  if (!opts.execute) {
    stats.users += records.length;
    console.log(`  would import ${records.length} user(s)`);
    return;
  }

  const targetAuth = getAuth(targetApp);
  for (let i = 0; i < records.length; i += AUTH_CHUNK) {
    const chunk = records.slice(i, i + AUTH_CHUNK);
    const result = await targetAuth.importUsers(chunk, hash ? { hash } : undefined);
    stats.users += result.successCount;
    stats.userFailures += result.failureCount;
    console.log(
      `  imported ${result.successCount}, failed ${result.failureCount}` +
      ` (${i + chunk.length}/${records.length})`,
    );
    /* Name the first few failures rather than only counting them — an import
       that silently drops a third of the company reads as a success otherwise. */
    for (const e of result.errors.slice(0, 5)) {
      console.log(`    ✖ index ${e.index}: ${e.error.message}`);
    }
  }
}

/* ── Main ─────────────────────────────────────────────────────────────────── */

async function main() {
  const opts = parseArgs(process.argv.slice(2));

  if (!opts.source || !opts.target)
    fail("Both --source and --target service-account JSON paths are required.");

  const sourceKey = readJson(opts.source, "source service account");
  const targetKey = readJson(opts.target, "target service account");
  const sourceId = sourceKey.project_id;
  const targetId = targetKey.project_id;

  if (!sourceId || !targetId)
    fail("A service-account file has no `project_id`. Is it the right file?");

  /* Guard one: production is never a target, whatever the flags say. */
  if (PROTECTED.has(targetId))
    fail(
      `Refusing to write to "${targetId}" — it is on the protected list.\n` +
      `    This script only ever copies AWAY from it. If you genuinely mean to\n` +
      `    write there, that is a decision for a human, not a flag.`,
    );

  /* Guard two: a copy onto itself is a mistake in every case. */
  if (sourceId === targetId)
    fail(`Source and target are both "${sourceId}".`);

  const only = new Set(String(opts.only).split(",").map((s) => s.trim()));

  if (only.has("rtdb") && (!opts.sourceRtdb || !opts.targetRtdb))
    fail("--source-rtdb and --target-rtdb are required when copying the Realtime Database.");

  const sourceApp = initializeApp(
    {
      credential: cert(sourceKey),
      ...(opts.sourceRtdb ? { databaseURL: opts.sourceRtdb } : {}),
    },
    "source",
  );
  const targetApp = initializeApp(
    {
      credential: cert(targetKey),
      ...(opts.targetRtdb ? { databaseURL: opts.targetRtdb } : {}),
    },
    "target",
  );

  console.log("\n╭──────────────────────────────────────────────────────────╮");
  console.log(`│  FROM  ${sourceId.padEnd(48)}│`);
  console.log(`│  TO    ${targetId.padEnd(48)}│`);
  console.log(`│  ONLY  ${[...only].join(", ").padEnd(48)}│`);
  console.log(
    `│  MODE  ${(opts.execute ? "EXECUTE — this writes data" : "DRY RUN — nothing will be written").padEnd(48)}│`,
  );
  console.log("╰──────────────────────────────────────────────────────────╯");

  const stats = {
    documents: 0,
    emptyParents: 0,
    users: 0,
    userFailures: 0,
    rtdbRoots: 0,
  };
  const startedAt = Date.now();

  try {
    if (only.has("auth")) await copyAuth(sourceApp, targetApp, opts, stats);
    if (only.has("firestore")) await copyFirestore(sourceApp, targetApp, opts, stats);
    if (only.has("rtdb")) await copyRtdb(sourceApp, targetApp, opts, stats);
  } finally {
    await Promise.allSettled([deleteApp(sourceApp), deleteApp(targetApp)]);
  }

  const secs = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log("\n── Summary ────────────────────────────────────────────────");
  console.log(`  Auth users          ${stats.users}` + (stats.userFailures ? `  (${stats.userFailures} failed)` : ""));
  console.log(`  Firestore documents ${stats.documents}`);
  console.log(`  Paths with no doc   ${stats.emptyParents}  (subcollection parents; nothing to copy)`);
  console.log(`  RTDB root nodes     ${stats.rtdbRoots}`);
  console.log(`  Took                ${secs}s`);
  if (!opts.execute) {
    console.log("\n  This was a DRY RUN. Nothing was written.");
    console.log("  Re-run the same command with --execute to copy for real.\n");
  } else {
    console.log("\n  Done.\n");
  }
}

main().catch((e) => {
  console.error("\n  ✖ Failed:", e?.message ?? e);
  if (e?.stack) console.error(e.stack.split("\n").slice(1, 4).join("\n"));
  process.exit(1);
});
