"use client";

import { useEffect, useRef, useState } from "react";
import { useEditorState, type Editor } from "@tiptap/react";
import { DocIcon } from "./DocsIcons";
import { MenuHeading, MenuItem, MenuPanel, MenuSeparator, SubMenu } from "./DocsMenu";
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
  onPrint: () => void;
  onPageSetup: () => void;
  onDelete: () => void;
  canManage: boolean;

  onFind: () => void;
  onInsertLink: () => void;
  onInsertImage: () => void;
  onWordCount: () => void;
  onShortcuts: () => void;

  showOutline: boolean;
  onShowOutline: (value: boolean) => void;
  showRuler: boolean;
  onShowRuler: (value: boolean) => void;
  showPageGuides: boolean;
  onShowPageGuides: (value: boolean) => void;
  fullScreen: boolean;
  onFullScreen: () => void;
  spellcheck: boolean;
  onSpellcheck: (value: boolean) => void;

  mode: "editing" | "viewing";
  onMode: (mode: "editing" | "viewing") => void;
  canEdit: boolean;
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
  const can = actions.canEdit && actions.mode === "editing" && !!editor;
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
                  </SubMenu>
                  <MenuItem label="Print" shortcut="Ctrl P" onSelect={actions.onPrint} />
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
                  <MenuSeparator />
                  {/* Cut, copy and paste are not listed. The browser will not
                      let a page read or write the clipboard from a menu item,
                      so they would be three entries that do nothing — the
                      keyboard shortcuts are the only ones that work, and they
                      already do. */}
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
                    label="Page guides"
                    active={actions.showPageGuides}
                    note="Approximate. The printed break can differ."
                    onSelect={() => actions.onShowPageGuides(!actions.showPageGuides)}
                  />
                  <MenuSeparator />
                  <MenuItem
                    label="Full screen"
                    active={actions.fullScreen}
                    shortcut="Esc to exit"
                    onSelect={actions.onFullScreen}
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
