"use client";

import { Icon } from "@/components/ui/Icons";
import { rangeToRect, type ChartSpec, type ChartType } from "@/lib/rules/sheets/grid";

/**
 * The contextual panel for the selected chart.
 *
 * A right-side surface (Excel's "Format Chart" pane, Sheets' chart editor) rather
 * than a modal, so the chart stays visible and updates live as each control
 * changes it. It reads and writes the one {@link ChartSpec} through `onChange`, so
 * every edit rides the same CRDT + persistence path as a cell edit and shows up
 * for collaborators immediately. It reuses the app's frost-panel material,
 * hairlines and control tokens — no bespoke chrome.
 */

const TYPES: { type: ChartType; label: string }[] = [
  { type: "column", label: "Column" },
  { type: "bar", label: "Bar" },
  { type: "line", label: "Line" },
  { type: "area", label: "Area" },
  { type: "pie", label: "Pie" },
  { type: "doughnut", label: "Doughnut" },
  { type: "scatter", label: "Scatter" },
  { type: "combo", label: "Combo" },
];

export function ChartPanel({
  spec,
  readOnly,
  onChange,
  onClose,
  onDelete,
  onDuplicate,
  onForward,
  onBackward,
}: {
  spec: ChartSpec;
  readOnly: boolean;
  onChange: (patch: Partial<ChartSpec>) => void;
  onClose: () => void;
  onDelete: () => void;
  onDuplicate: () => void;
  onForward: () => void;
  onBackward: () => void;
}) {
  const rangeOk = rangeToRect(spec.range) !== null;
  const stackable =
    spec.type === "column" || spec.type === "bar" || spec.type === "area";

  return (
    <aside
      aria-label="Chart settings"
      className="flex w-60 shrink-0 flex-col border-l border-hairline bg-[var(--frost-panel)]"
    >
      <div className="flex items-center gap-2 border-b border-hairline px-3 py-2.5">
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-ink">
          Chart
        </span>
        <button
          type="button"
          aria-label="Close chart settings"
          onClick={onClose}
          className="grid h-6 w-6 place-items-center rounded-inset text-ink-faint hover:bg-[var(--control)] hover:text-ink"
        >
          <Icon.close className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-3 py-3 scroll-slim">
        {/* Title */}
        <Field label="Title">
          <input
            value={spec.title}
            disabled={readOnly}
            onChange={(e) => onChange({ title: e.target.value })}
            className="w-full rounded-inset border border-hairline bg-[var(--doc-page)] px-2 py-1 text-[12px] text-ink outline-none focus:border-[var(--accent,#6b8afd)] disabled:opacity-50"
            placeholder="Chart title"
          />
        </Field>

        {/* Type */}
        <Field label="Type">
          <div className="grid grid-cols-2 gap-1">
            {TYPES.map((t) => (
              <button
                key={t.type}
                type="button"
                disabled={readOnly}
                aria-pressed={spec.type === t.type}
                onClick={() => onChange({ type: t.type })}
                className={`rounded-inset px-2 py-1 text-[11px] transition-colors disabled:opacity-50 ${
                  spec.type === t.type
                    ? "bg-ink text-[var(--body-bg)]"
                    : "bg-[var(--control)] text-ink-muted hover:text-ink"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </Field>

        {/* Data range + orientation */}
        <Field label="Data range">
          <input
            value={spec.range}
            disabled={readOnly}
            onChange={(e) => onChange({ range: e.target.value.toUpperCase() })}
            className={`w-full rounded-inset border bg-[var(--doc-page)] px-2 py-1 text-[12px] text-ink outline-none focus:border-[var(--accent,#6b8afd)] disabled:opacity-50 ${
              rangeOk ? "border-hairline" : "border-[var(--state-overdue-ink)]"
            }`}
            placeholder="A1:B10"
          />
          {!rangeOk && (
            <p className="mt-1 text-[10px] text-[var(--state-overdue-ink)]">
              Not a valid range — e.g. A1:B10.
            </p>
          )}
          <div className="mt-2 flex gap-1">
            <Seg
              label="Series in columns"
              active={(spec.orientation ?? "cols") === "cols"}
              disabled={readOnly}
              onClick={() => onChange({ orientation: "cols" })}
            >
              Columns
            </Seg>
            <Seg
              label="Series in rows"
              active={spec.orientation === "rows"}
              disabled={readOnly}
              onClick={() => onChange({ orientation: "rows" })}
            >
              Rows
            </Seg>
          </div>
        </Field>

        {/* Display toggles */}
        <Field label="Display">
          <div className="space-y-1.5">
            <Toggle
              label="Legend"
              checked={spec.legend ?? true}
              disabled={readOnly}
              onChange={(v) => onChange({ legend: v })}
            />
            <Toggle
              label="Axes & gridlines"
              checked={spec.axes ?? true}
              disabled={readOnly || spec.type === "pie" || spec.type === "doughnut"}
              onChange={(v) => onChange({ axes: v })}
            />
            <Toggle
              label="Stack series"
              checked={spec.stacked ?? false}
              disabled={readOnly || !stackable}
              onChange={(v) => onChange({ stacked: v })}
            />
          </div>
        </Field>

        {/* Arrange */}
        {!readOnly && (
          <Field label="Arrange">
            <div className="flex gap-1">
              <Seg label="Bring forward" onClick={onForward}>
                Forward
              </Seg>
              <Seg label="Send backward" onClick={onBackward}>
                Backward
              </Seg>
            </div>
          </Field>
        )}
      </div>

      {!readOnly && (
        <div className="flex items-center gap-2 border-t border-hairline px-3 py-2.5">
          <button
            type="button"
            onClick={onDuplicate}
            className="flex-1 rounded-inset bg-[var(--control)] px-2 py-1.5 text-[12px] text-ink hover:bg-[var(--control-hover)]"
          >
            Duplicate
          </button>
          <button
            type="button"
            onClick={onDelete}
            className="flex-1 rounded-inset bg-[color-mix(in_srgb,var(--state-overdue)_18%,transparent)] px-2 py-1.5 text-[12px] text-[var(--state-overdue-ink)] hover:bg-[color-mix(in_srgb,var(--state-overdue)_28%,transparent)]"
          >
            Delete
          </button>
        </div>
      )}
    </aside>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-1 text-[10px] font-medium uppercase tracking-wide text-ink-faint">
        {label}
      </p>
      {children}
    </div>
  );
}

function Seg({
  label,
  active,
  disabled,
  onClick,
  children,
}: {
  label: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      className={`flex-1 rounded-inset px-2 py-1 text-[11px] transition-colors disabled:opacity-50 ${
        active
          ? "bg-ink text-[var(--body-bg)]"
          : "bg-[var(--control)] text-ink-muted hover:text-ink"
      }`}
    >
      {children}
    </button>
  );
}

function Toggle({
  label,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label
      className={`flex items-center justify-between gap-2 text-[12px] ${
        disabled ? "opacity-50" : "cursor-pointer"
      }`}
    >
      <span className="text-ink-muted">{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`relative h-4 w-7 shrink-0 rounded-full transition-colors ${
          checked ? "bg-ink" : "bg-[var(--control)]"
        }`}
      >
        <span
          className="absolute top-0.5 h-3 w-3 rounded-full bg-[var(--doc-page)] transition-all"
          style={{ left: checked ? 14 : 2 }}
        />
      </button>
    </label>
  );
}
