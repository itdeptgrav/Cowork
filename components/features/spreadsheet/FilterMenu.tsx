"use client";

/**
 * A column's filter menu — the ▾ on a filtered header.
 *
 * It offers the two ways a spreadsheet filters a column: by VALUE (tick the
 * displayed values that pass) and by CONDITION (a number or text test). Applying
 * hands the controller a `ColumnFilter`; the controller recomputes which rows to
 * hide. It never edits data.
 */

import { useEffect, useRef, useState } from "react";
import type { ColumnFilter, FilterCondition, NumberOp, TextOp } from "@/lib/spreadsheet/filter";

const field =
  "h-7 rounded-md border border-hairline bg-[var(--surface-raised)] px-1.5 text-[12px] text-ink outline-none";

export function FilterMenu({
  x,
  y,
  values,
  current,
  onApply,
  onClose,
}: {
  x: number;
  y: number;
  values: string[];
  current: ColumnFilter | undefined;
  onApply: (filter: ColumnFilter | null) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(current?.values ?? values),
  );
  const [condKind, setCondKind] = useState<"none" | "number" | "text">(
    current?.condition ? (current.condition.type === "text" ? "text" : "number") : "none",
  );
  /* Every field seeds from the stored condition, not just the kind — otherwise
     reopening a "< 5" filter showed the defaults, and Apply silently rewrote
     the condition to "> 0". */
  const cond = current?.condition;
  const [numOp, setNumOp] = useState<NumberOp>(cond && cond.type === "number" ? cond.op : ">");
  const [numA, setNumA] = useState(cond && cond.type === "number" ? String(cond.a) : "0");
  const [textOp, setTextOp] = useState<TextOp>(cond && cond.type === "text" ? cond.op : "contains");
  const [textVal, setTextVal] = useState(cond && cond.type === "text" ? cond.value : "");

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener("mousedown", onDown, true);
    return () => document.removeEventListener("mousedown", onDown, true);
  }, [onClose]);

  function toggle(v: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(v)) next.delete(v);
      else next.add(v);
      return next;
    });
  }

  function apply() {
    const filter: ColumnFilter = {};
    if (selected.size < values.length) filter.values = [...selected];
    if (condKind === "number") {
      const cond: FilterCondition = { type: "number", op: numOp, a: Number(numA) };
      filter.condition = cond;
    } else if (condKind === "text") {
      filter.condition = { type: "text", op: textOp, value: textVal };
    }
    onApply(filter.values || filter.condition ? filter : null);
    onClose();
  }

  return (
    <div
      ref={ref}
      className="fixed z-50 flex w-56 flex-col gap-2 rounded-card border border-hairline bg-[var(--surface-raised)] p-2.5 shadow-lg"
      style={{ left: x, top: y }}
    >
      <div className="flex items-center justify-between text-[11px] text-ink-muted">
        <button type="button" className="hover:text-ink" onClick={() => setSelected(new Set(values))}>
          Select all
        </button>
        <button type="button" className="hover:text-ink" onClick={() => setSelected(new Set())}>
          Clear
        </button>
      </div>
      <div className="max-h-40 overflow-y-auto rounded-md border border-hairline p-1">
        {values.length === 0 && <div className="px-1 py-0.5 text-[12px] text-ink-faint">No values</div>}
        {values.map((v) => (
          <label key={v} className="flex items-center gap-1.5 px-1 py-0.5 text-[12px] text-ink">
            <input type="checkbox" checked={selected.has(v)} onChange={() => toggle(v)} />
            <span className="truncate">{v === "" ? "(blank)" : v}</span>
          </label>
        ))}
      </div>

      <select className={field} value={condKind} onChange={(e) => setCondKind(e.target.value as "none" | "number" | "text")}>
        <option value="none">No condition</option>
        <option value="number">By number…</option>
        <option value="text">By text…</option>
      </select>
      {condKind === "number" && (
        <div className="flex items-center gap-1">
          <select className={field} value={numOp} onChange={(e) => setNumOp(e.target.value as NumberOp)}>
            <option value=">">&gt;</option>
            <option value="<">&lt;</option>
            <option value=">=">&ge;</option>
            <option value="<=">&le;</option>
            <option value="=">=</option>
          </select>
          <input className={`${field} flex-1`} value={numA} onChange={(e) => setNumA(e.target.value)} />
        </div>
      )}
      {condKind === "text" && (
        <div className="flex items-center gap-1">
          <select className={field} value={textOp} onChange={(e) => setTextOp(e.target.value as TextOp)}>
            <option value="contains">contains</option>
            <option value="equals">equals</option>
            <option value="startsWith">starts with</option>
            <option value="endsWith">ends with</option>
          </select>
          <input className={`${field} flex-1`} value={textVal} onChange={(e) => setTextVal(e.target.value)} />
        </div>
      )}

      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          className="h-7 rounded-md px-2 text-[12px] text-ink-muted hover:text-ink"
          onClick={() => {
            onApply(null);
            onClose();
          }}
        >
          Remove
        </button>
        <button
          type="button"
          className="h-7 rounded-md bg-ink px-2.5 text-[12px] font-medium text-[var(--body-bg)] hover:opacity-90"
          onClick={apply}
        >
          Apply
        </button>
      </div>
    </div>
  );
}
