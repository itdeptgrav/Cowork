"use client";

import { useState } from "react";
import {
  Button,
  EmptyState,
  Field,
  InlineError,
  Input,
  Panel,
  PanelHead,
  SkeletonRows,
  Textarea,
} from "@/components/ui/Primitives";
import { useAction, useQuery } from "@/lib/hooks/useRepository";
import { useViewerId } from "@/lib/hooks/usePermissions";
import { formatDateTime } from "@/lib/utils/format";
import {
  type GoalNode,
  approvalOutcome,
  goalNodeView,
  nodePointsFor,
  remainingPoints,
  reportRefusal,
  submitRefusal,
  submittedLate,
  unspentWarning,
  weightForRemaining,
} from "@/lib/rules/scoring/goalNodes";
import {
  isShared,
  personStep,
  progressFor,
} from "@/lib/rules/scoring/goalPeople";
import { formatBytes } from "@/components/features/attachments/attachmentRules";
import type {
  GoalReportFile,
  GoalStepPerson,
  TaskView,
} from "@/lib/repositories";

/**
 * C2 · the roadmap a goal is delivered through.
 *
 * A goal task is worth a pool of points, agreed when it was created. This is
 * where that pool is spent: a list of steps, each with a deadline and a share,
 * and each paying out only when it is approved having been submitted on or
 * before that deadline.
 *
 * ## What the reader has to be able to see
 *
 * **What is left.** The old Cowork's editor kept a running remainder and
 * refused a step that would overrun it, and that figure is the whole reason the
 * roadmap adds up. It is shown on the panel and again inside the editor, beside
 * the field it constrains.
 *
 * **Why a step cannot be saved.** Every refusal comes from `nodeRefusal`, so
 * the sentence beside the disabled button and the rule that disabled it are the
 * same thing rather than two opinions that drift.
 *
 * Weights are typed, not distributed — owner decision. The old app gave the
 * final step 40% and split the rest equally; that is gone, and nothing here
 * computes a share on anybody's behalf beyond the "use the rest" shortcut.
 */
export function GoalRoadmapPanel({ view }: { view: TaskView }) {
  const taskId = view.task.id;
  const roadmap = useQuery((r) => r.getGoalRoadmap(taskId), [taskId]);
  const [save, saveState] = useAction(
    (
      r,
      activities: {
        id: string;
        heading: string;
        description: string;
        deadline: string | null;
        weightPercent: number;
      }[],
    ) => r.saveGoalRoadmap({ taskId, activities }),
  );

  const [submit, submitState] = useAction((r) => r.submitGoalRoadmap(taskId));
  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  /**
   * **Derived, not copied.**
   *
   * The roadmap is the server's list; holding a second copy here and seeding it
   * from an effect means two versions of the same thing and a `setState` inside
   * a render pass. Every change goes through `persist`, which saves and lets
   * the query re-read — so what is on screen is what was written, always.
   */
  const pool = roadmap.data?.taskMaxPoints ?? 0;
  /* The steps as the repository returns them — with status and report. `list`
     below is the same steps reduced to what the ARITHMETIC needs, which is all
     the rules module should ever see. */
  const raw = roadmap.data?.activities ?? [];

  /**
   * Which side of this the reader is on.
   *
   * The person doing the work hands in reports; the person who assigned it
   * decides them. Both are read from the task rather than from a role, because
   * a manager who is not on this task has no part in it — and the engine
   * refuses them anyway.
   */
  const viewerId = useViewerId();
  const isAssignee = view.assignees.some((a) => a.id === viewerId);
  const isHead =
    !!viewerId &&
    (view.assigner?.id === viewerId || view.owner?.id === viewerId);

  /**
   * A goal several people are carrying.
   *
   * Each of them walks the same roadmap independently — their own report
   * against each step, their own approval, their own points. So the panel has
   * to be about ONE person at a time: the head picks whose work they are
   * looking at, and everybody else is looking at their own.
   *
   * `undefined` when the goal has a single assignee, which switches every read
   * and write back to the flat fields — the behaviour a solo goal has always
   * had, untouched.
   */
  const assigneeIds = view.assignees.map((a) => a.id);
  const shared = isShared(assigneeIds);
  const [viewingId, setViewingId] = useState<string | null>(null);
  const personId = !shared
    ? undefined
    : isHead
      ? /* Defaults to the first assignee rather than to nobody: a head opening
           a shared goal should land on somebody's work, not on a chooser. */
        (viewingId ?? assigneeIds[0])
      : (viewerId ?? undefined);

  const list: GoalNode[] = raw.map((a) => ({
    id: a.id,
    heading: a.heading,
    description: a.description,
    deadline: a.deadline,
    weightPercent: a.weightPercent,
  }));
  const left = remainingPoints({ nodes: list, taskMaxPoints: pool });

  /* Everybody's progress, for the head's summary. Computed from the same rows
     the steps below render, so the summary and the list cannot disagree. */
  const progress = shared
    ? progressFor({
        assigneeIds,
        steps: raw.map((a) => ({
          points: a.points,
          step: {
            status: a.status,
            report: a.report,
            perUserStatus: a.perUserStatus,
          },
        })),
      })
    : [];

  /** Write the whole list, then re-read it. Answers whether the write landed. */
  const persist = async (next: GoalNode[]): Promise<boolean> => {
    const r = await save(next);
    if (r.ok) roadmap.refetch();
    return r.ok;
  };

  const submitted = roadmap.data?.submitted ?? false;
  const cannotSubmit = submitRefusal(list);
  const unspent = unspentWarning({ nodes: list, taskMaxPoints: pool });

  if (roadmap.isLoading) {
    return (
      <Panel>
        <SkeletonRows rows={4} />
      </Panel>
    );
  }

  return (
    <Panel padded={false}>
      <div className="px-4 py-3">
        <PanelHead
          title="Roadmap"
          sub={
            pool > 0
              ? shared
                ? `The steps this goal is delivered through. ${pool} points to share out — each of the ${assigneeIds.length} people on it walks the same steps and earns their own.`
                : `The steps this goal is delivered through. ${pool} points to share out.`
              : "This goal has no points to share out — it was created without a share of the year's goal points."
          }
          aside={
            /* The head builds the roadmap; the assignee delivers it. This was
               ungated, so the person doing the work was offered a control that
               reshapes their own targets. `isHead` is the same test the Edit
               and Remove controls on each step already used. */
            isHead && !adding && editing === null ? (
              <Button loading={saveState.isPending}
                size="sm"
                onClick={() => setAdding(true)}
                disabled={pool <= 0 || saveState.isPending}
              >
                Add a step
              </Button>
            ) : undefined
          }
        />

        {pool > 0 && (
          <p className="mt-1 text-[11px] text-ink-faint">
            <span data-figure className={left > 0 ? "text-ink" : "text-ink-faint"}>
              {left}
            </span>{" "}
            of <span data-figure>{pool}</span> points unspent
          </p>
        )}

        {/**
         * What the goal is and when it is aimed at, as agreed at creation.
         *
         * Shown because the roadmap is built towards it — the steps are how
         * this date gets met. It gates nothing: a step's own deadline is what
         * earns or forfeits its points, and this is deliberately not a second
         * date the assignee could be measured against.
         */}
        {(roadmap.data?.goalStatement || roadmap.data?.targetDate) && (
          <div className="mt-2 rounded-inset bg-[var(--surface-sunken)] px-3 py-2">
            {roadmap.data.goalStatement && (
              <p className="text-[11px] leading-relaxed text-ink-muted">
                {roadmap.data.goalStatement}
              </p>
            )}
            {roadmap.data.targetDate && (
              <p className="mt-0.5 text-[11px] text-ink-faint">
                Aimed at {formatDateTime(roadmap.data.targetDate)}
              </p>
            )}
          </div>
        )}
        {/**
         * Whose work the head is looking at.
         *
         * Only for the head — everybody else is looking at their own and has
         * nothing to choose. A dot marks anyone waiting on a decision, so the
         * head can see there is something to do without opening each person in
         * turn.
         */}
        {shared && isHead && (
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {view.assignees.map((a) => {
              const theirs = progress.find((p) => p.personId === a.id);
              const on = a.id === personId;
              return (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => setViewingId(a.id)}
                  aria-pressed={on}
                  className={`rounded-full px-2.5 py-1 text-[11px] ${
                    on
                      ? "bg-[var(--control-active)] text-ink"
                      : "bg-[var(--control)] text-ink-muted hover:text-ink"
                  }`}
                >
                  {a.displayName}
                  <span data-figure className="ml-1.5 text-ink-faint">
                    {theirs?.doneCount ?? 0}/{theirs?.totalCount ?? 0}
                  </span>
                  {theirs?.waiting && (
                    <span
                      aria-label="waiting on you"
                      className="ml-1 inline-block h-1.5 w-1.5 rounded-full bg-[var(--state-rework)] align-middle"
                    />
                  )}
                </button>
              );
            })}
          </div>
        )}

        {/* Their own standing, for somebody carrying a shared goal. */}
        {shared && !isHead && isAssignee && personId && (
          <p className="mt-1 text-[11px] text-ink-faint">
            Shared with {assigneeIds.length - 1} other
            {assigneeIds.length > 2 ? " people" : ""} — you are on{" "}
            <span data-figure>
              {progress.find((p) => p.personId === personId)?.doneCount ?? 0}
            </span>{" "}
            of <span data-figure>{raw.length}</span> steps, and have earned{" "}
            <span data-figure>
              {progress.find((p) => p.personId === personId)?.pointsEarned ?? 0}
            </span>{" "}
            points.
          </p>
        )}

        {saveState.error && (
          <div className="mt-2">
            <InlineError message={saveState.error} />
          </div>
        )}
      </div>

      {!list.length && !adding ? (
        <EmptyState
          compact
          title="No steps yet"
          /* Told to the person who can act on it. The assignee cannot build the
             roadmap, so instructing them to break the goal into steps would be
             asking for something the screen gives them no way to do. */
          body={
            isHead
              ? "Break the goal into steps. Each one carries a deadline and a share of the points, and earns them when it is approved on time."
              : "The person who assigned this goal has not written its steps yet. You will be told when the roadmap is handed over."
          }
        />
      ) : (
        <ul className="divide-y divide-hairline">
          {list.map((n, i) =>
            editing === n.id ? (
              <li key={n.id} className="px-4 py-3">
                <NodeEditor
                  node={n}
                  index={i}
                  nodes={list}
                  pool={pool}
                  onCancel={() => setEditing(null)}
                  /* Saved first, closed after — same reason as adding one. */
                  onSave={async (next) => {
                    const ok = await persist(
                      list.map((x) => (x.id === n.id ? next : x)),
                    );
                    if (ok) setEditing(null);
                  }}
                  busy={saveState.isPending}
                />
              </li>
            ) : (
              <li key={n.id} className="px-4 py-3">
                <StepRow
                  step={raw.find((a) => a.id === n.id)!}
                  index={i}
                  pool={pool}
                  isAssignee={isAssignee}
                  isHead={isHead}
                  /* Whether the row on screen is the VIEWER's own. A head who
                     is also an assignee is looking at somebody else's work
                     most of the time, and must not be able to hand a report in
                     under their name. */
                  isMine={!shared || personId === viewerId}
                  personId={personId}
                  assigneeIds={assigneeIds}
                  personName={
                    view.assignees.find((a) => a.id === personId)?.displayName ?? null
                  }
                  onEdit={() => setEditing(n.id)}
                  onRemove={() => void persist(list.filter((x) => x.id !== n.id))}
                  onChanged={() => roadmap.refetch()}
                  taskId={taskId}
                />
              </li>
            ),
          )}

          {adding && (
            <li className="px-4 py-3">
              <NodeEditor
                index={list.length}
                nodes={list}
                pool={pool}
                onCancel={() => setAdding(false)}
                onSave={async (next) => {
                  /**
                   * Saved FIRST, closed after.
                   *
                   * This used to close the editor and then save, which left a
                   * window with neither the editor nor the new step on screen —
                   * the step looked like it had been discarded and then
                   * reappeared when the round trip finished. Now the editor
                   * stays up, disabled, until the write has actually landed,
                   * and a failed save leaves the typed step there to retry
                   * rather than throwing it away.
                   */
                  const ok = await persist([...list, next]);
                  if (ok) setAdding(false);
                }}
                busy={saveState.isPending}
              />
            </li>
          )}

          {/* The write is in flight and the list is still the old one. Said,
              rather than left as a pause the reader has to interpret. */}
          {saveState.isPending && !adding && editing === null && (
            <li className="px-4 py-2.5 text-[11px] text-ink-faint">Saving…</li>
          )}
        </ul>
      )}

      {/**
       * Handing it over.
       *
       * The roadmap stays editable afterwards — that is the old Cowork's
       * behaviour and it is deliberate: a plan that turns out wrong halfway
       * through should be correctable, and every step still carries its own
       * deadline and its own approval. What handing over changes is that the
       * person doing the work is told it is ready for them.
       */}
      {(list.length > 0 || submitted) && (
        <div className="border-t border-hairline px-4 py-3">
          {submitted ? (
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
              <span className="text-[11px] font-medium text-[var(--state-positive-ink)]">
                Handed over
              </span>
              {roadmap.data?.submittedAt && (
                <span className="text-[11px] text-ink-faint">
                  {formatDateTime(roadmap.data.submittedAt)}
                </span>
              )}
              <span className="text-[11px] text-ink-faint">
                · still editable — each step is approved on its own
              </span>
            </div>
          ) : !isHead ? (
            /* The assignee is TOLD the roadmap is still being written, rather
               than offered the control that hands it to them. Handing over is
               the head's act — it is what tells the assignee to begin. */
            <p className="text-[11px] text-ink-faint">
              This roadmap has not been handed over yet.
            </p>
          ) : (
            <>
              {/* Said before the decision, not discovered after it. */}
              {unspent && (
                <p className="mb-2 text-[11px] leading-relaxed text-ink-muted">
                  {unspent}
                </p>
              )}
              {cannotSubmit && (
                <p className="mb-2 text-[11px] text-ink-faint">{cannotSubmit}</p>
              )}
              <Button loading={submitState.isPending}
                tone="primary"
                size="sm"
                disabled={cannotSubmit !== null || submitState.isPending}
                onClick={async () => {
                  const r = await submit();
                  if (r.ok) roadmap.refetch();
                }}
              >
                {submitState.isPending ? "Handing over…" : "Hand over the roadmap"}
              </Button>
              {submitState.error && (
                <div className="mt-2">
                  <InlineError message={submitState.error} />
                </div>
              )}
            </>
          )}
        </div>
      )}
    </Panel>
  );
}

/**
 * One step, being written.
 *
 * The remainder and the refusal both come from `goalNodeView`, and the node
 * being edited is excluded from the budget — so raising a step from 10 points
 * to 12 is judged on the two it adds, which is what makes an edit possible once
 * the pool is nearly spent.
 */
function NodeEditor({
  node,
  index,
  nodes,
  pool,
  onSave,
  onCancel,
  busy = false,
}: {
  node?: GoalNode;
  index: number;
  nodes: readonly GoalNode[];
  pool: number;
  onSave: (node: GoalNode) => void | Promise<void>;
  onCancel: () => void;
  /** A write is in flight. The editor stays up and stops accepting a second. */
  busy?: boolean;
}) {
  const [heading, setHeading] = useState(node?.heading ?? "");
  const [description, setDescription] = useState(node?.description ?? "");
  /* `datetime-local` wants `YYYY-MM-DDTHH:mm`, and an ISO string carries more
     than that. Trimmed on the way in and restored on the way out. */
  const [deadline, setDeadline] = useState(node?.deadline?.slice(0, 16) ?? "");
  const [weight, setWeight] = useState(
    node?.weightPercent ? String(node.weightPercent) : "",
  );

  const view = goalNodeView({
    heading,
    description,
    deadline: deadline || null,
    weightPercent: Number(weight),
    taskMaxPoints: pool,
    nodes,
    excludeNodeId: node?.id ?? null,
  });

  const rest = weightForRemaining({
    nodes,
    taskMaxPoints: pool,
    excludeNodeId: node?.id ?? null,
  });

  return (
    <div className="rounded-inset bg-[var(--surface-sunken)] p-3">
      <p className="mb-2 text-[11px] tracking-[0.09em] text-ink-faint uppercase">
        Step {index + 1}
      </p>
      <div className="grid gap-3 deck:grid-cols-2">
        <Field label="What the step is" required className="deck:col-span-2">
          <Input
            value={heading}
            onChange={(e) => setHeading(e.target.value)}
            placeholder="Research and write up findings"
          />
        </Field>
        <Field label="Deadline" required hint="Points are earned only if it is submitted on or before this.">
          <Input
            type="datetime-local"
            value={deadline}
            onChange={(e) => setDeadline(e.target.value)}
          />
        </Field>
        <Field
          label="Share of the goal"
          required
          hint={`${view.remaining} of ${pool} points unspent.`}
        >
          <div className="flex items-center gap-2">
            <Input
              value={weight}
              inputMode="decimal"
              onChange={(e) => setWeight(e.target.value.replace(/[^0-9.]/g, ""))}
              className="max-w-[90px]"
            />
            <span className="text-xs text-ink-faint">%</span>
            {view.points > 0 && (
              <span className="text-xs text-ink-muted">
                <span data-figure className="text-ink">
                  {view.points}
                </span>{" "}
                pts
              </span>
            )}
            {/* Spends exactly what is left, so a roadmap does not end with four
                points stranded because nobody did the arithmetic. */}
            {rest > 0 && (
              <Button size="sm" tone="ghost" onClick={() => setWeight(String(rest))}>
                Use the rest
              </Button>
            )}
          </div>
        </Field>
      </div>
      <Field label="What it involves" required className="mt-3">
        <Textarea
          rows={2}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="The person doing it reports against this."
        />
      </Field>

      {/* The refusal, in the words that name the figures. */}
      {view.refusal && (heading.trim() || weight.trim()) && (
        <p className="mt-2 text-[11px] leading-relaxed text-[var(--state-overdue-ink)]">
          {view.refusal}
        </p>
      )}

      <div className="mt-3 flex items-center gap-2">
        <Button
          tone="primary"
          size="sm"
          disabled={view.refusal !== null || busy}
          onClick={() =>
            void onSave({
              id: node?.id ?? `node-${Date.now()}`,
              heading: heading.trim(),
              description: description.trim(),
              deadline: deadline ? new Date(deadline).toISOString() : null,
              weightPercent: Number(weight),
            })
          }
        >
          {busy ? "Saving…" : node ? "Save step" : "Add step"}
        </Button>
        <Button tone="ghost" size="sm" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

/**
 * One step, as it stands.
 *
 * Three states, and the reader only ever sees the control that belongs to
 * them: the person doing the work hands in a report, the person who assigned it
 * decides one. A step nobody has touched shows neither to a bystander.
 */
function StepRow({
  step,
  index,
  pool,
  isAssignee,
  isHead,
  isMine,
  taskId,
  personId,
  assigneeIds,
  personName,
  onEdit,
  onRemove,
  onChanged,
}: {
  step: {
    id: string;
    heading: string;
    description: string;
    deadline: string | null;
    weightPercent: number;
    points: number;
    status: string;
    report: {
      text: string;
      submittedAt: string | null;
      submittedBy: string | null;
      files: GoalReportFile[];
    } | null;
    perUserStatus: Record<string, Partial<GoalStepPerson>> | null;
  };
  index: number;
  pool: number;
  isAssignee: boolean;
  isHead: boolean;
  /** Whether the row on screen belongs to the viewer. */
  isMine: boolean;
  taskId: string;
  /** Whose row this is showing. Undefined on a single-assignee goal. */
  personId: string | undefined;
  assigneeIds: string[];
  /** Their name, for a head who is looking at somebody else's work. */
  personName: string | null;
  onEdit: () => void;
  onRemove: () => void;
  onChanged: () => void;
}) {
  const [writing, setWriting] = useState(false);
  const [text, setText] = useState("");
  /* Uploaded as they are picked, and held here until the report is handed in.
     Uploading at submit time would mean one slow button with several ways to
     fail behind it, and a failure there would take the written report with
     it. */
  const [files, setFiles] = useState<GoalReportFile[]>([]);
  const [upload, uploadState] = useAction((r, file: File) =>
    r.uploadGoalReportFile(file),
  );
  const [report, reportState] = useAction(
    (r, body: { text: string; files: GoalReportFile[] }) =>
      r.submitGoalStepReport({
        taskId,
        stepId: step.id,
        text: body.text,
        files: body.files,
        personId,
      }),
  );
  const [decide, decideState] = useAction((r, approve: boolean) =>
    r.decideGoalStep({ taskId, stepId: step.id, approve, personId }),
  );

  const points = nodePointsFor(step.weightPercent, pool);

  /**
   * This step, for the ONE person being looked at.
   *
   * On a shared goal the flat status belongs to nobody — it is the roll-up of
   * everybody's, and it only reads `done` once every assignee is finished.
   * Rendering it here would tell the second person their step was complete
   * because the first one's was. `personStep` reads the row that is actually
   * theirs, and falls back to the flat fields when the goal has one assignee.
   */
  const mine = personStep({ step, personId: personId ?? "", assigneeIds });
  const waiting = mine.status === "pending_approval";
  const done = mine.status === "done";
  const theirReport = mine.report;
  const late = submittedLate({
    submittedAt: theirReport?.submittedAt ?? null,
    deadline: step.deadline,
  });
  /* What approving WILL do, said on the button rather than discovered after. */
  const outcome = approvalOutcome({
    submittedAt: theirReport?.submittedAt ?? null,
    deadline: step.deadline,
    points,
  });

  return (
    <>
      <div className="flex items-baseline gap-3">
        <span
          data-figure
          className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full text-[11px] ${
            done
              ? "bg-[var(--state-positive)] text-[var(--body-bg)]"
              : "bg-[var(--control)] text-ink-muted"
          }`}
        >
          {index + 1}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm text-ink">{step.heading}</span>
          <span className="mt-0.5 block text-[11px] leading-relaxed text-ink-faint">
            {step.description}
          </span>
          <span className="mt-1 flex flex-wrap items-center gap-x-2 text-[11px] text-ink-faint">
            {step.deadline && <span>by {formatDateTime(step.deadline)}</span>}
            {waiting && (
              <span className="text-ink-muted">· waiting on approval</span>
            )}
            {done && (
              <span className="text-[var(--state-positive-ink)]">· approved</span>
            )}
            {late && theirReport && (
              <span className="text-[var(--state-overdue-ink)]">
                · handed in after the deadline
              </span>
            )}
          </span>
        </span>
        <span
          data-figure
          className={`shrink-0 text-xs ${done && !late ? "text-[var(--state-positive-ink)]" : "text-ink-muted"}`}
        >
          {points} pts
        </span>
        {isHead && !done && (
          <>
            <Button size="sm" tone="ghost" onClick={onEdit}>
              Edit
            </Button>
            <Button size="sm" tone="ghost" onClick={onRemove}>
              Remove
            </Button>
          </>
        )}
      </div>

      {theirReport && (
        <div className="mt-2 rounded-inset bg-[var(--surface-sunken)] px-3 py-2">
          <p className="text-[11px] leading-relaxed text-ink-muted">
            {theirReport.text}
          </p>
          {theirReport.files.length > 0 && (
            <ul className="mt-1.5 flex flex-col gap-1">
              {theirReport.files.map((f, i) => (
                <li key={`${f.driveUrl}-${i}`}>
                  <a
                    href={f.driveUrl}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="inline-flex max-w-full items-center gap-1.5 text-[11px] text-ink-muted underline decoration-[var(--hairline)] underline-offset-2 hover:text-ink"
                  >
                    <span className="min-w-0 truncate">{f.name}</span>
                    {f.size > 0 && (
                      <span data-figure className="shrink-0 text-ink-faint">
                        {formatBytes(f.size)}
                      </span>
                    )}
                  </a>
                </li>
              ))}
            </ul>
          )}
          {theirReport.submittedAt && (
            <p className="mt-1 text-[11px] text-ink-faint">
              handed in {formatDateTime(theirReport.submittedAt)}
            </p>
          )}
        </div>
      )}

      {(reportState.error || decideState.error) && (
        <div className="mt-2">
          <InlineError message={reportState.error ?? decideState.error ?? ""} />
        </div>
      )}

      {isAssignee && isMine && !waiting && !done && (
        <div className="mt-2">
          {writing ? (
            <div className="rounded-inset bg-[var(--surface-sunken)] p-3">
              <Field label="What you did" required>
                <Textarea
                  rows={3}
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  placeholder="The person approving this reads it against the step."
                />
              </Field>
              {step.deadline && (
                <p className="mt-2 text-[11px] text-ink-faint">
                  {submittedLate({
                    submittedAt: new Date().toISOString(),
                    deadline: step.deadline,
                  })
                    ? `The deadline passed on ${formatDateTime(step.deadline)}, so this step will earn nothing. It is still worth handing in.`
                    : `On time — this step earns ${points} points when it is approved.`}
                </p>
              )}
              <div className="mt-3">
                <p className="text-[11px] text-ink-faint">
                  Anything that shows the work — attached to this step.
                </p>
                {files.length > 0 && (
                  <ul className="mt-1.5 flex flex-col gap-1">
                    {files.map((f, i) => (
                      <li
                        key={`${f.driveUrl}-${i}`}
                        className="flex items-center gap-2 text-[11px] text-ink-muted"
                      >
                        <span className="min-w-0 flex-1 truncate">{f.name}</span>
                        <span data-figure className="shrink-0 text-ink-faint">
                          {formatBytes(f.size)}
                        </span>
                        <button
                          type="button"
                          className="shrink-0 text-ink-faint hover:text-ink"
                          onClick={() =>
                            setFiles((held) => held.filter((_, n) => n !== i))
                          }
                        >
                          Remove
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                <label className="mt-1.5 inline-flex cursor-pointer items-center text-[11px] text-ink-muted hover:text-ink">
                  <input
                    type="file"
                    className="sr-only"
                    disabled={uploadState.isPending}
                    onChange={async (e) => {
                      const picked = e.target.files?.[0];
                      /* Cleared straight away, so picking the SAME file again
                         after removing it still fires a change event. */
                      e.target.value = "";
                      if (!picked) return;
                      const r = await upload(picked);
                      if (r.ok) setFiles((held) => [...held, r.data]);
                    }}
                  />
                  {uploadState.isPending ? "Uploading…" : "Attach a file"}
                </label>
                {uploadState.error && (
                  <div className="mt-1.5">
                    <InlineError message={uploadState.error} />
                  </div>
                )}
              </div>
              <div className="mt-3 flex items-center gap-2">
                <Button loading={reportState.isPending || uploadState.isPending}
                  tone="primary"
                  size="sm"
                  disabled={
                    reportRefusal(text) !== null ||
                    reportState.isPending ||
                    /* Handing in mid-upload would drop the file that is still
                       in flight from the report it belongs to. */
                    uploadState.isPending
                  }
                  onClick={async () => {
                    const r = await report({ text: text.trim(), files });
                    if (r.ok) {
                      setWriting(false);
                      setText("");
                      setFiles([]);
                      onChanged();
                    }
                  }}
                >
                  {reportState.isPending ? "Sending…" : "Hand it in"}
                </Button>
                <Button tone="ghost" size="sm" onClick={() => setWriting(false)}>
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <Button size="sm" tone="ghost" onClick={() => setWriting(true)}>
              Hand this step in
            </Button>
          )}
        </div>
      )}

      {isHead && waiting && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {/* Whose work this settles. A head switching between people on a
              shared goal is one click from approving the wrong person's
              step, so the name is on the row rather than only in the picker
              at the top of the panel. */}
          {personName && (
            <span className="text-[11px] text-ink-faint">{personName}&apos;s:</span>
          )}
          <Button loading={decideState.isPending}
            tone="primary"
            size="sm"
            disabled={decideState.isPending}
            onClick={async () => {
              const r = await decide(true);
              if (r.ok) onChanged();
            }}
          >
            {outcome.label}
          </Button>
          <Button
            tone="ghost"
            size="sm"
            disabled={decideState.isPending}
            onClick={async () => {
              const r = await decide(false);
              if (r.ok) onChanged();
            }}
          >
            Send it back
          </Button>
        </div>
      )}
    </>
  );
}
