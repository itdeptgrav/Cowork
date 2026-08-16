"use client";

/**
 * The data-features bar — sort, filter, data validation, conditional formatting.
 *
 * Each control acts on the current selection through the controller: sort and
 * filter are one click; validation and conditional formatting open a small
 * popover to configure a rule and apply it. The rules themselves are pure and
 * tested; this is only the form that builds one.
 */

import { useState } from "react";
import type { CompareOp, TextMatch, ValidationRule } from "@/lib/spreadsheet/validation";
import type { CondCondition } from "@/lib/spreadsheet/conditional";
import { SheetIcon } from "./SheetIcons";
import { Dropdown } from "./Dropdown";
import type { SpreadsheetController } from "./useSpreadsheet";

const btn =
  "inline-flex h-7 items-center rounded-md px-2 text-[12px] text-ink-muted transition-colors hover:bg-[color-mix(in_srgb,var(--ink)_7%,transparent)] hover:text-ink";
const field =
  "h-7 rounded-md border border-hairline bg-[var(--surface-raised)] px-1.5 text-[12px] text-ink outline-none";
const applyBtn =
  "h-7 rounded-md bg-ink px-2.5 text-[12px] font-medium text-[var(--body-bg)] transition-opacity hover:opacity-90";

function Popover({
  label,
  children,
}: {
  label: string;
  children: (close: () => void) => React.ReactNode;
}) {
  return (
    <Dropdown
      label={`${label} ▾`}
      triggerClassName={`${btn} cursor-pointer`}
      panelClassName="absolute left-0 top-8 z-30 flex w-64 flex-col gap-2 rounded-card border border-hairline bg-[var(--surface-raised)] p-2.5 shadow-lg"
    >
      {children}
    </Dropdown>
  );
}

export function ValidationForm({
  controller,
  onDone,
}: {
  controller: SpreadsheetController;
  onDone: () => void;
}) {
  const [kind, setKind] = useState<ValidationRule["kind"]>("list");
  const [list, setList] = useState("Yes,No,Maybe");
  const [op, setOp] = useState<CompareOp>(">");
  const [textOp, setTextOp] = useState<TextMatch>("contains");
  const [a, setA] = useState("0");
  const [b, setB] = useState("100");
  const [textValue, setTextValue] = useState("");
  const [formula, setFormula] = useState("=TRUE");

  function apply() {
    let rule: ValidationRule | null = null;
    switch (kind) {
      case "list":
        rule = { kind: "list", values: list.split(",").map((s) => s.trim()).filter(Boolean) };
        break;
      case "checkbox":
        rule = { kind: "checkbox" };
        break;
      case "number":
        rule = { kind: "number", op, a: Number(a), b: Number(b) };
        break;
      case "date":
        rule = { kind: "date", op, a: Number(a), b: Number(b) };
        break;
      case "text":
        rule = { kind: "text", op: textOp, value: textValue };
        break;
      case "custom":
        rule = { kind: "custom", formula };
        break;
    }
    if (rule) controller.setValidation(rule);
    onDone();
  }

  return (
    <>
      <select className={field} value={kind} onChange={(e) => setKind(e.target.value as ValidationRule["kind"])}>
        <option value="list">Dropdown (list)</option>
        <option value="checkbox">Checkbox</option>
        <option value="number">Number</option>
        <option value="text">Text</option>
        <option value="date">Date</option>
        <option value="custom">Custom formula</option>
      </select>
      {kind === "list" && (
        <input className={field} value={list} onChange={(e) => setList(e.target.value)} placeholder="A,B,C" />
      )}
      {(kind === "number" || kind === "date") && (
        <div className="flex items-center gap-1">
          <select className={field} value={op} onChange={(e) => setOp(e.target.value as CompareOp)}>
            <option value="any">any</option>
            <option value=">">&gt;</option>
            <option value="<">&lt;</option>
            <option value=">=">&ge;</option>
            <option value="<=">&le;</option>
            <option value="=">=</option>
            <option value="between">between</option>
          </select>
          <input className={`${field} w-16`} value={a} onChange={(e) => setA(e.target.value)} />
          {op === "between" && <input className={`${field} w-16`} value={b} onChange={(e) => setB(e.target.value)} />}
        </div>
      )}
      {kind === "text" && (
        <div className="flex items-center gap-1">
          <select className={field} value={textOp} onChange={(e) => setTextOp(e.target.value as TextMatch)}>
            <option value="contains">contains</option>
            <option value="equals">equals</option>
            <option value="startsWith">starts with</option>
            <option value="endsWith">ends with</option>
          </select>
          <input className={`${field} flex-1`} value={textValue} onChange={(e) => setTextValue(e.target.value)} />
        </div>
      )}
      {kind === "custom" && (
        <input className={field} value={formula} onChange={(e) => setFormula(e.target.value)} placeholder="=A1>0" />
      )}
      <div className="flex items-center justify-between">
        <button
          type="button"
          className={btn}
          onClick={() => {
            controller.clearValidation();
            onDone();
          }}
        >
          Clear
        </button>
        <button type="button" className={applyBtn} onClick={apply}>
          Apply
        </button>
      </div>
    </>
  );
}

export function ConditionalFormatForm({
  controller,
  onDone,
}: {
  controller: SpreadsheetController;
  onDone: () => void;
}) {
  const [type, setType] = useState<CondCondition["type"]>("greaterThan");
  const [a, setA] = useState("100");
  const [b, setB] = useState("200");
  const [text, setText] = useState("");
  const [formula, setFormula] = useState("=A1>0");
  const [bg, setBg] = useState("#fde68a");

  function apply() {
    let condition: CondCondition;
    switch (type) {
      case "greaterThan":
        condition = { type, value: Number(a) };
        break;
      case "lessThan":
        condition = { type, value: Number(a) };
        break;
      case "equalTo":
        condition = { type, value: /^-?\d/.test(a.trim()) ? Number(a) : a };
        break;
      case "between":
        condition = { type, a: Number(a), b: Number(b) };
        break;
      case "textContains":
        condition = { type, value: text };
        break;
      case "duplicateValues":
        condition = { type };
        break;
      case "customFormula":
        condition = { type, formula };
        break;
    }
    const styleId = controller.styleRegistry.intern({ background: bg });
    controller.addConditionalFormat(condition, styleId);
    onDone();
  }

  const needsNumber = type === "greaterThan" || type === "lessThan" || type === "between" || type === "equalTo";
  return (
    <>
      <select className={field} value={type} onChange={(e) => setType(e.target.value as CondCondition["type"])}>
        <option value="greaterThan">Greater than</option>
        <option value="lessThan">Less than</option>
        <option value="equalTo">Equal to</option>
        <option value="between">Between</option>
        <option value="textContains">Text contains</option>
        <option value="duplicateValues">Duplicate values</option>
        <option value="customFormula">Custom formula</option>
      </select>
      {needsNumber && (
        <div className="flex items-center gap-1">
          <input className={`${field} w-20`} value={a} onChange={(e) => setA(e.target.value)} />
          {type === "between" && <input className={`${field} w-20`} value={b} onChange={(e) => setB(e.target.value)} />}
        </div>
      )}
      {type === "textContains" && (
        <input className={field} value={text} onChange={(e) => setText(e.target.value)} placeholder="text" />
      )}
      {type === "customFormula" && (
        <input className={field} value={formula} onChange={(e) => setFormula(e.target.value)} placeholder="=A1>0" />
      )}
      <label className="flex items-center gap-2 text-[12px] text-ink-muted">
        Fill
        <input
          type="color"
          value={bg}
          onChange={(e) => setBg(e.target.value)}
          className="h-6 w-8 cursor-pointer rounded border border-hairline bg-transparent"
        />
      </label>
      <div className="flex items-center justify-between">
        <button
          type="button"
          className={btn}
          onClick={() => {
            controller.clearConditionalFormats();
            onDone();
          }}
        >
          Clear
        </button>
        <button type="button" className={applyBtn} onClick={apply}>
          Apply
        </button>
      </div>
    </>
  );
}

export function DataControls({
  controller,
  variant = "bar",
}: {
  controller: SpreadsheetController;
  /** `"ribbon"` drops the outer card, since the ribbon supplies it. */
  variant?: "bar" | "ribbon";
}) {
  const hasFilter = !!controller.worksheet.filter;
  /* Acting on the selection must not TAKE the selection: without this the click
     moves focus to the button, and the grid stops answering the keyboard until
     a cell is clicked again. Every toolbar in this app keeps focus the same way. */
  const keepFocus = (e: React.MouseEvent) => e.preventDefault();
  return (
    <div
      className={
        variant === "ribbon"
          ? "flex flex-wrap items-center gap-1 text-[12px]"
          : "flex shrink-0 flex-wrap items-center gap-1 rounded-card border border-hairline bg-[var(--surface-raised)] px-2 py-1 text-[12px]"
      }
    >
      {variant === "bar" && <span className="px-1 font-medium text-ink-muted">Data</span>}
      <button
        type="button"
        className={`${btn} gap-1.5`}
        title="Sort the selection ascending"
        onMouseDown={keepFocus}
        onClick={() => controller.sortSelection("asc")}
      >
        <SheetIcon.sortAsc />
        Sort
      </button>
      <button
        type="button"
        className={`${btn} gap-1.5`}
        title="Sort the selection descending"
        onMouseDown={keepFocus}
        onClick={() => controller.sortSelection("desc")}
      >
        <SheetIcon.sortDesc />
        Sort
      </button>
      <span aria-hidden className="mx-0.5 h-5 w-px bg-[var(--color-hairline)]" />
      <button
        type="button"
        title={hasFilter ? "Remove the filter" : "Create a filter over the selection"}
        aria-pressed={hasFilter}
        onMouseDown={keepFocus}
        onClick={() => controller.toggleFilter()}
        className={`${btn} gap-1.5 ${hasFilter ? "bg-[color-mix(in_srgb,var(--ink)_12%,transparent)] text-ink" : ""}`}
      >
        <SheetIcon.filter />
        Filter{hasFilter ? " ✓" : ""}
      </button>
      <span aria-hidden className="mx-0.5 h-5 w-px bg-[var(--color-hairline)]" />
      <Popover label="Validate">
        {(close) => <ValidationForm controller={controller} onDone={close} />}
      </Popover>
      <Popover label="Format rules">
        {(close) => <ConditionalFormatForm controller={controller} onDone={close} />}
      </Popover>
    </div>
  );
}
