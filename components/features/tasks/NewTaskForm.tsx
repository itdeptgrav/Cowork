"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { Icon } from "@/components/ui/Icons";
import { FileUploader } from "@/components/features/attachments/Attachments";
import { AiTextAssistButton } from "@/components/ui/AiTextAssist";
import { DurationField } from "./DurationField";
import { Breadcrumb } from "@/components/ui/Workspace";
import {
  Button,
  Field,
  InlineError,
  Input,
  Panel,
  ProvisionalBadge,
  Select,
  Textarea,
} from "@/components/ui/Primitives";
import { useAction, useQuery, useRepo } from "@/lib/hooks/useRepository";
import { usePermissions, useViewerId } from "@/lib/hooks/usePermissions";
import {
  commitCriterion,
  removeCriterion,
} from "@/lib/rules/tasks/criteria";
import {
  assignmentGate,
  assignmentRelationship,
  upwardApprovers,
} from "@/lib/auth/assignment";
import { RELATIONSHIP_COPY } from "./relationshipCopy";
import { allowsMultipleAssignees } from "@/lib/rules/tasks/assignment";
import { improveText, textSignature } from "@/lib/workspace/ai/textAssist";
import type { TaskType } from "@/lib/domain";

/**
 * Task creation.
 *
 * Grouped and progressively disclosed rather than one flat form: the type
 * chosen first determines which groups are relevant, so a standard task never
 * shows recurrence fields. A self task is a standard task in every respect —
 * same fields, same review route — with one difference: you are already in the
 * assignee list. The brief is explicit that every field in one unstructured
 * form is the wrong shape.
 */

const TYPES: {
  id: TaskType;
  label: string;
  body: string;
  icon: keyof typeof Icon;
}[] = [
  {
    id: "standard",
    label: "Standard",
    body: "Assigned to one or more people.",
    icon: "tasks",
  },
  {
    id: "self_assigned",
    label: "Self-assigned",
    body: "Work you take on. Your manager approves and reviews it.",
    icon: "user",
  },
  {
    id: "recurring",
    label: "Repeating",
    body: "Runs on a cadence. Not scored.",
    icon: "history",
  },
  {
    id: "goal",
    label: "Goal-linked",
    body: "Feeds C2 · Goal Attainment.",
    icon: "score",
  },
  {
    id: "external",
    label: "Third-party",
    body: "Vendor work you coordinate. Not scored.",
    icon: "link",
  },
];

/**
 * The placeholder line of a picker whose options come from a query.
 *
 * An empty `<select>` with a cheerful "Choose an approver" is a dead end: the
 * person reads it as "there is nobody", tries again tomorrow, and never learns
 * that a request failed. The placeholder is the only place in a native select
 * where that can be said.
 */
function optionLabel(
  query: { isLoading: boolean; error: string | null; data: unknown[] | null },
  ready: string,
): string {
  if (query.isLoading) return "Loading…";
  if (query.error) return "Could not be loaded";
  if (!query.data?.length) return "None available";
  return ready;
}

export function NewTaskForm({
  presetProjectId,
  presetParentTaskId,
}: {
  presetProjectId?: string;
  /**
   * Break work out of this task instead of raising a free-standing one.
   *
   * **The same form, deliberately.** A subtask is a task — it negotiates a
   * budget, holds a priority, is submitted and reviewed — so it needs every
   * field a task needs. The dialog that used to do this asked for four of them
   * and the engine filled the rest with defaults nobody chose, which is how a
   * delegated piece of work arrived with no acceptance criteria and no
   * attachments. The old app made the same call for the same reason: one
   * `CreateTaskModal`, opened with a `parentTask` (`page.js:10110`).
   *
   * What the parent adds is one panel — which of its completion requirements
   * this child answers for — and it removes the type picker, because a subtask
   * is a standard task and self-ness follows from assigning it to yourself.
   */
  presetParentTaskId?: string;
}) {
  const me = useViewerId();
  const router = useRouter();
  const params = useSearchParams();
  const initialType = (params.get("type") as TaskType | null) ?? "standard";
  const [type, setType] = useState<TaskType>(
    TYPES.some((t) => t.id === initialType) ? initialType : "standard",
  );
  const [title, setTitle] = useState("");
  /* Chosen but not yet sent — see the create handler for why they cannot go
     up before the task exists. */
  const [stagedFiles, setStagedFiles] = useState<File[]>([]);
  const [uploadFailures, setUploadFailures] = useState<string[]>([]);
  const repo = useRepo();
  const [description, setDescription] = useState("");
  const [requirements, setRequirements] = useState<string[]>([]);
  const [reqDraft, setReqDraft] = useState("");
  /**
   * Which criterion is being edited, and the text as it is being typed.
   *
   * Held here rather than per row so only one can be open at a time — two
   * half-edited criteria is a state nobody can save coherently.
   *
   * `-1` rather than `null` so the common comparison is `i === editingIndex`
   * with no narrowing at every use.
   */
  const [editingIndex, setEditingIndex] = useState(-1);
  const [editDraft, setEditDraft] = useState("");

  function startEdit(index: number) {
    setEditingIndex(index);
    setEditDraft(requirements[index] ?? "");
  }

  function cancelEdit() {
    setEditingIndex(-1);
    setEditDraft("");
  }

  /**
   * Write the edit back, or discard it if it says nothing.
   *
   * An emptied criterion is NOT saved as an empty string — a blank acceptance
   * criterion is a row the reviewer cannot judge and the assignee cannot
   * satisfy. Clearing the text and confirming removes the line, which is what
   * somebody who deleted every character of it meant.
   */
  function commitEdit() {
    if (editingIndex < 0) return;
    const index = editingIndex;
    const draft = editDraft;
    /* Cleared FIRST. `commitEdit` runs from blur as well as from Enter and the
       Save button, so leaving the row open would let the blur fired by closing
       it re-enter this function. */
    cancelEdit();
    setRequirements((c) => commitCriterion(c, index, draft).list);
  }

  function removeRequirement(index: number) {
    /* The list and the editor's position move together — see `removeCriterion`,
       which is where the index-shift rule lives and is tested. */
    setRequirements((c) => removeCriterion(c, index, editingIndex).list);
    setEditingIndex(
      (i) => removeCriterion(requirements, index, i).editingIndex,
    );
  }

  /**
   * The mandatory spelling/grammar gate on Title + Description.
   *
   * `grammarCheckedFor` holds the signature of the title+description pair the
   * check last ran against. "Checked" means the pass ran and its findings
   * were looked at — not that its suggestions were accepted, because a person
   * is always allowed to keep their own wording once they've seen what the
   * assistant would change. Editing either field afterward changes the
   * signature and re-engages the gate. Same pattern as `MailCompose.tsx`'s
   * send gate, sharing `textSignature` from `lib/workspace/ai/textAssist.ts`.
   */
  const [grammarCheckedFor, setGrammarCheckedFor] = useState<string | null>(null);
  const [checkingGrammar, setCheckingGrammar] = useState(false);
  const [grammarError, setGrammarError] = useState<string | null>(null);
  const [grammarSuggestions, setGrammarSuggestions] = useState<{
    title?: string;
    description?: string;
    signature: string;
  } | null>(null);
  const grammarChecked = grammarCheckedFor === textSignature(title, description);

  async function runGrammarCheck() {
    const sig = textSignature(title, description);
    setCheckingGrammar(true);
    setGrammarError(null);
    const [titleRes, descRes] = await Promise.all([
      title.trim()
        ? improveText({ text: title, mode: "grammar", surface: "task-title" })
        : Promise.resolve(null),
      description.trim()
        ? improveText({ text: description, mode: "grammar", surface: "task-description" })
        : Promise.resolve(null),
    ]);
    setCheckingGrammar(false);

    if (titleRes && !titleRes.ok) return setGrammarError(titleRes.message);
    if (descRes && !descRes.ok) return setGrammarError(descRes.message);

    const titleFix =
      titleRes && titleRes.ok && titleRes.text.trim() !== title.trim()
        ? titleRes.text
        : undefined;
    const descriptionFix =
      descRes && descRes.ok && descRes.text.trim() !== description.trim()
        ? descRes.text
        : undefined;

    if (!titleFix && !descriptionFix) {
      // Nothing to flag — the check ran and passed clean.
      setGrammarCheckedFor(sig);
      setGrammarSuggestions(null);
      return;
    }
    setGrammarSuggestions({ title: titleFix, description: descriptionFix, signature: sig });
  }

  const [assignees, setAssignees] = useState<string[]>([]);
  const [projectId, setProjectId] = useState(presetProjectId ?? "");
  const [parentTaskId, setParentTaskId] = useState(presetParentTaskId ?? "");
  /* Which of the parent's completion requirements this child closes. Empty and
     unused on an ordinary task; required on a subtask, and the reason the
     parent is read at all. */
  const [claims, setClaims] = useState<string[]>([]);
  const isSubtask = !!presetParentTaskId;
  const parentView = useQuery(
    (r) =>
      presetParentTaskId
        ? r.getTask(presetParentTaskId)
        : Promise.resolve(null),
    [presetParentTaskId],
  );
  const parent = parentView.data ?? null;
  const [goalId, setGoalId] = useState("");
  const [assigneeSearch, setAssigneeSearch] = useState("");
  const [filterDept, setFilterDept] = useState("");
  const [filterRole, setFilterRole] = useState("");
  const [reportsOnly, setReportsOnly] = useState(false);
  const roles = useQuery((r) => r.listRoles(), []);
  const departments = useQuery((r) => r.listDepartments(), []);
  const myProfile = useQuery((r) => r.getCurrentEmployee(), []);
  const viewer = useQuery((r) => r.getViewer(), []);
  const perms = usePermissions();

  const [fixedDueAt, setFixedDueAt] = useState("2026-08-01T17:00");
  /* The budget as seconds, so it can be any hours:minutes window rather than a
     whole-hour preset. Defaults to four hours. */
  const [budgetSecs, setBudgetSecs] = useState(4 * 3600);
  const [showAdvanced, setShowAdvanced] = useState(false);

  /* Everyone — used to resolve display names, and to add the viewer back to the
     assignable list for a self task (the scoped list below excludes them). */
  const people = useQuery((r) => r.listEmployees(), []);
  /* The people this viewer may actually create work for. Scoped by the
     repository against the same rule `createTask` refuses on, so what is
     offered and what is accepted cannot disagree. */
  const assignable = useQuery((r) => r.listAssignableEmployees(), []);
  /* A self task is assigned to YOU and nobody else — the assignee field shows
     only your own name, with no one else visible or selectable. The scoped list
     deliberately excludes the viewer (a standard task assigns work to OTHERS), so
     for the self case the list is exactly `[you]` — not you plus everyone, which
     would let a "self" task be pointed at someone else. */
  const viewerEmployee = (people.data ?? []).find((p) => p.id === me) ?? null;
  const assignablePeople =
    type === "self_assigned"
      ? viewerEmployee
        ? [viewerEmployee]
        : []
      : (assignable.data ?? []);
  const assignableIds = new Set(assignablePeople.map((p) => p.id));

  /* A selection that is no longer permitted — the profile switcher changed
     identity, or an administrator narrowed a role, while this form was open.
     Submission is blocked before the request rather than after it, because
     being refused by the server is how the reader found out last time. */
  /* Every task needs at least one person — a self task included, where the
     viewer is pre-selected, so the rule is satisfied without them doing
     anything. Legacy's rule (`CreateTaskModal.jsx:681`), stated before
     submitting rather than after. */
  const needsAssignee = assignees.length === 0;

  const forbiddenAssignees = assignees.filter((id) => !assignableIds.has(id));
  const hasForbidden =
    assignable.data !== null && forbiddenAssignees.length > 0;
  const assignScope = perms.scopeFor("task.create");

  /* Which deadline model applies, and why — from the SAME resolver `createTask`
     decides with, so the form cannot predict one thing and the repository do
     another. It used to hold its own copy of the rule, and both copies had the
     same bug: a department boundary outranked a reporting line that spanned it.
     `createTask` remains the authority; this only shows what it will conclude. */
  const hierarchy = viewer.data?.hierarchyIds ?? [];
  const relationshipKnown = assignees.length > 0;
  /* Always the creator's own department: the form no longer offers an override,
     so there is nothing else it could be. */
  const owningDept = myProfile.data?.departmentId ?? null;
  const relationship = assignmentRelationship({
    creatorId: me,
    assigneeIds: assignees,
    hierarchyIds: hierarchy,
    directReportIds: viewer.data?.directReportIds ?? [],
    creatorDepartmentId: owningDept,
    departmentOf: (id) =>
      (people.data ?? []).find((p) => p.id === id)?.departmentId ?? null,
  });
  const crossesDepartment = relationship.crossesDepartment;
  const mode = relationship.deadlineMode;
  const relationCopy = RELATIONSHIP_COPY[relationship.relation];

  /* Which approval this assignment will need, from the same resolver the
     repository routes it with. Shown before anything is saved — legacy created
     the task and let the gate appear afterwards, so the assigner had no idea
     their work would sit waiting until they went looking for it. */
  const gate = perms.ctx
    ? assignmentGate(perms.ctx, assignees, crossesDepartment)
    : "none";
  const upward = perms.ctx ? upwardApprovers(perms.ctx, assignees) : [];
  const upwardNames = upward
    .map((id) => (people.data ?? []).find((p) => p.id === id)?.displayName)
    .filter(Boolean);

  /* Filtering narrows the list; it never drops a chosen assignee, so changing
     a filter cannot silently unselect somebody. The list it narrows is already
     permission-scoped, so no filter combination can surface a person this
     viewer may not assign to. */
  const visiblePeople = assignablePeople.filter((p) => {
    if (assignees.includes(p.id)) return true;
    if (
      assigneeSearch &&
      !p.displayName.toLowerCase().includes(assigneeSearch.toLowerCase())
    )
      return false;
    if (filterDept && p.departmentId !== filterDept) return false;
    if (filterRole && !p.roleIds.includes(filterRole)) return false;
    if (reportsOnly && p.id !== me && !hierarchy.includes(p.id)) return false;
    return true;
  });
  const projects = useQuery((r) => r.listProjects({}).then((p) => p.items), []);
  const goals = useQuery((r) => r.listGoals(), []);
  const tasks = useQuery(
    (r) => r.listTasks({ scope: "all" }).then((p) => p.items),
    [],
  );

  /* A self task keeps its own type. It is standard-SHAPED — same fields — but
     it is NOT a plain standard task assigned to yourself, because you cannot
     negotiate a budget with, set the priority of, or review your own work. The
     engine records it as `self_assigned`, and the backend makes the assignee's
     PRIMARY MANAGER the counterparty (assignor of record): you propose the
     budget, they approve or negotiate, they set priority and review. No approver
     field is shown — the manager is resolved from HR. */
  const multiAllowed = allowsMultipleAssignees(type);
  /* Changing the type to one that holds a single person must not leave a stale
     multi-selection behind — the submit would be refused with a selection the
     reader can still see on screen. Derived rather than stored, so there is no
     effect to forget. */
  const effectiveAssignees = multiAllowed ? assignees : assignees.slice(0, 1);

  const [create, state] = useAction((r) =>
    /* **A subtask goes through `createSubtask`, not `createTask` with a
       parent id.** They are different routes on the engine: `/task/:id/subtask`
       owns the parent linkage, the `subtaskIds` write on the parent, the
       inherited review chain (`rootCreatedByRole`) and the manager-mediation a
       self subtask needs. `createTask` with `parentTaskId` writes the child and
       none of the rest, so the parent never learns it has been broken down. */
    isSubtask
      ? r.createSubtask({
          parentTaskId: parentTaskId,
          title,
          description: description || null,
          assigneeIds: effectiveAssignees,
          satisfiesRequirementIds: claims,
          fixedDueAt:
            mode === "fixed" ? new Date(fixedDueAt).toISOString() : null,
          senderWindowSecs: mode === "timer" ? budgetSecs : null,
          estimatedEffortSecs: mode === "timer" ? budgetSecs : null,
        })
      : r.createTask({
          title,
          description: description || null,
          requirements,
          type,
          assigneeIds: effectiveAssignees,
          /* Not sent. The owning department is the creator's, and `createTask`
             reads that off the acting employee — passing a value from here would
             be this form asserting something it was never told. */
          departmentId: null,
          projectId: projectId || null,
          parentTaskId: parentTaskId || null,
          goalId: goalId || null,
          /* No approver is chosen in the form. For a self task the backend resolves
             the assignee's primary manager from HR and makes them the counterparty
             (budget, priority, review); for every other type this stays null. */
          approverId: null,
          deadlineMode: mode,
          fixedDueAt: mode === "fixed" ? new Date(fixedDueAt).toISOString() : null,
          senderWindowSecs: mode === "timer" ? budgetSecs : null,
          /* Only when a budget was actually entered. This previously sent four
             hours of "estimated effort" on every deadline-based task, taken from a
             control the reader never saw — a number nobody chose, recorded as
             though they had. */
          estimatedEffortSecs: mode === "timer" ? budgetSecs : null,
        }),
  );

  const isMulti = assignees.length > 1;


  return (
    <>
      <Breadcrumb
        items={[
          { label: "Tasks", href: "/tasks?view=tasks" },
          ...(isSubtask && parent
            ? [
                {
                  label: parent.task.title,
                  href: `/tasks/${parent.task.id}`,
                },
              ]
            : []),
          { label: isSubtask ? "New subtask" : "New task" },
        ]}
      />
      <h1 className="mt-2 text-[clamp(1.375rem,2vw,1.75rem)] leading-none font-light tracking-[-0.03em] text-ink">
        {isSubtask ? "Break out a subtask" : "New task"}
      </h1>
      {isSubtask && (
        <p className="mt-1.5 max-w-[64ch] text-sm leading-relaxed text-ink-muted">
          You stay responsible for{" "}
          <span className="text-ink">
            {parent?.task.title ?? "the task above"}
          </span>
          . This delegates one area of it — and it is a task in its own right,
          so it takes the same fields as any other.
        </p>
      )}
      <div className="mb-4" />

      <div className="grid grid-cols-1 items-start gap-4 deck:grid-cols-12">
        <div className="flex flex-col gap-4 deck:col-span-8">
          {/* 1 — type first, because it gates everything below.

              Absent on a subtask: the engine's subtask route creates a standard
              task and reads no type, so a picker here would offer four choices
              that change nothing. Self-ness is not a type on a subtask either —
              it follows from putting yourself in the assignee list, which the
              People panel says in as many words. */}
          {!isSubtask && (
            <Panel>
              <h2 className="text-sm font-medium text-ink">Type</h2>
              <div className="mt-3 grid gap-2 sm:grid-cols-3">
                {TYPES.map((t) => {
                  const Ico = Icon[t.icon];
                  const on = type === t.id;
                  return (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => {
                        setType(t.id);
                        /* A self task pre-selects you; leaving it drops you again,
                           because the standard picker excludes the viewer and a
                           stale self-selection would read as "forbidden". */
                        setAssignees((cur) => {
                          if (t.id === "self_assigned") return me ? [me] : cur;
                          return me ? cur.filter((id) => id !== me) : cur;
                        });
                      }}
                      aria-pressed={on}
                      className={`rounded-inset px-3 py-2.5 text-left transition-colors ${
                        on
                          ? "bg-[var(--control-active)] shadow-[inset_0_0_0_1.5px_var(--color-ink)]"
                          : "bg-[var(--surface-sunken)] hover:bg-[var(--control)]"
                      }`}
                    >
                      <span className="flex items-center gap-1.5 text-sm font-medium text-ink">
                        <Ico />
                        {t.label}
                      </span>
                      <span className="mt-1 block text-[11px] text-ink-faint">
                        {t.body}
                      </span>
                    </button>
                  );
                })}
              </div>
            </Panel>
          )}

          {/* 1b — what this subtask answers for. The contract with the parent,
              above the brief because it is the reason the child exists: a
              subtask that satisfies nothing leaves its parent's requirement
              undelegated, and the parent then cannot tell whether it mattered.
              `subtaskRefusal` refuses the write without one, so the panel is
              required rather than advisory. */}
          {isSubtask && (
            <Panel>
              <h2 className="text-sm font-medium text-ink">
                Which completion requirements does this satisfy?
              </h2>
              <p className="mt-0.5 text-[11px] text-ink-faint">
                At least one. Choose several if this subtask closes more than
                one.
              </p>
              {parentView.isLoading ? (
                <p className="mt-3 text-sm text-ink-faint">
                  Loading the parent task…
                </p>
              ) : !parent ? (
                <p className="mt-3 text-sm text-ink-faint">
                  The parent task could not be read, so its requirements cannot
                  be shown. Reload the page to try again.
                </p>
              ) : parent.completion.requirements.length === 0 ? (
                /* Reachable by URL, not by the button — `ProjectPanel` only
                   offers the breakdown once there are requirements. Saying so
                   beats an empty list that reads as a loading failure. */
                <p className="mt-3 max-w-[62ch] text-sm text-ink-muted">
                  This task has no completion requirements yet, so there is
                  nothing for a subtask to contribute to. Add them on the task
                  first — its Completion requirements panel has the form.
                </p>
              ) : (
                <ul className="mt-3 flex flex-col gap-1">
                  {parent.completion.requirements.map((r) => {
                    const on = claims.includes(r.requirement.id);
                    return (
                      <li key={r.requirement.id}>
                        <button
                          type="button"
                          aria-pressed={on}
                          onClick={() =>
                            setClaims((c) =>
                              c.includes(r.requirement.id)
                                ? c.filter((x) => x !== r.requirement.id)
                                : [...c, r.requirement.id],
                            )
                          }
                          className={`flex w-full items-start gap-3 rounded-inset px-3 py-2.5 text-left transition-colors ${
                            on
                              ? "bg-[var(--control-active)]"
                              : "bg-[var(--surface-sunken)] hover:bg-[var(--control)]"
                          }`}
                        >
                          <span
                            className={`mt-px grid h-5 w-5 shrink-0 place-items-center rounded-full ${
                              on
                                ? "bg-ink text-[var(--body-bg)]"
                                : "text-transparent shadow-[inset_0_0_0_1.5px_var(--color-hairline)]"
                            }`}
                          >
                            <Icon.check className="h-3 w-3" />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block text-sm text-ink">
                              {r.requirement.text}
                            </span>
                            {r.isSatisfied && (
                              <span className="mt-0.5 block text-[11px] text-ink-faint">
                                Already satisfied — choosing it will reopen it
                                until this subtask completes.
                              </span>
                            )}
                            {r.claimants.length > 0 && (
                              <span className="mt-0.5 block text-[11px] text-ink-faint">
                                Also claimed by{" "}
                                {r.claimants.map((c) => c.title).join(", ")}
                              </span>
                            )}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </Panel>
          )}

          {/* 2 — the brief. */}
          <Panel>
            <h2 className="text-sm font-medium text-ink">Brief</h2>
            <Field
              label="Title"
              required
              className="mt-3"
              error={state.errorField === "title" ? state.error : null}
            >
              <div className="relative">
                <Input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="What needs doing"
                  data-help="task-title-field"
                  className="pr-9"
                />
                <div className="absolute top-1/2 right-1.5 -translate-y-1/2">
                  <AiTextAssistButton
                    value={title}
                    onApply={setTitle}
                    fieldLabel="Title"
                    surface="task-title"
                  />
                </div>
              </div>
            </Field>
            {/* No owning-department field. It is derived from the creator in
                the repository and never asked for here: it decides whether the
                work needs two department heads to approve it, so it is not a
                preference, and a field that asks is a field that can be
                answered wrongly. Administrators can still file on another
                department's behalf — that override lives in admin settings,
                which is where filing work you are not part of belongs. */}

            <Field label="Description" className="mt-3">
              <div className="relative">
                <Textarea
                  rows={3}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="pr-9"
                />
                <div className="absolute top-1.5 right-1.5">
                  <AiTextAssistButton
                    value={description}
                    onApply={setDescription}
                    fieldLabel="Description"
                    surface="task-description"
                  />
                </div>
              </div>
            </Field>

            <div className="mt-3">
              <span className="mb-1.5 block text-sm font-medium text-ink">
                Acceptance criteria
              </span>
              {requirements.length > 0 && (
                <ul className="mb-2 space-y-1">
                  {requirements.map((r, i) =>
                    i === editingIndex ? (
                      <li key={i} className="flex items-center gap-2">
                        <Icon.check className="h-3.5 w-3.5 shrink-0 text-ink-faint" />
                        <Input
                          autoFocus
                          value={editDraft}
                          onChange={(e) => setEditDraft(e.target.value)}
                          aria-label={`Edit criterion: ${r}`}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              commitEdit();
                            }
                            if (e.key === "Escape") {
                              e.preventDefault();
                              cancelEdit();
                            }
                          }}
                          /* Saving on blur as well as on Enter. Clicking away
                             from a field you have just typed into reads as
                             "done", and losing the edit there is the same
                             frustration as having no edit at all. Escape is
                             the way to discard, and it runs first because
                             `cancelEdit` closes the row before blur fires. */
                          onBlur={commitEdit}
                        />
                        <Button size="sm" onClick={commitEdit}>
                          Save
                        </Button>
                      </li>
                    ) : (
                      <li
                        key={i}
                        className="group flex items-center gap-2 text-sm text-ink-muted"
                      >
                        <Icon.check className="h-3.5 w-3.5 shrink-0 text-ink-faint" />
                        {/* The text itself opens the editor. A person who
                            wants to change a line reaches for the line, not
                            for a control beside it — and it keeps the row from
                            growing a second icon. */}
                        <button
                          type="button"
                          onClick={() => startEdit(i)}
                          aria-label={`Edit ${r}`}
                          className="min-w-0 flex-1 cursor-text truncate text-left hover:text-ink"
                        >
                          {r}
                        </button>
                        <button
                          type="button"
                          onClick={() => removeRequirement(i)}
                          aria-label={`Remove ${r}`}
                          className="text-ink-faint hover:text-ink"
                        >
                          <Icon.close className="h-3 w-3" />
                        </button>
                      </li>
                    ),
                  )}
                </ul>
              )}
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Input
                    value={reqDraft}
                    onChange={(e) => setReqDraft(e.target.value)}
                    placeholder="Add a criterion"
                    className="pr-9"
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && reqDraft.trim()) {
                        e.preventDefault();
                        setRequirements((c) => [...c, reqDraft.trim()]);
                        setReqDraft("");
                      }
                    }}
                  />
                  <div className="absolute top-1/2 right-1.5 -translate-y-1/2">
                    <AiTextAssistButton
                      value={reqDraft}
                      onApply={setReqDraft}
                      fieldLabel="Acceptance criterion"
                      surface="task-criterion"
                    />
                  </div>
                </div>
                <Button
                  onClick={() => {
                    if (!reqDraft.trim()) return;
                    setRequirements((c) => [...c, reqDraft.trim()]);
                    setReqDraft("");
                  }}
                >
                  Add
                </Button>
              </div>
            </div>

            {/* The mandatory spelling/grammar gate — see `grammarChecked`
                above and its use in the submit button's `disabled`. "Checked"
                means the pass ran and was reviewed, not that its suggestions
                were accepted: a person can always keep their own wording. */}
            {(title.trim() || description.trim()) && (
              <div className="mt-3 rounded-inset bg-[var(--surface-sunken)] px-3 py-2.5">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-xs font-medium text-ink">
                    {grammarChecked
                      ? "✓ Spelling & grammar checked"
                      : "Spelling & grammar check required before creating"}
                  </p>
                  <Button
                    size="sm"
                    tone="secondary"
                    disabled={checkingGrammar}
                    onClick={runGrammarCheck}
                  >
                    {checkingGrammar
                      ? "Checking…"
                      : grammarChecked
                        ? "Re-check"
                        : "Check now"}
                  </Button>
                </div>
                {grammarError && (
                  <p className="mt-1.5 text-[11px] text-[var(--state-overdue-ink)]">
                    {grammarError}
                  </p>
                )}
                {grammarSuggestions && (
                  <div className="mt-2.5 space-y-2 border-t border-hairline pt-2.5">
                    {grammarSuggestions.title && (
                      <div>
                        <p className="mb-1 text-[11px] text-ink-faint">
                          Suggested title
                        </p>
                        <p className="rounded-inset bg-[var(--surface-raised)] p-2 text-sm text-ink">
                          {grammarSuggestions.title}
                        </p>
                      </div>
                    )}
                    {grammarSuggestions.description && (
                      <div>
                        <p className="mb-1 text-[11px] text-ink-faint">
                          Suggested description
                        </p>
                        <p className="max-h-32 overflow-y-auto rounded-inset bg-[var(--surface-raised)] p-2 text-sm whitespace-pre-wrap text-ink">
                          {grammarSuggestions.description}
                        </p>
                      </div>
                    )}
                    <div className="flex flex-wrap justify-end gap-1.5">
                      <Button
                        size="sm"
                        tone="ghost"
                        onClick={() => setGrammarSuggestions(null)}
                      >
                        Keep editing
                      </Button>
                      <Button
                        size="sm"
                        tone="secondary"
                        onClick={() => {
                          setGrammarCheckedFor(grammarSuggestions.signature);
                          setGrammarSuggestions(null);
                        }}
                      >
                        Keep as written
                      </Button>
                      <Button
                        size="sm"
                        tone="primary"
                        onClick={() => {
                          const nextTitle = grammarSuggestions.title ?? title;
                          const nextDescription =
                            grammarSuggestions.description ?? description;
                          setTitle(nextTitle);
                          setDescription(nextDescription);
                          setGrammarCheckedFor(
                            textSignature(nextTitle, nextDescription),
                          );
                          setGrammarSuggestions(null);
                        }}
                      >
                        Apply corrections
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </Panel>

          {/* 3 — people. */}
          <Panel>
            <h2 className="text-sm font-medium text-ink">People</h2>
            <Field
              label={type === "self_assigned" ? "Assignee" : "Assignees"}
              required
              className="mt-3"
              hint={
                type === "self_assigned"
                  ? "A self task is yours alone. Your manager sets the budget, priority and reviews it."
                  : multiAllowed
                    ? isMulti
                      ? undefined
                      : "Choose one or more."
                    : "One person is responsible for this task."
              }
              error={state.errorField === "assigneeIds" ? state.error : null}
            >
              {/* Why this list is the length it is. Without it, somebody
                  whose role reaches only themselves sees a picker with one
                  name in it and reasonably concludes the page is broken. */}
              {assignable.data !== null && assignScope !== "organisation" && (
                <p className="mb-2.5 rounded-inset bg-[var(--surface-sunken)] px-3 py-2 text-[11px] leading-relaxed text-ink-muted">
                  {assignScope === null
                    ? "Your role does not include creating tasks, so there is nobody to assign to."
                    : assignScope === "self"
                      ? "Your role lets you create work for yourself, so you are the only person listed."
                      : assignScope === "direct_reports"
                        ? "You can create work for yourself and your direct reports. Everyone else is left out of this list rather than offered and then refused."
                        : "You can create work for yourself and anyone in your reporting line."}
                </p>
              )}

              {/* Filters, because a chip per employee stops being usable at
                  about thirty people and this has to work at three hundred.
                  They narrow the SAME list rather than replacing it, so the
                  selection survives changing a filter. Hidden when there is
                  nothing to narrow — four filters over one name is furniture. */}
              <div
                className={`mb-2.5 flex-wrap items-center gap-2 ${
                  assignablePeople.length > 1 ? "flex" : "hidden"
                }`}
              >
                <Input
                  data-help="task-assignee-field"
                  aria-label="Search employees"
                  placeholder="Search name"
                  value={assigneeSearch}
                  onChange={(e) => setAssigneeSearch(e.target.value)}
                  className="!w-[190px]"
                />
                <Select
                  aria-label="Filter by department"
                  value={filterDept}
                  onChange={(e) => setFilterDept(e.target.value)}
                  className="!w-[168px]"
                >
                  <option value="">Any department</option>
                  {(departments.data ?? []).map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </Select>
                <Select
                  aria-label="Filter by role"
                  value={filterRole}
                  onChange={(e) => setFilterRole(e.target.value)}
                  className="!w-[168px]"
                >
                  <option value="">Any role</option>
                  {(roles.data ?? []).map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.displayName}
                    </option>
                  ))}
                </Select>
                <button
                  type="button"
                  aria-pressed={reportsOnly}
                  onClick={() => setReportsOnly((v) => !v)}
                  title="Only people in your reporting line — the ones you can assign to without a cross-department approval."
                  className={`rounded-full px-3 py-1.5 text-[11px] font-medium transition-colors ${
                    reportsOnly
                      ? "bg-ink text-[var(--body-bg)]"
                      : "bg-[var(--control)] text-ink-muted hover:bg-[var(--control-hover)] hover:text-ink"
                  }`}
                >
                  My reporting line
                </button>
                {/* Of the people you may assign to — not of the company.
                    Counting against the whole directory would advertise a
                    reach the viewer does not have. */}
                <span className="text-[11px] text-ink-faint">
                  <span data-figure>{visiblePeople.length}</span> of{" "}
                  <span data-figure>{assignablePeople.length}</span>
                </span>
              </div>

              <div className="flex flex-wrap gap-1.5">
                {visiblePeople.map((p) => {
                  const on = assignees.includes(p.id);
                  return (
                    <button
                      key={p.id}
                      type="button"
                      /* Single-select where the type says so: picking somebody
                         REPLACES the current choice rather than adding to it.
                         `allowsMultipleAssignees` is the same predicate
                         `createTask` refuses with, so the control can never
                         build a selection the write rejects. */
                      onClick={() =>
                        setAssignees((c) =>
                          c.includes(p.id)
                            ? c.filter((x) => x !== p.id)
                            : multiAllowed
                              ? [...c, p.id]
                              : [p.id],
                        )
                      }
                      aria-pressed={on}
                      className={`rounded-full px-2.5 py-1 text-sm transition-colors ${
                        on
                          ? "bg-ink text-[var(--body-bg)]"
                          : "bg-[var(--control)] text-ink-muted hover:text-ink"
                      }`}
                    >
                      {p.displayName}
                    </button>
                  );
                })}
              </div>
            </Field>

            {/* The consent this assignment needs. Legacy's model, and the
                reason nobody is hidden from the list above: work may be
                raised for anyone, and the gate — not a refusal — is what
                holds it until the right person agrees. */}
            {gate === "upward" && (
              <p className="mt-2 rounded-inset bg-[color-mix(in_srgb,var(--state-extension)_18%,transparent)] px-3 py-2 text-[11px] leading-relaxed text-[var(--state-extension-ink)]">
                {upwardNames.join(" and ")}{" "}
                {upwardNames.length > 1 ? "sit" : "sits"} above you, so this
                task waits for {upwardNames.length > 1 ? "them" : "them"} to
                accept it before it starts. You can still create it.
              </p>
            )}

            {isMulti && (
              <p className="mt-2 flex flex-wrap items-center gap-2 rounded-inset bg-[var(--surface-sunken)] px-3 py-2 text-[11px] text-ink-faint">
                Only the first assignee is scored on this task.
                <ProvisionalBadge
                  decisionId="O9"
                  label="Multi-assignee attribution"
                />
              </p>
            )}

          </Panel>

          {/* 4 — deadline.
              Not a choice, and so not presented as one. Which model applies is
              decided by the relationship between you and the assignee, and the
              repository decides it again on the way in — a control here could
              only ever disagree with the answer. What the form owes the reader
              is the answer and the reason for it, then the one value that
              model actually needs. */}
          <Panel>
            <h2 className="text-sm font-medium text-ink">Deadline</h2>
              {!relationshipKnown ? (
                <p
                  data-help="task-deadline-mode"
                  className="mt-3 rounded-inset bg-[var(--surface-sunken)] px-3 py-2.5 text-[11px] leading-relaxed text-ink-faint"
                >
                  Choose an assignee first. How this task&rsquo;s deadline works
                  depends on your relationship to them, so Cowork settles it
                  once it knows who the work is for.
                </p>
              ) : (
                <>
                  <div
                    data-help="task-deadline-mode"
                    className={`mt-3 rounded-inset px-3 py-2.5 ${
                      mode === "fixed"
                        ? "bg-[color-mix(in_srgb,var(--state-extension)_18%,transparent)]"
                        : "bg-[var(--surface-sunken)]"
                    }`}
                  >
                    {/* Both lines come from the relationship the resolver
                        returned, so what the form promises here is what
                        `createTask` will actually do. */}
                    <span
                      className={`text-sm font-medium ${
                        mode === "fixed"
                          ? "text-[var(--state-extension-ink)]"
                          : "text-ink"
                      }`}
                    >
                      {relationCopy.label}
                    </span>
                    <span
                      className={`mt-1 block text-[11px] leading-relaxed ${
                        mode === "fixed"
                          ? "text-[var(--state-extension-ink)]"
                          : "text-ink-muted"
                      }`}
                    >
                      {relationCopy.forecast}
                    </span>
                  </div>

                  {mode === "timer" ? (
                    <Field
                      label="Budget"
                      className="mt-3"
                      hint="Hours and minutes the assignee plans inside."
                    >
                      <DurationField
                        secs={budgetSecs}
                        onChange={setBudgetSecs}
                        minSecs={60}
                        aria-label="Budget"
                      />
                    </Field>
                  ) : (
                    <Field label="Due" className="mt-3">
                      <Input
                        type="datetime-local"
                        value={fixedDueAt}
                        onChange={(e) => setFixedDueAt(e.target.value)}
                      />
                    </Field>
                  )}
                </>
              )}
          </Panel>

          {/* 5 — placement, disclosed on demand. */}
          <Panel>
            <button
              type="button"
              onClick={() => setShowAdvanced((v) => !v)}
              className="flex w-full items-center gap-2 text-left"
              aria-expanded={showAdvanced}
            >
              <h2 className="text-sm font-medium text-ink">
                Placement and links
              </h2>
              <span className="ml-auto text-ink-faint">
                {showAdvanced ? <Icon.chevronDown /> : <Icon.chevronRight />}
              </span>
            </button>

            {showAdvanced && (
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <Field label="Project">
                  <Select
                    value={projectId}
                    onChange={(e) => setProjectId(e.target.value)}
                  >
                    <option value="">None</option>
                    {(projects.data ?? []).map((p) => (
                      <option key={p.project.id} value={p.project.id}>
                        {p.project.name}
                      </option>
                    ))}
                  </Select>
                </Field>
                {/* Absent when the parent is already fixed — the page was
                    opened from that task, and a picker that could re-point the
                    subtask at a different parent would leave the requirement
                    claims above pointing at requirements that no longer exist.
                    The parent is named in the breadcrumb instead. */}
                {!isSubtask && (
                  <Field label="Parent task" hint="Makes this a subtask.">
                    <Select
                      value={parentTaskId}
                      onChange={(e) => setParentTaskId(e.target.value)}
                    >
                      <option value="">None</option>
                      {(tasks.data ?? []).slice(0, 20).map((t) => (
                        <option key={t.task.id} value={t.task.id}>
                          {t.task.title}
                        </option>
                      ))}
                    </Select>
                  </Field>
                )}
                {type === "goal" && (
                  <Field label="Goal" required>
                    <Select
                      value={goalId}
                      onChange={(e) => setGoalId(e.target.value)}
                    >
                      <option value="">
                        {optionLabel(goals, "Choose a goal")}
                      </option>
                      {(goals.data ?? []).map((g) => (
                        <option key={g.id} value={g.id}>
                          {g.title}
                        </option>
                      ))}
                    </Select>
                  </Field>
                )}
              </div>
            )}
          </Panel>

          {/* A selection that has stopped being permitted. Named rather than
              counted: "one assignee is no longer allowed" leaves the reader to
              work out which of five it is. */}
          {hasForbidden && (
            <InlineError
              code="permission_denied"
              message={`You can no longer create work for ${forbiddenAssignees
                .map(
                  (id) =>
                    (people.data ?? []).find((p) => p.id === id)?.displayName ??
                    "someone selected",
                )
                .join(", ")}. Remove them to continue.`}
            />
          )}

          {/* The shared uploader in staging mode. Not a task-specific one. */}
          <div className="mt-1">
            <p className="text-[11px] tracking-[0.09em] text-ink-faint uppercase">
              Attachments
            </p>
            <p className="mt-0.5 mb-2 text-[12px] text-ink-faint">
              Optional. Reference material the assignee should work from.
            </p>
            <FileUploader
              entityType="task"
              entityId={null}
              attachments={[]}
              onChange={() => {}}
              staged={stagedFiles}
              onStagedChange={setStagedFiles}
              label="Attach reference files"
            />
          </div>

          {uploadFailures.length > 0 && (
            <InlineError
              message={`The task was created, but these files did not upload: ${uploadFailures.join(", ")}. You can add them on the task.`}
            />
          )}

          {state.error && !state.errorField && (
            <InlineError message={state.error} code={state.errorCode} />
          )}

          {title.trim() && !grammarChecked && (
            <p className="mb-2 text-[11px] text-ink-faint">
              Run the spelling &amp; grammar check on Title/Description before creating this task.
            </p>
          )}

          <div className="flex justify-end gap-2">
            <Button onClick={() => router.back()}>Cancel</Button>
            <Button
              data-help="task-create-submit"
              tone="primary"
              disabled={
                state.isPending ||
                !title.trim() ||
                hasForbidden ||
                needsAssignee ||
                !grammarChecked ||
                /* The claim the repository refuses without. Checked here so the
                   button is honest before the round trip, and there too so the
                   form can never permit what the engine rejects. */
                (isSubtask && claims.length === 0)
              }
              onClick={async () => {
                const r = await create();
                if (!r.ok) return;
                /*
                 * Files go up AFTER the task exists.
                 *
                 * The engine checks permission against the task, so an upload
                 * before there is one has nothing to check and is refused. That
                 * inverts the obvious order — upload then create — but it is the
                 * order the permission model allows, and it means a file can
                 * never be stored against a task that failed to be created.
                 *
                 * A failed upload does NOT fail the task: the task is already
                 * real and discarding it would lose the work. The person is told
                 * which files did not make it and can add them on the task.
                 */
                const failed: string[] = [];
                for (const file of stagedFiles) {
                  const up = await repo.uploadAttachment({
                    file,
                    entityType: "task",
                    entityId: r.data.id,
                  });
                  if (!up.ok) failed.push(file.name);
                }
                if (failed.length) setUploadFailures(failed);
                router.push(`/tasks/${r.data.id}`);
              }}
            >
              {state.isPending
                ? "Creating…"
                : isSubtask
                  ? "Create subtask"
                  : "Create task"}
            </Button>
          </div>
        </div>

        {/* What will happen — the consequences of the current choices. */}
        <div className="deck:col-span-4">
          <Panel>
            <h2 className="text-sm font-medium text-ink">What happens next</h2>
            <ul className="mt-3 space-y-2.5 text-sm text-ink-muted">
              <Consequence>
                {type === "self_assigned"
                  ? "Your manager approves the time budget, sets its priority, and reviews it — you propose, they decide."
                  : "Each assignee receives it at the bottom of their priority list."}
              </Consequence>
              {relationshipKnown && (
                <Consequence>
                  {mode === "timer"
                    ? "No deadline is set yet — the assignee proposes one inside your budget and you decide."
                    : "The deadline is fixed and scored from the date you set."}
                </Consequence>
              )}
              {gate === "cross_department" && (
                <Consequence>
                  Both department heads approve before it reaches anyone. It
                  stays pending until they do.
                </Consequence>
              )}
              {gate === "upward" && (
                <Consequence>
                  It waits for {upwardNames.join(" and ")} to accept before any
                  work starts.
                </Consequence>
              )}
              <Consequence>
                {type === "recurring" || type === "external"
                  ? "This type is not scored, so it will not affect C1."
                  : "On approval this settles one C1 · Task Execution unit worth 1.0 point."}
              </Consequence>
              {projectId && (
                <Consequence>
                  Project progress recalculates immediately.
                </Consequence>
              )}
            </ul>

            {(type === "recurring" || type === "external") && (
              <p className="mt-3 flex flex-wrap items-center gap-2 border-t border-hairline pt-3 text-[11px] text-ink-faint">
                Whether these types should score is unresolved.
                <ProvisionalBadge
                  decisionId="O20"
                  label="Scoring eligibility by type"
                />
              </p>
            )}
          </Panel>
        </div>
      </div>
    </>
  );
}

function Consequence({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2">
      <Icon.chevronRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ink-faint" />
      <span>{children}</span>
    </li>
  );
}
