import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { backendAvailable, backendSource } from "@/lib/legacy/backendSource";

/**
 * A guest reads everything said before they joined — by decision.
 *
 * The owner chose FULL history for guests over a from-join cut: a guest is
 * usually the person in the room with the least context, and the chat is
 * where the link, the agenda and the "we moved to item 3" live. So the guest
 * path is the employee path with a different gate, and nothing on it — not
 * the panel, not the ledger, not the route, not the service — clips history
 * at the moment the guest arrived.
 *
 * These pin each of those four places, because a cut could be added to any
 * one of them and the other three would not notice.
 */

function code(path: string): string {
  return readFileSync(path, "utf8")
    .replace(/\r\n/g, "\n")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

const CHAT = code("components/features/meetings/MeetingChat.tsx");
const LEDGER = code("lib/legacy-ui/meetingChatLedger.ts");
/* Resolved per-machine, and CRLF-normalised, by `backendSource` — these
   hardcoded `D:/GRAV_Project/...`, so every assertion below threw ENOENT on
   any other checkout. See `cowork-source-text-tests-hazard`. */
const SKIP_ENGINE = backendAvailable()
  ? false
  : "the engine checkout was not found — set COWORK_BACKEND";
const ROUTES = backendAvailable()
  ? backendSource("routes/task_routes/cowork.js")
  : "";
const SERVICE = backendAvailable()
  ? backendSource("services/coworkMeetingChat.service.js")
  : "";

/* ── the panel ───────────────────────────────────────────────────────────── */

test("a guest session selects the guest ledger, ahead of the employee path", () => {
  const pick = CHAT.slice(CHAT.indexOf("const ledger: ChatLedger = useMemo"));
  const body = pick.slice(0, pick.indexOf("}, [repo, meetId, guestSessionId]);"));
  const g = body.indexOf("if (guestSessionId) return guestLedger(meetId, guestSessionId);");
  const e = body.indexOf("return employeeLedger(repo, meetId);");
  assert.ok(g > 0, "the guest ledger is no longer chosen from the session id");
  assert.ok(e > g, "the employee ledger is tried before the guest one");
});

test("the first page is the most recent history, with no cut at the join time", () => {
  assert.match(CHAT, /const page = await ledger\.list\(\{ limit: 50 \}\);/);
  assert.doesNotMatch(CHAT, /joinedAt|joinTime|sinceJoin|joinedMs/);
});

test("Load earlier reaches a guest too", () => {
  /* The same paging call for both rooms; the guest ledger below forwards the
     cursor it is given. */
  assert.match(CHAT, /ledger\.list\(\{ beforeMs: before \|\| undefined, limit: 50 \}\)/);
});

/* ── the ledger ──────────────────────────────────────────────────────────── */

test("the guest ledger forwards only the cursors it is asked for", () => {
  const guest = LEDGER.slice(LEDGER.indexOf("export function guestLedger"));
  assert.match(guest, /if \(opts\.beforeMs\) qs\.set\("beforeMs"/);
  assert.match(guest, /if \(opts\.afterMs\) qs\.set\("afterMs"/);
  assert.match(guest, /\/guest-messages\?\$\{qs\.toString\(\)\}/);
  assert.doesNotMatch(guest, /afterMs: Date\.now|afterMs: joined/, "the guest ledger invents a lower bound");
});

/* ── the route ───────────────────────────────────────────────────────────── */

test("the guest route reads the same ledger with the same cursors, and takes nothing from the session", { skip: SKIP_ENGINE }, () => {
  const m = /router\.get\(\s*"\/schedule-meet\/:meetId\/guest-messages",/.exec(ROUTES);
  assert.ok(m, "the guest GET route moved");
  const start = m.index;
  const handler = ROUTES.slice(start, ROUTES.indexOf("router.", start + 20));
  /* The session is the gate … */
  assert.match(
    handler,
    /guestSession\.validateGuestSession\(\s*meetId,\s*req\.query\.guestSessionId,?\s*\)/,
  );
  /* … and only the gate: the query's cursors go through as they are. */
  assert.match(
    handler,
    /meetChat\.listMeetingMessages\(\{\s*meetId,\s*beforeMs: req\.query\.beforeMs,\s*afterMs: req\.query\.afterMs,\s*limit: req\.query\.limit,?\s*\}\)/,
  );
  assert.doesNotMatch(
    handler,
    /session\.(createdAt|joinedAt|since|startedAt)|afterMs: session/,
    "the guest route cuts history at the session's start",
  );
});

test("the employee and guest routes read one collection", { skip: SKIP_ENGINE }, () => {
  const reads = ROUTES.match(/meetChat\.listMeetingMessages\(/g) ?? [];
  assert.ok(reads.length >= 2, "the guest route reads somewhere else");
});

/* ── the service ─────────────────────────────────────────────────────────── */

test("the service applies a lower bound only when a caller asks for one", { skip: SKIP_ENGINE }, () => {
  const list = SERVICE.slice(SERVICE.indexOf("async function listMeetingMessages"));
  const body = list.slice(0, list.indexOf("\n}\n") + 1);
  assert.match(body, /if \(Number\.isFinite\(Number\(afterMs\)\) && Number\(afterMs\) > 0\) \{/);
  assert.match(body, /q = q\.where\("createdAt", ">=", new Date\(Number\(afterMs\)\)\)/);
});

/* ── the help corpus, per CLAUDE.md ──────────────────────────────────────── */

test("the help article promises it, to guests by name", () => {
  const help = readFileSync("lib/help/knowledge.ts", "utf8");
  assert.match(help, /somebody who joins late reads back what was said before they arrived/);
  assert.match(help, /chat — including everything said before they joined —/);
});
