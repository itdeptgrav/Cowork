/**
 * The help knowledge base — contracts.
 *
 * The rule this system is built to keep: **an answer here must be a fact about
 * Cowork, not a description of what a workspace product usually does.** Every
 * seeded article cites the code, spec or legacy defect it comes from, because a
 * help system that confidently states a plausible-but-wrong rule is worse than
 * one that says nothing — the reader has no way to tell the difference, and a
 * wrong answer about who can approve a task or what makes someone Online sends
 * them to argue with a system that is behaving correctly.
 *
 * `source` is therefore required. It is not shown to end users; it is how a
 * reviewer checks that an answer is still true after the code moves.
 */

import type { Capability } from "@/lib/domain";
import type { HelpTarget } from "./targets";

export type HelpCategory =
  | "tasks"
  | "approvals"
  | "roles"
  | "status"
  | "scoring"
  | "settings"
  | "general";

export const HELP_CATEGORY_LABEL: Record<HelpCategory, string> = {
  tasks: "Tasks",
  approvals: "Approvals",
  roles: "Roles & Permissions",
  status: "Employee Status",
  scoring: "Scoring",
  settings: "Settings",
  general: "General",
};

/**
 * One step of a walkthrough.
 *
 * `message` is an instruction, not an explanation — the business rule lives in
 * the article's `answer` and the two are deliberately kept apart. A step says
 * "choose who the work is for"; the answer says "Budget applies only inside
 * your reporting line". Merging them would put a rule somewhere it cannot be
 * reviewed against the code.
 */
/**
 * What the reader has to do before the step is finished.
 *
 * `none` means there is nothing to detect — the step is pointing something out,
 * and Next is the honest control. Everything else advances on its own, because
 * asking someone to click a control and then also click Next teaches them the
 * tour is theatre.
 */
export type GuideAction =
  /** Nothing to detect. The reader presses Next. */
  | "none"
  /** They click the highlighted element. */
  | "click"
  /** They type something into it. */
  | "input"
  /** They change a select, or press a toggle. */
  | "change"
  /** The step is done when the route changes — a link or a submit. */
  | "navigate"
  /** The step is done when some OTHER element appears. */
  | "appears";

export interface GuideStep {
  /** A key of `HELP_TARGETS`. Never a CSS selector. */
  target: HelpTarget;
  message: string;
  /** The route this step happens on, when it differs from the previous one. */
  page?: string;
  /**
   * How this step completes. Defaults to `none`, so an author who says nothing
   * gets the safe behaviour rather than a tour that advances unexpectedly.
   */
  awaitAction?: GuideAction;
  /** `appears` only: the target that must show up for the step to be done. */
  awaitTarget?: HelpTarget;
}

export interface HelpGuide {
  actionType: string;
  /** Where the walkthrough begins. Offered as "Take me there", never forced. */
  startAt: string;
  /**
   * The capability needed to actually perform this. When the viewer lacks it
   * the walkthrough is not offered — teaching somebody a workflow they will be
   * refused at the end of is worse than explaining why they cannot.
   */
  requires?: Capability;
  steps: GuideStep[];
}

export interface HelpArticle {
  id: string;
  category: HelpCategory;
  title: string;
  /**
   * Short phrases someone would type. Matched as phrases first, then as tokens,
   * so "create task" scores higher on a question containing that exact pair
   * than one merely containing both words somewhere.
   */
  keywords: string[];
  /** Whole questions, in the words a person would actually use. */
  examples: string[];
  /** The answer. Plain prose; no markup, so any surface can render it. */
  answer: string;
  /** Ids of articles worth reading next. Validated at test time. */
  related: string[];
  /**
   * Where this rule lives in the codebase or the specs. Required — an answer
   * nobody can trace is an answer nobody can maintain.
   */
  source: string;
  /** Optional walkthrough. Present only on articles about doing something. */
  guide?: HelpGuide;
}

/** What the search returns. */
export interface HelpMatch {
  article: HelpArticle;
  /** 0–100. See `search.ts` for how the bands are meant to be read. */
  confidence: number;
  /** Which signals fired, so a low score can be explained rather than guessed at. */
  signals: string[];
}

export interface HelpSearchResult {
  found: boolean;
  confidence: number;
  answer: string | null;
  article: HelpArticle | null;
  /** Ranked alternatives, best first, excluding the top match. */
  alternatives: HelpMatch[];
}
