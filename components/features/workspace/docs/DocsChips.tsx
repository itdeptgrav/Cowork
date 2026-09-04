"use client";

/**
 * The popover a smart chip opens — a date picker for a date chip, the
 * option list (and a way to edit it) for a dropdown chip. The chip itself is
 * plain DOM inside the editor; this writes the choice back as the node's
 * attributes, so the change is one undoable step and reaches collaborators
 * like any other edit.
 */

import { useEffect, useRef, useState } from "react";
import type { Editor } from "@tiptap/core";
import type { ChipClickDetail } from "@/lib/documents/extensions/chips";

export function DocsChipPopover({ editor, chip, onClose }: { editor: Editor; chip: ChipClickDetail; onClose: () => void }) {
  const box = useRef<HTMLDivElement>(null);
  const [editingOptions, setEditingOptions] = useState(false);
  const [optionsDraft, setOptionsDraft] = useState(() => ((chip.attrs.options as string[] | undefined) ?? []).join("\n"));

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", onDown, true);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown, true);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const write = (attrs: Record<string, unknown>) => {
    const node = editor.state.doc.nodeAt(chip.pos);
    if (!node || node.type.name !== chip.kind) {
      onClose();
      return;
    }
    editor.view.dispatch(editor.state.tr.setNodeMarkup(chip.pos, undefined, { ...node.attrs, ...attrs }));
    editor.commands.focus();
  };

  const remove = () => {
    const node = editor.state.doc.nodeAt(chip.pos);
    if (node && node.type.name === chip.kind) editor.view.dispatch(editor.state.tr.delete(chip.pos, chip.pos + node.nodeSize));
    onClose();
  };

  const top = Math.min(chip.rect.bottom + 6, (typeof window !== "undefined" ? window.innerHeight : 800) - 240);
  const left = Math.max(8, Math.min(chip.rect.left, (typeof window !== "undefined" ? window.innerWidth : 1200) - 260));

  return (
    <div
      ref={box}
      role="dialog"
      aria-label={chip.kind === "dateChip" ? "Pick a date" : "Choose an option"}
      className="fixed z-50 w-[240px] rounded-card border border-hairline bg-[var(--surface-raised)] p-2 text-[12.5px] text-ink shadow-[var(--shadow-deck-seat)]"
      style={{ top, left }}
    >
      {chip.kind === "dateChip" && (
        <div className="flex flex-col gap-2">
          <input
            type="date"
            autoFocus
            defaultValue={String(chip.attrs.date ?? "")}
            onChange={(e) => {
              if (e.target.value) write({ date: e.target.value });
            }}
            className="h-8 rounded-inset border border-hairline bg-transparent px-2 text-[12.5px] text-ink outline-none"
          />
          <div className="flex items-center justify-between">
            <button type="button" className="rounded-full px-2 py-1 text-[12px] text-ink-muted hover:bg-[var(--control)] hover:text-ink" onClick={remove}>
              Remove chip
            </button>
            <button type="button" className="rounded-full bg-[var(--control)] px-3 py-1 text-[12px] font-medium text-ink hover:bg-[var(--control-hover)]" onClick={onClose}>
              Done
            </button>
          </div>
        </div>
      )}
      {chip.kind === "dropdownChip" && !editingOptions && (
        <div className="flex flex-col gap-0.5">
          {((chip.attrs.options as string[] | undefined) ?? []).map((opt) => (
            <button
              key={opt}
              type="button"
              className={`rounded-inset px-2 py-1 text-left hover:bg-[var(--control)] ${opt === chip.attrs.value ? "bg-[var(--control-active)] font-medium" : ""}`}
              onClick={() => {
                write({ value: opt });
                onClose();
              }}
            >
              {opt}
            </button>
          ))}
          <div className="mt-1 flex items-center justify-between border-t border-hairline pt-1.5">
            <button type="button" className="rounded-full px-2 py-1 text-[12px] text-ink-muted hover:bg-[var(--control)] hover:text-ink" onClick={remove}>
              Remove chip
            </button>
            <button type="button" className="rounded-full px-2 py-1 text-[12px] text-ink-muted hover:bg-[var(--control)] hover:text-ink" onClick={() => setEditingOptions(true)}>
              Edit options…
            </button>
          </div>
        </div>
      )}
      {chip.kind === "dropdownChip" && editingOptions && (
        <div className="flex flex-col gap-2">
          <label className="flex flex-col gap-1">
            <span className="text-[11px] text-ink-muted">One option per line</span>
            <textarea
              autoFocus
              value={optionsDraft}
              onChange={(e) => setOptionsDraft(e.target.value)}
              rows={5}
              className="rounded-inset border border-hairline bg-transparent px-2 py-1 text-[12.5px] text-ink outline-none"
            />
          </label>
          <div className="flex items-center justify-end gap-1">
            <button type="button" className="rounded-full px-2 py-1 text-[12px] text-ink-muted hover:bg-[var(--control)] hover:text-ink" onClick={() => setEditingOptions(false)}>
              Cancel
            </button>
            <button
              type="button"
              className="rounded-full bg-[var(--control)] px-3 py-1 text-[12px] font-medium text-ink hover:bg-[var(--control-hover)]"
              onClick={() => {
                const options = optionsDraft
                  .split("\n")
                  .map((s) => s.trim())
                  .filter(Boolean);
                if (options.length === 0) return;
                const value = options.includes(String(chip.attrs.value)) ? chip.attrs.value : options[0];
                write({ options, value });
                onClose();
              }}
            >
              Save
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
