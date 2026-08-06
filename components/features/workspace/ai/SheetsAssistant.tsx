"use client";

import { useRef } from "react";
import { AssistantPanel } from "./AssistantPanel";
import { buildSheetsContext, requestsWholeSheet } from "@/lib/rules/sheets/aiContext";
import {
  describeRect,
  sheetsActionRequiresConfirmation,
  validateSheetsToolCall,
  type SheetsAiAction,
} from "@/lib/rules/sheets/aiTools";
import {
  cellRef,
  columnLabel,
  deleteColumns,
  deleteRows,
  describeConditional,
  insertColumns,
  insertRows,
  parseRef,
  rowsNotMatching,
  sortRange,
  type CellStyle,
  type Rect,
  type SheetData,
} from "@/lib/rules/sheets/grid";
import { getRepository } from "@/lib/repositories";
import type { SelectionState, SheetDispatch } from "../sheetCommands";

/**
 * The Sheets executor — the mirror of `DocsAssistant.tsx`.
 *
 * `apply` never mutates `sheet` directly. Every branch either calls
 * `dispatch`, the grid's existing front door (see `sheetCommands.ts`), or —
 * for `rename_sheet` only, which is a document-title write rather than a
 * sheet-content one — the same repository call the document browser's rename
 * field already uses. Structural edits (`insert_rows`, `sort_range`, …) call
 * the pure functions in `lib/rules/sheets/grid.ts` to compute the next
 * `SheetData`, then hand the RESULT to `dispatch({type:"structuralEdit"})` —
 * this file decides nothing about how a Yjs map gets rewritten, the grid
 * still does.
 */

const SUGGESTED_ACTIONS = [
  { label: "Sum this", instruction: "Write a formula that sums the selected range into the cell just below it." },
  { label: "Explain this formula", instruction: "Explain what the formula in the selected cell does." },
  { label: "Fix this formula", instruction: "The formula in the selected cell isn't working. Find and fix the problem." },
  { label: "Remove duplicates", instruction: "Identify duplicate rows in the selected range." },
  { label: "Clean this data", instruction: "Clean and standardize the selected data — trim whitespace and fix inconsistent capitalization." },
  { label: "Sort this range", instruction: "Sort the selected range by its first column, ascending, treating the top row as a header." },
  { label: "Summarize", instruction: "Summarize what's in the selected cells." },
  { label: "Find trends or anomalies", instruction: "Look at the selected data and point out any trends or anomalies." },
  { label: "Add a chart", instruction: "Create a column chart from the selected range." },
  { label: "Highlight duplicates", instruction: "Add conditional formatting that highlights duplicate values in the selected range." },
  { label: "Continue this pattern", instruction: "Continue the pattern in the selected cells into the rest of the selected range." },
];

/** The style `flag_outliers` paints on a flagged cell — a warning amber, same family as the RED/YELLOW/GREEN conditional-format fills in `grid.ts`. */
const OUTLIER_STYLE: CellStyle = { bg: "#ffeb9c", color: "#7a5b00" };

export function SheetsAssistant({
  documentId,
  documentTitle,
  sheet,
  selection,
  dispatch,
  pendingPrompt,
  onPromptTaken,
  onRenamed,
  onClose,
}: {
  documentId: string;
  documentTitle: string;
  sheet: SheetData;
  selection: SelectionState;
  dispatch: SheetDispatch;
  /** An `=ai …` typed into a cell — see `SheetGrid`'s `commit`. */
  pendingPrompt?: { ref: string; text: string } | null;
  onPromptTaken?: () => void;
  onRenamed: () => void;
  onClose: () => void;
}) {
  const lastRename = useRef<{ previousTitle: string } | null>(null);

  const contextLabel = selection.rect
    ? `Selected: ${describeRect(selection.rect)}`
    : "Nothing selected";

  function buildPreview(action: SheetsAiAction): React.ReactNode {
    switch (action.tool) {
      case "set_cells":
        return <CellChangesPreview sheet={sheet} cells={action.cells} />;
      case "insert_rows":
        return <p className="text-ink">Insert {action.count} row(s) above row {action.atRow + 1}.</p>;
      case "delete_rows":
        return (
          <p className="text-ink">
            Delete row{action.count > 1 ? "s" : ""} {action.atRow + 1}
            {action.count > 1 ? `–${action.atRow + action.count}` : ""}.
          </p>
        );
      case "insert_columns":
        return <p className="text-ink">Insert {action.count} column(s) before column {columnLabel(action.atCol)}.</p>;
      case "delete_columns":
        return (
          <p className="text-ink">
            Delete column{action.count > 1 ? "s" : ""} {columnLabel(action.atCol)}
            {action.count > 1 ? `–${columnLabel(action.atCol + action.count - 1)}` : ""}.
          </p>
        );
      case "create_table":
        return (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-[11.5px]">
              <thead>
                <tr>
                  {action.headers.map((h, i) => (
                    <th key={i} className="border border-hairline px-1.5 py-1 text-left font-medium text-ink">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {action.rows.map((row, i) => (
                  <tr key={i}>
                    {row.map((cell, j) => (
                      <td key={j} className="border border-hairline px-1.5 py-1 text-ink-muted">
                        {cell}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-1 text-[11px] text-ink-faint">Starting at {action.anchor}.</p>
          </div>
        );
      case "set_formula":
        return (
          <div>
            <p className="text-ink" data-figure>
              {action.ref}: <code className="font-normal">{action.formula}</code>
            </p>
            <p className="mt-1 text-[11.5px] text-ink-muted">{action.explanation}</p>
          </div>
        );
      case "format_range":
        return (
          <p className="text-ink">
            Format {describeRect(action.rect)}: {describeStyle(action.style)}
          </p>
        );
      case "sort_range":
        return (
          <p className="text-ink">
            Sort {describeRect(action.rect)} by column {columnLabel(action.byCol)},{" "}
            {action.direction === "asc" ? "ascending" : "descending"}
            {action.hasHeaderRow ? " (header row kept in place)" : ""}.
          </p>
        );
      case "filter_range": {
        const hidden = rowsNotMatching(sheet, action.rect, action.byCol, action.condition, action.value, action.hasHeaderRow);
        return (
          <p className="text-ink">
            Hide rows in {describeRect(action.rect)} where column {columnLabel(action.byCol)}{" "}
            {describeFilterCondition(action.condition, action.value)} — <span data-figure>{hidden.length}</span> row(s)
            would be hidden.
          </p>
        );
      }
      case "apply_conditional_format":
        return (
          <p className="text-ink">
            {describeRect(action.rect)}: {describeConditional({ id: "", range: describeRect(action.rect), ...action })}
          </p>
        );
      case "create_chart":
        return (
          <p className="text-ink">
            Embed a {action.chartType} chart titled “{action.title}” from {describeRect(action.rect)}.
          </p>
        );
      case "rename_sheet":
        return (
          <p className="text-ink">
            Rename “{documentTitle}” to “{action.title}”.
          </p>
        );
      case "flag_outliers":
        return <FlagOutliersPreview rect={action.rect} flags={action.flags} />;
    }
  }

  function apply(action: SheetsAiAction) {
    if (action.tool !== "rename_sheet") lastRename.current = null;

    switch (action.tool) {
      case "set_cells":
        dispatch({ type: "writeCells", cells: action.cells });
        return;
      case "insert_rows":
        dispatch({ type: "structuralEdit", next: insertRows(sheet, action.atRow, action.count) });
        return;
      case "delete_rows":
        dispatch({ type: "structuralEdit", next: deleteRows(sheet, action.atRow, action.count) });
        return;
      case "insert_columns":
        dispatch({ type: "structuralEdit", next: insertColumns(sheet, action.atCol, action.count) });
        return;
      case "delete_columns":
        dispatch({ type: "structuralEdit", next: deleteColumns(sheet, action.atCol, action.count) });
        return;
      case "create_table": {
        const anchorPos = parseRef(action.anchor)!;
        const cells: { ref: string; value: string }[] = [];
        action.headers.forEach((h, c) => cells.push({ ref: cellRef(anchorPos.row, anchorPos.col + c), value: h }));
        action.rows.forEach((row, r) =>
          row.forEach((v, c) => cells.push({ ref: cellRef(anchorPos.row + r + 1, anchorPos.col + c), value: v })),
        );
        dispatch({ type: "writeCells", cells });
        return;
      }
      case "set_formula":
        dispatch({ type: "writeCells", cells: [{ ref: action.ref, value: action.formula }] });
        return;
      case "format_range":
        dispatch({ type: "selectRange", range: describeRect(action.rect) });
        dispatch({ type: "style", patch: action.style });
        return;
      case "sort_range":
        dispatch({
          type: "structuralEdit",
          next: sortRange(sheet, action.rect, action.byCol, action.direction, action.hasHeaderRow),
        });
        return;
      case "filter_range": {
        const newlyHidden = rowsNotMatching(sheet, action.rect, action.byCol, action.condition, action.value, action.hasHeaderRow);
        /* Rows outside this range keep whatever hidden state they already
           had; only rows inside it are re-decided by this filter. */
        const outsideRange = (sheet.hidden ?? []).filter((r) => r < action.rect.top || r > action.rect.bottom);
        dispatch({ type: "setHiddenRows", hidden: [...outsideRange, ...newlyHidden] });
        return;
      }
      case "apply_conditional_format":
        dispatch({
          type: "applyConditionalFormat",
          rule: {
            range: describeRect(action.rect),
            kind: action.kind,
            value: action.value,
            value2: action.value2,
            text: action.text,
            color: action.color,
          },
        });
        return;
      case "create_chart":
        dispatch({ type: "createChart", range: describeRect(action.rect), chartType: action.chartType, title: action.title });
        return;
      case "rename_sheet":
        lastRename.current = { previousTitle: documentTitle };
        void getRepository()
          .renameDocument(documentId, action.title)
          .then((r) => {
            if (r.ok) onRenamed();
          });
        return;
      case "flag_outliers":
        /* One explicit ref list, one style — `styleCells`, not `selectRange`
           followed by `style`: the flagged cells are rarely a single
           rectangle, and that two-dispatch sequence only ever lands on
           whatever was selected before this ran (see `sheetCommands.ts`). */
        dispatch({ type: "styleCells", refs: action.flags.map((f) => f.ref), patch: OUTLIER_STYLE });
        return;
    }
  }

  return (
    <AssistantPanel<SheetsAiAction>
      surface="sheets"
      surfaceLabel="Sheet"
      placeholder="e.g. 'sum this column', 'sort by name', 'add a chart'…"
      suggestedActions={SUGGESTED_ACTIONS}
      contextLabel={contextLabel}
      /* An `=ai …` typed into a cell arrives here already aimed at that
         cell, so the model is told which one rather than having to infer it
         from a selection that has since moved on. */
      pendingInstruction={
        pendingPrompt ? `In cell ${pendingPrompt.ref}: ${pendingPrompt.text}` : null
      }
      onPendingTaken={onPromptTaken}
      getContextSummary={(instruction) =>
        buildSheetsContext({ sheet, selection: selection.rect, wholeSheet: requestsWholeSheet(instruction) })
      }
      validate={(tool, args) => {
        const result = validateSheetsToolCall(tool, args, sheet);
        if (!result.ok) return result;
        const requiresConfirmation = sheetsActionRequiresConfirmation(result.action, sheet);
        return {
          ok: true,
          action: result.action,
          preview: buildPreview(result.action),
          requiresConfirmation,
          confirmationMessage: requiresConfirmation
            ? confirmationMessageFor(result.action)
            : undefined,
        };
      }}
      apply={apply}
      undo={() => {
        if (lastRename.current) {
          const { previousTitle } = lastRename.current;
          lastRename.current = null;
          void getRepository()
            .renameDocument(documentId, previousTitle)
            .then((r) => {
              if (r.ok) onRenamed();
            });
          return;
        }
        dispatch({ type: "undo" });
      }}
      onClose={onClose}
    />
  );
}

function confirmationMessageFor(action: SheetsAiAction): string {
  switch (action.tool) {
    case "delete_rows":
      return `This deletes ${action.count} row(s) and everything in them. This can be undone.`;
    case "delete_columns":
      return `This deletes ${action.count} column(s) and everything in them. This can be undone.`;
    case "sort_range":
      return "This reorders the rows in this range. Review the range above before applying.";
    case "filter_range":
      return "This hides rows that don't match, without deleting them. Use \"Show all\" in the sheet header to reveal them again.";
    case "set_cells":
      return "This overwrites cells that already have data in them.";
    case "create_table":
      return "This would write over cells that already have data in them.";
    case "format_range":
    case "apply_conditional_format":
      return "This formats a large range. Review it above before applying.";
    default:
      return "Review the change above before applying it.";
  }
}

function describeStyle(style: { bold?: boolean; italic?: boolean; underline?: boolean; align?: string; color?: string; bg?: string; format?: string }): string {
  const parts: string[] = [];
  if (style.bold) parts.push("bold");
  if (style.italic) parts.push("italic");
  if (style.underline) parts.push("underline");
  if (style.align) parts.push(`align ${style.align}`);
  if (style.color) parts.push(`text colour ${style.color}`);
  if (style.bg) parts.push(`fill ${style.bg}`);
  if (style.format) parts.push(`number format: ${style.format}`);
  return parts.length ? parts.join(", ") : "no visible change";
}

function describeFilterCondition(condition: string, value: string): string {
  switch (condition) {
    case "equals":
      return `does not equal "${value}"`;
    case "contains":
      return `does not contain "${value}"`;
    case "notEmpty":
      return "is empty";
    case "empty":
      return "is not empty";
    default:
      return "doesn't match";
  }
}

function CellChangesPreview({
  sheet,
  cells,
}: {
  sheet: SheetData;
  cells: { ref: string; value: string }[];
}) {
  const shown = cells.slice(0, 20);
  return (
    <div>
      <ul className="flex flex-col gap-0.5">
        {shown.map((c) => {
          const before = sheet.cells[c.ref] ?? "";
          return (
            <li key={c.ref} className="flex items-baseline gap-1.5 text-[11.5px]">
              <span data-figure className="w-10 shrink-0 text-ink-faint">
                {c.ref}
              </span>
              {before && (
                <span className="text-[var(--state-overdue-ink)] line-through">{before}</span>
              )}
              <span className="text-[var(--state-positive-ink)]">{c.value}</span>
            </li>
          );
        })}
      </ul>
      {cells.length > shown.length && (
        <p className="mt-1 text-[11px] text-ink-faint">+{cells.length - shown.length} more cell(s).</p>
      )}
    </div>
  );
}

function FlagOutliersPreview({
  rect,
  flags,
}: {
  rect: Rect;
  flags: { ref: string; reason: string }[];
}) {
  const shown = flags.slice(0, 20);
  return (
    <div>
      <p className="mb-1 text-[11.5px] text-ink-muted">
        In {describeRect(rect)}, <span data-figure>{flags.length}</span> cell(s) flagged:
      </p>
      <ul className="flex flex-col gap-0.5">
        {shown.map((f) => (
          <li key={f.ref} className="flex items-baseline gap-1.5 text-[11.5px]">
            <span data-figure className="w-10 shrink-0 text-ink-faint">
              {f.ref}
            </span>
            <span className="text-ink">{f.reason}</span>
          </li>
        ))}
      </ul>
      {flags.length > shown.length && (
        <p className="mt-1 text-[11px] text-ink-faint">+{flags.length - shown.length} more cell(s).</p>
      )}
    </div>
  );
}
