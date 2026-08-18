"use client";

import { useEffect, useRef, useState } from "react";
import { BubbleMenu } from "@tiptap/react/menus";
import { useEditorState, type Editor } from "@tiptap/react";
import {
  LINK_WINDOW_FEATURES,
  isSafeHref,
  linkLabel,
  normaliseHref,
} from "@/lib/rules/documents/linkTools";

/**
 * The bar that appears when the caret is on a link.
 *
 * **A link you cannot open is not really a link.** The editor sets
 * `openOnClick: false` — it has to, or clicking a link to put the caret in it
 * would navigate away mid-sentence — and until now that left no way to follow
 * one at all, and no way to change one except by deleting the text and doing
 * it again. This bar is the other half of that decision.
 *
 * **What it shows is where the click would go**, not the href. A hundred
 * characters of tracking parameters confirm nothing; the host does. That is
 * `linkLabel`, which also keeps `mailto:` and `tel:` whole, because for those
 * the rest of the string is the entire point.
 *
 * **The scheme is checked here as well as when the link was made.** A document
 * is shared, and its HTML also arrives by paste and by import, so an href in
 * the document was not necessarily written by our own dialog. A `javascript:`
 * href is shown as text and refuses to open — see `linkTools.ts`.
 */
export function DocsLinkBubble({ editor }: { editor: Editor | null }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [copied, setCopied] = useState(false);
  const input = useRef<HTMLInputElement | null>(null);

  /**
   * Read through `useEditorState`, not straight off the editor.
   *
   * `BubbleMenu` positions itself from a ProseMirror plugin and does not
   * re-render its React children when the selection moves. Reading
   * `editor.getAttributes` during render therefore returns whatever was true
   * when this component last rendered — for a bar that only appears once the
   * caret is already inside a link, that is the state from BEFORE it got
   * there: an empty href, which reads as unsafe. The bar then tells you a
   * perfectly good link is unsafe and refuses to open it.
   */
  const hrefState = useEditorState({
    editor,
    selector: ({ editor: e }) =>
      e?.isActive("link") ? String(e.getAttributes("link").href ?? "") : "",
  });
  const href = hrefState ?? "";
  const safe = isSafeHref(href);

  /* The draft is seeded where editing STARTS rather than in an effect that
     watches `editing` — the effect would set state during a render pass it did
     not cause, which is a cascading render for no reason. */
  const startEditing = () => {
    setDraft(href);
    setEditing(true);
  };

  useEffect(() => {
    if (!editing) return;
    /* Focused on the next frame: the input is mounted by this same render, and
       focusing it before the browser has laid it out does nothing. */
    const id = requestAnimationFrame(() => {
      input.current?.focus();
      input.current?.select();
    });
    return () => cancelAnimationFrame(id);
  }, [editing]);

  /* Moving to a different link closes the editor and clears "Copied" — both
     belong to the link that was selected, not to the bar. */
  useEffect(() => {
    if (!editor) return;
    const reset = () => {
      setEditing(false);
      setCopied(false);
    };
    editor.on("selectionUpdate", reset);
    return () => {
      editor.off("selectionUpdate", reset);
    };
  }, [editor]);

  if (!editor) return null;

  const open = () => {
    if (!safe) return;
    window.open(href, "_blank", LINK_WINDOW_FEATURES);
  };

  const save = () => {
    const next = normaliseHref(draft);
    if (!next) {
      /* An address that cannot be made safe is refused rather than silently
         stored — the field stays open so it can be corrected. */
      input.current?.focus();
      return;
    }
    editor.chain().focus().extendMarkRange("link").setLink({ href: next }).run();
    setEditing(false);
  };

  const remove = () => {
    editor.chain().focus().extendMarkRange("link").unsetLink().run();
    setEditing(false);
  };

  const copy = () => {
    void navigator.clipboard?.writeText(href).then(
      () => setCopied(true),
      () => setCopied(false),
    );
  };

  const BTN =
    "rounded-full px-2.5 py-1 text-[12px] text-ink-muted transition-colors hover:bg-[var(--control)] hover:text-ink";

  return (
    <BubbleMenu
      editor={editor}
      pluginKey="docsLinkBubble"
      shouldShow={({ editor: e }) =>
        /* Not while an image is selected — that has its own bar, and a picture
           inside a link would otherwise show two. */
        e.isActive("link") && !e.isActive("image")
      }
    >
      <div className="frost-bar flex items-center gap-0.5 rounded-full border border-hairline p-0.5 shadow-[var(--deck-seat)]">
        {editing ? (
          <>
            <input
              ref={input}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  save();
                }
                if (e.key === "Escape") {
                  e.preventDefault();
                  setEditing(false);
                }
              }}
              placeholder="example.com"
              aria-label="Link address"
              className="w-64 rounded-full bg-[var(--control)] px-3 py-1 text-[12px] text-ink outline-none placeholder:text-ink-faint"
            />
            <button type="button" onClick={save} className={BTN}>
              Save
            </button>
            <button type="button" onClick={() => setEditing(false)} className={BTN}>
              Cancel
            </button>
          </>
        ) : (
          <>
            {safe ? (
              <button
                type="button"
                onClick={open}
                title={href}
                className="max-w-[18rem] truncate rounded-full px-3 py-1 text-[12px] text-[var(--accent)] underline decoration-dotted underline-offset-2 transition-colors hover:bg-[var(--control)]"
              >
                {linkLabel(href)}
              </button>
            ) : (
              /* Shown, and not openable. Saying nothing would leave somebody
                 wondering why the link does not work. */
              <span
                title={href}
                className="max-w-[18rem] truncate px-3 py-1 text-[12px] text-[var(--state-overdue-ink)]"
              >
                Unsafe link — not opened
              </span>
            )}

            <span aria-hidden className="mx-0.5 h-4 w-px bg-hairline" />

            {safe && (
              <button type="button" onClick={open} className={BTN} title="Open in a new tab">
                Open
              </button>
            )}
            <button type="button" onClick={startEditing} className={BTN}>
              Edit
            </button>
            {safe && (
              <button type="button" onClick={copy} className={BTN} title="Copy the address">
                {copied ? "Copied" : "Copy"}
              </button>
            )}
            <button
              type="button"
              onClick={remove}
              title="Keep the text, drop the link"
              className="rounded-full px-2.5 py-1 text-[12px] text-ink-muted transition-colors hover:bg-[var(--state-rework)] hover:text-[var(--state-rework-ink)]"
            >
              Remove
            </button>
          </>
        )}
      </div>
    </BubbleMenu>
  );
}

export default DocsLinkBubble;
