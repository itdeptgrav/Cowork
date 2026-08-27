import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";

/**
 * Why pressing Leave in a scheduled meeting put you straight back in the call.
 *
 * `MeetingRoom` renders a `LiveKitRoom` with `connect` set, and calls `onLeave`
 * from its `onDisconnected` handler. The detail area's `onLeave` refetched the
 * participant list and nothing else — it never stopped RENDERING the room. So
 * LiveKit disconnected and, still mounted and still told to connect, made
 * another connection. The same interface came back, which read as Leave not
 * working.
 *
 * The guest view never had this: its `onLeave` moves to a lobby phase, so the
 * room unmounts. These pin the same property on the signed-in view — leaving
 * has to take the room off the screen, not merely be noticed.
 */

function code(path: string): string {
  return readFileSync(path, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

const DETAIL = "components/features/meetings/MeetingDetailArea.tsx";
const GUEST = "components/features/meetings/GuestMeetingArea.tsx";
const ROOM = "components/features/meetings/MeetingRoom.tsx";

/**
 * **These two now assert the same guarantees through a different mechanism.**
 *
 * The room no longer lives on this page. It is mounted once in the shell
 * (`MeetingEngine`) and drawn over a rectangle the page publishes, because a
 * room that lives inside a page is disconnected by ordinary navigation — Back,
 * a notification, any link — which ended the meeting and abandoned that
 * participant's half of the recording.
 *
 * So "the room is not rendered once you have left" is no longer about a branch
 * around `<MeetingRoom>`; it is about the SESSION being closed, which is what
 * unmounts the room wherever it is being drawn. The property is unchanged and
 * still worth pinning: leaving must take the room down, not merely be noticed.
 */

test("leaving records that you are out, rather than only refetching", () => {
  const src = code(DETAIL);
  /* The handler now rides the session — the engine is in the shell and has no
     idea which page, if any, is showing the meeting. */
  const handler = /onLeave: \(\) => \{([\s\S]*?)\},/.exec(src)?.[1] ?? "";
  assert.notEqual(handler, "", "onLeave is no longer a block body");
  assert.match(handler, /setLeft\(true\)/, "leaving does not record that you left");
  assert.match(handler, /parts\.refetch\(\)/, "the participant list is not refreshed");
});

test("the room is not rendered once you have left", () => {
  const src = code(DETAIL);
  /* Closing the session is what takes the room down. Without this, `setLeft`
     would be state nothing acts on and LiveKit would stay connected in the
     corner of every other page. */
  assert.match(
    src,
    /if \(left\) closeMeeting\(\)/,
    "leaving does not close the meeting session",
  );
  /* And the page must not open one while you are out, or the effect would put
     you straight back into the call it just took you out of. */
  assert.match(
    src,
    /if \(!liveMeeting \|\| left\) return/,
    "the session is opened without checking whether you have left",
  );
});

test("the room outlives the page it is opened from", () => {
  /**
   * The reason for the whole arrangement. `MeetingDetailArea` must NOT render
   * the room itself: if it did, navigating away would unmount LiveKit and the
   * recorder with it, which is exactly the fault this replaced.
   */
  const src = code(DETAIL);
  assert.equal(
    /<MeetingRoom\b/.test(src),
    false,
    "the meeting page renders the room again, so navigation will end the call",
  );
  assert.match(src, /<MeetingStage\b/, "the page publishes no stage to draw on");

  const engine = code("components/features/meetings/MeetingEngine.tsx");
  assert.match(engine, /<MeetingRoom\b/, "the shell engine does not render the room");
  /* One position in the tree for both presentations: React reconciles by
     position, and a LiveKitRoom that moves tears down its media. */
  assert.equal(
    (engine.match(/<MeetingRoom\b/g) ?? []).length,
    1,
    "the engine renders the room in more than one place, so it will reconnect",
  );
});

test("there is a way back in", () => {
  /* Leaving a meeting that is still running must not be one-way: the branch
     that replaces the room has to offer a rejoin, or a misclick ends your
     participation until a reload. */
  const src = code(DETAIL);
  assert.match(src, /setLeft\(false\)/, "nothing clears the left state");
  assert.match(src, /Rejoin/, "no rejoin control");
});

test("the guest view still unmounts its room on leave", () => {
  /* This one was always right — it is here so a later tidy-up cannot quietly
     give the guest view the bug the signed-in view just lost. */
  const src = code(GUEST);
  const handler = /onLeave=\{\(\) =>([\s\S]*?)\n      \}/.exec(src)?.[1] ?? "";
  assert.match(handler, /setPhase\(/, "guest leave no longer changes phase");
});

test("MeetingRoom still reports its own disconnect", () => {
  /* The fix above is only reached if the room keeps calling `onLeave` when
     LiveKit disconnects — including a disconnect the person did not ask for. */
  const src = code(ROOM);
  assert.match(src, /onDisconnected=\{/, "no disconnect handler");
  assert.match(src, /onLeave\(\)/, "disconnect no longer notifies the parent");
});

/* ── The floating window shares a corner with the music bar ───────────────── */

test("the floating meeting does not sit on top of the music bar", () => {
  /**
   * `MusicBar` is `fixed bottom-3 left-3 z-40` and its own comment claims that
   * corner as "the one region of a page that is reliably empty". The floating
   * meeting is z-70 in the same corner, so a fixed `bottom` would cover the bar
   * outright — leaving somebody unable to pause the music they joined a meeting
   * to get away from.
   *
   * `--music-bar-clearance` is the variable the player already publishes for
   * exactly this, so the window rises while the bar is up with no coordination
   * between the two beyond that one value.
   */
  const engine = code("components/features/meetings/MeetingEngine.tsx");
  assert.match(
    engine,
    /var\(--music-bar-clearance/,
    "the floating meeting ignores the music bar's clearance",
  );

  const bar = readFileSync("components/features/music/MusicBar.tsx", "utf8");
  assert.match(
    bar,
    /bottom-3 left-3/,
    "the music bar moved — the clearance above may no longer be the right axis",
  );
});

test("re-opening the same meeting does not churn the whole shell", () => {
  /* The page opens from an effect keyed on the meeting it read, and `useQuery`
     returns a new object whenever anything in the repository changes. Storing
     each one would push a new context value through the entire shell several
     times a minute for a meeting that had not changed. */
  const ctx = code("components/features/meetings/MeetingSessionContext.tsx");
  assert.match(ctx, /prev\.meeting\.id === next\.meeting\.id/);
  assert.match(ctx, /return prev;/);
});

/* ── Picture-in-picture: a real window, and still one room ────────────────── */

test("the PiP window does not re-render the room into a second tree", () => {
  /**
   * The whole point, and the easiest thing to get wrong. Rendering the meeting
   * into the PiP window with a second portal unmounts the first tree and mounts
   * a new one — which tears down `LiveKitRoom`, drops the connection and
   * abandons the recorder, at the exact moment somebody has stepped away and is
   * relying on it.
   *
   * So the ROOM is rendered exactly once, into ONE container that is created
   * once and moved between documents. React's target is the same node
   * throughout.
   *
   * There are two portals, and only one of them carries the room: the home
   * element is portalled to `<body>` so its absolute position resolves against
   * the page rather than against whichever shell wrapper happens to be
   * positioned. Counting portals would therefore pin the wrong thing — what
   * must stay singular is the room.
   */
  const engine = code("components/features/meetings/MeetingEngine.tsx");
  assert.equal(
    (engine.match(/<MeetingRoom\b/g) ?? []).length,
    1,
    "the engine renders the room in more than one place, so it will reconnect",
  );

  const hook = code("lib/legacy-ui/useDocumentPip.ts");
  assert.match(hook, /document\.createElement\("div"\)/, "no stable container");
  assert.match(
    hook,
    /pip\.document\.body\.append\(el\)/,
    "the container is not moved into the PiP document",
  );
});

test("closing the PiP window brings the meeting home before destroying it", () => {
  /* A node still parented to a closing document is destroyed with it, and
     React would go on rendering into an element that is nowhere. */
  const hook = code("lib/legacy-ui/useDocumentPip.ts");
  const close = hook.slice(hook.indexOf("const close ="), hook.indexOf("const open ="));
  const home = close.indexOf(".append(el)");
  const shut = close.indexOf("pip?.close()");
  assert.ok(home !== -1 && shut !== -1, "close does not do both");
  assert.ok(home < shut, "the window is closed before the container comes home");
  /* And the same when the window is closed by the person rather than by us. */
  assert.match(hook, /addEventListener\("pagehide"/, "a self-closed window strands the room");
});

test("auto-PiP goes through the browser's own offer, not a visibility hack", () => {
  /**
   * `requestWindow()` needs a user gesture; a `visibilitychange` handler is not
   * one and throws `NotAllowedError`. The sanctioned route is the
   * `enterpictureinpicture` media-session action, which Chrome offers to the
   * reader and then invokes itself. Nothing here prompts or pesters.
   */
  const auto = code("lib/legacy-ui/useAutoPip.ts");
  assert.match(auto, /setActionHandler\(\s*"enterpictureinpicture"/);
  assert.equal(
    /addEventListener\("visibilitychange"/.test(auto),
    false,
    "auto-PiP is driven from a visibility listener, which the browser refuses",
  );
  /* Registered and removed — a handler left behind keeps the page looking like
     a media page long after the meeting ended. */
  assert.match(auto, /"enterpictureinpicture", null/);
});

test("no picture-in-picture control where the browser has no such window", () => {
  /* Firefox and Safari have no Document PiP. Offering a button that throws is
     worse than offering nothing: the in-tab floating window already works. */
  const engine = code("components/features/meetings/MeetingEngine.tsx");
  assert.match(engine, /pip\.supported && !pip\.isOpen \? openPip : undefined/);
  const room = code(ROOM);
  assert.match(room, /\{onPopOut && \(/, "the control is not gated on support");
});

/* ── Flicker: the docked meeting must not lag the page it sits in ─────────── */

test("scrolling does not re-render the shell to move the meeting", () => {
  /**
   * The docked window is `position: fixed`, so it has to be repositioned as the
   * page scrolls. Measuring in the STAGE and putting each `DOMRect` into React
   * state re-rendered the shell once per scroll frame, and repainted the live
   * video a frame behind the page it is supposed to be sitting in — which is
   * exactly what "the screen flashes" looks like.
   *
   * So the context carries the ELEMENT, which is stable, and the engine writes
   * the position straight onto a style in a layout effect.
   */
  const ctx = code("components/features/meetings/MeetingSessionContext.tsx");
  assert.match(ctx, /stageEl: HTMLElement \| null/);
  assert.equal(
    /DOMRect/.test(ctx),
    false,
    "the context is storing rectangles again — that re-renders per scroll frame",
  );

  const stage = code("components/features/meetings/MeetingStage.tsx");
  assert.equal(
    /getBoundingClientRect/.test(stage),
    false,
    "the stage measures itself again, which puts a rect back into React state",
  );

  const engine = code("components/features/meetings/MeetingEngine.tsx");
  assert.match(engine, /useLayoutEffect/, "positioning is not in a layout effect");
  assert.match(engine, /home\.style\.left/, "the position is not written directly");
  /* Passive, so moving the meeting can never make the page scroll badly. */
  /* Stronger than a passive listener: there is no scroll listener AT ALL. The
     docked box is positioned in document coordinates, so scrolling moves it
     because the document moves — on the compositor, in the same frame as
     everything else. Nothing runs late, so nothing can shear. */
  assert.match(engine, /window.scrollX/);
  assert.match(engine, /window.scrollY/);
  assert.equal(
    /addEventListener\("scroll"/.test(engine),
    false,
    "the meeting is repositioned on scroll again, which always lags the page",
  );
});

test("joining is silent and dark by default", () => {
  /**
   * The signed-in view has no lobby — it connects as soon as the page opens —
   * so publishing the microphone and camera on connect meant being heard and
   * seen before deciding to be. A click to speak is a small friction; being
   * heard before you meant to be cannot be taken back.
   */
  const room = code(ROOM);
  const props = room.slice(room.indexOf("<LiveKitRoom"), room.indexOf("data-lk-theme"));
  assert.match(props, /video=\{false\}/, "the camera is on by default again");
  assert.match(props, /audio=\{false\}/, "the microphone is live by default again");
});

test("the room fills the box the engine gives it", () => {
  /**
   * The room used to size itself in the page's own flow, so a minimum height
   * was enough. It does not any more — the engine hands it a box of an exact
   * size, and a frame with only a MINIMUM height sizes to its content inside
   * one: header, control bar, and then a large empty black remainder with the
   * controls stranded at the top.
   *
   * `h-full` on the frame, and `flex-1` on the room inside it — `h-full` there
   * would ask for the whole frame including the header's height and overflow by
   * exactly that much.
   */
  const room = code(ROOM);
  const frame = room.slice(room.indexOf("slab slab-flat relative flex h-full min-h"));
  assert.notEqual(frame, "", "the docked frame no longer fills its container");

  const lk = room.slice(room.indexOf("<LiveKitRoom"), room.indexOf("<MuteBridge"));
  assert.match(lk, /className="flex min-h-0 flex-1"/, "the room does not take the space left by the header");
  assert.equal(
    /className="flex h-full min-h-0"/.test(lk),
    false,
    "the room asks for the full frame height again and will overflow past the header",
  );
});

test("the picture-in-picture window gives its document a height", () => {
  /**
   * A PiP document starts as bare `<html><body>`, both sized to their content.
   * The container is `height: 100%`, which against a body of automatic height
   * collapses to whatever the header and control bar need — so the participant
   * grid got a few pixels and the rest of the window was black with the
   * controls stranded near the top.
   *
   * The chain has to be unbroken from `<html>` down, which is why both are set.
   */
  const hook = code("lib/legacy-ui/useDocumentPip.ts");
  assert.match(hook, /documentElement\.style\.height = "100%"/);
  assert.match(hook, /body\.style\.height = "100%"/);
  /* And the container has to fill a FLEX parent, not only a block one. */
  assert.match(hook, /el\.style\.flex = "1 1 auto"/);
});

/* ── The floating window is a window: it moves, and it opens ──────────────── */

test("the floating window can be dragged by its header", () => {
  /* Pointer events, not mouse: one path covers trackpad, mouse and touch, and
     `setPointerCapture` keeps the drag alive when the pointer crosses the
     video, which would otherwise swallow the moves and strand it mid-drag. */
  const engine = code("components/features/meetings/MeetingEngine.tsx");
  assert.match(engine, /setPointerCapture/);
  assert.match(engine, /const onDragStart = useCallback/);
  /* Clamped, or a window dragged past the edge can only be recovered by a
     reload. */
  assert.match(engine, /window\.innerWidth - FLOATING\.width/);

  const room = code(ROOM);
  assert.match(room, /onPointerDown=\{onDragHandle\}/);
  /* A press on a control is that control, never the start of a drag. */
  assert.match(room, /onPointerDown=\{\(e\) => e\.stopPropagation\(\)\}/);
});

test("the way back to the full meeting is named, not a bare arrow", () => {
  /* A chevron beside a pop-out icon reads as "next". The one control somebody
     in a corner window wants was the one they could not identify. */
  const room = code(ROOM);
  assert.match(room, /Back to the full meeting/);
  assert.match(room, /Open\s*\n\s*<\/button>/);
});

test("a pinned track is enlarged and the rest stay visible", () => {
  /**
   * A shared screen in an equal grid is a thumbnail of a spreadsheet: present
   * and unreadable. Pinning is how a reader says which tile carries the thing
   * everybody is looking at.
   *
   * It is a decision about your OWN screen — nothing is broadcast, because
   * whose turn it is to look at what is not the pinner's call for the room.
   */
  const room = code(ROOM);
  assert.match(room, /<FocusLayoutContainer/);
  assert.match(room, /<FocusLayout trackRef=\{pinned\}/);
  assert.match(room, /<CarouselLayout tracks=\{others\}/);
  /* No grid when something is pinned, and no focus layout when nothing is. */
  assert.match(room, /pinned \? \(/);
});

test("a shared screen pins itself once, and can be overridden", () => {
  /* Somebody sharing has almost always done it to be looked at. Making every
     viewer hunt for a pin button first is the wrong default — but it stays a
     default: unpin, or pin something else, and the choice holds. */
  const room = code(ROOM);
  assert.match(room, /autoPinnedRef/);
  assert.match(room, /if \(autoPinnedRef\.current === key\) return;/);
});


/* ── The per-tile menu: three options, all of which do something ──────────── */

test("every entry in the tile menu takes real effect", () => {
  /**
   * A menu of plausible-looking options that quietly do nothing is worse than a
   * short one: somebody presses "hide", sees no change, and stops trusting the
   * rest of the controls too. So each of the three is wired to something
   * verifiable by looking at the screen.
   */
  const menu = code("components/features/meetings/TileMenu.tsx");
  /* Pin — hands the key up to the stage, which swaps to the focus layout. */
  assert.match(menu, /onPin\(isPinned \? null : key\)/);
  /* Hide — the stage filters the grid by these keys. */
  assert.match(menu, /onHide\(key, !isHidden\)/);
  const room = code(ROOM);
  assert.match(room, /hiddenKeys\.has\(keyOf\(t\)\)/);
  /* Silence — LiveKit's own per-participant volume in this browser. */
  assert.match(menu, /remote\.setVolume\(silenced \? 1 : 0\)/);
});

test("the menu says these are local decisions, not room ones", () => {
  /* "Mute" on a control that only affects you is a promise the room will not
     keep — somebody would believe they had silenced a speaker for everybody. */
  const menu = code("components/features/meetings/TileMenu.tsx");
  assert.match(menu, /Silence for me/);
  assert.match(menu, /Only on your screen/);
  assert.match(menu, /Their recording is unaffected/);
});

test("an option that cannot work is absent, not disabled", () => {
  /* There is no volume to change on your own tile, and a screen share's audio
     is a different track from the person's microphone. */
  const menu = code("components/features/meetings/TileMenu.tsx");
  assert.match(menu, /\{remote && !isLocal && !isScreen && \(/);
  assert.match(menu, /participant instanceof RemoteParticipant/);
});

test("hiding cannot strand the reader with an empty stage", () => {
  /* The pinned tile survives a hide, and hiding everything offers the way
     back rather than leaving a blank panel. */
  const room = code(ROOM);
  assert.match(room, /\|\| keyOf\(t\) === pinnedKey/);
  assert.match(room, /Show them all again/);
});
