"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Icon } from "@/components/ui/Icons";
import {
  ALL_MEMBERS,
  findPerson,
  pathTo,
  type PersonNode,
} from "@/lib/rules/tasks/peopleFilter";
import { branchColumnTop } from "@/lib/rules/tasks/branchColumn";

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
/**
 * One row frame, shared by every option in the menu.
 *
 * **The wash is on this wrapper, not on the button inside it.** That is the
 * whole trick, and it took three goes to find. Put the background on the name
 * button and the 24px arrow slot beside it takes width from the highlighted
 * surface — so every row's fill stopped 27px short of the panel's right edge
 * while starting 1px from its left, and a lopsided fill is what the eye reads
 * as a broken width. On the wrapper, the fill spans the panel's full inner box
 * and the slot costs nothing, because the slot is inside the thing being
 * filled. It is what roughly twenty rows in this codebase already do —
 * `MindMapOutline`'s tree row is the closest twin, wash on the `<li>` and the
 * fold chevron a `shrink-0` sibling.
 *
 * `pl-2.5` + `gap-2` + `pr-1` puts every count 36px from the row's right edge,
 * derived from the arrow's own 24px box rather than restated as a number the
 * arrow has to be kept in step with.
 */
const ROW =
  "flex items-center gap-2 rounded-lg pr-1 pl-2.5 text-sm transition-colors";

/**
 * The name, inside that frame. No background, no radius, no side padding of
 * its own — all three belong to the wrapper now, or the fill comes back inset.
 */
const ROW_NAME =
  "flex min-w-0 flex-1 items-center justify-between gap-3 py-1.5 text-left focus:outline-none";

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
  const stripRef = useRef<HTMLDivElement>(null);
  /**
   * How far each team's column is pushed down, to sit level with its own row.
   *
   * Indexed by column, so `tops[1]` belongs to the first team opened. Measured
   * rather than derived: the row's position depends on how many people are
   * above it, how far its column is scrolled and how much the column above
   * that was itself pushed down — none of which is known until it is drawn.
   */
  const [tops, setTops] = useState<number[]>([]);

  /* Opening the menu opens it onto the current selection — including onto
     nothing when there is none, so a menu reopened after picking All members
     does not still stand three columns deep in somebody's team. `pathTo` ends
     at the person themselves and it is their MANAGERS whose teams have to be
     showing, hence dropping the last id.

     In the event rather than an effect keyed on `open`: this is a thing that
     happens when somebody presses the button, not state to be kept in step
     with something outside React, and as an effect it re-rendered twice on
     every open — the second time only to move the columns. */
  function openOnto() {
    const path = value ? pathTo(nodes, value) : [];
    setOpenPath(path.length > 1 ? path.slice(0, -1) : []);
    setOpen(true);
  }

  /**
   * Keep the strip inside the window, and the newest column inside the strip.
   *
   * The strip is anchored to the trigger's left edge and grows rightwards, so
   * how much room it has depends on where in the toolbar the trigger sits —
   * something no CSS max-width can know. Measured here instead: at 768px the
   * third column ran off the right of the screen and took the page's own
   * horizontal scrollbar with it.
   *
   * Then `scrollLeft` to the end, because a column you just opened and cannot
   * see reads as a control that did nothing.
   */
  useEffect(() => {
    if (!open) return;
    function fit() {
      const el = stripRef.current;
      if (!el) return;
      /* Left-anchored, so its own width does not move this. */
      const left = el.getBoundingClientRect().left;
      el.style.maxWidth = `${Math.max(240, document.documentElement.clientWidth - left - 12)}px`;
      el.scrollLeft = el.scrollWidth;
    }
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, [open, openPath]);

  /**
   * Put each team's column level with the row that opened it.
   *
   * **Every column used to start at the panel's top.** So a team opened from a
   * name near the bottom of a long list appeared beside names it has nothing
   * to do with, a whole list-height from its own row — and the one thing the
   * columns exist to show, who reports to whom, was the one thing the layout
   * did not say.
   *
   * Measured after paint and written back as a margin. `useLayoutEffect` and
   * not `useEffect`: the column is already on screen by then, and doing this a
   * frame later would show it snapping down from the top every time.
   *
   * Recomputed when a column is SCROLLED, too. Listened for on the strip in
   * the capture phase, because scroll does not bubble — without that, scrolling
   * a manager's list left their team's column behind at the old offset.
   */
  useLayoutEffect(() => {
    if (!open) return;
    function place() {
      const strip = stripRef.current;
      if (!strip) return;
      const stripTop = strip.getBoundingClientRect().top;
      const next = openPath.map((id, level) => {
        const row = strip.querySelector<HTMLElement>(
          `[data-col="${level}"] [data-person="${CSS.escape(id)}"]`,
        );
        const column = strip.querySelector<HTMLElement>(
          `[data-col="${level + 1}"]`,
        );
        if (!row || !column) return 0;
        return branchColumnTop({
          rowTop: row.getBoundingClientRect().top - stripTop,
          columnHeight: column.getBoundingClientRect().height,
          available: document.documentElement.clientHeight - stripTop,
        });
      });
      /* Only on a real change — this runs after every paint, and setting an
         equal array would render forever. */
      setTops((prev) =>
        prev.length === next.length && prev.every((v, i) => v === next[i])
          ? prev
          : next,
      );
    }
    place();
    const strip = stripRef.current;
    strip?.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      strip?.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [open, openPath, tops]);

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
        onClick={() => (open ? setOpen(false) : openOnto())}
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
          <div
            ref={stripRef}
            className="absolute -left-1 top-full z-50 flex max-w-[calc(100vw-1.5rem)] items-start gap-1 overflow-x-auto scroll-slim p-1"
          >
            {columns.map((col, level) => (
              <ul
                key={col.parent ? col.parent.id : "root"}
                data-col={level}
                /* Level with the row that opened it — see the layout effect. */
                style={level > 0 ? { marginTop: tops[level - 1] ?? 0 } : undefined}
                role="listbox"
                aria-label={
                  col.parent
                    ? `${col.parent.name}'s team`
                    : "Whose tasks to show"
                }
                className="max-h-[360px] w-[240px] shrink-0 overflow-y-auto scroll-slim rounded-xl border border-hairline bg-[var(--surface-raised)] p-1 shadow-lg"
              >
                {/* The resting state, and always first: the way back out of a
                    filter has to be as reachable as the way in. Only in the
                    root column — it clears the filter entirely, which is not a
                    thing a team belongs to. */}
                {!col.parent && (
                  <>
                    <li role="option" aria-selected={value === ALL_MEMBERS}>
                      {/* The same frame every name gets, spacer included.
                          Nobody manages the whole company, so there is no
                          arrow to put in that slot — but it is reserved all
                          the same, because it is what puts this count in the
                          same column as the rest. */}
                      <div
                        className={`${ROW} ${
                          value === ALL_MEMBERS
                            ? "bg-[var(--control)] text-ink"
                            : "text-ink-muted focus-within:bg-[var(--control)] hover:bg-[var(--control)] hover:text-ink"
                        }`}
                      >
                        <button
                          type="button"
                          onClick={() => pick(ALL_MEMBERS)}
                          className={ROW_NAME}
                        >
                          <span className="truncate">All members</span>
                          <span
                            data-figure
                            className="shrink-0 text-xs text-ink-faint"
                          >
                            {totalCount}
                          </span>
                        </button>
                        <span aria-hidden className="h-6 w-6 shrink-0" />
                      </div>
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
    /* `data-person` is what the layout effect measures against to put this
       person's team level with this row. On the `<li>` rather than the inner
       wrapper so the offset is taken from the row's outer box, which is what
       the column beside it is being aligned to. */
    <li role="option" aria-selected={selected} data-person={node.id}>
      {/* A row, not a button: the expander and the name are two controls and a
          button inside a button is invalid HTML that browsers flatten. The
          wash lives HERE, on the non-pressable wrapper, which is what lets it
          reach the panel's edges past both of them — see `ROW`.

          `focus-within` and not only `hover`, because the fill is the only
          thing marking which row you are on, and a keyboard has no pointer. */}
      <div
        className={`${ROW} ${
          selected
            ? "bg-[var(--control)] text-ink"
            : isOpen
              ? /* On the open path: lifted out of the muted rows so the
                   reporting line reads across the columns, but without the
                   selected row's fill — being open is not being chosen. */
                "text-ink focus-within:bg-[var(--control)] hover:bg-[var(--control)]"
              : "text-ink-muted focus-within:bg-[var(--control)] hover:bg-[var(--control)] hover:text-ink"
        }`}
      >
        <button type="button" onClick={() => onPick(node.id)} className={ROW_NAME}>
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
                ? "bg-[var(--control-active)] text-ink"
                : "text-ink-faint hover:bg-[var(--control-active)] hover:text-ink focus-visible:bg-[var(--control-active)] focus-visible:text-ink"
            }`}
          >
            {/* No rotation on open. The arrow points at where the team appears,
                and it appears to the right open or shut; turning it down would
                point at rows belonging to somebody else. */}
            <Icon.chevronRight aria-hidden className="h-3.5 w-3.5" />
          </button>
        ) : (
          /* Exactly the expander's box, so the counts line up whether or not
             the person manages anybody. Inside the filled wrapper, so it costs
             the highlight nothing. */
          <span aria-hidden className="h-6 w-6 shrink-0" />
        )}
      </div>
    </li>
  );
}
