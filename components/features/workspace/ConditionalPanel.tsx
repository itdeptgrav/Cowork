"use client";

import { useState } from "react";
import { Icon } from "@/components/ui/Icons";
import {
  describeConditional,
  rangeToRect,
  type ConditionalKind,
  type ConditionalRule,
  type ConditionalStyle,
  type IconSet,
} from "@/lib/rules/sheets/grid";

/**
 * The conditional-formatting panel.
 *
 * A right-side surface that replaces the old prompt-driven dropdown: a reorderable
 * list of rules on top, and — for the one you expand — a condition builder below.
 * The preview is the sheet itself: every edit writes straight to the shared rule,
 * which the grid re-paints live, so there is no mock to keep in sync. It reuses the
 * app's frost-panel material, hairlines and control tokens throughout.
 */

const KIND_GROUPS: {
  label: string;
  kinds: { k: ConditionalKind; label: string }[];
}[] = [
  {
    label: "Cell value",
    kinds: [
      { k: "greater", label: "Greater than" },
      { k: "greaterEqual", label: "Greater than or equal" },
      { k: "less", label: "Less than" },
      { k: "lessEqual", label: "Less than or equal" },
      { k: "equal", label: "Equal to" },
      { k: "notEqual", label: "Not equal to" },
      { k: "between", label: "Between" },
      { k: "notBetween", label: "Not between" },
    ],
  },
  {
    label: "Text",
    kinds: [
      { k: "textContains", label: "Text contains" },
      { k: "textStarts", label: "Text starts with" },
      { k: "textEnds", label: "Text ends with" },
    ],
  },
  {
    label: "Ranking",
    kinds: [
      { k: "top", label: "Top N items" },
      { k: "bottom", label: "Bottom N items" },
      { k: "topPercent", label: "Top N%" },
      { k: "bottomPercent", label: "Bottom N%" },
      { k: "aboveAvg", label: "Above average" },
      { k: "belowAvg", label: "Below average" },
    ],
  },
  {
    label: "Content",
    kinds: [
      { k: "blank", label: "Is blank" },
      { k: "notBlank", label: "Is not blank" },
      { k: "error", label: "Has an error" },
      { k: "duplicate", label: "Duplicate values" },
      { k: "unique", label: "Unique values" },
    ],
  },
  {
    label: "Scales & icons",
    kinds: [
      { k: "colorScale", label: "Colour scale" },
      { k: "dataBar", label: "Data bar" },
      { k: "iconSet", label: "Icon set" },
    ],
  },
];

/** Quick fill presets, so the common cases are one click. */
const PRESETS: { label: string; style: ConditionalStyle }[] = [
  { label: "Red", style: { bg: "#ffc7ce", textColor: "#9c0006" } },
  { label: "Yellow", style: { bg: "#ffeb9c", textColor: "#9c6500" } },
  { label: "Green", style: { bg: "#c6efce", textColor: "#006100" } },
  { label: "Blue", style: { bg: "#cfe2ff", textColor: "#084298" } },
];

const single = new Set<ConditionalKind>([
  "greater",
  "greaterEqual",
  "less",
  "lessEqual",
  "equal",
  "notEqual",
]);
const isScale = (k: ConditionalKind) => k === "colorScale";
const isBar = (k: ConditionalKind) => k === "dataBar";
const isIcon = (k: ConditionalKind) => k === "iconSet";
const isVisual = (k: ConditionalKind) => isScale(k) || isBar(k) || isIcon(k);

export function ConditionalPanel({
  rules,
  selectedRule,
  selectionRange,
  readOnly,
  onAdd,
  onUpdate,
  onRemove,
  onDuplicate,
  onMove,
  onSelectRule,
  onClose,
}: {
  rules: ConditionalRule[];
  selectedRule: string | null;
  selectionRange: string | null;
  readOnly: boolean;
  onAdd: (kind: ConditionalKind) => void;
  onUpdate: (id: string, patch: Partial<ConditionalRule>) => void;
  onRemove: (id: string) => void;
  onDuplicate: (id: string) => void;
  onMove: (id: string, toIndex: number) => void;
  onSelectRule: (id: string | null) => void;
  onClose: () => void;
}) {
  const [dragId, setDragId] = useState<string | null>(null);
  const rule = rules.find((r) => r.id === selectedRule) ?? null;

  return (
    <aside
      aria-label="Conditional formatting"
      className="flex w-72 shrink-0 flex-col border-l border-hairline bg-[var(--frost-panel)]"
    >
      <div className="flex items-center gap-2 border-b border-hairline px-3 py-2.5">
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-ink">
          Conditional formatting
        </span>
        <button
          type="button"
          aria-label="Close conditional formatting"
          onClick={onClose}
          className="grid h-6 w-6 place-items-center rounded-inset text-ink-faint hover:bg-[var(--control)] hover:text-ink"
        >
          <Icon.close className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto scroll-slim">
        {/* Rule list */}
        <div className="px-3 py-3">
          <p className="mb-1.5 text-[10px] font-medium uppercase tracking-wide text-ink-faint">
            Rules {rules.length > 0 && `· ${rules.length}`}
          </p>
          {rules.length === 0 ? (
            <p className="rounded-inset bg-[var(--control)] px-3 py-3 text-[11px] text-ink-muted">
              No rules yet. Add one below — it applies to{" "}
              <span data-figure>{selectionRange ?? "the selection"}</span>.
            </p>
          ) : (
            <ul className="space-y-1">
              {rules.map((r, i) => (
                <li
                  key={r.id}
                  draggable={!readOnly}
                  onDragStart={() => setDragId(r.id)}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    if (dragId && dragId !== r.id) onMove(dragId, i);
                    setDragId(null);
                  }}
                  className={`group flex items-center gap-1.5 rounded-inset border px-2 py-1.5 ${
                    selectedRule === r.id
                      ? "border-[var(--accent,#6b8afd)] bg-[var(--control)]"
                      : "border-transparent hover:bg-[var(--control)]"
                  }`}
                >
                  {!readOnly && (
                    <span
                      aria-hidden="true"
                      title="Drag to reorder"
                      className="cursor-grab select-none text-[11px] text-ink-faint"
                    >
                      ⋮⋮
                    </span>
                  )}
                  <button
                    type="button"
                    role="switch"
                    aria-checked={r.enabled !== false}
                    aria-label="Rule enabled"
                    disabled={readOnly}
                    /* Enabling drops the field back to its default (absent = on)
                       rather than storing a redundant `true`. */
                    onClick={() =>
                      onUpdate(r.id, {
                        enabled: r.enabled === false ? undefined : false,
                      })
                    }
                    className={`relative h-3.5 w-6 shrink-0 rounded-full transition-colors ${
                      r.enabled !== false ? "bg-ink" : "bg-[var(--control-hover)]"
                    }`}
                  >
                    <span
                      className="absolute top-0.5 h-2.5 w-2.5 rounded-full bg-[var(--doc-page)] transition-all"
                      style={{ left: r.enabled !== false ? 12 : 2 }}
                    />
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      onSelectRule(selectedRule === r.id ? null : r.id)
                    }
                    className="min-w-0 flex-1 text-left"
                  >
                    <span
                      className={`block truncate text-[11px] ${
                        r.enabled !== false ? "text-ink" : "text-ink-faint line-through"
                      }`}
                    >
                      {describeConditional(r)}
                    </span>
                    <span className="block truncate text-[10px] text-ink-faint">
                      {r.range}
                      {r.stopIfTrue ? " · stop if true" : ""}
                    </span>
                  </button>
                  <PreviewSwatch rule={r} />
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Add a rule */}
        {!readOnly && (
          <div className="border-t border-hairline px-3 py-3">
            <label className="mb-1.5 block text-[10px] font-medium uppercase tracking-wide text-ink-faint">
              Add a rule
            </label>
            <select
              aria-label="Add a conditional-formatting rule"
              value=""
              onChange={(e) => {
                if (e.target.value) onAdd(e.target.value as ConditionalKind);
              }}
              className="h-8 w-full rounded-inset border border-hairline bg-[var(--doc-page)] px-2 text-[12px] text-ink outline-none hover:bg-[var(--control)]"
            >
              <option value="">Choose a condition…</option>
              {KIND_GROUPS.map((g) => (
                <optgroup key={g.label} label={g.label}>
                  {g.kinds.map((k) => (
                    <option key={k.k} value={k.k}>
                      {k.label}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </div>
        )}

        {/* Editor for the expanded rule */}
        {rule && !readOnly && (
          <RuleEditor
            rule={rule}
            selectionRange={selectionRange}
            onUpdate={(patch) => onUpdate(rule.id, patch)}
            onRemove={() => onRemove(rule.id)}
            onDuplicate={() => onDuplicate(rule.id)}
          />
        )}
      </div>
    </aside>
  );
}

/** A tiny sample of what a rule paints, so the list reads at a glance. */
function PreviewSwatch({ rule }: { rule: ConditionalRule }) {
  const bg = rule.style?.bg ?? rule.color;
  if (isBar(rule.kind))
    return (
      <span className="h-4 w-6 shrink-0 overflow-hidden rounded-[3px] border border-hairline">
        <span
          className="block h-full"
          style={{ width: "65%", background: rule.color ?? "#5b9bd5" }}
        />
      </span>
    );
  if (isScale(rule.kind)) {
    const lo = rule.minColor ?? "#f8696b";
    const hi = rule.maxColor ?? "#63be7b";
    /* Two stops unless a midpoint is set — matching how scaleColor interpolates,
       so the swatch previews what the cells will actually get. */
    const grad = rule.midColor
      ? `linear-gradient(90deg, ${lo}, ${rule.midColor}, ${hi})`
      : `linear-gradient(90deg, ${lo}, ${hi})`;
    return (
      <span
        className="h-4 w-6 shrink-0 rounded-[3px] border border-hairline"
        style={{ background: grad }}
      />
    );
  }
  if (isIcon(rule.kind))
    return <span className="shrink-0 text-[11px]">▲</span>;
  return (
    <span
      className="grid h-4 w-6 shrink-0 place-items-center rounded-[3px] border border-hairline text-[9px]"
      style={{
        background: bg ?? "transparent",
        color: rule.style?.textColor ?? "var(--ink)",
        fontWeight: rule.style?.bold ? 700 : 400,
      }}
    >
      123
    </span>
  );
}

function RuleEditor({
  rule,
  selectionRange,
  onUpdate,
  onRemove,
  onDuplicate,
}: {
  rule: ConditionalRule;
  selectionRange: string | null;
  onUpdate: (patch: Partial<ConditionalRule>) => void;
  onRemove: () => void;
  onDuplicate: () => void;
}) {
  const k = rule.kind;
  const rangeOk = rangeToRect(rule.range) !== null;
  /* Merge into the style, drop any key cleared to undefined, and collapse an
     emptied style to undefined so the rule falls back to its default fill. */
  const setStyle = (patch: Partial<ConditionalStyle>) => {
    const merged = { ...rule.style, ...patch } as Record<string, unknown>;
    for (const key of Object.keys(merged))
      if (merged[key] === undefined) delete merged[key];
    onUpdate({
      style: Object.keys(merged).length ? (merged as ConditionalStyle) : undefined,
    });
  };

  return (
    <div className="space-y-4 border-t border-hairline bg-[var(--surface-sunken)] px-3 py-3">
      <p className="text-[10px] font-medium uppercase tracking-wide text-ink-faint">
        Edit rule
      </p>

      {/* Apply to range */}
      <Field label="Apply to range">
        <div className="flex gap-1">
          <input
            value={rule.range}
            onChange={(e) => onUpdate({ range: e.target.value.toUpperCase() })}
            className={`min-w-0 flex-1 rounded-inset border bg-[var(--doc-page)] px-2 py-1 text-[12px] text-ink outline-none focus:border-[var(--accent,#6b8afd)] ${
              rangeOk ? "border-hairline" : "border-[var(--state-overdue-ink)]"
            }`}
            placeholder="A1:B10"
          />
          {selectionRange && selectionRange !== rule.range && (
            <button
              type="button"
              title="Use the current selection"
              onClick={() => onUpdate({ range: selectionRange })}
              className="shrink-0 rounded-inset bg-[var(--control)] px-2 text-[11px] text-ink-muted hover:text-ink"
            >
              Use selection
            </button>
          )}
        </div>
        {!rangeOk && (
          <p className="mt-1 text-[10px] text-[var(--state-overdue-ink)]">
            Not a valid range — e.g. A1:B10.
          </p>
        )}
      </Field>

      {/* Condition inputs */}
      {single.has(k) && (
        <Field label="Value">
          <NumberInput
            value={rule.value ?? 0}
            onChange={(v) => onUpdate({ value: v })}
          />
        </Field>
      )}
      {(k === "between" || k === "notBetween") && (
        <div className="flex gap-2">
          <Field label="Low" className="flex-1">
            <NumberInput
              value={rule.value ?? 0}
              onChange={(v) => onUpdate({ value: v })}
            />
          </Field>
          <Field label="High" className="flex-1">
            <NumberInput
              value={rule.value2 ?? 0}
              onChange={(v) => onUpdate({ value2: v })}
            />
          </Field>
        </div>
      )}
      {(k === "textContains" || k === "textStarts" || k === "textEnds") && (
        <Field label="Text">
          <input
            value={rule.text ?? ""}
            onChange={(e) => onUpdate({ text: e.target.value })}
            className="w-full rounded-inset border border-hairline bg-[var(--doc-page)] px-2 py-1 text-[12px] text-ink outline-none focus:border-[var(--accent,#6b8afd)]"
            placeholder="e.g. draft"
          />
        </Field>
      )}
      {(k === "top" || k === "bottom") && (
        <Field label="How many">
          <NumberInput
            value={rule.value ?? 10}
            min={1}
            onChange={(v) => onUpdate({ value: Math.max(1, Math.round(v)) })}
          />
        </Field>
      )}
      {(k === "topPercent" || k === "bottomPercent") && (
        <Field label="Percent">
          <NumberInput
            value={rule.value ?? 10}
            min={1}
            max={100}
            onChange={(v) =>
              onUpdate({ value: Math.max(1, Math.min(100, Math.round(v))) })
            }
          />
        </Field>
      )}

      {/* Formatting */}
      {!isVisual(k) && (
        <Field label="Format">
          <div className="mb-2 flex flex-wrap gap-1">
            {PRESETS.map((p) => (
              <button
                key={p.label}
                type="button"
                title={p.label}
                onClick={() => setStyle(p.style)}
                className="h-6 w-9 rounded-[4px] border border-hairline text-[9px]"
                style={{ background: p.style.bg, color: p.style.textColor }}
              >
                123
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <ColorField
              label="Fill"
              value={rule.style?.bg ?? rule.color}
              onChange={(v) => setStyle({ bg: v })}
              onClear={() => setStyle({ bg: undefined })}
            />
            <ColorField
              label="Text"
              value={rule.style?.textColor}
              onChange={(v) => setStyle({ textColor: v })}
              onClear={() => setStyle({ textColor: undefined })}
            />
          </div>
          <div className="mt-2 flex gap-1">
            <MiniToggle
              label="B"
              active={!!rule.style?.bold}
              onClick={() => setStyle({ bold: !rule.style?.bold })}
              bold
            />
            <MiniToggle
              label="I"
              active={!!rule.style?.italic}
              onClick={() => setStyle({ italic: !rule.style?.italic })}
              italic
            />
            <MiniToggle
              label="Border"
              active={!!rule.style?.border}
              onClick={() => setStyle({ border: !rule.style?.border })}
            />
          </div>
        </Field>
      )}

      {isBar(k) && (
        <Field label="Bar colour">
          <ColorField
            label="Bar"
            value={rule.color ?? "#5b9bd5"}
            onChange={(v) => onUpdate({ color: v })}
          />
        </Field>
      )}
      {isScale(k) && (
        <Field label="Scale colours">
          <div className="flex items-center gap-2">
            <ColorField
              label="Low"
              value={rule.minColor ?? "#f8696b"}
              onChange={(v) => onUpdate({ minColor: v })}
            />
            <ColorField
              label="Mid"
              value={rule.midColor}
              onChange={(v) => onUpdate({ midColor: v })}
              onClear={() => onUpdate({ midColor: undefined })}
            />
            <ColorField
              label="High"
              value={rule.maxColor ?? "#63be7b"}
              onChange={(v) => onUpdate({ maxColor: v })}
            />
          </div>
        </Field>
      )}
      {isIcon(k) && (
        <Field label="Icon set">
          <div className="flex gap-1">
            {(["arrows", "traffic", "flags"] as IconSet[]).map((s) => (
              <button
                key={s}
                type="button"
                aria-pressed={(rule.iconSet ?? "arrows") === s}
                onClick={() => onUpdate({ iconSet: s })}
                className={`flex-1 rounded-inset px-2 py-1 text-[11px] capitalize transition-colors ${
                  (rule.iconSet ?? "arrows") === s
                    ? "bg-ink text-[var(--body-bg)]"
                    : "bg-[var(--control)] text-ink-muted hover:text-ink"
                }`}
              >
                {s}
              </button>
            ))}
          </div>
        </Field>
      )}

      {/* Stop if true */}
      <label className="flex cursor-pointer items-center justify-between gap-2 text-[12px]">
        <span className="text-ink-muted">Stop if true</span>
        <button
          type="button"
          role="switch"
          aria-checked={!!rule.stopIfTrue}
          aria-label="Stop if true"
          onClick={() => onUpdate({ stopIfTrue: !rule.stopIfTrue })}
          className={`relative h-4 w-7 shrink-0 rounded-full transition-colors ${
            rule.stopIfTrue ? "bg-ink" : "bg-[var(--control)]"
          }`}
        >
          <span
            className="absolute top-0.5 h-3 w-3 rounded-full bg-[var(--doc-page)] transition-all"
            style={{ left: rule.stopIfTrue ? 14 : 2 }}
          />
        </button>
      </label>

      <div className="flex gap-2 pt-1">
        <button
          type="button"
          onClick={onDuplicate}
          className="flex-1 rounded-inset bg-[var(--control)] px-2 py-1.5 text-[12px] text-ink hover:bg-[var(--control-hover)]"
        >
          Duplicate
        </button>
        <button
          type="button"
          onClick={onRemove}
          className="flex-1 rounded-inset bg-[color-mix(in_srgb,var(--state-overdue)_18%,transparent)] px-2 py-1.5 text-[12px] text-[var(--state-overdue-ink)] hover:bg-[color-mix(in_srgb,var(--state-overdue)_28%,transparent)]"
        >
          Delete
        </button>
      </div>
    </div>
  );
}

function Field({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={className}>
      <p className="mb-1 text-[10px] font-medium uppercase tracking-wide text-ink-faint">
        {label}
      </p>
      {children}
    </div>
  );
}

function NumberInput({
  value,
  min,
  max,
  onChange,
}: {
  value: number;
  min?: number;
  max?: number;
  onChange: (value: number) => void;
}) {
  return (
    <input
      type="number"
      value={Number.isFinite(value) ? value : 0}
      min={min}
      max={max}
      onChange={(e) => {
        const n = Number(e.target.value);
        if (Number.isFinite(n)) onChange(n);
      }}
      className="w-full rounded-inset border border-hairline bg-[var(--doc-page)] px-2 py-1 text-[12px] text-ink outline-none focus:border-[var(--accent,#6b8afd)]"
    />
  );
}

function ColorField({
  label,
  value,
  onChange,
  onClear,
}: {
  label: string;
  value?: string;
  onChange: (value: string) => void;
  onClear?: () => void;
}) {
  const valid = !!value && /^#[0-9a-fA-F]{6}$/.test(value);
  return (
    <div className="flex items-center gap-1">
      <label
        title={`${label} colour`}
        className="relative grid h-7 w-7 cursor-pointer place-items-center rounded-inset border border-hairline"
        style={{ background: valid ? value : "var(--doc-page)" }}
      >
        {!valid && <span className="text-[9px] text-ink-faint">{label[0]}</span>}
        <input
          type="color"
          value={valid ? value! : "#000000"}
          onChange={(e) => onChange(e.target.value)}
          className="absolute inset-0 cursor-pointer opacity-0"
        />
      </label>
      {onClear && valid && (
        <button
          type="button"
          aria-label={`Clear ${label} colour`}
          onClick={onClear}
          className="text-[11px] text-ink-faint hover:text-ink"
        >
          ✕
        </button>
      )}
    </div>
  );
}

function MiniToggle({
  label,
  active,
  bold,
  italic,
  onClick,
}: {
  label: string;
  active: boolean;
  bold?: boolean;
  italic?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`rounded-inset px-2 py-1 text-[11px] transition-colors ${
        bold ? "font-semibold" : ""
      } ${italic ? "italic" : ""} ${
        active
          ? "bg-ink text-[var(--body-bg)]"
          : "bg-[var(--control)] text-ink-muted hover:text-ink"
      }`}
    >
      {label}
    </button>
  );
}
