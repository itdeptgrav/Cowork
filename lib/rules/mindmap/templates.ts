import type { MindNode, MindNodeId } from "../../domain/mindmap.ts";
import { markdownToNodes } from "./textio.ts";

/**
 * Starting maps.
 *
 * Each is a Markdown outline — the same format Import reads — so a template
 * is something a person could have typed, and adding one is adding text, not
 * code. The cards are real prompts in the subject's own vocabulary, not
 * placeholders: a retrospective's branches are the questions a retrospective
 * asks.
 */

export interface MindMapTemplate {
  id: string;
  label: string;
  hint: string;
  outline: string;
}

export const MINDMAP_TEMPLATES: MindMapTemplate[] = [
  {
    id: "blank",
    label: "Blank",
    hint: "One root card, and the rest is yours.",
    outline: "# Untitled mindmap\n",
  },
  {
    id: "project-plan",
    label: "Project plan",
    hint: "Goals, scope, milestones, risks, people.",
    outline: [
      "# Project plan",
      "- Goal",
      "  - What done looks like",
      "  - How we will measure it",
      "- Scope",
      "  - In",
      "  - Out",
      "- Milestones",
      "  - Kick-off",
      "  - First review",
      "  - Launch",
      "- Risks",
      "  - What could slip",
      "  - What we depend on",
      "- People",
      "  - Owner",
      "  - Reviewers",
      "",
    ].join("\n"),
  },
  {
    id: "swot",
    label: "SWOT",
    hint: "Strengths, weaknesses, opportunities, threats.",
    outline: "# SWOT\n- Strengths\n- Weaknesses\n- Opportunities\n- Threats\n",
  },
  {
    id: "meeting-notes",
    label: "Meeting notes",
    hint: "Agenda, decisions, actions, open questions.",
    outline: [
      "# Meeting",
      "- Agenda",
      "- Decisions",
      "- Actions",
      "  - Who · what · by when",
      "- Open questions",
      "- Next meeting",
      "",
    ].join("\n"),
  },
  {
    id: "retro",
    label: "Retrospective",
    hint: "What went well, what did not, what we change.",
    outline: "# Retrospective\n- Went well\n- Did not go well\n- Puzzles us\n- We will change\n",
  },
  {
    id: "weekly",
    label: "Weekly plan",
    hint: "Monday to Friday, with a top priority each.",
    outline: [
      "# This week",
      "- Monday",
      "  - Top priority",
      "- Tuesday",
      "  - Top priority",
      "- Wednesday",
      "  - Top priority",
      "- Thursday",
      "  - Top priority",
      "- Friday",
      "  - Top priority",
      "- Later",
      "",
    ].join("\n"),
  },
  {
    id: "brainstorm",
    label: "Brainstorm",
    hint: "A question in the middle and six angles around it.",
    outline: [
      "# The question",
      "- Who is it for",
      "- What they need",
      "- What exists today",
      "- What is missing",
      "- Wild ideas",
      "- First step",
      "",
    ].join("\n"),
  },
];

/** The template's cards, with fresh ids and the given title on the root. */
export function templateNodes(
  template: MindMapTemplate,
  mintId: () => MindNodeId,
  title?: string,
): MindNode[] {
  const { nodes } = markdownToNodes(template.outline, mintId, template.label);
  if (title && nodes[0]) nodes[0] = { ...nodes[0], title };
  return nodes;
}
