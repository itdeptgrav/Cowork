import type { AssignmentRelation } from "@/lib/auth/assignment";

/**
 * What each assignment relationship means, in one place.
 *
 * The words live here rather than inside the components because they were
 * inside the components: a chain of conditionals in the new-task form, nothing
 * at all on the task detail, and no way to change a sentence without hunting
 * for its duplicates. A reader who sees "within your reporting hierarchy" while
 * creating a task and then something differently worded on the task itself has
 * to work out whether they are being told the same thing.
 *
 * **Nothing here decides anything.** The relationship is resolved by
 * `assignmentRelationship` — the same function `createTask` decides with — and
 * this only names what it returned. Keyed as a `Record<AssignmentRelation, …>`
 * so a relationship added to the resolver fails the build here rather than
 * rendering blank.
 *
 * Two voices, because there are two moments. `forecast` is second person and
 * about to happen — the creator is choosing, and the sentence has to help them
 * decide. `record` is third person and already settled — the task exists, the
 * reader may be the assignee or a bystander, and "you" would be a guess about
 * who is looking.
 */

export interface RelationshipCopy {
  /** The mode as a person would say it: "Budget task", "Deadline task". */
  label: string;
  /** Why this relationship produced that mode. Second person, pre-creation. */
  forecast: string;
  /** The same fact about an existing task. Third person. */
  record: string;
  /** Names the rule that decided it, for a pending task's "what triggered this". */
  rule: string;
}

export const RELATIONSHIP_COPY: Record<AssignmentRelation, RelationshipCopy> = {
  self: {
    label: "Budget task",
    forecast:
      "You are assigning this to yourself, so you set the working window and manage your own execution inside it. Nothing needs approving before you start.",
    record:
      "Self-assigned, so the working window and how it is spent both belong to the assignee.",
    rule: "The creator and the assignee are the same person.",
  },
  in_line: {
    label: "Budget task",
    forecast:
      "This person is within your reporting hierarchy. You set a working window and they manage their execution within it — their own management can re-plan inside that window without moving the deadline.",
    record:
      "The assignee is within the creator's reporting hierarchy, so the task runs on a working window rather than a fixed date. Their own management can re-plan inside it without moving the deadline.",
    rule: "The assignee reports to the creator, directly or further down the line.",
  },
  cross_department: {
    label: "Deadline task",
    forecast:
      "This person is outside your reporting hierarchy and in another department. The deadline is fixed rather than negotiated, and both department heads approve before the work reaches them.",
    record:
      "The assignee is outside the creator's reporting hierarchy and in another department, so the deadline is fixed and both department heads had to approve it.",
    rule: "No reporting line reaches the assignee, and the task crosses a department boundary.",
  },
  outside_line: {
    label: "Deadline task",
    forecast:
      "This person is outside your reporting hierarchy. There is no shared management line to negotiate resourcing along, so the date you set is the deadline.",
    record:
      "The assignee is outside the creator's reporting hierarchy, so the date was set by the assigning side rather than negotiated.",
    rule: "No reporting line reaches the assignee.",
  },
};
