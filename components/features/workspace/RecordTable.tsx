"use client";

/**
 * The workspace record table — one layout for sheets, documents and mindmaps.
 *
 * All three answer the same questions (what is it, when did it change, who made
 * it, who else has it), so they get one table rather than three that drift. The
 * surfaces differ only in what they can put in it: a mindmap carries a branch
 * count, and the other two have nothing of their own.
 *
 * This is a TABLE, not a list of cards: comparing records means running the eye
 * down a column, so the labels live once in the header and every row is values
 * only. Header and rows share `GRID`, so their columns cannot drift apart —
 * matching two flex layouts by hand survives exactly until someone edits one.
 *
 * Sharing is editable HERE, on every surface. "Who has this?" is asked while
 * looking at the list, so the answer belongs there too rather than behind an
 * open-the-document detour.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { usePerformanceProfile } from "@/components/layout/shell/DeviceModeContext";

export type RecordRole = "viewer" | "commenter" | "editor";

export interface RecordMember {
  /** The person's id. A directory lookup turns this into a name for display and
      for the search box — see `directory` on the table's props. Absent a
      directory, callers pass, and the panel shows, the raw id. */
  id: string;
  role: RecordRole;
}

/**
 * One of Cowork's people, so the share panel can be searched by NAME instead of
 * requiring a raw id to be typed in. Given a directory the panel becomes a
 * name-search picker and resolves each member's id to their name; without one it
 * keeps the raw-id field, unchanged — the prop is optional, so no surface is
 * forced to supply it.
 */
export interface DirectoryPerson {
  id: string;
  name: string;
  /** A quiet second line — role or department — so two people of the same name
      are still distinguishable. */
  sub?: string;
}

/** What a mindmap adds, and the other two surfaces omit. */
export interface BranchCount {
  count: number;
  /**
   * Change since THIS viewer last opened it — positive for branches added,
   * negative for removed, and null when there is nothing to report (they are
   * up to date, or have never opened it so there is no "since").
   */
  delta: number | null;
}

/** One row, normalised from whichever record the surface stores. */
export interface RecordItem {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  /** Who made it. Callers pass a display name when they have one. */
  createdBy: string;
  /** Whether the viewer owns it — gates rename, delete and share editing. */
  isMine: boolean;
  members: RecordMember[];
  branches?: BranchCount;
  /** The work this belongs to, when the surface records one. */
  relatedTo?: string | null;
}

export interface RecordTableProps {
  items: RecordItem[];
  /** The noun this surface uses, for the first column's heading. */
  noun: string;
  /** Adds the Branches column. Off for surfaces with no branch count. */
  showBranches?: boolean;
  /** Which roles this surface can actually grant. Documents and mindmaps store
      only `viewer`/`editor`; offering "Can comment" there would be a control
      that silently stores something else. Defaults to all three. */
  roles?: RecordRole[];
  onOpen: (id: string) => void;
  onRename: (id: string, title: string) => void;
  /** Omitted where the surface has no copy operation — the button is then not
      rendered at all, rather than shown doing nothing. */
  onDuplicate?: (id: string) => void;
  onDelete: (id: string) => void;
  /** Replace a record's whole member list. Resolves with what was stored. */
  onSetMembers: (id: string, members: RecordMember[]) => Promise<RecordMember[]>;
  /** Cowork's people, so the share panel searches by name and shows names rather
      than ids. Omit to keep the raw-id field. */
  directory?: DirectoryPerson[];
}

/* ── Layout ───────────────────────────────────────────────────────────────── */

/**
 * The column widths, with and without the branches column.
 *
 * Both are COMPLETE LITERAL strings, never assembled from parts. Tailwind scans
 * source text statically, so a class built at runtime — `md:grid-cols-[…${x}…]`
 * — is never generated. The grid then has no template at all and every cell
 * wraps onto its own row, which is exactly what happened to the mindmap table.
 * That is why this reads repetitively on purpose.
 *
 * The actions column is FIXED, not `auto`: auto sizes to content, and the header
 * has no buttons, so the two grids would size it differently and every column to
 * its left would land somewhere else.
 */
const GRID_BASE =
  "grid items-center gap-x-4 " +
  "grid-cols-[minmax(0,1fr)_13rem] " +
  "sm:grid-cols-[minmax(0,2fr)_minmax(0,7rem)_13rem] " +
  "md:grid-cols-[minmax(0,2fr)_minmax(0,7rem)_minmax(0,7rem)_minmax(0,5rem)_13rem] " +
  "lg:grid-cols-[minmax(0,2fr)_minmax(0,7rem)_minmax(0,7rem)_minmax(0,5rem)_minmax(0,1fr)_minmax(0,1fr)_13rem] " +
  "xl:grid-cols-[minmax(0,2fr)_minmax(0,7rem)_minmax(0,7rem)_minmax(0,5rem)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_13rem]";

const GRID_BRANCHES =
  "grid items-center gap-x-4 " +
  "grid-cols-[minmax(0,1fr)_13rem] " +
  "sm:grid-cols-[minmax(0,2fr)_minmax(0,7rem)_13rem] " +
  "md:grid-cols-[minmax(0,2fr)_minmax(0,7rem)_minmax(0,7rem)_minmax(0,5rem)_minmax(0,6rem)_13rem] " +
  "lg:grid-cols-[minmax(0,2fr)_minmax(0,7rem)_minmax(0,7rem)_minmax(0,5rem)_minmax(0,6rem)_minmax(0,1fr)_minmax(0,1fr)_13rem] " +
  "xl:grid-cols-[minmax(0,2fr)_minmax(0,7rem)_minmax(0,7rem)_minmax(0,5rem)_minmax(0,6rem)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_13rem]";

function gridFor(showBranches: boolean): string {
  return showBranches ? GRID_BRANCHES : GRID_BASE;
}

/* Each column's visibility, applied identically in the header and every row.
   Last updated comes first after the name: in a list of work the question is
   "what did I touch last", not "what did I make first". Created and its time
   stay adjacent so the time reads as belonging to it. */
const COL = {
  updated: "hidden sm:block",
  created: "hidden md:block",
  time: "hidden md:block",
  branches: "hidden md:block",
  by: "hidden lg:block",
  shared: "hidden lg:block",
  related: "hidden xl:block",
};

const ALL_ROLES: RecordRole[] = ["viewer", "commenter", "editor"];
const ROLE_LABEL: Record<RecordRole, string> = {
  viewer: "Can view",
  commenter: "Can comment",
  editor: "Can edit",
};

/* Controls are capsules and fields carry an inset ring rather than a border —
   the deck's own control language, so this table reads as the same product as
   every other surface. See `.impeccable/surfaces/app-tasks-page-tsx.md`. */
const action =
  "inline-flex h-7 items-center rounded-full px-2.5 text-[12px] text-ink-muted transition-colors hover:bg-[var(--control)] hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--ink-muted)] disabled:pointer-events-none disabled:opacity-35";
/* The system's field: `surface-raised` under a hairline INSET RING, not a
   border, thickening to deck ink on focus. Same shape `Primitives.Input` uses,
   so a field here and a field on any other surface are the same object. */
const field =
  "h-7 min-w-0 rounded-inset bg-[var(--surface-raised)] px-2.5 text-[12px] text-ink shadow-[inset_0_0_0_1px_var(--color-hairline)] outline-none transition-shadow focus:shadow-[inset_0_0_0_1.5px_var(--color-ink)]";
const value = "min-w-0 truncate text-[13px] text-ink";

function when(iso: string): { date: string; time: string } {
  try {
    const d = new Date(iso);
    return {
      date: d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }),
      time: d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }),
    };
  } catch {
    return { date: "—", time: "—" };
  }
}

/* ── Sharing ──────────────────────────────────────────────────────────────── */

/** Where a panel hangs from: the trigger element, and its rect when it opened. */
interface Anchor {
  el: HTMLElement;
  rect: DOMRect;
}

const PANEL_W = 320;
/** Clear of the viewport edge, and of the trigger. */
const EDGE = 8;
const OFFSET = 6;
/** Enough room for the header, the add row and a couple of members. */
const MIN_ROOM = 220;

/**
 * The collaborators panel. Every change writes the WHOLE member list, because
 * that is what the stores take and what keeps the panel and the server in step
 * without a diff. Changes are optimistic and roll back to what was actually
 * stored if the write fails.
 *
 * **It renders in a portal, fixed to the viewport, not absolutely inside its
 * row.** The table is a scroll region inside a rounded card, so both the `<ul>`
 * (`overflow-y-auto`) and the card (`overflow-hidden`) clip any absolutely
 * positioned descendant. Opened from a row near the foot of the list, the panel
 * was cut off a line below its own heading — everything under "Collaborators"
 * was outside the card and never painted. No z-index fixes that; clipping is
 * not stacking. The portal takes it out of both boxes, and the rect is
 * re-measured on scroll and resize so it stays with its row.
 */
function SharePanel({
  recordId,
  initial,
  roles,
  anchor,
  onSetMembers,
  onClose,
  directory,
}: {
  recordId: string;
  initial: RecordMember[];
  roles: RecordRole[];
  anchor: Anchor;
  onSetMembers: RecordTableProps["onSetMembers"];
  onClose: () => void;
  directory?: DirectoryPerson[];
}) {
  const [members, setMembers] = useState<RecordMember[]>(initial);
  const [who, setWho] = useState("");
  const [role, setRole] = useState<RecordRole>(roles.includes("editor") ? "editor" : roles[0]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [rect, setRect] = useState<DOMRect>(anchor.rect);
  const panelRef = useRef<HTMLDivElement>(null);

  /* Every listener writes state from an EVENT, never from the effect body — a
     synchronous set during the effect is what `react-hooks/set-state-in-effect`
     refuses, and the opening rect is already known from the click that opened
     this. `scroll` is captured so the table's own scroll box is heard too, not
     just the window. */
  useEffect(() => {
    const el = anchor.el;
    function sync() {
      setRect(el.getBoundingClientRect());
    }
    function onDown(e: Event) {
      const t = e.target as Node;
      /* The trigger toggles on its own click; closing here as well would
         cancel the reopen and the button would look dead. */
      if (panelRef.current?.contains(t) || el.contains(t)) return;
      onClose();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("scroll", sync, true);
    window.addEventListener("resize", sync);
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("scroll", sync, true);
      window.removeEventListener("resize", sync);
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("keydown", onKey);
    };
  }, [anchor, onClose]);

  async function commit(next: RecordMember[]) {
    const previous = members;
    setMembers(next);
    setBusy(true);
    setError(null);
    try {
      setMembers(await onSetMembers(recordId, next));
    } catch {
      setMembers(previous);
      setError("Couldn’t save that change.");
    } finally {
      setBusy(false);
    }
  }

  /** Several people at once — commas or spaces separate them. The raw-id path,
      used only when no directory was supplied. */
  function add() {
    const ids = who.split(/[,\s]+/).map((s) => s.trim()).filter(Boolean);
    if (ids.length === 0) return;
    const kept = members.filter((m) => !ids.includes(m.id));
    void commit([...kept, ...ids.map((id) => ({ id, role }))]);
    setWho("");
  }

  /* Id → person, for showing a name where the record stores only an id. */
  const dirById = useMemo(
    () => new Map((directory ?? []).map((p) => [p.id, p] as const)),
    [directory],
  );
  const nameOf = (id: string) => dirById.get(id)?.name ?? id;

  /* The people the search box offers: those in the directory, not already
     shared with, whose name or second line contains what has been typed. Capped
     so a blank-ish query does not render the whole company. */
  const matches = useMemo(() => {
    const q = who.trim().toLowerCase();
    if (!q || !directory) return [];
    const taken = new Set(members.map((m) => m.id));
    return directory
      .filter((p) => !taken.has(p.id))
      .filter((p) => `${p.name} ${p.sub ?? ""}`.toLowerCase().includes(q))
      .slice(0, 12);
  }, [who, directory, members]);

  /** Add one person picked from the directory, at the chosen role. */
  function addPerson(id: string) {
    if (!members.some((m) => m.id === id)) {
      void commit([...members, { id, role }]);
    }
    setWho("");
  }

  /* Below by default; above when the row sits near the foot of the window and
     there is more room the other way. Either way the panel is capped to the
     space it actually has and scrolls inside it, so it can never run off the
     screen the way it used to run out of the card. */
  const below = window.innerHeight - rect.bottom - EDGE;
  const above = rect.top - EDGE;
  const flip = below < MIN_ROOM && above > below;
  const left = Math.min(
    Math.max(EDGE, rect.right - PANEL_W),
    Math.max(EDGE, window.innerWidth - PANEL_W - EDGE),
  );

  return createPortal(
    <div
      ref={panelRef}
      role="dialog"
      aria-label="Collaborators"
      /* The opaque deck twin, plus a hairline. `.frost-bar-solid` drops the
         blur by design, and in dark it lands at `rgb(24,24,28)` on a
         `rgb(12,12,14)` page — a 12-value step that the lit top edge alone does
         not carry. The border is what makes it read as a surface rather than a
         hole, which is how the broken panel looked in the first place. */
      className="frost-bar-solid fixed z-50 flex flex-col gap-2.5 overflow-hidden rounded-panel border border-hairline p-3"
      style={{
        left,
        width: PANEL_W,
        maxHeight: (flip ? above : below) - OFFSET,
        ...(flip
          ? { bottom: window.innerHeight - rect.top + OFFSET }
          : { top: rect.bottom + OFFSET }),
      }}
    >
      <div className="flex items-baseline justify-between">
        <span className="text-[12px] font-medium text-ink">Collaborators</span>
        <button type="button" className={action} onClick={onClose}>Done</button>
      </div>

      {directory ? (
        <>
          <div className="flex items-center gap-1.5">
            <input
              className={`${field} flex-1`}
              aria-label="Search people to add"
              placeholder="Search people by name"
              value={who}
              onChange={(e) => setWho(e.target.value)}
              onKeyDown={(e) => {
                /* Enter adds the top match — the quick path once the name has
                   narrowed the list to the person meant. */
                if (e.key === "Enter" && matches[0]) {
                  e.preventDefault();
                  addPerson(matches[0].id);
                }
              }}
            />
            <select
              className={`${field} shrink-0`}
              aria-label="Role for new collaborators"
              value={role}
              onChange={(e) => setRole(e.target.value as RecordRole)}
            >
              {roles.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
            </select>
          </div>
          {who.trim() && (
            /* Results are listed in flow, not an absolute dropdown: the panel is
               `overflow-hidden`, which would clip a positioned menu. Its own cap
               and scroll keep it from crowding the member list below. */
            <div className="scroll-slim max-h-40 overflow-y-auto rounded-inset shadow-[inset_0_0_0_1px_var(--color-hairline)]">
              {matches.length === 0 ? (
                <p className="px-2.5 py-2 text-[12px] text-ink-muted">
                  No people match “{who.trim()}”.
                </p>
              ) : (
                matches.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    disabled={busy}
                    onClick={() => addPerson(p.id)}
                    className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left transition-colors hover:bg-[var(--control)] disabled:opacity-40"
                  >
                    <span className="min-w-0 flex-1 truncate text-[12px] text-ink">
                      {p.name}
                    </span>
                    {p.sub && (
                      <span className="shrink-0 truncate text-[11px] text-ink-muted">
                        {p.sub}
                      </span>
                    )}
                  </button>
                ))
              )}
            </div>
          )}
        </>
      ) : (
        <>
          <div className="flex items-center gap-1.5">
            <input
              className={`${field} flex-1`}
              aria-label="Add collaborators"
              placeholder="Ids, comma separated"
              value={who}
              onChange={(e) => setWho(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  add();
                }
              }}
            />
            <select
              className={`${field} shrink-0`}
              aria-label="Role for new collaborators"
              value={role}
              onChange={(e) => setRole(e.target.value as RecordRole)}
            >
              {roles.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
            </select>
          </div>
          <button
            type="button"
            disabled={!who.trim() || busy}
            onClick={add}
            className="h-7 shrink-0 rounded-full bg-ink px-3 text-[12px] font-medium text-[var(--body-bg)] transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            Add collaborators
          </button>
        </>
      )}

      {error && (
        <p role="alert" className="text-[11px] text-[var(--state-overdue-ink)]">
          {error}
        </p>
      )}

      {/* The only scroller. The panel itself is capped and clipped, so the
          heading and the add row stay put while a long member list moves. */}
      <div className="scroll-slim flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto">
        {members.length === 0 ? (
          <p className="text-[12px] text-ink-muted">Not shared — only you can open it.</p>
        ) : (
          members.map((m) => (
            <div key={m.id} className="flex items-center gap-1.5">
              <span
                className="min-w-0 flex-1 truncate text-[12px] text-ink"
                title={nameOf(m.id)}
              >
                {nameOf(m.id)}
              </span>
              <select
                className={`${field} shrink-0`}
                aria-label={`Role for ${nameOf(m.id)}`}
                value={m.role}
                disabled={busy}
                onChange={(e) =>
                  void commit(
                    members.map((x) =>
                      x.id === m.id ? { ...x, role: e.target.value as RecordRole } : x,
                    ),
                  )
                }
              >
                {roles.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
              </select>
              <button
                type="button"
                className={action}
                disabled={busy}
                aria-label={`Remove ${nameOf(m.id)}`}
                title={`Remove ${nameOf(m.id)}`}
                onClick={() => void commit(members.filter((x) => x.id !== m.id))}
              >
                ×
              </button>
            </div>
          ))
        )}
      </div>
    </div>,
    document.body,
  );
}

/* ── Branches ─────────────────────────────────────────────────────────────── */

/**
 * A mindmap's branch count, and what changed since this viewer last looked.
 *
 * A dash — not a zero — when nothing changed: "+0" reads as a measurement, and
 * the point of the column is to catch the eye only when there IS something to
 * catch it. Colour is not the only carrier; the sign is in the text.
 */
function Branches({ branches }: { branches: BranchCount }) {
  const { count, delta } = branches;
  const changed = delta !== null && delta !== 0;
  return (
    <span className="inline-flex items-baseline gap-1.5 tabular-nums">
      <span className="text-[13px] text-ink">{count}</span>
      {changed ? (
        <span
          className={`text-[12px] font-medium ${
            delta > 0 ? "text-[var(--state-positive)]" : "text-[var(--state-overdue)]"
          }`}
          title={
            delta > 0
              ? `${delta} branch${delta === 1 ? "" : "es"} added since you last opened this`
              : `${-delta} branch${delta === -1 ? "" : "es"} removed since you last opened this`
          }
        >
          {delta > 0 ? `+${delta}` : `−${-delta}`}
        </span>
      ) : (
        <span className="text-[12px] text-ink-faint" title="No change since you last opened this">
          —
        </span>
      )}
    </span>
  );
}

/* ── Table ────────────────────────────────────────────────────────────────── */

export function RecordTable({
  items,
  noun,
  showBranches = false,
  roles = ALL_ROLES,
  onOpen,
  onRename,
  onDuplicate,
  onDelete,
  onSetMembers,
  directory,
}: RecordTableProps) {
  const GRID = gridFor(showBranches);
  /* Low- and high-spec rendering come from the device mode the app already
     owns, not a second toggle. The stylesheet strips blur, long shadows and
     transitions under `[data-perf="plain"]` on its own, so the only thing React
     has to decide is what CSS cannot express: HOW MANY rows to mount. Plain
     shows 20 and pages; rich shows 50. */
  const { listChunkSize } = usePerformanceProfile();
  const [shown, setShown] = useState(listChunkSize);
  const visible = items.slice(0, shown);
  const remaining = items.length - visible.length;
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-card border border-hairline">
      <div
        className={`${GRID} border-b border-hairline px-3 pt-2 pb-1.5 text-[11px] font-medium tracking-[0.02em] text-ink-muted uppercase`}
      >
        <span>{noun}</span>
        <span className={COL.updated}>Last updated</span>
        <span className={COL.created}>Created</span>
        <span className={COL.time}>Time</span>
        {showBranches && <span className={COL.branches}>Branches</span>}
        <span className={COL.by}>Created by</span>
        <span className={COL.shared}>Shared with</span>
        <span className={COL.related}>Related to</span>
        {/* In flow so it holds its grid column — `sr-only` is absolutely
            positioned, which drops it out of the grid and shifts every column. */}
        <span><span className="sr-only">Actions</span></span>
      </div>

      <ul className="min-h-0 flex-1 divide-y divide-hairline overflow-y-auto">
        {visible.map((item) => (
          <Row
            key={item.id}
            item={item}
            grid={GRID}
            showBranches={showBranches}
            roles={roles}
            onOpen={() => onOpen(item.id)}
            onRename={(t) => onRename(item.id, t)}
            onDuplicate={onDuplicate ? () => onDuplicate(item.id) : undefined}
            onDelete={() => onDelete(item.id)}
            onSetMembers={onSetMembers}
            directory={directory}
          />
        ))}
      </ul>

      {remaining > 0 && (
        <button
          type="button"
          onClick={() => setShown((n) => n + listChunkSize)}
          className="border-t border-hairline px-3 py-2 text-[12px] text-ink-muted transition-colors hover:bg-[color-mix(in_srgb,var(--ink)_5%,transparent)] hover:text-ink"
        >
          Show {Math.min(remaining, listChunkSize)} more · {remaining} not shown
        </button>
      )}
    </div>
  );
}

function Row({
  item,
  grid,
  showBranches,
  roles,
  onOpen,
  onRename,
  onDuplicate,
  onDelete,
  onSetMembers,
  directory,
}: {
  item: RecordItem;
  grid: string;
  showBranches: boolean;
  roles: RecordRole[];
  onOpen: () => void;
  onRename: (title: string) => void;
  onDuplicate?: () => void;
  onDelete: () => void;
  onSetMembers: RecordTableProps["onSetMembers"];
  directory?: DirectoryPerson[];
}) {
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(item.title);
  /* The trigger itself, measured at the moment of the click. Holding the element
     as well as the rect lets the panel re-measure on scroll and tell its own
     trigger apart from an outside click. */
  const [share, setShare] = useState<Anchor | null>(null);
  const closeShare = useCallback(() => setShare(null), []);

  const created = when(item.createdAt);
  const updated = when(item.updatedAt);

  function commitRename() {
    const name = draft.trim();
    if (name && name !== item.title) onRename(name);
    setRenaming(false);
  }

  return (
    <li className={`${grid} px-3 py-2.5 transition-colors hover:bg-[color-mix(in_srgb,var(--ink)_5%,transparent)]`}>
      <div className="flex min-w-0 items-center gap-3">
        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-inset bg-[var(--control)] text-[11px] text-ink-muted">
          ▦
        </span>
        {renaming ? (
          <input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commitRename}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitRename();
              else if (e.key === "Escape") {
                setDraft(item.title);
                setRenaming(false);
              }
            }}
            aria-label="Name"
            className="h-7 min-w-0 flex-1 rounded-md border border-hairline bg-[var(--surface-raised)] px-2 text-[14px] text-ink outline-none focus-visible:border-[color-mix(in_srgb,var(--ink)_40%,transparent)]"
          />
        ) : (
          <button
            type="button"
            onClick={onOpen}
            className="min-w-0 flex-1 truncate rounded text-left text-[14px] text-ink hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ink-muted)]"
          >
            {item.title}
          </button>
        )}
      </div>

      <div className={`${COL.updated} ${value} tabular-nums`}>{updated.date}</div>
      <div className={`${COL.created} ${value} tabular-nums`}>{created.date}</div>
      <div className={`${COL.time} ${value} tabular-nums`}>{created.time}</div>

      {showBranches && (
        <div className={`${COL.branches} min-w-0`}>
          {item.branches ? <Branches branches={item.branches} /> : <span className="text-[13px] text-ink-faint">—</span>}
        </div>
      )}

      <div className={`${COL.by} ${value}`} title={item.createdBy}>
        {item.isMine ? "You" : item.createdBy}
      </div>

      <div className={`${COL.shared} min-w-0`}>
        {item.isMine ? (
          <button
            type="button"
            onClick={(e) => {
              const el = e.currentTarget;
              setShare((s) => (s ? null : { el, rect: el.getBoundingClientRect() }));
            }}
            aria-expanded={share !== null}
            aria-haspopup="dialog"
            className="max-w-full truncate rounded text-left text-[13px] text-ink hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ink-muted)]"
          >
            {item.members.length === 0
              ? "Only you"
              : `${item.members.length} ${item.members.length === 1 ? "person" : "people"}`}
            <span aria-hidden className="ml-1 text-ink-muted">▾</span>
          </button>
        ) : (
          <span className="block truncate text-[13px] text-ink">Shared with you</span>
        )}
        {share && item.isMine && (
          <SharePanel
            recordId={item.id}
            initial={item.members}
            roles={roles}
            anchor={share}
            onSetMembers={onSetMembers}
            onClose={closeShare}
            directory={directory}
          />
        )}
      </div>

      <div className={`${COL.related} min-w-0 truncate text-[13px] text-ink-muted`}>
        {item.relatedTo ?? "Not linked"}
      </div>

      <div className="flex shrink-0 items-center gap-0.5 justify-self-end">
        <button
          type="button"
          className={action}
          title={item.isMine ? "Rename" : "Only the owner can rename this"}
          disabled={!item.isMine}
          onClick={() => {
            setDraft(item.title);
            setRenaming(true);
          }}
        >
          Rename
        </button>
        {onDuplicate && (
          <button type="button" className={action} title="Make a copy" onClick={onDuplicate}>
            Duplicate
          </button>
        )}
        <button
          type="button"
          className={`${action} hover:text-[var(--state-overdue)]`}
          title={item.isMine ? "Delete" : "Only the owner can delete this"}
          disabled={!item.isMine}
          onClick={onDelete}
        >
          Delete
        </button>
      </div>
    </li>
  );
}
