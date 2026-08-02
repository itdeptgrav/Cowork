"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Icon, type IconName } from "@/components/ui/Icons";
import {
  matchCommands,
  moveSelection,
  type CommandDescriptor,
} from "@/lib/rules/workspace/commands";
import { useSession } from "@/components/features/auth/SessionProvider";
import { canAccessAdminConsole } from "@/lib/rules/admin/access";
import { useMusic } from "@/components/features/music/MusicContext";
import { useRepo } from "@/lib/hooks/useRepository";

interface NavCommand extends CommandDescriptor {
  icon?: IconName;
  category?: string;
  run: () => void;
}

/**
 * Global ⌘K palette — macOS Spotlight-style.
 *
 * Empty query: shows Create quick-actions in a compact panel.
 * 2+ chars: fires debounced live search across all data sources and
 * shows results in a flat list grouped by category.
 *
 * Only registers on non-/workspace routes — the workspace has its own palette.
 */
export function GlobalCommandPalette() {
  const pathname = usePathname();
  const router = useRouter();
  const session = useSession();
  const isAdmin = canAccessAdminConsole(session);
  const { enabled: musicEnabled } = useMusic();
  const repo = useRepo();

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const [searchResults, setSearchResults] = useState<NavCommand[]>([]);
  const [searching, setSearching] = useState(false);

  // ── Quick-create commands (shown when query is empty) ────────────────────

  const quickActions = useMemo<NavCommand[]>(
    () => [
      {
        id: "create-task",
        label: "Create task",
        group: "Create",
        category: "Task",
        icon: "tasks",
        keywords: ["new task", "add task"],
        run: () => router.push("/tasks/new"),
      },
      {
        id: "create-self-task",
        label: "Create self-task",
        group: "Create",
        category: "Self-task",
        icon: "user",
        keywords: ["self assigned", "my task", "own task"],
        run: () => router.push("/tasks/new?type=self_assigned"),
      },
      {
        id: "create-meeting",
        label: "New meeting",
        group: "Create",
        category: "Meeting",
        icon: "meeting",
        keywords: ["start meeting", "schedule", "video call"],
        run: () => router.push("/meetings/new"),
      },
    ],
    [router],
  );

  // ── Navigate commands (searched but not shown when empty) ────────────────

  const navCommands = useMemo<NavCommand[]>(() => {
    const nav: NavCommand[] = [
      { id: "nav-home", label: "Go to Home", group: "Navigate", category: "Page", icon: "overview", run: () => router.push("/") },
      { id: "nav-tasks", label: "Go to Tasks", group: "Navigate", category: "Page", icon: "tasks", keywords: ["my tasks", "task list"], run: () => router.push("/tasks") },
      { id: "nav-score", label: "Go to Score", group: "Navigate", category: "Page", icon: "score", run: () => router.push("/score") },
      { id: "nav-team", label: "Go to Team", group: "Navigate", category: "Page", icon: "team", run: () => router.push("/team") },
      { id: "nav-goals", label: "Go to Goals", group: "Navigate", category: "Page", icon: "goal", run: () => router.push("/goals") },
      { id: "nav-mail", label: "Go to Mail", group: "Navigate", category: "Page", icon: "send", keywords: ["email", "inbox"], run: () => router.push("/mail") },
      { id: "nav-messages", label: "Go to Messages", group: "Navigate", category: "Page", icon: "chat", keywords: ["chat", "dm", "groups"], run: () => router.push("/messages") },
      { id: "nav-meetings", label: "Go to Meetings", group: "Navigate", category: "Page", icon: "meeting", keywords: ["video", "calls"], run: () => router.push("/meetings") },
      { id: "nav-workspace", label: "Go to Workspace", group: "Navigate", category: "Page", icon: "projects", keywords: ["docs", "documents", "sheets", "notes"], run: () => router.push("/workspace") },
    ];
    if (musicEnabled) nav.push({ id: "nav-music", label: "Go to Music", group: "Navigate", category: "Page", icon: "volume", run: () => router.push("/music") });
    if (isAdmin) nav.push({ id: "nav-admin", label: "Go to Admin", group: "Navigate", category: "Page", icon: "settings", keywords: ["settings", "console", "employees"], run: () => router.push("/admin") });
    return nav;
  }, [router, isAdmin, musicEnabled]);

  // ── Live search ──────────────────────────────────────────────────────────

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    const q = query.trim();

    debounceRef.current = setTimeout(async () => {
      if (q.length < 2) {
        setSearchResults([]);
        setSearching(false);
        return;
      }

      setSearching(true);
      const lower = q.toLowerCase();

      const [tasksR, docsR, meetingsR, convsR, mailR] = await Promise.allSettled([
        repo.listTasks({ scope: "all", search: q, limit: 5 }),
        repo.listDocuments(),
        repo.listMeetings(),
        repo.listConversations(),
        repo.listMailThreads({ folder: "inbox", search: q }),
      ]);

      const items: NavCommand[] = [];

      if (tasksR.status === "fulfilled") {
        for (const tv of tasksR.value.items.slice(0, 5)) {
          items.push({
            id: `s-task-${tv.task.id}`,
            label: tv.task.title,
            group: "Tasks",
            category: tv.task.status === "completed" ? "Done" : tv.task.status === "cancelled" ? "Cancelled" : "Task",
            icon: "tasks",
            run: () => router.push(`/tasks/${tv.task.id}`),
          });
        }
      }
      if (docsR.status === "fulfilled") {
        for (const d of docsR.value.filter((d) => d.title.toLowerCase().includes(lower)).slice(0, 4)) {
          items.push({
            id: `s-doc-${d.id}`,
            label: d.title,
            group: d.kind === "sheet" ? "Sheets" : "Documents",
            category: d.kind === "sheet" ? "Sheet" : "Document",
            icon: d.kind === "sheet" ? "board" : "list",
            run: () => router.push("/workspace"),
          });
        }
      }
      if (meetingsR.status === "fulfilled") {
        for (const m of meetingsR.value.filter((m) => m.title.toLowerCase().includes(lower)).slice(0, 4)) {
          items.push({
            id: `s-meeting-${m.id}`,
            label: m.title,
            group: "Meetings",
            category: m.status === "completed" ? "Past" : m.status === "live" ? "Live" : "Meeting",
            icon: "meeting",
            run: () => router.push(`/meetings/${m.id}`),
          });
        }
      }
      if (convsR.status === "fulfilled") {
        for (const c of convsR.value
          .filter((c) => c.kind === "group" && c.title?.toLowerCase().includes(lower))
          .slice(0, 4)) {
          items.push({
            id: `s-conv-${c.id}`,
            label: c.title ?? "Group chat",
            group: "Messages",
            category: "Group",
            icon: "chat",
            run: () => router.push(`/messages/${c.id}`),
          });
        }
      }
      if (mailR.status === "fulfilled") {
        for (const t of mailR.value.slice(0, 4)) {
          items.push({
            id: `s-mail-${t.id}`,
            label: t.subject || "(no subject)",
            group: "Mail",
            category: "Mail",
            icon: "send",
            run: () => router.push("/mail"),
          });
        }
      }

      setSearchResults(items);
      setSearching(false);
    }, 300);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, repo, router]);

  // ── Combined item list ────────────────────────────────────────────────────

  const allItems = useMemo<NavCommand[]>(() => {
    const q = query.trim();
    if (!q) return quickActions;
    const staticMatches = matchCommands([...quickActions, ...navCommands], q);
    return [...staticMatches, ...searchResults];
  }, [query, quickActions, navCommands, searchResults]);

  const active = allItems.length === 0 ? -1 : Math.min(selected, allItems.length - 1);

  // ── Open / keyboard ───────────────────────────────────────────────────────

  const isWorkspace = pathname.startsWith("/workspace");

  const openPalette = useCallback(() => {
    setQuery("");
    setSelected(0);
    setSearchResults([]);
    setOpen(true);
  }, []);

  useEffect(() => {
    if (isWorkspace) return;
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.isContentEditable) return;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        openPalette();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isWorkspace, openPalette]);

  // Custom event hook so other components can open the palette imperatively
  useEffect(() => {
    window.addEventListener("cowork:open-palette", openPalette);
    return () => window.removeEventListener("cowork:open-palette", openPalette);
  }, [openPalette]);

  // ── Scroll active row into view ───────────────────────────────────────────

  const activeRow = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    activeRow.current?.scrollIntoView({ block: "nearest" });
  }, [active]);

  if (!open) return null;

  const q = query.trim();
  const hasResults = allItems.length > 0;

  return (
    /* Blurred overlay — closes on click-outside */
    <div
      className="fixed inset-0 z-[95] flex items-start justify-center bg-black/40 px-4 pt-[18vh] backdrop-blur-md"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) setOpen(false);
      }}
    >
      {/* Spotlight-style glass panel */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Search"
        className="snap-in frost-panel flex w-full max-w-[600px] flex-col overflow-hidden rounded-[22px] shadow-[0_28px_72px_rgba(0,0,0,0.4)]"
        style={{ maxHeight: "min(72vh, 36rem)" }}
      >
        {/* Search row — tall, like Spotlight */}
        <div className="flex shrink-0 items-center gap-4 px-5 py-4">
          {searching ? (
            <span className="h-5 w-5 shrink-0 animate-spin rounded-full border-2 border-ink-faint border-t-ink-muted" />
          ) : (
            <Icon.search className="h-5 w-5 shrink-0 text-ink-muted" />
          )}
          <input
            autoFocus
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            data-form-type="other"
            data-lpignore="true"
            data-1p-ignore="true"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelected(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault();
                if (query) {
                  setQuery("");
                  setSearchResults([]);
                } else {
                  setOpen(false);
                }
              } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                e.preventDefault();
                setSelected((i) =>
                  moveSelection(i, e.key === "ArrowDown" ? 1 : -1, allItems.length),
                );
              } else if (e.key === "Enter") {
                e.preventDefault();
                const command = allItems[active];
                if (!command) return;
                setOpen(false);
                command.run();
              }
            }}
            role="combobox"
            aria-expanded="true"
            aria-controls="gcmd-list"
            aria-activedescendant={active >= 0 ? `gcmd-${allItems[active]!.id}` : undefined}
            aria-label="Search"
            placeholder="Search or jump to…"
            style={{
              background: "transparent",
              WebkitBoxShadow: "0 0 0 1000px transparent inset",
              boxShadow: "0 0 0 1000px transparent inset",
              colorScheme: "inherit",
            }}
            className="min-w-0 flex-1 text-[16px] font-normal text-ink outline-none placeholder:text-ink-faint/60"
          />
          {query ? (
            <button
              type="button"
              onClick={() => { setQuery(""); setSelected(0); setSearchResults([]); }}
              aria-label="Clear"
              className="shrink-0 rounded-full p-1 text-ink-faint transition-colors hover:text-ink"
            >
              <Icon.close className="h-4 w-4" />
            </button>
          ) : (
            <kbd className="shrink-0 rounded-lg bg-black/10 px-2 py-1 text-[11px] leading-none text-ink-faint dark:bg-white/10">
              Esc
            </kbd>
          )}
        </div>

        {/* Divider + results — only rendered when there's content */}
        {hasResults && (
          <>
            <div className="mx-0 shrink-0 border-t border-black/8 dark:border-white/8" />
            <div className="min-h-0 flex-1 overflow-y-auto scroll-slim">
              {/* Empty-query state: quick actions heading */}
              {!q && (
                <p className="px-5 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-widest text-ink-faint/60">
                  Quick actions
                </p>
              )}

              <ul id="gcmd-list" role="listbox" aria-label="Search results" className="pb-2 pt-1">
                {allItems.map((command, index) => {
                  const on = index === active;
                  const Ico = command.icon ? Icon[command.icon] : null;

                  return (
                    <li key={command.id}>
                      <button
                        type="button"
                        ref={on ? activeRow : undefined}
                        id={`gcmd-${command.id}`}
                        role="option"
                        aria-selected={on}
                        onPointerMove={() => setSelected(index)}
                        onClick={() => {
                          setOpen(false);
                          command.run();
                        }}
                        className={`flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors ${
                          on
                            ? "bg-black/8 dark:bg-white/10"
                            : "hover:bg-black/5 dark:hover:bg-white/7"
                        }`}
                      >
                        {/* Icon chip */}
                        <span
                          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-xl transition-colors ${
                            on
                              ? "bg-black/10 dark:bg-white/15"
                              : "bg-black/7 dark:bg-white/10"
                          }`}
                        >
                          {Ico ? (
                            <Ico className="h-[15px] w-[15px] text-ink-muted" />
                          ) : null}
                        </span>

                        {/* Label */}
                        <span className="min-w-0 flex-1 truncate text-[14px] text-ink">
                          {command.label}
                        </span>

                        {/* Category badge */}
                        {command.category && (
                          <span className="shrink-0 rounded-full bg-black/6 px-2 py-0.5 text-[10.5px] text-ink-faint dark:bg-white/8">
                            {command.category}
                          </span>
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          </>
        )}

        {/* No results */}
        {q && !searching && allItems.length === 0 && (
          <>
            <div className="mx-0 shrink-0 border-t border-black/8 dark:border-white/8" />
            <p className="px-5 py-8 text-center text-[13px] text-ink-faint">
              No results for &ldquo;{q}&rdquo;
            </p>
          </>
        )}

        {/* Compact footer */}
        <div className="flex shrink-0 items-center gap-3 px-5 py-2.5 text-[11px] text-ink-faint/50">
          <span>↑↓ navigate</span>
          <span>↵ open</span>
          <span className="ml-auto">Esc close</span>
        </div>
      </div>
    </div>
  );
}
