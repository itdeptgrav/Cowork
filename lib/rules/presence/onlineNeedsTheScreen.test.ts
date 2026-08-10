import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { test } from "node:test";

/**
 * **Going online is sharing your screen, and Grav Stream carries it — OWNER
 * DECISION.**
 *
 * Three reversals are compressed into this file and every one is easy to lose
 * again:
 *
 *  1. For a period, pressing Online set the status directly — no prompt,
 *     nothing verified. Presence was self-declared and a manager who opened
 *     somebody's screen found nothing there.
 *  2. The screen was carried by LiveKit. Presence runs on the company's own
 *     service now — measured, see `lib/integrations/grav/stream.ts`.
 *  3. The sharer had an IFRAME, and a panel on screen to go with it, because a
 *     capture prompt only opens in the document that calls for it. Their
 *     publisher SDK runs in this document, so the picker opens from Cowork's own
 *     button and nothing is rendered at any point.
 *
 * These read source rather than run a browser: what is protected is the SHAPE of
 * a flow whose middle step is a native capture prompt, which no test can click.
 */

const STORE = "lib/status/employeeStatus.ts";
const BUTTON = "components/features/status/StatusButton.tsx";
const PUBLISHER = "lib/integrations/grav/publisher.ts";
const BRIDGE = "lib/integrations/grav/embed.ts";
const TOKEN_ROUTE = "app/api/stream/token/route.ts";
const PRESENCE_ROUTE = "app/api/stream/presence/route.ts";

function code(path: string): string {
  return readFileSync(path, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

test("nothing in the store can assert online", () => {
  const src = code(STORE);
  assert.ok(
    !/export function goOnline/.test(src),
    "goOnline is back — a status can be set without a share again",
  );
  assert.ok(
    !/manual: "online"/.test(src),
    "online is being written as a manual state again",
  );
  const at = src.indexOf("export function derive");
  const body = src.slice(at, src.indexOf("\nconst INITIAL", at));
  assert.match(
    body,
    /if \(share\.sharing && share\.connected\) return "online";/,
    "the room no longer decides",
  );
});

test("the status menu asks for the screen instead of setting the status", () => {
  const src = code(BUTTON);
  const at = src.indexOf('if (id === "online")');
  assert.ok(at > 0, "the online branch is gone");
  const branch = src.slice(at, src.indexOf('if (id === "break")', at));

  assert.match(branch, /setConfirming\("share"\)/, "no screen is asked for");
  assert.ok(
    !/goOnline|manual/.test(branch),
    "the online branch sets a status of its own",
  );
});

/* ── The picker, and the five seconds it has to open in ───────────────────── */

test("the picker is opened by the press, with nothing awaited in front of it", () => {
  /**
   * **A capture prompt only opens inside a user gesture, and a gesture does not
   * survive an `await`.** Transient activation lasts about five seconds, and a
   * token fetch can spend all of it — so the seat is fetched when the MENU
   * opens, the library is loaded there too, and the press does nothing but call
   * `share()`.
   *
   * `void startPublishing(...)`, not `await`: the handler must not suspend
   * before the call that opens the prompt.
   */
  const button = code(BUTTON);
  const at = button.indexOf("function openPicker(): boolean {");
  assert.ok(at > 0, "openPicker is gone");
  const body = button.slice(at, button.indexOf("\n  }", at));
  assert.match(body, /void startPublishing\(\{/);
  assert.ok(
    !/await/.test(body),
    "something is awaited inside openPicker, so the gesture is spent before the prompt",
  );
  /* The seat and the library both have to be in hand, and a press that cannot
     proceed says which is missing rather than doing nothing. */
  assert.match(body, /if \(!token \|\| !url\)/);
  assert.match(body, /if \(!publisherReady\(\)\)/);
  assert.match(body, /Still getting your room ready/);
  assert.match(body, /library is still loading/);
});

test("the SDK is pointed at the realtime server, not the embed page", () => {
  /**
   * **They are one field apart, and their documentation warns about it twice.**
   * The seat carries `url` — `wss://stream.grav.in`, what media connects to —
   * and `embedUrl`, an HTML page for a watcher's iframe. The store held the
   * EMBED page in `url` for a while, and the SDK was handed it as `serverUrl`.
   *
   * Every visible step still worked: the picker opened, the screen was granted,
   * the browser put its "sharing your screen" bar up — and then the share
   * stopped about a second later, because there is no realtime server at an
   * HTML page's address. From the outside it looked exactly like Cowork putting
   * somebody offline on its own.
   */
  const store = code(STORE);
  const at = store.indexOf("export async function startScreenShare");
  const body = store.slice(at, store.indexOf("export function sessionLive", at));
  assert.match(body, /const \{ token, url \} = await fetchSeat\(\);/);
  assert.ok(
    !/embedUrl/.test(body),
    "the sharer is holding the embed page again — the SDK cannot connect to it",
  );
  /* And the seat really does carry both, so this is a choice rather than an
     accident of what was available. */
  assert.match(code("lib/integrations/grav/credentials.ts"), /url: string;/);
  assert.match(code(TOKEN_ROUTE), /url: credentials\.url,/);
});

test("the room and the library are warmed up before the press, and given back after", () => {
  /* Warming up is fetching a seat and parsing a script, which is NOT being
     online — the service decides that on a live screen. A menu opened and closed
     leaves nothing running. */
  const button = code(BUTTON);
  const at = button.indexOf("if (!open || !viewerId) return;");
  assert.ok(at > 0, "the warm-up effect is gone");
  const effect = button.slice(at, button.indexOf("}, [open, viewerId", at));
  assert.match(effect, /loadPublisherSdk\(\)/, "the library is not preloaded");
  assert.match(effect, /startScreenShare\(/, "the seat is not fetched early");

  /* Given back when the menu closes with nothing running — the exclusions that
     make "nothing running" honest are asserted in their own test below. */
  assert.match(
    button,
    /if \(status === "online" \|\| session === "idle"\) return;\s*endSession\(\);/,
  );
});

test("closing the menu to show the picker does not end the session", () => {
  /**
   * **Reported as: it goes online for a few seconds and then switches itself
   * off.** Two mistakes, one after the other, and both are here.
   *
   * The menu closes the instant the picker opens — `openPicker` does it — and
   * the effect that gives an unused room back keyed on exactly that: menu
   * closed, not online yet, session not idle. So it ran `endSession()` while
   * somebody was looking at the capture prompt: credentials dropped, session
   * `idle`, and `DutySync` — which is quiet only while the session reads
   * `connecting` — published OFFLINE for a person in the middle of coming
   * online.
   *
   * Then, once the screen was live, nothing marked the session `live`, because
   * the thing that used to (`GravStreamEmbed`, on `joined`) no longer exists.
   * Left at `connecting`, `DutySync` publishes nothing at all — the pill reads
   * Online on that one device and nobody else is ever told.
   */
  const button = code(BUTTON);
  assert.match(
    button,
    /if \(open \|\| starting \|\| share\.sharing\) return;/,
    "the room is given back while the picker is open or a screen is live",
  );
  assert.match(button, /setStarting\(true\);\s*void startPublishing\(/);
  assert.match(button, /\.finally\(\(\) => setStarting\(false\)\)/);

  const started = button.slice(button.indexOf(".then((capture) =>"));
  assert.match(
    started,
    /sessionLive\(\);/,
    "nothing marks the session live, so DutySync never publishes the online status",
  );

  /* And the guard on the other side, which is what makes `connecting` mean
     "say nothing" rather than "say offline". */
  assert.match(
    code("components/features/status/DutySync.tsx"),
    /session === "requesting" \|\| session === "connecting"/,
  );
});

test("nothing is rendered for the person sharing", () => {
  /**
   * **The panel is the thing that was removed, and this is what keeps it gone.**
   *
   * There was a 300px Grav Stream frame in the corner while a screen was being
   * chosen — first 1×1 and invisible (which is why no picker ever opened:
   * `EMBED_NOT_VISIBLE`), then rendered at a real size with a second button to
   * press inside it. The SDK calls `getDisplayMedia` in this document, so there
   * is no frame, no panel, and no second press.
   */
  for (const path of [BUTTON, PUBLISHER]) {
    assert.ok(
      !/<iframe/.test(code(path)),
      `${path} renders a frame for the sharer again`,
    );
  }
  const shell = code("components/layout/shell/ShellFrame.tsx");
  assert.ok(
    !/PresenceRoom|GravStreamEmbed/.test(shell),
    "a presence room is mounted beside the shell again",
  );
  /* And the machinery that only a sharer's frame could need is gone with it. */
  const bridge = code(BRIDGE);
  for (const gone of [
    "registerEmbedFrame",
    "markEmbedReady",
    "startScreenShareNow",
    "EMBED_NOT_VISIBLE",
    "postToEmbed",
  ]) {
    assert.ok(!bridge.includes(gone), `${gone} is back — so is the frame`);
  }
});

test("the library is loaded from their versioned path, not bundled", () => {
  /* A copy vendored into this repository is a copy that goes stale against a
     service it has to stay in lockstep with. */
  const src = code(PUBLISHER);
  assert.match(src, /https:\/\/live\.grav\.in\/v1\/grav-stream\.js/);
  assert.match(src, /window\.GravStream/);
});

/* ── What the share is, and what ends it ───────────────────────────────────── */

test("a window or a tab is refused by the service, and explained here", () => {
  /* `requireEntireScreen` on the room is the enforcement — their SFU refuses the
     producer. The SDK is asked for it as well, so the refusal arrives before the
     publish rather than after it. `ENTIRE_SCREEN_REQUIRED` exists so it can be
     explained, not so it can be implemented. */
  const src = code(PUBLISHER);
  assert.match(src, /requireEntireScreen: true/);
  assert.match(src, /ENTIRE_SCREEN_REQUIRED/);
  assert.match(src, /Share your entire screen, not a single window/);
  assert.match(code("lib/integrations/grav/stream.ts"), /requireEntireScreen: true/);
});

test("the browser's own Stop sharing bar ends the session", () => {
  /* Their `ended` event covers the browser's bar and a dropped connection.
     Sharing is what Online means, so either ends the session rather than leaving
     a room open for somebody who has stopped. */
  assert.match(code(PUBLISHER), /live\.on\("ended"/);
  assert.match(code(BUTTON), /onEnded: \(\) => endSession\(\)/);
});

test("a dismissed picker is a sentence, not a failure", () => {
  /* Somebody who closed the picker has not gone online yet. Treating that as an
     error writes a red notice for a decision they made on purpose. */
  const button = code(BUTTON);
  const at = button.indexOf("if (wasCancelled(error))");
  assert.ok(at > 0, "a cancelled picker is handled as a failure again");
  const branch = button.slice(at, button.indexOf("}", at));
  assert.match(branch, /reportProblem\(/);
  assert.ok(!/sessionFailed/.test(branch), "cancelling fails the session");
  assert.match(button, /sessionFailed\(shareRefusal\(error\)\)/);
});

test("every one of their error codes becomes a sentence", () => {
  /* An integration that shows a code shows nothing. Each of these is a different
     thing to DO next, and the mapping is where that is decided. */
  const src = code(PUBLISHER);
  for (const codeName of [
    "ENTIRE_SCREEN_REQUIRED",
    "SURFACE_UNKNOWN",
    "PERMISSION_DENIED",
    "TOKEN_IS_VIEWER",
    "TOKEN_EXPIRED",
    "SERVER_UNREACHABLE",
    "PUBLISH_FAILED",
  ])
    assert.ok(src.includes(codeName), `${codeName} has no sentence`);
});

/* ── Online is the service's word, and only it can grant it ────────────────── */

test("online is corroborated by the service, and never withdrawn by it", () => {
  /**
   * The SDK's `capture` is this browser's word about itself. The service's
   * `participants[].sharing.screen` is what a manager reads, so it is asked for
   * separately — the two came apart once, when a realtime server accepted the
   * socket and answered nothing.
   *
   * **But the check can only confirm.** A room takes a moment to register a new
   * producer, so the first read after a publish comes back empty; a check that
   * could write `sharing: false` would knock people offline a second after they
   * went online. It polls, and failing that it writes a sentence.
   */
  const button = code(BUTTON);
  const at = button.indexOf("async function confirmSharing");
  assert.ok(at > 0, "the service is no longer asked at all");
  const body = button.slice(at, button.indexOf("\n  function ", at));
  assert.match(body, /fetchRoomPresence\(/);
  assert.match(body, /if \(!sharing\) continue;/, "an empty read is believed");
  assert.ok(
    !/sharing: false/.test(body),
    "the confirmation step can take a status away — that is an auto-offline",
  );
  assert.match(body, /reportProblem\(/, "a screen that never arrives is unsaid");

  const route = code(PRESENCE_ROUTE);
  assert.match(route, /readRoom\(/);
  assert.match(
    route,
    /sharing: them\?\.screen != null/,
    "Online is being decided on something other than a live screen",
  );
});

test("the seat is minted server-side, for the subject's own room", () => {
  /* The API key never reaches the browser: the button asks our own route, and
     that route decides both the room and whether this caller may have a seat in
     it. A client that could name the room could name somebody else's. */
  const button = code(BUTTON);
  assert.match(button, /fetchShareSeat\(viewerId\)/);
  assert.ok(
    !/stream\.grav\.in|GRAV_STREAM_API_KEY/.test(button),
    "the button talks to Grav Stream directly, so the key is in the browser",
  );

  const route = code(TOKEN_ROUTE);
  assert.match(route, /roomName: presenceRoomName\(subject\)/);
  assert.ok(
    !/searchParams\.get\("room"\)/.test(route),
    "the room is being taken from the query string again",
  );
});

test("both stream routes decide access with the same function", () => {
  /* A second copy of an authorisation rule is how the two come to disagree, and
     the weaker one then becomes the way in. */
  for (const path of [TOKEN_ROUTE, PRESENCE_ROUTE]) {
    assert.match(code(path), /authoriseSeat\(request/, `${path} decides its own`);
  }
  const auth = code("lib/server/streamSeatAuth.ts");
  assert.match(auth, /primaryManager\?\.employeeId/);
  assert.match(auth, /subject !== caller/);
});

test("the realtime server and the embed page are not the same field", () => {
  /* Their documentation says so twice, because `url` reads like a page and is
     not one: it is what `share()` connects to. Loading it in a frame, or
     handing the embed URL to the SDK, fails in ways that look like a broken
     token. Both are named at the seat, so nothing downstream assembles either. */
  const seat = code("lib/integrations/grav/credentials.ts");
  assert.match(seat, /roomId: string;[\s\S]{0,600}url: string;[\s\S]{0,400}embedUrl: string;/);
  assert.match(code(BUTTON), /serverUrl: url,/);
});

/* ── The failure that wasted a day ────────────────────────────────────────── */

test("every teardown releases the capture rather than dropping it", () => {
  /* Setting `pendingTrack = null` orphans a live capture whenever the publisher
     never took it, and the browser then reports a share Cowork has given up on.
     The SDK holds its own session in this document, so the same function has to
     stop that too — break, emergency, offline and a failed publish all reach
     here. */
  const src = code(STORE);
  const release = src.slice(
    src.indexOf("function releasePendingTrack"),
    src.indexOf("\n}", src.indexOf("function releasePendingTrack")),
  );
  assert.match(release, /stopPublishing\(\)/, "the live share outlives the status");

  for (const fn of [
    "export function goOffline",
    "export function endSession",
    "export function sessionFailed",
    "export function shareInterrupted",
    "export function startBreak",
    "export function declareEmergency",
  ]) {
    const at = src.indexOf(fn);
    assert.ok(at > 0, `${fn} is gone`);
    const body = src.slice(at, src.indexOf("\n}", at));
    assert.match(
      body,
      /releasePendingTrack\(\)/,
      `${fn} drops the capture reference without stopping the track`,
    );
  }
});

/* ── What screen mode removed ─────────────────────────────────────────────── */

/**
 * **There was a meeting in the middle of this, and now there is not.**
 *
 * The only room type used to be a meeting: its embed took the camera and
 * microphone before it would let anyone in, showed a "Ready to join?" screen
 * with a button, and reported nothing about what was picked. Going online meant
 * a panel, a join, a device prompt and then a picker.
 *
 * A `screen` room asks for no devices and has no join gate, so the whole of that
 * is gone. These fail if any of it comes back.
 */

test("nothing joins a meeting or waits for a join screen", () => {
  for (const path of [BUTTON, PUBLISHER, BRIDGE]) {
    const src = code(path);
    for (const gone of [
      "Join meeting",
      "Ready to join",
      "toggle-mic",
      "toggle-camera",
    ])
      assert.ok(!src.includes(gone), `the meeting-era flow is back in ${path}: ${gone}`);
  }
  /* And the room itself, which is where it is actually enforced. */
  assert.match(code("lib/integrations/grav/stream.ts"), /mode: "screen"/);
});

test("Go online is never disabled by the room warming up", () => {
  /**
   * **This one shipped.** The seat began being fetched when the menu opens, so
   * the session sat at `connecting` for a second or two — and the menu item was
   * `disabled={c.id === "online" && busy}`, where `busy` covers exactly that.
   * The result was a greyed-out Go online for everybody who opened the menu:
   * the one control the menu exists for, unusable, with nothing said about why.
   *
   * There is nothing to guard against. Pressing early opens the confirmation
   * step instead of the picker, which is a step rather than a failure. The only
   * real precondition is knowing who is sharing.
   */
  const src = code(BUTTON);
  assert.match(src, /disabled=\{c\.id === "online" && !viewerId\}/);
  assert.ok(
    !/disabled=\{c\.id === "online" && (busy|warming)\}/.test(src),
    "the online item is disabled while the room comes up again",
  );
  assert.ok(
    !/disabled=\{busy\}/.test(src),
    "the fallback Choose screen button greys itself out while it waits",
  );
});

test("the embed URL never names a parentOrigin", () => {
  /**
   * Their embed posts every event with `postMessage(payload, parentOrigin)`.
   * Naming one that does not match the parent EXACTLY drops every message with
   * no error: no `ready`, no share events, a status stuck on "Preparing…" for
   * ever and an empty console. It shipped that way once, for a value computed
   * server-side from `request.url` — a thing that is right until a proxy, a LAN
   * address or `127.0.0.1` makes it wrong.
   */
  assert.ok(
    !/parentOrigin/.test(code(BRIDGE)),
    "parentOrigin is being sent again — one mismatch and every event is dropped",
  );
  assert.ok(
    !/parentOrigin/.test(code(TOKEN_ROUTE)),
    "the route is naming a parentOrigin again",
  );
});

test("the vendor reference is in the repository", () => {
  /* The integration turns on facts that are not guessable and were each learned
     expensively — activation not crossing postMessage, a hidden frame getting no
     picker, mode and role being fixed at creation. The document that states them
     lives here rather than in a download folder. */
  const doc = readFileSync("docs/integrations/grav-stream.md", "utf8");
  assert.match(doc, /https:\/\/live\.grav\.in\/dashboard/);
  assert.match(doc, /user activation does not cross a postMessage boundary/);
  assert.match(doc, /grav-stream\.js/);
});
