"use client";

import { useEffect, useRef, useState } from "react";
import { BubbleMenu } from "@tiptap/react/menus";
import { useEditorState, type Editor } from "@tiptap/react";
import {
  IMAGE_ALIGNMENTS,
  clampCrop,
  isCropped,
  readAlign,
} from "@/lib/rules/documents/imageLayout";

/**
 * What you can do to a selected image: put it left, centre or right, crop it,
 * describe it, swap it for another, and remove it.
 *
 * **Its own bar, beside the text one.** The selection toolbar's tools are
 * bold, italic, headings, links — every one of them meaningless on a picture,
 * and several of them destructive if applied to one. So this is a second
 * `BubbleMenu` that shows only for an image node, and the text one keeps its
 * own condition. Neither has to know about the other.
 *
 * **Alignment is where the wrapping comes from.** Left and right float the
 * image so the text runs around it; centre puts it on its own line. That is
 * `imageStyle` in `lib/rules/documents/imageLayout.ts`, and this bar only
 * chooses between the three — it computes nothing.
 *
 * **Resizing is not here.** It is a drag on the image's own handles, which is
 * where somebody reaches for it, and a number in a toolbar would be a second
 * way to say the same thing.
 */

const LABELS: Record<string, { label: string; hint: string }> = {
  left: { label: "Left", hint: "Text wraps down the right side" },
  center: { label: "Centre", hint: "On its own line" },
  right: { label: "Right", hint: "Text wraps down the left side" },
};

const BTN =
  "rounded-full px-2.5 py-1 text-[12px] text-ink-muted transition-colors hover:bg-[var(--control)] hover:text-ink";

export function DocsImageToolbar({
  editor,
  onReplace,
  replacing = false,
}: {
  editor: Editor | null;
  /**
   * Swap the selected image for another file. Owned by the editor rather than
   * this bar, because uploading is the editor's business and this bar has no
   * repository — the same upload the insert dialog and a paste already use.
   */
  onReplace?: () => void;
  /** True while that upload is in flight. */
  replacing?: boolean;
}) {
  const [altOpen, setAltOpen] = useState(false);
  const [alt, setAlt] = useState("");
  const altInput = useRef<HTMLInputElement | null>(null);

  /**
   * The selected image's own attributes, read through `useEditorState`.
   *
   * `BubbleMenu` positions itself from a ProseMirror plugin and does not
   * re-render its React children when the selection moves, so reading
   * `editor.getAttributes` during render returns what was true at the last
   * React render — which, for a bar that appears once an image is already
   * selected, is the state from before it was. That is how the alignment
   * buttons come up showing the PREVIOUS image's alignment.
   */
  const image = useEditorState({
    editor,
    selector: ({ editor: e }) => {
      const on = Boolean(e?.isActive("image"));
      const attrs = on ? e!.getAttributes("image") : {};
      return {
        on,
        alt: String(attrs.alt ?? ""),
        align: readAlign(attrs.align),
        cropped: isCropped(clampCrop(attrs.crop)),
      };
    },
  });

  /* The panel opens holding whatever the image already says, so editing a
     description is editing rather than retyping. */
  /* `useEditorState` yields null while there is no editor. */
  const currentAlt = image?.alt ?? "";

  /* Seeded where the panel OPENS rather than in an effect watching `altOpen`:
     an effect would set state during a render it did not cause, and reading
     `currentAlt` on every render would reset the field under somebody's
     fingers while they were typing into it. */
  const toggleAlt = () => {
    if (!altOpen) setAlt(currentAlt);
    setAltOpen((open) => !open);
  };

  useEffect(() => {
    if (!altOpen) return;
    const id = requestAnimationFrame(() => altInput.current?.focus());
    return () => cancelAnimationFrame(id);
  }, [altOpen]);

  /* A different image selected is a different description — the panel must not
     carry the last one over. */
  useEffect(() => {
    if (!editor) return;
    const close = () => setAltOpen(false);
    editor.on("selectionUpdate", close);
    return () => {
      editor.off("selectionUpdate", close);
    };
  }, [editor]);

  if (!editor) return null;

  const saveAlt = () => {
    editor.chain().focus().updateAttributes("image", { alt: alt.trim() }).run();
    setAltOpen(false);
  };

  return (
    <BubbleMenu
      editor={editor}
      pluginKey="docsImageToolbar"
      shouldShow={({ editor: e }) => e.isEditable && e.isActive("image")}
    >
      <div className="frost-bar rounded-2xl border border-hairline p-0.5 shadow-[var(--deck-seat)]">
        <div className="flex items-center gap-0.5">
          {IMAGE_ALIGNMENTS.map((align) => {
            const on = image?.align === align;
            return (
              <button
                key={align}
                type="button"
                title={LABELS[align].hint}
                aria-pressed={on}
                onClick={() => editor.chain().focus().setImageAlign(align).run()}
                className={`rounded-full px-2.5 py-1 text-[12px] transition-colors ${
                  on
                    ? "bg-[var(--control-active)] text-ink"
                    : "text-ink-muted hover:bg-[var(--control)] hover:text-ink"
                }`}
              >
                {LABELS[align].label}
              </button>
            );
          })}

          <span aria-hidden className="mx-0.5 h-4 w-px bg-hairline" />

          {/* **Crop** opens a rectangle you drag over the image.
              Non-destructive: the rectangle is stored on the node and the
              original file is never touched, so a crop can be widened again and
              the upload path is untouched.

              Driven by an event rather than a command because the crop overlay
              lives inside the node view's own closure — the toolbar should not
              have to reach into ProseMirror's DOM to find it. */}
          <button
            type="button"
            title="Drag a rectangle over the image to crop it"
            onClick={() => {
              const dom = editor.view.nodeDOM(editor.state.selection.from);
              if (dom instanceof HTMLElement) {
                dom.dispatchEvent(new CustomEvent("cw-crop-start"));
              }
            }}
            className={BTN}
          >
            Crop
          </button>

          {/* Offered only where there is something to undo — a Reset that does
              nothing on an uncropped image is a control that lies. */}
          {image?.cropped && (
            <button
              type="button"
              title="Show the whole image again"
              onClick={() => editor.chain().focus().resetImageCrop().run()}
              className={BTN}
            >
              Reset crop
            </button>
          )}

          {/* **Replace** keeps everything about the picture except which
              picture it is — the size, the alignment and the crop are
              attributes of the node, and swapping only `src` leaves a layout
              somebody spent time on exactly as they left it. */}
          {onReplace && (
            <button
              type="button"
              title="Swap this for a different picture, keeping its size and position"
              disabled={replacing}
              onClick={onReplace}
              className={`${BTN} disabled:opacity-50`}
            >
              {replacing ? "Replacing…" : "Replace"}
            </button>
          )}

          {/* **Alt text** is what a screen reader says instead of the picture,
              and what stands in for it when the image cannot be drawn. It is
              also carried into the Word export, so it is worth typing once. */}
          <button
            type="button"
            title="Describe this image for people who cannot see it"
            aria-pressed={altOpen}
            aria-expanded={altOpen}
            onClick={toggleAlt}
            className={`${BTN} ${
              altOpen ? "bg-[var(--control-active)] text-ink" : ""
            } ${currentAlt ? "" : "opacity-100"}`}
          >
            Alt text
            {currentAlt ? (
              <span aria-hidden className="ml-1 text-[var(--state-positive-ink)]">
                •
              </span>
            ) : null}
          </button>

          {/* Delete already works from the keyboard — a selected image node takes
              Backspace and Delete. This is the same action for somebody who
              reached for the mouse and has no reason to guess at a key. */}
          <button
            type="button"
            title="Remove this image"
            onClick={() => editor.chain().focus().deleteSelection().run()}
            className="rounded-full px-2.5 py-1 text-[12px] text-ink-muted transition-colors hover:bg-[var(--state-rework)] hover:text-[var(--state-rework-ink)]"
          >
            Remove
          </button>
        </div>

        {altOpen && (
          <div className="flex items-center gap-1 border-t border-hairline px-1.5 pb-1 pt-1.5">
            <input
              ref={altInput}
              value={alt}
              onChange={(e) => setAlt(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  saveAlt();
                }
                if (e.key === "Escape") {
                  e.preventDefault();
                  setAltOpen(false);
                }
              }}
              maxLength={300}
              placeholder="Describe the image, e.g. Q3 revenue by region"
              aria-label="Alt text"
              className="w-64 rounded-full bg-[var(--control)] px-3 py-1 text-[12px] text-ink outline-none placeholder:text-ink-faint"
            />
            <button type="button" onClick={saveAlt} className={BTN}>
              Save
            </button>
          </div>
        )}
      </div>
    </BubbleMenu>
  );
}

export default DocsImageToolbar;
