#!/usr/bin/env node
/**
 * Delete the budget-extension rows a meeting should never have filed.
 *
 *     node scripts/clear-meeting-budget-rows.mjs           # list them
 *     node scripts/clear-meeting-budget-rows.mjs --delete  # remove them
 *
 * ## What went wrong, and why these rows are not safe to leave
 *
 * Meeting credit briefly filed a `cowork_task_budget_extensions` row so that a
 * task whose deadline is derived rather than stored would still have an account
 * of why its Expected completion moved. That collection is not a receipt — it
 * is a NEGOTIATION. An approved row in it means "your manager has offered you
 * this, confirm it to put it in force", so the meeting produced a card asking
 * the assignee to accept the time.
 *
 * Accepting it is the damaging part. The row carries `previousBudgetSecs: 0`,
 * so its `newBudgetSecs` is the credit alone — pressing Accept on a task with a
 * twenty-minute budget SETS that budget to five minutes rather than adding five
 * to it. The card even says so: "New budget 00:05:08".
 *
 * So these rows must be deleted, not answered. Nothing is lost: the credit was
 * already applied to the task when the meeting ended, and the meeting itself is
 * recorded in `cowork_task_meetings` and on the task's own `meetingTotalSecs`.
 *
 * ## What it will and will not touch
 *
 * Only rows whose reason matches the sentence meeting credit writes —
 * `Meeting time — 15m on T013` — built by `meetingCreditReason`. A genuine
 * request somebody typed cannot produce that string, and the dry run prints
 * every row so you can see what is going before anything is removed.
 */

import { readFileSync } from "node:fs";
import { initializeApp } from "firebase/app";
import { getAuth, signInWithEmailAndPassword } from "firebase/auth";
import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  getFirestore,
} from "firebase/firestore";

/* `.env.local` rather than `process.env`: this is run with plain `node`, which
   does not load Next's env files. */
function env() {
  const out = {};
  for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
    const eq = line.indexOf("=");
    if (eq < 0 || line.trimStart().startsWith("#")) continue;
    out[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
  }
  return out;
}

const e = env();
const app = initializeApp({
  apiKey: e.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: e.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: e.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: e.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: e.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: e.NEXT_PUBLIC_FIREBASE_APP_ID,
});
const db = getFirestore(app);

/* The security rules refuse an anonymous client, which is correct — this reads
   and deletes real records. Credentials come from the environment at RUN time
   and are never stored, logged or written anywhere:

     COWORK_EMAIL=you@example.com COWORK_PASSWORD=… npm run meeting:clear-budget-rows

   On PowerShell:
     $env:COWORK_EMAIL="…"; $env:COWORK_PASSWORD="…"; npm run meeting:clear-budget-rows
     …and clear them afterwards with  Remove-Item Env:COWORK_PASSWORD

   If you would rather not put a password in a shell at all, delete the row from
   the Firebase console instead — it is a single document in
   `cowork_task_budget_extensions` whose `reason` starts "Meeting time —". */
const email = process.env.COWORK_EMAIL;
const password = process.env.COWORK_PASSWORD;
if (!email || !password) {
  console.error(
    "Set COWORK_EMAIL and COWORK_PASSWORD to run this — see the note in the\n" +
      "script, or delete the row from the Firebase console instead.",
  );
  process.exit(2);
}
try {
  await signInWithEmailAndPassword(getAuth(app), email, password);
} catch (e) {
  console.error(`Could not sign in: ${e?.code ?? e?.message ?? e}`);
  process.exit(1);
}

/** The exact shape `meetingCreditReason` produces. */
const MEETING_REASON = /^Meeting time — .+ on .+$/;

const commit = process.argv.includes("--delete");

const snap = await getDocs(collection(db, "cowork_task_budget_extensions"));
const mine = snap.docs.filter((d) => {
  const reason = d.data().reason;
  return typeof reason === "string" && MEETING_REASON.test(reason);
});

if (mine.length === 0) {
  console.log("Nothing to clear — no meeting-filed budget rows found.");
  process.exit(0);
}

console.log(
  `${mine.length} row${mine.length === 1 ? "" : "s"} filed by meeting credit:\n`,
);
for (const d of mine) {
  const r = d.data();
  console.log(
    `  ${d.id}  task ${r.taskId}  ${r.status}  "${r.reason}"  ` +
      `prev ${r.previousBudgetSecs}s → new ${r.newBudgetSecs}s`,
  );
}

if (!commit) {
  console.log(
    "\nDry run. Nothing was deleted.\n" +
      "Re-run with --delete to remove them. The meeting credit itself stays: it " +
      "is already on the task, and the sessions are in cowork_task_meetings.",
  );
  process.exit(0);
}

for (const d of mine) {
  await deleteDoc(doc(db, "cowork_task_budget_extensions", d.id));
  console.log(`deleted ${d.id}`);
}
console.log(`\nDone — ${mine.length} removed.`);
process.exit(0);
