import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";

/**
 * What the meeting page owes a screen narrower than a desk.
 *
 * The page had exactly two compositions: a 2:1 split at `deck` (1180px), and
 * below it a single column. That single column was the whole problem. A tablet
 * — and a desktop window merely dragged narrow — got a full-width room followed
 * by EIGHT stacked panels: Details, Participants, Transcript, Summary,
 * Recordings, Guest link, History. Finding the transcript meant scrolling past
 * all of them, and a 900px-wide Details panel carried two facts on it.
 *
 * These pin the three things that were actually broken and are invisible to
 * `tsc`: the rail's flow, the room's height, and controls whose labels are a
 * PROP rather than a class, so no stylesheet could have rescued them.
 *
 * Verified against the running dev server at three widths before being written:
 * 375px → 1 column / 416px room, 900px → 2 columns / 480px, 1280px → rail
 * beside the room / 520px.
 */

function code(path: string): string {
  return readFileSync(path, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

const DETAIL = "components/features/meetings/MeetingDetailArea.tsx";
const ROOM = "components/features/meetings/MeetingRoom.tsx";
const GUEST = "components/features/meetings/GuestMeetingArea.tsx";
const MASTHEAD = "components/features/meetings/MeetingMasthead.tsx";
const MEDIA = "lib/hooks/useMediaQuery.ts";

/* ------------------------------------------------------------- the rail */

test("the rail flows into two columns between sm and deck", () => {
  /* The gap this closes: a tablet showed one column of eight panels. */
  const src = code(DETAIL);
  assert.match(src, /sm:columns-2/);
  assert.match(src, /deck:columns-1/);
});

test("a panel is never sawn across the column gap", () => {
  /* `columns` will split a child mid-panel without this — a Participants list
     whose last two rows appear at the top of the next column. */
  const src = code(DETAIL);
  assert.match(src, /break-inside-avoid/);
});

test("columns, not a two-column grid", () => {
  /* A grid row is as tall as its tallest cell, so Details beside a generated
     transcript leaves a hole the height of the difference. `columns` has no
     rows. This is the reason the class is what it is, so it is worth pinning
     against a well-meaning change back to `grid-cols-2`. */
  const src = code(DETAIL);
  assert.doesNotMatch(
    src,
    /sm:grid-cols-2[^"]*deck:grid-cols-1/,
    "the rail was changed to a grid, which reintroduces the ragged-row holes",
  );
});

/* ------------------------------------------------------------- the room */

test("the room's height is a ladder, not one desk measurement", () => {
  /* 520px on a 667px phone left the control bar — the only way to mute or
     leave — below the fold. */
  const src = code(DETAIL);
  assert.match(src, /min-h-\[26rem\]/);
  assert.match(src, /sm:min-h-\[30rem\]/);
  assert.match(src, /deck:min-h-\[32\.5rem\]/);
  assert.doesNotMatch(
    src,
    /MeetingStage[\s\S]{0,200}min-h-\[520px\]/,
    "the flat 520px is back",
  );
});

test("the control bar drops its labels on a narrow screen, not only in the corner window", () => {
  /* `compact` is the 340px floating window. A 375px phone is not compact, so
     it got the full "Microphone ⌄ Camera ⌄ Share screen Leave" and overflowed. */
  /* It lives in `RoomInterior` now, shared with a task's meeting — so a phone
     gets the same treatment in both rooms rather than only in this one. */
  const src = code("components/features/meetings/RoomInterior.tsx");
  assert.match(src, /compact \|\| !wideEnoughForLabels \? "minimal" : "verbose"/);
});

test("guests get the same treatment", () => {
  /* A guest is the likeliest person to be on a phone: they were sent a link,
     and a link opens wherever the reader happens to be. */
  const src = code(GUEST);
  assert.match(src, /wideEnoughForLabels \? "verbose" : "minimal"/);
  assert.doesNotMatch(
    src,
    /<ControlBar variation="verbose"/,
    "the guest bar is hardcoded verbose again",
  );
});

/* ------------------------------------------------------------ the header */

test("the page has a title element, not just a breadcrumb crumb", () => {
  /* The meeting's name existed only as the last crumb — caption size, muted,
     styled as navigation — while five buttons were the loudest thing present. */
  const src = code(MASTHEAD);
  assert.match(src, /<h1/);
});

test("the masthead carries when, how long and who", () => {
  /* Below `deck` the Details panel sits underneath the room, so on a phone the
     meeting's own time was a screen-height of scrolling from its name. */
  const src = code(DETAIL);
  assert.match(src, /<MeetingMasthead/);
  assert.match(src, /when=\{/);
  assert.match(src, /duration=\{/);
  assert.match(src, /organiser=\{/);
});

test("the organiser's controls are built once and placed by the masthead", () => {
  /* Two conditional blocks — one for wide, one for narrow — is two places to
     forget a status when the lifecycle grows a state. */
  const src = code(DETAIL);
  assert.match(src, /const organiserActions = \(/);
  assert.match(src, /actions=\{refusalToManage \? undefined : organiserActions\}/);
});

/* --------------------------------------------------------------- facts */

test("a fact is never truncated", () => {
  /* This is the "When → 28" in the screenshot: `justify-between` with a
     truncating value meant the label kept its width and the date was clipped
     to two characters. A date reading "28" looks like a value, not like
     something missing, which is what made it hard to spot. */
  const src = readFileSync(DETAIL, "utf8");
  const fact = src.slice(src.indexOf("function Fact("));
  assert.doesNotMatch(fact, /truncate/, "the value truncates again");
  assert.match(fact, /flex-col[\s\S]*sm:flex-row/, "the pair no longer stacks when narrow");
});

/* ---------------------------------------------------------------- touch */

test("mid-call controls are thumb-sized on a phone", () => {
  /* 32px is a comfortable mouse click and a poor one-handed tap, and the room
     header is where these are pressed during a call. */
  for (const path of [ROOM, GUEST]) {
    assert.match(code(path), /h-9 w-9[^"]*sm:h-8 sm:w-8/, `${path} keeps 32px targets`);
  }
});

/* ------------------------------------------------------- the hook itself */

test("the viewport is read from a store, not guessed at render", () => {
  const src = code(MEDIA);
  assert.match(src, /useSyncExternalStore/);
  assert.match(src, /getServerSnapshot/);
});

test("a server render reports no match rather than guessing a width", () => {
  /* Paired with mobile-first defaults, false is the safe answer: a page
     rendered where there is no viewport shows the narrow composition. */
  const src = code(MEDIA);
  assert.match(src, /function getServerSnapshot\(\): boolean \{\s*return false;/);
});

test("older Safari's addListener is handled", () => {
  const src = code(MEDIA);
  assert.match(src, /addListener/);
  assert.match(src, /removeListener/);
});

test("breakpoints come from named constants, not loose pixel values", () => {
  /* `73.75rem` is `--breakpoint-deck` in globals.css. A component repeating it
     as a literal is a second definition free to drift from the stylesheet. */
  const src = code(MEDIA);
  assert.match(src, /73\.75rem/);
  assert.match(src, /BREAKPOINT/);
  for (const path of [ROOM, GUEST]) {
    assert.doesNotMatch(
      code(path),
      /useMediaQuery\("\(min-width/,
      `${path} inlines a raw media query instead of using BREAKPOINT`,
    );
  }
});

/* --------------------------------------------------- the rail's own shape */

test("the room sticks while the rail scrolls past it", () => {
  /* The room is a fixed height and the rail is seven panels tall, so the left
     column ran out of content less than halfway down and left a column-wide
     hole of nothing under the video — the emptiest part of the page was its
     centre. Sticky also means reading the transcript no longer scrolls a live
     meeting off the screen. */
  const src = code(DETAIL);
  assert.match(src, /deck:sticky/);
  assert.match(src, /deck:self-start/, "a stretched grid item has nothing to slide within");
});

test("the rail is grouped, not seven equal panels in a row", () => {
  const src = code(DETAIL);
  assert.match(src, /<RailHeading>About this meeting<\/RailHeading>/);
  assert.match(src, /<RailHeading>The record<\/RailHeading>/);
  assert.match(src, /<RailHeading>Files and history<\/RailHeading>/);
});

test("the last group holds the same two panels for everybody", () => {
  /* It used to be "Sharing and history", which needed a conditional name: a
     participant has no guest link, so the heading would have labelled a
     section containing only a change log. Moving the guest link up into About
     — where it belongs, being about access rather than about a record — left a
     group that is the same two logs for every reader and needs no conditional.

     The guest link itself is still the organiser's alone. */
  const src = code(DETAIL);
  assert.doesNotMatch(src, /Sharing and history/, "the old conditional heading is back");
  assert.match(src, /\{isOrganiser && \(/, "the guest link lost its permission check");
});

test("section headings are Title, never a tracked uppercase eyebrow", () => {
  /* DESIGN.md's One Kicker Rule: tracked caps over a panel is a defect. The
     tracked style belongs to the single wayfinding kicker and to metric
     labels. Separation is carried by space, not by a louder style. */
  const src = readFileSync(DETAIL, "utf8");
  const heading = src.slice(src.indexOf("function RailHeading("));
  const cls = heading.slice(0, heading.indexOf("</h2>"));
  assert.doesNotMatch(cls, /uppercase/, "the section heading became an eyebrow");
  assert.match(cls, /mt-8/, "a section heading takes 32px above");
  assert.match(cls, /mb-3/, "and 12px below");
  assert.match(cls, /first:mt-0/, "the first heading must not indent the rail");
});

test("a heading is not laid at the foot of a column away from its panels", () => {
  /* The rail is a CSS-columns flow between sm and deck. */
  const src = code(DETAIL);
  assert.match(src, /break-after-avoid/);
});

test("panel rhythm targets sections so a heading keeps its own spacing", () => {
  /* `[&>*]:mb-4` compiles to `.x > *`, which outranks a child's own `mb-3` on
     specificity — so a heading inside the old selector could not set its own
     rhythm and the 32/12 section spacing collapsed to a flat 16. */
  const src = code(DETAIL);
  assert.match(src, /\[&>section\]:mb-4/);
  assert.doesNotMatch(src, /\[&>\*\]:mb-4/, "the rhythm selector is back to a wildcard");
});

test("every rail panel is a named landmark", () => {
  /* An unnamed <section> is not exposed as a landmark, so a screen-reader user
     cannot jump between panels — on a rail of seven that is the difference
     between navigating and tabbing through everything. */
  const src = code(DETAIL);
  for (const name of ["Details", "Participants", "Transcript", "AI Summary"]) {
    assert.match(src, new RegExp(`<Panel label="${name}"`), `${name} is unnamed`);
  }
  /* History and Recorded audio are collapsible now, and CollapsiblePanel names
     its own landmark from the title — see its `label ?? title`. */
  const collapsible = code("components/features/meetings/CollapsiblePanel.tsx");
  assert.ok(
    collapsible.includes("label={label ?? title}"),
    "a shut panel is an unnamed landmark",
  );
});
