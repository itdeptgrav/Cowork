"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Icon } from "@/components/ui/Icons";
import { Breadcrumb } from "@/components/ui/Workspace";
import {
  Button,
  Field,
  InlineError,
  Input,
  Panel,
  Select,
  Textarea,
} from "@/components/ui/Primitives";
import { useAction, useQuery } from "@/lib/hooks/useRepository";
import type { EmployeeId } from "@/lib/domain";
import { buildGoalBased, formatGoalTarget } from "@/lib/rules/projects/goalBased";

/**
 * Project creation.
 *
 * **A project is a folder. It asks for a name, and offers three more things it
 * does not require.** OWNER DECISION, 18 Aug 2026, amended later to add an
 * optional deadline and an optional owner.
 *
 * The two additions are deliberately narrow, and each one is a fact only a
 * person holds rather than something the work below could contradict:
 *
 * · **Deadline** — a ceiling, not a display. Set it and `subtaskDeadlineCap`
 *   refuses any task underneath that would land after it. Leave it and the
 *   project is still judged on the latest commitment its children carry, which
 *   is what it did before.
 *
 * · **Assign to** — decides whose projects it appears under, and nothing else.
 *   `listProjects` already filters on `ownerId`; leaving it blank still leaves
 *   the project with its creator.
 *
 * Everything below stayed removed. Each was a chance to state something the
 * work inside would contradict:
 *
 * · **Connect tasks** — a checklist of existing tasks to link at creation.
 *   Tasks are created INSIDE a project now, so linking loose ones at the
 *   moment of creation answers a question nobody has yet: the project does not
 *   exist, so nothing has been decided about what belongs in it.
 *
 * · **Status and Start.** A project's status comes from the work inside it and
 *   it starts when it is made; neither is a question. The old **Target** is
 *   what the Deadline field above replaces, and the difference is the point:
 *   that one was a number typed into a container that moved no deadline and
 *   could disagree with every task under it. This one is enforced, so it
 *   cannot disagree with anything.
 *
 * · **A people PANEL** — owner and members together, read from whoever carried
 *   the connected work. Membership stays derived: it is whoever holds the tasks
 *   inside, and it follows them. The single "Assign to" above is not that; it
 *   names one person the container belongs to, which no set of tasks can
 *   contradict because it decides a listing rather than a responsibility.
 *
 * · **Tags and priority.** Presentational only — they fed nothing, scored
 *   nothing and filtered nothing.
 *
 * What is left is the four things only a person knows: what to call it, why it
 * exists, when it must be done by, and whose it is — and only the first is
 * required.
 */
export function NewProjectForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  /**
   * Both optional, and optional is the whole design.
   *
   * Leaving either blank keeps the previous behaviour exactly: a project with
   * no deadline is still judged on the latest commitment its tasks carry, and
   * one with no assignee still belongs to whoever made it. Nothing that already
   * exists changes, and nobody is made to answer a question they do not have an
   * answer to at the moment they are creating a container.
   */
  const [deadline, setDeadline] = useState("");
  const [ownerId, setOwnerId] = useState("");

  /**
   * "Taskgoal" — an optional descriptive marker, and off by default.
   *
   * **Deliberately not the C2 goal task.** The product's "Goal task" is
   * `isGoal`/`goalConfig` with weightage, points and a scored roadmap; this is
   * none of that. It stores an objective and a target and displays them, the
   * way the Important tag stores a flag — no scoring, no ordering, no deadline.
   * The name here says "Taskgoal" (the owner's word); the code says `goalBased`
   * so the two concepts never touch. See `lib/rules/projects/goalBased.ts`.
   *
   * Every field but the objective is optional; leave the box unticked and the
   * create sends nothing, so a project made without it is byte-for-byte what it
   * was before this existed.
   */
  const [isGoalBased, setIsGoalBased] = useState(false);
  const [objective, setObjective] = useState("");
  /* The KIND of goal — so this fits any goal, not only a number to hit. The
     numeric fields below appear only for `numeric`; every other kind leans on
     the success criteria and current status instead. Default `numeric` keeps
     the first view exactly as it was. */
  const [goalType, setGoalType] = useState("numeric");
  const [successCriteria, setSuccessCriteria] = useState("");
  const [currentStatus, setCurrentStatus] = useState("");
  const [metric, setMetric] = useState("");
  const [unit, setUnit] = useState("");
  const [targetValue, setTargetValue] = useState("");
  const [startValue, setStartValue] = useState("");
  const numericGoal = goalType === "numeric";

  /* Built only when the box is ticked, and null the moment the objective is
     blank — an empty marker is not a Taskgoal, so the create simply omits it.
     `buildGoalBased` drops the numeric fields for a non-numeric type, so what
     is typed into them and then hidden never reaches the store. */
  const goalBased = isGoalBased
    ? buildGoalBased({
        objective,
        goalType,
        successCriteria,
        currentStatus,
        metric,
        unit,
        targetValue,
        startValue,
      })
    : null;
  const targetPreview = formatGoalTarget(goalBased);

  /* Who this project can be handed to — the same list the task form assigns
     from, so a project and the work inside it can never offer different people. */
  const assignable = useQuery((r) => r.listAssignableEmployees(), []);

  const [create, state] = useAction((r) =>
    r.createProject({
      name,
      description: description || null,
      /* `datetime-local` yields "YYYY-MM-DDTHH:mm" in LOCAL time with no zone.
         Sent through `Date` so the engine is given a real instant rather than a
         string whose meaning depends on where it is read. */
      targetDate: deadline ? new Date(deadline).toISOString() : null,
      ownerId: ownerId ? (ownerId as EmployeeId) : undefined,
      /* Sent only when a real objective was typed; `goalBased` is already null
         otherwise, and the repository stores nothing when it is. */
      isGoalBased: goalBased != null,
      goalBased,
    }),
  );

  return (
    <>
      <Breadcrumb
        items={[
          { label: "Tasks", href: "/tasks?view=tasks" },
          { label: "Projects", href: "/tasks?view=projects" },
          { label: "New project" },
        ]}
      />
      <h1 className="mt-2 mb-4 text-[clamp(1.375rem,2vw,1.75rem)] leading-none font-light tracking-[-0.03em] text-ink">
        New project
      </h1>

      <div className="grid grid-cols-1 items-start gap-4 deck:grid-cols-12">
        <div className="flex flex-col gap-4 deck:col-span-8">
          <Panel>
            <Field
              label="Name"
              required
              error={state.errorField === "name" ? state.error : null}
            >
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Project name"
              />
            </Field>
            <Field label="Description" className="mt-3">
              <Textarea
                rows={3}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="What this project is for"
              />
            </Field>

            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field
                label="Deadline"
                hint="Optional. Nothing inside can then be due later."
                error={state.errorField === "targetDate" ? state.error : null}
              >
                <Input
                  type="datetime-local"
                  value={deadline}
                  onChange={(e) => setDeadline(e.target.value)}
                />
              </Field>

              <Field
                label="Assign to"
                hint="Optional. It appears under their projects."
                error={state.errorField === "ownerId" ? state.error : null}
              >
                <Select
                  value={ownerId}
                  onChange={(e) => setOwnerId(e.target.value)}
                  aria-label="Assign this project to"
                >
                  {/* The default, and a real choice rather than a prompt: an
                      unassigned project belongs to whoever created it, which is
                      what happened before this field existed. */}
                  <option value="">Nobody in particular</option>
                  {(assignable.data ?? []).map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.displayName}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>

            {/* "Taskgoal" — an optional marker, revealed only when ticked so it
                adds nothing to the ordinary create. Bordered off from the fields
                above because it is a different kind of thing: a description of
                what the project is chasing, not a constraint on it. */}
            <div className="mt-4 rounded-lg border border-hairline p-3">
              <label className="flex items-start gap-2.5 text-sm text-ink">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={isGoalBased}
                  onChange={(e) => setIsGoalBased(e.target.checked)}
                  aria-label="Mark as Taskgoal"
                />
                <span>
                  <span className="font-medium">Mark as Taskgoal</span>
                  <span className="mt-0.5 block text-xs text-ink-muted">
                    A project chasing a defined goal, of any kind. Descriptive
                    only — it changes no deadline, score or permission.
                  </span>
                </span>
              </label>

              {isGoalBased && (
                <div className="mt-3 space-y-3 border-t border-hairline pt-3">
                  <Field
                    label="Goal type"
                    hint="What kind of goal this is. It changes which details are asked for below."
                  >
                    <Select
                      value={goalType}
                      onChange={(e) => setGoalType(e.target.value)}
                      aria-label="Goal type"
                    >
                      <option value="numeric">Measurable (numeric)</option>
                      <option value="milestone">Milestone / deliverable</option>
                      <option value="qualitative">Qualitative / outcome</option>
                      <option value="other">Other</option>
                    </Select>
                  </Field>

                  <Field
                    label="Objective"
                    required
                    hint="What this project is trying to achieve."
                  >
                    <Input
                      value={objective}
                      onChange={(e) => setObjective(e.target.value)}
                      placeholder={
                        numericGoal
                          ? "e.g. Grow active users"
                          : "e.g. Launch the new website"
                      }
                    />
                  </Field>

                  <Field
                    label="Success criteria"
                    hint="Optional. How you will know it is achieved."
                  >
                    <Textarea
                      rows={2}
                      value={successCriteria}
                      onChange={(e) => setSuccessCriteria(e.target.value)}
                      placeholder="e.g. Signed off by the client and live in production"
                    />
                  </Field>

                  <Field label="Current status" hint="Optional. Where it stands now.">
                    <Input
                      value={currentStatus}
                      onChange={(e) => setCurrentStatus(e.target.value)}
                      placeholder={numericGoal ? "e.g. 120 users" : "e.g. Not started"}
                    />
                  </Field>

                  {/* Numbers belong to a measurable goal only. For every other
                      kind the two fields above carry it, so these are hidden
                      rather than shown blank. */}
                  {numericGoal && (
                    <>
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <Field label="Metric" hint="Optional. What is measured.">
                          <Input
                            value={metric}
                            onChange={(e) => setMetric(e.target.value)}
                            placeholder="e.g. users"
                          />
                        </Field>
                        <Field label="Unit" hint="Optional. How it is counted.">
                          <Input
                            value={unit}
                            onChange={(e) => setUnit(e.target.value)}
                            placeholder="e.g. monthly"
                          />
                        </Field>
                      </div>

                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <Field label="Starting value" hint="Optional. Where it is now.">
                          <Input
                            type="number"
                            min={0}
                            value={startValue}
                            onChange={(e) => setStartValue(e.target.value)}
                            placeholder="e.g. 120"
                          />
                        </Field>
                        <Field label="Target value" hint="Optional. Where it should get to.">
                          <Input
                            type="number"
                            min={0}
                            value={targetValue}
                            onChange={(e) => setTargetValue(e.target.value)}
                            placeholder="e.g. 500"
                          />
                        </Field>
                      </div>

                      {targetPreview && (
                        <p className="text-xs text-ink-muted">
                          Target reads as{" "}
                          <span className="font-medium text-ink">{targetPreview}</span>.
                        </p>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>
          </Panel>

          {/* Anything the create refuses — a store with no folders behind it,
              a permission — is said here rather than swallowed. */}
          {state.error && state.errorField !== "name" && (
            <InlineError message={state.error} />
          )}

          <div className="flex justify-end gap-2">
            <Button onClick={() => router.back()}>Cancel</Button>
            <Button loading={state.isPending}
              tone="primary"
              disabled={state.isPending || !name.trim()}
              onClick={async () => {
                const r = await create();
                if (r.ok) router.push(`/tasks/projects/${r.data.id}`);
              }}
            >
              {state.isPending ? "Creating…" : "Create project"}
            </Button>
          </div>
        </div>

        <div className="deck:col-span-4">
          <Panel>
            <h2 className="text-sm font-medium text-ink">How projects work</h2>
            <ul className="mt-3 space-y-2.5 text-sm text-ink-muted">
              <li className="flex items-start gap-2">
                <Icon.chevronRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ink-faint" />
                A project is a folder. It needs only a name — a description, a
                deadline and an owner are all optional.
              </li>
              <li className="flex items-start gap-2">
                <Icon.chevronRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ink-faint" />
                Give it a deadline and nothing inside it can be due later. Leave
                it blank and each task is bounded only by its assignee&rsquo;s own
                queue, exactly as before.
              </li>
              <li className="flex items-start gap-2">
                <Icon.chevronRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ink-faint" />
                Assign it to someone and it appears under their projects. Leave
                it blank and it stays with you, its creator.
              </li>
              <li className="flex items-start gap-2">
                <Icon.chevronRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ink-faint" />
                The work happens in the tasks inside it. Each one has its own
                assignee, deadline, priority and timer, exactly as any task
                does.
              </li>
              <li className="flex items-start gap-2">
                <Icon.chevronRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ink-faint" />
                One project can hold many tasks, and they can go to different
                people.
              </li>
              <li className="flex items-start gap-2">
                <Icon.chevronRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ink-faint" />
                Projects carry no score of their own — the tasks inside them are
                the scoring units, so nothing is double-counted.
              </li>
            </ul>
          </Panel>
        </div>
      </div>
    </>
  );
}
