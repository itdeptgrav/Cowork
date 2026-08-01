"use client";

import { Icon } from "@/components/ui/Icons";
import type { Editor } from "@tiptap/react";

/**
 * The toolbar.
 *
 * Grouped the way a word processor's is — text style, then weight, then colour,
 * then alignment, then blocks, then insert — because that grouping is what
 * makes a wide strip of small controls scannable rather than a wall.
 *
 * **Every button's pressed state is read from the EDITOR, never from React
 * state.** A toolbar that tracks its own idea of "bold is on" drifts the moment
 * the caret moves, and then lies about the text under the cursor.
 */

const HEADINGS = [
  { value: "p", label: "Normal text" },
  { value: "1", label: "Title" },
  { value: "2", label: "Heading" },
  { value: "3", label: "Subheading" },
] as const;

/** Text colours, from the field palette — never the C1–C4 channel hues. */
const COLOURS = [
  { value: "", label: "Default" },
  { value: "#b3261e", label: "Red" },
  { value: "#a8630a", label: "Amber" },
  { value: "#1e6b45", label: "Green" },
  { value: "#1a4f8a", label: "Blue" },
  { value: "#5b3ea8", label: "Violet" },
];

export function EditorToolbar({ editor }: { editor: Editor }) {
  const headingValue = editor.isActive("heading", { level: 1 })
    ? "1"
    : editor.isActive("heading", { level: 2 })
      ? "2"
      : editor.isActive("heading", { level: 3 })
        ? "3"
        : "p";

  return (
    <div
      role="toolbar"
      aria-label="Formatting"
      className="flex flex-wrap items-center gap-0.5 border-b border-hairline px-3 py-1.5"
    >
      <Btn
        label="Undo"
        onClick={() => editor.chain().focus().undo().run()}
        disabled={!editor.can().undo()}
      >
        <Icon.history className="h-3.5 w-3.5" />
      </Btn>
      <Btn
        label="Redo"
        onClick={() => editor.chain().focus().redo().run()}
        disabled={!editor.can().redo()}
      >
        <span className="inline-block scale-x-[-1]">
          <Icon.history className="h-3.5 w-3.5" />
        </span>
      </Btn>

      <Sep />

      <select
        aria-label="Paragraph style"
        value={headingValue}
        onChange={(e) => {
          const v = e.target.value;
          if (v === "p") editor.chain().focus().setParagraph().run();
          else
            editor
              .chain()
              .focus()
              .toggleHeading({ level: Number(v) as 1 | 2 | 3 })
              .run();
        }}
        className="h-7 rounded-inset bg-transparent px-1.5 text-[12px] text-ink-muted hover:bg-[var(--control)]"
      >
        {HEADINGS.map((h) => (
          <option key={h.value} value={h.value}>
            {h.label}
          </option>
        ))}
      </select>

      <Sep />

      <Btn label="Bold" active={editor.isActive("bold")} onClick={() => editor.chain().focus().toggleBold().run()}>
        <span className="font-semibold">B</span>
      </Btn>
      <Btn label="Italic" active={editor.isActive("italic")} onClick={() => editor.chain().focus().toggleItalic().run()}>
        <span className="italic">I</span>
      </Btn>
      <Btn label="Underline" active={editor.isActive("underline")} onClick={() => editor.chain().focus().toggleUnderline().run()}>
        <span className="underline">U</span>
      </Btn>
      <Btn label="Strikethrough" active={editor.isActive("strike")} onClick={() => editor.chain().focus().toggleStrike().run()}>
        <span className="line-through">S</span>
      </Btn>
      <Btn label="Highlight" active={editor.isActive("highlight")} onClick={() => editor.chain().focus().toggleHighlight().run()}>
        <span className="rounded-[2px] bg-[var(--color-field-gold)] px-1 text-black/80">H</span>
      </Btn>

      <select
        aria-label="Text colour"
        value={(editor.getAttributes("textStyle").color as string) ?? ""}
        onChange={(e) => {
          const v = e.target.value;
          if (!v) editor.chain().focus().unsetColor().run();
          else editor.chain().focus().setColor(v).run();
        }}
        className="h-7 rounded-inset bg-transparent px-1.5 text-[12px] text-ink-muted hover:bg-[var(--control)]"
      >
        {COLOURS.map((c) => (
          <option key={c.value} value={c.value}>
            {c.label}
          </option>
        ))}
      </select>

      <Sep />

      {(["left", "center", "right", "justify"] as const).map((a) => (
        <Btn
          key={a}
          label={`Align ${a}`}
          active={editor.isActive({ textAlign: a })}
          onClick={() => editor.chain().focus().setTextAlign(a).run()}
        >
          <AlignGlyph align={a} />
        </Btn>
      ))}

      <Sep />

      <Btn label="Bullet list" active={editor.isActive("bulletList")} onClick={() => editor.chain().focus().toggleBulletList().run()}>
        <Icon.list className="h-3.5 w-3.5" />
      </Btn>
      <Btn label="Numbered list" active={editor.isActive("orderedList")} onClick={() => editor.chain().focus().toggleOrderedList().run()}>
        <Icon.sort className="h-3.5 w-3.5" />
      </Btn>
      <Btn label="Checklist" active={editor.isActive("taskList")} onClick={() => editor.chain().focus().toggleTaskList().run()}>
        <Icon.check className="h-3.5 w-3.5" />
      </Btn>
      <Btn label="Quote" active={editor.isActive("blockquote")} onClick={() => editor.chain().focus().toggleBlockquote().run()}>
        &ldquo;
      </Btn>
      <Btn label="Code block" active={editor.isActive("codeBlock")} onClick={() => editor.chain().focus().toggleCodeBlock().run()}>
        {"</>"}
      </Btn>

      <Sep />

      <Btn
        label="Link"
        active={editor.isActive("link")}
        onClick={() => {
          if (editor.isActive("link")) {
            editor.chain().focus().unsetLink().run();
            return;
          }
          /* `prompt` rather than a dialog, deliberately for now: a link modal
             is its own surface with its own focus management, and shipping the
             rest of the toolbar behind it would be the wrong order. */
          const url = window.prompt("Link to");
          if (!url) return;
          const safe = /^https?:\/\//i.test(url) ? url : `https://${url}`;
          editor.chain().focus().setLink({ href: safe }).run();
        }}
      >
        <Icon.link className="h-3.5 w-3.5" />
      </Btn>
      <Btn
        label="Insert table"
        onClick={() =>
          editor
            .chain()
            .focus()
            .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
            .run()
        }
      >
        <Icon.board className="h-3.5 w-3.5" />
      </Btn>
      <Btn label="Horizontal rule" onClick={() => editor.chain().focus().setHorizontalRule().run()}>
        —
      </Btn>
      <Btn label="Superscript" active={editor.isActive("superscript")} onClick={() => editor.chain().focus().toggleSuperscript().run()}>
        x²
      </Btn>
      <Btn label="Subscript" active={editor.isActive("subscript")} onClick={() => editor.chain().focus().toggleSubscript().run()}>
        x₂
      </Btn>

      <Sep />

      <Btn
        label="Clear formatting"
        onClick={() => editor.chain().focus().unsetAllMarks().clearNodes().run()}
      >
        <Icon.close className="h-3.5 w-3.5" />
      </Btn>

      {/* Table controls appear only inside a table. A permanently-visible row
          of table buttons that do nothing 95% of the time is noise. */}
      {editor.isActive("table") && (
        <>
          <Sep />
          <Btn label="Add row" onClick={() => editor.chain().focus().addRowAfter().run()}>
            +Row
          </Btn>
          <Btn label="Add column" onClick={() => editor.chain().focus().addColumnAfter().run()}>
            +Col
          </Btn>
          <Btn label="Delete row" onClick={() => editor.chain().focus().deleteRow().run()}>
            −Row
          </Btn>
          <Btn label="Delete table" onClick={() => editor.chain().focus().deleteTable().run()}>
            −Table
          </Btn>
        </>
      )}
    </div>
  );
}

function Sep() {
  return <span aria-hidden="true" className="mx-1 h-4 w-px bg-hairline" />;
}

function Btn({
  label,
  active,
  disabled,
  onClick,
  children,
}: {
  label: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className={`grid h-7 min-w-7 place-items-center rounded-inset px-1.5 text-[12px] transition-colors disabled:opacity-35 ${
        active
          ? "bg-ink text-[var(--body-bg)]"
          : "text-ink-muted hover:bg-[var(--control)] hover:text-ink"
      }`}
    >
      {children}
    </button>
  );
}

/** Three bars, weighted to show the alignment. Cheaper than five more icons. */
function AlignGlyph({ align }: { align: "left" | "center" | "right" | "justify" }) {
  const widths =
    align === "center"
      ? ["100%", "60%", "100%"]
      : align === "right"
        ? ["100%", "70%", "100%"]
        : align === "justify"
          ? ["100%", "100%", "100%"]
          : ["100%", "70%", "100%"];
  const items = align === "center" ? "items-center" : align === "right" ? "items-end" : "items-start";
  return (
    <span aria-hidden="true" className={`flex w-3.5 flex-col gap-[2px] ${items}`}>
      {widths.map((w, i) => (
        <span key={i} style={{ width: w }} className="h-[1.5px] bg-current" />
      ))}
    </span>
  );
}
