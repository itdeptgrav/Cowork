"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
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
import type { ProjectStatus } from "@/lib/domain";

/** Project creation. Grouped, with the permission question surfaced honestly. */
export function NewProjectForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  /* Defaults to the acting person, not a seeded id — you are the likely owner
     of a project you are creating. */
  const viewerId = useViewerId();
  const [ownerId, setOwnerId] = useState("");
  const owner = ownerId || (viewerId ?? "");
  const [memberIds, setMemberIds] = useState<string[]>([]);
  const [status, setStatus] = useState<ProjectStatus>("planning");
  const [startDate, setStartDate] = useState("2026-07-25");
  const [targetDate, setTargetDate] = useState("2026-09-30");
  const [priority, setPriority] = useState<"high" | "normal" | "low">("normal");
  const [tags, setTags] = useState<string[]>([]);
  const [tagDraft, setTagDraft] = useState("");
  const [initialTaskIds, setInitialTaskIds] = useState<string[]>([]);

  const people = useQuery((r) => r.listEmployees(), []);
  const tasks = useQuery(
    (r) => r.listTasks({ scope: "all", projectId: null }).then((p) => p.items),
    [],
  );

  const [create, state] = useAction((r) =>
    r.createProject({
      name,
      description: description || null,
      ownerId: owner,
      memberIds,
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
            <div className="mt-3 grid gap-3 sm:grid-cols-3">
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
              <Field label="Start">
                <Input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                />
              </Field>
              <Field label="Target">
                <Input
                  type="date"
                  value={targetDate}
                  onChange={(e) => setTargetDate(e.target.value)}
                />
              </Field>
            </div>
          </Panel>

          <Panel>
            <h2 className="text-sm font-medium text-ink">People</h2>
            <Field label="Owner" required className="mt-3">
              <Select
                value={owner}
                onChange={(e) => setOwnerId(e.target.value)}
              >
                {!people.data?.length && (
                  <option value="">
                    {people.isLoading
                      ? "Loading people…"
                      : people.error
                        ? "People could not be loaded"
                        : "Nobody available"}
                  </option>
                )}
                {(people.data ?? []).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.displayName}
                  </option>
                ))}
              </Select>
            </Field>
            <div className="mt-3">
              <span className="mb-1.5 block text-sm font-medium text-ink">
                Members
              </span>
              <div className="flex flex-wrap gap-1.5">
                {(people.data ?? [])
                  .filter((p) => p.id !== owner)
                  .map((p) => {
                    const on = memberIds.includes(p.id);
                    return (
                      <button
                        key={p.id}
                        type="button"
                        aria-pressed={on}
                        onClick={() =>
                          setMemberIds((c) =>
                            c.includes(p.id)
                              ? c.filter((x) => x !== p.id)
                              : [...c, p.id],
                          )
                        }
                        className={`flex items-center gap-1.5 rounded-full py-1 pr-2.5 pl-1 text-sm transition-colors ${
                          on
                            ? "bg-ink text-[var(--body-bg)]"
                            : "bg-[var(--control)] text-ink-muted hover:text-ink"
                        }`}
                      >
                        <Avatar
                          initials={p.initials}
                          hue={p.hue}
                          name={p.displayName}
                          size="sm"
                        />
                        {p.displayName}
                      </button>
                    );
                  })}
              </div>
            </div>
          </Panel>

          <Panel>
            <h2 className="text-sm font-medium text-ink">Connect tasks</h2>
            <p className="mt-1 text-xs text-ink-faint">
              Optional. Unconnected tasks only — connecting is a link, so
              nothing is moved or copied.
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
