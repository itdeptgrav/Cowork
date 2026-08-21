import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { test } from "node:test";

/**
 * The top bar must never set the width of the document.
 *
 * It is `sticky` and sits on every authenticated page, so if its row is wider
 * than the viewport the whole document widens with it — and every page grows a
 * strip of dead space down the right that has nothing to do with that page's
 * own content. That is what it looked like: cards ending short of the screen
 * edge, an ~8px gutter on the left and ~90px on the right.
 *
 * The cause was structural rather than a wrong number. The row holds three
 * children — the brand, the tab list, and the controls — and the tab list is
 * `hidden` below `deck:`. With `shrink-0` on BOTH remaining groups there is
 * nothing left to yield, so the row simply takes its content's width. The
 * original comment ("the tab list is what yields") was true, and stopped being
 * true at exactly the breakpoint where the tab list disappears.
 *
 * Source assertions, because this is a flex-sizing rule: there is no behaviour
 * to call, and reproducing it faithfully would need a real layout engine.
 */

const TOP_BAR = "components/layout/shell/TopBar.tsx";

function code(): string {
  return readFileSync(TOP_BAR, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/^[^\S\n]*\/\/.*$/gm, "");
}

test("the bar row may shrink below its content", () => {
  /* Without `min-w-0` a flex item refuses to go under its min-content width,
     whatever its children do. */
  assert.match(
    code(),
    /className="flex h-\[52px\] min-w-0 items-center gap-2 pr-2 pl-4"/,
    "the header row cannot compress, so it sets the document width",
  );
});

test("the control cluster only refuses to shrink where the tab list can yield", () => {
  /* `shrink-0` from `deck:` up, where the scrollable tab list absorbs it.
     Below that the tab list is hidden and yields nothing. */
  assert.match(
    code(),
    /className="ml-auto flex min-w-0 shrink items-center gap-2 deck:ml-0 deck:shrink-0"/,
    "the controls are shrink-0 at a width where nothing else can give",
  );
});

test("no two siblings in the bar row are unconditionally shrink-0", () => {
  /* The failure is a PAIR, not a single class: one immovable group is fine, two
     in one row guarantees overflow the moment they do not fit. */
  const src = code();
  const at = src.indexOf('className="flex h-[52px] min-w-0 items-center');
  assert.ok(at > 0, "the header row moved");
  const row = src.slice(at, src.indexOf("</nav>", at));
  const bare = row.match(/className="[^"]*(?<![a-z:])shrink-0[^"]*"/g) ?? [];
  const unconditional = bare.filter((c) => !/deck:shrink-0/.test(c));
  assert.ok(
    unconditional.length <= 1,
    `two or more immovable groups in the bar row: ${unconditional.join(" | ")}`,
  );
});

test("the score pill is what gives way", () => {
  /* It is the widest control and the only one whose label survives being
     shortened — an icon button clipped is a target nobody can hit, where
     "Sco…(95%)" is still a score. */
  const src = code();
  const at = src.indexOf("function ScorePill(");
  assert.ok(at > 0, "ScorePill moved");
  const body = src.slice(at, src.indexOf("\n}", src.indexOf("</Link>", at)));
  assert.match(body, /inline-flex min-w-0 items-center/);
  assert.match(body, /<span className="truncate">Score<\/span>/);
});

test("the tab list is still the one that scrolls on wide screens", () => {
  /* Unchanged above `deck:` — the fix must not move the yielding from the tab
     list to the controls at the width where the original decision was right. */
  const src = code();
  assert.match(src, /className="rail mx-auto hidden min-w-0 items-center gap-1 overflow-x-auto deck:flex"/);
});
