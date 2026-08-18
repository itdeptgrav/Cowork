import Image from "@tiptap/extension-image";
import {
  DEFAULT_ALIGN,
  DEFAULT_WIDTH_PCT,
  FULL_CROP,
  HANDLES,
  clampCrop,
  clampWidthPct,
  cropStyles,
  handleCursor,
  imageStyle,
  isCropped,
  readAlign,
  readImageStyle,
  resizeFromHandleDrag,
  clampAspect,
  type Crop,
  type Handle,
  type ImageAlign,
} from "@/lib/rules/documents/imageLayout";
import {
  driveFileIdFrom,
  driveProxySrc,
  renderableImageSrc,
} from "@/lib/rules/media/driveUrls";

/**
 * Every address this image can be drawn from, best first.
 *
 * The CDN, then the engine's byte proxy. lh3 has answered 200 to a plain fetch
 * of the exact file while the browser beside it showed a broken icon — an
 * interstitial, an indexing delay, a session conflict; the reason varies and
 * does not matter. `/cowork/media/view/:fileId` streams through the service
 * account and always resolves, which is why `driveUrls.ts` calls the fallback
 * "not optional". A URL with no recognisable file id has no proxy and is its
 * own only source.
 */
function imageSources(src: unknown): string[] {
  const first = renderableImageSrc(src as string);
  if (!first) return [];
  const fileId = driveFileIdFrom(first);
  const proxy = fileId
    ? driveProxySrc(process.env.NEXT_PUBLIC_LEGACY_API_URL, fileId)
    : null;
  return proxy && proxy !== first ? [first, proxy] : [first];
}

/**
 * A document image you can resize from eight grips, crop, align and drag.
 *
 * **Reported 17 Aug 2026.** An uploaded image landed at its natural size, in
 * the flow, and could not be resized, cropped or moved.
 *
 * ## Why everything lives in the `style` attribute
 *
 * The document is saved and reloaded as HTML (`editor.getHTML()`), and that
 * same HTML is printed, exported to PDF and mailed. A class name would not
 * survive — the stylesheet does not travel with the markup. So width,
 * alignment and crop are written as inline style and read back by `parseHTML`,
 * which is also what lets a document written here open correctly elsewhere.
 *
 * ## Nothing here decides anything
 *
 * Every figure comes from `lib/rules/documents/imageLayout.ts`: the clamps, the
 * style strings, the eight grips' geometry and the arithmetic that turns a drag
 * into a width. This file is DOM plumbing — handles, pointer events, the crop
 * overlay, and the node view.
 *
 * ## What was already there and is untouched
 *
 * The upload path, the `setImage` command, paste and drag-in, and the storage
 * behind them. This EXTENDS the official extension rather than replacing it.
 * Cropping is non-destructive — a rectangle, not a new file — so nothing is
 * re-uploaded and the original is always recoverable.
 *
 * ## Delete and move
 *
 * Both are TipTap's, unlocked by `draggable` and a selectable node: Backspace
 * or Delete removes a selected image, and it can be dragged to any other
 * position in the document. The node view only has to not get in the way.
 */

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    resizableImage: {
      setImageAlign: (align: ImageAlign) => ReturnType;
      setImageWidth: (widthPct: number) => ReturnType;
      /** Both dimensions of a free resize, in one history step. */
      setImageSize: (size: { widthPct: number; aspect: number | null }) => ReturnType;
      setImageCrop: (crop: Crop) => ReturnType;
      resetImageCrop: () => ReturnType;
    };
  }
}

/** `data-crop="x,y,w,h"` — compact, and legible in the saved HTML. */
function writeCrop(crop: Crop): string {
  const c = clampCrop(crop);
  return `${c.x},${c.y},${c.w},${c.h}`;
}
function parseCrop(value: string | null): Crop {
  if (!value) return { ...FULL_CROP };
  const [x, y, w, h] = value.split(",").map(Number);
  return clampCrop({ x, y, w, h });
}

export const ResizableImage = Image.extend({
  draggable: true,

  addAttributes() {
    return {
      ...this.parent?.(),
      widthPct: {
        default: DEFAULT_WIDTH_PCT,
        parseHTML: (el: HTMLElement) =>
          readImageStyle(el.getAttribute("style")).widthPct,
        renderHTML: () => ({}),
      },
      align: {
        default: DEFAULT_ALIGN,
        parseHTML: (el: HTMLElement) =>
          readImageStyle(el.getAttribute("style")).align,
        renderHTML: () => ({}),
      },
      /* The visible rectangle, as percentages of the whole image. Written as
         its own attribute rather than derived from the style, because the CSS
         that draws it is lossy — an offset and a scale cannot be read back
         into a rectangle without the natural size, which the markup does not
         carry. */
      /**
       * **A string, never an object.** The collab room serialises attribute
       * values with `String(value)`, so an object crop came back from Yjs as
       * the literal text "[object Object]" — read as no crop at all, and every
       * crop silently lost on reload. Seen in a decoded room on 17 Aug 2026:
       * `crop="[object Object]"`. The compact "x,y,w,h" form survives Yjs,
       * the saved HTML and the clipboard identically.
       */
      crop: {
        default: "",
        parseHTML: (el: HTMLElement) => el.getAttribute("data-crop") ?? "",
        renderHTML: (attrs: Record<string, unknown>) => {
          const crop = parseCrop(String(attrs.crop ?? ""));
          return isCropped(crop) ? { "data-crop": writeCrop(crop) } : {};
        },
      },
      /** Width over height where the image has been freely stretched — the
          owner's 17 Aug 2026 reversal of the aspect lock. Null means the
          image's own shape. Rendered inside `style` below. */
      aspect: {
        default: null,
        parseHTML: (el: HTMLElement) =>
          readImageStyle(el.getAttribute("style")).aspect,
        renderHTML: () => ({}),
      },
      /* Measured on load and kept, so a cropped frame knows its own shape
         without waiting for the image to arrive on every render. */
      naturalWidth: { default: null, renderHTML: () => ({}) },
      naturalHeight: { default: null, renderHTML: () => ({}) },
    };
  },

  /**
   * **Cropped images are wrapped; uncropped ones stay a bare `<img>`.**
   *
   * A wrapper is needed to hide the overflow, but wrapping every image would
   * change the markup of every document that already exists — and a bare
   * `<img>` is what other editors, mail clients and PDF exporters handle best.
   * So the wrapper appears only where it earns its place.
   */
  renderHTML({ HTMLAttributes, node }) {
    const widthPct = clampWidthPct(node.attrs.widthPct);
    const align = readAlign(node.attrs.align);
    const crop = parseCrop(String(node.attrs.crop ?? ""));
    const aspect = clampAspect(node.attrs.aspect);

    const attrs = {
      ...HTMLAttributes,
      /* The saved markup carries the drawable address as well, so a document
         read outside this editor — an export, a print, a mail — shows the
         image rather than a broken icon. */
      src: renderableImageSrc(HTMLAttributes.src as string),
    };

    if (!isCropped(crop)) {
      /* A bare image carries everything on itself, the stretch included. */
      return [
        "img",
        { ...attrs, style: imageStyle({ widthPct, align, aspect }) },
      ];
    }

    /**
     * A cropped image: the SPAN is the frame and the frame's shape is the one
     * source of height. The wrapper style deliberately carries no
     * `aspect-ratio` of its own — reported 17 Aug 2026 as blank space around
     * a small image, which was the wrapper stretched by the free-resize while
     * the frame inside kept the picture's own shape. Where the owner
     * stretched a cropped image, the stretch OVERRIDES the frame's natural
     * shape, appended last so it wins.
     */
    const { frame, image } = cropStyles({
      crop,
      naturalWidth: node.attrs.naturalWidth,
      naturalHeight: node.attrs.naturalHeight,
    });
    const frameStyle =
      aspect !== null ? `${frame};aspect-ratio:${aspect}` : frame;
    return [
      "span",
      {
        "data-crop": writeCrop(crop),
        style: `${imageStyle({ widthPct, align, aspect: null })};${frameStyle}`,
      },
      ["img", { ...attrs, style: image }],
    ];
  },

  addCommands() {
    return {
      ...this.parent?.(),
      setImageAlign:
        (align: ImageAlign) =>
        ({ commands }) =>
          commands.updateAttributes(this.name, { align: readAlign(align) }),
      setImageWidth:
        (widthPct: number) =>
        ({ commands }) =>
          commands.updateAttributes(this.name, {
            widthPct: clampWidthPct(widthPct),
          }),
      setImageSize:
        (size: { widthPct: number; aspect: number | null }) =>
        ({ commands }) =>
          commands.updateAttributes(this.name, {
            widthPct: clampWidthPct(size.widthPct),
            aspect: clampAspect(size.aspect),
          }),
      setImageCrop:
        (crop: Crop) =>
        ({ commands }) =>
          commands.updateAttributes(this.name, { crop: writeCrop(crop) }),
      resetImageCrop:
        () =>
        ({ commands }) =>
          commands.updateAttributes(this.name, { crop: "" }),
    };
  },

  addNodeView() {
    return ({ node, editor, getPos }) => {
      let current = node;

      const wrap = document.createElement("span");
      const frame = document.createElement("span");
      const img = document.createElement("img");
      frame.appendChild(img);
      wrap.appendChild(frame);

      /* The fallback chain for the CURRENT src, and how far down it we are.
         On error the next source is tried once; a chain that runs out leaves
         the broken icon, which is then the truth. */
      let sources: string[] = [];
      let sourceIndex = 0;
      img.addEventListener("error", () => {
        if (sourceIndex + 1 >= sources.length) return;
        sourceIndex += 1;
        img.setAttribute("src", sources[sourceIndex]);
      });

      /** Redraw from the node's own attributes. One place, so nothing drifts. */
      const paint = (n: typeof node) => {
        const widthPct = clampWidthPct(n.attrs.widthPct);
        const align = readAlign(n.attrs.align);
        const crop = parseCrop(String(n.attrs.crop ?? ""));

        /* **Normalised at render, with the proxy behind it.** Only written
           when the FIRST source changes — re-assigning an identical src
           restarts the download and refires `load`, and it would also undo a
           fallback the error handler has already advanced to. */
        const nextSources = imageSources(n.attrs.src);
        if (sources[0] !== nextSources[0]) {
          sources = nextSources;
          sourceIndex = 0;
          if (sources[0]) img.setAttribute("src", sources[0]);
        }
        if (n.attrs.alt) img.alt = String(n.attrs.alt);
        if (n.attrs.title) img.title = String(n.attrs.title);

        /* `n.attrs`, never `node.attrs` — the closure's node is the FIRST
           render's, and reading it here meant a stretch never repainted. */
        const aspect = clampAspect(n.attrs.aspect);

        /* The WRAPPER carries the width and the float ONLY — never the
           stretch. Reported 17 Aug 2026 as blank space around a small image:
           the wrapper was stretched by the aspect while the frame inside kept
           the picture's own shape, so the box was tall and the picture sat in
           its corner. One layer owns the height — the frame (or the bare
           image), and the wrapper wraps it. */
        wrap.setAttribute(
          "style",
          `position:relative;${imageStyle({ widthPct, align, aspect: null })}`,
        );

        if (isCropped(crop)) {
          const s = cropStyles({
            crop,
            naturalWidth: n.attrs.naturalWidth,
            naturalHeight: n.attrs.naturalHeight,
          });
          /* A stretch on a cropped image reshapes the FRAME, appended last so
             it overrides the crop's natural shape. The slice inside fills the
             frame either way — both of its dimensions are explicit. */
          frame.setAttribute(
            "style",
            `display:block;width:100%;${s.frame}${
              aspect !== null ? `;aspect-ratio:${aspect}` : ""
            }`,
          );
          img.setAttribute("style", s.image);
        } else {
          frame.setAttribute("style", "display:block;width:100%");
          img.setAttribute(
            "style",
            `width:100%;height:auto;display:block${
              aspect !== null ? `;aspect-ratio:${aspect}` : ""
            }`,
          );
        }
      };
      paint(current);

      /* The natural size, recorded once, so a crop frame knows its shape. */
      img.addEventListener("load", () => {
        if (current.attrs.naturalWidth || !img.naturalWidth) return;
        const pos = typeof getPos === "function" ? getPos() : null;
        if (pos === null || pos === undefined) return;
        editor.commands.command(({ tr, dispatch }) => {
          if (!dispatch) return true;
          /* **The node still has to BE there.** `getPos` can point past the
             end, or at a different node, once the document has been edited
             while the image was loading — and `setNodeMarkup` at a stale
             position rewrites whatever it finds. Checked rather than trusted. */
          const at = tr.doc.nodeAt(pos);
          if (!at || at.type.name !== current.type.name) return true;
          tr.setNodeMarkup(pos, undefined, {
            ...at.attrs,
            naturalWidth: img.naturalWidth,
            naturalHeight: img.naturalHeight,
          });
          /* No history entry: the browser measured this, nobody did it, and it
             must not sit between somebody's edit and their undo. */
          tr.setMeta("addToHistory", false);
          dispatch(tr);
          return true;
        });
      });

      const chrome: HTMLElement[] = [];
      const showChrome = (on: boolean) => {
        for (const el of chrome) el.style.opacity = on ? "0.9" : "0";
      };

      if (editor.isEditable) {
        /* ── Eight grips ────────────────────────────────────────────────── */
        for (const handle of HANDLES) {
          const grip = document.createElement("span");
          grip.setAttribute("data-handle", handle);
          grip.setAttribute("aria-hidden", "true");
          const vertical = handle.startsWith("n")
            ? "top:-4px"
            : handle.startsWith("s")
              ? "bottom:-4px"
              : "top:50%;transform:translateY(-50%)";
          const horizontal = handle.includes("w")
            ? "left:-4px"
            : handle.includes("e")
              ? "right:-4px"
              : "left:50%;transform:translateX(-50%)";
          grip.style.cssText = [
            "position:absolute",
            vertical,
            horizontal,
            "width:9px",
            "height:9px",
            "border-radius:2px",
            "background:var(--ink,#fff)",
            "border:1px solid rgba(0,0,0,.35)",
            "opacity:0",
            `cursor:${handleCursor(handle)}`,
            "transition:opacity 140ms",
            "z-index:2",
          ].join(";");
          wrap.appendChild(grip);
          chrome.push(grip);
          grip.addEventListener("pointerdown", (ev) =>
            beginResize(ev as PointerEvent, handle),
          );
        }

        wrap.addEventListener("pointerenter", () => !cropping && showChrome(true));
        wrap.addEventListener("pointerleave", () => !cropping && showChrome(false));

        /**
         * **Dragging the image moves the NODE.** Reported 17 Aug 2026, twice —
         * first as "not coming", then as "goes back to original position".
         *
         * The wrapper is the drag handle and the img's own native drag is off:
         * what a browser drags from a bare `<img>` is the PICTURE — a URL for
         * other applications — not the document node, so a drop put nothing
         * back in the text.
         *
         * **And the handler must not DISPATCH.** The first fix selected the
         * node inside `dragstart`; that transaction mounted the image toolbar
         * at that exact instant, and Chromium cancels a native drag when the
         * DOM shifts under it mid-start — the ghost snapped back, which is the
         * reported "goes to original position". The harness missed it because
         * it has no toolbar to mount.
         *
         * Nothing needs dispatching anyway: ProseMirror's OWN mousedown
         * records the draggable node under the pointer (`mightDrag`) and its
         * dragstart handler builds the slice from that — the drop, the caret
         * gap and the history entry are all its. This listener exists only to
         * veto dragging while the crop overlay is up.
         *
         * The grips call `preventDefault` on pointerdown, so a resize can
         * never start a drag.
         */
        wrap.draggable = true;
        img.draggable = false;

        /**
         * **Selected on MOUSEDOWN, not on dragstart.** Reported 18 Aug 2026:
         * dragging made a COPY — the drop inserted the image and the original
         * stayed.
         *
         * ProseMirror's drop deletes the SOURCE via the selection, so the
         * node must be selected before the drop lands. Selecting inside
         * `dragstart` was the first attempt, and Chromium cancels a drag
         * whose DOM shifts mid-start (the toolbar mounts on selection);
         * removing it fixed the cancel and silently broke the delete — insert
         * without delete is the reported copy.
         *
         * Mousedown is before the drag begins, so the toolbar mounts and the
         * layout settles BEFORE dragstart fires. A grip's own pointerdown
         * stops propagation, so resizing never reselects mid-drag.
         */
        wrap.addEventListener("mousedown", (e) => {
          if (cropping) return;
          if ((e.target as HTMLElement).dataset?.handle) return;
          const pos = typeof getPos === "function" ? getPos() : null;
          if (pos === null || pos === undefined) return;
          editor.commands.setNodeSelection(pos);
        });
        wrap.addEventListener("dragstart", (e) => {
          if (cropping) e.preventDefault();
        });
      }

      /** Drag any grip; commit once on release, so one drag is one undo. */
      function beginResize(ev: PointerEvent, handle: Handle) {
        ev.preventDefault();
        ev.stopPropagation();
        const rect = img.getBoundingClientRect();
        const columnPx =
          (editor.view.dom as HTMLElement).clientWidth || rect.width;
        let pending: { widthPct: number; aspect: number | null } | null = null;

        const move = (e: PointerEvent) => {
          /**
           * Free on both axes — OWNER DECISION, 17 Aug 2026, reversing the
           * aspect lock: "increasing the width must only change the width,
           * and increasing the height must only change the height."
           */
          pending = resizeFromHandleDrag({
            handle,
            pointerX: e.clientX,
            pointerY: e.clientY,
            rect: {
              left: rect.left,
              right: rect.right,
              top: rect.top,
              bottom: rect.bottom,
            },
            columnPx,
          });
          wrap.style.width = `${pending.widthPct}%`;
          /* The stretch previews on the IMG, where the committed style will
             put it — the wrapper only carries width and float. */
          if (pending.aspect !== null) {
            img.style.aspectRatio = String(pending.aspect);
          }
        };
        const up = () => {
          window.removeEventListener("pointermove", move);
          window.removeEventListener("pointerup", up);
          if (pending === null) return;
          const pos = typeof getPos === "function" ? getPos() : null;
          if (pos === null || pos === undefined) return;
          editor.chain().focus().setNodeSelection(pos).setImageSize(pending).run();
        };
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", up);
      }

      /* ── Crop mode ────────────────────────────────────────────────────── */
      let cropping = false;
      let overlay: HTMLElement | null = null;

      /**
       * Drag a rectangle over the image; Apply keeps it, Cancel leaves the
       * image exactly as it was.
       *
       * The rectangle is stored, not cut — see `Crop` in the rule. Cropping a
       * cropped image composes against what is already visible, which is what
       * "crop again" has to mean.
       */
      const startCrop = () => {
        if (cropping || !editor.isEditable) return;
        cropping = true;
        showChrome(false);

        overlay = document.createElement("span");
        overlay.style.cssText = [
          "position:absolute",
          "inset:0",
          "background:rgba(0,0,0,.45)",
          "cursor:crosshair",
          "z-index:3",
        ].join(";");
        const box = document.createElement("span");
        box.style.cssText = [
          "position:absolute",
          "border:1px solid #fff",
          "box-shadow:0 0 0 9999px rgba(0,0,0,.45)",
          "display:none",
        ].join(";");
        overlay.appendChild(box);
        wrap.appendChild(overlay);

        let sx = 0;
        let sy = 0;
        let picked: { x: number; y: number; w: number; h: number } | null = null;

        overlay.addEventListener("pointerdown", (e) => {
          const r = img.getBoundingClientRect();
          sx = ((e.clientX - r.left) / r.width) * 100;
          sy = ((e.clientY - r.top) / r.height) * 100;
          box.style.display = "block";

          const move = (m: PointerEvent) => {
            const cx = ((m.clientX - r.left) / r.width) * 100;
            const cy = ((m.clientY - r.top) / r.height) * 100;
            picked = {
              x: Math.min(sx, cx),
              y: Math.min(sy, cy),
              w: Math.abs(cx - sx),
              h: Math.abs(cy - sy),
            };
            box.style.left = `${picked.x}%`;
            box.style.top = `${picked.y}%`;
            box.style.width = `${picked.w}%`;
            box.style.height = `${picked.h}%`;
          };
          const up = () => {
            window.removeEventListener("pointermove", move);
            window.removeEventListener("pointerup", up);
          };
          window.addEventListener("pointermove", move);
          window.addEventListener("pointerup", up);
        });

        const bar = document.createElement("span");
        bar.style.cssText =
          "position:absolute;bottom:6px;left:50%;transform:translateX(-50%);display:flex;gap:6px;z-index:4";
        const button = (label: string, onClick: () => void) => {
          const b = document.createElement("button");
          b.type = "button";
          b.textContent = label;
          b.style.cssText =
            "font:500 12px/1 system-ui;padding:6px 10px;border-radius:999px;border:0;cursor:pointer;background:#fff;color:#111";
          b.addEventListener("pointerdown", (e) => e.stopPropagation());
          b.addEventListener("click", onClick);
          return b;
        };
        bar.appendChild(
          button("Apply", () => {
            const pos = typeof getPos === "function" ? getPos() : null;
            if (picked && pos !== null && pos !== undefined) {
              /* Composed against what is ALREADY visible: the selection was
                 drawn over the cropped view, not over the original. */
              const base = parseCrop(String(current.attrs.crop ?? ""));
              editor
                .chain()
                .focus()
                .setNodeSelection(pos)
                .setImageCrop({
                  x: base.x + (picked.x / 100) * base.w,
                  y: base.y + (picked.y / 100) * base.h,
                  w: (picked.w / 100) * base.w,
                  h: (picked.h / 100) * base.h,
                })
                .run();
            }
            endCrop();
          }),
        );
        bar.appendChild(button("Cancel", endCrop));
        overlay.appendChild(bar);
      };

      const endCrop = () => {
        cropping = false;
        overlay?.remove();
        overlay = null;
      };

      /* Opened by the toolbar, which has no reference to this closure — the
         event is the seam between them. */
      wrap.addEventListener("cw-crop-start", startCrop as EventListener);

      return {
        dom: wrap,
        update: (updated) => {
          if (updated.type.name !== current.type.name) return false;
          current = updated;
          paint(updated);
          return true;
        },
        selectNode: () => {
          wrap.style.outline = "2px solid var(--state-extension,#6aa)";
          wrap.style.outlineOffset = "2px";
          showChrome(true);
        },
        deselectNode: () => {
          wrap.style.outline = "";
          showChrome(false);
          endCrop();
        },
        destroy: endCrop,
        /**
         * **Every mutation, ignored.**
         *
         * An image is an atomic leaf: nothing inside this DOM is editable
         * content, so ProseMirror must never read it back into the document.
         *
         * Written briefly as `(m) => m.target !== img`, which returns FALSE
         * for a mutation on the image itself — "do not ignore this". So every
         * `paint()` that set `img.src` or its style made ProseMirror re-read
         * the node view as content and tear it down, and the image rendered as
         * a broken icon. Reported immediately: "what you did now, images not
         * shows".
         *
         * The handles, the crop overlay and the image's own attributes are all
         * chrome by this definition — the node's attributes are the record,
         * and the DOM is only a drawing of them.
         */
        ignoreMutation: () => true,
      };
    };
  },
});

export default ResizableImage;
