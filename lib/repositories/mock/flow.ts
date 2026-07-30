import type { FlowChannel } from "@/lib/domain";

/**
 * The six flow channels, and their hues.
 *
 * Hues come from the FIELD palette — ivory, gold, rose, mauve, slate, deep —
 * never from C1–C4. The Four Channels Rule reserves channel colour for score
 * components; this is the second sanctioned use of the field palette outside
 * the background, after avatar monograms, and it is recorded in docs/architecture/DESIGN.md.
 *
 * Each is a THEME TOKEN rather than a literal, because the same hue cannot
 * work on both grounds: the pastels that bloom on near-black vanish on a pale
 * one. `--flow-*` carries the pastel in dark and its deepened twin in light,
 * so the graph keeps one identity across two environments.
 *
 * Arrivals take the cool half of the palette and departures the warm half, so
 * the graph's fan reads directionally before any label is read: cool above the
 * baseline means work coming in, warm below means work going out.
 */
export const FLOW_CHANNELS: FlowChannel[] = [
  {
    id: "created",
    label: "Created",
    direction: "in",
    hue: "var(--flow-created)",
  },
  {
    id: "assigned",
    label: "Assigned to me",
    direction: "in",
    hue: "var(--flow-assigned)",
  },
  {
    id: "rework",
    label: "Returned for rework",
    direction: "in",
    hue: "var(--flow-rework)",
  },
  {
    id: "completed",
    label: "Completed",
    direction: "out",
    hue: "var(--flow-completed)",
  },
  {
    id: "approved",
    label: "Approved",
    direction: "out",
    hue: "var(--flow-approved)",
  },
  {
    id: "cancelled",
    label: "Cancelled",
    direction: "out",
    hue: "var(--flow-cancelled)",
  },
];

export const MONTHS_SHORT = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];
