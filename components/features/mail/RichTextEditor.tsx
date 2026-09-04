"use client";

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useReducer,
  useState,
} from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import { Icon } from "@/components/ui/Icons";
import { mailEditorExtensions } from "./mailEditorExtensions";

/** What the parent can drive imperatively — used by the grammar "apply
 *  corrections" flow, which replaces the body text. */
export interface RichTextEditorHandle {
  setHtml: (html: string) => void;
  focus: () => void;
}

const FONTS: { label: string; value: string }[] = [
  { label: "Sans Serif", value: "" },
  { label: "Serif", value: "Georgia, 'Times New Roman', serif" },
  { label: "Monospace", value: "ui-monospace, SFMono-Regular, monospace" },
];

const SIZES: { label: string; value: string }[] = [
  { label: "Small", value: "12px" },
  { label: "Normal", value: "" },
  { label: "Large", value: "20px" },
  { label: "Huge", value: "28px" },
];

const EMOJIS = [
  "😀", "😄", "🙂", "😉", "😊", "😍", "😎", "🤝", "👍", "🙏",
  "👏", "🎉", "✅", "❌", "⭐", "🔥", "❤️", "💡", "📌", "📎",
];

export const RichTextEditor = forwardRef<
  RichTextEditorHandle,
  {
    html: string;
    onChange: (html: string, text: string) => void;
    placeholder?: string;
    "aria-label"?: string;
  }
>(function RichTextEditor({ html, onChange, "aria-label": ariaLabel }, ref) {
  const [emojiOpen, setEmojiOpen] = useState(false);
  /* Re-render the toolbar on every editor change so the active states (bold on,
     this alignment, etc.) reflect the current selection. */
  const [, force] = useReducer((x: number) => x + 1, 0);

  const editor = useEditor({
    immediatelyRender: false,
    extensions: mailEditorExtensions(),
    content: html || "",
    editorProps: {
      attributes: {
        role: "textbox",
        "aria-multiline": "true",
        ...(ariaLabel ? { "aria-label": ariaLabel } : {}),
        class:
          "mail-rich min-h-[150px] max-h-[42vh] overflow-y-auto rounded-inset bg-[var(--surface-raised)] px-3 py-2 text-sm leading-relaxed text-ink outline-none shadow-[inset_0_0_0_1px_var(--color-hairline)] focus:shadow-[inset_0_0_0_1.5px_var(--color-ink)]",
      },
    },
    onUpdate: ({ editor }) => onChange(editor.getHTML(), editor.getText()),
  });

  useEffect(() => {
    if (!editor) return;
    const h = () => force();
    editor.on("transaction", h);
    return () => {
      editor.off("transaction", h);
    };
  }, [editor]);

  useImperativeHandle(
    ref,
    () => ({
      setHtml: (next: string) => {
        editor?.commands.setContent(next || "", { emitUpdate: true });
      },
      focus: () => editor?.commands.focus(),
    }),
    [editor],
  );

  if (!editor) return null;

  const btn = (active: boolean) =>
    `grid h-7 w-7 place-items-center rounded text-[13px] transition-colors ${
      active
        ? "bg-[var(--control-active)] text-ink"
        : "text-ink-muted hover:bg-[var(--control)] hover:text-ink"
    }`;

  return (
    <div className="rounded-inset shadow-[inset_0_0_0_1px_var(--color-hairline)]">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-0.5 border-b border-hairline px-1.5 py-1.5">
        <button
          type="button"
          aria-label="Undo"
          disabled={!editor.can().undo()}
          onClick={() => editor.chain().focus().undo().run()}
          className={`${btn(false)} disabled:opacity-40`}
        >
          ↶
        </button>
        <button
          type="button"
          aria-label="Redo"
          disabled={!editor.can().redo()}
          onClick={() => editor.chain().focus().redo().run()}
          className={`${btn(false)} disabled:opacity-40`}
        >
          ↷
        </button>

        <Divider />

        <select
          aria-label="Font"
          value={
            FONTS.find((f) => editor.isActive("textStyle", { fontFamily: f.value }))
              ?.value ?? ""
          }
          onChange={(e) => {
            const v = e.target.value;
            v
              ? editor.chain().focus().setFontFamily(v).run()
              : editor.chain().focus().unsetFontFamily().run();
          }}
          className="h-7 rounded bg-transparent px-1 text-[12px] text-ink-muted hover:text-ink"
        >
          {FONTS.map((f) => (
            <option key={f.label} value={f.value}>
              {f.label}
            </option>
          ))}
        </select>

        <select
          aria-label="Font size"
          value={
            SIZES.find((s) => editor.isActive("textStyle", { fontSize: s.value }))
              ?.value ?? ""
          }
          onChange={(e) => {
            const v = e.target.value;
            v
              ? editor.chain().focus().setFontSize(v).run()
              : editor.chain().focus().unsetFontSize().run();
          }}
          className="h-7 rounded bg-transparent px-1 text-[12px] text-ink-muted hover:text-ink"
        >
          {SIZES.map((s) => (
            <option key={s.label} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>

        <Divider />

        <button
          type="button"
          aria-label="Bold"
          aria-pressed={editor.isActive("bold")}
          onClick={() => editor.chain().focus().toggleBold().run()}
          className={`${btn(editor.isActive("bold"))} font-bold`}
        >
          B
        </button>
        <button
          type="button"
          aria-label="Italic"
          aria-pressed={editor.isActive("italic")}
          onClick={() => editor.chain().focus().toggleItalic().run()}
          className={`${btn(editor.isActive("italic"))} italic`}
        >
          I
        </button>
        <button
          type="button"
          aria-label="Underline"
          aria-pressed={editor.isActive("underline")}
          onClick={() => editor.chain().focus().toggleUnderline().run()}
          className={`${btn(editor.isActive("underline"))} underline`}
        >
          U
        </button>
        <button
          type="button"
          aria-label="Strikethrough"
          aria-pressed={editor.isActive("strike")}
          onClick={() => editor.chain().focus().toggleStrike().run()}
          className={`${btn(editor.isActive("strike"))} line-through`}
        >
          S
        </button>

        {/* Text colour — the native picker, applied to the selection. */}
        <label
          className={`${btn(false)} relative cursor-pointer`}
          aria-label="Text colour"
          title="Text colour"
        >
          <span className="font-semibold underline decoration-2" style={{ textDecorationColor: currentColor(editor) }}>
            A
          </span>
          <input
            type="color"
            value={currentColor(editor)}
            onChange={(e) => editor.chain().focus().setColor(e.target.value).run()}
            className="absolute inset-0 cursor-pointer opacity-0"
          />
        </label>

        <Divider />

        <button
          type="button"
          aria-label="Align left"
          aria-pressed={editor.isActive({ textAlign: "left" })}
          onClick={() => editor.chain().focus().setTextAlign("left").run()}
          className={btn(editor.isActive({ textAlign: "left" }))}
        >
          ⇤
        </button>
        <button
          type="button"
          aria-label="Align centre"
          aria-pressed={editor.isActive({ textAlign: "center" })}
          onClick={() => editor.chain().focus().setTextAlign("center").run()}
          className={btn(editor.isActive({ textAlign: "center" }))}
        >
          ≡
        </button>
        <button
          type="button"
          aria-label="Align right"
          aria-pressed={editor.isActive({ textAlign: "right" })}
          onClick={() => editor.chain().focus().setTextAlign("right").run()}
          className={btn(editor.isActive({ textAlign: "right" }))}
        >
          ⇥
        </button>

        <Divider />

        <button
          type="button"
          aria-label="Bulleted list"
          aria-pressed={editor.isActive("bulletList")}
          onClick={() => editor.chain().focus().toggleBulletList().run()}
          className={btn(editor.isActive("bulletList"))}
        >
          <Icon.list className="h-4 w-4" />
        </button>
        <button
          type="button"
          aria-label="Numbered list"
          aria-pressed={editor.isActive("orderedList")}
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
          className={`${btn(editor.isActive("orderedList"))} text-[11px] font-medium`}
        >
          1.
        </button>

        <button
          type="button"
          aria-label={editor.isActive("link") ? "Remove link" : "Add link"}
          aria-pressed={editor.isActive("link")}
          onClick={() => toggleLink(editor)}
          className={btn(editor.isActive("link"))}
        >
          <Icon.link className="h-4 w-4" />
        </button>

        {/* Emoji */}
        <div className="relative">
          <button
            type="button"
            aria-label="Insert emoji"
            aria-expanded={emojiOpen}
            onClick={() => setEmojiOpen((v) => !v)}
            className={btn(emojiOpen)}
          >
            😊
          </button>
          {emojiOpen && (
            <>
              <button
                type="button"
                aria-label="Close emoji picker"
                onClick={() => setEmojiOpen(false)}
                className="fixed inset-0 z-[96] cursor-default"
              />
              <div className="absolute z-[97] mt-1 grid w-[220px] grid-cols-10 gap-0.5 rounded-panel border border-hairline bg-[var(--surface-raised)] p-2 shadow-lg">
                {EMOJIS.map((e) => (
                  <button
                    key={e}
                    type="button"
                    onClick={() => {
                      editor.chain().focus().insertContent(e).run();
                      setEmojiOpen(false);
                    }}
                    className="grid h-6 w-6 place-items-center rounded text-base hover:bg-[var(--control)]"
                  >
                    {e}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>

        <button
          type="button"
          aria-label="Clear formatting"
          onClick={() =>
            editor.chain().focus().unsetAllMarks().clearNodes().run()
          }
          className={`${btn(false)} text-[11px]`}
          title="Clear formatting"
        >
          Tx
        </button>
      </div>

      <EditorContent editor={editor} />
    </div>
  );
});

function Divider() {
  return <span className="mx-1 h-5 w-px shrink-0 bg-[var(--color-hairline)]" />;
}

/** The colour of the current selection, or a sensible default for the picker. */
function currentColor(editor: ReturnType<typeof useEditor>): string {
  const c = editor?.getAttributes("textStyle")?.color;
  return typeof c === "string" && /^#/.test(c) ? c : "#111111";
}

/** Toggle a link: remove it when one is active, else prompt for a URL. `prompt`
 *  is the one browser dialog a simple composer earns — a full bubble editor is
 *  the document editor's job, not the mailbox's. */
function toggleLink(editor: ReturnType<typeof useEditor>) {
  if (!editor) return;
  if (editor.isActive("link")) {
    editor.chain().focus().unsetLink().run();
    return;
  }
  const prev = editor.getAttributes("link")?.href as string | undefined;
  const url =
    typeof window !== "undefined"
      ? window.prompt("Link URL", prev ?? "https://")
      : null;
  if (url === null) return; // cancelled
  if (url.trim() === "") {
    editor.chain().focus().unsetLink().run();
    return;
  }
  editor
    .chain()
    .focus()
    .extendMarkRange("link")
    .setLink({ href: url.trim() })
    .run();
}
