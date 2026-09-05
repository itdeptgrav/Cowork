"use client";

/**
 * The formatting toolbar — the controls that write a cell's style.
 *
 * It reads the active cell's resolved style (`controller.activeStyle`) so its
 * toggles show what is already on, and every control routes to a controller
 * action that formats the whole selection as one undoable step. It owns no cell
 * state itself; the border style/colour it keeps are just the pending choices a
 * border preset will apply.
 */

import { useState } from "react";
import type {
  BorderLineStyle,
  BorderPreset,
  CellStyle,
  HAlign,
  NumberFormatKind,
  VAlign,
} from "@/lib/spreadsheet/style";
import {
  DEFAULT_FONT_SIZE,
  fontSizeOptions,
} from "@/lib/spreadsheet/fontSizes";
import { Dropdown } from "./Dropdown";
import { SheetIcon } from "./SheetIcons";
import type { SpreadsheetController } from "./useSpreadsheet";

const FONTS: { label: string; value: string | undefined }[] = [
  { label: "Default", value: undefined },
  { label: "Sans", value: "system-ui, -apple-system, 'Segoe UI', sans-serif" },
  { label: "Serif", value: "Georgia, 'Times New Roman', serif" },
  { label: "Mono", value: "ui-monospace, 'Cascadia Code', monospace" },
];

/* The size ladder lives in lib/spreadsheet/fontSizes.ts, shared with the
   ribbon's own picker so the two cannot drift apart. */

const NUMBER_FORMATS: { label: string; value: NumberFormatKind }[] = [
  { label: "Automatic", value: "automatic" },
  { label: "Number", value: "number" },
  { label: "Currency", value: "currency" },
  { label: "Percent", value: "percent" },
  { label: "Scientific", value: "scientific" },
  { label: "Date", value: "date" },
  { label: "Time", value: "time" },
  { label: "Date time", value: "datetime" },
];

const BORDER_STYLES: BorderLineStyle[] = [
  "thin",
  "medium",
  "thick",
  "dashed",
  "dotted",
  "double",
];

const BORDER_PRESETS: { label: string; value: BorderPreset }[] = [
  { label: "All", value: "all" },
  { label: "Outer", value: "outer" },
  { label: "Top", value: "top" },
  { label: "Bottom", value: "bottom" },
  { label: "Left", value: "left" },
  { label: "Right", value: "right" },
  { label: "None", value: "none" },
];

function Divider() {
  return <span aria-hidden className="mx-0.5 h-5 w-px shrink-0 bg-[var(--color-hairline)]" />;
}

function ToolButton({
  active,
  onClick,
  title,
  children,
}: {
  active?: boolean;
  onClick: () => void;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-pressed={active}
      onMouseDown={(e) => e.preventDefault()} // keep the grid's selection/focus
      onClick={onClick}
      className={`inline-flex h-7 min-w-7 items-center justify-center rounded-md px-1.5 text-[13px] transition-colors ${
        active
          ? "bg-[color-mix(in_srgb,var(--ink)_14%,transparent)] text-ink"
          : "text-ink-muted hover:bg-[color-mix(in_srgb,var(--ink)_7%,transparent)] hover:text-ink"
      }`}
    >
      {children}
    </button>
  );
}

const selectClass =
  "h-7 rounded-md border border-hairline bg-[var(--surface-raised)] px-1.5 text-[12px] text-ink outline-none";

function ColorControl({
  title,
  glyph,
  value,
  onPick,
  onClear,
}: {
  title: string;
  /** The icon over the colour bar — the "A" for text, the bucket for fill. */
  glyph: React.ReactNode;
  value: string | undefined;
  onPick: (color: string) => void;
  onClear: () => void;
}) {
  return (
    <span
      className="relative inline-flex h-7 items-center"
      title={title}
      onMouseDown={(e) => e.preventDefault()}
    >
      <label className="inline-flex h-7 cursor-pointer flex-col items-center justify-center rounded-md px-1 text-ink-muted hover:bg-[color-mix(in_srgb,var(--ink)_7%,transparent)] hover:text-ink">
        <span className="leading-none">{glyph}</span>
        <span
          className="mt-0.5 h-[3px] w-4 rounded-full"
          style={{ background: value ?? "var(--color-hairline)" }}
        />
        <input
          type="color"
          aria-label={title}
          value={value ?? "#000000"}
          onChange={(e) => onPick(e.target.value)}
          className="sr-only"
        />
      </label>
      {value && (
        <button
          type="button"
          title={`Clear ${title.toLowerCase()}`}
          onMouseDown={(e) => e.preventDefault()}
          onClick={onClear}
          className="text-ink-faint hover:text-ink"
        >
          ×
        </button>
      )}
    </span>
  );
}

export function SpreadsheetToolbar({
  controller,
  variant = "bar",
}: {
  controller: SpreadsheetController;
  /** `"ribbon"` drops the outer card, since the ribbon supplies it. */
  variant?: "bar" | "ribbon";
}) {
  const s: CellStyle = controller.activeStyle;
  const [borderStyle, setBorderStyle] = useState<BorderLineStyle>("thin");
  const [borderColor, setBorderColor] = useState("#111111");

  const set = (patch: Partial<CellStyle>) => controller.applyFormat(patch);
  const numberKind = s.numberFormat?.kind ?? "automatic";
  const decimals = s.numberFormat?.decimals;

  function setNumberFormat(kind: NumberFormatKind) {
    if (kind === "automatic") {
      set({ numberFormat: undefined });
    } else {
      set({ numberFormat: { kind, decimals, currency: s.numberFormat?.currency } });
    }
  }

  function stepDecimals(delta: number) {
    if (numberKind === "automatic") {
      /* Adjusting decimals on an unformatted cell implies the plain Number
         format — the same affordance a spreadsheet gives. */
      set({ numberFormat: { kind: "number", decimals: Math.max(0, (decimals ?? 2) + delta) } });
      return;
    }
    set({
      numberFormat: {
        kind: numberKind,
        decimals: Math.max(0, (decimals ?? 2) + delta),
        currency: s.numberFormat?.currency,
      },
    });
  }

  return (
    <div
      className={
        variant === "ribbon"
          ? "flex flex-wrap items-center gap-0.5"
          : "flex shrink-0 flex-wrap items-center gap-0.5 rounded-card border border-hairline bg-[var(--surface-raised)] px-2 py-1"
      }
    >
      {/* Font family + size. */}
      <select
        aria-label="Font"
        title="Font"
        className={selectClass}
        value={s.fontFamily ?? ""}
        onMouseDown={(e) => e.stopPropagation()}
        onChange={(e) => set({ fontFamily: e.target.value || undefined })}
      >
        {FONTS.map((f) => (
          <option key={f.label} value={f.value ?? ""}>
            {f.label}
          </option>
        ))}
      </select>
      <select
        aria-label="Font size"
        title="Font size"
        className={`${selectClass} ml-0.5 w-14`}
        value={s.fontSize ?? DEFAULT_FONT_SIZE}
        onChange={(e) => set({ fontSize: Number(e.target.value) === DEFAULT_FONT_SIZE ? undefined : Number(e.target.value) })}
      >
        {fontSizeOptions(s.fontSize ?? DEFAULT_FONT_SIZE).map((size) => (
          <option key={size} value={size}>
            {size}
          </option>
        ))}
      </select>

      <Divider />

      {/* Marks. */}
      <ToolButton title="Bold (Ctrl+B)" active={s.bold} onClick={() => controller.toggleMark("bold")}>
        <span className="font-bold">B</span>
      </ToolButton>
      <ToolButton title="Italic (Ctrl+I)" active={s.italic} onClick={() => controller.toggleMark("italic")}>
        <span className="italic">I</span>
      </ToolButton>
      <ToolButton
        title="Underline (Ctrl+U)"
        active={s.underline}
        onClick={() => controller.toggleMark("underline")}
      >
        <span className="underline">U</span>
      </ToolButton>
      <ToolButton
        title="Strikethrough"
        active={s.strikethrough}
        onClick={() => controller.toggleMark("strikethrough")}
      >
        <span className="line-through">S</span>
      </ToolButton>

      <Divider />

      {/* Colours. */}
      <ColorControl
        title="Text colour"
        glyph={<SheetIcon.textColor />}
        value={s.color}
        onPick={(color) => set({ color })}
        onClear={() => set({ color: undefined })}
      />
      <ColorControl
        title="Fill colour"
        glyph={<SheetIcon.fillColor />}
        value={s.background}
        onPick={(background) => set({ background })}
        onClear={() => set({ background: undefined })}
      />

      <Divider />

      {/* Horizontal alignment. */}
      {(["left", "center", "right"] as HAlign[]).map((a) => {
        const Glyph =
          a === "left" ? SheetIcon.alignLeft : a === "center" ? SheetIcon.alignCenter : SheetIcon.alignRight;
        return (
          <ToolButton
            key={a}
            title={`Align ${a}`}
            active={s.align === a}
            onClick={() => set({ align: s.align === a ? undefined : a })}
          >
            <Glyph />
          </ToolButton>
        );
      })}
      {/* Vertical alignment. */}
      {(["top", "middle", "bottom"] as VAlign[]).map((a) => {
        const Glyph =
          a === "top" ? SheetIcon.alignTop : a === "middle" ? SheetIcon.alignMiddle : SheetIcon.alignBottom;
        return (
          <ToolButton
            key={a}
            title={`Align ${a}`}
            active={s.valign === a}
            onClick={() => set({ valign: s.valign === a ? undefined : a })}
          >
            <Glyph />
          </ToolButton>
        );
      })}
      <ToolButton title="Wrap text" active={s.wrap} onClick={() => set({ wrap: !s.wrap })}>
        <SheetIcon.wrap />
      </ToolButton>

      <Divider />

      {/* Borders. */}
      <Dropdown
        label="Borders ▾"
        triggerClassName="inline-flex h-7 items-center justify-center rounded-md px-1.5 text-[13px] text-ink-muted hover:bg-[color-mix(in_srgb,var(--ink)_7%,transparent)] hover:text-ink"
        panelClassName="absolute left-0 top-8 z-30 flex w-52 flex-col gap-2 rounded-card border border-hairline bg-[var(--surface-raised)] p-2 shadow-lg"
      >
        {(close) => (
          <>
            <div className="grid grid-cols-4 gap-1">
              {BORDER_PRESETS.map((p) => (
                <button
                  key={p.value}
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    controller.applyBorders(
                      p.value,
                      p.value === "none" ? null : { style: borderStyle, color: borderColor },
                    );
                    close();
                  }}
                  className="rounded-md border border-hairline px-1 py-1 text-[11px] text-ink-muted hover:bg-[color-mix(in_srgb,var(--ink)_7%,transparent)] hover:text-ink"
                >
                  {p.label}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-1.5">
              <select
                aria-label="Border style"
                className={selectClass}
                value={borderStyle}
                onChange={(e) => setBorderStyle(e.target.value as BorderLineStyle)}
              >
                {BORDER_STYLES.map((b) => (
                  <option key={b} value={b}>
                    {b}
                  </option>
                ))}
              </select>
              <label className="inline-flex items-center gap-1 text-[11px] text-ink-muted">
                Colour
                <input
                  type="color"
                  aria-label="Border colour"
                  value={borderColor}
                  onChange={(e) => setBorderColor(e.target.value)}
                  className="h-6 w-6 cursor-pointer rounded border border-hairline bg-transparent"
                />
              </label>
            </div>
          </>
        )}
      </Dropdown>

      <Divider />

      {/* Number format. */}
      <select
        aria-label="Number format"
        title="Number format"
        className={selectClass}
        value={numberKind}
        onChange={(e) => setNumberFormat(e.target.value as NumberFormatKind)}
      >
        {NUMBER_FORMATS.map((f) => (
          <option key={f.value} value={f.value}>
            {f.label}
          </option>
        ))}
      </select>
      <ToolButton title="Fewer decimal places" onClick={() => stepDecimals(-1)}>
        <SheetIcon.decimalLess />
      </ToolButton>
      <ToolButton title="More decimal places" onClick={() => stepDecimals(1)}>
        <SheetIcon.decimalMore />
      </ToolButton>
    </div>
  );
}
