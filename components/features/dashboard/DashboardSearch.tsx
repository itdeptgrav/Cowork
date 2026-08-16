"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Icon, type IconName } from "@/components/ui/Icons";
import { useRepo } from "@/lib/hooks/useRepository";

interface SearchResult {
  id: string;
  label: string;
  category: string;
  icon: IconName;
  href: string;
}

/**
 * Inline Google-style search bar for the dashboard.
 *
 * Clicking activates the input in-place — no modal, no overlay.
 * As you type (≥2 chars) results appear in a dropdown below the bar.
 * Esc or click-outside deactivates and clears.
 *
 * It fills its container and owns no outer margin — the caller places it (on the
 * dashboard it shares the active-work bar's row, in the right column).
 */
export function DashboardSearch() {
  const [active, setActive] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState(0);

  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const router = useRouter();
  const repo = useRepo();

  // Deactivate on outside click
  useEffect(() => {
    if (!active) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) {
        setActive(false);
        setQuery("");
        setResults([]);
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [active]);

  // Debounced live search
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    debounceRef.current = setTimeout(async () => {
      const lower = q.toLowerCase();
      const [tasksR, docsR, meetingsR, mailR] = await Promise.allSettled([
        repo.listTasks({ scope: "all", search: q, limit: 5 }),
        repo.listDocuments(),
        repo.listMeetings(),
        repo.listMailThreads({ folder: "inbox", search: q }),
      ]);

      const items: SearchResult[] = [];

      if (tasksR.status === "fulfilled") {
        for (const tv of tasksR.value.items.slice(0, 4)) {
          items.push({
            id: `t-${tv.task.id}`,
            label: tv.task.title,
            category: "Task",
            icon: "tasks",
            href: `/tasks/${tv.task.id}`,
          });
        }
      }
      if (docsR.status === "fulfilled") {
        for (const d of docsR.value
          .filter((d) => d.title.toLowerCase().includes(lower))
          .slice(0, 3)) {
          items.push({
            id: `d-${d.id}`,
            label: d.title,
            category: d.kind === "sheet" ? "Sheet" : "Document",
            icon: d.kind === "sheet" ? "board" : "list",
            href: "/workspace",
          });
        }
      }
      if (meetingsR.status === "fulfilled") {
        for (const m of meetingsR.value
          .filter((m) => m.title.toLowerCase().includes(lower))
          .slice(0, 3)) {
          items.push({
            id: `m-${m.id}`,
            label: m.title,
            category: "Meeting",
            icon: "meeting",
            href: `/meetings/${m.id}`,
          });
        }
      }
      if (mailR.status === "fulfilled") {
        for (const t of mailR.value.slice(0, 3)) {
          items.push({
            id: `ml-${t.id}`,
            label: t.subject || "(no subject)",
            category: "Mail",
            icon: "send",
            href: "/mail",
          });
        }
      }

      setResults(items);
      setSearching(false);
      setSelected(0);
    }, 280);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, repo]);

  function open() {
    setActive(true);
    setTimeout(() => inputRef.current?.focus(), 0);
  }

  function close() {
    setActive(false);
    setQuery("");
    setResults([]);
    setSearching(false);
    inputRef.current?.blur();
  }

  function navigate(href: string) {
    close();
    router.push(href);
  }

  const showDropdown =
    active && query.trim().length >= 2 && (searching || results.length > 0);

  return (
    <div ref={containerRef} className="relative w-full">
      {/* Search bar */}
      <div
        role="button"
        tabIndex={active ? -1 : 0}
        onClick={open}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") open(); }}
        className={`flex items-center gap-3 rounded-full border px-5 py-3.5 transition-all ${
          active
            ? "cursor-default border-ink/20 bg-[var(--surface-raised)] shadow-md ring-1 ring-ink/5"
            : "cursor-text border-hairline bg-[var(--surface-raised)] shadow-sm hover:border-ink/20 hover:shadow-md"
        }`}
      >
        <Icon.search
          className={`h-4 w-4 shrink-0 transition-colors ${active ? "text-ink-muted" : "text-ink-faint"}`}
        />

        <input
          ref={inputRef}
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
          onFocus={() => setActive(true)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              close();
            } else if (e.key === "ArrowDown") {
              e.preventDefault();
              setSelected((s) => Math.min(s + 1, results.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setSelected((s) => Math.max(s - 1, 0));
            } else if (e.key === "Enter" && results[selected]) {
              navigate(results[selected].href);
            }
          }}
          placeholder="Search tasks, docs, meetings, mail…"
          className="min-w-0 flex-1 bg-transparent text-[14px] text-ink outline-none placeholder:text-ink-faint"
          style={{
            WebkitBoxShadow: "0 0 0 1000px transparent inset",
            boxShadow: "0 0 0 1000px transparent inset",
            colorScheme: "inherit",
          }}
        />

        {/* Right badge */}
        {active && query ? (
          <button
            type="button"
            onPointerDown={(e) => e.preventDefault()}
            onClick={() => { setQuery(""); setResults([]); inputRef.current?.focus(); }}
            className="shrink-0 rounded-full p-1 text-ink-faint transition-colors hover:text-ink"
            aria-label="Clear"
          >
            <Icon.close className="h-3 w-3" />
          </button>
        ) : (
          <span className="hidden shrink-0 rounded-full bg-[var(--control)] px-2.5 py-1 text-[11px] leading-none text-ink-faint sm:block">
            {active ? "Esc" : "⌘K"}
          </span>
        )}
      </div>

      {/* Inline dropdown — no backdrop, no overlay */}
      {showDropdown && (
        <div className="absolute left-0 right-0 top-[calc(100%+6px)] z-50 overflow-hidden rounded-[18px] border border-hairline bg-[var(--surface-raised)] shadow-[0_16px_40px_rgba(0,0,0,0.18)]">
          {searching && results.length === 0 ? (
            <div className="px-5 py-4 text-[13px] text-ink-faint">
              Searching…
            </div>
          ) : results.length === 0 ? (
            <div className="px-5 py-4 text-[13px] text-ink-faint">
              No results for &ldquo;{query.trim()}&rdquo;
            </div>
          ) : (
            <ul className="py-1.5">
              {results.map((r, i) => {
                const Ico = Icon[r.icon];
                const on = i === selected;
                return (
                  <li key={r.id}>
                    <button
                      type="button"
                      onPointerDown={(e) => e.preventDefault()}
                      onPointerMove={() => setSelected(i)}
                      onClick={() => navigate(r.href)}
                      className={`flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors ${
                        on
                          ? "bg-[var(--control-active)]"
                          : "hover:bg-[var(--control)]"
                      }`}
                    >
                      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[var(--control)]">
                        <Ico className="h-3.5 w-3.5 text-ink-muted" />
                      </span>
                      <span className="min-w-0 flex-1 truncate text-[13.5px] text-ink">
                        {r.label}
                      </span>
                      <span className="shrink-0 text-[11px] text-ink-faint">
                        {r.category}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
