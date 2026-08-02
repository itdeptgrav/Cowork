import { HELP_TARGETS } from "./targets.ts";
import type { HelpArticle } from "./types.ts";

/**
 * The seeded knowledge base.
 *
 * Every answer below was extracted from the implementation, the approved specs
 * or the legacy audit — not written from general knowledge of what task
 * managers do. Where Cowork differs from the obvious answer, the article says
 * so, because those are exactly the questions people ask: "why can't I approve
 * this", "why am I still offline", "why did my score not change".
 *
 * Where a rule is genuinely undecided the article says THAT rather than picking
 * a plausible number. `PROVISIONAL_RULES` exists precisely so unresolved
 * decisions are disclosed, and a help system that resolves them in prose would
 * undo that.
 */
export const HELP_ARTICLES: HelpArticle[] = [
  /* ── Tasks ──────────────────────────────────────────────────────────────── */
  {
    id: "task-create",
    guide: {
      actionType: "create-task",
      startAt: "/tasks",
      requires: "task.create",
      steps: [
        {
          target: HELP_TARGETS.newTaskButton,
          message: "Click New task. The form opens on the next screen.",
          page: "/tasks",
          awaitAction: "navigate",
        },
        {
          target: HELP_TARGETS.taskTitleField,
          message:
            "Give it a title someone else could act on without asking you what it means.",
          page: "/tasks/new",
          awaitAction: "input",
        },
        {
          target: HELP_TARGETS.taskAssigneeField,
          message:
            "Choose who the work is for. Search or filter by department, role, or your own reporting line.",
          awaitAction: "input",
        },
        {
          target: HELP_TARGETS.taskDeadlineMode,
          message:
            "This is chosen for you by who you picked, and the note above says which applies and why.",
          awaitAction: "none",
        },
        {
          target: HELP_TARGETS.taskSubmitButton,
          message:
            "Create it. If it crosses departments, both heads are asked before it reaches anyone.",
        },
      ],
    },
    category: "tasks",
    title: "Creating a task",
    keywords: [
      "create task",
      "new task",
      "assign work",
      "add task",
      "raise task",
    ],
    examples: [
      "How do I create a task?",
      "Where can I assign work?",
      "How do I give someone a job?",
    ],
    answer:
      "Open Tasks and choose New task. A task needs a title and at least one assignee — everything else has a default. You can raise work for anyone in the organisation; who you pick decides what has to happen before it starts rather than whether you are allowed to ask. Picking someone senior to you means the task waits for them to accept it. Picking someone in another department means both department heads agree first. Picking someone in your own reporting line means it starts straight away, on a budget you set.",
    related: [
      "task-owning-department",
      "task-deadline-modes",
      "task-cross-department",
    ],
    source:
      "createTask in lib/repositories/mock/index.ts; task.create capability",
  },
  {
    id: "task-owning-department",
    category: "tasks",
    title: "Which department owns a task",
    keywords: [
      "owning department",
      "task department",
      "change department",
      "which department",
    ],
    examples: [
      "How do I set the owning department?",
      "Why can't I choose a department for my task?",
      "There is no department field on the new task form.",
    ],
    answer:
      "The owning department is taken from your own profile automatically, and the new task form does not ask for it or show it. That is deliberate: the owning department decides whether the work needs two department heads to approve it, so it is not a preference — and a question you can answer wrongly is worse than no question. If work needs to be filed under a department other than yours, an administrator can do that from admin settings.",
    related: ["task-create", "task-cross-department"],
    source:
      "createTask department derivation; people.change_reporting override",
  },
  {
    id: "task-deadline-modes",
    category: "tasks",
    title: "Budget versus deadline-based tasks",
    keywords: [
      "budget",
      "deadline mode",
      "negotiated deadline",
      "deadline based",
      "why can't i choose deadline",
          "propose different time",
      "not enough time",
      "accept time budget",
      "counter proposal",
    ],
    examples: [
      "What is the difference between Budget and Deadline based?",
      "Why can't I pick Budget?",
      "Can I change the deadline type?",
      "Where did the Budget and Deadline options go?",
    ],
    answer:
      "You do not choose this; it follows who you are assigning to, so the form works it out and tells you which applies and why. Until you have picked an assignee it cannot say, because the answer depends on your relationship to that person. Assigning inside your own reporting line gives you a Budget: you set how much working time the job is worth, and how that time is spent and re-planned is settled between the assignee and their own management. A Budget is about the allocation of effort — it is not an invitation to renegotiate the deadline. Assigning outside your reporting line gives you a Deadline: there is no shared management line to settle allocation along, so the assigning side owns the date outright. What decides this is the reporting line and nothing else — a department boundary does not change it. If you manage someone who sits in another department, they are still inside your line and you still get a Budget; if you share a department with someone who does not report to you, you do not. Each relationship allows exactly one of the two, so there is no control to switch between them — changing who the work is for is what changes the model. The new task form tells you which applies before you create it, and the task itself repeats it afterwards, so the assignee can see why their deadline works the way it does without having to ask the person who set it. When a time budget reaches you, you have two answers and neither is a refusal: accept it, which sets the deadline and makes the task yours to start; or propose the time you need instead, which goes back to the person who set it for approval. You cannot decline a task because of the hours — the task stays exactly where it is while your proposal is decided, and the exchange is kept on the task's deadline history. Declining the assignment itself is a separate thing with its own control. One task has neither: a task you have broken down into subtasks has no budget and no deadline of its own, because each subtask carries its own and is negotiated with the person doing it.",
    related: [
      "task-cross-department",
      "task-budget-vs-deadline-rights",
      "task-break-down",
    ],
    source:
      "createTask resolvedMode; insideHierarchy computed from the closure",
  },
  {
    id: "task-budget-vs-deadline-rights",
    guide: {
      actionType: "request-deadline-change",
      startAt: "/tasks?view=tasks",
      requires: "deadline.extend",
      steps: [
        {
          target: HELP_TARGETS.deadlineRequestButton,
          message:
            "Open the task and ask for a deadline change. This goes to whoever set the deadline, not to your own manager.",
          page: "/tasks?view=tasks",
        },
        {
          target: HELP_TARGETS.deadlineReasonField,
          message:
            "Explain why. They decide, so the reason is the whole of your case.",
        },
      ],
    },
    category: "tasks",
    title: "Who can change a budget or a deadline",
    keywords: [
      "change deadline",
      "extend deadline",
      "adjust budget",
      "move deadline",
      "deadline permission",
    ],
    examples: [
      "Can my manager change my deadline?",
      "How do I ask for more time?",
      "Why was my budget change rejected?",
    ],
    answer:
      "The assignee's own manager can re-plan how the work is resourced — but only inside the amount of time the assigning side allowed. That is the whole of what a budget change is. Asking for more time than was allowed is not a budget change, it is a deadline change, and it goes back to the person who set the deadline for them to accept or refuse. The assigning side keeps the deadline decision throughout; the receiving side can ask, never decide. If the request is granted, the larger allowance becomes the new limit for later re-planning.",
    related: ["task-deadline-modes", "scoring-c1"],
    source:
      "adjustBudget and requestDeadlineChange; originalWindowSecs ceiling",
  },
  {
    id: "task-lifecycle",
    category: "tasks",
    title: "What the task statuses mean",
    keywords: [
      "task status",
      "lifecycle",
      "in review",
      "confirmed",
      "assignment rejected",
      "draft",
    ],
    examples: [
      "What does 'confirmed' mean?",
      "What are the task statuses?",
      "Why is my task in review?",
      "How do I accept a task assigned to me?",
      "Can I decline a task?",
    ],
    answer:
      "A task moves through draft, pending approval, assigned, confirmed, in progress, in review, and then completed or cancelled. Confirmed means the assignee has accepted it — work is not simply pushed onto someone. In progress means they have started. Two further states exist: deadline negotiation, while a proposed date is being settled, and assignment rejected, which is what a task becomes when somebody in the cross-department approval chain refuses to let it through — it is not an assignee turning work down. While a task is assigned and you are the person it is assigned to, the overview shows an assignment card with who assigned it, where it sits in your queue, when it is expected to finish and how many hours it carries, and an Accept task button. Only you can press it: accepting on somebody else's behalf would record their agreement to a deadline they never saw, so a manager or the person who created the task sees who it is waiting for and nothing to press. You do not have to have agreed a deadline first — a task carrying a time budget can be accepted straight away. There is no way to hand a task back entirely. What you can do, where the assignor proposed a working time, is send that time back with a reason using Ask for different terms, which opens the negotiation and leaves the task with you. How a cancelled task affects a score has not been decided yet, so any figure shown for one is marked provisional. A status on its own does not say whose turn it is, so every task overview carries a Task flow section that names the person the task is waiting for, why it is waiting, and what happens after that — and where that person is you, it says so and points at the action rather than reporting that you have not acted.",
    related: [
      "task-submit",
      "approvals-what-happens",
      "scoring-c1",
      "task-cross-department",
    ],
    source:
      "TaskStatus in lib/domain/tasks.ts; projectScores cancellation handling",
  },
  {
    id: "task-submit",
    guide: {
      actionType: "submit-completion",
      startAt: "/tasks?view=tasks",
      requires: "submission.create",
      steps: [
        {
          target: HELP_TARGETS.taskScopeSwitch,
          message: "Mine lists the work assigned to you.",
          page: "/tasks?view=tasks",
        },
        {
          target: HELP_TARGETS.submitWorkButton,
          message: "Open the task and submit it when it is ready for review.",
        },
        {
          target: HELP_TARGETS.submissionMessageField,
          message:
            "Say what you did. Your reviewer sees this first, and a good note is the difference between an approval and a question.",
        },
      ],
    },
    category: "tasks",
    title: "Submitting work for review",
    keywords: [
      "submit task",
      "send for review",
      "finish task",
      "mark complete",
    ],
    examples: [
      "How do I submit my work?",
      "How do I mark a task done?",
      "What happens after I submit?",
    ],
    answer:
      "Submitting moves the task to in review and starts the approval chain configured for your organisation. You cannot approve your own submission — that is blocked outright, and it is the single most serious defect carried over from the previous system, where any signed-in employee could approve any task including their own.",
    related: [
      "approvals-what-happens",
      "approvals-who-approves",
      "task-rework",
    ],
    source:
      "submitCompletion, reviewSubmission self-approval guard (spec defect P1)",
  },
  {
    id: "task-rework",
    guide: {
      actionType: "reject-task",
      startAt: "/tasks?view=approvals",
      requires: "review.rework",
      steps: [
        {
          target: HELP_TARGETS.reviewQueueList,
          message: "Open the submission you are deciding on.",
          page: "/tasks?view=approvals",
        },
        {
          target: HELP_TARGETS.reviewReasonField,
          message:
            "Give the reason first. It is required for a rejection and it is what the person acts on.",
        },
        {
          target: HELP_TARGETS.rejectButton,
          message:
            "Reject if the submission is not acceptable. Choose rework instead if it needs another pass.",
        },
      ],
    },
    category: "tasks",
    title: "Rework and rejection",
    keywords: [
      "rework",
      "rejected",
      "sent back",
      "redo task",
      "resubmit",
      "changes requested",
      "correction notes",
      "what needs fixing",
      "rework history",
    ],
    examples: [
      "What is the difference between rework and rejection?",
      "My task came back — what now?",
      "What exactly do I need to fix?",
      "Why can't I send this back for rework?",
      "Where can I see previous rework requests?",
    ],
    answer:
      "Rework sends the task back to be redone and it returns to in progress; you resubmit when it is ready. Rejection is a decision that the submission is not acceptable. Both are recorded events rather than status changes alone, because the score reads how work was completed, not only whether it was. A reviewer must give a reason to reject. Sending work back also requires naming what is wrong with it: the reviewer ticks the completion requirements that were not met, and cannot send it back without ticking at least one — the message is \u201CSelect at least one completion requirement that needs correction.\u201D They can add optional correction notes and reference files alongside. You then see a \u201CChanges requested\u201D panel on the task listing exactly those requirements and nothing else, with the note and any files beneath it. Every round is kept: once you resubmit, the panel stops warning you but the history of what was asked for stays on the task, so a second or third round never erases the first. A task with no completion requirements at all can still be sent back, because there is nothing to tick.",
    related: ["scoring-c1", "task-submit"],
    source:
      "ReworkRequest and Rejection records; reviewSubmission reason validation",
  },
  {
    id: "task-cross-department",
    category: "tasks",
    title: "Cross-department tasks",
    keywords: [
      "cross department",
      "other department",
      "another team",
      "outside my team",
      "two approvals",
      "task flow",
      "current stage",
      "whose turn",
      "waiting for approval",
      "starts after approval",
      "approve button",
      "no approve button",
      "refuse assignment",
      "reject cross department",
      "time budget",
      "set hours",
      "estimated hours",
      "task stuck after approval",
    ],
    examples: [
      "How do I assign work to another department?",
      "Why does my task need two approvals?",
      "Why is my cross-department task not active?",
      "Who is my task waiting on?",
      "How far through approval is my task?",
    ],
    answer:
      "Sending work to another department needs both department heads to agree, unless you already manage the person — a reporting line that crosses a boundary makes the boundary irrelevant, and your own authority over them is the agreement. Yours goes first — your own department confirms it is willing to make the request — and only once that clears does it reach the receiving head, who decides whether their department takes it on. The person the work is for sees nothing to act on until both have agreed. Neither the receiving head nor the assignee can change what was asked for or when it is due: the sending side owns those, and the receiving side's decision is to accept the work or refuse it. If either department has no head recorded, the task cannot be created at all and you are told which one is missing — the approval is never quietly skipped. Open the task and read the Task flow section on the overview. It opens by naming who the task is waiting for and why, then draws the whole journey in order: who created it, each approver with the side they act for — sending department first, then receiving — and the assignee at the end, marked “Starts after approval”. The step being asked for right now is the one marked “Current action required”; a step further down reading “Waiting for the previous approval” is not yet anybody's to act on. Where the task records no approvers, it says “Waiting for department approval” rather than naming somebody it is not sure about. If the decision is yours, an approval card sits at the top of the task with Approve and Refuse: it names which side you are approving for and what happens next — whether the task goes on to the receiving department or is assigned straight away. Refusing asks for a reason, which the person who raised the task sees; approving does not, because the engine records no reason for agreement. There is no “send back” — the decision is approve or refuse. One person can be recorded as the approver for both departments, in which case the task returns to them for a second decision after the first, and the card says so. Both approvals clearing is not always the last step: where the task carries no timer, it moves to a budget stage instead of being assigned, and the receiving department has to say how many hours the work is worth before it is handed over. The person it is for stays out of it until then — they cannot see it in their list, start it or submit it — and the task reads “Set the time budget” rather than “Approve or reject”, because that step asks for a number and not a yes or no. The budget stage is not only for work that crossed departments — a task can be created straight into it — and in both cases the same person sets it: whoever manages the employee the work is for. That is a different question from department approval, which asks whether work may cross between departments at all; this one asks how many hours one person gets for one piece of work, so it follows the reporting line and not the department. A department head who does not manage the assignee cannot set it, and a manager in a different department can. Nobody else can either, including the person the task is for, and the refusal names who can. If it is not yours to set, the step names the manager it is waiting for so you know who to ask. Where the assignee has no manager recorded, the task says so rather than naming somebody, because there is then nobody the system will accept a budget from and it cannot move until one is recorded.",
    related: [
      "approvals-who-approves",
      "task-deadline-modes",
      "settings-departments",
    ],
    source:
      "createTask cross-department gate; cross_department workflow; blocked stages",
  },
  {
    id: "task-who-can-assign",
    category: "tasks",
    title: "Who can create work and who can give it to others",
    keywords: [
      "who can assign",
      "who can create tasks",
      "assign to someone",
      "give work to",
      "can i assign",
    ],
    examples: [
      "Who can assign tasks?",
      "Can I give work to someone in another team?",
      "Why can't I assign this to that person?",
      "Can I assign a task to my manager?",
      "Why is my task waiting for approval?",
    ],
    answer:
      "Anyone can raise work for anyone. Cowork does not stop you asking — it decides who has to agree before the work actually starts. Assigning to someone in your own reporting line starts immediately. Assigning to someone senior to you creates the task and holds it until that person accepts it, so nobody can quietly put work on their manager's list. Assigning across a department holds it until both department heads agree. In every case the task is created and you can see it waiting, with the name of whoever it is waiting on. If an administrator has narrowed your role so that it reaches fewer people, the assignee list shows only who you can reach and says so above the list.",
    related: ["task-create", "task-cross-department", "roles-scopes"],
    source:
      "lib/auth/assignment.ts — upward and cross-department gates; legacy taskForward.js:135 restricted assignment to nobody",
  },
  {
    id: "task-break-down",
    category: "tasks",
    title: "Giving part of a task to someone else",
    keywords: [
      "forward",
      "forward a task",
      "hand off",
      "pass it on",
      "delegate",
      "subtask",
      "break down",
      "split a task",
      "folder",
      "folders",
      "where is my subtask",
      "subtask disappeared",
      "subtask not showing",
      "cannot find subtask",
      "created a subtask and nothing happened",
      "subtasks list",
      "no subtask button",
      "cannot break down a task",
      "add completion requirements",
      "completion requirements",
      "requirements not saving",
      "subtask has no time",
      "subtask budget",
      "subtask deadline",
      "parent task timer disappeared",
      "no deadline tab",
      "cannot start parent task",
      "subtask not under parent in list",
      "task tree",
      "expand task",
      "parent task has no priority",
      "folder task",
      "no submission tab",
      "no review tab",
      "cannot submit parent task",
      "subtask form fields",
      "priority gap",
      "missing priority number",
      "P2 missing",
      "subtask priority not working",
      "project has accept button",
      "project shows timer",
      "project has time budget",
      "why does my project show a deadline",
      "provisional priority",
    ],
    examples: [
      "How do I forward a task?",
      "Where has the Forward button gone?",
      "How do I split a task between two people?",
      "Can I put tasks in a folder?",
      "Who is responsible once I delegate part of my task?",
      "I created a subtask and cannot find it anywhere",
      "Where do subtasks show up?",
      "There is no button to break my task down",
      "How do I add completion requirements?",
      "My task lost its timer after I added a subtask",
      "Why is there no Deadline tab on this task?",
      "How much time does a subtask get?",
      "Why does my parent task show no priority?",
      "How do I collapse subtasks in the list?",
      "Why can't I submit this task any more?",
      "Does a subtask take the same fields as a task?",
      "My subtasks are numbered P1, P3, P5 — where did P2 and P4 go?",
      "Why does the project I broke this task into show an Accept button?",
      "Why does my project show a time budget and a timer?",
    ],
    answer:
      "There is no Forward button and no folders. Both were removed. To give part of a task to somebody else, open the task and use Break out a subtask. The difference matters: forwarding handed over a slice of your time budget and left nothing saying what the work was for, whereas a subtask has to claim at least one of the parent task's completion requirements — the dialog will not let you create one otherwise, and the message is “Choose at least one completion requirement this subtask will satisfy.” So a task needs completion requirements before it can be broken down, and a task with none shows no breakdown button at all: the Completion requirements panel instead offers Add completion requirements, where you type them one per line. You can also set them when you create the task, where the new-task form calls the same field Acceptance criteria — it is one list under two names, and either route fills it. Adding only ever appends — existing requirements are never replaced or reordered, because the subtasks already claiming them point at their positions. Who may add them is the same rule as editing a task's title or description: before the task has been confirmed or started, its creator or any lead; once it has started, only the person who assigned it, and anyone else is told “This task has already started — only the sender who assigned it can edit it now.” Once created, a subtask appears in three places: a Subtasks section on the parent task, headed with how many have been broken out; under the requirement it claims, which now reads “Delegated” with the subtask named beneath it; and in the task list, indented directly beneath its parent. The list is a tree — a task that has been broken down carries a folder mark and a chevron you can click to fold its subtasks away, and its row shows “—” where a priority would be, because a priority is a position in one person's queue and nobody is queued to do a container. The subtasks underneath carry the real priorities, each in its own assignee's queue, and each row is marked “Subtask”. Tab counts and dashboard totals are unaffected by any of this: they count tasks, not rows, so breaking one task into three does not turn one into four. A subtask runs the full task lifecycle of its own — budget, priority, submission and review all apply — so it is created on the ordinary new-task form, not a cut-down dialog: Break out a subtask opens the same screen as New task, with the same fields, and asks for one thing more, which is which of the parent's completion requirements this subtask satisfies. It takes a title, a brief, its own acceptance criteria, attachments, an assignee and its own time — a working-time budget or a fixed date, decided the same way as on any task, by who you are assigning to. The type picker is not shown, because a subtask is a standard task; assigning it to yourself is what makes it a self subtask, and then your manager approves and reviews it exactly as with a self-assigned task. You stay responsible for the parent task. Once a task has been broken down it stops being work in its own right and becomes a project: its Time panel disappears, and so do its Deadline, Submission and Review tabs, because nobody works a project — there is nothing to start, nothing to hand in and so nothing to decide on. All three live on the subtasks, each negotiated and decided with the person carrying that piece. Opening one of those pages on a project says “This task has been broken down” and points you at them. What the project keeps is its title, its brief and its completion requirements, and it closes when every one of them is satisfied. Nothing about it is actionable any more, either: its Overview tab shows one card explaining it is a project rather than the Accept button, the budget proposal or the “waiting for you to accept” line it carried the moment before it was broken down — that state belonged to it as an ordinary task, and nothing rewrites the document when a subtask makes it a container, so a screen that read it blindly kept offering to accept, propose a time, or start a timer on a task nobody is meant to touch again. Its row in the task list matches: no deadline, no time-budget figure, no timer control, and its next-action column says “Project — see its subtasks” instead of naming an action. Two subtasks under the same project can each still be numbered normally — a project never consumes a priority number of its own, so three real subtasks read P1, P2, P3, not P1, P3, P5 with a project sitting in the gap. That applies before acceptance too: a subtask awaiting acceptance is numbered among the other work also awaiting acceptance, its own count starting at 1 and separate from the live queue's — it takes its place in the live queue the moment it is accepted. The person doing the subtask sees which requirement they are answerable for, and that requirement is satisfied when their subtask completes — you cannot tick it off yourself once it is delegated. Your task cannot complete until every requirement is satisfied. Subtasks go one level deep: a subtask cannot itself be broken down. For grouping work without any of this, use a project.",
    related: [
      "task-create",
      "task-deadline-modes",
      "task-lifecycle",
      "task-who-can-assign",
      "task-projects",
    ],
    source:
      "lib/rules/tasks/completion.ts — subtaskRefusal() and completionState(); createSubtask and addRequirements in lib/repositories/mock/index.ts and lib/repositories/legacy/index.ts; ProjectPanel.tsx renders the Subtasks section and the Add completion requirements form; NewTaskForm.tsx with presetParentTaskId is the subtask form, reached at /tasks/new?parent=; isProjectContainer() in lib/rules/tasks/completion.ts is what removes the project's Time panel and its Deadline, Submission and Review tabs in TaskDetail.tsx; buildTaskTree() in lib/rules/tasks/tree.ts nests the list rows and TaskQuery.includeSubtasks is what keeps counts off the tree. isContainer in lib/rules/tasks/priorityQueue.ts excludes a project from isActiveWorkload; provisionalQueuePositions() in lib/rules/tasks/activeQueue.ts numbers not-yet-accepted work in its own gap-free sequence, threaded through TaskAssignment.provisionalPosition and getPersonPriority's provisional_position scale in lib/rules/tasks/priority.ts. Every negotiation card in TaskDetail.tsx's overview tab and the deadline/time-budget/timer cells in TaskTable.tsx's Row are gated on isContainer, tested against the source in lib/rules/tasks/projectContainerAffordances.test.ts and lib/rules/tasks/containerQueue.test.ts. The edit gate is the engine's own, taskForward.js:1660-1676. Forwarding and folders removed 2026-07-27; addRequirements connected to the engine, subtask time budget wired, the broken-down parent made a project and the cut-down subtask dialog replaced by the full task form 2026-08-02; the priority gap a project's leftover stored rank left in its siblings' numbering closed, and every remaining action card and table cell that still offered to negotiate or start a project removed, 2026-08-02",
  },
  {
    id: "task-projects",
    category: "tasks",
    title: "Projects, and what they read from your tasks",
    keywords: [
      "project",
      "new project",
      "create a project",
      "project members",
      "project owner",
      "project start date",
      "project target date",
      "connect tasks",
      "group tasks",
      "projects tab empty",
      "my project is not showing",
      "no new project button",
      "project progress",
      "project health",
      "project shows every task",
      "project page shows all tasks",
      "project task list wrong",
      "unrelated tasks in project",
    ],
    examples: [
      "How do I create a project?",
      "Why can't I choose who is in a project?",
      "Where did the project owner dropdown go?",
      "Why is the project's target date filled in already?",
      "What is the difference between a project and breaking a task down?",
      "The Projects tab is empty but I broke a task down",
      "Where did the New project button go?",
      "Why does a project's page show tasks that have nothing to do with it?",
    ],
    answer:
      "A project is a task that has been broken down, and there is no separate thing to create — no New project form and no button that makes one. You make one by making a task: give it its completion requirements, then break out a subtask for one of them. That task stops being work in its own right and becomes the container for it, and from that moment it appears in the Projects tab. Delete the last subtask and it goes back to being an ordinary task. Almost everything a project reports is read from its subtasks rather than typed in: its name and description are the task's own title and brief, you own it because you raised it, the members are whoever carries the subtasks, the start date is when the task was created, the target date is the latest deadline anybody underneath is actually held to, and progress and health are counted from how many subtasks are done, overdue or blocked. None of those can be typed over, because a value set by hand would disagree with the subtasks that produced it. Cancelled subtasks are left out of the count — work called off should not count against you. Milestones and project tags are not stored anywhere, so they are empty rather than guessed. A project's status follows its task's: it is Active while the task is open, Completed when the task completes, and Archived if it was cancelled — there is no second status to keep in step. Opening a project's own page shows its subtasks and nothing beyond them — not the container's own row (you are already on that task's page, so it is not repeated as a row inside its own list), and not other people's unrelated work. Projects carry no score — the tasks inside them are the scoring units.",
    related: ["task-break-down", "task-create", "scoring-components"],
    source:
      "LegacyRepository.listProjects and #projectFromContainer in lib/repositories/legacy/index.ts derive a ProjectView from every root task that has subtasks; progress is computeProgress in lib/repositories/mock/progress.ts, shared with the mock. listTasks's q.projectId filter, added alongside this, is what makes a project's own page (TaskTable / TaskBoard, both already sending projectId) show only that project's subtasks — filtered on parentTaskId to agree with taskLinks, not on a stored projectId the engine never writes. Locked by lib/repositories/legacy/derivedProjects.test.ts. Derived projects replaced the empty-page stub and the dead New project button 2026-08-02; the project page's task list filter added the same day, having never been implemented at all",
  },
  {
    id: "task-priority",
    category: "tasks",
    title: "Who sets the order of your work",
    keywords: [
      "priority",
      "change priority",
      "reorder",
      "P1",
      "rank",
      "drag",
      "reprioritise",
      "move task up",
      "was P1",
      "priority after completing",
      "queue",
      "priority skipped a number",
      "no priority shown",
      "priority missing",
      "priority shows a dash",
      "expected completion",
      "operational due date",
      "due date wrong",
      "priority gap",
      "no P2",
      "project takes a priority number",
      "provisional position",
    ],
    examples: [
      "How do I change my task priority?",
      "Why can't I change my own priority?",
      "Can my manager reorder my tasks?",
      "What is P1?",
      "Why did my deadlines move?",
      "Why does my task say \u201CWas P1\u201D?",
      "I finished my P1 — why is my next task still P2?",
      "Why is there no P1 in my list?",
      "Why does my task show no priority at all?",
      "Why is the due date earlier than when I can actually start?",
      "Which date am I scored against?",
      "My subtasks read P1, P3, P5 — where did P2 and P4 go?",
      "Why does a project take up a priority number?",
    ],
    answer:
      "Priority is the order you work through your tasks, and it is set by whoever manages you — not by you. P1 is highest, and the range is 1 to 10. If you try to change your own, the answer is “You cannot change your own priority. The order of your work is set by your manager.” The one exception is somebody with nobody above them: if you have no manager, there is nobody to set your order, so you keep it. A manager changes it from the task itself, choosing whose queue they are reordering, and a reason is required every time — it is recorded on the task and shown to the person affected. You can drag the task within the order preview instead of typing a number; both do the same thing. Whenever somebody else changes your priority a blocking confirmation appears wherever you are in the app, naming what moved, who moved it and why. It shows your whole queue in its new order — every task, its new position, the position it held before where that changed, and the date each one is now expected to finish — so you can see the shape of your week rather than only the rows that shifted. Confirming is the only action: there is no Cancel and no close cross, because the change has already been made and there is nothing to decline. It is a receipt, not an approval. If raising one task pushed the deadlines of others, the confirmation also lists each of those separately; time you have already logged is credited and no deadline ever moves earlier. No email or notification is sent — the confirmation waits for you in the app instead. The numbers describe the tasks you can still act on: finishing your P1 moves the rest up, so the old P2 becomes P1 and the old P3 becomes P2, with no gap left behind. Nothing is reshuffled when that happens — only the gap closes, and the order your manager set is kept exactly. A task that is completed, cancelled or refused leaves the queue and stops carrying a live number; it reads “Was P1” instead, so a finished task is never mistaken for the thing to do next. Submitted work still holds its place, because rework can send it back to you. Each person has their own queue, so somebody else finishing their P1 never changes yours. If you manage people, their tasks stay in your team view at every stage — while a cross-department approval is still being decided, after you have approved it, while they are working, and through review. Approving something does not hand it away: what you have to act on and whose work you oversee are different questions, and only the reporting line answers the second. A new task joins the bottom of your queue and moves nothing above it, and when a task is given to several people each of them gets their own position in their own list. A task only takes a place in the queue once its time budget is agreed: while you and the person who set it are still settling the hours, it is real work with a real priority but it does not hold a slot in that queue or push anything else down. It has its own, separate count instead — a task or subtask awaiting acceptance is numbered 1, 2, 3 among everything else of yours also awaiting acceptance, gap-free the same way the accepted queue is, just counted apart from it so accepted work you have committed to is never pushed down a place by something that might not be accepted at all. So a fresh subtask never shows a raw, ungapped number and never sits blank either — and a task that has been broken down into subtasks is excluded from both counts entirely, the same as a completed one: a project holds no priority of its own, so it never occupies a number that a sibling subtask would otherwise have held. It takes its rightful place in the real queue the moment one of you accepts — so a task you have been arguing about can appear above tasks you were already working on, because its priority always ordered it there. Tasks with a fixed deadline have no budget to agree and count from the moment they are assigned. A task waiting at a cross-department approval gate still shows you its priority: it is already in your queue and counted in it, even though the handover has not happened yet. Two dates are kept for every task and they answer different questions. The requested deadline is the commitment, and it is what your score is measured against. Expected completion is when the work will really be finished: everything ahead of it in your queue, then its own agreed hours, walked through office hours, holidays, your leave and breaks. For anybody with a queue the two differ by the total of the work in front — a four-hour task given to you at 9:30 AM is not finished at 1:30 PM if you already have three hours committed, it is finished at 4:30 PM. Only the expected completion moves when your priorities are reordered; the commitment does not, which is why raising one task can make another late without changing what it was promised for.",
    related: [
      "task-deadline-modes",
      "task-budget-vs-deadline-rights",
      "roles-scopes",
      "people-unplaced",
    ],
    source:
      "lib/auth/priority.ts — selfReorderRefusal; changePriority + #applyOrder in lib/repositories/mock/index.ts; PriorityAckGate; cowork_tasks.deadlineAutoExtendedHistory[] (taskForward.service.js). lib/rules/tasks/activeQueue.ts's activeQueuePositions() is the accepted queue; provisionalQueuePositions() is the separate gap-free count for work awaiting acceptance, over lib/rules/tasks/priorityQueue.ts's calculateProvisionalOrder() — both exclude a container via QueueEntry.isContainer / QueueCandidate.isContainer, set from the task's own subtaskIds in LegacyRepository's #activeQueueOf and listTasks (lib/repositories/legacy/index.ts). lib/rules/tasks/priority.ts's getPersonPriority()/displayPriority() read the provisional position as the \"provisional_position\" scale, one tier below a live queue position and one above the raw stored rank. Locked by lib/rules/tasks/containerQueue.test.ts, which reproduces the reported P1/P3/P5 gap directly. Before this, TaskTable.tsx showed the raw stored rank for any task awaiting acceptance (fixed 2026-08-02, priorityAffordance.pending.test.ts) with no gap-free derivation at all — which is where a broken-down task's leftover rank first became visible as a missing sibling number; fixed 2026-08-02",
  },
  {
    id: "task-workload-planning",
    category: "tasks",
    title: "Planning the hours before you assign them",
    keywords: [
      "workload",
      "workload planning",
      "deadline feasibility",
      "feasibility preview",
      "expected due",
      "expected completion",
      "queue preview",
      "try a position",
      "drag",
      "drag and drop",
      "reorder the preview",
      "apply this priority",
      "added here",
      "simulate priority",
      "how many hours should I give",
      "will this meet the deadline",
      "delayed by",
      "no change",
      "buffer remaining",
      "time budget preview",
      "time budget shows zero",
      "00:00:00 of 00:00:00",
      "budget not showing",
      "elapsed of allocated",
      "working late",
      "work outside office hours",
      "timer at night",
      "early morning work",
      "remaining budget",
      "time left on task",
      "extension",
      "extension request",
      "request more time",
      "extra time",
      "extension shows zero",
      "new total window",
      "who approves extra time",
      "escalate deadline",
      "manager approves hours",
      "assignor approves deadline",
      "need more time",
      "time budget extension",
      "previous extension request",
      "budget request status",
      "extension history",
      "extension timeline",
      "who is waiting",
      "declined extra time",
      "counter proposal",
      "propose another date",
      "historical deadline decision",
      "waiting for me",
      "accept new deadline",
      "discuss deadline",
      "manager is also the assignor",
      "same expected completion time",
      "two tasks same deadline",
      "subtasks show identical completion",
      "pending tasks do not chain",
      "expected completion not accounting for other tasks",
    ],
    examples: [
      "How do I know how many hours to give this task?",
      "Will this task meet the requested deadline?",
      "What happens to my team member\u2019s other work if I take this?",
      "Why does the preview say a task is delayed by more hours than I added?",
      "Can I try a priority without saving it?",
      "How do I drag a task to a different priority in the preview?",
      "I dragged a task but the order did not change \u2014 why?",
      "Why do I have to give a reason to apply an order?",
      "Where does the expected completion date come from?",
      "Why is the preview showing somebody else\u2019s tasks?",
      "What does the Time budget field on a task mean?",
      "Why does my task show hours before anybody agreed to them?",
      "Can I start my timer outside office hours?",
      "I worked at 5 AM \u2014 does that count?",
      "Why did my expected completion move after I logged time?",
      "How do I ask for more time on a task?",
      "My extension request showed 00:00:00 \u2014 why?",
      "What happens to my other tasks if an extension is approved?",
      "Who do I ask for more time?",
      "Why can\u2019t I ask the assignor for a new deadline directly?",
      "My manager approved extra hours but the deadline did not change \u2014 why?",
      "Where can I see what happened to my extension request?",
      "Why can\u2019t the assignor see how many hours I asked for?",
      "What happens if the assignor wants a different date?",
      "The task says it is waiting for me but I have no button \u2014 what do I do?",
      "My manager gave me this task \u2014 who approves my extension?",
      "Two of my pending subtasks show the exact same expected completion time \u2014 why?",
      "Why doesn't my second task's deadline account for the first one?",
    ],
    answer:
      "The Time budget on a task reads as two figures: the time logged against it so far, then the hours it has been given \u2014 \u201C00:30:00 of 02:00:00\u201D. The second figure is whatever has been settled between the two sides; until it is settled it shows the hours the assignor put forward, because that is the number being discussed. A task with no budget at all shows 00:00:00, which is not a fault: a fixed-deadline task has no hours to agree. It is the same figure the deadline calculation plans with, so the panel and the expected completion can never describe different amounts of work. You can start your timer at any hour, and everything you log counts in full \u2014 nothing is trimmed for being outside office hours, and no rule stops the timer running at night or at a weekend. What office hours decide is only when the REMAINING work can be scheduled. So if you work five minutes at 4:53 AM on a two-hour task, those five minutes are yours and the remaining hour and fifty-five minutes is laid out from the next time the office opens: 9:30 AM, finishing 11:25 AM. Expected completion moves earlier every time you log time, because only what is left is ever scheduled. Logging more hours than you were given does not push anything out \u2014 the remainder simply reaches zero and stops there. Asking for more time starts with your manager, not with whoever gave you the work, and it starts as HOURS rather than as a date. The two are kept as separate records with separate statuses, so your hours can be granted while a date is still being discussed \u2014 which is the ordinary case, not an edge one. Those are two different decisions with two different owners: how many hours you get is a decision about your week, and your primary manager owns it; when the work is due is a commitment the assignor made, possibly onward to somebody else, and only they can move it. If you try to take a date straight to the assignor the answer is \u201CAsk your manager for the time you need. They will check whether it fits the deadline, and take it to the assignor only if it does not.\u201D Your manager sees your whole queue, adds the hours you asked for, and the system works out when you would actually finish. Most of the time the extra hours fit inside the deadline that was already promised \u2014 then they simply approve the hours, nothing else moves, and the assignor is never troubled. Only when the work genuinely cannot land in time does it become a deadline question, and then it is your manager who asks, carrying the earliest date your queue can really deliver rather than a date anybody guessed. The assignor can accept that date or offer a different one; either way the hours you were granted do not change, because a date and a budget are separate fields and never move together. When you ask for an extension you are asked for the EXTRA time you need, not a new total, and the form shows you the sum as you choose it: current window, plus what you are adding, equals the new total. Whoever decides sees the same three figures. This matters because the two are easy to confuse: asking for \u201C2 hours\u201D on a task that already has a two-hour window adds nothing at all, and the history would record exactly that. Approving an extension does not only move that one task. Your whole queue is worked out again from the new budget, so every task sitting behind it moves too \u2014 and not by the same amount: a task pushed past the end of the working day lands the next morning, so two hours added at the top can move a later task by seventeen. Rejecting changes nothing. Both conversations appear on one Extension history, in the order things happened, each labelled with which one it is: a Time budget row shows hours and never a date, a Deadline row shows dates and never hours. Rows say who acted and, while something is still open, who it is waiting on. What you see depends on which conversation you are in: you and everyone managing you see the hours, and the assignor sees only the deadline rows \u2014 not because the hours are secret, but because they are not the assignor\u2019s decision, and a deadline shown next to \u201C+2 hours\u201D invites adding the two, which is always wrong. Where the person who gave you the work is also the person who sets your hours \u2014 an ordinary task from your own manager \u2014 there is nobody to escalate to, so they answer once and the task goes straight back to normal work. You are never left waiting for a step that has no owner. When a different date does come back to you, you get a card showing what was asked for beside what was proposed, and two ways forward: accept it, which sets the deadline and ends the matter, or discuss it, which posts to the task chat and leaves the request open. Nothing changes until you choose. The assignor has three answers, not two: approve the date, decline it, or propose a different one. Proposing a different date is not a refusal \u2014 it goes back to the manager who asked and the conversation continues, with both dates kept on the record so you can see what was asked for and what came back. Only an approval moves the deadline; a counter-offer and a refusal change nothing until somebody accepts. Your manager can decline as well as approve. Declining records the refusal and changes nothing at all \u2014 not the budget, not the deadline, not your queue. Extensions from before this was recorded show as \u201CPrevious extension request\u201D: the amount was never stored at the time and cannot be recovered, which is a gap in an old row rather than anything being wrong now. When you set the time budget on a task, a Deadline feasibility panel appears underneath showing what that decision does to the person who will do the work. It is named for them \u2014 \u201CBased on Pramod\u2019s workload\u201D \u2014 because on a cross-department task you are planning somebody else\u2019s week, not your own. It lists their whole priority queue, not this task alone: every task they already have, in order, each with its time budget and the date it is expected to finish — including work still being negotiated, using the proposed hours as the best available estimate, because two proposals for the same person are still two things they will do one after the other. Completed, cancelled and refused tasks are gone from the list, and so is anything already broken down into subtasks — a project holds no place of its own, its subtasks do. The dates come from real working hours \u2014 the office schedule, weekends, holidays and breaks \u2014 so a task that would spill past closing resumes the next working morning rather than running through the night. You can rearrange the whole queue without saving any of it. Drag any row by its handle and drop it where you want \u2014 a line shows exactly where it will land, and the rows slide into their new places when you let go \u2014 and every date, delay and verdict recalculates for the order you built. The list stays where you put it while those figures are worked out; the dates dim and the panel says \u201CRecomputing the dates for this order\u2026\u201D rather than emptying. Pressing P1, P2 or P3 does the same thing to this task by another route, and the two always agree. Pressing an hours chip does the same thing as the dropdown above it, and those always agree too. None of it is saved: the panel says \u201CThis order is a preview\u201D and names the person whose real queue is untouched. To make a dragged order real, press \u201CApply this priority\u201D. That opens a confirmation and writes nothing: it lists the person\u2019s whole queue twice, under \u201CNow\u201D and \u201CAfter this change\u201D, with the date each task is expected to finish in each order and, beside every row, whether it lands later, earlier or not at all. The reason is asked for there \u2014 required for the same reason it is required everywhere else, because the person whose work moved is shown who moved it and why \u2014 and Confirm stays refused until it is given. Cancel, Escape or clicking outside leaves everything exactly as it was. Only Confirm writes. Reset puts the preview back to the real order. The task you are setting up is never part of what Apply writes, because it is not in their queue yet; its own position is carried by this form. Nothing is written until you press the button that assigns the task. Each row tells you what your choice cost it: \u201CAdded here\u201D on the task you are placing, \u201Cno change\u201D if it was untouched, or \u201Cdelayed +\u201D and an amount if it moved. That amount is real elapsed time, not extra effort, so it can be much larger than the hours you added \u2014 six more hours of budget can delay the next task by twenty-one if those hours push it past the end of the day. The verdict at the top reads \u201C\u2713 Deadline achievable\u201D with the buffer remaining, or \u201C\u26a0 Deadline risk\u201D with the amount it misses by, measured against the deadline the assignor requested. The preview is advice, not a gate: a risk warning never stops you setting the hours. Changing the requested deadline changes only that verdict \u2014 it never moves a start time, a completion date or anybody\u2019s queue, because when work actually happens is decided by the queue and the working calendar, never by the date somebody asked for. One result surprises people: swapping two tasks above a third leaves the third exactly where it was, because it still has the same total work in front of it. Only crossing a task moves that task. You can also drag a row directly in the task list, inside a person\u2019s group, and that goes through the same confirmation \u2014 it used to save the moment you let go, with a reason nobody wrote. This is also where Expected completion, shown on every task\u2019s own page, gets its answer \u2014 the same calculation, run for that one task instead of a whole preview. Two pending tasks for the same person \u2014 most often two subtasks broken out of the same parent, both still awaiting acceptance \u2014 now show different completion times: whichever carries the earlier priority is assumed to run first, and the other is assumed to start when it finishes. Before this, an unaccepted task was left out of the calculation entirely, so two two-hour subtasks both read \u201cfinishes at the same moment\u201d \u2014 which is not what either of them will actually do, whether or not either has been accepted yet.",
    related: [
      "task-priority",
      "task-deadline-modes",
      "task-budget-vs-deadline-rights",
    ],
    source:
      "lib/rules/tasks/deadlineFeasibility.ts \u2014 calculateDeadlineFeasibility; previewDeadlineFeasibility in lib/repositories/legacy/index.ts; components/features/tasks/FeasibilityPreview.tsx. competingTasks() filters on isLiveCandidate() from lib/rules/tasks/priorityQueue.ts, not isActivePriorityTask() \u2014 a proposed-but-unsettled task now takes a place in this preview using its proposed window, which is what fixed two pending sibling subtasks showing the identical expected completion time; isActivePriorityTask() keeps its old, settled-only meaning everywhere else (dashboards, counters, the accepted chain). Locked by lib/rules/tasks/deadlineFeasibility.test.ts and lib/repositories/legacy/feasibilityWiring.test.ts. Fixed 2026-08-02",
  },
  {
    id: "task-cancel",
    category: "tasks",
    title: "Cancelling a task",
    keywords: [
      "cancel task",
      "cancel",
      "stop a task",
      "call off",
      "abandon task",
    ],
    examples: [
      "How do I cancel a task?",
      "Can I cancel my own task?",
      "Does cancelling hurt my score?",
    ],
    answer:
      "Cancelling needs a reason, always — a cancelled task with no explanation is unreadable later. Managers can cancel work belonging to people they are responsible for, and a task that has already been completed cannot be cancelled at all. Two things about cancellation are genuinely still open and are not settled by anything on screen: whether somebody may cancel work assigned to them personally, and how a cancelled task counts towards a score. Until those are decided, treat any score figure involving a cancellation as provisional.",
    related: ["task-lifecycle", "scoring-provisional", "roles-why-denied"],
    source:
      "cancelTask requires task.cancel + a reason; owner decisions R6 (who may cancel) and O6 (scoring treatment) are OPEN",
  },
  {
    id: "task-extension",
    category: "tasks",
    title: "Asking for more time",
    keywords: [
      "extension",
      "more time",
      "extend deadline",
      "late",
      "cannot finish in time",
    ],
    examples: [
      "How do I ask for more time?",
      "What is a charged extension?",
      "Does an extension affect my score?",
      "My manager approved my extension — why is nothing different?",
      "Can I ask again if I was granted less than I needed?",
    ],
    answer:
      "If you cannot finish in time you can request an extension, and the person reviewing it decides two separate things: whether to grant the extra time, and whether to waive the cost. A waived extension moves the deadline you are measured against, so the extra time is genuinely free. A charged extension gives you the time but leaves the original deadline in place for scoring, so the work still counts as late. The reviewer chooses which, so it is worth asking early and explaining why rather than waiting. Asking for hours goes to your manager, and their answer is an OFFER rather than the end of it — your budget does not change until you confirm it. That is deliberate: a manager can grant fewer hours than you asked for, and a figure that binds your week should not take effect before you have agreed to it. So once they answer you get a card saying what they granted beside what you asked for, with two ways forward: accept it, which puts it in force and recalculates your queue and your expected completion, or propose a different total, which goes straight back to them. That can run as many rounds as it takes. There is deliberately no way to decline your own request at that point — disagreeing means asking for a different number, because a refusal would leave the work carrying a figure neither of you settled. Your manager can decline the first request outright, since nothing binds you yet, and declining changes nothing at all. Every round appears on the task's extension history saying who acted, what was on the table and who it is waiting on, so a conversation that has gone back and forth twice still reads as an account rather than as four identical rows. If you ever see a request that says it is waiting on somebody and offers nobody a button, that is a fault rather than a delay — it means the record does not name whoever should answer, usually because a reporting line is incomplete, and an administrator has to fix it.",
    related: ["task-budget-vs-deadline-rights", "scoring-c1"],
    source:
      "requestExtension / decideExtension with waivePenalty; officialDueAt only moves when waived",
  },
  {
    id: "approvals-my-queue",
    category: "approvals",
    title: "Finding what is waiting on you",
    keywords: [
      "pending approvals",
      "my approvals",
      "review queue",
      "waiting for me",
      "approve tasks",
    ],
    examples: [
      "Where do I see tasks waiting for my approval?",
      "How do I know if something needs my decision?",
      "Why is a task in my queue if I can't act on it?",
    ],
    answer:
      "Actionable, under Tasks. It holds only what a decision is required from you for, or what cannot move until you respond: approvals and effort estimates addressed to you, submitted work at your review stage, deadlines to propose, decide, accept or answer, work you have not yet confirmed receipt of, and blocked tasks you are close enough to unstick. It deliberately does NOT list work that is simply yours to get on with — a task you are already progressing has no decision outstanding and nobody is waiting on it, so it lives in Tasks, Projects and Timeline instead. The count on the tab is the same list, so it can never disagree with what you see. Items where you appear later in a chain are not shown as yours: the view names who the decision is currently with, and a chain stopped for a missing department head is waiting on an administrator rather than on any reviewer.",
    related: [
      "approvals-who-approves",
      "approvals-blocked",
      "approvals-what-happens",
    ],
    source: "listReviewDetail: isMyTurn, waitingOn, blockedBy",
  },
  {
    id: "roles-responsibilities",
    category: "roles",
    title: "What managers and department heads are responsible for",
    keywords: [
      "manager responsibilities",
      "hod",
      "team lead",
      "what does a manager do",
      "supervisor",
    ],
    examples: [
      "What can a manager do that I can't?",
      "What is a head of department responsible for?",
      "What is the difference between my manager and my department head?",
    ],
    answer:
      "Your manager is the person you report to, and their reach is the people beneath them: assigning them work, reviewing what they submit, seeing their scores and re-planning how their time is spent. A head of department is a separate job attached to a department rather than to a reporting line — one named person per department, who approves work crossing into or out of it. The two are often the same person in a small team and deliberately different in a large one. Neither title is fixed in the product: an organisation renames both, and what actually decides anything is the set of permissions attached to the role, not what it is called.",
    related: ["roles-scopes", "task-cross-department", "settings-departments"],
    source:
      "ReportingRelationship drives manager reach; Department.hodEmployeeId drives cross-department gates; roles are records, not literals",
  },
  {
    id: "task-visibility",
    category: "tasks",
    title: "Which tasks you can see",
    keywords: [
      "see tasks",
      "task visibility",
      "my team tasks",
      "everyone tasks",
      "can't see task",
    ],
    examples: [
      "Why can't I see my colleague's tasks?",
      "What does the 'Everyone' scope mean?",
      "Why is there no 'My team' option for me?",
    ],
    answer:
      "Task scopes follow your role. Everyone sees Mine and Assigned out. A manager also gets My team, which is their reporting line rather than the whole company. Only a role with organisation-wide visibility gets Everyone. Scopes you cannot use are hidden rather than shown empty, because an empty team view looks like a broken team instead of an absent permission. Mine holds work someone else gave you. A task you created and assigned to yourself sits under Assigned out instead, because you are its sender — the one exception is a self-assigned task you raised for an approver, which stays in Mine. Assigned out also holds tasks where you are the approver on someone's self-assigned request, tasks naming you as a viewer, and tasks whose hours you set as a team lead, so anything waiting on you is in one place. Two more scopes are open to every role, because each is about your own relationship to a task rather than your reach over other people. Self tasks holds work you raised for yourself. Submitted holds every task whose completion has been sent for review and that you are party to — you filed it, you sent the work, or you owe it a decision — and it keeps rejected submissions rather than hiding them, because the rejection is part of the record. Someone with organisation-wide visibility sees every submission there.",
    related: ["roles-scopes", "roles-why-denied"],
    source:
      "listTasks scope handling; task.view scope drives the visible options",
  },

  /* ── Approvals ──────────────────────────────────────────────────────────── */
  {
    id: "approvals-what-happens",
    category: "approvals",
    title: "What happens when work is submitted",
    keywords: ["approval flow", "review chain", "stages", "who reviews"],
    examples: [
      "What happens after I submit a task?",
      "How does the approval chain work?",
    ],
    answer:
      "The submission runs through the approval workflow your administrators configured. The default is three named stages — Supervisor, then Head of department, then one level above — and each stage resolves its approver by rule rather than by name, so a reorganisation changes who approves without anyone editing a workflow. Stages run in order, and one person satisfying two stages is asked once rather than twice.",
    related: [
      "approvals-who-approves",
      "approvals-blocked",
      "settings-workflows",
    ],
    source:
      "ApprovalWorkflow, resolveWorkflow, approverChain in lib/auth/workflow.ts",
  },
  {
    id: "approvals-who-approves",
    guide: {
      actionType: "approve-task",
      startAt: "/tasks?view=approvals",
      requires: "review.decide",
      steps: [
        {
          target: HELP_TARGETS.approvalsTab,
          message: "Approvals holds everything involving you.",
          page: "/tasks?view=approvals",
        },
        {
          target: HELP_TARGETS.reviewQueueList,
          message:
            "Items marked as yours are the ones you can decide now. The rest name who they are with.",
        },
        {
          target: HELP_TARGETS.approveButton,
          message:
            "Approving passes it to the next stage, or completes it if you are the last.",
        },
        {
          target: HELP_TARGETS.rejectButton,
          message:
            "Rejecting needs a reason. Use rework instead if the work simply needs another pass.",
        },
      ],
    },
    category: "approvals",
    title: "Who approves your work",
    keywords: [
      "who approves",
      "my approver",
      "reviewer",
      "waiting on",
      "whose turn",
    ],
    examples: [
      "Who has to approve my task?",
      "Who is my work waiting on?",
      "Why can't I approve this?",
    ],
    answer:
      "Approvers are resolved from the workflow, not fixed on the task. A stage can point at your reporting manager a set number of levels up, at your department head, at whoever holds a given role, or at one named person. Two things must both be true for you to decide: you are the approver for the stage that is currently open, and your role carries the capability to decide reviews. Being somewhere later in the chain is not the same as it being your turn, and the Approvals view says which of the two you are looking at. Completion review works the same way, and who reviews depends on who raised the task: one a team lead raised comes back to that lead; one the chief executive raised directly comes back to them; anything forwarded or broken out of a parent goes to the assignee\u2019s manager first and the chief executive second. Nobody reviews their own submission, whatever the chain says.",
    related: ["approvals-what-happens", "roles-why-denied", "task-submit"],
    source: "ApproverRule; listReviewDetail isMyTurn; review.decide capability",
  },
  {
    id: "approvals-blocked",
    category: "approvals",
    title: "A blocked approval stage",
    keywords: [
      "blocked approval",
      "no head of department",
      "approval stuck",
      "cannot submit",
    ],
    examples: [
      "Why does it say my approval is blocked?",
      "The stage says no head of department — what do I do?",
    ],
    answer:
      "A stage is blocked when its rule finds nobody — most often a department with no head on record. Cowork stops there and names the reason rather than skipping the stage, because work reaching 'approved' having passed fewer gates than the process requires is a worse outcome than work waiting. An administrator fixes it by naming a head of department in Settings, or by configuring that stage to skip when unresolved.",
    related: [
      "settings-departments",
      "settings-workflows",
      "approvals-who-approves",
    ],
    source: "ResolvedStage.blocked; onUnresolved skip|block on each stage",
  },

  /* ── Roles and permissions ──────────────────────────────────────────────── */
  {
    id: "roles-scopes",
    category: "roles",
    title: "How permissions work",
    keywords: [
      "permissions",
      "capability",
      "scope",
      "what can i do",
      "access rights",
    ],
    examples: [
      "How do permissions work?",
      "What is a scope?",
      "Why does my colleague see more than me?",
      "How did I get the role I have?",
    ],
    answer:
      "A permission in Cowork is a capability and a scope together, never a capability alone. The capability says what you may do; the scope says who you may do it to — yourself, your direct reports, everyone beneath you, or the whole organisation. That pairing is why a manager sees their own reports' scores and not everyone's. Roles are additive: holding two roles gives you the union of both, and the wider scope wins. Everyone holds the Employee role. You hold Manager as well from the moment somebody reports to you — the reporting line grants it, not your job title, so a manager whose record says otherwise still gets the surfaces for their own people and reaches nobody else. Team leads keep it between assignments, so the screens do not disappear on the day their last report moves. Administrator comes from your record rather than from the reporting line: administering the system and managing people are separate jobs, and being an administrator makes nobody your manager.",
    related: [
      "roles-why-denied",
      "roles-admin-floor",
      "task-visibility",
      "settings-roles",
    ],
    source:
      "Permission = capability × scope; scopeFor picks the widest held scope; systemRoleIdsFor grants Manager from the reporting tree",
  },
  {
    id: "roles-why-denied",
    category: "roles",
    title: "Why an action was refused",
    keywords: [
      "permission denied",
      "not allowed",
      "no permission",
      "access denied",
      "refused",
    ],
    examples: [
      "Why do I get permission denied?",
      "Why can't I do this?",
      "It says I don't have access — why?",
    ],
    answer:
      "There are three different refusals and the message tells you which one you hit. “Your role does not include…” means the capability is not granted to any role you hold. Or it may include it but at a scope that does not reach the person you are acting on — a manager cannot act outside their reporting line. Or the person you are acting on sits at or above your own administrative level, which no capability overrides. Hidden buttons are a courtesy; the refusal happens in the data layer regardless of what the screen shows.",
    related: ["roles-scopes", "roles-admin-floor"],
    source: "DenyReason: no_capability | out_of_scope | administrative_floor",
  },
  {
    id: "roles-admin-floor",
    category: "roles",
    title: "Acting on someone senior to you",
    keywords: [
      "administrative level",
      "reset password",
      "change someone's role",
      "act on manager",
    ],
    examples: [
      "Why can't I reset that person's password?",
      "What is an administrative level?",
      "Does managing someone make me more senior?",
    ],
    answer:
      "Every role carries an administrative level, and nobody may act on a person at or above their own — for password resets, role changes, reporting changes, deactivation, score adjustments and conduct events. This is why People Operations can reset most passwords but not an administrator's. It exists because the previous system let a team lead reset the chief executive's password and revoke their sessions. You also cannot grant a capability you do not hold yourself, or create a role at or above your own level. Gaining someone to manage does not raise your own level: it widens who you may act on, which is reach, and leaves your standing among colleagues where it was. Standing changes when your record changes, which is a decision somebody makes about you rather than a side effect of the org chart moving.",
    related: ["roles-why-denied", "settings-roles", "roles-scopes"],
    source: "administrativeLevel floor in can(); legacy defect P5",
  },

  /* ── Employee status / LiveKit ──────────────────────────────────────────── */
  {
    id: "status-online",
    category: "status",
    title: "Going online",
    keywords: [
      "go online",
      "online status",
      "screen share",
      "share screen",
      "can't go online",
    ],
    examples: [
      "How do I go online?",
      "Why am I still offline?",
      "Why does it ask to share my screen?",
    ],
    answer:
      "Online is not something you set — it is a consequence of sharing your screen. Choose Go online in the status menu and your browser asks for a screen; once that share is live and connected, your status becomes Online on its own. Cancelling the picker costs nothing: no session is created and you stay Offline. If sharing stops for any reason, including closing the browser's own sharing bar, you return to Offline automatically. Your status is published for everyone, so your colleagues, your manager and your own record all read the same thing rather than each guessing. Being online is also what unlocks your own task actions — see “Task actions while you are away”.",
    related: [
      "status-entire-screen",
      "status-break",
      "status-offline",
      "status-task-actions",
    ],
    source:
      "employeeStatus derive(); Online requires a live share plus a connected room; published to cowork_duty_status by DutySync",
  },
  {
    id: "status-entire-screen",
    category: "status",
    title: "Why a window or tab is not accepted",
    keywords: [
      "entire screen",
      "window sharing",
      "browser tab",
      "share rejected",
      "not accepted",
    ],
    examples: [
      "Why won't it accept my window share?",
      "It says entire screen only — why?",
      "I shared a tab but I'm still offline.",
    ],
    answer:
      "Only sharing your entire screen counts. A single window or a browser tab is a curated view, so accepting one would make Online mean something different from what it claims. Cowork checks what you actually picked rather than what was requested, stops the capture immediately if it is not a whole screen, and tells you so. The check also runs continuously, so a share that stops being a whole screen stops counting.",
    related: ["status-online", "status-offline"],
    source: "readSurface + isEntireScreen; ScreenShareWrongSurface",
  },
  {
    id: "status-break",
    category: "status",
    title: "Break and emergency",
    keywords: ["break", "emergency", "away", "lunch", "step away"],
    examples: [
      "How do I take a break?",
      "What does emergency do?",
      "Does a break stop my screen share?",
    ],
    answer:
      "Break and Emergency are the two states you set yourself. A break suppresses Online while leaving your screen share running and the connection open, and it runs a visible timer. An emergency flags your team immediately and deliberately does not touch your screen share — it is a signal to people, not an instruction to the media layer. An emergency outranks a break, and a break outranks presence. Neither is cleared by losing your screen share; you end them, or ending the session does. Starting either one pauses any running work timer, so the same minutes are never both logged as worked and given back. Both give time back to your deadlines, by different routes — see “Break time and your deadlines” and “Emergency Mode and your deadlines”.",
    related: [
      "status-online",
      "status-offline",
      "status-break-allowance",
      "status-emergency-approval",
      "status-task-actions",
    ],
    source: "derive() priority order: emergency > break > share state",
  },
  {
    id: "status-break-allowance",
    category: "status",
    title: "Break time and your deadlines",
    keywords: [
      "break",
      "break allowance",
      "break limit",
      "maximum break",
      "break deadline",
      "lunch",
      "remaining break",
    ],
    examples: [
      "Does a break move my deadlines?",
      "How much break time do I get?",
      "What happens when I use up my break allowance?",
      "Can I be stopped from taking a break?",
      "Who sets the break limit?",
    ],
    answer:
      "Ending a break adds that time to the deadlines of every live task you hold — a break from 2:00 to 2:30 moves them thirty minutes later. Nobody approves it; the daily allowance is what bounds it instead. The status menu shows how much of today's allowance is left, and once it is used up a break still happens and is still recorded, it just stops moving deadlines any further. You are never prevented from taking a break — the allowance limits what break time gives back to a schedule, not your right to step away. The allowance is spent by the time you actually take, so a break that credits nothing still counts against it. Completed and cancelled tasks never move, and neither does anything without a deadline. A break moves your working deadline but not the scored one, so it gives you time without forgiving lateness — that is the difference from an approved emergency, where a manager has agreed the time was unavoidable and the scored deadline moves too. Administrators set the allowance in Administration under Settings; it defaults to sixty minutes a day.",
    related: [
      "status-break",
      "status-emergency-approval",
      "task-extension",
      "settings-scoring-rules",
    ],
    source:
      "lib/tasks/breakMode.ts — breakBudget and creditedBreakSecs; endBreak in lib/repositories/mock/index.ts; ported from legacy DutyStatusToggle.jsx",
  },
  {
    id: "status-emergency-approval",
    category: "status",
    title: "Emergency Mode and your deadlines",
    keywords: [
      "emergency mode",
      "emergency approval",
      "extra time",
      "emergency deadline",
      "supporting document",
      "emergency declined",
    ],
    examples: [
      "Does Emergency Mode give me more time?",
      "Why do I have to upload a document?",
      "Who approves my emergency?",
      "My emergency was declined — what happens?",
      "Can my admin approve my emergency?",
    ],
    answer:
      "Emergency Mode does not move your deadlines by itself. When you turn it off, Cowork asks what happened and for a supporting document — a PDF or a Word file, and both are required — and sends that to your manager as a request. Nothing changes while it waits: you go back to work immediately, and your deadlines stay exactly where they are. Your manager sees who you are, when the emergency started and ended, how long it ran, your explanation and the document, and either approves or declines. If they approve, the full duration is added to every live task you hold that has a deadline — finished and cancelled tasks are left alone — and because the emergency was accepted, the scored deadline moves too, so the time is not counted against you. If they decline they have to say why, nothing about your tasks changes at all, and the request stays in the history as declined. Either way you get a notification. Only your direct manager can decide it: you cannot approve your own, and an administrator does not get to decide it for them. If you have no manager on record, the request cannot be raised — ask an administrator to set your reporting line first.",
    related: ["status-break", "task-extension", "people-unplaced"],
    source:
      "lib/tasks/emergency.ts — emergencyRequestRefusal and emergencyDecisionRefusal; createEmergencyRequest / decideEmergencyRequest; ported from legacy lib/emergencyApproval.js",
  },
  {
    id: "status-offline",
    category: "status",
    title: "Why you went offline",
    keywords: ["went offline", "offline", "disconnected", "lost status"],
    examples: [
      "Why did I go offline?",
      "I didn't change anything and I'm offline.",
    ],
    answer:
      "Offline is never chosen for you arbitrarily — it is what happens when the thing that made you Online stops. Stopping the share from the browser's own bar, losing the room connection, closing the tab, or a share that stops being a whole screen all return you to Offline. The status menu always states the reason underneath, so Offline is never left to be inferred. If your computer crashes, sleeps or is closed without a chance to sign out, your status goes offline on its own shortly afterwards — a live session keeps proving it is there, and one that stops proving it stops counting as online. That is why nobody is left showing as online overnight. Having several tabs open is fine: the one holding the share keeps you online, and closing any of the others changes nothing.",
    related: ["status-online", "status-entire-screen", "status-task-actions"],
    source:
      "ScreenShareBridge reportShare detail; onDisconnected goes offline; STALE_AFTER_MS heartbeat window in rules/presence/duty.ts",
  },

  {
    id: "status-task-actions",
    category: "status",
    title: "Task actions while you are away",
    keywords: [
      "cannot start timer",
      "timer disabled",
      "no task actions",
      "offline cannot work",
      "buttons missing on task",
      "go online to resume",
    ],
    examples: [
      "Why can't I start the timer?",
      "Why have the buttons gone from my task?",
      "It says I am offline and cannot continue — why?",
    ],
    answer:
      "While you are Offline, on Break or in Emergency Mode, you cannot act on work assigned to you: the timer will not start, and the task's actions are replaced by a line saying which state you are in and how to leave it — for example “Offline — the timer is paused and no task actions can be taken right now. Go online from the top bar to resume.” Any timer that was running is paused for you when you leave Online, so time is not logged against work you have stepped away from. The reason is not administrative: break and emergency minutes are being credited back to your deadlines, so a clock running through them would pay for the same minutes twice. This applies only to work you are carrying. Reviewing somebody else's submission, deciding a deadline you set, or reading anything at all are unaffected — being away from your own work is not the same as being unable to answer for other people's. Coming back online restores everything immediately; nothing needs to be reset, and the time already logged is untouched.",
    related: ["status-online", "status-break", "status-offline", "task-lifecycle"],
    source:
      "presenceRefusal in rules/presence/taskGate.ts; ported from tasks/page.js:8571 — gate is startTimer, not the button",
  },

  {
    id: "status-no-feed",
    category: "status",
    title: "No screen is reaching the monitoring view",
    keywords: [
      "screen not showing",
      "no feed",
      "cannot see their screen",
      "monitoring blank",
      "waiting for screen",
    ],
    examples: [
      "Why is their screen not showing?",
      "Why does the monitoring view say no feed?",
      "I can't see my report's screen.",
    ],
    answer:
      "The monitoring view shows a screen only while that person is actually publishing one. It appears in two places and behaves identically in both: the Monitoring page, and the Overview of a person's record under Team. If it says they are on a break, their share is paused but their connection is held. If it says no feed while they are reported online, they have most likely stopped sharing or are connected from another session — the view reports what is reaching it rather than what the status says. Nothing is shown for someone who is offline, because going online is what starts the share in the first place. Underneath the frame, the Session panel states what is actually being captured: the screen they chose, and Camera and Microphone both Off, because Cowork monitoring is screen-only and never turns on a camera or a microphone.",
    related: [
      "status-online",
      "status-offline",
      "status-entire-screen",
      "team-person-record",
    ],
    source:
      "LiveScreenViewer placeholder states; tracks matched by presenceIdentity; SessionDeck capture cells",
  },

  {
    id: "team-person-record",
    category: "roles",
    title: "What a person's record shows you",
    keywords: [
      "team member profile",
      "person record",
      "employee profile",
      "monitor one person",
      "their overview",
      "open someone's record",
    ],
    examples: [
      "What can I see about someone on my team?",
      "Where do I watch one person's day?",
      "Why can't I open this person's record?",
    ],
    answer:
      "Team, then the person, opens their record. Overview is the whole working day in one place: their live screen with the session beneath it, what they are working on right now and the task it belongs to, the day's activity in order, the moments that stood out, how loaded they are, what stands out about the day, who they are working with, and their performance — score contribution across C1–C4, the trailing trend, goals, and what landed today. Tasks, Score and Attendance sit behind their own tabs. Everything on it follows the same boundary as every other team surface: you see the people in your own reporting line and your own record, and nobody else. Opening someone outside it shows the boundary rather than an error, because not being their manager is not a fault. Live monitoring is narrower still — it reaches only the people beneath you, so a record you can read may show performance without a screen.",
    related: [
      "roles-scopes",
      "status-no-feed",
      "team-observations",
      "scoring-visibility",
    ],
    source: "PersonMonitor composition; viewer.hierarchyIds gate in PersonPage",
  },

  {
    id: "team-observations",
    category: "roles",
    title: "Where “What stands out” comes from",
    keywords: [
      "what stands out",
      "observations",
      "insights",
      "flagged",
      "why is this flagged",
      "basis",
    ],
    examples: [
      "What is the 'What stands out' panel?",
      "Where does that observation come from?",
      "Is this a prediction?",
    ],
    answer:
      "It is measurement, not prediction. Every line in it names what it was computed from directly underneath the claim — “open assignments and remaining scheduled hours”, “idle time, compared with the trailing five days”, “C1 · Task Execution events for this period”. That is deliberate: it means you can disagree with the evidence and go and look at it, rather than being handed a verdict you cannot interrogate. Nothing in Cowork forecasts what someone will do, scores them against anybody else, or produces a judgement no person can trace. An empty panel means the day reads as ordinary against that person's own trailing week, which is the usual answer.",
    related: ["team-person-record", "scoring-components", "scoring-visibility"],
    source: "Observation.basis is a required field; ObservationsPanel renders it",
  },

  /* ── Scoring ────────────────────────────────────────────────────────────── */
  {
    id: "scoring-components",
    category: "scoring",
    title: "What your score is made of",
    keywords: ["score", "c1", "c2", "c3", "c4", "components", "percentage"],
    examples: [
      "How is my score calculated?",
      "What are C1 to C4?",
      "What does my percentage mean?",
    ],
    answer:
      "Your score is a percentage: how much could have been achieved against how much was. It is an absolute measure against your own achievable ceiling, not a ranking against anyone. Four components make it up — C1 Task Execution, C2 Goals, C3 Conduct and Policy, and C4 Attendance. C3 is deduction-only and can never add to a score. The score floors at 0 and caps at 100.",
    related: ["scoring-c1", "scoring-provisional", "scoring-visibility"],
    source: "docs/architecture/PRODUCT.md score model; buildOverview in lib/scoring/engine.ts",
  },
  {
    id: "scoring-c1",
    category: "scoring",
    title: "How task work affects your score",
    keywords: [
      "c1",
      "task score",
      "rework deduction",
      "late penalty",
      "rejection deduction",
    ],
    examples: [
      "How does rework affect my score?",
      "What happens to my score if I'm late?",
      "Do cancelled tasks count against me?",
    ],
    answer:
      "C1 measures how work was completed, not merely whether it was. Completing a task earns its points. Rework, missing the deadline, a rejection, and an extension your manager chose not to waive each take points away. An extension that is waived moves the deadline you are measured against; one that is charged does not, which is the difference between more time and more time at a cost. Only the rework deduction has been settled by the owner — every other amount is a placeholder and is labelled as one, and how a cancelled task is treated is still undecided.",
    related: ["scoring-provisional", "task-rework", "scoring-components"],
    source:
      "projectScores C1 projection; deductionFor; officialDueAt is what scoring reads",
  },
  {
    id: "scoring-provisional",
    category: "scoring",
    title: "Figures marked provisional",
    keywords: [
      "provisional",
      "placeholder",
      "unconfirmed",
      "why is this marked",
    ],
    examples: [
      "What does provisional mean?",
      "Why is my score marked provisional?",
    ],
    answer:
      "A provisional figure comes from a rule nobody has approved yet — a placeholder that exists so the product can run, not a recommendation. Anything derived from one is labelled wherever it appears. When an administrator publishes a real value for that rule it stops being provisional, and the label goes away. The component weightings are among the values still undecided, which is why no weighted split is shown.",
    related: ["scoring-components", "settings-scoring-rules"],
    source: "PROVISIONAL_RULES; isOverridden clears the provisional flag",
  },
  {
    id: "scoring-visibility",
    category: "scoring",
    title: "Who can see your score",
    keywords: [
      "who sees my score",
      "score privacy",
      "compare scores",
      "manager sees",
    ],
    examples: [
      "Can my colleagues see my score?",
      "Who can see my performance?",
      "Can I see my team's scores?",
    ],
    answer:
      "You see your own score and never a peer's, and never your position relative to peers. A manager sees the scores of the people reporting to them, including how those people compare to each other — and that comparison exists only looking down the reporting chain, never sideways and never upward. Visibility extends further up the chain to skip-level leadership and to a designated people-operations role.",
    related: ["roles-scopes", "scoring-components"],
    source: "docs/architecture/PRODUCT.md score visibility; score.view and score.compare scopes",
  },

  /* ── Settings ───────────────────────────────────────────────────────────── */
  {
    id: "settings-roles",
    category: "settings",
    title: "Editing roles and permissions",
    keywords: [
      "edit role",
      "create role",
      "assign role",
      "change permissions",
      "roles are fixed",
      "cannot save role",
    ],
    examples: [
      "How do I create a role?",
      "How do I give someone permission?",
      "Where do I manage roles?",
      "Why can't I save a change to a role?",
    ],
    answer:
      "Administration, then Roles. A role is a grid of capabilities, each with a scope, and the grid is worth reading whether or not you can change it — it is the answer to why a particular person can approve a particular thing. Saving a change is a different matter and depends on which system is behind your workspace. On the Cowork engine the five roles are fixed, and saving returns “Roles are fixed while the Cowork engine is the backend. It stores a role as one of three words on each employee, not as a record with permissions, so there is nowhere to save a change to this table.” Nothing is lost when that appears — the change simply was not saved, and the permissions on screen are the ones in force. Where roles can be saved, three limits apply: you cannot edit a role at or above your own administrative level, you cannot grant a capability you do not hold yourself, and you cannot leave nobody able to administer roles. System roles can be edited but not deleted, and a role still held by someone cannot be deleted at all.",
    related: ["roles-admin-floor", "roles-scopes", "settings-departments"],
    source:
      "setRolePermissions, assignRoles, deleteRole guards; LegacyRepository refuses role edits — systemRoles.ts holds the table",
  },
  {
    id: "settings-departments",
    category: "settings",
    title: "Departments, heads of department and reporting lines",
    keywords: [
      "department",
      "hod",
      "head of department",
      "reporting line",
      "who reports to whom",
    ],
    examples: [
      "How do I set a head of department?",
      "How do I change who someone reports to?",
      "How do I move someone to another department?",
    ],
    answer:
      "Administration, then Organisation. Each department names one head, which is what lets an approval stage route to 'the HOD' deterministically. Changing a reporting line closes the old one rather than overwriting it, so a score computed last quarter stays visible to whoever managed that person then. Reporting loops are refused outright. Only a person's primary reporting line grants their manager anything — a secondary or dotted line records that people work together and gives no team visibility, no monitoring and no access to scores.",
    related: [
      "approvals-blocked",
      "task-cross-department",
      "settings-workflows",
      "people-unplaced",
    ],
    source:
      "updateDepartment, setReportingManager with cycle detection; closureOf counts active primary lines only",
  },
  {
    id: "people-unplaced",
    category: "settings",
    title: "Someone is missing from People, Team or monitoring",
    keywords: [
      "missing employee",
      "cannot see employee",
      "not in people list",
      "reports to",
      "no manager",
      "not in the reporting line",
      "unplaced",
      "add someone",
    ],
    examples: [
      "Why can't I see this person in my team?",
      "Someone can log in but does not appear in People.",
      "Why does it make me choose a manager when adding someone?",
      "What does “Not in the reporting line” mean?",
    ],
    answer:
      "Almost always because nobody has placed them in the reporting line. Team surfaces, live monitoring and manager dashboards all read one thing — the reporting tree — so a person with no manager is missing from them, even though they can sign in and their record exists. Who you can assign to is the exception: anyone can raise work for anyone, so an unplaced person is still in the assignee list. What their missing manager changes is what happens next, because the approval that would hold the task has nobody to ask. Adding someone therefore makes “Reports to” a required choice: pick their manager, or say explicitly that they sit at the top of the organisation. For people already in that state, Administration then People shows a “Not in the reporting line” panel listing exactly who is unplaced, with a manager picker beside each. Nobody is ever assigned a manager automatically — receiving somebody is a decision, not a default. The person who created the workspace is never listed there, because the top of an organisation has no manager and never will. You can also set or change a manager at any time on the person's own record, under Placement and access.",
    related: [
      "settings-departments",
      "team-person-record",
      "roles-scopes",
      "status-no-feed",
    ],
    source:
      "lib/auth/hierarchy.ts — closureOf and unattachedEmployees; UnplacedPeople panel; required Reports to in NewEmployee",
  },
  {
    id: "settings-console",
    category: "settings",
    title: "The administration console",
    keywords: [
      "admin settings",
      "admin console",
      "system settings",
      "administration",
      "who can open admin",
      "admin navigation",
    ],
    examples: [
      "Where are the system settings?",
      "Why can't I see the Admin menu?",
      "Who can change system settings?",
      "What can an administrator configure?",
    ],
    answer:
      "Administration sits at /admin and has three parts: Overview, Settings, and the Audit log. Only a system administrator can open any of it. Everybody else has no Admin entry in the top bar at all, and typing the address sends them back to their workspace — the refusal is made on the server before the page is built, so it is not a hidden menu item. Settings has six sections. Task rules covers the gates work passes through before it can be submitted. Priority and scoring holds the deduction values and component maximums that scores are computed from. Workflow routing decides who answers an extension request and what happens when nobody is named. Organisation shows departments, the reporting line and the roles it grants, and is read-only. Office policy is the working week — days, hours, breaks, the break allowance and the task action gap. Provisional rules are the placeholder values still waiting on a decision. Every section says on screen where its values are stored and who reads them once saved, because that is not the same for all six: office policy is read by Cowork and by the old application together, priority and scoring is read by the scoring engine and reaches published scores, and task rules, workflow routing and provisional rules are enforced by Cowork only — the old application does not read them and will not apply them. Every change is recorded with its previous value, its new value, who made it and when. Some things are deliberately not configurable, and the console says so rather than leaving a gap: task statuses are the engine's own vocabulary, priority position is worked out from the queue rather than chosen, the split between asking for hours and asking for a date is fixed because adding hours to a date is always wrong, and reporting lines and departments are HR records.",
    related: [
      "settings-office-policy",
      "settings-task-rules",
      "settings-workflows",
      "settings-scoring-rules",
      "settings-provisional-rules",
      "settings-audit-log",
      "settings-roles",
    ],
    source: "canAccessAdminConsole in lib/rules/admin/access.ts; SETTINGS_SECTIONS",
  },
  {
    id: "settings-office-policy",
    category: "settings",
    title: "Office policy — working hours, breaks and scheduling",
    keywords: [
      "working hours",
      "office hours",
      "office policy",
      "break allowance",
      "recurring breaks",
      "task action gap",
      "holidays",
      "change working hours",
      "working days",
    ],
    examples: [
      "Where do I set the working hours?",
      "How do I change the break allowance?",
      "What is the task action gap?",
      "Will changing office hours move deadlines?",
    ],
    answer:
      "Administration, then Settings, then Office policy. This is the one section both Cowork and the old application read, so a change here applies everywhere. Working hours are set per day, so a day that closes early is set on that day rather than for the whole week; time outside them is not working time and no deadline accrues in it. Recurring breaks are subtracted from every working day. The break allowance is how much personal break time is credited back to a person's deadlines each day — beyond it, break time is recorded but not credited. The task action gap decides how a deadline is anchored when work does not start straight away: a task left untouched for longer than the gap is measured from the gap rather than from when it was created, so a forgotten task does not arrive already overdue. Because all of it feeds the deadline calculation, saving asks you to confirm first: it lists every field that changed with its old and new value and says \u201CThis change may recalculate active task deadlines\u201D. What is recalculated is the expected completion — when the work will really be finished once it is laid through the calendar. The requested deadline, which is the commitment and what scores are measured against, is not moved. Employee records are not here and cannot be changed from Cowork: names, employee ids, departments, designations, reporting lines, joining details and attendance all come from HR, and Cowork reads them rather than owning them. Reading the page needs no special permission \u2014 everybody may see the hours they work \u2014 and changing it needs a system administrator; the controls are visible but disabled otherwise.",
    related: [
      "settings-console",
      "settings-audit-log",
      "status-break-allowance",
      "task-extension",
    ],
    source: "cowork_settings/office via getOfficePolicy/setOfficePolicy, audited",
  },
  {
    id: "settings-task-rules",
    category: "settings",
    title: "Task rules — what must be done before work can be submitted",
    keywords: [
      "task rules",
      "submission rules",
      "acceptance criteria",
      "require timer",
      "submission note",
      "resubmit",
      "proposal expiry",
    ],
    examples: [
      "Can I require the timer before submitting?",
      "How do I make a submission note mandatory?",
      "Can a rejected task be resubmitted?",
      "How long does a proposal stand?",
    ],
    answer:
      "Administration, then Settings, then Task rules. Five gates, each with two named behaviours rather than an on/off switch, because neither position is \u201Coff\u201D. Outstanding acceptance criteria either block a submission or warn and allow it; a task with no criteria is unaffected either way. Recorded time can be required, which refuses a submission with nothing on the timer \u2014 work submitted with no measured effort leaves its budget unmeasurable, and the workload queue is computed from measured effort. A submission note can be optional or required. A rejected task can either be resubmitted directly or has to be reopened first. And a proposal can be given an expiry in hours, after which it lapses; zero means it never lapses, because a lapsed proposal is the absence of a decision rather than a refusal. Every default reproduces what the product already did, so nothing changes until somebody changes it. These rules are enforced by Cowork only. The old application does not read them, so a gate tightened here is not tightened for anybody still working in the old interface. The refusal is applied when the work is submitted, not only in the form, so a stale tab or a second window meets the same answer.",
    related: [
      "settings-console",
      "task-submit",
      "settings-workflows",
      "settings-audit-log",
    ],
    source: "cowork_settings/task_rules; submissionRefusal in submitCompletion",
  },
  {
    id: "settings-provisional-rules",
    category: "settings",
    title: "Provisional rules — publishing a value nobody had decided",
    keywords: [
      "provisional rules",
      "placeholder value",
      "publish a rule",
      "unresolved decision",
      "resolved rule",
      "unpublish",
    ],
    examples: [
      "What is a provisional rule?",
      "How do I publish a rule value?",
      "Why is this figure marked provisional?",
      "Can I undo a published value?",
    ],
    answer:
      "Administration, then Settings, then Provisional rules. Every value here started as a placeholder so the product could run, and none of them was a recommendation \u2014 anything derived from one is marked wherever it appears. Publishing a value records the decision, and the mark goes away: the rule shows as Resolved with the placeholder it replaced beside it, so you can always see whether the current figure was chosen by anybody. Published values persist and are what the rules read; they survive a reload and apply to everybody in this workspace. Unpublishing is not the same as publishing the placeholder's own number \u2014 it removes the decision entirely and restores the provisional mark, because \u201Csomebody chose this\u201D and \u201Cnobody has decided, and the placeholder happens to be this\u201D are different facts. Each rule is grouped under the owner decision it belongs to, with what the old system did for context. These values are enforced by Cowork only; the figures the scoring engine computes published scores from are in Priority and scoring, and the two are separate screens on purpose so that changing a placeholder is not mistaken for changing a score.",
    related: [
      "settings-console",
      "settings-scoring-rules",
      "scoring-provisional",
      "settings-audit-log",
    ],
    source:
      "cowork_settings/rule_overrides; applyRuleOverrides installs them at session start",
  },
  {
    id: "settings-workflows",
    category: "settings",
    title: "Workflow routing — who decides an extension",
    keywords: [
      "approval workflow",
      "workflow routing",
      "fallback approver",
      "escalation",
      "who approves",
      "configure approvals",
      "stuck approval",
    ],
    examples: [
      "How do I change who approves an extension?",
      "What happens if somebody has no manager?",
      "Can a manager grant hours that miss the deadline?",
      "How do I find approvals nobody has answered?",
    ],
    answer:
      "Administration, then Settings, then Workflow routing. The two approval chains are shown and cannot be changed, and the screen says why. A request for extra working hours goes from the assignee to their primary manager, because it is a decision about one person's week and the reporting line owns it. A request to move a date goes from the manager to the assignor, because it is a commitment the assignor made and only they can move it. Hours are always asked for first, since somebody a position ahead of their deadline can absorb them without any commitment moving. What is configurable is what happens where those rules find nobody. If HR names no primary manager, extra hours can be decided by the assignee themselves, sent to a named fallback approver, or refused with the missing reporting line named — the last is the honest answer when a record is simply incomplete, and it is better than routing the request somewhere arbitrary. If a task records no assignor, a date change offers no control at all by default, or can be sent to the fallback approver for historical work that has lost its assignor. Choosing a fallback without naming anybody is refused, because a request routed to nobody looks exactly like one waiting on somebody who will never answer. You can also decide whether a manager may grant hours the workload engine says will miss the deadline, or must take it to the assignor, and after how many hours an unanswered approval is reported as stuck. Stuck approvals are reported, never reassigned: moving a decision automatically would produce an approval nobody consciously gave.",
    related: [
      "settings-console",
      "task-extension",
      "approvals-what-happens",
      "settings-audit-log",
    ],
    source:
      "cowork_settings/workflow_routing; routedBudgetApproverId, routedDeadlineApproverId",
  },
  {
    id: "settings-scoring-rules",
    category: "settings",
    title: "Priority and scoring — the values scores are computed from",
    keywords: [
      "scoring rules",
      "change deduction",
      "edit scoring",
      "missed deadline deduction",
      "rework deduction",
      "idle pool",
      "point cutting",
      "component maximum",
    ],
    examples: [
      "How do I change a deduction?",
      "Where do I edit scoring values?",
      "How do I pause point cutting?",
      "Why can't I set the priority weight?",
    ],
    answer:
      "Administration, then Settings, then Priority and scoring. These values reach published scores, and the section says so before you touch a field. C1 covers execution quality: the component's point pool, the score a task starts at, and what it loses for a missed deadline, a filed extension and returned rework, plus the score a rejected task is overridden to. C2 covers goals. C3 is the idle pool, measured from recorded timer hours against a daily target — that target can be a number of hours or a percentage of the day's available hours, and the percentage wins whenever it is above zero, which the screen states rather than leaving you to guess which field applies. Point cutting has a switch of its own at the top, and it genuinely pauses both deductions and credits for everybody the moment it is turned off; deductions already recorded stay recorded, because this stops new ones rather than reversing past ones. Saving writes two places: the values the engine reads, and a copy the scoring store keeps. Both, or neither — if the second does not land you are told the two now disagree rather than being shown a success. C4, which is lateness, absence and early departure, is not editable from Cowork: those values live in HR's own configuration and are read by the attendance engine, which authenticates against HR. There is no priority weight to set, and that is not a missing control: priority is a position in a queue worked out from the work in front of it, not a number anybody assigns. What priority does to a score is still an undecided rule, and it sits in Provisional rules until somebody takes that decision.",
    related: [
      "settings-console",
      "scoring-provisional",
      "scoring-c1",
      "settings-provisional-rules",
    ],
    source:
      "cowork_sop_settings/task_events read by c1Service.getC1Config; POST /cowork/sop/settings/sync mirrors to BandConfig",
  },
  {
    id: "settings-audit-log",
    category: "settings",
    title: "The audit log — who changed a setting, and what it was before",
    keywords: [
      "audit log",
      "who changed",
      "settings history",
      "why did my deadline change",
      "configuration history",
      "before and after",
    ],
    examples: [
      "Who changed the office hours?",
      "Why did my due date change?",
      "Can I see what a setting used to be?",
      "Who can read the audit log?",
    ],
    answer:
      "Administration, then Audit log. Every system settings change is recorded with who made it, when, each field that changed with its previous and its new value, any reason they typed, and whether the change recalculated live deadlines. It is the answer to \u201Cwhy did my due date change?\u201D \u2014 one save of the working week moves the expected completion of every live task in the company, and without this the only way to find out was to ask around. Entries name the person and keep their employee id beside it, because names change and ids do not. A change that touched the working calendar is marked on the row itself rather than only in the detail, so somebody scanning for a cause finds it without opening anything. Saving without editing records nothing, so the log does not fill with rows that changed nothing. Only a system administrator can read it \u2014 a narrower gate than the console around it, because somebody who can alter configuration and also read the record of alterations could cover one change with another. If you cannot read it you are told so; an empty log and a refused one are different facts and never look the same.",
    related: [
      "settings-console",
      "settings-office-policy",
      "settings-scoring-rules",
    ],
    source: "cowork_settings_audit via listSettingsAudit; applySettingsChange",
  },

  /* ── General ────────────────────────────────────────────────────────────── */
  {
    id: "general-what-is-cowork",
    category: "general",
    title: "What Cowork is",
    keywords: ["what is cowork", "about", "purpose", "what does this do"],
    examples: ["What is Cowork?", "What is this product for?"],
    answer:
      "Cowork is an enterprise workspace that brings tasks, projects, meetings, communication, documents and team workflows together — and measures performance from the same actions. Execution and measurement are one system rather than two: the act of working is the act of being measured. It is not an AI product.",
    related: ["scoring-components", "general-lens"],
    source: "docs/architecture/PRODUCT.md purpose and positioning",
  },
  {
    id: "general-start-conversation",
    category: "general",
    title: "Starting a conversation",
    keywords: [
      "new message",
      "new chat",
      "start a conversation",
      "create a group",
      "direct message",
      "group chat",
      "message someone",
    ],
    examples: [
      "How do I message someone?",
      "How do I start a group chat?",
      "Why did it open an old thread instead of a new one?",
    ],
    answer:
      "Messages, then New message. Direct message reaches one person; Group takes two or more and a name. You can reach anyone in the organisation — there is no permission on messaging and no request to send first, the same principle as assignment, where anyone may raise work for anyone. If you already have a direct thread with somebody, choosing them reopens it rather than starting a second one beside it, because two threads with the same person makes it impossible to tell which one they will read. Opening a conversation clears its unread count, and the count in the list is a number rather than a dot so you can see how much is waiting.",
    related: ["general-group-chat-vs-group", "general-what-is-cowork"],
    source: "createConversation dedupes direct pairs; markConversationRead",
  },
  {
    id: "general-group-chat-vs-group",
    category: "general",
    title: "Group chats and Groups are different things",
    keywords: [
      "group chat",
      "groups",
      "difference between group and group chat",
      "why is my group not in groups",
    ],
    examples: [
      "Why isn't my group chat under Groups?",
      "What is the difference between a group chat and a Group?",
    ],
    answer:
      "A group chat is a conversation with a name and the people in it — you create one from Messages and anybody can. A Group under Groups is an administered object with an owner and a managed membership, and creating or changing one needs the group-management capability. Naming three people and typing a title does not make an administered Group, so a chat you start in Messages stays in Messages. Attachments in a conversation are not available yet; the control is visible and disabled rather than missing, so it is clear the place exists.",
    related: ["general-start-conversation", "roles-scopes"],
    source:
      "Conversation.groupId stays null for chats started in Messages; group.manage governs Groups",
  },
  {
    id: "general-lens",
    category: "general",
    title: "The Private and Team lenses",
    keywords: ["lens", "private", "team view", "switch view"],
    examples: [
      "What does the Private/Team switch do?",
      "How do I see my team instead of myself?",
    ],
    answer:
      "The lens in the top bar is a visibility boundary, not a display preference. Private shows your own work and your own score. Team shows the people reporting to you, including how they compare to each other — a view they never see of themselves. It persists across refreshes and can be linked, because for a manager the team lens is where they work rather than a detour.",
    related: ["scoring-visibility", "task-visibility"],
    source: "LensContext; docs/architecture/PRODUCT.md comparative visibility rule",
  },
  {
    id: "general-documents",
    category: "general",
    title: "Writing a document",
    keywords: [
      "document",
      "documents",
      "write",
      "editor",
      "word processor",
      "page setup",
      "margins",
      "print a document",
      /* Phrases, not the bare words: "export" and "download" on their own
         match questions about exporting data from anywhere in the product,
         and this article only answers for documents. */
      "export a document",
      "download a document",
      "font",
      "outline",
      "headings",
      "find and replace",
      "word count",
      "zoom",
    ],
    examples: [
      "Where do I write a document?",
      "How do I change the margins?",
      "How do I print a document?",
      "Can I export a document?",
      "How do I search inside a document?",
    ],
    answer:
      "Workspace, then Documents. A document opens as a page: menus, a toolbar, a ruler, the outline of its own headings down the left, and word count and zoom along the bottom. Formatting is what you would expect — paragraph styles, fonts and sizes, colour and highlight, alignment, line spacing, indentation, lists and checklists, tables, links, images by address, quotes, code blocks, horizontal lines and page breaks. File then Page setup sets the paper, the orientation and the margins, and the ruler's two stops change the left and right margin directly; that page belongs to the document, so everybody who opens it sees the same measure and the same line breaks. Zoom is yours alone and is not saved. Find and replace is Ctrl F and highlights every match at once, with replace-all landing as a single undo step. Word count is Ctrl Shift C and counts the selection separately when there is one. Printing uses the document's own paper and margins, and prints on white with dark ink whichever theme you are in. File then Download gives a web page or plain text — there is no PDF export, so print to PDF for that. Images are added by address: there is no upload for documents yet, and a file from your machine cannot be added. There are no comments and no version history, so nothing in the menus offers them.",
    related: ["general-document-access", "general-what-is-cowork"],
    source:
      "components/features/workspace/DocumentEditor.tsx; lib/rules/documents/pageSetup.ts, find.ts, outline.ts, textStats.ts",
  },
  {
    id: "general-document-access",
    category: "general",
    title: "Who can open a document, and as what",
    keywords: [
      "share document",
      "document access",
      "view only",
      "editor",
      "owner",
      "document permission",
      "cannot edit document",
      "live editing",
    ],
    examples: [
      "Why does my document say View only?",
      "How do I share a document?",
      "Why can't I rename this document?",
      "Can two people edit the same document?",
    ],
    answer:
      "A document is reachable only by the people in it, and each of them is an owner, an editor or a viewer. The person who created it is the owner. Owners can edit, share, rename and delete; editors can edit; viewers can read, and their toolbar says “View only” with “You have view access to this document. Ask an owner for editing access.” at the foot of the page. A viewer can still search a document — the replace half of the panel is refused rather than hidden. There is no commenter role, because there is no comment layer to give it. The last owner cannot be demoted or removed, since a document with no owner is one nobody could ever share or delete again. Editing is live: everybody in a document sees each other's changes as they are typed, with a coloured caret carrying each person's name. If that connection is not available the document still opens and still saves — the line at the foot of the page says which of the two is actually happening, because two people editing offline would otherwise overwrite each other believing they were collaborating. Anyone can also switch themselves to Viewing from the toolbar to read without changing anything; that is a personal setting and takes nothing away from anybody else.",
    related: ["general-documents", "general-what-is-cowork"],
    source:
      "lib/rules/documents/access.ts (roleOf, editRefusal, memberChangeRefusal); ShareMenu; useCollabSession",
  },
  {
    id: "general-missing-answer",
    category: "general",
    title: "When Cowork does not have an answer",
    keywords: ["no answer", "not found", "unsupported", "don't know"],
    examples: ["Why couldn't you answer my question?"],
    answer:
      "The help knowledge base covers tasks, approvals, roles and permissions, employee status, scoring and settings. Answers come from that knowledge base first. If your question is phrased in a way it does not recognise, the assistant may generate an explanation from the same material instead — those answers are marked as generated, because they explain the rules rather than state them. Either way it will not guess: a question outside those areas, or about a rule nobody has decided yet, gets told so.",
    related: ["general-what-is-cowork"],
    source: "Search confidence banding in lib/help/search.ts",
  },
  {
    id: "general-using-help",
    category: "general",
    title: "Using the help assistant",
    keywords: [
      "help assistant",
      "help button",
      "ask for help",
      "where is help",
      "chat",
    ],
    examples: [
      "How do I get help?",
      "Where is the help button?",
      "Can the assistant do things for me?",
    ],
    answer:
      "The help button sits in the bottom-right corner of every page. Open it and ask a question in your own words, or pick one of the suggestions — those change with the page you are on, so the ones offered on Tasks differ from the ones on Settings. The assistant only explains: it cannot create or approve anything, change a setting, or alter a permission. If you want something done, the screen that does it is where to do it.",
    related: ["general-generated-answers", "general-missing-answer"],
    source: "components/help/HelpAssistant.tsx; /api/help is read-only",
  },
  {
    id: "general-generated-answers",
    category: "general",
    title: "Why an answer is marked generated",
    keywords: [
      "generated answer",
      "ai answer",
      "why is this marked",
      "assistant answer",
      "is this reliable",
    ],
    examples: [
      "Why does it say this answer was generated?",
      "Can I trust a generated answer?",
      "Where do the assistant's answers come from?",
    ],
    answer:
      "Answers come from Cowork's own help knowledge first, and those are rules the product states about itself. When a question is phrased in a way that knowledge does not recognise, the assistant can generate an explanation from that same material — and marks it as generated, because it is explaining the rules rather than stating them. A generated answer never decides whether you personally may do something: the product decides that from your actual roles and reporting line, so treat a generated explanation as a guide and the product's own refusal or approval as the answer.",
    related: ["general-missing-answer", "roles-why-denied"],
    source: "lib/help/assistant.ts ask(); generated flag on the response",
  },
];

/** Fast lookup by id, for related-article resolution. */
export const HELP_BY_ID = new Map(HELP_ARTICLES.map((a) => [a.id, a]));
