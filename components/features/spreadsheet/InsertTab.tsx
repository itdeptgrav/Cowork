"use client";

/**
 * The ribbon's Insert tab — Google Sheets' Insert menu, in its own order.
 *
 * The reference menu is one long list with four submenus. A ribbon strip is
 * wider than it is tall, so the list becomes six named groups reading left to
 * right in the same sequence the menu reads top to bottom: Cells · Sheet ·
 * Function · Link · Controls · Notes. Somebody who knows where a command is in
 * Sheets finds it in the same relative place here.
 *
 * **Every control on this strip performs a real edit.** Where the reference menu
 * has something this build has no engine for — Chart, Pivot table, Timeline,
 * Image, Drawing, Pre-built tables, Smart chips — the control is ABSENT rather
 * than present and dead. The note at the foot of this file records each one and
 * what it would need. That rule is the whole reason the strip is trustworthy: a
 * button that is here does something.
 */

import { useState } from "react";
import { cellRef } from "@/lib/spreadsheet/coordinates";
import { FUNCTION_HELP, type FnCategory } from "@/lib/spreadsheet/formula/catalog";
import { normalizeUrl } from "@/lib/spreadsheet/hyperlink";
import { BODY_ROWS, TABLE_TEMPLATES } from "@/lib/spreadsheet/templates";
import { Dropdown } from "./Dropdown";
import type { SpreadsheetController } from "./useSpreadsheet";

/* ── Icons, same conventions as SheetIcons (16px box, 1.5 stroke) ─────────── */
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
  cells: (p: P) => (<S {...p}><rect x="2.5" y="2.5" width="11" height="11" rx="1.1" /></S>),
  rows: (p: P) => (<S {...p}><rect x="2.5" y="2.5" width="11" height="11" rx="1.1" /><path d="M2.5 6.2h11" /><path d="M2.5 9.8h11" /></S>),
  columns: (p: P) => (<S {...p}><rect x="2.5" y="2.5" width="11" height="11" rx="1.1" /><path d="M6.2 2.5v11" /><path d="M9.8 2.5v11" /></S>),
  sheet: (p: P) => (<S {...p}><rect x="2.5" y="2.5" width="11" height="11" rx="1.1" /><path d="M2.5 6h11" /><path d="M2.5 2.5h4.5V6" /></S>),
  table: (p: P) => (<S {...p}><rect x="2" y="2.5" width="12" height="11" rx="1.1" /><path d="M2 6h12" /><path d="M2 9.8h12" /><path d="M6.6 6v7.5" /></S>),
  fn: (p: P) => (<S {...p}><path d="M11.5 3.2H4.6l4 4.8-4 4.8h6.9" /></S>),
  link: (p: P) => (<S {...p}><path d="M6.6 9.4a2.6 2.6 0 0 0 3.7 0l2-2a2.6 2.6 0 0 0-3.7-3.7l-.9.9" /><path d="M9.4 6.6a2.6 2.6 0 0 0-3.7 0l-2 2a2.6 2.6 0 0 0 3.7 3.7l.9-.9" /></S>),
  tick: (p: P) => (<S {...p}><rect x="2.5" y="2.5" width="11" height="11" rx="1.6" /><path d="M5.4 8.2l1.9 1.9 3.4-3.8" /></S>),
  dropdown: (p: P) => (<S {...p}><rect x="2" y="4.6" width="12" height="6.8" rx="3.4" /><path d="M9.4 7.4L11 9l1.6-1.6" /></S>),
  emoji: (p: P) => (<S {...p}><circle cx="8" cy="8" r="5.5" /><path d="M5.9 9.6a2.6 2.6 0 0 0 4.2 0" /><path d="M6.1 6.4h.01" /><path d="M9.9 6.4h.01" /></S>),
  comment: (p: P) => (<S {...p}><path d="M13.5 9.4a1.6 1.6 0 0 1-1.6 1.6H6l-3.5 2.5V4a1.6 1.6 0 0 1 1.6-1.6h7.8A1.6 1.6 0 0 1 13.5 4z" /></S>),
};

const cmd =
  "inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-[12px] text-ink-muted transition-colors hover:bg-[color-mix(in_srgb,var(--ink)_7%,transparent)] hover:text-ink disabled:cursor-not-allowed disabled:opacity-40";
const menuItem =
  "flex w-full items-center justify-between gap-4 px-3 py-1.5 text-left text-[12px] text-ink transition-colors hover:bg-[color-mix(in_srgb,var(--ink)_8%,transparent)]";
const menuLabel =
  "px-3 pt-2 pb-1 text-[10px] tracking-[0.08em] text-ink-faint uppercase";
const field =
  "h-7 w-full min-w-0 rounded-md border border-hairline bg-[var(--surface-raised)] px-2 text-[12px] text-ink outline-none focus:border-[color-mix(in_srgb,var(--ink)_45%,transparent)]";
const primary =
  "h-7 shrink-0 rounded-md bg-ink px-2.5 text-[12px] font-medium text-[var(--body-bg)] transition-opacity hover:opacity-90 disabled:opacity-40";
/* The two panel shapes the ribbon already uses: a list of commands, and a small
   form. Same tokens as `HomeTab` and `DataTab` so all three read as one menu
   system rather than three that grew separately. */
const panelMenu =
  "absolute left-0 top-8 z-40 flex w-max min-w-[220px] flex-col overflow-hidden rounded-card border border-hairline bg-[var(--surface-raised)] py-1 shadow-lg";
const panelForm =
  "absolute left-0 top-8 z-40 overflow-hidden rounded-card border border-hairline bg-[var(--surface-raised)] shadow-lg";

function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex shrink-0 flex-col items-center gap-1 border-r border-hairline px-2 last:border-r-0">
      <div className="flex items-center gap-0.5">{children}</div>
      <span className="text-[10px] leading-none text-ink-faint">{label}</span>
    </div>
  );
}

/** The keystroke a command also answers to, shown the way a menu shows it. */
function Key({ children }: { children: string }) {
  return <span className="shrink-0 text-[11px] text-ink-faint">{children}</span>;
}

/**
 * The emoji set.
 *
 * A deliberate, curated few rather than a full picker: the reference opens a
 * searchable catalogue backed by an emoji index this build does not carry, and
 * a grid of everything would be a second scrolling surface inside a ribbon.
 * These are the marks people actually put in a status column. The cell accepts
 * any character typed directly, so nothing here is a ceiling.
 */
const EMOJI: { group: string; chars: string[] }[] = [
  { group: "Status", chars: ["✅", "❌", "⚠️", "🚧", "⏳", "🔴", "🟡", "🟢", "⭐", "❗"] },
  { group: "Work", chars: ["📌", "📎", "📊", "📈", "📉", "🗓️", "💰", "🔍", "🔒", "🏁"] },
  { group: "People", chars: ["👍", "👎", "🙌", "👀", "🙋", "💬", "🎉", "🔥", "💡", "🤝"] },
];

const CATEGORIES: FnCategory[] = ["Math", "Statistical", "Logical", "Text", "Date", "Lookup", "Array"];

export function InsertTab({ controller }: { controller: SpreadsheetController }) {
  /* Commands act on the selection, so a click must not take focus off it. */
  const keepFocus = (e: React.MouseEvent) => e.preventDefault();
  const { selection } = controller;
  const rows = selection.range.bottom - selection.range.top + 1;
  const cols = selection.range.right - selection.range.left + 1;
  const active = selection.active;
  const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;

  return (
    <>
      {/* ── Cells · Rows · Columns ───────────────────────────────────────── */}
      <Group label="Cells">
        <Dropdown
          title="Insert or delete a block of cells"
          triggerClassName={cmd}
          panelClassName={panelMenu}
          label={
            <>
              <Ico.cells />
              Cells
            </>
          }
        >
          {(close) => (
            <>
              <p className={menuLabel}>Insert {plural(rows * cols, "cell")}</p>
              <button type="button" className={menuItem} onMouseDown={keepFocus}
                onClick={() => { controller.insertCells("right"); close(); }}>
                Insert cells and shift right
              </button>
              <button type="button" className={menuItem} onMouseDown={keepFocus}
                onClick={() => { controller.insertCells("down"); close(); }}>
                Insert cells and shift down
              </button>
              <div className="my-1 h-px bg-hairline" />
              <p className={menuLabel}>Delete</p>
              <button type="button" className={menuItem} onMouseDown={keepFocus}
                onClick={() => { controller.deleteCells("left"); close(); }}>
                Delete cells and shift left
              </button>
              <button type="button" className={menuItem} onMouseDown={keepFocus}
                onClick={() => { controller.deleteCells("up"); close(); }}>
                Delete cells and shift up
              </button>
            </>
          )}
        </Dropdown>

        <Dropdown
          title="Insert or delete rows"
          triggerClassName={cmd}
          panelClassName={panelMenu}
          label={
            <>
              <Ico.rows />
              Rows
            </>
          }
        >
          {(close) => (
            <>
              <button type="button" className={menuItem} onMouseDown={keepFocus}
                onClick={() => { controller.insertRows("above"); close(); }}>
                Insert {plural(rows, "row")} above
              </button>
              <button type="button" className={menuItem} onMouseDown={keepFocus}
                onClick={() => { controller.insertRows("below"); close(); }}>
                Insert {plural(rows, "row")} below
              </button>
              <div className="my-1 h-px bg-hairline" />
              <button type="button" className={menuItem} onMouseDown={keepFocus}
                onClick={() => { controller.deleteRows(); close(); }}>
                Delete {plural(rows, "row")}
              </button>
            </>
          )}
        </Dropdown>

        <Dropdown
          title="Insert or delete columns"
          triggerClassName={cmd}
          panelClassName={panelMenu}
          label={
            <>
              <Ico.columns />
              Columns
            </>
          }
        >
          {(close) => (
            <>
              <button type="button" className={menuItem} onMouseDown={keepFocus}
                onClick={() => { controller.insertCols("left"); close(); }}>
                Insert {plural(cols, "column")} left
              </button>
              <button type="button" className={menuItem} onMouseDown={keepFocus}
                onClick={() => { controller.insertCols("right"); close(); }}>
                Insert {plural(cols, "column")} right
              </button>
              <div className="my-1 h-px bg-hairline" />
              <button type="button" className={menuItem} onMouseDown={keepFocus}
                onClick={() => { controller.deleteCols(); close(); }}>
                Delete {plural(cols, "column")}
              </button>
            </>
          )}
        </Dropdown>
      </Group>

      {/* ── Pre-built tables ─────────────────────────────────────────────── */}
      <Group label="Tables">
        <TableMenu controller={controller} />
      </Group>

      {/* ── Sheet ────────────────────────────────────────────────────────── */}
      <Group label="Sheet">
        <button type="button" className={cmd} onMouseDown={keepFocus}
          title="Add a sheet (Shift+F11)" onClick={() => controller.createSheet()}>
          <Ico.sheet />
          Sheet
        </button>
      </Group>

      {/* ── Function ─────────────────────────────────────────────────────── */}
      <Group label="Function">
        <FunctionMenu controller={controller} />
      </Group>

      {/* ── Link ─────────────────────────────────────────────────────────── */}
      <Group label="Link">
        <LinkMenu controller={controller} />
      </Group>

      {/* ── Tick box · Drop-down · Emoji ─────────────────────────────────── */}
      <Group label="Controls">
        <button
          type="button"
          className={cmd}
          onMouseDown={keepFocus}
          title="Turn the selection into tick boxes. Clicking one toggles TRUE/FALSE."
          onClick={() => controller.setValidation({ kind: "checkbox" })}
        >
          <Ico.tick />
          Tick box
        </button>
        <DropdownMenu controller={controller} />
        <EmojiMenu controller={controller} />
      </Group>

      {/* ── Comment ──────────────────────────────────────────────────────── */}
      <Group label="Notes">
        <CommentMenu controller={controller} row={active.row} col={active.col} />
      </Group>
    </>
  );
}

/* ── Pre-built tables ─────────────────────────────────────────────────────── */

/**
 * The template list.
 *
 * Each row says where the table would land and what it would cover, because the
 * one thing this feature must never do is drop twelve rows of headers on top of
 * work somebody has already done. A template that cannot land cleanly is shown
 * disabled with the reason, rather than being hidden — "why is that greyed out"
 * is answerable; "where did that option go" is not.
 */
function TableMenu({ controller }: { controller: SpreadsheetController }) {
  return (
    <Dropdown
      title="Insert a ready-made table at the selected cell"
      triggerClassName={cmd}
      panelClassName={panelForm}
      label={
        <>
          <Ico.table />
          Tables
        </>
      }
    >
      {(close) => <TableList controller={controller} close={close} />}
    </Dropdown>
  );
}

/** Mounted fresh on open, so it reads the cell you are on now. */
function TableList({
  controller,
  close,
}: {
  controller: SpreadsheetController;
  close: () => void;
}) {
  const { active } = controller.selection;
  const anchor = cellRef(active.row, active.col);

  return (
    <div className="w-[320px] py-1">
      <p className={menuLabel}>Insert at {anchor}</p>
      <div className="max-h-[280px] overflow-y-auto scroll-slim">
        {TABLE_TEMPLATES.map((t) => {
          const verdict = controller.tableFits(t.id);
          const reason =
            verdict.blocked === "occupied"
              ? `${t.columns.length} columns × ${BODY_ROWS + 1} rows from ${anchor} — those cells aren't empty`
              : verdict.blocked === "no-room"
                ? "Not enough room from here to the edge of the sheet"
                : `${t.columns.length} columns × ${BODY_ROWS + 1} rows from ${anchor}`;
          return (
            <button
              key={t.id}
              type="button"
              disabled={!verdict.ok}
              title={reason}
              className="flex w-full flex-col items-start gap-0.5 px-3 py-1.5 text-left transition-colors hover:bg-[color-mix(in_srgb,var(--ink)_8%,transparent)] disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:bg-transparent"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                if (controller.insertTable(t.id).ok) close();
              }}
            >
              <span className="text-[12px] font-medium text-ink">{t.name}</span>
              <span className="text-[11px] text-ink-muted">{t.summary}</span>
              <span
                className={`text-[10px] ${verdict.ok ? "text-ink-faint" : "text-[var(--state-overdue-ink)]"}`}
              >
                {reason}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ── Function ─────────────────────────────────────────────────────────────── */

/**
 * The function browser, by category, exactly as the catalog groups them.
 *
 * Choosing one opens the cell editor on `=NAME(` with the caret after the
 * bracket, which is where the in-editor helper picks the reader up with the
 * signature and argument highlighting. It does not paste a finished call: the
 * arguments are the part only the reader knows.
 */
function FunctionMenu({ controller }: { controller: SpreadsheetController }) {
  const [category, setCategory] = useState<FnCategory>("Math");
  const keepFocus = (e: React.MouseEvent) => e.preventDefault();
  const inCategory = Object.values(FUNCTION_HELP)
    .filter((f) => f.category === category)
    .sort((a, b) => a.name.localeCompare(b.name));

  return (
    <Dropdown
      title="Insert a function into the active cell"
      triggerClassName={cmd}
      panelClassName={panelForm}
      label={
        <>
          <Ico.fn />
          Function
        </>
      }
    >
      {(close) => (
        <div className="w-[280px]">
          <div className="flex flex-wrap gap-0.5 border-b border-hairline px-2 pb-1.5 pt-1">
            {CATEGORIES.map((c) => (
              <button
                key={c}
                type="button"
                onMouseDown={keepFocus}
                onClick={() => setCategory(c)}
                className={`rounded-md px-1.5 py-0.5 text-[11px] transition-colors ${
                  c === category
                    ? "bg-[color-mix(in_srgb,var(--ink)_14%,transparent)] text-ink"
                    : "text-ink-muted hover:text-ink"
                }`}
              >
                {c}
              </button>
            ))}
          </div>
          <div className="max-h-[240px] overflow-y-auto scroll-slim py-1">
            {inCategory.map((f) => (
              <button
                key={f.name}
                type="button"
                className={menuItem}
                title={`${f.summary}\n\nExample: ${f.example}`}
                onMouseDown={keepFocus}
                onClick={() => {
                  controller.insertFunction(f.name);
                  close();
                }}
              >
                <span data-figure className="font-medium">{f.name}</span>
                <span className="min-w-0 flex-1 truncate text-right text-[11px] text-ink-faint">
                  {f.summary}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </Dropdown>
  );
}

/* ── Link ─────────────────────────────────────────────────────────────────── */

/** Set or clear the active cell's link. `setCellLink` normalises and refuses
    `javascript:` and `data:`, so nothing unsafe reaches a cell from here. */
function LinkMenu({ controller }: { controller: SpreadsheetController }) {
  return (
    <Dropdown
      title="Insert link (Ctrl+K)"
      triggerClassName={cmd}
      panelClassName={panelForm}
      label={
        <>
          <Ico.link />
          Link
          <Key>Ctrl+K</Key>
        </>
      }
    >
      {(close) => <LinkForm controller={controller} close={close} />}
    </Dropdown>
  );
}

/**
 * Mounted fresh each time the menu opens, which is what makes it read the cell
 * you are actually on. Held in the parent instead, the field kept the last
 * cell's address and pressing Apply without typing wrote it onto the new one —
 * or, on an empty field, silently removed a link the reader never touched.
 */
function LinkForm({
  controller,
  close,
}: {
  controller: SpreadsheetController;
  close: () => void;
}) {
  const { active } = controller.selection;
  const current = controller.linkLookup(active.row, active.col) ?? "";
  const [url, setUrl] = useState(current);
  const [refused, setRefused] = useState(false);

  function apply() {
    const text = url.trim();
    if (text === "") {
      controller.setCellLink(null);
      close();
      return;
    }
    /* `setCellLink` refuses anything `normalizeUrl` will not accept, and says so
       by leaving the cell alone — so the panel has to check the same thing to
       tell the reader why nothing happened. */
    if (normalizeUrl(text) === null) {
      setRefused(true);
      return;
    }
    controller.setCellLink(text);
    close();
  }

  return (
    <div className="w-[260px] p-2">
      <label className="mb-1.5 block text-[11px] text-ink-muted" htmlFor="sheet-link-url">
        Address
      </label>
      <div className="flex items-center gap-1.5">
        <input
          id="sheet-link-url"
          autoFocus
          className={field}
          placeholder="example.com"
          value={url}
          onChange={(e) => {
            setUrl(e.target.value);
            setRefused(false);
          }}
          onKeyDown={(e) => {
            if (e.key !== "Enter") return;
            e.preventDefault();
            apply();
          }}
        />
        <button type="button" className={primary} onMouseDown={(e) => e.preventDefault()} onClick={apply}>
          Apply
        </button>
      </div>
      {refused && (
        <p role="alert" className="mt-1.5 text-[11px] text-[var(--state-overdue-ink)]">
          That isn&rsquo;t a web or email address Cowork will open.
        </p>
      )}
      {current && (
        <button
          type="button"
          className="mt-2 text-[11px] text-ink-muted underline-offset-2 hover:text-ink hover:underline"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            controller.setCellLink(null);
            close();
          }}
        >
          Remove link
        </button>
      )}
    </div>
  );
}

/* ── Drop-down ────────────────────────────────────────────────────────────── */

/** A list validation over the selection — the reference's Insert ▸ Drop-down.
    Rejecting input is the point, so "Reject invalid entries" is the default and
    the alternative is stated rather than hidden behind a settings panel. */
function DropdownMenu({ controller }: { controller: SpreadsheetController }) {
  const [values, setValues] = useState("");
  const [strict, setStrict] = useState(true);
  const list = values.split(",").map((v) => v.trim()).filter(Boolean);

  return (
    <Dropdown
      title="Turn the selection into a drop-down list"
      triggerClassName={cmd}
      panelClassName={panelForm}
      label={
        <>
          <Ico.dropdown />
          Drop-down
        </>
      }
    >
      {(close) => (
        <div className="w-[260px] p-2">
          <label className="mb-1.5 block text-[11px] text-ink-muted" htmlFor="sheet-dropdown-values">
            Options, comma separated
          </label>
          <input
            id="sheet-dropdown-values"
            autoFocus
            className={field}
            placeholder="To do, In progress, Done"
            value={values}
            onChange={(e) => setValues(e.target.value)}
          />
          <label className="mt-2 flex items-center gap-1.5 text-[11px] text-ink-muted">
            <input type="checkbox" checked={strict} onChange={(e) => setStrict(e.target.checked)} />
            Reject anything not on the list
          </label>
          <div className="mt-2 flex items-center justify-between gap-2">
            <span className="text-[11px] text-ink-faint">
              {list.length ? `${list.length} option${list.length === 1 ? "" : "s"}` : "No options yet"}
            </span>
            <button
              type="button"
              className={primary}
              disabled={list.length === 0}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                controller.setValidation(
                  { kind: "list", values: list },
                  { errorStyle: strict ? "stop" : "warning" },
                );
                close();
              }}
            >
              Apply
            </button>
          </div>
        </div>
      )}
    </Dropdown>
  );
}

/* ── Emoji ────────────────────────────────────────────────────────────────── */

function EmojiMenu({ controller }: { controller: SpreadsheetController }) {
  return (
    <Dropdown
      title="Add an emoji to the active cell"
      triggerClassName={cmd}
      panelClassName={panelForm}
      label={
        <>
          <Ico.emoji />
          Emoji
        </>
      }
    >
      {(close) => (
        <div className="w-[236px] p-1.5">
          {EMOJI.map((row) => (
            <div key={row.group}>
              <p className={menuLabel}>{row.group}</p>
              <div className="flex flex-wrap gap-0.5 px-1.5 pb-1">
                {row.chars.map((c) => (
                  <button
                    key={c}
                    type="button"
                    aria-label={`Insert ${c}`}
                    className="grid h-7 w-7 place-items-center rounded-md text-[15px] transition-colors hover:bg-[color-mix(in_srgb,var(--ink)_10%,transparent)]"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => {
                      controller.appendToCell(c);
                      close();
                    }}
                  >
                    {c}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </Dropdown>
  );
}

/* ── Comment ──────────────────────────────────────────────────────────────── */

/**
 * A comment on the active cell.
 *
 * The reference separates Comment from Note — a thread against a plain
 * annotation. This build stores threads only, so it offers the one it actually
 * has rather than two controls writing to the same place under different names.
 */
function CommentMenu({
  controller,
  row,
  col,
}: {
  controller: SpreadsheetController;
  row: number;
  col: number;
}) {
  const [body, setBody] = useState("");
  const existing = controller.commentLookup(row, col);

  return (
    <Dropdown
      title="Comment on the active cell (Ctrl+Alt+M)"
      triggerClassName={cmd}
      panelClassName={panelForm}
      label={
        <>
          <Ico.comment />
          Comment
          <Key>Ctrl+Alt+M</Key>
        </>
      }
    >
      {(close) => (
        <div className="w-[260px] p-2">
          {existing && existing.entries.length > 0 && (
            <p className="mb-1.5 text-[11px] text-ink-faint">
              {existing.entries.length} already on this cell
            </p>
          )}
          <textarea
            autoFocus
            rows={3}
            className={`${field} h-auto resize-y py-1.5`}
            placeholder="Add a comment"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== "Enter" || e.shiftKey) return;
              e.preventDefault();
              if (!body.trim()) return;
              controller.addComment(row, col, body.trim());
              setBody("");
              close();
            }}
          />
          <div className="mt-2 flex items-center justify-end">
            <button
              type="button"
              className={primary}
              disabled={!body.trim()}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                controller.addComment(row, col, body.trim());
                setBody("");
                close();
              }}
            >
              Comment
            </button>
          </div>
        </div>
      )}
    </Dropdown>
  );
}

/*
 * From the reference menu, deliberately absent — and what each would need:
 *
 *  · **Chart** — a chart engine. Nothing in this build renders a series, and a
 *    chart is not a cell edit: it is a floating object the worksheet model has
 *    no place to store.
 *  · **Pivot table** — an aggregation engine plus a second grid to host it.
 *  · **Timeline** — a date-axis view over a range; the same floating-object gap
 *    as Chart, plus a view this build does not have.
 *  · **Image** and **Drawing** — the cell model holds a value, a style and an
 *    optional link. Neither has anywhere to live, in the model or in `.xlsx`
 *    export.
 *  · **Smart chips** — people, files and dates as first-class entities in a
 *    cell. That is an entity model, not a formatting feature.
 *  · **Note** — the reference's plain annotation, distinct from a comment
 *    thread. `comments.ts` stores threads only; adding notes means a second
 *    field on the cell, its own rendering, and a column in every import and
 *    export path. Offering it as a second button onto the SAME storage would be
 *    two names for one thing, which is exactly the fake option this file
 *    refuses.
 *
 * Each is a real feature rather than plumbing, which is why none is stubbed.
 */
