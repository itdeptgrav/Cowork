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
  Textarea,
} from "@/components/ui/Primitives";
import { useAction } from "@/lib/hooks/useRepository";

/**
 * Project creation.
 *
 * **A project is a folder. It asks for a name and a description, and that is
 * the whole form.** OWNER DECISION, 18 Aug 2026.
 *
 * It used to ask for a great deal more, and every extra question was a chance
 * to state something the work inside would contradict:
 *
 * · **Connect tasks** — a checklist of existing tasks to link at creation.
 *   Tasks are created INSIDE a project now, so linking loose ones at the
 *   moment of creation answers a question nobody has yet: the project does not
 *   exist, so nothing has been decided about what belongs in it.
 *
 * · **Status, Start and Target.** A project has no dates of its own. It is a
 *   container; the deadlines belong to the tasks inside it, each with its own
 *   budget, its own timer and its own place in somebody's queue. A target typed
 *   here moved no deadline and could disagree with every task under it.
 *
 * · **A people panel.** Owner and members were read from whoever carried the
 *   connected work. With no tasks connected at creation there is nobody to
 *   read, and asking would produce a membership the tasks then contradict.
 *   Membership is whoever holds the tasks inside, and it follows them.
 *
 * · **Tags and priority.** Presentational only — they fed nothing, scored
 *   nothing and filtered nothing.
 *
 * What is left is the two things only a person knows: what to call it, and why
 * it exists.
 */
export function NewProjectForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  const [create, state] = useAction((r) =>
    r.createProject({
      name,
      description: description || null,
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
          </Panel>

          {/* Anything the create refuses — a store with no folders behind it,
              a permission — is said here rather than swallowed. */}
          {state.error && state.errorField !== "name" && (
            <InlineError message={state.error} />
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
                A project is a folder. It carries a name and a description and
                nothing else — no deadline, no timer, no priority.
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
