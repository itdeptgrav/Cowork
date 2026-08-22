"use client";

/**
 * The ribbon's Home tab — Excel's seven groups, in Excel's order:
 * Clipboard · Font · Alignment · Number · Styles · Cells · Editing.
 *
 * Order matters as much as the contents: people navigate a ribbon by position
 * as much as by label, so the groups sit where they sit everywhere else rather
 * than where this codebase happened to grow them.
 *
 * Every control drives an existing controller action. Where Excel has something
 * this build genuinely lacks (indent, text orientation, Format as Table), the
 * control is absent rather than present-and-dead — see the note at the end.
 */

import { useState } from "react";
import { columnLabel } from "@/lib/spreadsheet/coordinates";
import type { BorderLineStyle, BorderPreset, CellStyle, NumberFormatKind } from "@/lib/spreadsheet/style";
import { Dropdown } from "./Dropdown";
import { SheetIcon } from "./SheetIcons";
import { ConditionalFormatForm } from "./DataControls";
import type { SpreadsheetController } from "./useSpreadsheet";

/* ── Local icons, same conventions as SheetIcons (16px, 1.5 stroke) ───────── */
type P = { className?: string };
function S({ children, className = "" }: P & { children: React.ReactNode }) {
  return (
    <svg viewBox="0 0 16 16" className={`h-4 w-4 shrink-0 ${className}`} fill="none" stroke="currentColor"
      strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  );
}
const Ico = {
  paste: (p: P) => (<S {...p}><path d="M5.5 3H4a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V4a1 1 0 0 0-1-1h-1.5" /><rect x="5.5" y="1.8" width="5" height="2.6" rx=".8" /></S>),
  cut: (p: P) => (<S {...p}><path d="M4 2.5l7.5 9.5" /><path d="M12 2.5L4.5 12" /><circle cx="4" cy="13" r="1.4" /><circle cx="12" cy="13" r="1.4" /></S>),
  copy: (p: P) => (<S {...p}><rect x="5.5" y="2.5" width="8" height="9" rx="1.1" /><path d="M10.5 13.5H3.6a1.1 1.1 0 0 1-1.1-1.1V5.5" /></S>),
  painter: (p: P) => (<S {...p}><rect x="2.5" y="2.5" width="11" height="3.4" rx=".9" /><path d="M8 5.9v2.3h3.2v2.2" /><rect x="6.6" y="10.4" width="2.8" height="3.2" rx=".8" /></S>),
  grow: (p: P) => (<S {...p}><path d="M1.8 11.5L5 4.2l3.2 7.3" /><path d="M2.9 9.2h4.2" /><path d="M12 5v6" /><path d="M9 8h6" /></S>),
  shrink: (p: P) => (<S {...p}><path d="M1.8 11.5L5 4.2l3.2 7.3" /><path d="M2.9 9.2h4.2" /><path d="M9 8h6" /></S>),
  insert: (p: P) => (<S {...p}><rect x="2.5" y="2.5" width="11" height="11" rx="1.1" /><path d="M8 5.4v5.2" /><path d="M5.4 8h5.2" /></S>),
  remove: (p: P) => (<S {...p}><rect x="2.5" y="2.5" width="11" height="11" rx="1.1" /><path d="M5.4 8h5.2" /></S>),
  format: (p: P) => (<S {...p}><rect x="2.5" y="2.5" width="11" height="11" rx="1.1" /><path d="M2.5 6.4h11" /><path d="M6.4 6.4v7.1" /></S>),
  sum: (p: P) => (<S {...p}><path d="M11.5 3.2H4.6l4 4.8-4 4.8h6.9" /></S>),
  clear: (p: P) => (<S {...p}><path d="M2.6 11.4l5.2-5.2a1.4 1.4 0 0 1 2 0l2.6 2.6a1.4 1.4 0 0 1 0 2l-2.4 2.4H5.2z" /><path d="M13.4 13.2H7" /></S>),
  styles: (p: P) => (<S {...p}><rect x="2.5" y="2.5" width="11" height="11" rx="1.1" /><path d="M2.5 6.2h11" /><path d="M6.2 6.2v7.3" /><path d="M9.9 6.2v7.3" /></S>),
};

const cell =
  "inline-flex h-7 min-w-7 items-center justify-center gap-1 rounded-md px-1.5 text-[12px] text-ink-muted transition-colors hover:bg-[color-mix(in_srgb,var(--ink)_7%,transparent)] hover:text-ink disabled:cursor-not-allowed disabled:opacity-40";
const on = "bg-[color-mix(in_srgb,var(--ink)_14%,transparent)] text-ink";
const sel =
  "h-7 rounded-md border border-hairline bg-[var(--surface-raised)] px-1.5 text-[12px] text-ink outline-none";
const menuItem =
  "flex w-full items-center px-3 py-1.5 text-left text-[12px] text-ink transition-colors hover:bg-[color-mix(in_srgb,var(--ink)_8%,transparent)]";

function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex shrink-0 flex-col items-center gap-1 border-r border-hairline px-2 last:border-r-0">
      <div className="flex items-center gap-0.5">{children}</div>
      <span className="text-[10px] leading-none text-ink-faint">{label}</span>
    </div>
  );
}

const NUMBER_FORMATS: { label: string; value: NumberFormatKind }[] = [
  { label: "General", value: "automatic" },
  { label: "Number", value: "number" },
  { label: "Currency", value: "currency" },
  { label: "Accounting", value: "accounting" },
  { label: "Percentage", value: "percent" },
  { label: "Fraction", value: "fraction" },
  { label: "Scientific", value: "scientific" },
  { label: "Short date", value: "shortDate" },
  { label: "Long date", value: "longDate" },
  { label: "Time", value: "time" },
  { label: "Date time", value: "datetime" },
  { label: "Text", value: "text" },
];
const FONTS = [
  { label: "Default", value: "" },
  { label: "Sans", value: "system-ui, -apple-system, 'Segoe UI', sans-serif" },
  { label: "Serif", value: "Georgia, 'Times New Roman', serif" },
  { label: "Mono", value: "ui-monospace, 'Cascadia Code', monospace" },
];
const SIZES = [10, 11, 12, 13, 14, 16, 18, 24, 32];
const BORDER_PRESETS: { label: string; value: BorderPreset }[] = [
  { label: "All borders", value: "all" },
  { label: "Outer border", value: "outer" },
  { label: "Top", value: "top" },
  { label: "Bottom", value: "bottom" },
  { label: "Left", value: "left" },
  { label: "Right", value: "right" },
  { label: "No border", value: "none" },
];
/** Named cell styles, as presets over the same `applyFormat` a toolbar uses. */
const CELL_STYLES: { label: string; patch: Partial<CellStyle> }[] = [
  { label: "Normal", patch: { bold: false, italic: false, fontSize: undefined, color: undefined, background: undefined } },
  { label: "Title", patch: { bold: true, fontSize: 24 } },
  { label: "Heading", patch: { bold: true, fontSize: 16 } },
  { label: "Good", patch: { background: "#c6efce", color: "#006100" } },
  { label: "Bad", patch: { background: "#ffc7ce", color: "#9c0006" } },
  { label: "Neutral", patch: { background: "#ffeb9c", color: "#9c6500" } },
];

/**
 * The merge commands, each with the sentence its NAME does not say.
 *
 * "Merge across" and "Merge down" are the two people get wrong — they sound
 * like directions to merge IN, and are really "one merge per row" and "one merge
 * per column". And all of them discard every value but the top-left, which is
 * not recoverable by unmerging, so each hint says so where it applies.
 */
const MERGE_ITEMS: {
  label: string;
  hint: string;
  run: (c: SpreadsheetController, set: (p: Partial<CellStyle>) => void) => void;
}[] = [
  {
    label: "Merge & centre",
    hint: "Joins the whole selection into one cell and centres it. Keeps only the top-left value — the rest are cleared. Needs two or more cells.",
    run: (c, set) => {
      c.mergeCells("all");
      set({ align: "center" });
    },
  },
  {
    label: "Merge across",
    hint: "Merges each ROW of the selection separately, so three selected rows become three wide cells. Keeps each row's leftmost value. Needs two or more columns.",
    run: (c) => c.mergeCells("horizontal"),
  },
  {
    label: "Merge down",
    hint: "Merges each COLUMN of the selection separately, so three selected columns become three tall cells. Keeps each column's topmost value. Needs two or more rows.",
    run: (c) => c.mergeCells("vertical"),
  },
  {
    label: "Merge cells",
    hint: "Joins the whole selection into one cell, leaving alignment as it is. Keeps only the top-left value. Needs two or more cells.",
    run: (c) => c.mergeCells("all"),
  },
  {
    label: "Unmerge",
    hint: "Splits every merged region the selection touches back into single cells. The values a merge cleared do not come back — undo does that.",
    run: (c) => c.unmergeCells(),
  },
];

export function HomeTab({
  controller,
  onSearchOpen,
}: {
  controller: SpreadsheetController;
  /** Opens the grid's find/replace bar — Excel's "Find & Select". */
  onSearchOpen?: (v: "find" | "replace") => void;
}) {
  const s: CellStyle = controller.activeStyle;
  const set = (patch: Partial<CellStyle>) => controller.applyFormat(patch);
  const keep = (e: React.MouseEvent) => e.preventDefault();
  const [borderStyle, setBorderStyle] = useState<BorderLineStyle>("thin");
  const [borderColor, setBorderColor] = useState("#111111");
  /* Format painter is a two-step: the first click copies the selection (which
     carries its formatting), the second paints that formatting onto whatever is
     selected then. Modelled on the copy/paste-special the controller already
     has rather than a second formatting path. */
  const [painting, setPainting] = useState(false);

  const numberKind = s.numberFormat?.kind ?? "automatic";
  const decimals = s.numberFormat?.decimals;
  /* Clamped to Excel's 0–30: an unbounded count walked past toFixed's limit of
     100 and every render of the cell then threw a RangeError. */
  const stepDecimals = (d: number) =>
    set({
      numberFormat: {
        kind: numberKind === "automatic" ? "number" : numberKind,
        decimals: Math.min(30, Math.max(0, (decimals ?? 2) + d)),
        currency: s.numberFormat?.currency,
      },
    });

  /** AutoSum — a SUM under each selected column, over the selection. */
  function autoSum() {
    const r = controller.selection.range;
    if (r.bottom + 1 >= controller.bounds.rows) return; // no row below to write into
    for (let c = r.left; c <= r.right; c++) {
      /* columnLabel handles AA+ — the old hand-rolled A–Z letter wrote
         `=SUM([1:[5)` past column Z. */
      const col = columnLabel(c);
      controller.commitValue(r.bottom + 1, c, `=SUM(${col}${r.top + 1}:${col}${r.bottom + 1})`);
    }
  }

  return (
    <>
      <Group label="Clipboard">
        <Dropdown label={<><Ico.paste /> Paste ▾</>} triggerClassName={cell}
          panelClassName="absolute left-0 top-8 z-40 flex w-44 flex-col overflow-hidden rounded-card border border-hairline bg-[var(--surface-raised)] py-1 shadow-lg">
          {(close) => (
            <>
              <button type="button" className={menuItem} title="Pastes what was copied, including its formatting and formulas." onClick={() => { close(); controller.paste(); }}>Paste</button>
              <button type="button" className={menuItem} title="Pastes the values only — the destination keeps its own formatting." onClick={() => { close(); controller.pasteSpecial("values"); }}>Values only</button>
              <button type="button" className={menuItem} title="Pastes the formatting only — the destination keeps its own values." onClick={() => { close(); controller.pasteSpecial("formats"); }}>Formatting only</button>
            </>
          )}
        </Dropdown>
        <button type="button" title="Cut (Ctrl+X)" className={cell} onMouseDown={keep} onClick={() => controller.cut()}><Ico.cut /></button>
        <button type="button" title="Copy (Ctrl+C)" className={cell} onMouseDown={keep} onClick={() => controller.copy()}><Ico.copy /></button>
        <button
          type="button"
          title={painting ? "Now select where to paint the formatting" : "Format painter — copy formatting, then apply it"}
          aria-pressed={painting}
          className={`${cell} ${painting ? on : ""}`}
          onMouseDown={keep}
          onClick={() => {
            if (painting) {
              controller.pasteSpecial("formats");
              setPainting(false);
            } else {
              controller.copy();
              setPainting(true);
            }
          }}
        >
          <Ico.painter />
        </button>
      </Group>

      <Group label="Font">
        <select aria-label="Font" className={`${sel} w-24`} value={s.fontFamily ?? ""} onChange={(e) => set({ fontFamily: e.target.value || undefined })}>
          {FONTS.map((f) => <option key={f.label} value={f.value}>{f.label}</option>)}
        </select>
        <select aria-label="Font size" className={`${sel} w-14`} value={s.fontSize ?? 13} onChange={(e) => set({ fontSize: Number(e.target.value) === 13 ? undefined : Number(e.target.value) })}>
          {SIZES.map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
        <button type="button" title="Grow font" className={cell} onMouseDown={keep} onClick={() => set({ fontSize: Math.min(96, (s.fontSize ?? 13) + 1) })}><Ico.grow /></button>
        <button type="button" title="Shrink font" className={cell} onMouseDown={keep} onClick={() => set({ fontSize: Math.max(6, (s.fontSize ?? 13) - 1) })}><Ico.shrink /></button>
        <button type="button" title="Bold (Ctrl+B)" aria-pressed={s.bold} className={`${cell} ${s.bold ? on : ""}`} onMouseDown={keep} onClick={() => controller.toggleMark("bold")}><span className="font-bold">B</span></button>
        <button type="button" title="Italic (Ctrl+I)" aria-pressed={s.italic} className={`${cell} ${s.italic ? on : ""}`} onMouseDown={keep} onClick={() => controller.toggleMark("italic")}><span className="italic">I</span></button>
        <button type="button" title="Underline (Ctrl+U)" aria-pressed={s.underline} className={`${cell} ${s.underline ? on : ""}`} onMouseDown={keep} onClick={() => controller.toggleMark("underline")}><span className="underline">U</span></button>
        <button type="button" title="Strikethrough" aria-pressed={s.strikethrough} className={`${cell} ${s.strikethrough ? on : ""}`} onMouseDown={keep} onClick={() => controller.toggleMark("strikethrough")}><span className="line-through">S</span></button>
        <Dropdown label={<><SheetIcon.borders /> ▾</>} triggerClassName={cell}
          panelClassName="absolute left-0 top-8 z-40 flex w-48 flex-col gap-1.5 rounded-card border border-hairline bg-[var(--surface-raised)] p-2 shadow-lg">
          {(close) => (
            <>
              {BORDER_PRESETS.map((p) => (
                <button key={p.value} type="button" className={menuItem}
                  onClick={() => { close(); controller.applyBorders(p.value, p.value === "none" ? null : { style: borderStyle, color: borderColor }); }}>
                  {p.label}
                </button>
              ))}
              <div className="flex items-center gap-1.5 px-1">
                <select aria-label="Border style" className={sel} value={borderStyle} onChange={(e) => setBorderStyle(e.target.value as BorderLineStyle)}>
                  {["thin", "medium", "thick", "dashed", "dotted", "double"].map((b) => <option key={b} value={b}>{b}</option>)}
                </select>
                <input type="color" aria-label="Border colour" value={borderColor} onChange={(e) => setBorderColor(e.target.value)} className="h-6 w-8 cursor-pointer rounded border border-hairline bg-transparent" />
              </div>
            </>
          )}
        </Dropdown>
        <label className={`${cell} cursor-pointer flex-col !gap-0`} title="Fill colour" onMouseDown={keep}>
          <SheetIcon.fillColor />
          <span className="mt-0.5 h-[3px] w-4 rounded-full" style={{ background: s.background ?? "var(--color-hairline)" }} />
          <input type="color" aria-label="Fill colour" value={s.background ?? "#ffffff"} onChange={(e) => set({ background: e.target.value })} className="sr-only" />
        </label>
        <label className={`${cell} cursor-pointer flex-col !gap-0`} title="Text colour" onMouseDown={keep}>
          <SheetIcon.textColor />
          <span className="mt-0.5 h-[3px] w-4 rounded-full" style={{ background: s.color ?? "var(--color-hairline)" }} />
          <input type="color" aria-label="Text colour" value={s.color ?? "#000000"} onChange={(e) => set({ color: e.target.value })} className="sr-only" />
        </label>
      </Group>

      <Group label="Alignment">
        <button type="button" title="Align top" aria-pressed={s.valign === "top"} className={`${cell} ${s.valign === "top" ? on : ""}`} onMouseDown={keep} onClick={() => set({ valign: s.valign === "top" ? undefined : "top" })}><SheetIcon.alignTop /></button>
        <button type="button" title="Align middle" aria-pressed={s.valign === "middle"} className={`${cell} ${s.valign === "middle" ? on : ""}`} onMouseDown={keep} onClick={() => set({ valign: s.valign === "middle" ? undefined : "middle" })}><SheetIcon.alignMiddle /></button>
        <button type="button" title="Align bottom" aria-pressed={s.valign === "bottom"} className={`${cell} ${s.valign === "bottom" ? on : ""}`} onMouseDown={keep} onClick={() => set({ valign: s.valign === "bottom" ? undefined : "bottom" })}><SheetIcon.alignBottom /></button>
        <button type="button" title="Align left" aria-pressed={s.align === "left"} className={`${cell} ${s.align === "left" ? on : ""}`} onMouseDown={keep} onClick={() => set({ align: s.align === "left" ? undefined : "left" })}><SheetIcon.alignLeft /></button>
        <button type="button" title="Align centre" aria-pressed={s.align === "center"} className={`${cell} ${s.align === "center" ? on : ""}`} onMouseDown={keep} onClick={() => set({ align: s.align === "center" ? undefined : "center" })}><SheetIcon.alignCenter /></button>
        <button type="button" title="Align right" aria-pressed={s.align === "right"} className={`${cell} ${s.align === "right" ? on : ""}`} onMouseDown={keep} onClick={() => set({ align: s.align === "right" ? undefined : "right" })}><SheetIcon.alignRight /></button>
        <button type="button" title="Wrap text" aria-pressed={s.wrap} className={`${cell} ${s.wrap ? on : ""}`} onMouseDown={keep} onClick={() => set({ wrap: !s.wrap })}><SheetIcon.wrap /></button>
        <Dropdown label={<><SheetIcon.merge /> Merge ▾</>} triggerClassName={cell}
          panelClassName="absolute left-0 top-8 z-40 flex w-48 flex-col overflow-hidden rounded-card border border-hairline bg-[var(--surface-raised)] py-1 shadow-lg">
          {(close) => (
            <>
              {MERGE_ITEMS.map((m) => (
                <button
                  key={m.label}
                  type="button"
                  className={menuItem}
                  /* The tooltip carries what the NAME cannot: which direction it
                     merges in, and that everything but the top-left value is
                     discarded — the one surprise this command has. */
                  title={m.hint}
                  onClick={() => {
                    close();
                    m.run(controller, set);
                  }}
                >
                  {m.label}
                </button>
              ))}
            </>
          )}
        </Dropdown>
      </Group>

      <Group label="Number">
        <select aria-label="Number format" className={`${sel} w-24`} value={numberKind}
          onChange={(e) => {
            const k = e.target.value as NumberFormatKind;
            set({ numberFormat: k === "automatic" ? undefined : { kind: k, decimals, currency: s.numberFormat?.currency } });
          }}>
          {NUMBER_FORMATS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
        </select>
        <button type="button" title="Currency" className={cell} onMouseDown={keep} onClick={() => set({ numberFormat: { kind: "currency", decimals: decimals ?? 2, currency: s.numberFormat?.currency ?? "$" } })}>$</button>
        <button type="button" title="Percent" className={cell} onMouseDown={keep} onClick={() => set({ numberFormat: { kind: "percent", decimals: decimals ?? 0 } })}>%</button>
        <button type="button" title="Thousands separator" className={cell} onMouseDown={keep} onClick={() => set({ numberFormat: { kind: "number", decimals: decimals ?? 2 } })}>,</button>
        <button type="button" title="More decimals" className={cell} onMouseDown={keep} onClick={() => stepDecimals(1)}><SheetIcon.decimalMore /></button>
        <button type="button" title="Fewer decimals" className={cell} onMouseDown={keep} onClick={() => stepDecimals(-1)}><SheetIcon.decimalLess /></button>
      </Group>

      <Group label="Styles">
        <Dropdown label={<><Ico.styles /> Conditional formatting ▾</>} triggerClassName={cell}
          panelClassName="absolute left-0 top-8 z-40 flex w-64 flex-col gap-2 rounded-card border border-hairline bg-[var(--surface-raised)] p-2.5 shadow-lg">
          {(close) => <ConditionalFormatForm controller={controller} onDone={close} />}
        </Dropdown>
        <Dropdown label={<><Ico.styles /> Cell styles ▾</>} triggerClassName={cell}
          panelClassName="absolute left-0 top-8 z-40 flex w-44 flex-col overflow-hidden rounded-card border border-hairline bg-[var(--surface-raised)] py-1 shadow-lg">
          {(close) => (
            <>
              {CELL_STYLES.map((p) => (
                <button key={p.label} type="button" className={menuItem} onClick={() => { close(); set(p.patch); }}>
                  {p.label}
                </button>
              ))}
            </>
          )}
        </Dropdown>
      </Group>

      <Group label="Cells">
        <Dropdown label={<><Ico.insert /> Insert ▾</>} triggerClassName={cell}
          panelClassName="absolute left-0 top-8 z-40 flex w-44 flex-col overflow-hidden rounded-card border border-hairline bg-[var(--surface-raised)] py-1 shadow-lg">
          {(close) => (
            <>
              <button type="button" className={menuItem} onClick={() => { close(); controller.insertRows("above"); }}>Rows above</button>
              <button type="button" className={menuItem} onClick={() => { close(); controller.insertRows("below"); }}>Rows below</button>
              <button type="button" className={menuItem} onClick={() => { close(); controller.insertCols("left"); }}>Columns left</button>
              <button type="button" className={menuItem} onClick={() => { close(); controller.insertCols("right"); }}>Columns right</button>
            </>
          )}
        </Dropdown>
        <Dropdown label={<><Ico.remove /> Delete ▾</>} triggerClassName={cell}
          panelClassName="absolute left-0 top-8 z-40 flex w-44 flex-col overflow-hidden rounded-card border border-hairline bg-[var(--surface-raised)] py-1 shadow-lg">
          {(close) => (
            <>
              <button type="button" className={menuItem} onClick={() => { close(); controller.deleteRows(); }}>Rows</button>
              <button type="button" className={menuItem} onClick={() => { close(); controller.deleteCols(); }}>Columns</button>
            </>
          )}
        </Dropdown>
        <Dropdown label={<><Ico.format /> Format ▾</>} triggerClassName={cell}
          panelClassName="absolute left-0 top-8 z-40 flex w-48 flex-col overflow-hidden rounded-card border border-hairline bg-[var(--surface-raised)] py-1 shadow-lg">
          {(close) => (
            <>
              <button type="button" className={menuItem} title="Hides the selected rows. Their data is kept and formulas still read it." onClick={() => { close(); controller.hideRows(); }}>Hide rows</button>
              <button type="button" className={menuItem} onClick={() => { close(); controller.unhideRows(); }}>Unhide rows</button>
              <button type="button" className={menuItem} onClick={() => { close(); controller.hideCols(); }}>Hide columns</button>
              <button type="button" className={menuItem} onClick={() => { close(); controller.unhideCols(); }}>Unhide columns</button>
              <button type="button" className={menuItem} title="Set an exact height, in pixels, for every selected row." onClick={() => { close(); const v = globalThis.prompt?.("Row height in pixels", "24"); const n = Number(v); if (Number.isFinite(n) && n > 0) { const r = controller.selection.range; controller.resizeRows(r.top, r.bottom, n); } }}>Row height…</button>
              <button type="button" className={menuItem} title="Set an exact width, in pixels, for every selected column." onClick={() => { close(); const v = globalThis.prompt?.("Column width in pixels", "100"); const n = Number(v); if (Number.isFinite(n) && n > 0) { const r = controller.selection.range; controller.resizeCols(r.left, r.right, n); } }}>Column width…</button>
              <button type="button" className={menuItem} title="Resets the active row to the default height." onClick={() => { close(); controller.autoFitRow(controller.selection.active.row); }}>Auto-fit row height</button>
            </>
          )}
        </Dropdown>
      </Group>

      <Group label="Editing">
        <button type="button" title="AutoSum — a SUM below each selected column" className={cell} onMouseDown={keep} onClick={autoSum}><Ico.sum /></button>
        <Dropdown label={<><Ico.clear /> Clear ▾</>} triggerClassName={cell}
          panelClassName="absolute left-0 top-8 z-40 flex w-44 flex-col overflow-hidden rounded-card border border-hairline bg-[var(--surface-raised)] py-1 shadow-lg">
          {(close) => (
            <>
              <button type="button" className={menuItem} title="Empties the selected cells, leaving their formatting behind." onClick={() => { close(); controller.clearSelection(); }}>Clear contents</button>
              <button type="button" className={menuItem} title="Returns the selected cells to the default style, keeping their values." onClick={() => { close(); controller.clearFormatting(); }}>Clear formatting</button>
            </>
          )}
        </Dropdown>
        <Dropdown label={<><SheetIcon.find /> Find &amp; select ▾</>} triggerClassName={cell}
          panelClassName="absolute right-0 top-8 z-40 flex w-52 flex-col overflow-hidden rounded-card border border-hairline bg-[var(--surface-raised)] py-1 shadow-lg">
          {(close) => (
            <>
              <button type="button" className={menuItem} title="Search the sheet. Ctrl+F does the same." onClick={() => { close(); onSearchOpen?.("find"); }}>Find…</button>
              <button type="button" className={menuItem} title="Search and replace across the sheet. Ctrl+H does the same." onClick={() => { close(); onSearchOpen?.("replace"); }}>Replace…</button>
              <button type="button" className={menuItem} title="Select every cell on the sheet." onClick={() => { close(); controller.selectAll(); }}>Select all</button>
            </>
          )}
        </Dropdown>
        <Dropdown label={<><SheetIcon.sortAsc /> Sort &amp; filter ▾</>} triggerClassName={cell}
          panelClassName="absolute right-0 top-8 z-40 flex w-48 flex-col overflow-hidden rounded-card border border-hairline bg-[var(--surface-raised)] py-1 shadow-lg">
          {(close) => (
            <>
              <button type="button" className={menuItem} title="Sorts the selected rows by the active column, smallest or earliest first. Whole rows move together." onClick={() => { close(); controller.sortSelection("asc"); }}>Sort A → Z</button>
              <button type="button" className={menuItem} title="Sorts the selected rows by the active column, largest or latest first. Whole rows move together." onClick={() => { close(); controller.sortSelection("desc"); }}>Sort Z → A</button>
              <button type="button" className={menuItem} title="Puts a filter arrow on each column of the selection. Filtering hides rows without deleting them." onClick={() => { close(); controller.toggleFilter(); }}>
                {controller.worksheet.filter ? "Remove filter" : "Create filter"}
              </button>
            </>
          )}
        </Dropdown>
      </Group>
    </>
  );
}

/*
 * Absent from this tab, and why — Excel has each, this build does not:
 *
 *  · **Indent / decrease indent** and **text orientation** — `CellStyle` has no
 *    indent or rotation property, so both would need the style model extended
 *    and the renderer taught to draw them.
 *  · **Format as Table** — there is no table object (banded ranges with their own
 *    header and structured references); conditional formatting covers the look
 *    but not the concept.
 *  · **Fill (down/right/series)** — the fill HANDLE works on the grid; a ribbon
 *    entry needs a fill that takes a direction rather than a drag target.
 *  · **Find & Select** — the search bar is state the grid owns, so the ribbon
 *    cannot open it yet. Ctrl+F and Ctrl+H still do.
 */
