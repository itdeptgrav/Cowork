/**
 * The function registry.
 *
 * One flat lookup the evaluator reads, assembled from the category modules —
 * math, text, logical, date, statistical, lookup, array. Adding a function means
 * adding it to its category and nowhere else; there is no monolithic evaluator
 * file to grow.
 */

import type { Fn } from "./types";
import { MATH_FUNCTIONS } from "./math";
import { TEXT_FUNCTIONS } from "./text";
import { LOGICAL_FUNCTIONS } from "./logical";
import { DATE_FUNCTIONS } from "./date";
import { STATISTICAL_FUNCTIONS } from "./statistical";
import { LOOKUP_FUNCTIONS } from "./lookup";
import { ARRAY_FUNCTIONS } from "./array";

export const FUNCTIONS: Record<string, Fn> = {
  ...MATH_FUNCTIONS,
  ...TEXT_FUNCTIONS,
  ...LOGICAL_FUNCTIONS,
  ...DATE_FUNCTIONS,
  ...STATISTICAL_FUNCTIONS,
  ...LOOKUP_FUNCTIONS,
  ...ARRAY_FUNCTIONS,
};

export type { Fn } from "./types";
