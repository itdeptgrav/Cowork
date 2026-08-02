"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Icon, type IconName } from "@/components/ui/Icons";
import {
  groupCommands,
  matchCommands,
  moveSelection,
  type CommandDescriptor,
} from "@/lib/rules/workspace/commands";

/**
 * The workspace's commands, in one place, reached with ⌘K.
 *
 * ## Why a palette rather than more buttons
 *
 * The workspace has three surfaces and the same handful of intentions across
 * all of them: make something, open something, go somewhere. Spelling those out
 * as chrome means a toolbar that grows a button per surface per verb, and a
 * header that is mostly controls nobody pressed today. A palette holds the
 * whole set, costs one row of chrome, and is faster than any of the buttons it
 * replaces for anybody who has used it twice.
 *
 * It is deliberately small. Everything here is something a person would say out
 * loud — "new sheet", "go to documents", "open the retro notes". Formatting,
 * page setup and export are not here: they belong to an open document, where
 * the menus name them in groups that can be read. A palette listing sixty
 * commands is a search box over a manual.
 *
 * ## Where it is, and where it deliberately is not
 *
 * Mounted on the browsing surface only. Inside a document ⌘K inserts a link,
 * which is what that keystroke means in every editor anybody has used, and a
 * palette that stole it would be the wrong answer to a reflex. That is why this
 * takes its commands as a prop and owns no knowledge of what they do.
 */

export interface PaletteCommand extends CommandDescriptor {
  icon?: IconName;
  run: () => void;
}

export function CommandPalette({
  commands,
  /** Named in the trigger's title, so the hint says which surface it opens. */
  surface,
}: {
  commands: PaletteCommand[];
  surface: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const listId = "workspace-command-list";

  const matches = useMemo(() => matchCommands(commands, query), [commands, query]);
  const groups = useMemo(() => groupCommands(matches), [matches]);
  /* Clamped rather than reset: the selection is an index into `matches`, and a
     keystroke that shortens the list must not leave it pointing past the end. */
  const active = matches.length === 0 ? -1 : Math.min(selected, matches.length - 1);

  /* Arrowing past the fold has to bring the row with it, or the selection is
     somewhere below the panel and Enter runs something nobody can see. */
  const activeRow = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    activeRow.current?.scrollIntoView({ block: "nearest" });
  }, [active]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setQuery("");
        setSelected(0);
        setOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setQuery("");
          setSelected(0);
          setOpen(true);
        }}
        title={`${surface} commands (Ctrl K)`}
        className="inline-flex h-8 shrink-0 items-center gap-2 rounded-inset border border-hairline bg-[var(--surface-raised)] px-2.5 text-[13px] text-ink-muted transition-colors hover:text-ink"
      >
        <Icon.search className="h-3.5 w-3.5" />
        <span className="hidden deck:inline">Commands</span>
        {/* Not `<kbd>`: this system has one type family and no monospace, and a
            browser's default `kbd` is monospace. It is a shortcut hint drawn as
            one, which is what the menus do too. */}
        <span
          aria-hidden="true"
          className="rounded-full bg-[var(--control)] px-1.5 py-0.5 text-[10px] leading-none text-ink-faint"
        >
          ⌘K
        </span>
      </button>

      {open && (
        <div
          className="fixed inset-0 z-[95] flex justify-center bg-black/35 p-4 pt-[14vh]"
          onPointerDown={(e) => {
            if (e.target === e.currentTarget) setOpen(false);
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label={`${surface} commands`}
            className="snap-in flex max-h-[min(60vh,26rem)] w-full max-w-[34rem] flex-col overflow-hidden rounded-card border border-hairline bg-[var(--surface-raised)] shadow-[var(--shadow-deck-seat)]"
          >
            <div className="flex shrink-0 items-center gap-2.5 border-b border-hairline px-3.5 py-2.5">
              <Icon.search className="h-4 w-4 shrink-0 text-ink-faint" />
              <input
                autoFocus
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setSelected(0);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    e.preventDefault();
                    setOpen(false);
                  } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                    e.preventDefault();
                    setSelected((i) =>
                      moveSelection(i, e.key === "ArrowDown" ? 1 : -1, matches.length),
                    );
                  } else if (e.key === "Enter") {
                    e.preventDefault();
                    const command = matches[active];
                    if (!command) return;
                    /* Closed first: a command that opens a document must not
                       leave the palette floating over the thing it opened. */
                    setOpen(false);
                    command.run();
                  }
                }}
                role="combobox"
                aria-expanded="true"
                aria-controls={listId}
                aria-activedescendant={active >= 0 ? `cmd-${matches[active]!.id}` : undefined}
                aria-label={`Search ${surface.toLowerCase()} commands`}
                placeholder="Type a command…"
                className="min-w-0 flex-1 bg-transparent text-[14px] text-ink outline-none placeholder:text-ink-faint"
              />
              <span className="shrink-0 text-[11px] text-ink-faint">Esc</span>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto py-1.5 scroll-slim">
              {matches.length === 0 ? (
                <p className="px-3.5 py-6 text-center text-[12.5px] text-ink-faint">
                  No command matches “{query.trim()}”.
                </p>
              ) : (
                <ul id={listId} role="listbox" aria-label={`${surface} commands`}>
                  {groups.map((group) => (
                    <li key={group.group}>
                      {/* Sentence case, not a tracked uppercase eyebrow: this
                          system spends its one kicker per view on wayfinding,
                          and a heading over a list is not that. */}
                      <p className="px-3.5 pt-2 pb-1 text-[11px] text-ink-faint">
                        {group.group}
                      </p>
                      <ul>
                        {group.items.map((command) => {
                          const index = matches.indexOf(command);
                          const on = index === active;
                          const Ico = command.icon ? Icon[command.icon] : null;
                          return (
                            <li key={command.id}>
                              <button
                                type="button"
                                ref={on ? activeRow : undefined}
                                id={`cmd-${command.id}`}
                                role="option"
                                aria-selected={on}
                                /* Hover moves the selection, so the row the
                                   pointer is on and the row Enter runs are
                                   never two different rows. */
                                onPointerMove={() => setSelected(index)}
                                onClick={() => {
                                  setOpen(false);
                                  command.run();
                                }}
                                className={`flex w-full items-center gap-2.5 px-3.5 py-1.5 text-left text-[13.5px] transition-colors ${
                                  on ? "bg-[var(--control-active)] text-ink" : "text-ink-muted"
                                }`}
                              >
                                {Ico ? (
                                  <Ico className="h-4 w-4 shrink-0 opacity-70" />
                                ) : (
                                  <span className="h-4 w-4 shrink-0" />
                                )}
                                <span className="min-w-0 flex-1 truncate">{command.label}</span>
                                {command.hint && (
                                  <span className="shrink-0 text-[11px] text-ink-faint">
                                    {command.hint}
                                  </span>
                                )}
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/**
 * The commands that move between the workspace's three surfaces.
 *
 * Shared rather than written twice, because the mindmap's palette and the
 * document browser's palette must offer the same words for the same journeys —
 * a palette whose vocabulary changes with where you happen to be is one you
 * have to look at before typing.
 */
export function navigationCommands(
  mode: "map" | "docs" | "sheets",
  onMode: (next: "map" | "docs" | "sheets") => void,
): PaletteCommand[] {
  const all: { id: "map" | "docs" | "sheets"; label: string; icon: IconName }[] = [
    { id: "map", label: "Go to Mindmap", icon: "projects" },
    { id: "docs", label: "Go to Documents", icon: "list" },
    { id: "sheets", label: "Go to Sheets", icon: "board" },
  ];
  /* The surface you are already on is not offered. A command that does nothing
     is worse than a missing one: it is the row somebody selects and then
     wonders whether the palette is broken. */
  return all
    .filter((entry) => entry.id !== mode)
    .map((entry) => ({
      id: `go-${entry.id}`,
      label: entry.label,
      group: "Go to",
      icon: entry.icon,
      run: () => onMode(entry.id),
    }));
}
