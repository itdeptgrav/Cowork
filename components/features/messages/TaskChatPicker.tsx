"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Icon } from "@/components/ui/Icons";
import { taskChatLabel, type PairedTaskChat } from "@/lib/rules/messages/taskChats";

/**
 * Which task the Task chat segment is showing.
 *
 * ## Why this is not a `<select>`
 *
 * It was one, and that was the defect. A native `<select>` renders its list
 * with the OPERATING SYSTEM, not with the page: a white sheet, the system's
 * blue selection, the system's font, square corners — dropped on top of a dark
 * frosted product that has none of those things. `option` accepts almost no
 * CSS, so there is no version of that control which obeys this design system.
 *
 * The trade that produced it was real — a native select brings keyboard
 * handling, type-ahead and a platform touch picker for free — so the cost of
 * replacing it is that every one of those has to be written here. They are,
 * below. What is NOT rebuilt is the surface: this is the same frosted panel,
 * hairline border and seat shadow `MessageContextMenu` uses, because the
 * product should have one menu, not two that merely resemble each other.
 *
 * ## Anchored, not pointer-positioned
 *
 * `MessageContextMenu` opens at the pointer because a right-click names a
 * position. A picker names a CONTROL, so this opens against the trigger and
 * aligns to its right edge — the chevron sits at the right of the segment, and
 * a menu that spilled leftward from it would read as belonging to the label
 * instead. Clamped to the viewport and flipped above when the space below is
 * too tight, measured before paint since the height depends on how many tasks
 * two people share.
 */

/** The gap kept between the menu and the edge of the window. */
const MARGIN = 8;
/** Enough for a rank chip, a title worth reading, and the tick. */
const MIN_WIDTH = 232;

export function TaskChatPicker({
  chats,
  openTaskId,
  onPick,
}: {
  chats: PairedTaskChat[];
  openTaskId: string | null;
  onPick: (taskId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Which task to discuss"
        title="Which task to discuss"
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          /* Down opens onto the list, the convention every combobox shares.
             Without it a keyboard user has to guess that Enter is the way in. */
          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            setOpen(true);
          }
        }}
        /* `self-stretch` so the hit target is the full height of the segment
           rather than the height of a 14px glyph — the same reason the header's
           icon buttons are 32px squares around a 16px mark. */
        className="relative flex items-center self-stretch rounded-e-full pe-2.5 ps-0.5 transition-opacity duration-[180ms] ease-[var(--ease-deck)] hover:opacity-80"
      >
        <Icon.chevronDown
          aria-hidden
          className={`h-3.5 w-3.5 opacity-70 transition-transform duration-[180ms] ease-[var(--ease-deck)] ${
            open ? "rotate-180" : ""
          }`}
        />
      </button>

      {open && (
        <PickerMenu
          chats={chats}
          openTaskId={openTaskId}
          anchor={triggerRef}
          onPick={(id) => {
            setOpen(false);
            onPick(id);
          }}
          onClose={() => {
            setOpen(false);
            /* Focus goes back where it came from. A menu that closes into
               nowhere drops a keyboard user at the top of the document. */
            triggerRef.current?.focus();
          }}
        />
      )}
    </>
  );
}

function PickerMenu({
  chats,
  openTaskId,
  anchor,
  onPick,
  onClose,
}: {
  chats: PairedTaskChat[];
  openTaskId: string | null;
  anchor: React.RefObject<HTMLButtonElement | null>;
  onPick: (taskId: string) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [at, setAt] = useState<{ left: number; top: number } | null>(null);
  /* Which row the keyboard is on. Starts on the open task, so Enter without
     arrowing is a no-op rather than a silent jump to whatever was first. */
  const [active, setActive] = useState(() => {
    const i = chats.findIndex((c) => c.taskId === openTaskId);
    return i < 0 ? 0 : i;
  });

  useLayoutEffect(() => {
    const el = ref.current;
    const trigger = anchor.current;
    if (!el || !trigger) return;
    const t = trigger.getBoundingClientRect();
    const { width, height } = el.getBoundingClientRect();
    /* Right edges aligned: the chevron is the right end of the segment, so the
       menu grows leftward from it and stays under the thing that opened it. */
    const left = Math.max(
      MARGIN,
      Math.min(t.right - width, window.innerWidth - width - MARGIN),
    );
    /* Below by default, flipped above when the thread pane leaves no room —
       this control lives in a header, so below is nearly always right. */
    const below = t.bottom + 6;
    const top =
      below + height + MARGIN > window.innerHeight && t.top - height - 6 > MARGIN
        ? t.top - height - 6
        : Math.min(below, window.innerHeight - height - MARGIN);
    setAt({ left, top: Math.max(MARGIN, top) });
  }, [anchor, chats.length]);

  /* Focus follows the active row, so the browser scrolls it into view and a
     screen reader announces it. */
  useEffect(() => {
    if (!at) return;
    ref.current
      ?.querySelectorAll<HTMLButtonElement>("[role=menuitemradio]")
      [active]?.focus();
  }, [active, at]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key === "Tab") {
        /* A menu is a mode. Tabbing out of it leaves it open behind the
           focus, which is how two menus end up on screen at once. */
        onClose();
        return;
      }
      const last = chats.length - 1;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActive((i) => (i >= last ? 0 : i + 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setActive((i) => (i <= 0 ? last : i - 1));
      } else if (e.key === "Home") {
        e.preventDefault();
        setActive(0);
      } else if (e.key === "End") {
        e.preventDefault();
        setActive(last);
      }
    }
    function onDown(e: MouseEvent) {
      /* The trigger handles its own toggle; letting this fire on it too would
         close and immediately reopen. */
      if (ref.current?.contains(e.target as Node)) return;
      if (anchor.current?.contains(e.target as Node)) return;
      onClose();
    }
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    /* A menu anchored to a control is wrong the moment that control moves. */
    window.addEventListener("scroll", onClose, true);
    window.addEventListener("resize", onClose);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("scroll", onClose, true);
      window.removeEventListener("resize", onClose);
    };
  }, [onClose, chats.length, anchor]);

  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      ref={ref}
      role="menu"
      aria-label="Which task to discuss"
      style={{
        left: at?.left ?? -9999,
        top: at?.top ?? -9999,
        minWidth: MIN_WIDTH,
        /* Never taller than the window, and never wider than a phone. A menu
           that runs off the screen hides the very task somebody is reaching
           for. */
        maxWidth: `min(340px, calc(100vw - ${MARGIN * 2}px))`,
        maxHeight: `calc(100vh - ${MARGIN * 2}px)`,
      }}
      className="frost-bar scroll-slim fixed z-[70] overflow-y-auto rounded-panel border border-hairline p-1 shadow-[var(--deck-seat)]"
    >
      {chats.map((c, i) => {
        const selected = c.taskId === openTaskId;
        return (
          <button
            key={c.taskId}
            type="button"
            role="menuitemradio"
            aria-checked={selected}
            tabIndex={i === active ? 0 : -1}
            aria-label={taskChatLabel(c)}
            onClick={() => onPick(c.taskId)}
            onMouseEnter={() => setActive(i)}
            className={`flex w-full items-start gap-2.5 rounded-inset px-2.5 py-1.5 text-left transition-colors duration-[180ms] ease-[var(--ease-deck)] focus:outline-none ${
              selected ? "bg-[var(--control-active)]" : "hover:bg-[var(--control)] focus-visible:bg-[var(--control)]"
            }`}
          >
            {/* The rank, as the chip the task table uses — same shape, same
                tabular figures, so a P1 reads as the same fact on both
                surfaces. A task with no usable rank shows a dash rather than
                inventing a number. */}
            <span
              data-figure
              aria-hidden
              className="mt-px shrink-0 rounded-full bg-[var(--control)] px-1.5 py-0.5 text-[11px] leading-[1.4] text-ink-muted"
            >
              {c.rank !== null ? `P${c.rank}` : "—"}
            </span>

            <span className="min-w-0 flex-1">
              <span className="block truncate text-xs text-ink">{c.title}</span>
              {/* Which way round the task runs. In a list of several this is
                  what separates work you are waiting on from work somebody is
                  waiting on you for. */}
              {/* **Measured, not chosen by eye.** This line is the only thing
                  separating work you owe from work you are owed, so it has to
                  clear 4.5:1 on BOTH row states — and the selected row is the
                  hard one, because `--control-active` is 18% white and lifts
                  the background toward the text. Against the composited menu
                  surface: `ink-faint` gave 3.64 (fails), `ink-muted` 4.35
                  (still fails), `ink` 9.02. The selected row is the strongest
                  row in every other dimension too, so it brightens with the
                  fill rather than fighting it. Unselected rows sit at 7.65. */}
              <span
                className={`mt-0.5 block truncate text-[10px] leading-snug ${
                  selected ? "text-ink" : "text-ink-muted"
                }`}
              >
                {c.mine ? "yours to do" : "you assigned it"}
                {c.isProvisional && " · not accepted yet"}
              </span>
            </span>

            {/* The tick, not a coloured row: per The Four Channels Rule a hue
                here would claim to be a score component. */}
            <span className="mt-0.5 grid h-3.5 w-3.5 shrink-0 place-items-center">
              {selected && <Icon.check aria-hidden className="h-3.5 w-3.5 text-ink" />}
            </span>
          </button>
        );
      })}
    </div>,
    document.body,
  );
}
