/**
 * Cowork domain types.
 *
 * The four score components are a confirmed product fact (docs/architecture/PRODUCT.md):
 * C1 task execution, C2 goals, C3 policy (deduction only), C4 attendance.
 * Their weights are NOT decided, which is why nothing here models a weight.
 */

export type ChannelId = "c1" | "c2" | "c3" | "c4";

export interface ScoreChannel {
  id: ChannelId;
  /** Existing organisational code. Always shown with `label`, never alone. */
  code: string;
  label: string;
  /** Percentage points. Negative only for c3, which is deduction-only. */
  value: number;
  /** Magnitude used for the bar extent, 0–100, independent of other channels. */
  extent: number;
  /** c3 hangs downward from the top of the band; the rest stand on the baseline. */
  direction: "up" | "down";
  caption: string;
}

export interface PersonScore {
  /** Composite percentage: achievable vs achieved. Floors at 0, caps at 100. */
  composite: number;
  /** Change in percentage points since the previous review point. */
  delta: number;
  channels: ScoreChannel[];
}

export interface Person {
  id: string;
  name: string;
  role: string;
  team: string;
  employment: string;
  /** Two-letter monogram; this build ships no photography. */
  initials: string;
  /** Index into the field palette, so avatars vary without random colour. */
  hue: 0 | 1 | 2 | 3 | 4 | 5;
  stats: { label: string; value: string; unit: string }[];
  score: PersonScore;
}

/**
 * Task state carries C1 signal. Rework and extension requests are recorded
 * events, not edge cases, because C1 measures *how* work completed.
 */
export type TaskState =
  "on-track" | "at-risk" | "rework" | "extension" | "done";

export interface Task {
  id: string;
  title: string;
  project: string;
  assignee: string;
  state: TaskState;
  progress: number;
  loggedHours: number;
  due: string;
  priority: "high" | "normal" | "low";
}

export interface Goal {
  id: string;
  title: string;
  owner: string;
  progress: number;
  target: string;
  window: string;
}

export type Lens = "private" | "team";
