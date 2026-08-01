"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { Avatar } from "@/components/ui/Avatar";
import { Icon } from "@/components/ui/Icons";
import { Breadcrumb } from "@/components/ui/Workspace";
import {
  Button,
  Chip,
  Field,
  InlineError,
  Input,
  Panel,
  ProvisionalBadge,
  Select,
  Textarea,
  QueryError,
  SkeletonRows,
} from "@/components/ui/Primitives";
import { useAction, useQuery } from "@/lib/hooks/useRepository";
import { useViewerId } from "@/lib/hooks/usePermissions";
import { deriveProjectDates } from "@/lib/rules/projects/derivedDates";
import type { ProjectStatus } from "@/lib/domain";

/**
 * Project creation.
 *
 * **The form asks for the two things only a person knows — a name and why the
 * work exists — and derives the rest from the tasks connected to it.**
 *
 * It used to ask for more, and each extra question was a chance to state
 * something the tasks contradicted:
 *
 * · A **people picker**: an owner dropdown listing the whole directory, and a
 *   grid of every employee as a togglable chip. Neither was a decision anybody
 *   had to make here. The owner is whoever is filling the form in; the members
 *   are the people already carrying the connected work, and picking a different
 *   set would produce a project whose membership disagreed with its own tasks.
 *   Both are now stated rather than asked, and the membership updates as tasks
 *   are connected.
 *
 * · **Two date fields, prefilled with hardcoded literals from the demo seed.**
 *   A project runs as long as its work does; typing a target that the tasks
 *   inside it cannot meet does not move a single deadline. They are derived by
 *   `deriveProjectDates` and stay derived until somebody deliberately edits
 *   one — an override is honoured, but it is now an override rather than the
 *   only way to fill the field.
 *
 * Connecting tasks therefore comes immediately after the description, before
 * anything it decides, so the cause is above the effect on the page.
 */
export function NewProjectForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  /* The person filling the form in. There is no owner picker: raising a project
     for somebody else is not a thing this form did usefully, and the field was
     a directory-length dropdown defaulted to the viewer anyway. */
  const viewerId = useViewerId();
  const owner = viewerId ?? "";
  const [status, setStatus] = useState<ProjectStatus>("planning");
  const [priority, setPriority] = useState<"high" | "normal" | "low">("normal");
  const [tags, setTags] = useState<string[]>([]);
  const [tagDraft, setTagDraft] = useState("");
  const [initialTaskIds, setInitialTaskIds] = useState<string[]>([]);

  /*
   * A deliberate date, where somebody has typed one.
   *
   * Null means "still following the tasks", and that is why the override is
   * held separately rather than by seeding the input with the derived value:
   * seeding cannot tell an untouched default from a considered choice, so
   * connecting a second task would either overwrite a real decision or freeze
   * the field at whatever the first task happened to say.
   */
  const [startOverride, setStartOverride] = useState<string | null>(null);
  const [targetOverride, setTargetOverride] = useState<string | null>(null);

  const tasks = useQuery(
    (r) => r.listTasks({ scope: "all", projectId: null }).then((p) => p.items),
    [],
  );

  const connected = useMemo(
    () => (tasks.data ?? []).filter((t) => initialTaskIds.includes(t.task.id)),
    [tasks.data, initialTaskIds],
  );

  const derived = useMemo(
    () =>
      deriveProjectDates(
        connected.map((t) => ({
          createdAt: t.task.createdAt,
          operationalDueAt: t.task.deadline.operationalDueAt,
          dueAt: t.task.deadline.dueAt,
        })),
      ),
    [connected],
  );

  const startDate = startOverride ?? derived.startDate ?? "";
  const targetDate = targetOverride ?? derived.targetDate ?? "";

  /* Everybody carrying the connected work, the owner aside — they are already
     the owner and a person is not both. Deduplicated across tasks, because two
     tasks assigned to the same person is one member. */
  const members = useMemo(() => {
    const byId = new Map<string, (typeof connected)[number]["assignees"][number]>();
    for (const t of connected) {
      for (const a of t.assignees) if (a.id !== owner) byId.set(a.id, a);
    }
    return [...byId.values()];
  }, [connected, owner]);

  const [create, state] = useAction((r) =>
    r.createProject({
      name,
      description: description || null,
      ownerId: owner,
      memberIds: members.map((m) => m.id),
      status,
      startDate: startDate || null,
      targetDate: targetDate || null,
      priority,
      tags,
      initialTaskIds,
    }),
  );

  return (
    <>
      <Breadcrumb
        items={[
          { label: "Tasks", href: "/tasks?view=tasks" },
          { label: "Projects", href: "/tasks/projects" },
          { label: "New project" },
        ]}
      />
      <h1 className="mt-2 mb-4 text-[clamp(1.375rem,2vw,1.75rem)] leading-none font-light tracking-[-0.03em] text-ink">
        New project
      </h1>

      <div className="grid grid-cols-1 items-start gap-4 deck:grid-cols-12">
        <div className="flex flex-col gap-4 deck:col-span-8">
          <Panel>
            <h2 className="text-sm font-medium text-ink">Basics</h2>
            <Field
              label="Name"
              required
              className="mt-3"
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

            {/* Directly under the description, and above the dates it fills in:
                the sequence on the page is the sequence of the decision. */}
            <div className="mt-4 border-t border-hairline pt-4">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <h3 className="text-sm font-medium text-ink">Connect tasks</h3>
                {connected.length > 0 && (
                  <span data-figure className="text-[11px] text-ink-faint">
                    {connected.length} connected
                  </span>
                )}
              </div>
              <p className="mt-1 text-xs text-ink-faint">
                Optional. Unconnected tasks only — connecting is a link, so
                nothing is moved or copied. The dates and members below are read
                from whatever you connect.
              </p>
              {tasks.error ? (
                <div className="mt-3">
                  <QueryError
                    compact
                    queries={[tasks]}
                    message="Unassigned tasks could not be loaded."
                  />
                </div>
              ) : tasks.isLoading ? (
                <div className="mt-3">
                  <SkeletonRows rows={3} />
                </div>
              ) : !tasks.data?.length ? (
                <p className="mt-3 text-sm text-ink-faint">
                  Every task already belongs to a project.
                </p>
              ) : (
                <ul className="mt-3 max-h-[220px] divide-y divide-hairline overflow-y-auto scroll-slim">
                  {tasks.data.map((t) => {
                    const on = initialTaskIds.includes(t.task.id);
                    return (
                      <li key={t.task.id}>
                        <label className="flex cursor-pointer items-center gap-2.5 py-2">
                          <input
                            type="checkbox"
                            checked={on}
                            onChange={() =>
                              setInitialTaskIds((c) =>
                                c.includes(t.task.id)
                                  ? c.filter((x) => x !== t.task.id)
                                  : [...c, t.task.id],
                              )
                            }
                            className="h-3.5 w-3.5 accent-[var(--color-ink)]"
                          />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm text-ink">
                              {t.task.title}
                            </span>
                            <span
                              data-figure
                              className="block text-[11px] text-ink-faint"
                            >
                              {t.task.reference}
                            </span>
                          </span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              <Field label="Status">
                <Select
                  value={status}
                  onChange={(e) => setStatus(e.target.value as ProjectStatus)}
                >
                  <option value="planning">Planning</option>
                  <option value="active">Active</option>
                  <option value="on_hold">On hold</option>
                </Select>
              </Field>
              <Field
                label="Start"
                hint={
                  startOverride === null
                    ? derived.startDate
                      ? "From the earliest connected task."
                      : "Connect a task, or set one."
                    : "Set by hand."
                }
              >
                <Input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartOverride(e.target.value)}
                />
              </Field>
              <Field
                label="Target"
                hint={
                  targetOverride === null
                    ? derived.targetDate
                      ? "From the last connected task to finish."
                      : "Connect a task, or set one."
                    : "Set by hand."
                }
              >
                <Input
                  type="date"
                  value={targetDate}
                  onChange={(e) => setTargetOverride(e.target.value)}
                />
              </Field>
            </div>

            {(startOverride !== null || targetOverride !== null) && (
              <div className="mt-2">
                <button
                  type="button"
                  onClick={() => {
                    setStartOverride(null);
                    setTargetOverride(null);
                  }}
                  className="text-[11px] text-ink-faint underline decoration-hairline underline-offset-2 transition-colors hover:text-ink"
                >
                  Follow the connected tasks again
                </button>
              </div>
            )}
          </Panel>

          {/* Stated, not asked. The owner is the person filling this in and the
              members are whoever holds the connected work — neither is a
              decision, and offering them as fields invited a membership that
              disagreed with the project's own tasks. */}
          <Panel>
            <h2 className="text-sm font-medium text-ink">People</h2>
            <p className="mt-1 text-xs text-ink-faint">
              Read from the work. Connect a task and whoever carries it joins;
              adding and removing people afterwards is done on the project.
            </p>
            <dl className="mt-3 flex flex-col gap-3">
              <div>
                <dt className="text-[11px] tracking-[0.09em] text-ink-faint uppercase">
                  Owner
                </dt>
                <dd className="mt-1 text-sm text-ink">
                  You{owner ? "" : " — signing in will name you"}
                </dd>
              </div>
              <div>
                <dt className="text-[11px] tracking-[0.09em] text-ink-faint uppercase">
                  Members
                </dt>
                <dd className="mt-1.5">
                  {members.length === 0 ? (
                    <p className="text-sm text-ink-faint">
                      Nobody yet — connect a task above.
                    </p>
                  ) : (
                    <ul className="flex flex-wrap gap-1.5">
                      {members.map((m) => (
                        <li
                          key={m.id}
                          className="flex items-center gap-1.5 rounded-full bg-[var(--control)] py-1 pr-2.5 pl-1 text-sm text-ink-muted"
                        >
                          <Avatar
                            initials={m.initials}
                            hue={m.hue}
                            src={m.profilePictureUrl}
                            name={m.displayName}
                            size="sm"
                          />
                          {m.displayName}
                        </li>
                      ))}
                    </ul>
                  )}
                </dd>
              </div>
            </dl>
          </Panel>

          <Panel>
            <h2 className="text-sm font-medium text-ink">Tags and priority</h2>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <Field
                label="Priority"
                hint="Presentational only — never feeds scoring."
              >
                <Select
                  value={priority}
                  onChange={(e) =>
                    setPriority(e.target.value as typeof priority)
                  }
                >
                  <option value="high">High</option>
                  <option value="normal">Normal</option>
                  <option value="low">Low</option>
                </Select>
              </Field>
              <Field label="Tags">
                <div className="flex gap-2">
                  <Input
                    value={tagDraft}
                    onChange={(e) => setTagDraft(e.target.value)}
                    placeholder="Add a tag"
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && tagDraft.trim()) {
                        e.preventDefault();
                        setTags((c) => [...c, tagDraft.trim()]);
                        setTagDraft("");
                      }
                    }}
                  />
                </div>
              </Field>
            </div>
            {tags.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {tags.map((t) => (
                  <Chip key={t}>
                    {t}
                    <button
                      type="button"
                      aria-label={`Remove ${t}`}
                      onClick={() => setTags((c) => c.filter((x) => x !== t))}
                      className="ml-1 opacity-60 hover:opacity-100"
                    >
                      <Icon.close className="h-3 w-3" />
                    </button>
                  </Chip>
                ))}
              </div>
            )}
          </Panel>

          {state.error && !state.errorField && (
            <InlineError message={state.error} code={state.errorCode} />
          )}

          <div className="flex justify-end gap-2">
            <Button onClick={() => router.back()}>Cancel</Button>
            <Button
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
                Progress is derived from connected tasks. There is no progress
                field to set by hand.
              </li>
              <li className="flex items-start gap-2">
                <Icon.chevronRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ink-faint" />
                So are the dates and the members. Connecting a task moves the
                target and brings whoever carries it in.
              </li>
              <li className="flex items-start gap-2">
                <Icon.chevronRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ink-faint" />
                Projects carry no score of their own — the tasks and goals
                inside them are the scoring units, so nothing is double-counted.
              </li>
              <li className="flex items-start gap-2">
                <Icon.chevronRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ink-faint" />
                Removing a task from a project unlinks it. It never deletes the
                task.
              </li>
            </ul>
            <p className="mt-3 flex flex-wrap items-center gap-2 border-t border-hairline pt-3 text-[11px] text-ink-faint">
              Who may create a project is unresolved.
              <ProvisionalBadge
                decisionId="P3"
                label="Project creation permission"
              />
            </p>
          </Panel>
        </div>
      </div>
    </>
  );
}
