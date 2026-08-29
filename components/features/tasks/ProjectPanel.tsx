"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Avatar } from "@/components/ui/Avatar";
import { Icon } from "@/components/ui/Icons";
import {
  Button,
  Chip,
  InlineError,
  Meter,
  Panel,
  PanelHead,
} from "@/components/ui/Primitives";
import { useAction } from "@/lib/hooks/useRepository";
import { useViewerId } from "@/lib/hooks/usePermissions";
import { useMyDutyMode } from "@/lib/hooks/useDutyMode";
import { isProjectContainer } from "@/lib/rules/tasks/completion";
import {
  coverageSummary,
  requirementCoverage,
} from "@/lib/rules/tasks/requirementCoverage";
import { nextAction, statusMeta } from "./statusMeta";
import {
  asksForTimeAdjustment,
  removalRefusal,
  requirementChangeSummary,
  withRequirementEdited,
  withRequirementRemoved,
  withRequirementsAdded,
  type RequirementEdit,
} from "@/lib/rules/tasks/requirementEdits";
import { RequirementEtPrompt } from "./RequirementEtPrompt";
import { applyEtAdjustment } from "@/lib/rules/tasks/etAdjustment";
import {
  buildChangeSummary,
  changeEventType,
  changePayload,
} from "@/lib/rules/tasks/taskChangeLog";
import type { TaskView } from "@/lib/repositories";
import type { TaskEventType } from "@/lib/domain";

/**
 * A task that has been broken down, and the requirements that decide when it is
 * done.
 *
 * Two states in one panel because they are the same object at two moments: a
 * task with requirements and nobody delegated to, and the project it becomes
 * once work is split out. Making them separate components would mean the moment
 * of conversion swapped one panel for another, which reads as the task having
 * been replaced — and the whole point of the model is that it is not.
 *
 * Requirements are rendered from `view.completion`, which the repository
 * derives. Nothing here recomputes satisfaction: a panel that decided for
 * itself whether three of five were done would eventually disagree with the
 * gate that refuses the submission.
 */
/**
 * Whether this panel is showing the footer that carries the submit button.
 *
 * Exported because `NextActionCard` drops its generic "Go" link when this
 * panel is carrying the same move, and a suppression that guesses is how the
 * card ended up rendering "Your move" above nothing — see
 * `assignmentAcceptance.test.ts`. It reads this rather than restating it, so
 * the two cannot drift: if the footer is not on screen, the link stays.
 */
export function requirementsFooterVisible(
  view: TaskView,
  viewerId: string | null,
): boolean {
  const isOwner = view.task.createdById === viewerId;
  const isAssignee = view.assignments.some((a) => a.employeeId === viewerId);
  return view.completion.total > 0 && (isOwner || isAssignee);
}

export function ProjectPanel({
  view,
  subtasks,
  onChange,
}: {
  view: TaskView;
  subtasks: TaskView[];
  onChange: () => void;
}) {
  const me = useViewerId();
  /* The submit action is offered here now, so this panel has to know whether
     submitting IS the move. Asking `nextAction` — the same function, with the
     same duty mode the action card passes — rather than testing the status
     directly: being away withdraws your move, and a status test would offer a
     button the card had already taken away. */
  const dutyMode = useMyDutyMode();
  const router = useRouter();
  const [drafting, setDrafting] = useState(false);
  const [draft, setDraft] = useState("");

  const c = view.completion;
  const move = nextAction(view, me ?? "", dutyMode);
  const submitHref =
    move.href === `/tasks/${view.task.id}/submission` ? move.href : null;
  /* Assigned versus nobody's — a different question from the meter's
     satisfied-versus-not, and the one an owner asks while breaking work down. */
  const coverage = requirementCoverage(c.requirements);
  const isOwner = view.task.createdById === me;
  const isAssignee = view.assignments.some((a) => a.employeeId === me);
  /* The same pair the repository checks. Rendering a control this test fails
     would offer something the server refuses — the refusal is still the real
     gate, but an offer that cannot be taken is its own defect. */
  const mayDelegate = isOwner || isAssignee;
  /* A subtask may hold its own requirements but may not be broken down again —
     depth of one, enforced by `subtaskRefusal`. Offering the button here would
     be an offer the repository refuses. */
  const isSubtask = !!view.task.parentTaskId;

  const [addRequirements, reqState] = useAction((r) =>
    r.addRequirements(
      view.task.id,
      draft.split("\n").map((x) => x.trim()).filter(Boolean),
    ),
  );

  /**
   * Managing the list after the task exists.
   *
   * The composer above only ever appeared on a task with NO requirements —
   * `addRequirements` is documented as "add to a task that has none yet" — so
   * once five were written there was no way to add a sixth, correct a typo in
   * the third, or drop the fourth. Everything below is that gap.
   *
   * The texts are read in display order and sent back as a whole list, because
   * that is how the engine stores them: `edit-details` replaces the array, and
   * there is no per-item route to address one by.
   */
  const texts = c.requirements.map((r) => r.requirement.text);
  /* How many subtasks claim each requirement, in order. `removalRefusal` reads
     this to decide whether a removal would move a claim — see the note there:
     a requirement's id IS its index. */
  const claimCounts = c.requirements.map((r) => r.claimants.length);

  /**
   * Who is offered Edit and Remove — the ASSIGNER of record, not `mayDelegate`.
   *
   * `edit-details` refuses anybody but `task.assignedBy` once the task has left
   * draft: "This task has already started — only the sender who assigned it can
   * edit it now." `mayDelegate` is `isOwner || isAssignee`, and both halves are
   * wrong for this. An assignee who did not assign the task would be handed a
   * Remove button that always 403s. And `createdById` is not the assigner
   * either: `lib/legacy/tasks.ts` maps it as `createdBy ?? assignedBy` — whoever
   * TYPED the task in — while `assigner` is `assignedBy ?? createdBy`. They
   * differ on a SELF task, where the engine deliberately makes the assigner the
   * assignee's own manager.
   *
   * So this reads `view.assigner`, which is that field. It is stricter than the
   * engine before the task leaves draft, where any CEO or TL may also edit — a
   * capability withheld rather than a control that breaks, which is the safer
   * side to be wrong on.
   */
  const mayEditRequirements = !!me && view.assigner?.id === me;
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const [adding, setAdding] = useState(false);
  const [addDraft, setAddDraft] = useState("");
  /* A change decided but not yet written, waiting on the time question. Holding
     it here rather than writing first is what makes the pair one write. */
  const [pendingEdit, setPendingEdit] = useState<RequirementEdit | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);

  const [saveRequirements, saveState] = useAction(
    (
      r,
      input: {
        texts: string[];
        etSecs?: number;
        reason?: string;
        changeLog?: {
          summary: string;
          eventType: TaskEventType;
          payload?: Record<string, unknown>;
        };
      },
    ) =>
      r.setRequirements(
        view.task.id,
        input.texts,
        input.etSecs
          ? { secs: input.etSecs, reason: input.reason }
          : undefined,
        input.changeLog,
      ),
  );

  /** The estimate the prompt adjusts — the window actually in effect. */
  const currentEtSecs =
    view.task.deadline.currentWindowSecs ??
    view.task.estimatedEffortSecs ??
    0;

  /* A rewording changes no work, so it writes straight through. Adding and
     removing go to the prompt first — see `asksForTimeAdjustment`. */
  async function commit(edit: RequirementEdit, et?: { secs: number }) {
    setRowError(null);
    /* The one sentence that reaches the History tab, the Task Chat and the
       notification — built here from the change and the estimate before/after,
       so all three tell the same story. The ET figures are this client's, which
       is why the preview and the log agree. */
    const etBefore = currentEtSecs;
    const etAfter = applyEtAdjustment(etBefore, et && et.secs < 0 ? "subtract" : "add", Math.abs(et?.secs ?? 0));
    const summaryInput = {
      kind: edit.kind,
      subject: edit.subject,
      before: edit.before,
      etBeforeSecs: etBefore,
      etAfterSecs: etAfter,
    };
    const changeLog = {
      summary: buildChangeSummary(summaryInput),
      eventType: changeEventType(edit.kind),
      payload: changePayload(summaryInput),
    };
    const r = await saveRequirements({
      texts: edit.texts,
      etSecs: et?.secs,
      reason: requirementChangeSummary(edit),
      changeLog,
    });
    if (r.ok) {
      setPendingEdit(null);
      setEditingIndex(null);
      setAdding(false);
      setAddDraft("");
      onChange();
    } else {
      setRowError(r.message);
      /* The prompt stays open on a refusal, holding the figure that was typed —
         closing it would make somebody enter it again to find out whether the
         second attempt failed for the same reason. */
      if (!et) setPendingEdit(null);
    }
    return r;
  }

  function begin(edit: RequirementEdit | null) {
    if (!edit) return;
    if (asksForTimeAdjustment(edit.kind)) setPendingEdit(edit);
    else void commit(edit);
  }

  /* Whether there is anything below this task at all — the same predicate
     `TaskDetail` uses to decide the task has no timer and no deadline of its
     own, from the shared module so the two cannot answer differently. A panel
     that listed subtasks beside a running timer would be showing a container
     and a piece of work at once. */
  const hasSubtasks = isProjectContainer({
    isProject: c.isProject,
    loadedSubtasks: subtasks.length,
  });

  /* Nothing to show, and nothing offered: a task with no requirements that
     nobody may break down is an ordinary task and should look like one. */
  if (c.total === 0 && !hasSubtasks && !mayDelegate) return null;

  return (
    <>
      <Panel padded={false} label="Completion requirements">
        <div className="flex flex-wrap items-center gap-3 border-b border-hairline px-5 py-3">
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-medium text-ink">
              {c.isProject && !isSubtask ? "Project" : "Completion requirements"}
            </h2>
            <p className="mt-0.5 text-[11px] text-ink-faint">
              {c.total === 0
                ? "What has to be true before this is done."
                : c.isProject
                  ? "Execution is split across subtasks. Each one satisfies a requirement here."
                  : "This task is done when every requirement is satisfied."}
            </p>
          </div>
          {c.total > 0 && (
            <span className="shrink-0 text-right">
              <span
                data-figure
                className="text-[22px] leading-none tracking-[-0.025em] text-ink"
              >
                {c.satisfiedCount}/{c.total}
              </span>
              <span className="mt-0.5 block text-[11px] text-ink-faint">
                satisfied
              </span>
            </span>
          )}
        </div>

        {c.total > 0 && (
          <div className="px-5 pt-3">
            <Meter
              value={(c.satisfiedCount / c.total) * 100}
              announce={c.satisfiedCount}
              label={`${c.satisfiedCount} of ${c.total} requirements satisfied`}
              tone={c.canComplete ? undefined : "risk"}
            />
            {/**
             * **How much of this is somebody's, and how much is nobody's.**
             *
             * The meter above counts SATISFIED, which is a different question
             * and a slower-moving one: work can be fully handed out and the
             * meter still read zero. An owner mid-breakdown needs to know what
             * is left to delegate, and reading that off the rows one at a time
             * is the count people get wrong.
             *
             * Shown only once something has been delegated. On a plain task
             * with acceptance criteria and no subtasks, "none of the 4 is
             * assigned to a subtask" would be noise about a breakdown nobody
             * started.
             */}
            {coverage.assigned.length > 0 && (
              <p className="mt-2 text-[11px] text-ink-muted">
                {coverageSummary(coverage)}
              </p>
            )}
          </div>
        )}

        {c.total === 0 ? (
          <div className="px-5 py-4">
            {!drafting ? (
              <>
                <p className="max-w-[62ch] text-sm leading-relaxed text-ink-muted">
                  {isSubtask
                    ? "You can add your own completion requirements here. They are yours to track — the parent requirement this satisfies is shown above and closes when this task is approved."
                    : "This task has no completion requirements yet. Adding them is what lets you break the work down — a subtask has to say which requirement it satisfies."}
                </p>
                <div className="mt-3">
                  <Button size="sm" onClick={() => setDrafting(true)}>
                    <Icon.plus className="h-3.5 w-3.5" />
                    Add completion requirements
                  </Button>
                </div>
              </>
            ) : (
              <>
                {reqState.error && (
                  <div className="mb-2">
                    <InlineError compact message={reqState.error} />
                  </div>
                )}
                <label className="block text-xs text-ink-faint">
                  One per line
                </label>
                <textarea
                  rows={4}
                  autoFocus
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder={"Meeting system completed\nTask module completed\nGoal tracking completed"}
                  className="mt-1.5 w-full rounded-inset bg-[var(--surface-raised)] px-3.5 py-2.5 text-sm text-ink placeholder:text-ink-faint shadow-[inset_0_0_0_1px_var(--color-hairline)] focus:shadow-[inset_0_0_0_1.5px_var(--color-ink)] focus:outline-none"
                />
                <div className="mt-2 flex items-center gap-2">
                  <Button
                    size="sm"
                    tone="primary"
                    disabled={!draft.trim() || reqState.isPending}
                    onClick={async () => {
                      const r = await addRequirements();
                      if (r.ok) {
                        setDraft("");
                        setDrafting(false);
                        onChange();
                      }
                    }}
                  >
                    {reqState.isPending ? "Adding…" : "Add"}
                  </Button>
                  <Button
                    size="sm"
                    tone="ghost"
                    onClick={() => setDrafting(false)}
                  >
                    Cancel
                  </Button>
                </div>
              </>
            )}
          </div>
        ) : (
          <ul className="mt-3 divide-y divide-hairline">
            {c.requirements.map((r, i) => (
              <li key={r.requirement.id} className="group/req px-5 py-2.5">
                <div className="flex items-start gap-3">
                  {/* A DELEGATED requirement is a status, not a control.
                      It used to render the same circular checkbox as a direct
                      one — disabled, and refused by the repository, but
                      identical in shape, position and weight, so it read as
                      something the project owner could click. Handing an area
                      of work to somebody transfers the authority to say it is
                      done; the owner keeps oversight and loses the tick. So
                      there is no button here at all, and nothing to be disabled
                      about. */}
                  {r.ownership === "delegated" ? (
                    <span
                      aria-hidden="true"
                      title="Delegated — satisfied when its subtasks complete."
                      className={`mt-px grid h-5 w-5 shrink-0 place-items-center rounded-full ${
                        r.isSatisfied
                          ? "bg-[color-mix(in_srgb,var(--state-positive)_28%,transparent)] text-[var(--state-positive-ink)]"
                          : "bg-[var(--surface-sunken)] text-ink-faint"
                      }`}
                    >
                      {r.isSatisfied ? (
                        <Icon.check className="h-3 w-3" />
                      ) : (
                        <Icon.team className="h-3 w-3" />
                      )}
                    </span>
                  ) : (
                    /* READ-ONLY. Acceptance criteria are the reviewer's
                       reference for rework, not a checklist the submitter ticks
                       to unlock submission — so there is no tick here, and a
                       criterion never blocks a submission. The reviewer decides
                       which are met, in `ReviewPanel`. */
                    <span
                      aria-hidden="true"
                      title={
                        r.isSatisfied
                          ? "Met"
                          : "Acceptance criterion — the reviewer decides if it is met."
                      }
                      className={`mt-px grid h-5 w-5 shrink-0 place-items-center rounded-full ${
                        r.isSatisfied
                          ? "bg-[color-mix(in_srgb,var(--state-positive)_28%,transparent)] text-[var(--state-positive-ink)]"
                          : "bg-[var(--surface-sunken)] text-ink-faint"
                      }`}
                    >
                      {r.isSatisfied && <Icon.check className="h-3 w-3" />}
                    </span>
                  )}

                  <div className="min-w-0 flex-1">
                    {editingIndex === i ? (
                      /* Editing in place, because the requirement being changed
                         is the one to read while changing it. A dialog would
                         put the text somewhere else and ask people to remember
                         it. */
                      <div className="flex flex-wrap items-center gap-2">
                        <input
                          autoFocus
                          value={editDraft}
                          onChange={(e) => setEditDraft(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Escape") setEditingIndex(null);
                            if (e.key === "Enter") {
                              e.preventDefault();
                              begin(
                                withRequirementEdited(texts, i, editDraft),
                              );
                              setEditingIndex(null);
                            }
                          }}
                          className="min-w-0 flex-1 rounded-inset bg-[var(--surface-raised)] px-3 py-1.5 text-sm text-ink shadow-[inset_0_0_0_1px_var(--color-hairline)] focus:shadow-[inset_0_0_0_1.5px_var(--color-ink)] focus:outline-none"
                        />
                        <Button
                          size="sm"
                          tone="primary"
                          disabled={saveState.isPending}
                          onClick={() => {
                            begin(withRequirementEdited(texts, i, editDraft));
                            setEditingIndex(null);
                          }}
                        >
                          Save
                        </Button>
                        <Button
                          size="sm"
                          tone="ghost"
                          onClick={() => setEditingIndex(null)}
                        >
                          Cancel
                        </Button>
                      </div>
                    ) : (
                      <p
                        className={`text-sm ${r.isSatisfied ? "text-ink-muted line-through decoration-hairline" : "text-ink"}`}
                      >
                        {r.requirement.text}
                      </p>
                    )}

                    {r.ownership === "delegated" ? (
                      <div className="mt-1">
                        <p className="text-[11px] text-ink-faint">
                          Delegated —{" "}
                          <span data-figure>
                            {r.completedClaimants.length}/{r.claimants.length}
                          </span>{" "}
                          complete. Yours to track, not to tick.
                        </p>
                        <ul className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
                          {r.claimants.map((t) => {
                            const done = t.status === "completed";
                            return (
                              <li key={t.id}>
                                <Link
                                  href={`/tasks/${t.id}`}
                                  className="inline-flex items-center gap-1.5 text-[11px] text-ink-muted underline decoration-hairline underline-offset-2 hover:text-ink"
                                >
                                  <span
                                    aria-hidden="true"
                                    className={`h-1.5 w-1.5 rounded-full ${
                                      done
                                        ? "bg-[var(--state-positive)]"
                                        : "bg-[var(--control-active)]"
                                    }`}
                                  />
                                  {t.title}
                                </Link>
                              </li>
                            );
                          })}
                        </ul>
                      </div>
                    ) : r.satisfiedDirectly ? (
                      <p className="mt-1 text-[11px] text-ink-faint">
                        Done directly
                      </p>
                    ) : coverage.assigned.length > 0 ? (
                      /* **Pending, said as such — but only once the work has
                         started being broken down.**
                         With siblings already delegated, "checked by the
                         reviewer" understates this: the reader is looking at
                         the gap in their own breakdown, and the row carried
                         nothing to distinguish it from the delegated ones
                         except the absence of a note. On a task with no
                         subtasks at all, the branch below is still right —
                         there is no breakdown for it to be missing from. */
                      <p className="mt-1 text-[11px] text-[var(--state-rework-ink)]">
                        Pending — no subtask has taken this yet. Break one out,
                        or leave it for the reviewer.
                      </p>
                    ) : (
                      <p className="mt-1 text-[11px] text-ink-faint">
                        Checked by the reviewer — or break out a subtask for it.
                      </p>
                    )}
                  </div>

                  {/* Edit and remove, on the row they act on.
                      Offered only to the pair the repository accepts — the
                      person who raised the task or the person carrying it — for
                      the reason stated above `mayDelegate`: a control the
                      server will refuse is its own defect.
                      A DELEGATED requirement is not editable here: subtasks have
                      been handed out against its text, and rewriting it would
                      change what they were accepted to satisfy. */}
                  {mayDelegate &&
                    r.ownership !== "delegated" &&
                    editingIndex !== i && (
                      <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity duration-[140ms] group-hover/req:opacity-100 focus-within:opacity-100 deck:opacity-0">
                        <button
                          type="button"
                          aria-label={`Edit requirement: ${r.requirement.text}`}
                          disabled={saveState.isPending}
                          onClick={() => {
                            setEditDraft(r.requirement.text);
                            setEditingIndex(i);
                          }}
                          className="grid h-7 w-7 place-items-center rounded-full text-ink-faint transition-colors duration-[140ms] hover:bg-[var(--control)] hover:text-ink disabled:opacity-40"
                        >
                          <Icon.rename className="h-3.5 w-3.5" />
                        </button>
                        {/* Shown greyed with the reason rather than hidden: a
                            missing control reads as a fault where a stated rule
                            does not — the same call the message menu makes. */}
                        <button
                          type="button"
                          aria-label={`Remove requirement: ${r.requirement.text}`}
                          title={removalRefusal(claimCounts, i) ?? undefined}
                          disabled={
                            saveState.isPending ||
                            removalRefusal(claimCounts, i) !== null
                          }
                          onClick={() => {
                            const refusal = removalRefusal(claimCounts, i);
                            if (refusal) return setRowError(refusal);
                            begin(withRequirementRemoved(texts, i));
                          }}
                          className="grid h-7 w-7 place-items-center rounded-full text-ink-faint transition-colors duration-[140ms] hover:bg-[var(--control)] hover:text-[var(--state-overdue-ink)] disabled:opacity-40"
                        >
                          <Icon.close className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    )}
                </div>
              </li>
            ))}
          </ul>
        )}

        {/* Adding to a list that already has some. The composer above only ever
            appeared on a task with none, so this is the path that was missing:
            five requirements and no way to write a sixth. */}
        {c.total > 0 && mayEditRequirements && (
          <div className="border-t border-hairline px-5 py-3">
            {rowError && (
              <div className="mb-2">
                <InlineError compact message={rowError} />
              </div>
            )}
            {adding ? (
              <div className="flex flex-wrap items-center gap-2">
                <input
                  autoFocus
                  value={addDraft}
                  placeholder="What else has to be true before this is done?"
                  onChange={(e) => setAddDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") setAdding(false);
                    if (e.key === "Enter") {
                      e.preventDefault();
                      begin(withRequirementsAdded(texts, [addDraft]));
                    }
                  }}
                  className="min-w-0 flex-1 rounded-inset bg-[var(--surface-raised)] px-3 py-1.5 text-sm text-ink placeholder:text-ink-faint shadow-[inset_0_0_0_1px_var(--color-hairline)] focus:shadow-[inset_0_0_0_1.5px_var(--color-ink)] focus:outline-none"
                />
                <Button
                  size="sm"
                  tone="primary"
                  disabled={!addDraft.trim() || saveState.isPending}
                  onClick={() => begin(withRequirementsAdded(texts, [addDraft]))}
                >
                  Add
                </Button>
                <Button size="sm" tone="ghost" onClick={() => setAdding(false)}>
                  Cancel
                </Button>
              </div>
            ) : (
              <Button size="sm" onClick={() => setAdding(true)}>
                <Icon.plus className="h-3.5 w-3.5" />
                Add a requirement
              </Button>
            )}
          </div>
        )}

        {/* The time question, asked once per add or remove — never for a
            rewording, which changes no work. */}
        {pendingEdit && (
          <RequirementEtPrompt
            currentSecs={currentEtSecs}
            summary={requirementChangeSummary(pendingEdit)}
            busy={saveState.isPending}
            error={rowError}
            onCancel={() => void commit(pendingEdit)}
            onSave={({ direction, secs }) =>
              void commit(pendingEdit, {
                secs: direction === "add" ? secs : -secs,
              })
            }
          />
        )}

        {requirementsFooterVisible(view, me) && (
          <div className="flex flex-wrap items-center gap-2 border-t border-hairline px-5 py-3">
            {!isSubtask && (
              /* The full task form, not a cut-down dialog. A subtask needs
                 every field a task needs — acceptance criteria, attachments,
                 department scoping, the budget model derived from who it is
                 for — and the dialog that used to open here asked for four of
                 them. The old app made the same call: one `CreateTaskModal`,
                 opened with a `parentTask`. */
              <Button
                size="sm"
                onClick={() =>
                  router.push(
                    `/tasks/new?parent=${encodeURIComponent(view.task.id)}`,
                  )
                }
              >
                <Icon.plus className="h-3.5 w-3.5" />
                {c.isProject ? "Add a subtask" : "Break this down into subtasks"}
              </Button>
            )}
            {!c.canComplete && (
              <span className="text-[11px] text-ink-faint">
                {c.total - c.satisfiedCount} requirement
                {c.total - c.satisfiedCount === 1 ? "" : "s"} outstanding — this
                cannot be submitted yet.
              </span>
            )}
            {/**
             * **The move itself, beside the requirements it depends on.**
             *
             * This was the action card’s generic “Go”, a card lower, under
             * the eyebrow “Your move · Submit when ready”. The reason you may
             * not submit is printed here, in this footer; the control that
             * submits was somewhere else. Now they are one row.
             *
             * **Not gated on `canComplete`**, which is the mistake the first
             * attempt made. This link goes to the submission surface, and that
             * surface carries two moves: the daily report for a day’s work on
             * an unfinished task, and the submission itself. Outstanding
             * requirements refuse the second, never the first — so a task at
             * 0/4 still needs this link, and hiding it stranded the report.
             * The sentence beside it already says which of the two is refused.
             *
             * `submitHref` is null unless submitting is genuinely the move, so
             * this never offers a write the engine would refuse. The card drops
             * its own link whenever this one renders — see
             * `requirementsFooterVisible` above.
             */}
            {submitHref && (
              <Button tone="primary" size="sm" className="ml-auto">
                <Link href={submitHref}>Submit task</Link>
              </Button>
            )}
          </div>
        )}
      </Panel>

      {hasSubtasks && (
        <Panel padded={false} label="Subtasks" className="mt-4">
          <PanelHead
            title="Subtasks"
            /* The count is stated because this list is the ONLY place a
               subtask surfaces on the project, and a section that silently
               renders nothing is indistinguishable from one that failed. */
            aside={`${subtasks.length} broken out`}
            className="mb-0 px-5 pt-4 pb-3"
          />
          {subtasks.length === 0 && (
            /* Reachable when the task's own read found children and this
               page's fetch has not returned them — a failed or in-flight
               `getSubtasks`. Saying so beats an empty panel that reads as
               "there are none". */
            <p className="px-5 pb-4 text-sm text-ink-faint">
              This task has been broken down, but its subtasks could not be
              loaded. Reload the page to try again.
            </p>
          )}
          <ul className="divide-y divide-hairline">
            {subtasks.map((s) => {
              const meta = statusMeta(s);
              const claims = s.task.satisfiesRequirementIds
                .map(
                  (id) =>
                    c.requirements.find((r) => r.requirement.id === id)
                      ?.requirement.text,
                )
                .filter(Boolean);
              return (
                <li key={s.task.id}>
                  <Link
                    href={`/tasks/${s.task.id}`}
                    className="flex items-start gap-3 px-5 py-3 transition-colors hover:bg-[var(--row-hover)]"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm text-ink">
                        {s.task.title}
                      </span>
                      {/* What this child is answerable for — or that it is
                          answerable for nothing, which is a real state on
                          anything broken out before the claim was recorded
                          and must not read as a rendering failure. */}
                      <span className="mt-1 block truncate text-[11px] text-ink-faint">
                        {claims.length > 0
                          ? `Satisfies ${claims.join(" · ")}`
                          : "Satisfies no requirement on this task"}
                      </span>
                    </span>
                    {s.assignees[0] && (
                      <Avatar
                        initials={s.assignees[0].initials}
                        hue={s.assignees[0].hue}
                        src={s.assignees[0].profilePictureUrl}
                        name={s.assignees[0].displayName}
                        size="sm"
                      />
                    )}
                    <Chip tone={meta.tone}>{meta.label}</Chip>
                  </Link>
                </li>
              );
            })}
          </ul>
        </Panel>
      )}

    </>
  );
}
