"use client";

import { useEffect, useRef } from "react";
import { Icon } from "@/components/ui/Icons";
import { childrenOf, rootOf, type MindMap, type MindNodeId } from "@/lib/rules/mindmap/tree";
import type { MindMapCanvasHandlers } from "./MindMapCanvas";

/**
 * The map as an outline — every card as an indented row you can type into.
 *
 * Some people think in lists and draw later; every mindmap tool has this view
 * for them. It is the same tree the canvas draws, edited through the same
 * handlers, so nothing here can disagree with the picture: type in a row and
 * the card changes, press Tab and the card indents, exactly as on the canvas.
 *
 * ## Keys, in the row
 *
 *  Enter        a sibling below (and the caret moves to it)
 *  Tab / ⇧Tab   indent under the row above / outdent
 *  ↑ ↓          previous / next row
 *  Alt ↑ / ↓    move among siblings
 *  Backspace    on an empty title, delete the card
 *  Space        (with Ctrl) fold or unfold
 *
 * Selection is shared with the canvas: the row for the selected card is
 * highlighted, and choosing a row selects the card on the canvas too.
 */
export function MindMapOutline({
  map,
  selectedId,
  numbering,
  readOnly,
  handlers,
}: {
  map: MindMap;
  selectedId: MindNodeId | null;
  numbering: Map<MindNodeId, string>;
  readOnly: boolean;
  handlers: MindMapCanvasHandlers;
}) {
  const root = rootOf(map);
  /* The rows in reading order, with depth — the same order arrows walk. */
  const rows: { id: MindNodeId; depth: number }[] = [];
  const walk = (id: MindNodeId, depth: number) => {
    rows.push({ id, depth });
    const node = map.nodes.find((n) => n.id === id);
    if (!node || node.collapsed) return;
    for (const c of childrenOf(map, id)) walk(c.id, depth + 1);
  };
  if (root) walk(root.id, 0);

  /* Keep the selected row's input in reach: after Enter or Tab creates or
     moves a card, the caret follows the selection into the new row. */
  const inputs = useRef(new Map<string, HTMLInputElement>());
  const wantFocus = useRef<string | null>(null);
  useEffect(() => {
    const id = wantFocus.current;
    if (!id) return;
    const el = inputs.current.get(id);
    if (el) {
      el.focus();
      el.select();
      wantFocus.current = null;
    }
  });

  const focusAfter = (id: MindNodeId | null) => {
    if (id) wantFocus.current = id;
  };

  const onKey = (e: React.KeyboardEvent<HTMLInputElement>, id: MindNodeId, index: number) => {
    const node = map.nodes.find((n) => n.id === id);
    if (!node) return;
    if (e.key === "Enter") {
      e.preventDefault();
      if (readOnly) return;
      focusAfter(handlers.onAddSibling(id));
    } else if (e.key === "Tab") {
      e.preventDefault();
      if (readOnly) return;
      if (e.shiftKey) handlers.onOutdent(id);
      else handlers.onIndent(id);
      focusAfter(id);
    } else if (e.key === "ArrowUp" && e.altKey) {
      e.preventDefault();
      if (!readOnly) handlers.onMoveSibling(id, -1);
      focusAfter(id);
    } else if (e.key === "ArrowDown" && e.altKey) {
      e.preventDefault();
      if (!readOnly) handlers.onMoveSibling(id, 1);
      focusAfter(id);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      const prev = rows[index - 1];
      if (prev) {
        handlers.onSelect(prev.id);
        focusAfter(prev.id);
      }
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      const next = rows[index + 1];
      if (next) {
        handlers.onSelect(next.id);
        focusAfter(next.id);
      }
    } else if (e.key === "Backspace" && node.title === "" && node.parentId !== null) {
      e.preventDefault();
      if (readOnly) return;
      const prev = rows[index - 1];
      handlers.onDelete(id);
      if (prev) {
        handlers.onSelect(prev.id);
        focusAfter(prev.id);
      }
    } else if (e.key === " " && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      if (!readOnly) handlers.onToggleCollapsed(id);
    } else if (e.key === "Escape") {
      (e.currentTarget as HTMLInputElement).blur();
    }
  };

  return (
    <aside
      aria-label="Outline"
      className="frost-panel flex h-full min-h-0 w-full flex-col rounded-card border border-hairline"
    >
      <header className="flex shrink-0 items-center gap-2 border-b border-hairline px-4 py-3">
        <span className="min-w-0 flex-1 text-sm font-medium text-ink">Outline</span>
        <span className="text-[11px] text-ink-faint">
          Enter adds · Tab indents · Alt-arrows reorder
        </span>
      </header>
      <ol className="min-h-0 flex-1 overflow-y-auto py-2 scroll-slim" role="tree">
        {rows.map(({ id, depth }, index) => {
          const node = map.nodes.find((n) => n.id === id)!;
          const kids = childrenOf(map, id).length;
          const selected = id === selectedId;
          const number = numbering.get(id);
          return (
            <li
              key={id}
              role="treeitem"
              aria-level={depth + 1}
              aria-selected={selected}
              aria-expanded={kids > 0 ? !node.collapsed : undefined}
              className={`flex items-center gap-1.5 py-[3px] pr-3 ${selected ? "bg-[var(--control-active)]" : "hover:bg-[var(--control)]"}`}
              style={{ paddingLeft: 10 + depth * 18 }}
            >
              {/* The fold chevron takes the space whether or not there is one,
                  so titles at one depth line up. */}
              <button
                type="button"
                tabIndex={-1}
                aria-label={kids > 0 ? (node.collapsed ? `Unfold ${kids}` : "Fold") : undefined}
                onClick={() => kids > 0 && !readOnly && handlers.onToggleCollapsed(id)}
                className={`grid h-5 w-5 shrink-0 place-items-center rounded-inset text-ink-faint ${
                  kids > 0 ? "hover:bg-[var(--control-hover)] hover:text-ink" : "invisible"
                }`}
              >
                {node.collapsed ? <Icon.chevronRight className="h-3 w-3" /> : <Icon.chevronDown className="h-3 w-3" />}
              </button>
              {number && (
                <span className="shrink-0 font-mono text-[11px] text-ink-faint tabular-nums" data-figure>
                  {number}
                </span>
              )}
              {node.icon && <span className="shrink-0 text-[13px]" aria-hidden="true">{node.icon}</span>}
              <input
                ref={(el) => {
                  if (el) inputs.current.set(id, el);
                  else inputs.current.delete(id);
                }}
                value={node.title}
                readOnly={readOnly}
                onFocus={() => {
                  if (!selected) handlers.onSelect(id);
                }}
                onChange={(e) => handlers.onRename(id, e.target.value)}
                onKeyDown={(e) => onKey(e, id, index)}
                placeholder="Untitled"
                aria-label={`Card at level ${depth + 1}`}
                className={`min-w-0 flex-1 bg-transparent text-[13px] leading-snug outline-none placeholder:text-ink-faint ${
                  depth === 0 ? "font-medium text-ink" : "text-ink"
                }`}
                style={{ fontWeight: node.style?.bold ? 600 : undefined }}
              />
              {node.collapsed && kids > 0 && (
                <span className="shrink-0 text-[10px] text-ink-faint" data-figure>
                  {kids}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </aside>
  );
}
