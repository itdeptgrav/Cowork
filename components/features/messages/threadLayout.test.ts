import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { test } from "node:test";

/**
 * Three rules about the shape of a thread, none of which is visible in a diff.
 *
 * A conversation pane has one job beyond showing messages: fit the window, put
 * the newest message where the reader is looking, and never scroll sideways.
 * All three were broken at once and for unrelated reasons, and each failure was
 * silent — the pane rendered, so nothing said anything was wrong.
 *
 *  1. A pasted credential or URL is one unbreakable word, so the bubble's
 *     minimum width became its length and the thread grew a horizontal
 *     scrollbar.
 *  2. `overflow-y: auto` makes the OTHER axis `auto` too, so that scrollbar had
 *     somewhere to appear.
 *  3. The full-height treatment was `deck:`-only, so under 1180px the thread had
 *     no height, never scrolled internally, and the composer went below the fold.
 *
 * Asserted on the source because they are CSS and layout decisions: there is no
 * behaviour to call, and a rendered test would need a real layout engine to
 * measure what these classes do.
 */

const AREA = "components/features/messages/MessagesArea.tsx";

function source(): string {
  return readFileSync(AREA, "utf8");
}

/** Comments stripped, so prose describing a class is not read as the class. */
function code(): string {
  return source()
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[^\S\n]*\/\/.*$/gm, "");
}

/** The `className` on the element carrying `ref={scrollRef}` — the scroll port. */
function scrollPortClasses(): string {
  const src = code();
  const at = src.indexOf("ref={scrollRef}");
  assert.ok(at > 0, "the thread scroll port was not found");
  const className = src.slice(at).match(/className="([^"]+)"/);
  assert.ok(className, "the scroll port has no static className");
  return className[1];
}

test("message text breaks anywhere, so a pasted key cannot widen the thread", () => {
  /* `break-word` would not do: it wraps the word but still reports the unbroken
     length as the element's min-content width, which is the measurement the
     flex row above is sized from. `anywhere` shrinks that minimum too. */
  const src = code();
  const at = src.indexOf("whitespace-pre-wrap");
  assert.ok(at > 0, "the message text span was not found");
  const cls = src.slice(at - 200, at + 200);
  assert.match(
    cls,
    /\[overflow-wrap:anywhere\]/,
    "message text can be widened past the pane by one unbreakable word",
  );
});

test("the scroll port closes its horizontal axis", () => {
  assert.match(
    scrollPortClasses(),
    /\boverflow-x-hidden\b/,
    "overflow-y:auto leaves overflow-x at auto — the thread can scroll sideways",
  );
});

test("the scroll port still scrolls vertically", () => {
  /* The obvious way to get rid of a horizontal scrollbar is `overflow-hidden`,
     which would take the vertical one with it and freeze the thread. */
  assert.match(scrollPortClasses(), /\boverflow-y-auto\b/);
});

test("the scroll port is a flex child that may shrink", () => {
  /* `min-h-0` is what lets a flex item be shorter than its content and
     therefore scroll at all. Without it the pane grows and the composer is
     pushed off the bottom. */
  const cls = scrollPortClasses();
  assert.match(cls, /\bmin-h-0\b/);
  assert.match(cls, /\bflex-1\b/);
});

/** The class list on the two-pane grid. */
function paneGridClasses(): string {
  const src = code();
  const at = src.indexOf("grid-cols-1");
  assert.ok(at > 0, "the messages pane grid was not found");
  const className = src.slice(0, at).lastIndexOf('className="');
  return src.slice(className + 11, src.indexOf('"', className + 11));
}

test("the panes are given a height at EVERY width, not only on the wide layout", () => {
  /* This is the responsive fault. Below `deck:` the region had no definite
     height, so `h-full` inside it resolved against an auto grid row, the
     internal `overflow-y-auto` never engaged, and the page scrolled instead of
     the thread. */
  const cls = paneGridClasses();
  const height = cls.match(/(?:^|\s)h-\[calc\([^\]]+\)\]/);
  assert.ok(
    height,
    "the pane grid has no unprefixed height — the thread will not scroll below 1180px",
  );
});

test("the height is measured in dvh, so a phone's address bar cannot hide the composer", () => {
  /* `vh` on mobile counts the viewport with the browser chrome retracted, so a
     `vh`-tall box is taller than what can actually be seen. */
  const cls = paneGridClasses();
  assert.match(cls, /h-\[calc\(100dvh-/);
  assert.doesNotMatch(
    cls,
    /(?:^|\s)(?:deck:)?h-\[calc\(100vh-/,
    "a vh height would put the composer under the mobile browser chrome",
  );
});

test("the height subtracts the shell rather than a hand-totalled number", () => {
  const cls = paneGridClasses();
  assert.match(cls, /var\(--shell-top\)/);
  assert.match(cls, /var\(--shell-gap\)/);
});

test("the minimum height relaxes below the wide layout", () => {
  /* A landscape phone is genuinely shorter than the 520px floor the wide
     layout uses, and holding that floor would reintroduce the page scroll. */
  const cls = paneGridClasses();
  assert.match(cls, /(?:^|\s)min-h-\[420px\]/);
  assert.match(cls, /deck:min-h-\[520px\]/);
});

test("one pane at a time on narrow screens, both on wide", () => {
  /* Already true, and pinned because the height rule above only makes sense
     while a narrow screen is showing a single full-height pane. */
  const src = code();
  assert.match(src, /hidden deck:block/);
  assert.match(paneGridClasses(), /deck:grid-cols-12/);
});

/* ── Opening a thread lands on the newest message ──────────────────────────── */

test("a resize of the message content re-pins to the bottom", () => {
  /* The one-shot pin runs before the attachments have loaded, so every image
     that decodes afterwards inserts height above the point it scrolled to and
     walks the newest messages off the bottom of the pane. */
  const src = code();
  assert.match(src, /new ResizeObserver\(/, "nothing watches the content for late growth");
  assert.match(src, /observer\.observe\(content\)/);
  assert.match(src, /observer\.disconnect\(\)/, "the observer is never detached");
});

test("the re-pin is gated on the reader still following the conversation", () => {
  /* Ungated, this would be the same bug inverted: a reader looking at
     something older dragged back to the newest message every time an image
     above them finished loading. */
  const src = code();
  assert.match(
    src,
    /if \(!pinnedRef\.current \|\| loadingOlderRef\.current\) return;/,
    "the resize re-pin does not check whether the reader scrolled away",
  );
});

test("scrolling decides whether the reader is following, from where they are", () => {
  const src = code();
  assert.match(
    src,
    /pinnedRef\.current =\s*el\.scrollHeight - el\.scrollTop - el\.clientHeight < 48;/,
    "the pinned state is not derived from the actual scroll position",
  );
});

test("loading older history never re-pins to the bottom", () => {
  /* History grows from the TOP. Pinning on that would fling the reader back to
     "now" the moment they tried to look at anything older — which is why the
     existing restore-my-place branch returns before the pin. */
  const src = code();
  const at = src.indexOf("if (loadingOlderRef.current) {");
  assert.ok(at > 0, "the load-older branch was not found");
  const branch = src.slice(at, at + 400);
  assert.match(branch, /el\.scrollTop = el\.scrollHeight - prevScrollHeightRef\.current/);
  assert.ok(
    branch.indexOf("return;") < branch.indexOf("el.scrollTop = el.scrollHeight;"),
    "the load-older branch falls through to the bottom-pin",
  );
});

test("the observer re-attaches once the content exists", () => {
  /* On the first render the pane shows a skeleton and there is no element to
     observe. Attaching only on `c.id` would miss exactly the load this is for. */
  const src = code();
  const at = src.indexOf("new ResizeObserver(");
  const deps = src.slice(at).match(/\}, \[([^\]]*)\]\);/);
  assert.ok(deps, "the observer effect has no dependency array");
  assert.match(deps[1], /messages\.data/);
});

/* ── The unread badge survives until the reader opens the thread ───────────── */

/**
 * A badge that clears itself is worse than no badge.
 *
 * `active` falls back to `all[0]` so the wide layout never shows an empty right
 * pane. That default is a presentation choice, and it was being treated as
 * reading — so the newest conversation marked itself read on mount, and any
 * message arriving from somebody else re-sorted them to the top, changed
 * `all[0]`, remounted the thread under a new `key` and marked THAT one read
 * too. Nobody had looked at either.
 *
 * On a narrow screen the thread pane is hidden with `display:none` rather than
 * unmounted, so the conversation being marked read was not even on screen —
 * and `visibilityState` cannot tell, because it answers for the tab.
 */

test("only a deliberately-opened thread is marked read", () => {
  const src = code();
  const at = src.indexOf("const markIfVisible");
  assert.ok(at > 0, "the mark-read effect was not found");
  const before = src.slice(src.lastIndexOf("useEffect(", at), at);
  assert.match(
    before,
    /if \(!opened\) return;/,
    "the default-shown conversation still marks itself read",
  );
});

test("opened is true only when the route names the conversation", () => {
  /* The route is set by clicking a row and by nothing else, which is what makes
     it a reliable stand-in for "the reader asked for this". */
  assert.match(
    code(),
    /const openedDeliberately = Boolean\(conversationId\);/,
    "opened is not derived from the route",
  );
  assert.match(code(), /opened=\{openedDeliberately\}/, "Thread is not told");
});

test("the layout's fallback to the first conversation is still there", () => {
  /* The fix must not be "stop defaulting", which would leave a blank pane
     beside a full list — the thing the default exists to prevent. */
  /* `[^]` rather than `.` with the `s` flag, which this tsconfig target
     refuses. */
  assert.match(code(), /conversationId \?\? \([^]*?all\[0\]\.id/);
  assert.match(code(), /!all\.length \? undefined/, "an empty list still has no default");
});

test("the default yields once the reader has closed a thread", () => {
  /* The other half, and the bug it fixes: Escape navigated away correctly and
     the default put the reader straight back into the thread they had just
     closed — on a wide screen the newest conversation is both `all[0]` and,
     usually, the one they were reading, so Escape looked broken.

     `closed` must be part of the condition, and it must come from the URL: the
     two routes are separate segments, so a `useState` flag is discarded on the
     way out and cannot carry the intent across. */
  assert.match(code(), /conversationId \?\? \(closed \|\| !all\.length \? undefined/);
  assert.match(
    code(),
    /router\.push\("\/messages\?closed=1"\)/,
    "closing does not record that it was deliberate",
  );
  assert.doesNotMatch(
    code(),
    /useState\(false\);\s*[^]*?setDismissed/,
    "the intent is held in component state, which the segment change discards",
  );
});

test("opened is a dependency, so clicking the default thread marks it read", () => {
  /* Without it in the deps, a reader clicking the row of the conversation
     already showing as the default would flip `opened` and nothing would
     re-run — the badge would then never clear at all. */
  const src = code();
  const at = src.indexOf("const markIfVisible");
  const deps = src.slice(at).match(/\}, \[([^\]]*)\]\);/);
  assert.ok(deps, "the mark-read effect has no dependency array");
  assert.match(deps[1], /\bopened\b/);
  assert.match(deps[1], /c\.id/);
});

test("an arriving message still cannot mark a thread read", () => {
  /* The older half of this rule, kept: `c.unreadCount` out of the deps is what
     stops a message landing in an open thread from reading itself. */
  const src = code();
  const at = src.indexOf("const markIfVisible");
  const deps = src.slice(at).match(/\}, \[([^\]]*)\]\);/);
  assert.doesNotMatch(deps![1], /unreadCount/);
});

test("the deferred case survives — coming back to the window still marks read", () => {
  const src = code();
  assert.match(src, /addEventListener\("visibilitychange", markIfVisible\)/);
  assert.match(src, /addEventListener\("focus", markIfVisible\)/);
});
