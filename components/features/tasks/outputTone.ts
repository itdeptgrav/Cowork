import type { Chip } from "@/components/ui/Primitives";
import type { OutputState } from "@/lib/rules/tasks/outputs";

/**
 * How each output state is labelled and coloured.
 *
 * One table, because the same list of outputs is rendered on two tabs and a
 * state that reads "Rework" in one place and "Returned" in the other is two
 * names for one fact. Both panels had their own copy for exactly as long as it
 * took to write the second one.
 */
export const OUTPUT_TONE: Record<
  OutputState,
  { label: string; tone: Parameters<typeof Chip>[0]["tone"] }
> = {
  not_started: { label: "Not started", tone: "neutral" },
  in_review: { label: "In review", tone: "extension" },
  rework: { label: "Rework", tone: "rework" },
  rejected: { label: "Rejected", tone: "overdue" },
  approved: { label: "Approved", tone: "positive" },
};
