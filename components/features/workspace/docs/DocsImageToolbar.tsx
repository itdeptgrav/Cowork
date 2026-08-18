"use client";

import { BubbleMenu } from "@tiptap/react/menus";
import type { Editor } from "@tiptap/react";
import {
  IMAGE_ALIGNMENTS,
  clampCrop,
  isCropped,
  readAlign,
} from "@/lib/rules/documents/imageLayout";

/**
 * What you can do to a selected image: put it left, centre or right, and
 * remove it.
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

export function DocsImageToolbar({ editor }: { editor: Editor | null }) {
  if (!editor) return null;

  return (
    <BubbleMenu
      editor={editor}
      pluginKey="docsImageToolbar"
      shouldShow={({ editor: e }) => e.isEditable && e.isActive("image")}
    >
      <div className="frost-bar flex items-center gap-0.5 rounded-full border border-hairline p-0.5 shadow-[var(--deck-seat)]">
        {IMAGE_ALIGNMENTS.map((align) => {
          const on = readAlign(editor.getAttributes("image").align) === align;
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
          className="rounded-full px-2.5 py-1 text-[12px] text-ink-muted transition-colors hover:bg-[var(--control)] hover:text-ink"
        >
          Crop
        </button>

        {/* Offered only where there is something to undo — a Reset that does
            nothing on an uncropped image is a control that lies. */}
        {isCropped(clampCrop(editor.getAttributes("image").crop)) && (
          <button
            type="button"
            title="Show the whole image again"
            onClick={() => editor.chain().focus().resetImageCrop().run()}
            className="rounded-full px-2.5 py-1 text-[12px] text-ink-muted transition-colors hover:bg-[var(--control)] hover:text-ink"
          >
            Reset crop
          </button>
        )}

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
    </BubbleMenu>
  );
}

export default DocsImageToolbar;
