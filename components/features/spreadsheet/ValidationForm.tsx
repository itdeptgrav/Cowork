"use client";

/**
 * The data-validation form — every rule the engine understands, in one list.
 *
 * The list is grouped the way a person thinks about it (numbers, dates, text,
 * lists, formats, presence) rather than by how the rules happen to be modelled:
 * `Email`, `URL` and `IPv4` are one `shape` rule underneath, but nobody picks a
 * "shape" from a menu — they pick "Email". The mapping from a picked name to a
 * `ValidationRule` lives in `RULES` below, so adding a format is one entry.
 *
 * Below the rule sit the BEHAVIOUR settings, which are separate on purpose: they
 * decide what happens when the rule is broken, and they apply whichever rule is
 * chosen. `Stop` refuses the entry; `Warning` and `Information` let it through
 * and only say something.
 */

import { useState } from "react";
import type {
  CompareOp,
  TextMatch,
  ValidationRule,
} from "@/lib/spreadsheet/validation";
import type { SpreadsheetController, ValidationSettings } from "./useSpreadsheet";

/** Which extra inputs a chosen rule needs. */
type Shape = "none" | "compare" | "text" | "list" | "formula" | "pattern";

interface RuleSpec {
  id: string;
  label: string;
  group: string;
  shape: Shape;
  /** Builds the rule from whatever the form collected. */
  build: (f: Fields) => ValidationRule;
}

interface Fields {
  op: CompareOp;
  a: string;
  b: string;
  textOp: TextMatch;
  text: string;
  list: string;
  formula: string;
  pattern: string;
  patternMatch: boolean;
}

const num = (s: string) => (s.trim() === "" ? 0 : Number(s));

const RULES: RuleSpec[] = [
  /* Numbers */
  { id: "decimal", label: "Decimal", group: "Number", shape: "compare",
    build: (f) => ({ kind: "number", op: f.op, a: num(f.a), b: num(f.b) }) },
  { id: "wholeNumber", label: "Whole number", group: "Number", shape: "none",
    build: () => ({ kind: "numberShape", shape: "integer" }) },
  { id: "positive", label: "Positive number", group: "Number", shape: "none",
    build: () => ({ kind: "numberShape", shape: "positive" }) },
  { id: "negative", label: "Negative number", group: "Number", shape: "none",
    build: () => ({ kind: "numberShape", shape: "negative" }) },
  { id: "nonNegative", label: "Non-negative number", group: "Number", shape: "none",
    build: () => ({ kind: "numberShape", shape: "nonNegative" }) },
  { id: "percentage", label: "Percentage (0–100%)", group: "Number", shape: "none",
    build: () => ({ kind: "numberShape", shape: "percentage" }) },

  /* Dates and times — both are serials, so both compare numerically. */
  { id: "date", label: "Date", group: "Date & time", shape: "compare",
    build: (f) => ({ kind: "date", op: f.op, a: num(f.a), b: num(f.b) }) },
  { id: "time", label: "Time", group: "Date & time", shape: "compare",
    build: (f) => ({ kind: "date", op: f.op, a: num(f.a), b: num(f.b) }) },

  /* Text */
  { id: "text", label: "Text", group: "Text", shape: "text",
    build: (f) => ({ kind: "text", op: f.textOp, value: f.text }) },
  { id: "textLength", label: "Text length", group: "Text", shape: "compare",
    build: (f) => ({ kind: "textLength", op: f.op, a: num(f.a), b: num(f.b) }) },
  { id: "regex", label: "Regular expression", group: "Text", shape: "pattern",
    build: (f) => ({ kind: "pattern", source: f.pattern, match: f.patternMatch }) },

  /* Named formats */
  { id: "email", label: "Email", group: "Format", shape: "none", build: () => ({ kind: "shape", shape: "email" }) },
  { id: "url", label: "URL", group: "Format", shape: "none", build: () => ({ kind: "shape", shape: "url" }) },
  { id: "phone", label: "Phone number", group: "Format", shape: "none", build: () => ({ kind: "shape", shape: "phone" }) },
  { id: "ipv4", label: "IP address (v4)", group: "Format", shape: "none", build: () => ({ kind: "shape", shape: "ipv4" }) },
  { id: "ipv6", label: "IP address (v6)", group: "Format", shape: "none", build: () => ({ kind: "shape", shape: "ipv6" }) },
  { id: "alnum", label: "Letters and numbers only", group: "Format", shape: "none", build: () => ({ kind: "shape", shape: "alphanumeric" }) },
  { id: "letters", label: "Letters only", group: "Format", shape: "none", build: () => ({ kind: "shape", shape: "letters" }) },
  { id: "digits", label: "Numbers only", group: "Format", shape: "none", build: () => ({ kind: "shape", shape: "digits" }) },

  /* Lists */
  { id: "list", label: "Dropdown (list)", group: "List", shape: "list",
    build: (f) => ({ kind: "list", values: f.list.split(",").map((s) => s.trim()).filter(Boolean) }) },
  { id: "checkbox", label: "Checkbox", group: "List", shape: "none", build: () => ({ kind: "checkbox" }) },

  /* Presence and uniqueness */
  { id: "notBlank", label: "Not blank", group: "Presence", shape: "none",
    build: () => ({ kind: "blank", mustHaveValue: true }) },
  { id: "blankOnly", label: "Blank only", group: "Presence", shape: "none",
    build: () => ({ kind: "blank", mustHaveValue: false }) },
  { id: "unique", label: "Unique in range", group: "Presence", shape: "none",
    build: () => ({ kind: "unique", unique: true }) },
  { id: "duplicate", label: "Must be a duplicate", group: "Presence", shape: "none",
    build: () => ({ kind: "unique", unique: false }) },

  /* Escape hatch */
  { id: "custom", label: "Custom formula", group: "Custom", shape: "formula",
    build: (f) => ({ kind: "custom", formula: f.formula }) },
];

const GROUPS = [...new Set(RULES.map((r) => r.group))];

const field =
  "h-7 w-full rounded-md border border-hairline bg-[var(--surface-raised)] px-1.5 text-[12px] text-ink outline-none";
const btn =
  "inline-flex h-7 items-center rounded-md px-2 text-[12px] text-ink-muted transition-colors hover:bg-[color-mix(in_srgb,var(--ink)_7%,transparent)] hover:text-ink";
const applyBtn =
  "h-7 rounded-md bg-ink px-2.5 text-[12px] font-medium text-[var(--body-bg)] transition-opacity hover:opacity-90";

export function ValidationForm({
  controller,
  onDone,
}: {
  controller: SpreadsheetController;
  onDone: () => void;
}) {
  const [id, setId] = useState("list");
  const [f, setF] = useState<Fields>({
    op: "between",
    a: "0",
    b: "100",
    textOp: "contains",
    text: "",
    list: "Yes,No,Maybe",
    formula: "=TRUE",
    pattern: "^[A-Z]{2}[0-9]+$",
    patternMatch: true,
  });
  const [allowBlank, setAllowBlank] = useState(true);
  const [errorStyle, setErrorStyle] = useState<"stop" | "warning" | "information">("stop");
  const [errorMessage, setErrorMessage] = useState("");

  const spec = RULES.find((r) => r.id === id)!;
  const set = <K extends keyof Fields>(k: K, v: Fields[K]) => setF((p) => ({ ...p, [k]: v }));

  function apply() {
    const settings: ValidationSettings = {
      allowBlank,
      errorStyle,
      ...(errorMessage.trim() ? { errorMessage: errorMessage.trim() } : {}),
    };
    controller.setValidation(spec.build(f), settings);
    onDone();
  }

  return (
    <>
      <select className={field} aria-label="Validation rule" value={id} onChange={(e) => setId(e.target.value)}>
        {GROUPS.map((g) => (
          <optgroup key={g} label={g}>
            {RULES.filter((r) => r.group === g).map((r) => (
              <option key={r.id} value={r.id}>{r.label}</option>
            ))}
          </optgroup>
        ))}
      </select>

      {spec.shape === "compare" && (
        <div className="flex items-center gap-1">
          <select className={field} aria-label="Comparison" value={f.op} onChange={(e) => set("op", e.target.value as CompareOp)}>
            <option value="any">any</option>
            <option value="=">equal to</option>
            <option value="<>">not equal to</option>
            <option value=">">greater than</option>
            <option value=">=">greater than or equal to</option>
            <option value="<">less than</option>
            <option value="<=">less than or equal to</option>
            <option value="between">between</option>
            <option value="notBetween">not between</option>
          </select>
          <input className={field} aria-label="Value" value={f.a} onChange={(e) => set("a", e.target.value)} />
          {(f.op === "between" || f.op === "notBetween") && (
            <input className={field} aria-label="Upper value" value={f.b} onChange={(e) => set("b", e.target.value)} />
          )}
        </div>
      )}

      {spec.shape === "text" && (
        <div className="flex items-center gap-1">
          <select className={field} aria-label="Text test" value={f.textOp} onChange={(e) => set("textOp", e.target.value as TextMatch)}>
            <option value="contains">contains</option>
            <option value="notContains">does not contain</option>
            <option value="equals">is exactly</option>
            <option value="notEquals">is not</option>
            <option value="startsWith">begins with</option>
            <option value="notStartsWith">does not begin with</option>
            <option value="endsWith">ends with</option>
            <option value="notEndsWith">does not end with</option>
          </select>
          <input className={field} aria-label="Text" value={f.text} onChange={(e) => set("text", e.target.value)} />
        </div>
      )}

      {spec.shape === "list" && (
        <input className={field} aria-label="List values" value={f.list} onChange={(e) => set("list", e.target.value)} placeholder="A,B,C" />
      )}

      {spec.shape === "formula" && (
        <input className={field} aria-label="Formula" value={f.formula} onChange={(e) => set("formula", e.target.value)} placeholder="=A1>0" />
      )}

      {spec.shape === "pattern" && (
        <div className="flex items-center gap-1">
          <select className={field} aria-label="Pattern test" value={f.patternMatch ? "match" : "no"} onChange={(e) => set("patternMatch", e.target.value === "match")}>
            <option value="match">matches</option>
            <option value="no">does not match</option>
          </select>
          <input className={field} aria-label="Regular expression" value={f.pattern} onChange={(e) => set("pattern", e.target.value)} />
        </div>
      )}

      <div className="mt-1 h-px bg-[var(--color-hairline)]" />

      <label className="flex items-center gap-2 text-[12px] text-ink" title="An empty cell passes the rule. Excel calls this “Ignore blank”.">
        <input type="checkbox" checked={allowBlank} onChange={(e) => setAllowBlank(e.target.checked)} />
        Allow blank
      </label>

      <label className="flex flex-col gap-1 text-[12px] text-ink-muted">
        If the rule is broken
        <select
          className={field}
          aria-label="Error style"
          value={errorStyle}
          onChange={(e) => setErrorStyle(e.target.value as "stop" | "warning" | "information")}
        >
          <option value="stop">Stop — refuse the entry</option>
          <option value="warning">Warning — allow it</option>
          <option value="information">Information — allow it</option>
        </select>
      </label>

      <input
        className={field}
        aria-label="Error message"
        value={errorMessage}
        onChange={(e) => setErrorMessage(e.target.value)}
        placeholder="Message (optional)"
      />

      <div className="flex items-center justify-between">
        <button type="button" className={btn} onClick={() => { controller.clearValidation(); onDone(); }}>
          Any value
        </button>
        <button type="button" className={applyBtn} onClick={apply}>
          Apply
        </button>
      </div>
    </>
  );
}
