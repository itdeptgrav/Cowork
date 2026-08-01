"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Avatar } from "@/components/ui/Avatar";
import { Icon } from "@/components/ui/Icons";
import {
  Button,
  Field,
  InlineError,
  Input,
  Textarea,
} from "@/components/ui/Primitives";
import { useAction, useQuery } from "@/lib/hooks/useRepository";
import { useViewerId } from "@/lib/hooks/usePermissions";
import { subtaskRefusal } from "@/lib/rules/tasks/completion";
import type { TaskView } from "@/lib/repositories";

/**
 * Break a piece of work out of a project.
 *
 * The requirement picker is the point of the dialog, not a field on it: a
 * subtask that contributes to nothing is work nobody asked for, and the parent
 * would have no way to know whether it mattered. So the checklist comes first,
 * the submit button stays disabled until one is chosen, and the refusal comes
 * from `subtaskRefusal` — the same predicate the repository refuses with, so
 * the form can never permit something the server will reject.
 *
 * The assignee list is `listAssignableEmployees`, which is already scoped by
 * the same `can()` the write is checked against. Delegating does not widen who
 * you may create work for.
 */
export function NewSubtaskDialog({
  parent,
  onClose,
  onCreated,
}: {
  parent: TaskView;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [assigneeId, setAssigneeId] = useState("");
  const [chosen, setChosen] = useState<string[]>([]);

  const people = useQuery((r) => r.listAssignableEmployees(), []);
  /* A subtask can be kept for YOURSELF — a self subtask, mediated by your manager
     exactly like a self task (the backend routes budget, priority and review to
     your manager once the assignee is you). `listAssignableEmployees` excludes
     the viewer, so add yourself back at the top of the list. */
  const me = useViewerId();
  const everyone = useQuery((r) => r.listEmployees(), []);
  const viewerEmployee = (everyone.data ?? []).find((p) => p.id === me) ?? null;
  const options = viewerEmployee
    ? [viewerEmployee, ...(people.data ?? []).filter((p) => p.id !== me)]
    : (people.data ?? []);
  const [create, state] = useAction((r) =>
    r.createSubtask({
      parentTaskId: parent.task.id,
      title,
      description: description || null,
      assigneeIds: assigneeId ? [assigneeId] : [],
      satisfiesRequirementIds: chosen,
    }),
  );

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  /* The client's copy of the rule, from the shared module. Shown before a round
     trip; the repository enforces it regardless. */
  const refusal = useMemo(
    () =>
      subtaskRefusal({
        parent: parent.task,
        satisfiesRequirementIds: chosen,
      }),
    [parent.task, chosen],
  );

  const ready = !refusal && title.trim().length > 0 && !!assigneeId;

  function toggle(id: string) {
    setChosen((c) => (c.includes(id) ? c.filter((x) => x !== id) : [...c, id]));
  }

  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="subtask-title"
      className="fixed inset-0 z-[90] grid place-items-center p-4"
    >
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 cursor-default bg-[var(--body-bg)]/60 backdrop-blur-[4px]"
      />

      <div className="frost-panel relative flex max-h-[88vh] w-[min(620px,96vw)] flex-col overflow-hidden rounded-panel">
        <div className="px-6 pt-5 pb-4">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <h2
                id="subtask-title"
                className="text-[22px] leading-tight font-light tracking-[-0.03em] text-ink"
              >
                Break out a subtask
              </h2>
              <p className="mt-1.5 max-w-[54ch] text-sm leading-relaxed text-ink-muted">
                You stay responsible for{" "}
                <span className="text-ink">{parent.task.title}</span>. This
                delegates one area of it, and it has to satisfy at least one of
                your completion requirements.
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-ink-faint transition-colors hover:bg-[var(--control)] hover:text-ink"
            >
              <Icon.close className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto border-t border-hairline px-6 py-4 scroll-slim">
          <Field label="What is being delegated" required>
            <Input
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Build the meeting system"
            />
          </Field>

          <Field label="Detail" className="mt-4">
            <Textarea
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Anything the assignee needs that the title does not carry."
            />
          </Field>

          <div className="mt-4">
            <p className="text-sm font-medium text-ink">Assign to</p>
            <p className="mt-0.5 text-[11px] text-ink-faint">
              Only people you may already create work for.
            </p>
            <ul className="mt-2 -mx-2">
              {options.map((p) => {
                const on = assigneeId === p.id;
                const isSelf = p.id === me;
                return (
                  <li key={p.id}>
                    <button
                      type="button"
                      aria-pressed={on}
                      onClick={() => setAssigneeId(on ? "" : p.id)}
                      className={`flex w-full items-center gap-3 rounded-inset px-2 py-2 text-left transition-colors ${
                        on
                          ? "bg-[var(--control-active)]"
                          : "hover:bg-[var(--control)]"
                      }`}
                    >
                      <Avatar
                        initials={p.initials}
                        hue={p.hue}
                        src={p.profilePictureUrl}
                        name={p.displayName}
                        size="sm"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm text-ink">
                          {p.displayName}
                          {isSelf && (
                            <span className="text-ink-faint"> · yourself</span>
                          )}
                        </span>
                        <span className="block truncate text-[11px] text-ink-faint">
                          {isSelf
                            ? "A self subtask — your manager approves and reviews it."
                            : `${p.designation}${p.departmentName ? ` · ${p.departmentName}` : ""}`}
                        </span>
                      </span>
                      {on && (
                        <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-ink text-[var(--body-bg)]">
                          <Icon.check className="h-3 w-3" />
                        </span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>

          {/* The contract with the parent. Required, and the reason the dialog
              exists in this shape. */}
          <div className="mt-5 border-t border-hairline pt-4">
            <p className="text-sm font-medium text-ink">
              Which completion requirements does this satisfy?
            </p>
            <p className="mt-0.5 text-[11px] text-ink-faint">
              At least one. Choose several if this subtask closes more than one.
            </p>
            <ul className="mt-2 flex flex-col gap-1">
              {parent.completion.requirements.map((r) => {
                const on = chosen.includes(r.requirement.id);
                const already = r.isSatisfied;
                return (
                  <li key={r.requirement.id}>
                    <button
                      type="button"
                      aria-pressed={on}
                      onClick={() => toggle(r.requirement.id)}
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
                            : "shadow-[inset_0_0_0_1.5px_var(--color-hairline)] text-transparent"
                        }`}
                      >
                        <Icon.check className="h-3 w-3" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm text-ink">
                          {r.requirement.text}
                        </span>
                        {already && (
                          <span className="mt-0.5 block text-[11px] text-ink-faint">
                            Already satisfied — choosing it will reopen it until
                            this subtask completes.
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
          </div>
        </div>

        <div className="border-t border-hairline px-6 py-4">
          {state.error && (
            <div className="mb-3">
              <InlineError compact message={state.error} code={state.errorCode} />
            </div>
          )}
          <div className="flex items-center justify-between gap-3">
            <p className="min-w-0 text-[11px] text-ink-faint">
              {refusal ??
                `${chosen.length} requirement${chosen.length === 1 ? "" : "s"} selected`}
            </p>
            <div className="flex shrink-0 items-center gap-2">
              <Button tone="ghost" size="sm" onClick={onClose}>
                Cancel
              </Button>
              <Button
                tone="primary"
                size="sm"
                disabled={!ready || state.isPending}
                onClick={async () => {
                  const r = await create();
                  if (r.ok) onCreated();
                }}
              >
                {state.isPending ? "Creating…" : "Create subtask"}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
