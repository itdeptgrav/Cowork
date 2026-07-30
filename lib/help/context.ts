import type { HelpCategory } from "./types";

/**
 * What the assistant knows about where you are.
 *
 * This lives on the server side of the boundary on purpose. The requirement is
 * that the frontend holds no help logic, and "which category does /admin/roles
 * belong to" is help logic — the moment that mapping lives in a component,
 * adding a help category means editing a component, and the two drift.
 *
 * The frontend sends a pathname. Everything below is derived here.
 */

export interface PageContext {
  /** Narrows the search when the page makes the area unambiguous. */
  category: HelpCategory | null;
  /** The offer shown when the panel opens. Phrased as a question, not a boast. */
  prompt: string;
  /** Quick actions, most useful first. */
  suggestions: string[];
}

/** The default set — used on any page with no more specific answer. */
const GENERAL: PageContext = {
  category: null,
  prompt: "What would you like help with?",
  suggestions: [
    "How do I create a task?",
    "How does scoring work?",
    "Why am I offline?",
    "Who approves my work?",
    "How do roles and permissions work?",
  ],
};

/**
 * Longest prefix wins, so `/admin/roles` beats `/admin`.
 *
 * Order in this list does not matter; specificity does. That is deliberate —
 * a list where correctness depends on ordering is a list somebody will
 * eventually reorder.
 */
const ROUTES: { prefix: string; context: PageContext }[] = [
  {
    prefix: "/tasks/new",
    context: {
      category: "tasks",
      prompt: "Need help creating a task?",
      suggestions: [
        "How do I create a task?",
        "Why can't I choose a department for my task?",
        "Why is the Budget option disabled?",
        "How do I assign work to another department?",
      ],
    },
  },
  {
    prefix: "/tasks",
    context: {
      category: "tasks",
      prompt: "Need help with tasks?",
      suggestions: [
        "How do I create a task?",
        "What does 'confirmed' mean?",
        "How do I submit my work?",
        "Why can't I see my colleague's tasks?",
      ],
    },
  },
  {
    prefix: "/admin/roles",
    context: {
      category: "roles",
      prompt: "Need help understanding roles and permissions?",
      suggestions: [
        "How do permissions work?",
        "How do I create a role?",
        "Why can't I reset that person's password?",
        "Why do I get permission denied?",
      ],
    },
  },
  {
    prefix: "/admin/workflows",
    context: {
      category: "approvals",
      prompt: "Need help configuring approvals?",
      suggestions: [
        "How do I change the approval flow?",
        "Can I add an approval stage?",
        "Why does it say my approval is blocked?",
      ],
    },
  },
  {
    prefix: "/admin/organisation",
    context: {
      category: "settings",
      prompt: "Need help with departments and reporting lines?",
      suggestions: [
        "How do I set a head of department?",
        "How do I change who someone reports to?",
        "Why does my task need two approvals?",
      ],
    },
  },
  {
    prefix: "/admin/scoring-rules",
    context: {
      category: "settings",
      prompt: "Need help with scoring rules?",
      suggestions: [
        "How do I change a deduction?",
        "Can I undo a scoring change?",
        "What does provisional mean?",
      ],
    },
  },
  {
    prefix: "/admin",
    context: {
      category: "settings",
      prompt: "Need help with settings?",
      suggestions: [
        "How do I create a role?",
        "How do I set a head of department?",
        "How do I change the approval flow?",
        "How do I change a deduction?",
      ],
    },
  },
  {
    prefix: "/employee",
    context: {
      category: "status",
      prompt: "Need help with screen sharing requirements?",
      suggestions: [
        "How do I go online?",
        "Why won't it accept my window share?",
        "Why did I go offline?",
        "How do I take a break?",
      ],
    },
  },
  {
    prefix: "/manager",
    context: {
      category: "status",
      prompt: "Need help with monitoring?",
      suggestions: [
        "Why is their screen not showing?",
        "How do I go online?",
        "Why am I offline?",
      ],
    },
  },
  {
    prefix: "/score",
    context: {
      category: "scoring",
      prompt: "Need help understanding your score?",
      suggestions: [
        "How is my score calculated?",
        "How does rework affect my score?",
        "What does provisional mean?",
        "Can my colleagues see my score?",
      ],
    },
  },
  {
    prefix: "/team",
    context: {
      category: "roles",
      prompt: "Need help with your team view?",
      suggestions: [
        "Can I see my team's scores?",
        "What does the Private/Team switch do?",
        "Why can't I see my colleague's tasks?",
      ],
    },
  },
  {
    prefix: "/attendance",
    context: {
      category: "scoring",
      prompt: "Need help with attendance?",
      suggestions: ["How is my score calculated?", "What are C1 to C4?"],
    },
  },
];

export function contextForPath(pathname: string | undefined): PageContext {
  if (!pathname) return GENERAL;
  const match = ROUTES.filter((r) => pathname.startsWith(r.prefix)).sort(
    (a, b) => b.prefix.length - a.prefix.length,
  )[0];
  return match?.context ?? GENERAL;
}
