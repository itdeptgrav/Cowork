"use client";

import { memo } from "react";
import type { ReactNode } from "react";
import { cellRef, type Rect } from "@/lib/spreadsheet/coordinates";
import {
  colWidth,
  colX,
  rowHeight,
  rowY,
  type GridMetrics,
  type Window,
} from "@/lib/spreadsheet/metrics";
import { getCellValue, type Worksheet } from "@/lib/spreadsheet/model";
import type { FormulaEngine } from "@/lib/spreadsheet/formula";
import { isEmptyStyle, type CellStyle } from "@/lib/spreadsheet/style";
import type { Validation } from "@/lib/spreadsheet/validation";
import type { SheetFilter } from "@/lib/spreadsheet/filter";
import { mergeAt } from "@/lib/spreadsheet/merge";
import { formatValue, resolveAlign } from "@/lib/spreadsheet/format";
import { styleToCss } from "./cellStyle";

/**
 * The cell VALUES for the visible window — every populated OR formatted cell,
 * drawn with its EFFECTIVE style (base + conditional formats, computed by the
 * controller). A cell also earns a node when it carries a dropdown or checkbox
 * validation, a hyperlink, or a comment, so those affordances render even when
 * the cell is empty.
 *
 * Merged regions are drawn once, from the anchor, spanning the whole rectangle;
 * the cells a merge covers are skipped entirely (they hold no value of their
 * own). Rendering the merge as a separate pass means an anchor scrolled just
 * out of the window still paints the part of its span that is in view.
 *
 * The affordances are the only clickable parts of an otherwise pointer-through
 * layer: a checkbox toggles, a dropdown arrow opens its list, a link opens, a
 * comment marker opens its thread.
 */
interface GridBodyProps {
  worksheet: Worksheet;
  sheetId: string;
  engine: FormulaEngine;
  /** The displayed style of a cell (base + conditional formatting). */
  effectiveStyle: (row: number, col: number) => CellStyle;
  /** The validation covering a cell, or null — for the dropdown/checkbox UI. */
  validationAt: (row: number, col: number) => Validation | null;
  onToggleCheckbox: (row: number, col: number) => void;
  onOpenDropdown: (row: number, col: number) => void;
  /** The active sheet's filter — its header row cells get a filter arrow. */
  filter?: SheetFilter;
  onOpenFilter: (col: number, row: number) => void;
  /** Merged regions on the sheet. */
  merges?: Rect[];
  /** A cell's URL, or undefined — rendered as a clickable link. */
  linkAt: (row: number, col: number) => string | undefined;
  /** Whether a cell carries a comment — for the corner marker. */
  hasComment: (row: number, col: number) => boolean;
  onOpenComment: (row: number, col: number) => void;
  metrics: GridMetrics;
  rowWindow: Window;
  colWindow: Window;
}

function GridBodyInner({
  worksheet,
  sheetId,
  engine,
  effectiveStyle,
  validationAt,
  onToggleCheckbox,
  onOpenDropdown,
  filter,
  onOpenFilter,
  merges,
  linkAt,
  hasComment,
  onOpenComment,
  metrics,
  rowWindow,
  colWindow,
}: GridBodyProps) {
  /** One cell's node, optionally forced to a span (for a merge anchor), or null
      when the cell has nothing to draw. */
  function cellNode(r: number, c: number, span?: { width: number; height: number }): ReactNode | null {
    const rule = validationAt(r, c)?.rule;
    const isCheckbox = rule?.kind === "checkbox";
    const isList = rule?.kind === "list";
    const isFilterHeader =
      !!filter && r === filter.range.top && c >= filter.range.left && c <= filter.range.right;
    const style = effectiveStyle(r, c);
    const rawEmpty = getCellValue(worksheet, r, c) === "";
    const value = engine.getValue(sheetId, r, c);
    const text = rawEmpty ? "" : formatValue(value, style.numberFormat);
    const link = linkAt(r, c);
    const comment = hasComment(r, c);
    const merged = span !== undefined;
    if (
      text === "" &&
      isEmptyStyle(style) &&
      !isCheckbox &&
      !isList &&
      !isFilterHeader &&
      !link &&
      !comment &&
      !merged
    ) {
      return null;
    }

    const align = resolveAlign(value, style);
    const css = styleToCss(style, align);
    const width = span?.width ?? colWidth(metrics, c);
    const height = span?.height ?? rowHeight(metrics, r);
    return (
      <div
        key={cellRef(r, c)}
        className="pointer-events-none absolute flex items-center overflow-hidden px-1.5 text-[13px] text-ink"
        style={{
          /* A merged span is inset by the 1px its own left/top boundary lines
             occupy. Without it the opaque background paints over the line at its
             leading edge — which is the PREVIOUS cell's trailing border, so
             merging C:E rubbed out B's right-hand line. The trailing edges need
             no inset: a boundary line is drawn from its coordinate outwards, so
             the span already stops just short of them. */
          left: colX(metrics, c) + (merged ? 1 : 0),
          top: rowY(metrics, r) + (merged ? 1 : 0),
          width: merged ? width - 1 : width,
          height: merged ? height - 1 : height,
          ...css,
          /* A merged region must HIDE the boundaries it swallowed. The grid
             lines are drawn under the cells at every row/column boundary, so a
             transparent span still shows the lines it spans across and reads as
             unmerged. Painting the span opaque covers them; a cell with its own
             fill already does, so that colour is kept when there is one. */
          ...(merged ? { background: css.background ?? "var(--surface-raised)" } : {}),
          ...(isCheckbox ? { justifyContent: "center" } : {}),
        }}
      >
        {isCheckbox ? (
          <button
            type="button"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              onToggleCheckbox(r, c);
            }}
            className="pointer-events-auto text-[15px] leading-none text-ink"
            aria-label={value === true ? "Checked" : "Unchecked"}
          >
            {value === true ? "☑" : "☐"}
          </button>
        ) : (
          <>
            {link ? (
              <a
                href={link}
                target="_blank"
                rel="noreferrer noopener"
                onPointerDown={(e) => e.stopPropagation()}
                className="pointer-events-auto flex-1 truncate text-[var(--accent,#2563eb)] underline"
              >
                {text || link}
              </a>
            ) : (
              <span className="flex-1 truncate">{text}</span>
            )}
            {isList && (
              <button
                type="button"
                onPointerDown={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                  onOpenDropdown(r, c);
                }}
                className="pointer-events-auto ml-1 shrink-0 text-[10px] text-ink-muted"
                aria-label="Choose from list"
              >
                ▾
              </button>
            )}
            {isFilterHeader && (
              <button
                type="button"
                onPointerDown={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                  onOpenFilter(c, r);
                }}
                className="pointer-events-auto ml-1 flex h-4 w-4 shrink-0 items-center justify-center rounded-sm border border-hairline text-[9px] text-ink-muted"
                aria-label="Filter column"
              >
                ▾
              </button>
            )}
            {comment && (
              <button
                type="button"
                onPointerDown={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                  onOpenComment(r, c);
                }}
                className="pointer-events-auto absolute right-0 top-0 h-0 w-0 border-t-[7px] border-l-[7px] border-t-amber-500 border-l-transparent"
                aria-label="Open comment"
              />
            )}
          </>
        )}
      </div>
    );
  }

  const cells: ReactNode[] = [];
  for (let r = rowWindow.start; r <= rowWindow.end; r++) {
    for (let c = colWindow.start; c <= colWindow.end; c++) {
      if (mergeAt(merges, r, c)) continue; // merged cells are drawn in the pass below
      const node = cellNode(r, c);
      if (node) cells.push(node);
    }
  }

  /* Merge pass — draw every merge whose rectangle intersects the window, from
     the anchor, spanning the whole region. */
  if (merges) {
    for (const m of merges) {
      if (
        m.top > rowWindow.end ||
        m.bottom < rowWindow.start ||
        m.left > colWindow.end ||
        m.right < colWindow.start
      ) {
        continue;
      }
      const width = colX(metrics, m.right + 1) - colX(metrics, m.left);
      const height = rowY(metrics, m.bottom + 1) - rowY(metrics, m.top);
      const node = cellNode(m.top, m.left, { width, height });
      if (node) cells.push(node);
    }
  }

  return <>{cells}</>;
}

/**
 * Re-render only when the DATA changes, not when a callback's identity does.
 *
 * The parent rebuilds its handler closures on every render, so a plain `memo`
 * never skipped anything: moving the cursor one cell re-rendered every visible
 * cell, which is exactly the waste this component's virtualization exists to
 * avoid. Comparing the data props alone fixes that.
 *
 * It is sound because every callback here closes over state that one of these
 * data props already tracks — `effectiveStyle`, `validationAt`, `linkAt`,
 * `hasComment` and `onToggleCheckbox` all read the worksheet (or values the
 * engine holds for `sheetId`), and the popover openers read `metrics`. A render
 * that skips therefore keeps a callback whose captured state matches the
 * worksheet it is still displaying; the moment any of that changes, one of these
 * props changes with it and the render happens.
 */
function sameData(prev: GridBodyProps, next: GridBodyProps): boolean {
  return (
    prev.worksheet === next.worksheet &&
    prev.sheetId === next.sheetId &&
    prev.engine === next.engine &&
    prev.metrics === next.metrics &&
    prev.filter === next.filter &&
    prev.merges === next.merges &&
    prev.rowWindow.start === next.rowWindow.start &&
    prev.rowWindow.end === next.rowWindow.end &&
    prev.colWindow.start === next.colWindow.start &&
    prev.colWindow.end === next.colWindow.end
  );
}

export const GridBody = memo(GridBodyInner, sameData);
