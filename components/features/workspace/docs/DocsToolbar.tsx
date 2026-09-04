"use client";

import { useState } from "react";
import { useEditorState, type Editor } from "@tiptap/react";
import { isPaintable } from "@/lib/rules/documents/formatPainter";
import { DocIcon } from "./DocsIcons";
import { MenuItem, MenuSeparator, Popover } from "./DocsMenu";
import {
  DEFAULT_FONT_SIZE_PT,
  FONT_FAMILIES,
  FONT_SIZES,
  HIGHLIGHT_COLOURS,
  LINE_SPACINGS,
  PARAGRAPH_STYLES,
  TEXT_COLOURS,
  type HeadingLevel,
} from "@/lib/documents/typography";
import { ZOOM_STEPS } from "@/lib/rules/documents/pageSetup";

/**
 * The toolbar.
 *
 * Grouped the way a word processor's is — history, then document actions, then
 * text style, then weight and colour, then insert, then paragraph — because
 * that grouping is what makes a wide strip of small controls scannable rather
 * than a wall.
 *
 * **Every control's state is read from the EDITOR, never from React state.** A
 * toolbar that tracks its own idea of "bold is on" drifts the moment the caret
 * moves, and then lies about the text under the cursor. The two exceptions are
 * zoom and the editing mode, which are properties of the view rather than of
 * the text, and they are passed in.
 */

export interface ToolbarActions {
  onFind: () => void;
  onPrint: () => void;
  onInsertLink: () => void;
  onInsertImage: () => void;
  zoom: number;
  onZoom: (value: number) => void;
  spellcheck: boolean;
  onSpellcheck: (value: boolean) => void;
  /** Null when the reader cannot edit — the mode switch is then not offered. */
  mode: "editing" | "viewing" | "suggesting";
  onMode: (mode: "editing" | "viewing" | "suggesting") => void;
  canEdit: boolean;
}

export function DocsToolbar({
  editor,
  actions,
}: {
  editor: Editor;
  actions: ToolbarActions;
}) {
  /* The format painter holds the marks it copied. State, because there is
     nothing in the document to read it from — it is a clipboard for
     formatting. */
  const [painted, setPainted] = useState<CopiedFormat | null>(null);

  /* The toolbar shows the state of the text under the caret, so it has to
     re-render when that changes — and `useEditor` deliberately does not
     re-render on every transaction. This subscribes to a compact signature of
     exactly what is on screen here: a deep-equal comparison means moving the
     caret through unformatted text costs nothing. */
  useEditorState({ editor, selector: ({ editor: e }) => toolbarSignature(e) });

  const styleId =
    PARAGRAPH_STYLES.find(
      (s) => s.level !== null && editor.isActive("heading", { level: s.level }),
    )?.id ?? "p";
  const styleLabel = PARAGRAPH_STYLES.find((s) => s.id === styleId)?.label ?? "Normal text";

  const fontStack = (editor.getAttributes("textStyle").fontFamily as string) ?? "";
  const fontLabel =
    FONT_FAMILIES.find((f) => f.stack === fontStack)?.label ??
    (fontStack ? fontStack.split(",")[0].replace(/['"]/g, "") : "Default");

  const sizeAttr = (editor.getAttributes("textStyle").fontSize as string) ?? "";
  const sizePt = Number.parseFloat(sizeAttr) || DEFAULT_FONT_SIZE_PT;

  const setSize = (pt: number) => {
    const next = Math.min(400, Math.max(4, Math.round(pt)));
    editor.chain().focus().setFontSize(`${next}pt`).run();
  };

  const applyPainter = () => {
    if (!painted) {
      /* Copying takes what is under the caret. Nothing is applied yet — the
         next selection is what receives it. */
      setPainted({
        marks: PAINTABLE_MARKS.filter((m) => editor.isActive(m)),
        style: editor.getAttributes("textStyle") as Record<string, unknown>,
        highlight: (editor.getAttributes("highlight").color as string) ?? null,
      });
      return;
    }
    /* Cleared first, so the target ends up with the copied formatting rather
       than with the copied formatting ON TOP of whatever it already had.

       **One paintable type at a time, never `unsetAllMarks`.** The painter
       carries how text LOOKS; the wholesale clear also stripped what text IS —
       a link painted over stopped being a link, and a comment's anchor came
       off the words its thread was about. `isPaintable` is the boundary, and
       it fails closed on the identity marks. */
    let chain = editor.chain().focus();
    for (const type of Object.keys(editor.schema.marks)) {
      if (isPaintable(type)) chain = chain.unsetMark(type);
    }
    for (const mark of painted.marks) chain.setMark(mark);
    if (typeof painted.style.color === "string") chain.setColor(painted.style.color);
    if (typeof painted.style.fontFamily === "string")
      chain.setFontFamily(painted.style.fontFamily);
    if (typeof painted.style.fontSize === "string")
      chain.setFontSize(painted.style.fontSize);
    if (painted.highlight) chain.setHighlight({ color: painted.highlight });
    chain.run();
    setPainted(null);
  };

  const indent = (delta: 1 | -1) => {
    /* Inside a list the step is a nesting level, not a margin: moving a bullet
       right must make it a sub-bullet, or the list's numbering stops matching
       what is on screen. */
    if (editor.isActive("listItem") || editor.isActive("taskItem")) {
      const name = editor.isActive("taskItem") ? "taskItem" : "listItem";
      const chain = editor.chain().focus();
      if (delta === 1) chain.sinkListItem(name).run();
      else chain.liftListItem(name).run();
      return;
    }
    editor.chain().focus().indentBlocks(delta).run();
  };

  return (
    <div
      role="toolbar"
      aria-label="Document formatting"
      className="flex flex-wrap items-center gap-0.5 border-b border-hairline bg-[var(--surface-raised)] px-3 py-1.5"
    >
      <Btn label="Find and replace" shortcut="Ctrl F" onClick={actions.onFind}>
        <DocIcon.search className="h-3.5 w-3.5" />
      </Btn>
      <Btn
        label="Undo"
        shortcut="Ctrl Z"
        onClick={() => editor.chain().focus().undo().run()}
        disabled={!editor.can().undo()}
      >
        <DocIcon.undo className="h-3.5 w-3.5" />
      </Btn>
      <Btn
        label="Redo"
        shortcut="Ctrl Y"
        onClick={() => editor.chain().focus().redo().run()}
        disabled={!editor.can().redo()}
      >
        <DocIcon.redo className="h-3.5 w-3.5" />
      </Btn>
      <Btn label="Print" shortcut="Ctrl P" onClick={actions.onPrint}>
        <DocIcon.print className="h-3.5 w-3.5" />
      </Btn>
      <Btn
        label={actions.spellcheck ? "Spelling check on" : "Spelling check off"}
        active={actions.spellcheck}
        onClick={() => actions.onSpellcheck(!actions.spellcheck)}
      >
        <DocIcon.spellcheck className="h-3.5 w-3.5" />
      </Btn>
      <Btn
        label={painted ? "Apply copied formatting" : "Copy formatting"}
        active={!!painted}
        onClick={applyPainter}
      >
        <DocIcon.paint className="h-3.5 w-3.5" />
      </Btn>

      <Sep />

      <Popover
        label="Zoom"
        width={140}
        render={() => (
          <>
            {ZOOM_STEPS.map((z) => (
              <MenuItem
                key={z}
                label={`${Math.round(z * 100)}%`}
                active={Math.abs(actions.zoom - z) < 0.001}
                onSelect={() => actions.onZoom(z)}
              />
            ))}
          </>
        )}
      >
        <span className="tabular-nums" data-figure>
          {Math.round(actions.zoom * 100)}%
        </span>
        <DocIcon.chevronDown className="h-3 w-3" />
      </Popover>

      <Sep />

      <Popover
        label="Paragraph style"
        width={210}
        render={() => (
          <>
            {PARAGRAPH_STYLES.map((s) => (
              <button
                key={s.id}
                type="button"
                role="menuitem"
                onClick={() => {
                  if (s.level === null) editor.chain().focus().setParagraph().run();
                  else
                    editor
                      .chain()
                      .focus()
                      .setNode("heading", { level: s.level as HeadingLevel })
                      .run();
                }}
                className={`flex w-full items-center gap-2.5 px-2.5 py-1.5 text-left hover:bg-[var(--row-hover)] ${
                  styleId === s.id ? "bg-[var(--control)]" : ""
                }`}
              >
                <span
                  className="min-w-0 flex-1 truncate text-ink"
                  style={{ fontSize: s.sample, lineHeight: 1.25 }}
                >
                  {s.label}
                </span>
              </button>
            ))}
          </>
        )}
      >
        <span className="w-[86px] truncate text-left">{styleLabel}</span>
        <DocIcon.chevronDown className="h-3 w-3" />
      </Popover>

      <Sep />

      <Popover
        label="Font"
        width={216}
        render={() => (
          <>
            {FONT_FAMILIES.map((f) => (
              <button
                key={f.label}
                type="button"
                role="menuitem"
                onClick={() => {
                  if (!f.stack) editor.chain().focus().unsetFontFamily().run();
                  else editor.chain().focus().setFontFamily(f.stack).run();
                }}
                className={`flex w-full items-center px-2.5 py-1.5 text-left text-[13px] text-ink hover:bg-[var(--row-hover)] ${
                  fontStack === f.stack ? "bg-[var(--control)]" : ""
                }`}
                style={{ fontFamily: f.stack || undefined }}
              >
                {f.label}
              </button>
            ))}
          </>
        )}
      >
        <span className="w-[92px] truncate text-left">{fontLabel}</span>
        <DocIcon.chevronDown className="h-3 w-3" />
      </Popover>

      <Sep />

      <div className="flex items-center gap-0.5">
        <Btn label="Decrease font size" onClick={() => setSize(prevSize(sizePt))}>
          <DocIcon.minus className="h-3.5 w-3.5" />
        </Btn>
        <input
          aria-label="Font size in points"
          value={sizePt}
          onChange={(e) => {
            const next = Number(e.target.value);
            if (Number.isFinite(next) && next > 0) setSize(next);
          }}
          inputMode="numeric"
          className="h-7 w-11 rounded-inset border border-hairline bg-transparent text-center text-[12px] text-ink tabular-nums"
        />
        <Btn label="Increase font size" onClick={() => setSize(nextSize(sizePt))}>
          <DocIcon.plus className="h-3.5 w-3.5" />
        </Btn>
        <Popover
          label="Choose a font size"
          width={96}
          render={() => (
            <>
              {FONT_SIZES.map((s) => (
                <MenuItem
                  key={s}
                  label={String(s)}
                  active={s === sizePt}
                  onSelect={() => setSize(s)}
                />
              ))}
            </>
          )}
        >
          <DocIcon.chevronDown className="h-3 w-3" />
        </Popover>
      </div>

      <Sep />

      <Btn label="Bold" shortcut="Ctrl B" active={editor.isActive("bold")} onClick={() => editor.chain().focus().toggleBold().run()}>
        <span className="font-semibold">B</span>
      </Btn>
      <Btn label="Italic" shortcut="Ctrl I" active={editor.isActive("italic")} onClick={() => editor.chain().focus().toggleItalic().run()}>
        <span className="italic font-serif">I</span>
      </Btn>
      <Btn label="Underline" shortcut="Ctrl U" active={editor.isActive("underline")} onClick={() => editor.chain().focus().toggleUnderline().run()}>
        <span className="underline">U</span>
      </Btn>
      <Btn label="Strikethrough" active={editor.isActive("strike")} onClick={() => editor.chain().focus().toggleStrike().run()}>
        <span className="line-through">S</span>
      </Btn>

      <SwatchPopover
        label="Text colour"
        rows={TEXT_COLOURS}
        current={(editor.getAttributes("textStyle").color as string) ?? ""}
        onPick={(value) => {
          if (!value) editor.chain().focus().unsetColor().run();
          else editor.chain().focus().setColor(value).run();
        }}
        face={
          <span className="relative grid place-items-center">
            <DocIcon.textColor className="h-3.5 w-3.5" />
          </span>
        }
      />
      <SwatchPopover
        label="Highlight colour"
        rows={HIGHLIGHT_COLOURS}
        current={(editor.getAttributes("highlight").color as string) ?? ""}
        onPick={(value) => {
          if (!value) editor.chain().focus().unsetHighlight().run();
          else editor.chain().focus().setHighlight({ color: value }).run();
        }}
        face={<DocIcon.highlight className="h-3.5 w-3.5" />}
      />

      <Sep />

      <Btn label="Link" shortcut="Ctrl K" active={editor.isActive("link")} onClick={actions.onInsertLink}>
        <DocIcon.link className="h-3.5 w-3.5" />
      </Btn>
      <Btn label="Insert image" onClick={actions.onInsertImage}>
        <DocIcon.image className="h-3.5 w-3.5" />
      </Btn>
      <TablePicker editor={editor} />

      <Sep />

      <Popover
        label="Alignment"
        width={190}
        render={() => (
          <>
            <MenuItem label="Left" shortcut="Ctrl Shift L" icon={<DocIcon.alignLeft />} active={editor.isActive({ textAlign: "left" })} onSelect={() => editor.chain().focus().setTextAlign("left").run()} />
            <MenuItem label="Centre" shortcut="Ctrl Shift E" icon={<DocIcon.alignCenter />} active={editor.isActive({ textAlign: "center" })} onSelect={() => editor.chain().focus().setTextAlign("center").run()} />
            <MenuItem label="Right" shortcut="Ctrl Shift R" icon={<DocIcon.alignRight />} active={editor.isActive({ textAlign: "right" })} onSelect={() => editor.chain().focus().setTextAlign("right").run()} />
            <MenuItem label="Justified" shortcut="Ctrl Shift J" icon={<DocIcon.alignJustify />} active={editor.isActive({ textAlign: "justify" })} onSelect={() => editor.chain().focus().setTextAlign("justify").run()} />
          </>
        )}
      >
        <DocIcon.alignLeft />
        <DocIcon.chevronDown className="h-3 w-3" />
      </Popover>

      <Popover
        label="Line spacing"
        width={190}
        render={() => (
          <>
            {LINE_SPACINGS.map((s) => (
              <MenuItem
                key={s.value}
                label={s.label}
                /* Read from whichever block the caret is in. Asking only about
                   `paragraph` would show nothing selected inside a heading,
                   which carries the attribute just the same. */
                active={currentLineHeight(editor) === s.value}
                onSelect={() => editor.chain().focus().setLineSpacing(s.value).run()}
              />
            ))}
            <MenuSeparator />
            <MenuItem
              label="Clear spacing"
              onSelect={() => editor.chain().focus().setLineSpacing(null).run()}
            />
          </>
        )}
      >
        <DocIcon.lineSpacing className="h-3.5 w-3.5" />
        <DocIcon.chevronDown className="h-3 w-3" />
      </Popover>

      <Btn label="Checklist" active={editor.isActive("taskList")} onClick={() => editor.chain().focus().toggleTaskList().run()}>
        <DocIcon.checklist className="h-3.5 w-3.5" />
      </Btn>
      <Btn label="Bulleted list" shortcut="Ctrl Shift 8" active={editor.isActive("bulletList")} onClick={() => editor.chain().focus().toggleBulletList().run()}>
        <DocIcon.bulletList className="h-3.5 w-3.5" />
      </Btn>
      <Btn label="Numbered list" shortcut="Ctrl Shift 7" active={editor.isActive("orderedList")} onClick={() => editor.chain().focus().toggleOrderedList().run()}>
        <DocIcon.numberList className="h-3.5 w-3.5" />
      </Btn>
      <Btn label="Decrease indent" onClick={() => indent(-1)}>
        <DocIcon.outdent className="h-3.5 w-3.5" />
      </Btn>
      <Btn label="Increase indent" onClick={() => indent(1)}>
        <DocIcon.indent className="h-3.5 w-3.5" />
      </Btn>
      <Btn
        label="Clear formatting"
        shortcut="Ctrl \\"
        onClick={() => editor.chain().focus().unsetAllMarks().clearNodes().run()}
      >
        <DocIcon.clearFormat className="h-3.5 w-3.5" />
      </Btn>

      {/* Table controls appear only inside a table. A permanently visible row of
          table buttons that do nothing 95% of the time is noise. */}
      {editor.isActive("table") && (
        <>
          <Sep />
          <Popover
            label="Table"
            width={210}
            render={() => (
              <>
                <MenuItem label="Insert row above" onSelect={() => editor.chain().focus().addRowBefore().run()} />
                <MenuItem label="Insert row below" onSelect={() => editor.chain().focus().addRowAfter().run()} />
                <MenuItem label="Insert column left" onSelect={() => editor.chain().focus().addColumnBefore().run()} />
                <MenuItem label="Insert column right" onSelect={() => editor.chain().focus().addColumnAfter().run()} />
                <MenuSeparator />
                <MenuItem label="Merge cells" onSelect={() => editor.chain().focus().mergeCells().run()} />
                <MenuItem label="Split cell" onSelect={() => editor.chain().focus().splitCell().run()} />
                <MenuItem label="Toggle header row" onSelect={() => editor.chain().focus().toggleHeaderRow().run()} />
                <MenuSeparator />
                <MenuItem label="Delete row" danger onSelect={() => editor.chain().focus().deleteRow().run()} />
                <MenuItem label="Delete column" danger onSelect={() => editor.chain().focus().deleteColumn().run()} />
                <MenuItem label="Delete table" danger onSelect={() => editor.chain().focus().deleteTable().run()} />
              </>
            )}
          >
            <DocIcon.table className="h-3.5 w-3.5" />
            <span>Table</span>
            <DocIcon.chevronDown className="h-3 w-3" />
          </Popover>
        </>
      )}

      <span className="ms-auto flex items-center gap-1">
        {actions.canEdit && (
          <Popover
            label="Editing mode"
            align="end"
            width={230}
            render={() => (
              <>
                <MenuItem
                  label="Editing"
                  note="Make changes directly."
                  icon={<DocIcon.pencil className="h-3.5 w-3.5" />}
                  active={actions.mode === "editing"}
                  onSelect={() => actions.onMode("editing")}
                />
                <MenuItem
                  label="Suggesting"
                  note="Propose changes for someone to accept."
                  icon={<DocIcon.pencil className="h-3.5 w-3.5 text-[#1f8a4c]" />}
                  active={actions.mode === "suggesting"}
                  onSelect={() => actions.onMode("suggesting")}
                />
                <MenuItem
                  label="Viewing"
                  note="Read it without changing anything."
                  icon={<DocIcon.eye className="h-3.5 w-3.5" />}
                  active={actions.mode === "viewing"}
                  onSelect={() => actions.onMode("viewing")}
                />
              </>
            )}
          >
            {actions.mode === "editing" ? (
              <DocIcon.pencil className="h-3.5 w-3.5" />
            ) : actions.mode === "suggesting" ? (
              <DocIcon.pencil className="h-3.5 w-3.5 text-[#1f8a4c]" />
            ) : (
              <DocIcon.eye className="h-3.5 w-3.5" />
            )}
            <DocIcon.chevronDown className="h-3 w-3" />
          </Popover>
        )}
      </span>
    </div>
  );
}

const PAINTABLE_MARKS = [
  "bold",
  "italic",
  "underline",
  "strike",
  "code",
  "superscript",
  "subscript",
] as const;

interface CopiedFormat {
  marks: string[];
  style: Record<string, unknown>;
  highlight: string | null;
}

/**
 * Everything the toolbar draws differently depending on the document.
 *
 * Returned as one object and compared by value, so a keystroke that changes no
 * button changes nothing here either.
 */
function toolbarSignature(editor: Editor) {
  return {
    marks: PAINTABLE_MARKS.map((m) => editor.isActive(m)),
    heading: PARAGRAPH_STYLES.map((s) =>
      s.level === null ? editor.isActive("paragraph") : editor.isActive("heading", { level: s.level }),
    ),
    align: ["left", "center", "right", "justify"].map((a) => editor.isActive({ textAlign: a })),
    lists: [
      editor.isActive("bulletList"),
      editor.isActive("orderedList"),
      editor.isActive("taskList"),
      editor.isActive("table"),
      editor.isActive("link"),
    ],
    style: editor.getAttributes("textStyle"),
    highlight: editor.getAttributes("highlight").color ?? null,
    lineHeight: currentLineHeight(editor),
    history: [editor.can().undo(), editor.can().redo()],
  };
}

function currentLineHeight(editor: Editor): string | null {
  const block = editor.isActive("heading") ? "heading" : "paragraph";
  const value = editor.getAttributes(block).lineHeight;
  return typeof value === "string" ? value : null;
}

function prevSize(current: number): number {
  const below = FONT_SIZES.filter((s) => s < current);
  return below.length ? below[below.length - 1] : Math.max(4, current - 1);
}

function nextSize(current: number): number {
  return FONT_SIZES.find((s) => s > current) ?? current + 1;
}

/**
 * A colour grid.
 *
 * The swatch under the glyph shows what is currently applied, so the button
 * answers "what colour is this text" without being pressed — which is the
 * question people actually have when the caret is somewhere they did not type.
 */
function SwatchPopover({
  label,
  rows,
  current,
  onPick,
  face,
}: {
  label: string;
  rows: { label: string; value: string }[][];
  current: string;
  onPick: (value: string) => void;
  face: React.ReactNode;
}) {
  return (
    <Popover
      label={label}
      width={222}
      render={(close) => (
        <div className="p-2">
          <div className="flex flex-col gap-1">
            {rows.map((row, i) => (
              <div key={i} className="flex gap-1">
                {row.map((s) => (
                  <button
                    key={s.label}
                    type="button"
                    title={s.label}
                    aria-label={s.label}
                    onClick={() => {
                      onPick(s.value);
                      close();
                    }}
                    className={`h-6 w-6 rounded-[5px] border transition-transform hover:scale-110 ${
                      current === s.value
                        ? "border-ink"
                        : "border-hairline"
                    }`}
                    style={{
                      background: s.value || "transparent",
                      backgroundImage: s.value
                        ? undefined
                        : "linear-gradient(135deg, transparent 45%, var(--state-overdue-ink) 45%, var(--state-overdue-ink) 55%, transparent 55%)",
                    }}
                  />
                ))}
              </div>
            ))}
          </div>
          <label className="mt-2 flex items-center gap-2 border-t border-hairline pt-2 text-[11px] text-ink-muted">
            Custom
            <input
              type="color"
              value={current || "#000000"}
              onChange={(e) => onPick(e.target.value)}
              className="h-6 w-8 cursor-pointer rounded-[5px] border border-hairline bg-transparent"
            />
            <span className="text-ink-faint">
              Check it reads on a dark page too.
            </span>
          </label>
        </div>
      )}
    >
      <span className="flex flex-col items-center leading-none">
        {face}
        <span
          aria-hidden="true"
          className="mt-[2px] h-[3px] w-3.5 rounded-full border border-hairline"
          style={{ background: current || "currentColor" }}
        />
      </span>
    </Popover>
  );
}

/** Insert a table by dragging out its size, the way every editor does it. */
function TablePicker({ editor }: { editor: Editor }) {
  const [hover, setHover] = useState({ rows: 0, cols: 0 });
  const MAX = 8;
  return (
    <Popover
      label="Insert table"
      width={200}
      render={(close) => (
        <div className="p-2">
          <div className="flex flex-col gap-[3px]">
            {Array.from({ length: MAX }, (_, r) => (
              <div key={r} className="flex gap-[3px]">
                {Array.from({ length: MAX }, (_, c) => {
                  const on = r < hover.rows && c < hover.cols;
                  return (
                    <button
                      key={c}
                      type="button"
                      aria-label={`${r + 1} by ${c + 1}`}
                      onPointerEnter={() => setHover({ rows: r + 1, cols: c + 1 })}
                      onClick={() => {
                        editor
                          .chain()
                          .focus()
                          .insertTable({ rows: r + 1, cols: c + 1, withHeaderRow: true })
                          .run();
                        close();
                      }}
                      className={`h-[15px] w-[15px] rounded-[3px] border ${
                        on
                          ? "border-ink bg-[var(--control-active)]"
                          : "border-hairline"
                      }`}
                    />
                  );
                })}
              </div>
            ))}
          </div>
          <p className="mt-2 text-[11px] text-ink-muted">
            {hover.rows > 0 ? `${hover.rows} × ${hover.cols}` : "Choose a size"}
          </p>
        </div>
      )}
    >
      <DocIcon.table className="h-3.5 w-3.5" />
      <DocIcon.chevronDown className="h-3 w-3" />
    </Popover>
  );
}

function Sep() {
  return <span aria-hidden="true" className="mx-1 h-4 w-px bg-hairline" />;
}

function Btn({
  label,
  shortcut,
  active,
  disabled,
  onClick,
  children,
}: {
  label: string;
  shortcut?: string;
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
      title={shortcut ? `${label} (${shortcut})` : label}
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
