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
 * ## The branches, and why they open sideways
 *
 * A manager's team opens as its own COLUMN to the right, not as rows pushed in
 * underneath. Nested inline, a chief with six reports shoved everybody below
 * them down by six rows, so opening one branch to look at it moved every other
 * branch out from under the pointer, and two open branches at different depths
 * left you reading indentation to work out who reported to whom. Side by side,
 * each column holds one team, the rows you were reading stay exactly where they
 * were, and the chain of columns on screen *is* the reporting line.
 *
 * The arrow sits at the row's right edge, on the side the team appears on, so
 * the control points at what it does.
 *
 * The expander is a SEPARATE control from the name: pressing the arrow opens
 * the team, pressing the name selects that person. Conflating the two is the
 * usual failure of a tree picker — every attempt to look inside a manager's
 * team silently changes what the table below is showing, so you cannot browse
 * the structure without disturbing the answer.
 *
 * A leaf gets a spacer of exactly the arrow's width rather than nothing, so the
 * task counts line up down the column whether or not that person manages
 * anybody.
 *
 * ## Which teams are open
 *
 * Opened onto the current selection when the menu opens — `pathTo` names the
 * people whose teams have to be showing for it to be on screen. A chief who
 * picked somebody four levels down and came back to a collapsed tree would
 * otherwise find no trace of their own selection.
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
  /**
   * The chain of managers whose teams are on screen, root first.
   *
   * A PATH, not a set of expanded ids, because the teams no longer nest inside
   * one another — each is its own column beside its parent, so exactly one team
   * can show per level, and a set would let two of them claim the same slot.
   */
  const [openPath, setOpenPath] = useState<string[]>([]);
  const rootRef = useRef<HTMLDivElement>(null);

  /* Open onto the current selection, every time the menu opens — including
     onto nothing when there is no selection, so a menu reopened after picking
     All members does not still stand three columns deep in somebody's team.
     `pathTo` ends at the person themselves and it is their MANAGERS whose
     teams have to be showing, hence dropping the last id. */
  useEffect(() => {
    if (!open) return;
    const path = value ? pathTo(nodes, value) : [];
    setOpenPath(path.length > 1 ? path.slice(0, -1) : []);
  }, [open, value, nodes]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      e.preventDefault();
      /* Escape closes the deepest column first and only then the menu:
         stepping back out the way you came in. Collapsing the whole thing on
         the first press throws away a path that took four presses to build. */
      setOpenPath((p) => {
        if (p.length > 0) return p.slice(0, -1);
        setOpen(false);
        /* Focus goes back to the trigger; a menu that closes into nowhere
           drops a keyboard user at the top of the document. */
        rootRef.current?.querySelector("button")?.focus();
        return p;
      });
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  const selected = value ? findPerson(nodes, value) : null;
  const label = selected ? selected.name : "All members";
  const count = selected ? selected.count : totalCount;

  /* The columns on screen, resolved from the path each render rather than
     stored. Walking it stops at the first id that no longer names a manager at
     that level, so a path left stale by a change in `nodes` degrades to the
     columns that are still real instead of rendering an empty one. */
  const columns: { parent: PersonNode | null; nodes: PersonNode[] }[] = [
    { parent: null, nodes },
  ];
  for (const id of openPath) {
    const here = columns[columns.length - 1].nodes.find((n) => n.id === id);
    if (!here || here.children.length === 0) break;
    columns.push({ parent: here, nodes: here.children });
  }

  const pick = (id: string) => {
    onChange(id);
    setOpen(false);
  };

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
          {/* The columns are SIBLINGS in one strip, not children of the column
              that opened them: each column scrolls its own overflow, and a
              child would be clipped by that scroll box the moment its parent
              column was long enough to need one.

              The strip scrolls sideways so a deep chain stays reachable rather
              than running off the right edge. Its 4px padding is what gives the
              shadows room inside that scroll box, and the matching -4px left
              keeps the first column flush with the trigger. */}
          <div className="absolute -left-1 top-full z-50 flex max-w-[calc(100vw-1.5rem)] items-start gap-1 overflow-x-auto p-1">
            {columns.map((col, level) => (
              <ul
                key={col.parent ? col.parent.id : "root"}
                role="listbox"
                aria-label={
                  col.parent
                    ? `${col.parent.name}'s team`
                    : "Whose tasks to show"
                }
                className="max-h-[360px] w-[240px] shrink-0 overflow-y-auto rounded-xl border border-hairline bg-[var(--surface-raised)] p-1 shadow-lg"
              >
                {/* The resting state, and always first: the way back out of a
                    filter has to be as reachable as the way in. Only in the
                    root column — it clears the filter entirely, which is not a
                    thing a team belongs to. */}
                {!col.parent && (
                  <>
                    <li role="option" aria-selected={value === ALL_MEMBERS}>
                      <button
                        type="button"
                        onClick={() => pick(ALL_MEMBERS)}
                        className={`flex w-full items-center justify-between gap-3 rounded-lg px-2.5 py-1.5 text-left text-sm transition-colors ${
                          value === ALL_MEMBERS
                            ? "bg-[var(--control)] text-ink"
                            : "text-ink-muted hover:bg-[var(--control)] hover:text-ink"
                        }`}
                      >
                        <span className="truncate">All members</span>
                        <span
                          data-figure
                          className="shrink-0 text-xs text-ink-faint"
                        >
                          {totalCount}
                        </span>
                      </button>
                    </li>
                    {nodes.length > 0 && (
                      <li aria-hidden className="my-1 h-px bg-hairline" />
                    )}
                  </>
                )}

                {col.nodes.map((n) => (
                  <PersonRow
                    key={n.id}
                    node={n}
                    value={value}
                    isOpen={openPath[level] === n.id}
                    onOpen={() =>
                      setOpenPath((p) =>
                        /* Pressing the open branch's own arrow closes it, and
                           anything deeper with it — that column is gone, so the
                           ones it was holding up cannot stay. */
                        p[level] === n.id
                          ? p.slice(0, level)
                          : [...p.slice(0, level), n.id],
                      )
                    }
                    onPick={pick}
                  />
                ))}
              </ul>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function PersonRow({
  node,
  value,
  isOpen,
  onOpen,
  onPick,
}: {
  node: PersonNode;
  value: string;
  /** This row's team is the column showing to its right. */
  isOpen: boolean;
  onOpen: () => void;
  onPick: (id: string) => void;
}) {
  const hasChildren = node.children.length > 0;
  const selected = node.id === value;

  return (
    <li role="option" aria-selected={selected}>
      {/* A row, not a button: the expander and the name are two controls and a
          button inside a button is invalid HTML that browsers flatten. */}
      <div className="flex items-center gap-0.5">
        <button
          type="button"
          onClick={() => onPick(node.id)}
          className={`flex min-w-0 flex-1 items-center justify-between gap-3 rounded-lg px-2.5 py-1.5 text-left text-sm transition-colors ${
            selected
              ? "bg-[var(--control)] text-ink"
              : isOpen
                ? /* On the open path: lifted out of the muted rows so the
                     reporting line reads across the columns, but without the
                     selected row's fill — being open is not being chosen. */
                  "text-ink hover:bg-[var(--control)]"
                : "text-ink-muted hover:bg-[var(--control)] hover:text-ink"
          }`}
        >
          <span className="truncate">{node.name}</span>
          <span data-figure className="shrink-0 text-xs text-ink-faint">
            {node.count}
          </span>
        </button>

        {hasChildren ? (
          <button
            type="button"
            aria-label={
              isOpen ? `Hide ${node.name}'s team` : `Show ${node.name}'s team`
            }
            aria-haspopup="listbox"
            aria-expanded={isOpen}
            onClick={onOpen}
            className={`grid h-6 w-6 shrink-0 place-items-center rounded transition-colors ${
              isOpen
                ? "bg-[var(--control)] text-ink"
                : "text-ink-faint hover:bg-[var(--control)] hover:text-ink"
            }`}
          >
            {/* No rotation on open. The arrow points at where the team appears,
                and it appears to the right open or shut; turning it down would
                point at rows belonging to somebody else. */}
            <Icon.chevronRight aria-hidden className="h-3.5 w-3.5" />
          </button>
        ) : (
          /* Exactly the expander's width, so the counts line up whether or not
             the person manages anybody. */
          <span aria-hidden className="h-6 w-6 shrink-0" />
        )}
      </div>
    </li>
  );
}
