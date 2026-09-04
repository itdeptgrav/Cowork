"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/ui/Icons";
import {
  ALL_MEMBERS,
  findPerson,
  pathTo,
  type PersonNode,
} from "@/lib/rules/tasks/peopleFilter";

/**
 * Whose tasks the list is showing.
 *
 * ## What this replaces, and why it is not a mode
 *
 * A Task-wise / Person-wise segmented control sat here. Person-wise did one
 * thing — it revealed a dropdown — so the switch was a step whose only purpose
 * was to uncover a control, and the reader had to know that before they could
 * reach the thing they actually wanted. The dropdown is simply here now.
 * **All members** is the resting state and is what the list opens on, so
 * nothing is hidden behind a mode and there is no state to switch back out of.
 *
 * ## The branches
 *
 * For a chief the list is nested, and the expander is a SEPARATE control from
 * the name: pressing the arrow opens the branch, pressing the name selects
 * that person. Conflating the two is the usual failure of a tree picker —
 * every attempt to look inside a manager's team silently changes what the
 * table below is showing, so you cannot browse the structure without
 * disturbing the answer.
 *
 * A leaf gets a spacer of exactly the arrow's width rather than nothing, so
 * every name at one level starts at the same x. Without it the names jitter
 * left and right by 18px depending on whether that person happens to manage
 * anybody, and the column stops being scannable.
 *
 * ## Which branches are open
 *
 * Opened onto the current selection when the menu opens — `pathTo` names the
 * branches that have to be open for it to be on screen. A chief who picked
 * somebody four levels down and came back to a collapsed tree would otherwise
 * find no trace of their own selection.
 */
export function PersonFilter({
  nodes,
  value,
  onChange,
  /** Total tasks in the unfiltered list, shown against All members. */
  totalCount,
}: {
  nodes: PersonNode[];
  value: string;
  onChange: (id: string) => void;
  totalCount: number;
}) {
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const rootRef = useRef<HTMLDivElement>(null);

  /* Open the branches that reveal the selection, each time the menu opens. */
  useEffect(() => {
    if (!open || !value) return;
    const path = pathTo(nodes, value);
    if (path.length > 1)
      setExpanded((s) => new Set([...s, ...path.slice(0, -1)]));
  }, [open, value, nodes]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      e.preventDefault();
      setOpen(false);
      /* Focus goes back to the trigger; a menu that closes into nowhere drops
         a keyboard user at the top of the document. */
      rootRef.current?.querySelector("button")?.focus();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  const selected = value ? findPerson(nodes, value) : null;
  const label = selected ? selected.name : "All members";
  const count = selected ? selected.count : totalCount;

  return (
    <div className="relative" ref={rootRef}>
      <button
        type="button"
        aria-label="Whose tasks to show"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex h-8 max-w-[220px] items-center gap-1.5 rounded-full bg-[var(--surface-sunken)] pr-2.5 pl-3.5 text-sm text-ink transition-colors hover:bg-[var(--control)] focus:outline-none focus-visible:ring-2 focus-visible:ring-ink"
      >
        <span className="truncate">
          {label}
          <span data-figure> ({count})</span>
        </span>
        <span className="shrink-0 text-ink-faint">
          <Icon.chevronDown />
        </span>
      </button>

      {open && (
        <>
          {/* Catches an outside click to close, the way the app's other menus
              do. */}
          <button
            type="button"
            aria-hidden
            tabIndex={-1}
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-40 cursor-default"
          />
          <ul
            role="listbox"
            aria-label="Whose tasks to show"
            className="absolute left-0 z-50 mt-1 max-h-[360px] w-[280px] overflow-auto rounded-xl border border-hairline bg-[var(--surface-raised)] p-1 shadow-lg"
          >
            {/* The resting state, and always first: the way back out of a
                filter has to be as reachable as the way in. */}
            <li role="option" aria-selected={value === ALL_MEMBERS}>
              <button
                type="button"
                onClick={() => {
                  onChange(ALL_MEMBERS);
                  setOpen(false);
                }}
                className={`flex w-full items-center justify-between gap-3 rounded-lg px-2.5 py-1.5 text-left text-sm transition-colors ${
                  value === ALL_MEMBERS
                    ? "bg-[var(--control)] text-ink"
                    : "text-ink-muted hover:bg-[var(--control)] hover:text-ink"
                }`}
              >
                <span className="truncate">All members</span>
                <span data-figure className="shrink-0 text-xs text-ink-faint">
                  {totalCount}
                </span>
              </button>
            </li>

            {nodes.length > 0 && (
              <li aria-hidden className="my-1 h-px bg-hairline" />
            )}

            {nodes.map((n) => (
              <PersonRow
                key={n.id}
                node={n}
                depth={0}
                value={value}
                expanded={expanded}
                onToggle={(id) =>
                  setExpanded((s) => {
                    const next = new Set(s);
                    if (next.has(id)) next.delete(id);
                    else next.add(id);
                    return next;
                  })
                }
                onPick={(id) => {
                  onChange(id);
                  setOpen(false);
                }}
              />
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function PersonRow({
  node,
  depth,
  value,
  expanded,
  onToggle,
  onPick,
}: {
  node: PersonNode;
  depth: number;
  value: string;
  expanded: Set<string>;
  onToggle: (id: string) => void;
  onPick: (id: string) => void;
}) {
  const hasChildren = node.children.length > 0;
  const isOpen = expanded.has(node.id);
  const selected = node.id === value;

  return (
    <li role="option" aria-selected={selected}>
      {/* A row, not a button: the expander and the name are two controls and a
          button inside a button is invalid HTML that browsers flatten. */}
      <div
        className="flex items-center"
        style={{ paddingInlineStart: depth * 14 }}
      >
        {hasChildren ? (
          <button
            type="button"
            aria-label={isOpen ? `Hide ${node.name}'s team` : `Show ${node.name}'s team`}
            aria-expanded={isOpen}
            onClick={() => onToggle(node.id)}
            className="grid h-6 w-6 shrink-0 place-items-center rounded text-ink-faint transition-colors hover:bg-[var(--control)] hover:text-ink"
          >
            <Icon.chevronRight
              aria-hidden
              className={`h-3.5 w-3.5 transition-transform duration-[180ms] ${
                isOpen ? "rotate-90" : ""
              }`}
            />
          </button>
        ) : (
          /* Exactly the expander's width, so names line up whether or not the
             person manages anybody. */
          <span aria-hidden className="h-6 w-6 shrink-0" />
        )}

        <button
          type="button"
          onClick={() => onPick(node.id)}
          className={`flex min-w-0 flex-1 items-center justify-between gap-3 rounded-lg px-2 py-1.5 text-left text-sm transition-colors ${
            selected
              ? "bg-[var(--control)] text-ink"
              : "text-ink-muted hover:bg-[var(--control)] hover:text-ink"
          }`}
        >
          <span className="truncate">{node.name}</span>
          <span data-figure className="shrink-0 text-xs text-ink-faint">
            {node.count}
          </span>
        </button>
      </div>

      {hasChildren && isOpen && (
        <ul role="group" aria-label={`${node.name}'s team`}>
          {node.children.map((c) => (
            <PersonRow
              key={c.id}
              node={c}
              depth={depth + 1}
              value={value}
              expanded={expanded}
              onToggle={onToggle}
              onPick={onPick}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

