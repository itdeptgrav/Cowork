"use client";

/**
 * The filter card — XMind's "filter by marker". Pick a tag, a priority, a
 * progress, words, or task-linked cards, and the map dims everything else
 * (the path to each match stays bright). Nothing moves or hides; clearing
 * the filter is the whole map again.
 */

import type { MindPriority, MindProgress } from "@/lib/domain";
import { isEmptyFilter, matchCount, tagsInUse, type MindFilter } from "@/lib/rules/mindmap/filter";
import type { MindMap } from "@/lib/rules/mindmap/tree";

const PRIORITIES: MindPriority[] = [1, 2, 3, 4, 5];
const PROGRESS: MindProgress[] = [0, 25, 50, 75, 100];

const select =
  "h-7 rounded-inset border border-hairline bg-transparent px-1.5 text-[12px] text-ink outline-none";

export function MindMapFilterPanel({ map, filter, onChange }: { map: MindMap; filter: MindFilter | null; onChange: (f: MindFilter | null) => void }) {
  const f = filter ?? {};
  const tags = tagsInUse(map);
  const set = (patch: Partial<MindFilter>) => {
    const next: MindFilter = { ...f, ...patch };
    for (const k of Object.keys(next) as (keyof MindFilter)[]) if (next[k] === undefined || next[k] === "" || next[k] === false) delete next[k];
    onChange(isEmptyFilter(next) ? null : next);
  };
  const count = matchCount(map, f);
  return (
    <div className="flex w-[260px] flex-col gap-2 p-2 text-[12px] text-ink">
      <p className="text-[11px] font-medium text-ink">Show only cards that…</p>
      <label className="flex flex-col gap-1">
        <span className="text-[11px] text-ink-muted">contain the words</span>
        <input
          value={f.text ?? ""}
          onChange={(e) => set({ text: e.target.value })}
          placeholder="in the title or notes"
          className="h-7 rounded-inset border border-hairline bg-transparent px-2 text-[12px] text-ink outline-none placeholder:text-ink-faint"
        />
      </label>
      <label className="flex items-center justify-between gap-2">
        <span className="text-ink-muted">have the tag</span>
        <select className={select} value={f.tag ?? ""} onChange={(e) => set({ tag: e.target.value || undefined })} disabled={tags.length === 0}>
          <option value="">{tags.length ? "Any" : "No tags yet"}</option>
          {tags.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </label>
      <label className="flex items-center justify-between gap-2">
        <span className="text-ink-muted">have priority</span>
        <select className={select} value={f.priority ?? ""} onChange={(e) => set({ priority: e.target.value ? (Number(e.target.value) as MindPriority) : undefined })}>
          <option value="">Any</option>
          {PRIORITIES.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
      </label>
      <label className="flex items-center justify-between gap-2">
        <span className="text-ink-muted">have progress</span>
        <select className={select} value={f.progress ?? ""} onChange={(e) => set({ progress: e.target.value ? (Number(e.target.value) as MindProgress) : undefined })}>
          <option value="">Any</option>
          {PROGRESS.map((p) => (
            <option key={p} value={p}>
              {p}%
            </option>
          ))}
        </select>
      </label>
      <label className="flex items-center gap-2">
        <input type="checkbox" checked={f.hasTask === true} onChange={(e) => set({ hasTask: e.target.checked || undefined })} />
        <span className="text-ink-muted">are linked to a task</span>
      </label>
      <div className="flex items-center justify-between border-t border-hairline pt-1.5">
        <span className="text-[11px] text-ink-faint tabular-nums" data-figure>
          {isEmptyFilter(f) ? `${map.nodes.length} cards` : `${count} of ${map.nodes.length} match`}
        </span>
        <button
          type="button"
          disabled={isEmptyFilter(f)}
          onClick={() => onChange(null)}
          className="rounded-full px-2.5 py-0.5 text-[11.5px] text-ink-muted hover:bg-[var(--control)] hover:text-ink disabled:opacity-40"
        >
          Clear
        </button>
      </div>
    </div>
  );
}

export function FilterIcon() {
  return (
    <svg viewBox="0 0 16 16" className="h-4 w-4" aria-hidden="true">
      <path d="M2 3h12l-4.5 5.5V13l-3-1.5V8.5L2 3z" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
    </svg>
  );
}
