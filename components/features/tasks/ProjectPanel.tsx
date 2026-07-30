"use client";

import Link from "next/link";
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
import { statusMeta } from "./statusMeta";
import { NewSubtaskDialog } from "./NewSubtaskDialog";
import type { TaskView } from "@/lib/repositories";

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
  const [adding, setAdding] = useState(false);
  const [drafting, setDrafting] = useState(false);
  const [draft, setDraft] = useState("");

  const c = view.completion;
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
  const [setSatisfied, satState] = useAction(
    (r, requirementId: string, satisfied: boolean) =>
      r.setRequirementSatisfied(view.task.id, requirementId, satisfied),
  );

  /* Nothing to show, and nothing offered: a task with no requirements that
     nobody may break down is an ordinary task and should look like one. */
  if (c.total === 0 && !c.isProject && !mayDelegate) return null;

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
          </div>
        )}

        {satState.error && (
          <div className="px-5 pt-3">
            <InlineError compact message={satState.error} />
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
            {c.requirements.map((r) => (
              <li key={r.requirement.id} className="px-5 py-2.5">
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
                    <button
                      type="button"
                      aria-pressed={r.isSatisfied}
                      disabled={!mayDelegate || satState.isPending}
                      title={
                        !mayDelegate
                          ? "Only the owner or the person carrying this task can tick it off."
                          : r.isSatisfied
                            ? "Mark as not done"
                            : "Mark as done"
                      }
                      onClick={async () => {
                        const res = await setSatisfied(
                          r.requirement.id,
                          !r.satisfiedDirectly,
                        );
                        if (res.ok) onChange();
                      }}
                      className={`mt-px grid h-5 w-5 shrink-0 place-items-center rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-45 ${
                        r.isSatisfied
                          ? "bg-ink text-[var(--body-bg)]"
                          : "text-transparent shadow-[inset_0_0_0_1.5px_var(--color-hairline)] hover:shadow-[inset_0_0_0_1.5px_var(--color-ink)]"
                      }`}
                    >
                      <Icon.check className="h-3 w-3" />
                    </button>
                  )}

                  <div className="min-w-0 flex-1">
                    <p
                      className={`text-sm ${r.isSatisfied ? "text-ink-muted line-through decoration-hairline" : "text-ink"}`}
                    >
                      {r.requirement.text}
                    </p>

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
                    ) : (
                      <p className="mt-1 text-[11px] text-ink-faint">
                        Yours to complete, or break out a subtask for it.
                      </p>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}

        {c.total > 0 && mayDelegate && (
          <div className="flex flex-wrap items-center gap-2 border-t border-hairline px-5 py-3">
            {!isSubtask && (
              <Button size="sm" onClick={() => setAdding(true)}>
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
          </div>
        )}
      </Panel>

      {c.isProject && (
        <Panel padded={false} label="Subtasks" className="mt-4">
          <PanelHead title="Subtasks" className="mb-0 px-5 pt-4 pb-3" />
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
                      {claims.length > 0 && (
                        <span className="mt-1 block truncate text-[11px] text-ink-faint">
                          Satisfies {claims.join(" · ")}
                        </span>
                      )}
                    </span>
                    {s.assignees[0] && (
                      <Avatar
                        initials={s.assignees[0].initials}
                        hue={s.assignees[0].hue}
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

      {adding && (
        <NewSubtaskDialog
          parent={view}
          onClose={() => setAdding(false)}
          onCreated={() => {
            setAdding(false);
            onChange();
          }}
        />
      )}
    </>
  );
}
