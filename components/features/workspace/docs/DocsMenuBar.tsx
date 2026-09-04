"use client";

import { useEffect, useRef, useState } from "react";
import { useEditorState, type Editor } from "@tiptap/react";
import { DocIcon } from "./DocsIcons";
import { MenuHeading, MenuItem, MenuPanel, MenuSeparator, SubMenu } from "./DocsMenu";
/* Type-level: these modules augment `ChainedCommands` with the commands the
   Insert menu calls; the augmentation is only visible once they are loaded. */
import "@/lib/documents/extensions/callout";
import "@/lib/documents/extensions/columns";
import "@/lib/documents/extensions/tableOfContents";
import "@tiptap/extension-details";
import { CASE_LABELS, CASE_MODES, applyCase } from "@/lib/rules/documents/textCase";
import { LINE_SPACINGS, PARAGRAPH_STYLES, type HeadingLevel } from "@/lib/documents/typography";

/**
 * The menu bar.
 *
 * ## Why a menu bar at all, when there is a toolbar
 *
 * The toolbar holds what is used constantly and can be reached in one press.
 * The menus hold everything else — page setup, export, word count, the
 * shortcuts list — and they hold it in named groups a person can *read*. A
 * product that hides those behind a "…" is one where nobody discovers them.
 *
 * ## Hover-to-switch, but only once something is open
 *
 * Every desktop menu bar behaves this way and the reason is real: opening File
 * and then reading across the bar should not require six separate clicks.
 * Before anything is open, hover does nothing — a menu that drops down because
 * the pointer crossed it on the way somewhere else is a menu that fires at the
 * wrong moment.
 *
 * Nothing here is a control that does not work. There is no Extensions menu
 * because there are no add-ons, and no Comments item because there is no
 * comment layer — an entry that opens a panel saying "coming soon" is worse
 * than its absence, because it was found by somebody who needed it.
 */

export interface MenuBarActions {
  onNewDocument: () => void;
  onDuplicate: () => void;
  onRename: () => void;
  onDownloadHtml: () => void;
  onDownloadText: () => void;
  onDownloadPdf: () => void;
  onDownloadDocx: () => void;
  onDownloadMarkdown: () => void;
  onPrint: () => void;
  onPageSetup: () => void;
  onVersionHistory: () => void;
  onDelete: () => void;
  canManage: boolean;

  onFind: () => void;
  onInsertLink: () => void;
  onSpecialCharacters: () => void;
  /** Open one of the value-taking insert dialogs: a video, an embed, an
      equation, a footnote, a bookmark. */
  onAsk?: (kind: "youtube" | "embed" | "math" | "footnote" | "bookmark" | "attachment") => void;
  onInsertImage: () => void;
  onWordCount: () => void;
  onShortcuts: () => void;
  /** Voice typing — the browser's speech recogniser writing at the caret. */
  voiceOn: boolean;
  onVoiceTyping: (on: boolean) => void;
  /** Pageless: one continuous sheet as wide as the window, no paper. */
  pageless: boolean;
  onPageless: (value: boolean) => void;

  showOutline: boolean;
  onShowOutline: (value: boolean) => void;
  showRuler: boolean;
  onShowRuler: (value: boolean) => void;
  showPageGuides: boolean;
  onShowPageGuides: (value: boolean) => void;
  /** "Continue writing" — off by default; see `DocumentEditor.tsx`'s own
      note on why this is opt-in rather than always on. */
  suggestEnabled: boolean;
  onSuggestEnabled: (value: boolean) => void;
  /** The browser's own chrome is hidden — not a size the document can be. */
  chromeless: boolean;
  onChromeless: () => void;
  spellcheck: boolean;
  onSpellcheck: (value: boolean) => void;

  mode: "editing" | "viewing" | "suggesting";
  onMode: (mode: "editing" | "viewing" | "suggesting") => void;
  canEdit: boolean;
  /** The review panel listing every proposed change. */
  showSuggestions: boolean;
  onShowSuggestions: (value: boolean) => void;
}

const MENUS = ["File", "Edit", "View", "Insert", "Format", "Tools", "Help"] as const;
type MenuName = (typeof MENUS)[number];

export function DocsMenuBar({
  editor,
  actions,
}: {
  editor: Editor | null;
  actions: MenuBarActions;
}) {
  const [open, setOpen] = useState<MenuName | null>(null);
  const bar = useRef<HTMLDivElement | null>(null);

  /* The menus show ticks against what is currently applied, and grey out Undo
     when there is nothing to undo — both of which are properties of the editor
     that `useEditor` does not re-render for. A compact signature, compared by
     value, so typing costs a render only when one of these actually changes. */
  useEditorState({
    editor,
    selector: ({ editor: e }) =>
      e
        ? {
            history: [e.can().undo(), e.can().redo()],
            marks: ["bold", "italic", "underline", "strike", "superscript", "subscript", "code"].map(
              (m) => e.isActive(m),
            ),
            blocks: ["paragraph", "bulletList", "orderedList", "taskList"].map((b) => e.isActive(b)),
            align: ["left", "center", "right", "justify"].map((a) => e.isActive({ textAlign: a })),
            heading: [1, 2, 3, 4, 5].map((level) => e.isActive("heading", { level })),
          }
        : null,
  });

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!bar.current?.contains(e.target as Node)) setOpen(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(null);
    };
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const close = () => setOpen(null);
  const can = actions.canEdit && actions.mode !== "viewing" && !!editor;
  const run = (fn: (e: Editor) => void) => () => {
    if (editor) fn(editor);
  };

  return (
    <div ref={bar} className="flex items-center gap-0.5" role="menubar">
      {MENUS.map((name) => (
        <div key={name} className="relative">
          <button
            type="button"
            role="menuitem"
            aria-haspopup="menu"
            aria-expanded={open === name}
            onClick={() => setOpen((v) => (v === name ? null : name))}
            onPointerEnter={() => setOpen((v) => (v === null ? v : name))}
            className={`h-6 rounded-inset px-2 text-[12.5px] transition-colors ${
              open === name
                ? "bg-[var(--control)] text-ink"
                : "text-ink-muted hover:bg-[var(--control)] hover:text-ink"
            }`}
          >
            {name}
          </button>

          {open === name && (
            <MenuPanel
              onClose={close}
              width={name === "Format" ? 250 : 262}
              /* File's Download and the whole of Format open submenus beside
                 themselves; a scrolling panel would clip them. */
              holdsSubmenus={name === "File" || name === "Format"}
            >
              {name === "File" && (
                <>
                  <MenuItem label="New document" onSelect={actions.onNewDocument} />
                  <MenuItem
                    label="Make a copy"
                    note="A new document with this text, shared with nobody yet."
                    onSelect={actions.onDuplicate}
                  />
                  <MenuSeparator />
                  <MenuItem
                    label="Rename"
                    disabled={!actions.canManage}
                    note={actions.canManage ? undefined : "Only an owner can rename this."}
                    onSelect={actions.onRename}
                  />
                  <MenuItem label="Page setup" onSelect={actions.onPageSetup} />
                  <MenuSeparator />
                  <SubMenu label="Download" icon={<DocIcon.download className="h-3.5 w-3.5" />}>
                    <MenuItem label="Web page (.html)" onSelect={actions.onDownloadHtml} />
                    <MenuItem label="Plain text (.txt)" onSelect={actions.onDownloadText} />
                    <MenuItem label="PDF document (.pdf)" onSelect={actions.onDownloadPdf} />
                    <MenuItem label="Microsoft Word (.docx)" onSelect={actions.onDownloadDocx} />
                    <MenuItem label="Markdown (.md)" onSelect={actions.onDownloadMarkdown} />
                  </SubMenu>
                  <MenuItem label="Print" shortcut="Ctrl P" onSelect={actions.onPrint} />
                  <MenuItem label="Version history" onSelect={actions.onVersionHistory} />
                  <MenuSeparator />
                  <MenuItem
                    label="Move to bin"
                    danger
                    disabled={!actions.canManage}
                    note={
                      actions.canManage
                        ? "Recoverable — it is not destroyed."
                        : "Only an owner can delete this."
                    }
                    onSelect={actions.onDelete}
                  />
                </>
              )}

              {name === "Edit" && (
                <>
                  <MenuItem
                    label="Undo"
                    shortcut="Ctrl Z"
                    disabled={!editor?.can().undo()}
                    onSelect={run((e) => e.chain().focus().undo().run())}
                  />
                  <MenuItem
                    label="Redo"
                    shortcut="Ctrl Y"
                    disabled={!editor?.can().redo()}
                    onSelect={run((e) => e.chain().focus().redo().run())}
                  />
                  <MenuSeparator />
                  <MenuItem
                    label="Select all"
                    shortcut="Ctrl A"
                    onSelect={run((e) => e.chain().focus().selectAll().run())}
                  />
                  <MenuItem label="Find and replace" shortcut="Ctrl F" onSelect={actions.onFind} />
                  <MenuItem
                    label="Voice typing"
                    active={actions.voiceOn}
                    disabled={!can}
                    note="Speak, and the words land at the caret. Chrome and Edge."
                    onSelect={() => actions.onVoiceTyping(!actions.voiceOn)}
                  />
                  <MenuSeparator />
                  {/* Cut, copy and paste are not listed. The browser will not
                      let a page read or write the clipboard from a menu item,
                      so they would be three entries that do nothing — the
                      keyboard shortcuts are the only ones that work, and they
                      already do. That includes Ctrl+Shift+V, paste without
                      formatting, which the editor handles itself — listed in
                      Help → Keyboard shortcuts with the others. */}
                  <MenuItem
                    label="Delete selection"
                    disabled={!can}
                    onSelect={run((e) => e.chain().focus().deleteSelection().run())}
                  />
                </>
              )}

              {name === "View" && (
                <>
                  <MenuItem
                    label="Outline"
                    active={actions.showOutline}
                    onSelect={() => actions.onShowOutline(!actions.showOutline)}
                  />
                  <MenuItem
                    label="Ruler"
                    active={actions.showRuler}
                    onSelect={() => actions.onShowRuler(!actions.showRuler)}
                  />
                  <MenuItem
                    label="Pageless"
                    active={actions.pageless}
                    note="One continuous sheet, as wide as the window. Print still paginates."
                    onSelect={() => actions.onPageless(!actions.pageless)}
                  />
                  <MenuItem
                    label="Page guides"
                    active={actions.showPageGuides}
                    note="Approximate. The printed break can differ."
                    onSelect={() => actions.onShowPageGuides(!actions.showPageGuides)}
                  />
                  <MenuItem
                    label="Review suggestions"
                    active={actions.showSuggestions}
                    note="Every proposed change, with Accept and Reject."
                    onSelect={() => actions.onShowSuggestions(!actions.showSuggestions)}
                  />
                  <MenuItem
                    label="Suggest as I write"
                    active={actions.suggestEnabled}
                    note="Offers to continue a paragraph after a pause. Off by default."
                    onSelect={() => actions.onSuggestEnabled(!actions.suggestEnabled)}
                  />
                  <MenuSeparator />
                  {/* Not "Full screen": the document already is. What this
                      hides is the browser's own tabs and address bar, and
                      naming it after the thing it does is the difference
                      between a control people press once and one they trust. */}
                  <MenuItem
                    label="Hide browser chrome"
                    active={actions.chromeless}
                    shortcut="Esc to exit"
                    onSelect={actions.onChromeless}
                  />
                  {actions.canEdit && (
                    <>
                      <MenuSeparator />
                      <MenuHeading>Mode</MenuHeading>
                      <MenuItem
                        label="Editing"
                        active={actions.mode === "editing"}
                        onSelect={() => actions.onMode("editing")}
                      />
                      <MenuItem
                        label="Suggesting"
                        active={actions.mode === "suggesting"}
                        note="Edits are proposed, shown in colour, and applied only when accepted."
                        onSelect={() => actions.onMode("suggesting")}
                      />
                      <MenuItem
                        label="Viewing"
                        active={actions.mode === "viewing"}
                        onSelect={() => actions.onMode("viewing")}
                      />
                    </>
                  )}
                </>
              )}

              {name === "Insert" && (
                <>
                  <MenuItem label="Image" disabled={!can} onSelect={actions.onInsertImage} />
                  <MenuItem label="Link" shortcut="Ctrl K" disabled={!can} onSelect={actions.onInsertLink} />
                  <MenuItem
                    label="Table"
                    disabled={!can}
                    onSelect={run((e) =>
                      e.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(),
                    )}
                  />
                  <MenuSeparator />
                  <MenuItem
                    label="Horizontal line"
                    disabled={!can}
                    onSelect={run((e) => e.chain().focus().setHorizontalRule().run())}
                  />
                  <MenuItem
                    label="Page break"
                    shortcut="Ctrl Enter"
                    disabled={!can}
                    onSelect={run((e) => e.chain().focus().setPageBreak().run())}
                  />
                  <MenuSeparator />
                  <MenuItem
                    label="Special characters…"
                    disabled={!can}
                    onSelect={actions.onSpecialCharacters}
                  />
                  <MenuSeparator />
                  <MenuItem
                    label="Today's date"
                    disabled={!can}
                    onSelect={run((e) =>
                      e
                        .chain()
                        .focus()
                        .insertContent(
                          new Date().toLocaleDateString(undefined, {
                            day: "numeric",
                            month: "long",
                            year: "numeric",
                          }),
                        )
                        .run(),
                    )}
                  />
                  <MenuItem
                    label="Checklist"
                    disabled={!can}
                    onSelect={run((e) => e.chain().focus().toggleTaskList().run())}
                  />
                  <MenuItem
                    label="Code block"
                    disabled={!can}
                    onSelect={run((e) => e.chain().focus().toggleCodeBlock().run())}
                  />
                  <MenuSeparator />
                  <MenuItem
                    label="Callout"
                    disabled={!can}
                    onSelect={run((e) => e.chain().focus().toggleCallout("note").run())}
                  />
                  <MenuItem
                    label="Toggle"
                    disabled={!can}
                    onSelect={run((e) => e.chain().focus().setDetails().run())}
                  />
                  <MenuItem
                    label="Two columns"
                    disabled={!can}
                    onSelect={run((e) => e.chain().focus().setColumns(2).run())}
                  />
                  <MenuItem
                    label="Three columns"
                    disabled={!can}
                    onSelect={run((e) => e.chain().focus().setColumns(3).run())}
                  />
                  <MenuItem
                    label="Table of contents"
                    disabled={!can}
                    onSelect={run((e) => e.chain().focus().insertTableOfContents().run())}
                  />
                  <MenuSeparator />
                  <MenuItem label="Footnote…" shortcut="Ctrl Alt F" disabled={!can} onSelect={() => actions.onAsk?.("footnote")} />
                  <MenuItem label="Equation…" disabled={!can} onSelect={() => actions.onAsk?.("math")} />
                  <MenuItem label="YouTube video…" disabled={!can} onSelect={() => actions.onAsk?.("youtube")} />
                  <MenuItem label="Embed a page…" disabled={!can} onSelect={() => actions.onAsk?.("embed")} />
                  <MenuItem label="Bookmark…" disabled={!can} onSelect={() => actions.onAsk?.("bookmark")} />
                  <MenuItem label="Attachment…" disabled={!can} note="A file from your computer, kept in Drive." onSelect={() => actions.onAsk?.("attachment")} />
                  <MenuSeparator />
                  <MenuItem label="Date chip" disabled={!can} note="Today, as a chip you can click to change." onSelect={run((e) => e.chain().focus().insertDateChip().run())} />
                  <MenuItem label="Dropdown chip" disabled={!can} note="A status you pick from a list." onSelect={run((e) => e.chain().focus().insertDropdownChip(["Not started", "In progress", "Done"]).run())} />
                  <MenuItem
                    label="Quote"
                    disabled={!can}
                    onSelect={run((e) => e.chain().focus().toggleBlockquote().run())}
                  />
                </>
              )}

              {name === "Format" && (
                <>
                  <SubMenu label="Text">
                    <MenuItem label="Bold" shortcut="Ctrl B" disabled={!can} active={editor?.isActive("bold")} onSelect={run((e) => e.chain().focus().toggleBold().run())} />
                    <MenuItem label="Italic" shortcut="Ctrl I" disabled={!can} active={editor?.isActive("italic")} onSelect={run((e) => e.chain().focus().toggleItalic().run())} />
                    <MenuItem label="Underline" shortcut="Ctrl U" disabled={!can} active={editor?.isActive("underline")} onSelect={run((e) => e.chain().focus().toggleUnderline().run())} />
                    <MenuItem label="Strikethrough" disabled={!can} active={editor?.isActive("strike")} onSelect={run((e) => e.chain().focus().toggleStrike().run())} />
                    <MenuItem label="Superscript" disabled={!can} active={editor?.isActive("superscript")} onSelect={run((e) => e.chain().focus().toggleSuperscript().run())} />
                    <MenuItem label="Subscript" disabled={!can} active={editor?.isActive("subscript")} onSelect={run((e) => e.chain().focus().toggleSubscript().run())} />
                    <MenuItem label="Inline code" disabled={!can} active={editor?.isActive("code")} onSelect={run((e) => e.chain().focus().toggleCode().run())} />
                  </SubMenu>

                  <SubMenu label="Paragraph style">
                    {PARAGRAPH_STYLES.map((s) => (
                      <MenuItem
                        key={s.id}
                        label={s.label}
                        disabled={!can}
                        active={
                          s.level === null
                            ? editor?.isActive("paragraph")
                            : editor?.isActive("heading", { level: s.level })
                        }
                        onSelect={run((e) =>
                          s.level === null
                            ? e.chain().focus().setParagraph().run()
                            : e.chain().focus().setNode("heading", { level: s.level as HeadingLevel }).run(),
                        )}
                      />
                    ))}
                  </SubMenu>

                  <SubMenu label="Align and indent">
                    <MenuItem label="Left" disabled={!can} active={editor?.isActive({ textAlign: "left" })} onSelect={run((e) => e.chain().focus().setTextAlign("left").run())} />
                    <MenuItem label="Centre" disabled={!can} active={editor?.isActive({ textAlign: "center" })} onSelect={run((e) => e.chain().focus().setTextAlign("center").run())} />
                    <MenuItem label="Right" disabled={!can} active={editor?.isActive({ textAlign: "right" })} onSelect={run((e) => e.chain().focus().setTextAlign("right").run())} />
                    <MenuItem label="Justified" disabled={!can} active={editor?.isActive({ textAlign: "justify" })} onSelect={run((e) => e.chain().focus().setTextAlign("justify").run())} />
                    <MenuSeparator />
                    <MenuItem label="Increase indent" disabled={!can} onSelect={run((e) => e.chain().focus().indentBlocks(1).run())} />
                    <MenuItem label="Decrease indent" disabled={!can} onSelect={run((e) => e.chain().focus().indentBlocks(-1).run())} />
                  </SubMenu>

                  <SubMenu label="Line spacing">
                    {LINE_SPACINGS.map((s) => (
                      <MenuItem
                        key={s.value}
                        label={s.label}
                        disabled={!can}
                        onSelect={run((e) => e.chain().focus().setLineSpacing(s.value).run())}
                      />
                    ))}
                  </SubMenu>

                  <SubMenu label="Bullets and numbering">
                    <MenuItem label="Bulleted list" disabled={!can} active={editor?.isActive("bulletList")} onSelect={run((e) => e.chain().focus().toggleBulletList().run())} />
                    <MenuItem label="Numbered list" disabled={!can} active={editor?.isActive("orderedList")} onSelect={run((e) => e.chain().focus().toggleOrderedList().run())} />
                    <MenuItem label="Checklist" disabled={!can} active={editor?.isActive("taskList")} onSelect={run((e) => e.chain().focus().toggleTaskList().run())} />
                  </SubMenu>

                  <SubMenu label="Text direction">
                    <MenuItem
                      label="Left to right"
                      disabled={!can}
                      active={!!editor && editor.getAttributes("paragraph").dir !== "rtl" && editor.getAttributes("heading").dir !== "rtl"}
                      onSelect={run((e) => e.chain().focus().setTextDirection(null).run())}
                    />
                    <MenuItem
                      label="Right to left"
                      shortcut="Ctrl Shift X"
                      disabled={!can}
                      active={!!editor && (editor.getAttributes("paragraph").dir === "rtl" || editor.getAttributes("heading").dir === "rtl")}
                      onSelect={run((e) => e.chain().focus().setTextDirection("rtl").run())}
                    />
                  </SubMenu>

                  {/* Docs' Format → Text → Capitalisation. The transform walks
                      the selection's text nodes and replaces each with the
                      same marks it had, so bold, links and comments survive —
                      see `applyCase` for why Title Case has no clever list of
                      small words. */}
                  <SubMenu label="Capitalisation">
                    {CASE_MODES.map((mode) => (
                      <MenuItem
                        key={mode}
                        label={CASE_LABELS[mode]}
                        disabled={!can}
                        onSelect={run((e) =>
                          e
                            .chain()
                            .focus()
                            .command(({ state, tr, dispatch }) => {
                              const { from, to } = state.selection;
                              if (from === to) return false;
                              if (!dispatch) return true;
                              state.doc.nodesBetween(from, to, (node, pos) => {
                                if (!node.isText || !node.text) return;
                                const start = Math.max(from, pos);
                                const end = Math.min(to, pos + node.nodeSize);
                                const slice = node.text.slice(
                                  start - pos,
                                  end - pos,
                                );
                                const next = applyCase(slice, mode);
                                if (next === slice) return;
                                tr.replaceWith(
                                  tr.mapping.map(start),
                                  tr.mapping.map(end),
                                  state.schema.text(next, node.marks),
                                );
                              });
                              dispatch(tr);
                              return true;
                            })
                            .run(),
                        )}
                      />
                    ))}
                  </SubMenu>

                  <MenuSeparator />
                  <MenuItem
                    label="Clear formatting"
                    shortcut={"Ctrl \\"}
                    disabled={!can}
                    onSelect={run((e) => e.chain().focus().unsetAllMarks().clearNodes().run())}
                  />
                </>
              )}

              {name === "Tools" && (
                <>
                  <MenuItem label="Word count" shortcut="Ctrl Shift C" onSelect={actions.onWordCount} />
                  <MenuItem
                    label="Spelling check"
                    active={actions.spellcheck}
                    note="Your browser's dictionary, not the server's."
                    onSelect={() => actions.onSpellcheck(!actions.spellcheck)}
                  />
                  <MenuItem label="Find and replace" shortcut="Ctrl F" onSelect={actions.onFind} />
                </>
              )}

              {name === "Help" && (
                <>
                  <MenuItem label="Keyboard shortcuts" shortcut="Ctrl /" onSelect={actions.onShortcuts} />
                </>
              )}
            </MenuPanel>
          )}
        </div>
      ))}
    </div>
  );
}
