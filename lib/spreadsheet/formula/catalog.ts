/**
 * The function catalog — the human side of the formula library.
 *
 * `functions/*` holds what each function DOES; this holds how it READS: its
 * signature, a one-line description and an example, so the editor can suggest
 * functions and explain them the way Sheets and Excel do. Every name registered
 * in `FUNCTIONS` has an entry here — `catalog.test.ts` fails the build if one
 * drifts out of sync, the same guard the help corpus uses.
 *
 * Pure data plus two tiny helpers; no React, no engine state.
 */

export type FnCategory =
  | "Math"
  | "Text"
  | "Logical"
  | "Date"
  | "Statistical"
  | "Lookup"
  | "Array";

export interface FnArg {
  name: string;
  /** Rendered in [brackets] and skippable. */
  optional?: boolean;
  /** The tail argument repeats — rendered with an ellipsis. */
  repeatable?: boolean;
}

export interface FunctionHelp {
  name: string;
  category: FnCategory;
  args: FnArg[];
  /** One line: what it does, in plain language. */
  summary: string;
  /** A short, valid call a reader can copy. */
  example: string;
  /**
   * An explicit signature string for the few functions whose arguments repeat
   * in PAIRS (IFS, SWITCH, the *IFS aggregates) — the bracket/ellipsis rules
   * below cannot express those cleanly. When set, per-argument highlighting is
   * skipped for that function and the whole signature is shown instead.
   */
  signature?: string;
}

const req = (name: string): FnArg => ({ name });
const opt = (name: string): FnArg => ({ name, optional: true });
const rep = (name: string): FnArg => ({ name, optional: true, repeatable: true });

export const FUNCTION_HELP: Record<string, FunctionHelp> = {
  /* ── Math ─────────────────────────────────────────────────────────────── */
  ABS: { name: "ABS", category: "Math", args: [req("number")], summary: "Returns the absolute value of a number, dropping its sign.", example: "ABS(-4)" },
  ROUND: { name: "ROUND", category: "Math", args: [req("number"), opt("places")], summary: "Rounds a number to a given number of decimal places.", example: "ROUND(3.14159, 2)" },
  ROUNDUP: { name: "ROUNDUP", category: "Math", args: [req("number"), opt("places")], summary: "Rounds a number away from zero to a given number of places.", example: "ROUNDUP(3.2, 0)" },
  ROUNDDOWN: { name: "ROUNDDOWN", category: "Math", args: [req("number"), opt("places")], summary: "Rounds a number toward zero to a given number of places.", example: "ROUNDDOWN(3.9, 0)" },
  MOD: { name: "MOD", category: "Math", args: [req("dividend"), req("divisor")], summary: "Returns the remainder left after dividing one number by another.", example: "MOD(10, 3)" },
  POWER: { name: "POWER", category: "Math", args: [req("base"), req("exponent")], summary: "Raises a base to the power of an exponent.", example: "POWER(2, 10)" },
  CEILING: { name: "CEILING", category: "Math", args: [req("number"), opt("significance")], summary: "Rounds a number up to the nearest multiple of significance.", example: "CEILING(7, 5)" },
  FLOOR: { name: "FLOOR", category: "Math", args: [req("number"), opt("significance")], summary: "Rounds a number down to the nearest multiple of significance.", example: "FLOOR(7, 5)" },
  INT: { name: "INT", category: "Math", args: [req("number")], summary: "Rounds a number down to the nearest whole number.", example: "INT(4.7)" },
  TRUNC: { name: "TRUNC", category: "Math", args: [req("number"), opt("places")], summary: "Cuts a number to a number of places without rounding.", example: "TRUNC(4.78, 1)" },
  RAND: { name: "RAND", category: "Math", args: [], summary: "Returns a random number between 0 and 1.", example: "RAND()" },
  RANDBETWEEN: { name: "RANDBETWEEN", category: "Math", args: [req("low"), req("high")], summary: "Returns a random whole number between two values, inclusive.", example: "RANDBETWEEN(1, 6)" },
  SUM: { name: "SUM", category: "Math", args: [req("value1"), rep("value2")], summary: "Adds numbers and the numeric cells in the ranges you give it.", example: "SUM(A1:A10)" },
  MIN: { name: "MIN", category: "Math", args: [req("value1"), rep("value2")], summary: "Returns the smallest number among the values and ranges.", example: "MIN(A1:A10)" },
  MAX: { name: "MAX", category: "Math", args: [req("value1"), rep("value2")], summary: "Returns the largest number among the values and ranges.", example: "MAX(A1:A10)" },

  /* ── Text ─────────────────────────────────────────────────────────────── */
  CONCATENATE: { name: "CONCATENATE", category: "Text", args: [req("text1"), rep("text2")], summary: "Joins several pieces of text into one string.", example: 'CONCATENATE(A1, " ", B1)' },
  LEN: { name: "LEN", category: "Text", args: [req("text")], summary: "Returns the number of characters in a text string.", example: "LEN(A1)" },
  LEFT: { name: "LEFT", category: "Text", args: [req("text"), opt("count")], summary: "Returns the first characters of a text string.", example: "LEFT(A1, 3)" },
  RIGHT: { name: "RIGHT", category: "Text", args: [req("text"), opt("count")], summary: "Returns the last characters of a text string.", example: "RIGHT(A1, 3)" },
  MID: { name: "MID", category: "Text", args: [req("text"), req("start"), req("count")], summary: "Returns characters from the middle of a string, from a start position for a length.", example: "MID(A1, 2, 3)" },
  LOWER: { name: "LOWER", category: "Text", args: [req("text")], summary: "Converts text to lowercase.", example: "LOWER(A1)" },
  UPPER: { name: "UPPER", category: "Text", args: [req("text")], summary: "Converts text to uppercase.", example: "UPPER(A1)" },
  TRIM: { name: "TRIM", category: "Text", args: [req("text")], summary: "Removes leading, trailing and repeated spaces from text.", example: "TRIM(A1)" },
  SUBSTITUTE: { name: "SUBSTITUTE", category: "Text", args: [req("text"), req("find"), req("replace"), opt("occurrence")], summary: "Replaces occurrences of one substring with another inside text.", example: 'SUBSTITUTE(A1, "-", " ")' },
  FIND: { name: "FIND", category: "Text", args: [req("search_for"), req("text"), opt("start")], summary: "Returns the position of a substring within text — case-sensitive.", example: 'FIND("a", A1)' },
  SEARCH: { name: "SEARCH", category: "Text", args: [req("search_for"), req("text"), opt("start")], summary: "Returns the position of a substring within text — case-insensitive.", example: 'SEARCH("a", A1)' },
  TEXT: { name: "TEXT", category: "Text", args: [req("number"), req("format")], summary: "Formats a number as text using a format pattern.", example: 'TEXT(A1, "0.00")' },
  VALUE: { name: "VALUE", category: "Text", args: [req("text")], summary: "Converts text that looks like a number into a number.", example: 'VALUE("42")' },

  /* ── Logical ──────────────────────────────────────────────────────────── */
  IF: { name: "IF", category: "Logical", args: [req("condition"), req("value_if_true"), opt("value_if_false")], summary: "Returns one value when a condition is TRUE and another when it is FALSE.", example: 'IF(A1>10, "High", "Low")' },
  AND: { name: "AND", category: "Logical", args: [req("logical1"), rep("logical2")], summary: "Returns TRUE only when every argument is TRUE.", example: "AND(A1>0, B1>0)" },
  OR: { name: "OR", category: "Logical", args: [req("logical1"), rep("logical2")], summary: "Returns TRUE when any argument is TRUE.", example: "OR(A1>0, B1>0)" },
  XOR: { name: "XOR", category: "Logical", args: [req("logical1"), rep("logical2")], summary: "Returns TRUE when an odd number of arguments are TRUE.", example: "XOR(A1>0, B1>0)" },
  NOT: { name: "NOT", category: "Logical", args: [req("logical")], summary: "Reverses a logical value — TRUE becomes FALSE and back.", example: "NOT(A1>0)" },
  IFERROR: { name: "IFERROR", category: "Logical", args: [req("value"), opt("value_if_error")], summary: "Returns a fallback value when a formula would evaluate to an error.", example: "IFERROR(A1/B1, 0)" },
  IFS: { name: "IFS", category: "Logical", args: [req("condition1"), req("value1"), rep("condition2"), rep("value2")], signature: "IFS(condition1, value1, [condition2, value2, …])", summary: "Returns the value for the first condition that is TRUE.", example: 'IFS(A1>90, "A", A1>80, "B")' },
  SWITCH: { name: "SWITCH", category: "Logical", args: [req("expression"), req("case1"), req("value1"), rep("case2"), rep("value2"), opt("default")], signature: "SWITCH(expression, case1, value1, [case2, value2, …], [default])", summary: "Compares an expression against cases and returns the matching value.", example: 'SWITCH(A1, 1, "One", 2, "Two", "Other")' },

  /* ── Date ─────────────────────────────────────────────────────────────── */
  DATE: { name: "DATE", category: "Date", args: [req("year"), req("month"), req("day")], summary: "Builds a date from year, month and day numbers.", example: "DATE(2026, 1, 31)" },
  YEAR: { name: "YEAR", category: "Date", args: [req("date")], summary: "Returns the four-digit year of a date.", example: "YEAR(A1)" },
  MONTH: { name: "MONTH", category: "Date", args: [req("date")], summary: "Returns the month of a date, 1 through 12.", example: "MONTH(A1)" },
  DAY: { name: "DAY", category: "Date", args: [req("date")], summary: "Returns the day of the month of a date, 1 through 31.", example: "DAY(A1)" },
  TODAY: { name: "TODAY", category: "Date", args: [], summary: "Returns the current date.", example: "TODAY()" },
  NOW: { name: "NOW", category: "Date", args: [], summary: "Returns the current date and time.", example: "NOW()" },
  WEEKDAY: { name: "WEEKDAY", category: "Date", args: [req("date"), opt("type")], summary: "Returns the day of the week of a date as a number.", example: "WEEKDAY(A1)" },

  /* ── Statistical ──────────────────────────────────────────────────────── */
  AVERAGE: { name: "AVERAGE", category: "Statistical", args: [req("value1"), rep("value2")], summary: "Returns the mean of the numbers in the values and ranges.", example: "AVERAGE(A1:A10)" },
  COUNT: { name: "COUNT", category: "Statistical", args: [req("value1"), rep("value2")], summary: "Counts how many of the values are numbers.", example: "COUNT(A1:A10)" },
  COUNTA: { name: "COUNTA", category: "Statistical", args: [req("value1"), rep("value2")], summary: "Counts how many of the values are non-empty.", example: "COUNTA(A1:A10)" },
  MEDIAN: { name: "MEDIAN", category: "Statistical", args: [req("value1"), rep("value2")], summary: "Returns the median — the middle value — of the numbers.", example: "MEDIAN(A1:A10)" },
  MODE: { name: "MODE", category: "Statistical", args: [req("value1"), rep("value2")], summary: "Returns the most frequently occurring number.", example: "MODE(A1:A10)" },
  VAR: { name: "VAR", category: "Statistical", args: [req("value1"), rep("value2")], summary: "Returns the sample variance of the numbers.", example: "VAR(A1:A10)" },
  STDEV: { name: "STDEV", category: "Statistical", args: [req("value1"), rep("value2")], summary: "Returns the sample standard deviation of the numbers.", example: "STDEV(A1:A10)" },
  COUNTIF: { name: "COUNTIF", category: "Statistical", args: [req("range"), req("criterion")], summary: "Counts the cells in a range that meet one criterion.", example: 'COUNTIF(A1:A10, ">5")' },
  COUNTIFS: { name: "COUNTIFS", category: "Statistical", args: [req("range1"), req("criterion1"), rep("range2"), rep("criterion2")], signature: "COUNTIFS(range1, criterion1, [range2, criterion2, …])", summary: "Counts cells that meet several criteria across matching ranges.", example: 'COUNTIFS(A1:A10, ">5", B1:B10, "Yes")' },
  SUMIF: { name: "SUMIF", category: "Statistical", args: [req("range"), req("criterion"), opt("sum_range")], summary: "Adds the cells that meet one criterion.", example: 'SUMIF(A1:A10, ">5", B1:B10)' },
  SUMIFS: { name: "SUMIFS", category: "Statistical", args: [req("sum_range"), req("range1"), req("criterion1"), rep("range2"), rep("criterion2")], signature: "SUMIFS(sum_range, range1, criterion1, [range2, criterion2, …])", summary: "Adds cells that meet several criteria across matching ranges.", example: 'SUMIFS(C1:C10, A1:A10, ">5", B1:B10, "Yes")' },
  AVERAGEIF: { name: "AVERAGEIF", category: "Statistical", args: [req("range"), req("criterion"), opt("average_range")], summary: "Averages the cells that meet one criterion.", example: 'AVERAGEIF(A1:A10, ">5", B1:B10)' },
  AVERAGEIFS: { name: "AVERAGEIFS", category: "Statistical", args: [req("average_range"), req("range1"), req("criterion1"), rep("range2"), rep("criterion2")], signature: "AVERAGEIFS(average_range, range1, criterion1, [range2, criterion2, …])", summary: "Averages cells that meet several criteria across matching ranges.", example: 'AVERAGEIFS(C1:C10, A1:A10, ">5")' },

  /* ── Lookup ───────────────────────────────────────────────────────────── */
  MATCH: { name: "MATCH", category: "Lookup", args: [req("search_key"), req("range"), opt("search_type")], summary: "Returns the position of an item within a range.", example: 'MATCH("Apple", A1:A10, 0)' },
  INDEX: { name: "INDEX", category: "Lookup", args: [req("range"), req("row"), opt("column")], summary: "Returns the value at a given row and column of a range.", example: "INDEX(A1:C10, 2, 3)" },
  VLOOKUP: { name: "VLOOKUP", category: "Lookup", args: [req("search_key"), req("range"), req("index"), opt("is_sorted")], summary: "Finds a key in the first column of a range and returns a value from the same row.", example: 'VLOOKUP("Apple", A1:C10, 3, FALSE)' },
  HLOOKUP: { name: "HLOOKUP", category: "Lookup", args: [req("search_key"), req("range"), req("index"), opt("is_sorted")], summary: "Finds a key in the first row of a range and returns a value from the same column.", example: 'HLOOKUP("Q1", A1:F3, 2, FALSE)' },
  XLOOKUP: { name: "XLOOKUP", category: "Lookup", args: [req("search_key"), req("lookup_range"), req("result_range"), opt("if_not_found"), opt("match_mode")], summary: "Searches a range for a key and returns the matching item from a result range.", example: 'XLOOKUP("Apple", A1:A10, B1:B10, "Not found")' },

  /* ── Array ────────────────────────────────────────────────────────────── */
  UNIQUE: { name: "UNIQUE", category: "Array", args: [req("range"), opt("by_column"), opt("exactly_once")], summary: "Returns the rows of a range with duplicates removed.", example: "UNIQUE(A1:A10)" },
  FILTER: { name: "FILTER", category: "Array", args: [req("range"), req("condition"), opt("if_empty")], summary: "Returns only the rows of a range where the condition column is TRUE.", example: "FILTER(A1:B10, C1:C10)" },
  SORT: { name: "SORT", category: "Array", args: [req("range"), opt("sort_index"), opt("is_ascending")], summary: "Sorts the rows of a range by one of its columns.", example: "SORT(A1:B10, 1, TRUE)" },
};

/** The signature line, e.g. `SUM(value1, [value2, …])`. */
export function renderSignature(help: FunctionHelp): string {
  if (help.signature) return help.signature;
  const parts = help.args.map((a) => {
    if (a.repeatable) return a.optional ? `[${a.name}, …]` : `${a.name}, …`;
    return a.optional ? `[${a.name}]` : a.name;
  });
  return `${help.name}(${parts.join(", ")})`;
}

/** Function names, prefix-matched (case-insensitive), exact hit first then
    alphabetical. Returns the help entries so a caller can render them directly. */
export function matchFunctions(prefix: string, limit = 8): FunctionHelp[] {
  const p = prefix.toUpperCase();
  if (p === "") return [];
  const hits = Object.values(FUNCTION_HELP).filter((h) => h.name.startsWith(p));
  hits.sort((a, b) => {
    if (a.name === p) return -1;
    if (b.name === p) return 1;
    return a.name < b.name ? -1 : 1;
  });
  return hits.slice(0, limit);
}
