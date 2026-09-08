import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { backendAvailable, backendSource } from "@/lib/legacy/backendSource";

/**
 * Two bugs that already existed, made load-bearing by "End for everyone".
 *
 * ## The link that stayed open
 *
 * The public meeting-info route decided `canJoin` with
 * `meet.status !== "ended"` — and `"ended"` is not a status the product
 * writes. `setCoworkMeetStatus` accepts only MEET_STATUSES (scheduled, waiting,
 * live, completed, cancelled, archived), so ending a meeting writes `completed`
 * and the check was true for every meeting there has ever been. After the
 * organiser pressed End, a guest reloading their link got a full lobby with a
 * live camera preview and a Join button that then said "The meeting hasn't
 * started yet."
 *
 * ## The audio with no second chance
 *
 * A guest's recording is uploaded by their own browser and by nothing else —
 * `/audio/finalize` and `/audio/guest-finalize` take the identity from the
 * caller. If the upload failed as they left, the chunks sat in IndexedDB with
 * nothing to retry them: the signed-in shell mounts `PendingAudioDrain` on
 * every page, and a guest never sees that shell. Their ended card is the one
 * page they reliably return to, so the drain now lives there.
 */

function code(path: string): string {
  return readFileSync(path, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

const GUEST = code("components/features/meetings/GuestMeetingArea.tsx");
/* Resolved per-machine, and CRLF-normalised, by `backendSource` — this file
   hardcoded `D:/GRAV_Project/...`, so every assertion below threw ENOENT on
   any other checkout and reported as a broken test rather than a missing
   engine. See `cowork-source-text-tests-hazard`. */
const SKIP_ENGINE = backendAvailable()
  ? false
  : "the engine checkout was not found — set COWORK_BACKEND";
const LIVEKIT = backendAvailable()
  ? backendSource("routes/task_routes/livekit.routes.js")
  : "";
const SERVICE = backendAvailable()
  ? backendSource("services/cowork.service.js")
  : "";

/* ── canJoin ─────────────────────────────────────────────────────────────── */

test("a finished meeting cannot be joined, whichever way it finished", { skip: SKIP_ENGINE }, () => {
  assert.match(
    LIVEKIT,
    /\["completed", "cancelled", "archived", "ended"\]\.includes\(meet\.status\)/,
  );
  assert.match(LIVEKIT, /canJoin: meet\.publicShareEnabled === true && !finished/);
});

test("the dead check is gone", { skip: SKIP_ENGINE }, () => {
  /* `"ended"` is not written by the status route, so this compared every
     meeting against a value it could never hold. */
  assert.doesNotMatch(
    LIVEKIT,
    /canJoin: meet\.publicShareEnabled === true && meet\.status !== "ended"/,
    "canJoin is back to testing a status the product never writes",
  );
});

test("the statuses it refuses are the ones the product actually writes", { skip: SKIP_ENGINE }, () => {
  /* Pinned against the engine's own list so the two cannot drift: if a
     terminal status is added there and not here, the link reopens. */
  const list = SERVICE.match(/MEET_STATUSES = \[([^\]]*)\]/);
  assert.ok(list, "MEET_STATUSES moved");
  for (const terminal of ["completed", "cancelled", "archived"]) {
    assert.match(list[1], new RegExp(`"${terminal}"`), `${terminal} left MEET_STATUSES`);
  }
  assert.doesNotMatch(list[1], /"ended"/, "ended became a real status — reread canJoin");
});

test("the legacy cancel flag is honoured, not only the status", { skip: SKIP_ENGINE }, () => {
  /* The older application sets `isCancelled`; `setCoworkMeetStatus` keeps the
     two in step for exactly this reason. Reading one and not the other lets a
     legacy-cancelled meeting stay joinable. */
  const finished = LIVEKIT.slice(LIVEKIT.indexOf("const finished ="));
  assert.match(finished.slice(0, 200), /meet\.isCancelled === true/);
});

/* ── the guest's ended card ──────────────────────────────────────────────── */

test("a guest's ended card drains any audio still on this machine", () => {
  const branch = GUEST.slice(GUEST.indexOf("if (!canJoin) {"));
  assert.match(branch.slice(0, 600), /<PendingAudioDrain \/>/);
  assert.match(GUEST, /import \{ PendingAudioDrain \} from "\.\/PendingAudioDrain"/);
});

test("the drain needs no sign-in, because it never had one", () => {
  /* It calls `drainPendingAudio`, which reads the guestSessionId stored beside
     each chunk and chooses the guest routes from that alone. Anything that
     required an employee token here would silently do nothing for the one
     person it is mounted for. */
  const drain = code("components/features/meetings/PendingAudioDrain.tsx");
  assert.doesNotMatch(drain, /useRepo|getToken|Authorization|useSession/);
  assert.match(drain, /drainPendingAudio\(\)/);
  const rec = code("lib/legacy-ui/useMeetingRecording.ts");
  assert.match(rec, /guestSessionId: sess\.guestSessionId/, "finalize replay lost the guest id");
  assert.match(rec, /guestSessionId: c\.guestSessionId/, "chunk replay lost the guest id");
});

test("a cancelled meeting says so, rather than blaming the link", () => {
  /* The old fallthrough told a guest the link was "not currently active" and
     to ask for a fresh one — for a meeting that will never happen. */
  assert.match(GUEST, /"This meeting was cancelled\."/);
  assert.match(GUEST, /status === "cancelled"/);
});

test("the ended card still mounts NO room, so nothing can record", () => {
  /* The rescue is a retry of what was already captured. It must not be a way
     back into a meeting that has finished. */
  const branch = GUEST.slice(GUEST.indexOf("if (!canJoin) {"));
  const card = branch.slice(0, branch.indexOf("</Shell>"));
  assert.doesNotMatch(card, /<LiveKitRoom|useMeetingRecording\(/);
});
