import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";

/**
 * The ledger under the meeting-chat data channel.
 *
 * Delivery stays LiveKit's. This stores what was said so a refresh does not
 * lose it and a late joiner can read back — which means if the service is down,
 * chat still works exactly as it does today.
 *
 * The guards are lifted out of the deployed service and RUN, rather than
 * matched as text, because each of them exists to prevent a specific and
 * expensive mistake:
 *
 *   · a task room's DERIVED name being written as a meeting id, producing rows
 *     under a parent that does not exist — invisible to every query and to the
 *     retention sweep, so they would live forever in a product that tells
 *     people chat expires
 *   · a signed-in employee reading a meeting they were never in
 *   · a retention sweep that reaches the company's DM and group messages
 */

const SERVICE_PATH =
  "D:/GRAV_Project/grav-cms-backend/services/coworkMeetingChat.service.js";
const ROUTES_PATH =
  "D:/GRAV_Project/grav-cms-backend/routes/task_routes/cowork.js";

/** RAW source, for lifting a function out and running it. */
const SERVICE_RAW = readFileSync(SERVICE_PATH, "utf8");

/**
 * Comments stripped, for every assertion ABOUT the source.
 *
 * Both files document at length why a `collectionGroup("messages")` sweep would
 * be catastrophic and why the parent must be `.update()`d rather than `.set()`.
 * An assertion that those shapes are absent must not be defeated by the
 * paragraph explaining them — the same trap the other source-text tests in this
 * repo avoid the same way.
 */
function code(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

const SERVICE = code(SERVICE_RAW);
const ROUTES = code(readFileSync(ROUTES_PATH, "utf8"));

/** Lift one pure function out of the service and run it. The service itself
    cannot be imported — it pulls in firebase-admin and a live connection. */
function lift(name: string): (...args: unknown[]) => unknown {
  const at = SERVICE_RAW.indexOf(`function ${name}(`);
  assert.ok(at > 0, `${name} is gone from the service`);
  const end = SERVICE_RAW.indexOf("\n}", at);
  assert.ok(end > at, `${name} could not be bounded`);
  const src = SERVICE_RAW.slice(at, end + 2);
  return new Function(`${src}; return ${name};`)() as (
    ...args: unknown[]
  ) => unknown;
}

/* ── The id space that must never be written ─────────────────────────────── */

test("a task room's derived name is refused as a meeting id", () => {
  /**
   * `TaskRoom` names its LiveKit room `meet-task-<taskId>`. `MeetingRoom`
   * passes a real document id. Firestore creates a subcollection under a
   * missing parent without complaint, so a row written under the derived name
   * is unreachable by every query AND by the retention sweep, which finds work
   * through a field on the PARENT meeting.
   */
  const isRoomName = lift("isRoomName") as (x: unknown) => boolean;
  assert.equal(isRoomName("meet-task-T206"), true);
  assert.equal(isRoomName("meet-anything"), true);
});

test("a real meeting id is not mistaken for a room name", () => {
  const isRoomName = lift("isRoomName") as (x: unknown) => boolean;
  for (const id of ["mt_8f2a91", "MEET123", "abc-meet-1", ""]) {
    assert.equal(isRoomName(id), false, `${id} was refused`);
  }
  assert.equal(isRoomName(null), false);
  assert.equal(isRoomName(42), false);
});

/* ── Who may read and write ──────────────────────────────────────────────── */

test("the organiser and the named participants, and nobody else", () => {
  const isMember = lift("isMember") as (m: unknown, e: unknown) => boolean;
  const meet = { createdBy: "GR0001", participants: ["GR0002", "GR0003"] };

  assert.equal(isMember(meet, "GR0001"), true, "the organiser was refused");
  assert.equal(isMember(meet, "GR0002"), true, "a participant was refused");
  assert.equal(isMember(meet, "GR0009"), false, "a stranger was let in");
});

test("membership reads the field the meeting document actually has", () => {
  /**
   * The design said `participantIds`. The document written by
   * `createCoworkMeet` carries `participants`. Reading the wrong name would
   * refuse every participant and admit only the organiser — the same class of
   * mistake as guessing `assignedTo` on a task.
   */
  assert.match(SERVICE, /meet\.participants/);
  assert.doesNotMatch(SERVICE, /meet\.participantIds/);
});

test("a meeting with no participant list still admits its organiser", () => {
  const isMember = lift("isMember") as (m: unknown, e: unknown) => boolean;
  assert.equal(isMember({ createdBy: "GR0001" }, "GR0001"), true);
  assert.equal(isMember({ createdBy: "GR0001" }, "GR0002"), false);
});

test("nothing is a member of nothing", () => {
  const isMember = lift("isMember") as (m: unknown, e: unknown) => boolean;
  assert.equal(isMember(null, "GR0001"), false);
  assert.equal(isMember({ createdBy: "GR0001" }, ""), false);
  assert.equal(isMember({ createdBy: "GR0001" }, null), false);
});

test("ids are compared as strings, so a numeric id still matches", () => {
  const isMember = lift("isMember") as (m: unknown, e: unknown) => boolean;
  assert.equal(isMember({ createdBy: 1001, participants: [] }, "1001"), true);
  assert.equal(isMember({ createdBy: "x", participants: [1002] }, 1002), true);
});

/* ── Which meetings take new messages ────────────────────────────────────── */

test("a cancelled meeting reads as cancelled however it was cancelled", () => {
  /* The document carries BOTH `isCancelled` and `status`, and the legacy app
     sets the boolean. Reading only `status` would let a cancelled meeting
     accept messages. */
  const statusOf = lift("statusOf") as (m: unknown) => string;
  assert.equal(statusOf({ isCancelled: true, status: "live" }), "cancelled");
  assert.equal(statusOf({ status: "live" }), "live");
  assert.equal(statusOf({}), "scheduled", "an old meeting has no status field");
});

test("only a meeting still in play takes new messages", () => {
  /* Reading history is deliberately NOT gated this way — the whole point of
     storing it is to be able to read it afterwards. */
  const list = SERVICE.match(/WRITABLE_STATUSES = \[([^\]]*)\]/);
  assert.ok(list, "the writable list is gone");
  const statuses = list[1];
  for (const open of ["scheduled", "waiting", "live"]) {
    assert.match(statuses, new RegExp(`"${open}"`), `${open} cannot be written`);
  }
  for (const shut of ["completed", "cancelled", "archived"]) {
    assert.doesNotMatch(statuses, new RegExp(`"${shut}"`), `${shut} is writable`);
  }
});

/* ── Duplicate prevention ────────────────────────────────────────────────── */

test("a replayed message answers with the stored row, not a second one", () => {
  /**
   * The document id is the sender's LiveKit stream id, so a message has one
   * identity on both transports. That is what lets an offline outbox replay
   * blindly on reconnect without duplicating a row or re-stamping `createdAt`.
   */
  assert.match(SERVICE, /ref\.create\(row\)/, "the write is not a create");
  assert.match(SERVICE, /e\.code === 6/, "ALREADY_EXISTS is not handled");
  assert.match(SERVICE, /duplicate: true/);
  assert.match(ROUTES, /duplicate: result\.duplicate/);
});

test("a duplicate is answered 200, not an error", () => {
  /* A retry that already succeeded is a client behaving correctly. Answering
     an error would make it look broken and invite a third attempt. */
  const post = ROUTES.slice(ROUTES.indexOf('"/schedule-meet/:meetId/messages",', ROUTES.indexOf("router.post")));
  const body = post.slice(0, 3000);
  assert.doesNotMatch(body, /status\(409\)[\s\S]{0,80}duplicate/i);
});

/* ── Retention, and the query that must never be written ─────────────────── */

test("retention is stamped per row and summarised on the parent", () => {
  assert.match(SERVICE, /deleteAtMs/);
  assert.match(SERVICE, /chatOldestDeleteAtMs/);
  assert.match(SERVICE, /RETENTION_MS = 90 \* 24 \* 60 \* 60 \* 1000/);
});

test("the sweep can never be a collectionGroup query over messages", () => {
  /**
   * The one that would be catastrophic. DM and group threads live in
   * subcollections named `messages`
   * (`cowork_direct_messages/{id}/messages`, `cowork_groups/{id}/messages`), so
   * a collection-group delete on `deleteAtMs` would take the company's private
   * messages with it. It is inert only while no other message carries the
   * field — one addition later turns it into data loss.
   */
  assert.doesNotMatch(SERVICE, /collectionGroup/);
  assert.doesNotMatch(ROUTES, /collectionGroup\(\s*["']messages["']\s*\)/);
});

test("the parent is updated, never re-set", () => {
  /* `cowork_scheduled_meets/{meetId}` is mirrored wholesale into Realtime
     Database and read by the live legacy app, so a whole-document write would
     clobber concurrent edits. */
  const stamp = SERVICE.slice(SERVICE.indexOf("chatOldestDeleteAtMs"));
  assert.match(stamp.slice(0, 900), /meetRef\.update\(/);
  assert.doesNotMatch(stamp.slice(0, 900), /meetRef\.set\(/);
});

/* ── Pagination ──────────────────────────────────────────────────────────── */

test("cursors are inclusive, because a server timestamp is not unique", () => {
  /**
   * Two messages milliseconds apart can share one `serverTimestamp()`. An
   * exclusive cursor silently drops every row on the boundary instant — a
   * message that is simply missing, with nothing to show it ever existed.
   */
  assert.match(SERVICE, /"createdAt", "<=",/);
  assert.match(SERVICE, /"createdAt", ">=",/);
});

test("one extra row answers whether there is another page", () => {
  assert.match(SERVICE, /limit\(size \+ 1\)/);
  assert.match(SERVICE, /hasMore: snap\.docs\.length > size/);
});

test("a page is returned oldest-first, which is how a thread reads", () => {
  /* The query runs descending so a page taken without a cursor is the most
     RECENT one; the rows are then reversed for rendering. */
  assert.match(SERVICE, /orderBy\("createdAt", "desc"\)/);
  assert.match(SERVICE, /rows\.reverse\(\)/);
});

/* ── The route does not copy the hole beside it ──────────────────────────── */

test("both chat routes check membership, unlike their neighbours", () => {
  /**
   * The meeting read routes carry only `verifyCoworkToken +
   * verifyEmployeeToken` and no membership check — any signed-in employee can
   * read any meeting today. That is worth fixing and is deliberately NOT fixed
   * here: copying it would spread the hole, and widening it quietly inside a
   * chat feature would be the wrong place to decide it.
   */
  const chatRoutes = ROUTES.split('"/schedule-meet/:meetId/messages"');
  assert.equal(chatRoutes.length, 3, "expected exactly a GET and a POST");
  for (const part of chatRoutes.slice(1)) {
    assert.match(
      part.slice(0, 1500),
      /meetChat\.isMember\(meet, employeeId\)/,
      "a chat route has no membership check",
    );
  }
});

test("a missing meeting is a 404, and a stranger a 403", () => {
  assert.match(ROUTES, /status\(404\)[\s\S]{0,60}Meeting not found/);
  assert.match(ROUTES, /NOT_A_PARTICIPANT/);
});
