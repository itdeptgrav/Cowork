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
import { MATH_EXTRA_FUNCTIONS } from "./mathExtra";
import { FINANCIAL_FUNCTIONS } from "./financial";
import { INFO_FUNCTIONS } from "./info";
import { TEXT_EXTRA_FUNCTIONS } from "./textExtra";
import { DATE_EXTRA_FUNCTIONS } from "./dateExtra";
import { STATISTICAL_EXTRA_FUNCTIONS } from "./statisticalExtra";
import { LOOKUP_EXTRA_FUNCTIONS } from "./lookupExtra";
import { VISUAL_FUNCTIONS } from "./visual";

export const FUNCTIONS: Record<string, Fn> = {
  ...MATH_FUNCTIONS,
  ...TEXT_FUNCTIONS,
  ...LOGICAL_FUNCTIONS,
  ...DATE_FUNCTIONS,
  ...STATISTICAL_FUNCTIONS,
  ...LOOKUP_FUNCTIONS,
  ...ARRAY_FUNCTIONS,
  ...MATH_EXTRA_FUNCTIONS,
  ...FINANCIAL_FUNCTIONS,
  ...INFO_FUNCTIONS,
  ...TEXT_EXTRA_FUNCTIONS,
  ...DATE_EXTRA_FUNCTIONS,
  ...STATISTICAL_EXTRA_FUNCTIONS,
  ...LOOKUP_EXTRA_FUNCTIONS,
  ...VISUAL_FUNCTIONS,
};

export type { Fn } from "./types";
