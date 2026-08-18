import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import {
  DEFAULT_ALIGN,
  DEFAULT_WIDTH_PCT,
  MAX_WIDTH_PCT,
  MIN_WIDTH_PCT,
  clampWidthPct,
  imageStyle,
  readAlign,
  readImageStyle,
  widthFromDrag,
  widthFromHandleDrag,
  resizeFromHandleDrag,
  clampAspect,
  MIN_ASPECT,
  MAX_ASPECT,
  HANDLES,
  handleAxis,
  handleCursor,
  FULL_CROP,
  MIN_CROP_PCT,
  clampCrop,
  cropScalePct,
  cropStyles,
  cropTranslate,
  isCropped,
} from "./imageLayout.ts";

/**
 * **Reported 17 Aug 2026.** An uploaded document image landed at its natural
 * size, in the flow, and could not be resized or moved. Asked for: the Word
 * and Google Docs behaviour — drag to resize, align left / centre / right with
 * the text wrapping around it.
 */

test("a width is clamped to something the page can hold", () => {
  /* A percentage, not pixels: a document written on a wide screen and printed
     on A4 must not have an image running off the page. */
  assert.equal(clampWidthPct(50), 50);
  assert.equal(clampWidthPct(0), MIN_WIDTH_PCT);
  assert.equal(clampWidthPct(-40), MIN_WIDTH_PCT);
  assert.equal(clampWidthPct(400), MAX_WIDTH_PCT);
  assert.equal(clampWidthPct(33.4), 33);
});

test("nonsense falls back rather than refusing the image", () => {
  /* The HTML is the record, and a document edited elsewhere still has to
     open. An unreadable width costs the size, never the picture. */
  for (const bad of [null, undefined, "", "abc", NaN, Infinity, {}]) {
    assert.equal(clampWidthPct(bad), DEFAULT_WIDTH_PCT);
  }
  for (const bad of [null, undefined, "middle", "justify", 7]) {
    assert.equal(readAlign(bad), DEFAULT_ALIGN);
  }
});

test("left and right FLOAT, so the text wraps around", () => {
  /* Floating is the one mechanism that wraps text in a browser, in print, and
     in the HTML a mail client renders. */
  assert.match(imageStyle({ widthPct: 40, align: "left" }), /float:left/);
  assert.match(imageStyle({ widthPct: 40, align: "right" }), /float:right/);
});

test("centre does not float — text sits above and below it", () => {
  /* Word does not wrap text around a centred image either; it sits on its own
     line. Floating it would be a different layout than the one chosen. */
  const s = imageStyle({ widthPct: 60, align: "center" });
  assert.equal(/float:/.test(s), false);
  assert.match(s, /margin-left:auto/);
  assert.match(s, /margin-right:auto/);
  assert.match(s, /display:block/);
});

test("the style always caps at the column, whatever width was asked for", () => {
  /* `width` alone lets a 12MP photograph at 100% push the page wider than the
     column it sits in. */
  for (const align of ["left", "center", "right"] as const) {
    const s = imageStyle({ widthPct: 100, align });
    assert.match(s, /max-width:100%/, `${align} can overflow the column`);
    assert.match(s, /height:auto/, `${align} distorts the aspect ratio`);
  }
});

test("a style written by this rule reads back as what was written", () => {
  /* The round trip that matters: the document is saved and reloaded as HTML,
     so what the editor knows has to survive in the markup. */
  for (const align of ["left", "center", "right"] as const) {
    for (const widthPct of [MIN_WIDTH_PCT, 45, MAX_WIDTH_PCT]) {
      const back = readImageStyle(imageStyle({ widthPct, align }));
      assert.deepEqual(
        back,
        { widthPct, align, aspect: null },
        `${align} at ${widthPct}%`,
      );
      /* And a stretched one carries its stretch through the same trip. */
      const stretched = readImageStyle(
        imageStyle({ widthPct, align, aspect: 1.5 }),
      );
      assert.equal(stretched.aspect, 1.5, `${align} lost the stretch`);
    }
  }
});

test("an image from before this existed opens at the defaults", () => {
  assert.deepEqual(readImageStyle(null), {
    widthPct: DEFAULT_WIDTH_PCT,
    align: DEFAULT_ALIGN,
    aspect: null,
  });
  assert.deepEqual(readImageStyle("border:1px solid red"), {
    widthPct: DEFAULT_WIDTH_PCT,
    align: DEFAULT_ALIGN,
    aspect: null,
  });
});

test("dragging the right edge grows the image rightwards", () => {
  /* Taken from the pointer's distance, not a delta, so the corner stays under
     the finger through a long drag instead of drifting away from it. */
  assert.equal(
    widthFromDrag({ pointerX: 400, leftX: 100, rightX: 300, columnPx: 600, edge: "right" }),
    50,
  );
});

test("dragging the LEFT edge is mirrored, so it grows the way the hand moves", () => {
  /* Without the mirror, pulling the left handle outwards shrinks the image —
     the one interaction people report as "backwards". */
  assert.equal(
    widthFromDrag({ pointerX: 100, leftX: 200, rightX: 400, columnPx: 600, edge: "left" }),
    50,
  );
});

test("a drag is clamped like any other width", () => {
  assert.equal(
    widthFromDrag({ pointerX: 5000, leftX: 0, rightX: 100, columnPx: 600, edge: "right" }),
    MAX_WIDTH_PCT,
  );
  assert.equal(
    widthFromDrag({ pointerX: -80, leftX: 0, rightX: 100, columnPx: 600, edge: "right" }),
    MIN_WIDTH_PCT,
  );
  /* An unmeasured column cannot produce a percentage, so it keeps the default
     rather than dividing by zero. */
  assert.equal(
    widthFromDrag({ pointerX: 300, leftX: 0, rightX: 100, columnPx: 0, edge: "right" }),
    DEFAULT_WIDTH_PCT,
  );
});

/* ── Eight handles ────────────────────────────────────────────────────────── */

test("there are eight grips, four sides and four corners", () => {
  assert.deepEqual(
    [...HANDLES].sort(),
    ["e", "n", "ne", "nw", "s", "se", "sw", "w"],
  );
});

test("each grip pulls the way its name says", () => {
  assert.deepEqual(handleAxis("nw"), { horizontal: -1, vertical: -1 });
  assert.deepEqual(handleAxis("se"), { horizontal: 1, vertical: 1 });
  assert.deepEqual(handleAxis("n"), { horizontal: 0, vertical: -1 });
  assert.deepEqual(handleAxis("e"), { horizontal: 1, vertical: 0 });
});

test("the cursor matches the direction of travel", () => {
  assert.equal(handleCursor("n"), "ns-resize");
  assert.equal(handleCursor("e"), "ew-resize");
  assert.equal(handleCursor("nw"), "nwse-resize");
  assert.equal(handleCursor("se"), "nwse-resize");
  assert.equal(handleCursor("ne"), "nesw-resize");
  assert.equal(handleCursor("sw"), "nesw-resize");
});

const box = { left: 100, right: 300, top: 100, bottom: 200 }; // 200×100, 2:1

test("a horizontal grip measures from the OPPOSITE edge", () => {
  /* So that edge stays still and the grip stays under the finger. */
  assert.equal(
    widthFromHandleDrag({ handle: "e", pointerX: 400, pointerY: 150, rect: box, columnPx: 600 }),
    50,
    "dragging east measures from the left edge",
  );
  assert.equal(
    widthFromHandleDrag({ handle: "w", pointerX: 0, pointerY: 150, rect: box, columnPx: 600 }),
    50,
    "dragging west measures from the right edge",
  );
});

test("a VERTICAL grip resizes through the aspect ratio", () => {
  /**
   * The shape is never broken, so every grip changes one number — the width.
   * On this 2:1 box, dragging the bottom to make it 150 tall means 300 wide,
   * which is 50% of a 600px column.
   */
  assert.equal(
    widthFromHandleDrag({ handle: "s", pointerX: 200, pointerY: 250, rect: box, columnPx: 600 }),
    50,
  );
  assert.equal(
    widthFromHandleDrag({ handle: "n", pointerX: 200, pointerY: 50, rect: box, columnPx: 600 }),
    50,
    "dragging north measures from the bottom edge",
  );
});

test("a corner is measured horizontally, and its height follows", () => {
  /* No separate vertical arithmetic — the aspect supplies it, which is why a
     corner drag cannot skew the image however it is moved. */
  for (const h of ["ne", "se"] as const) {
    assert.equal(
      widthFromHandleDrag({ handle: h, pointerX: 400, pointerY: 999, rect: box, columnPx: 600 }),
      50,
      `${h} used the vertical pointer`,
    );
  }
});

test("a degenerate box cannot divide by zero", () => {
  const flat = { left: 0, right: 100, top: 50, bottom: 50 };
  assert.equal(
    widthFromHandleDrag({ handle: "s", pointerX: 0, pointerY: 90, rect: flat, columnPx: 600 }),
    DEFAULT_WIDTH_PCT,
  );
});

/* ── Crop ─────────────────────────────────────────────────────────────────── */

test("an uncropped image reports itself as uncropped", () => {
  assert.equal(isCropped(FULL_CROP), false);
  assert.equal(isCropped({ x: 0, y: 0, w: 100, h: 90 }), true);
  assert.equal(isCropped({ x: 5, y: 0, w: 95, h: 100 }), true);
});

test("a crop is clamped inside the image, never inverted", () => {
  /* A drag that leaves the image, or a value from a document edited
     elsewhere, produces the nearest sensible rectangle rather than an image
     that will not render. */
  const c = clampCrop({ x: -20, y: 130, w: 400, h: -5 });
  assert.ok(c.x >= 0 && c.y >= 0);
  assert.ok(c.x + c.w <= 100 + 1e-6, "the crop runs off the right edge");
  assert.ok(c.y + c.h <= 100 + 1e-6, "the crop runs off the bottom edge");
  assert.ok(c.w >= MIN_CROP_PCT && c.h >= MIN_CROP_PCT);
});

test("a missing crop reads as the whole image", () => {
  assert.deepEqual(clampCrop(undefined), FULL_CROP);
  assert.deepEqual(clampCrop(null), FULL_CROP);
  assert.deepEqual(clampCrop({}), FULL_CROP);
});

test("the crop is drawn by scaling and shifting, both in one reference", () => {
  /**
   * `left` and `top` in percentages resolve against the container's WIDTH and
   * HEIGHT respectively. Mixing them is what makes a cropped image drift as it
   * is resized, so the shift goes through `translate`, where a percentage is
   * of the element itself — one reference for both axes.
   */
  const crop = { x: 25, y: 10, w: 50, h: 40 };
  assert.equal(cropScalePct(crop), 200, "showing half the width means drawing at 200%");
  assert.deepEqual(cropTranslate(crop), { x: -25, y: -10 });

  const { frame, image } = cropStyles({ crop, naturalWidth: 1000, naturalHeight: 1000 });
  assert.match(frame, /overflow:hidden/);
  assert.match(frame, /aspect-ratio:/);
  assert.match(image, /transform:translate\(-25%,-10%\)/);
  assert.equal(/top:\s*-?\d+(\.\d+)?%/.test(image), false, "a percentage top drifts on resize");
});

test("the frame's shape comes from the crop AND the image's own proportions", () => {
  /* A 2:1 image cropped to a square slice is a 2:1 frame; the same image
     cropped to a tall slice is not. */
  const wide = cropStyles({
    crop: { x: 0, y: 0, w: 50, h: 50 },
    naturalWidth: 2000,
    naturalHeight: 1000,
  });
  assert.match(wide.frame, /aspect-ratio:2\.0000/);
  const tall = cropStyles({
    crop: { x: 0, y: 0, w: 25, h: 100 },
    naturalWidth: 2000,
    naturalHeight: 1000,
  });
  assert.match(tall.frame, /aspect-ratio:0\.5000/);
});

test("an image whose size is not known yet still renders", () => {
  /* Natural dimensions arrive on load. Until then the crop's own shape is a
     sane frame rather than a division by zero. */
  const s = cropStyles({ crop: FULL_CROP, naturalWidth: null, naturalHeight: 0 });
  assert.match(s.frame, /aspect-ratio:1\.0000/);
});

/* ── The extension wires it up, and breaks nothing that was there ─────────── */

test("the extension EXTENDS the official one rather than replacing it", () => {
  /**
   * The owner's constraint: do not remove or break existing functionality.
   * Extending is what keeps paste, drag-in, `setImage`, and the whole upload
   * and storage path working untouched.
   */
  const src = readFileSync(
    "components/features/workspace/docs/ResizableImage.ts",
    "utf8",
  );
  assert.match(src, /import Image from "@tiptap\/extension-image"/);
  assert.match(src, /Image\.extend\(\{/);
  /* The parent's attributes and commands are kept, not shadowed. */
  assert.match(src, /\.\.\.this\.parent\?\.\(\)/);
});

test("all eight grips are rendered, each with its own cursor", () => {
  const src = readFileSync(
    "components/features/workspace/docs/ResizableImage.ts",
    "utf8",
  );
  assert.match(src, /for \(const handle of HANDLES\)/);
  assert.match(src, /cursor:\$\{handleCursor\(handle\)\}/);
  /* Free on both axes — the owner's 17 Aug reversal of the aspect lock. */
  assert.match(src, /resizeFromHandleDrag\(\{/);
});

test("a resize is one undo step, not one per pixel", () => {
  /* Painted live on the wrapper, committed once on pointerup. */
  const src = readFileSync(
    "components/features/workspace/docs/ResizableImage.ts",
    "utf8",
  );
  const fn = src.slice(src.indexOf("function beginResize"));
  assert.match(fn, /wrap\.style\.width = `\$\{pending\.widthPct\}%`/);
  assert.match(fn, /window\.addEventListener\("pointerup", up\)/);
  /* ONE command carrying both dimensions — two would be two undo steps. */
  assert.match(fn, /\.setImageSize\(pending\)/);
});

test("cropping stores a rectangle and never re-uploads", () => {
  /**
   * Non-destructive by design: cutting the pixels would create a second Drive
   * file per crop, orphan the original, and make an accidental crop
   * permanent. The upload path is explicitly untouched.
   */
  const src = readFileSync(
    "components/features/workspace/docs/ResizableImage.ts",
    "utf8",
  );
  assert.match(src, /setImageCrop/);
  assert.match(src, /resetImageCrop/);
  assert.equal(
    /uploadDriveFile|canvas|toDataURL|toBlob/.test(src),
    false,
    "the crop is cutting pixels — it must stay a stored rectangle",
  );
});

test("cropping a cropped image composes against what is visible", () => {
  /* The rectangle is drawn over the CROPPED view, so a second crop has to be
     mapped back through the first. Cropping twice otherwise jumps. */
  const src = readFileSync(
    "components/features/workspace/docs/ResizableImage.ts",
    "utf8",
  );
  assert.match(
    src,
    /const base = parseCrop\(String\(current\.attrs\.crop \?\? ""\)\)/,
  );
  assert.match(src, /x: base\.x \+ \(picked\.x \/ 100\) \* base\.w/);
});

test("an uncropped image stays a bare <img> in the saved HTML", () => {
  /**
   * A wrapper is needed to hide the overflow, but wrapping EVERY image would
   * change the markup of every document that already exists — and a bare
   * `<img>` is what other editors, mail clients and PDF exporters handle best.
   */
  const src = readFileSync(
    "components/features/workspace/docs/ResizableImage.ts",
    "utf8",
  );
  /* The bare-img return now carries a comment line before it; the invariant
     is the SHAPE — uncropped renders `["img", …]`, no wrapper. */
  const at = src.indexOf("if (!isCropped(crop)) {");
  assert.ok(at > 0, "the uncropped branch is gone");
  assert.match(src.slice(at, at + 300), /return \[\s*\n?\s*"img"/);
});

test("one layer owns the height — the wrapper never carries the stretch", () => {
  /**
   * **Reported 18 Aug 2026: blank space around a small image.** The wrapper
   * carried the free-resize `aspect-ratio` while the frame inside kept the
   * picture's own shape, so the box was tall and the picture sat in its
   * corner. The wrapper now wraps; the frame (or the bare image) is the one
   * source of height, and a stretch on a cropped image overrides the frame's
   * shape, appended last so it wins.
   */
  const src = readFileSync(
    "components/features/workspace/docs/ResizableImage.ts",
    "utf8",
  );
  assert.match(
    src,
    /position:relative;\$\{imageStyle\(\{ widthPct, align, aspect: null \}\)\}/,
    "the node view's wrapper carries the stretch again",
  );
  assert.match(src, /\$\{imageStyle\(\{ widthPct, align, aspect: null \}\)\};\$\{frameStyle\}/);
  assert.match(src, /aspect-ratio:\$\{aspect\}/);
  /* And the cropped slice fills its frame on BOTH axes — `height:auto` is what
     left the picture at its own shape inside a differently-shaped frame. */
  /* Comments stripped: the block's own note NAMES `height:auto` to explain
     why it was removed, which is the opposite of using it. */
  const rule = readFileSync("lib/rules/documents/imageLayout.ts", "utf8");
  const image = rule
    .slice(rule.indexOf("image: ["), rule.indexOf("].join(\";\"),", rule.indexOf("image: [")))
    .replace(/\/\*[\s\S]*?\*\//g, "");
  assert.equal(/height:auto/.test(image), false, "the crop slice keeps its own shape again");
  assert.match(image, /height:\$\{\(\(100 \/ crop\.h\) \* 100\)/);
});

test("moving and deleting are TipTap's, not reimplemented", () => {
  /* `draggable` is what lets an image be dragged to another position and
     makes Backspace and Delete work on it. Reimplementing either would be a
     second rule to keep in step with ProseMirror's own. */
  const src = readFileSync(
    "components/features/workspace/docs/ResizableImage.ts",
    "utf8",
  );
  assert.match(src, /draggable: true/);
});

test("the node view never lets ProseMirror read its DOM back", () => {
  /**
   * **The regression, 17 Aug 2026: "what you did now, images not shows".**
   *
   * Written briefly as `ignoreMutation: (m) => m.target !== img`, which
   * returns FALSE for a mutation on the image itself — "do not ignore this".
   * So every repaint that set `img.src` made ProseMirror re-read the node view
   * as document content and tear it down, and the image rendered as a broken
   * icon.
   *
   * An image is an atomic leaf: nothing inside it is editable, so no mutation
   * should ever be read back. The node's attributes are the record; the DOM is
   * a drawing of them.
   */
  const src = readFileSync(
    "components/features/workspace/docs/ResizableImage.ts",
    "utf8",
  );
  assert.match(src, /ignoreMutation: \(\) => true/);
  assert.equal(
    /ignoreMutation:\s*\(m\)/.test(src),
    false,
    "the mutation guard inspects the mutation again — an un-ignored one on the image tears the view down",
  );
});

test("the natural-size write checks the node is still there", () => {
  /* `getPos` can point past the end, or at a different node, once the document
     has been edited while the image was loading — and `setNodeMarkup` at a
     stale position rewrites whatever it finds. */
  const src = readFileSync(
    "components/features/workspace/docs/ResizableImage.ts",
    "utf8",
  );
  assert.match(src, /const at = tr\.doc\.nodeAt\(pos\)/);
  assert.match(src, /if \(!at \|\| at\.type\.name !== current\.type\.name\) return true/);
  /* And it stays out of the undo history — nobody performed it. */
  assert.match(src, /tr\.setMeta\("addToHistory", false\)/);
});

test("src is written only when the SOURCE CHAIN changes", () => {
  /* Re-assigning an identical src restarts the download and refires `load` —
     and it would now also undo a fallback the error handler had already
     advanced to, re-breaking the image on every repaint. */
  const src = readFileSync(
    "components/features/workspace/docs/ResizableImage.ts",
    "utf8",
  );
  assert.match(src, /if \(sources\[0\] !== nextSources\[0\]\)/);
});

test("a failing address falls back to the engine's byte proxy", () => {
  /**
   * **Proven necessary 17 Aug 2026.** lh3 answered 200 to a direct fetch of
   * the exact file while the editor beside it drew a broken icon — the reason
   * varies (an interstitial, indexing lag, a session conflict) and does not
   * matter. `driveUrls.ts` has named the proxy fallback "not optional" since
   * it was written; the node view finally honours it.
   */
  const src = readFileSync(
    "components/features/workspace/docs/ResizableImage.ts",
    "utf8",
  );
  assert.match(src, /img\.addEventListener\("error"/);
  assert.match(
    src,
    /driveProxySrc\(process\.env\.NEXT_PUBLIC_LEGACY_API_URL, fileId\)/,
  );
  /* One step per failure — a chain that runs out leaves the icon, which is
     then the truth, rather than looping on a dead URL. */
  assert.match(src, /if \(sourceIndex \+ 1 >= sources\.length\) return;/);
});

test("the crop attribute travels as a string, never an object", () => {
  /**
   * The collab room serialises attribute values with `String(value)`, so an
   * object crop came back from Yjs as the literal text "[object Object]" —
   * read as no crop, every crop silently lost on reload. Seen decoded in a
   * real room, 17 Aug 2026.
   */
  const src = readFileSync(
    "components/features/workspace/docs/ResizableImage.ts",
    "utf8",
  );
  assert.match(src, /crop: writeCrop\(crop\)/, "setImageCrop stores an object");
  assert.match(src, /crop: ""/, "reset stores something other than the empty string");
  assert.equal(
    /crop: clampCrop\(crop\)|crop: \{ \.\.\.FULL_CROP \}/.test(src),
    false,
    "an object crop is being written into the document again",
  );
});

test("dragging moves the NODE, not the picture", () => {
  /**
   * **Reported 17 Aug 2026: "drag and placed in bottom — not coming."**
   *
   * `draggable: true` on the extension is only the schema's half. With a
   * custom node view the element that drags has to be the WRAPPER: a bare
   * `<img>` is natively draggable, but what a browser drags from an img is
   * the picture — a URL for other apps — not the document node, so the drop
   * put nothing back in the text.
   */
  const src = readFileSync(
    "components/features/workspace/docs/ResizableImage.ts",
    "utf8",
  );
  assert.match(src, /wrap\.draggable = true/);
  assert.match(src, /img\.draggable = false/, "the img's native drag competes with the node's");
  /**
   * **And the dragstart handler must not DISPATCH.** The first fix selected
   * the node inside `dragstart`; that transaction mounted the image toolbar at
   * that instant, and Chromium cancels a native drag when the DOM shifts under
   * it mid-start — the ghost snapped back to where it came from. Reported as
   * "images go to original position, drag drop not working still".
   *
   * ProseMirror's own mousedown records the draggable node (`mightDrag`) and
   * its dragstart builds the slice from that — verified in a live browser with
   * the real event order, with no dispatch from this handler. It exists only
   * to veto dragging while the crop overlay is up.
   */
  const at = src.indexOf('wrap.addEventListener("dragstart"');
  assert.ok(at > 0, "the dragstart wiring is gone");
  const body = src.slice(at, at + 300);
  assert.match(body, /if \(cropping\) e\.preventDefault\(\)/);
  assert.equal(
    /setNodeSelection|commands\.|chain\(\)|dispatch/.test(body),
    false,
    "the dragstart handler dispatches again — the toolbar will mount mid-drag and Chromium will cancel it",
  );
});

/* ── Free resize — OWNER DECISION, 17 Aug 2026 ───────────────────────────── */

test("a side grip changes ITS axis and holds the other still", () => {
  /**
   * **The aspect lock is reversed.** The first build kept the shape through
   * every grip (the tests above still pin that arithmetic in
   * `widthFromHandleDrag`, which survives for reference); the owner then asked
   * for the opposite in unambiguous terms: "increasing the width must only
   * change the width, and increasing the height must only change the height."
   */
  /* An 800px column so every figure rounds cleanly — the width is stored as a
     whole percent, and a fixture that lands on 66.7% would smear the ratio by
     the rounding and test arithmetic nobody wrote. */
  const col = 800; // box is 200×100 at (100,100)

  // Widen east to 400px: 50% of the column, height stays 100.
  const wider = resizeFromHandleDrag({
    handle: "e", pointerX: 500, pointerY: 150, rect: box, columnPx: col,
  });
  assert.equal(wider.widthPct, 50, "the width follows the hand");
  assert.equal(wider.aspect, 4, "400 wide over the UNCHANGED 100 high");

  // Stretch south to 200 tall: width stays 200 (25%), so the ratio halves.
  const taller = resizeFromHandleDrag({
    handle: "s", pointerX: 200, pointerY: 300, rect: box, columnPx: col,
  });
  assert.equal(taller.widthPct, 25, "the width did not move");
  assert.equal(taller.aspect, 1, "200 wide over the NEW 200 high");
});

test("a corner moves both axes at once", () => {
  const both = resizeFromHandleDrag({
    handle: "se", pointerX: 500, pointerY: 300, rect: box, columnPx: 800,
  });
  assert.equal(both.widthPct, 50); // 400 of 800
  assert.equal(both.aspect, 2);    // 400 / 200
});

test("a clamped width pins the height the hand asked for", () => {
  /* Dragged far past the column: the width clamps to 100%, and the ratio is
     taken against the CLAMPED width — otherwise the clamp would silently make
     the image taller than the drag ever did. */
  const past = resizeFromHandleDrag({
    handle: "e", pointerX: 5000, pointerY: 150, rect: box, columnPx: 800,
  });
  assert.equal(past.widthPct, MAX_WIDTH_PCT);
  assert.equal(past.aspect, 8, "800 clamped wide over the unchanged 100 high");
});

test("aspect nonsense reads as the image's own shape", () => {
  for (const bad of [null, undefined, "", 0, -2, NaN, Infinity, "abc"]) {
    assert.equal(clampAspect(bad), null);
  }
  assert.equal(clampAspect(1000), MAX_ASPECT);
  assert.equal(clampAspect(0.001), MIN_ASPECT);
});

test("a degenerate box keeps the defaults on the free path too", () => {
  const flat = { left: 0, right: 100, top: 50, bottom: 50 };
  assert.deepEqual(
    resizeFromHandleDrag({ handle: "s", pointerX: 0, pointerY: 90, rect: flat, columnPx: 600 }),
    { widthPct: DEFAULT_WIDTH_PCT, aspect: null },
  );
});

test("a drag MOVES the image — the source is deleted, not copied", () => {
  /**
   * **Reported 18 Aug 2026: "when drop, made a copy".**
   *
   * ProseMirror's drop deletes the SOURCE via the selection. Selecting inside
   * `dragstart` cancelled the drag (Chromium aborts when the DOM shifts
   * mid-start); removing that selection fixed the cancel and silently broke
   * the delete — insert without delete is a duplicate. The earlier harness
   * check compared POSITION and never counted images, which is how the copy
   * slipped through.
   *
   * The selection now happens on MOUSEDOWN — before the drag begins, so the
   * toolbar mounts and the layout settles before dragstart fires. Verified
   * live: image count 1 → 1 across a drop, node selected after mousedown.
   */
  const src = readFileSync(
    "components/features/workspace/docs/ResizableImage.ts",
    "utf8",
  );
  const at = src.indexOf('wrap.addEventListener("mousedown"');
  assert.ok(at > 0, "the mousedown selection is gone — drops will copy again");
  const body = src.slice(at, at + 500);
  assert.match(body, /setNodeSelection\(pos\)/);
  /* Grips must not reselect mid-resize, and crop mode must not select. */
  assert.match(body, /dataset\?\.handle/);
  assert.match(body, /if \(cropping\) return/);
  /* And dragstart itself still dispatches nothing — that is the cancel bug. */
  const ds = src.slice(src.indexOf('wrap.addEventListener("dragstart"'), src.indexOf('wrap.addEventListener("dragstart"') + 300);
  assert.equal(/setNodeSelection|commands\./.test(ds), false);
});

test("the surround forwarder deletes the source by IDENTITY", () => {
  /* The slice holds the very node object being dragged, so it is findable in
     the document wherever the selection happens to be — a selection lost
     between mousedown and drop must not turn a move into a duplicate. */
  const src = readFileSync(
    "components/features/workspace/DocumentEditor.tsx",
    "utf8",
  );
  assert.match(src, /const dragged = slice\.content\.firstChild/);
  assert.match(src, /if \(n === dragged\)/);
  assert.match(src, /: tr\.deleteSelection\(\)/, "the selection fallback is gone");
});
