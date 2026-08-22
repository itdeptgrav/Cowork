"use client";

import { useState } from "react";
import { Button, Chip, InlineError, Input, Panel } from "@/components/ui/Primitives";
import { useAction, useQuery, useRepo } from "@/lib/hooks/useRepository";
import type { TaskView } from "@/lib/repositories";
import type { OutputState } from "@/lib/rules/tasks/outputs";

/**
 * What a task hands over, and where each handover has got to.
 *
 * **The whole per-deliverable flow, on one panel.** A task declares its
 * outputs; each one is submitted and reviewed on its own through the same chain
 * a task uses; and each may name an output of another task that it waits for.
 *
 * Nothing here is a task. There are no subtasks, no requirements involved and
 * no change to the hierarchy — the list is a field on the task, and a task that
 * declares nothing never sees this panel do anything.
 */

const TONE: Record<OutputState, { label: string; tone: Parameters<typeof Chip>[0]["tone"] }> = {
  not_started: { label: "Not started", tone: "neutral" },
  in_review: { label: "In review", tone: "extension" },
  rework: { label: "Rework", tone: "rework" },
  rejected: { label: "Rejected", tone: "overdue" },
  approved: { label: "Approved", tone: "positive" },
};

export function OutputsPanel({
  view,
  viewerId,
  onChange,
}: {
  view: TaskView;
  viewerId: string | null;
  onChange: () => void;
}) {
  const repo = useRepo();
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /**
   * The output being submitted, and what is being said about it.
   *
   * A message is mandatory — `submissionMessageRequired` is `require`, on the
   * reasoning that a review with no statement of work is not reviewable — and
   * that applies to an output exactly as it does to a task. Submitting with an
   * empty string was silently refused, which looked like a dead button.
   */
  const [submitting, setSubmitting] = useState<string | null>(null);
  const [note, setNote] = useState("");

  const mine = view.assignments.some((a) => a.employeeId === viewerId);
  const isOwner = view.task.createdById === viewerId;
  /* The same two people the engine lets set outputs. Checked here so the
     controls are absent rather than present and refused. */
  const mayEdit = mine || isOwner;

  /* Candidate inputs: outputs of OTHER tasks. Read once for the whole panel. */
  const others = useQuery(
    (r) => r.listTasks({ scope: "all", includeSubtasks: true }),
    [],
  );
  const candidates = (others.data?.items ?? [])
    .filter((t) => t.task.id !== view.task.id && t.task.outputs.length > 0)
    .flatMap((t) =>
      t.task.outputs.map((o) => ({
        id: o.id,
        label: o.label,
        taskTitle: t.task.title,
      })),
    );

  async function write(
    next: { id?: string; label: string; needsOutputIds: string[] }[],
  ) {
    setBusy(true);
    setError(null);
    const r = await repo.setOutputs({ taskId: view.task.id, outputs: next });
    setBusy(false);
    if (!r.ok) return setError(r.message);
    onChange();
  }

  const current = view.outputs.map((o) => ({
    id: o.output.id,
    label: o.output.label,
    needsOutputIds: o.output.needsOutputIds,
  }));

  /**
   * Add one or many in a single write.
   *
   * One `setOutputs` call rather than one per name: the engine takes the whole
   * list, and ten separate writes would be ten round trips and ten chances for
   * a half-saved list.
   *
   * Duplicates are dropped against what is already declared — two outputs with
   * the same name cannot be told apart on a review screen or in a picker.
   */
  async function addMany(raw: string) {
    const parts = raw
      .split(/[\n,]/)
      .map((x) => x.trim())
      .filter(Boolean);
    if (!parts.length) return;
    const seen = new Set(view.outputs.map((o) => o.output.label.toLowerCase()));
    const fresh: { label: string; needsOutputIds: string[] }[] = [];
    for (const label of parts) {
      if (seen.has(label.toLowerCase())) continue;
      seen.add(label.toLowerCase());
      fresh.push({ label, needsOutputIds: [] });
    }
    if (!fresh.length) {
      setDraft("");
      return;
    }
    await write([...current, ...fresh]);
    setDraft("");
  }


  /* The contract method, not `submitCompletion` with a field — so this works
     unchanged against the legacy engine, which has a dedicated endpoint, and
     against the mock, which delegates back to its own submission path. */
  const [submit, submitState] = useAction(
    (r, arg: { outputId: string; message: string }) =>
      r.submitOutput({
        taskId: view.task.id,
        outputId: arg.outputId,
        message: arg.message,
      }),
  );

  return (
    <Panel>
      <div className="mb-3 flex items-baseline gap-2">
        <h2 className="text-sm font-medium text-ink">Outputs required</h2>
        {view.outputs.length > 0 && (
          <span className="text-xs text-ink-faint" data-figure>
            {view.outputs.filter((o) => o.state === "approved").length} of{" "}
            {view.outputs.length} approved
          </span>
        )}
      </div>

      {view.outputs.length === 0 && (
        <p className="mb-3 max-w-[62ch] text-[12px] text-ink-muted">
          What this task hands over. Each one is submitted and reviewed on its
          own, so somebody waiting on the first does not wait for all of them.
          Leave it empty and the task behaves exactly as it always has.
        </p>
      )}

      <div className="divide-y divide-hairline">
        {view.outputs.map((o) => {
          const meta = TONE[o.state];
          const canSubmit =
            mine &&
            o.isWorkable &&
            (o.state === "not_started" || o.state === "rework");
          return (
            <div key={o.output.id} className="flex items-center gap-3 py-2.5">
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm text-ink">{o.output.label}</div>
                {/* Why it cannot be started, naming the output and the task
                    that owes it — an id would be a lookup, not an answer. */}
                {!o.isWorkable && o.waitingOn.length > 0 && (
                  <div className="mt-0.5 truncate text-[11px] text-ink-faint">
                    Waiting on “{o.waitingOn[0].label}”
                    {o.waitingOn[0].taskTitle
                      ? ` — ${o.waitingOn[0].taskTitle}`
                      : ""}
                  </div>
                )}
              </div>
              <Chip tone={meta.tone}>{meta.label}</Chip>
              {canSubmit && submitting !== o.output.id && (
                <Button
                  size="sm"
                  tone="primary"
                  onClick={() => {
                    setSubmitting(o.output.id);
                    setNote("");
                  }}
                >
                  {o.state === "rework" ? "Resubmit" : "Submit"}
                </Button>
              )}
              {mayEdit && o.state === "not_started" && (
                <button
                  type="button"
                  className="rounded-full px-2 py-1 text-[11px] text-ink-faint hover:text-ink"
                  disabled={busy}
                  onClick={() =>
                    void write(current.filter((c) => c.id !== o.output.id))
                  }
                >
                  Remove
                </button>
              )}
              {mayEdit && o.state === "not_started" && submitting !== o.output.id && (
                <span />
              )}
            </div>
          );
        })}
      </div>

      {/* The message step. Inline under the list rather than a dialog: it is one
          field, and interrupting the page for it would be heavier than the
          decision deserves. */}
      {submitting && (
        <div className="mt-3 rounded-inset bg-[var(--surface-sunken)] p-3">
          <div className="mb-2 text-[11px] text-ink-faint">
            Describe what you are handing over. The reviewer sees this.
          </div>
          <Input
            value={note}
            autoFocus
            placeholder="Copy and tariffs, temple timings confirmed"
            onChange={(e) => setNote(e.target.value)}
          />
          <div className="mt-2 flex items-center gap-2">
            <Button
              size="sm"
              tone="primary"
              disabled={submitState.isPending || !note.trim()}
              onClick={async () => {
                const r = await submit({ outputId: submitting, message: note });
                if (r && !r.ok) return;
                setSubmitting(null);
                setNote("");
                onChange();
              }}
            >
              {submitState.isPending ? "Submitting…" : "Send for review"}
            </Button>
            <Button size="sm" onClick={() => setSubmitting(null)}>
              Cancel
            </Button>
          </div>
          {/* Surfaced, not swallowed. The engine refuses an empty message and a
              task that has not been started, and a button that silently does
              nothing is worse than either refusal. */}
          {submitState.error && (
            <div className="mt-2">
              <InlineError message={submitState.error} />
            </div>
          )}
        </div>
      )}

      {mayEdit && (
        <div className="mt-3">
          {/* Commas and newlines both split, so ten properties go in at once
              rather than as ten rounds of type-click-refocus. */}
          <textarea
            value={draft}
            rows={2}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== "Enter" || e.shiftKey) return;
              e.preventDefault();
              void addMany(draft);
            }}
            placeholder={
              view.outputs.length === 0
                ? "Gopalpur, Puri, Konark\nor one per line"
                : "Add more — commas or new lines"
            }
            disabled={busy}
            className="w-full rounded-inset bg-[var(--surface-sunken)] px-3 py-2 text-sm text-ink placeholder:text-ink-faint"
          />
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              disabled={busy || !draft.trim()}
              onClick={() => void addMany(draft)}
            >
              {busy ? "Adding…" : "Add"}
            </Button>
            <span className="text-[11px] text-ink-faint">
              Separate with commas or new lines. Enter adds them.
            </span>
          </div>
        </div>
      )}


      {/* Said rather than hidden. A section that vanishes when there is nothing
          to point at reads as a missing feature — the reader has no way to tell
          "no candidates yet" from "this is broken". */}
      {mayEdit && view.outputs.length > 0 && candidates.length === 0 && (
        <div className="mt-4 border-t border-hairline pt-3">
          <div className="mb-1 text-[11px] tracking-[0.09em] text-ink-faint uppercase">
            What each one waits for
          </div>
          <p className="max-w-[62ch] text-[12px] text-ink-muted">
            Nothing to wait for yet. An input is another task&rsquo;s output, so
            add outputs to the task that hands work to this one — then come back
            and point each of these at the one it needs.
          </p>
        </div>
      )}

      {mayEdit && view.outputs.length > 0 && candidates.length > 0 && (
        <div className="mt-4 border-t border-hairline pt-3">
          <div className="mb-2 text-[11px] tracking-[0.09em] text-ink-faint uppercase">
            What each one waits for
          </div>
          <div className="flex flex-col gap-2">
            {view.outputs.map((o) => (
              <label key={o.output.id} className="flex items-center gap-2">
                <span className="w-[42%] shrink-0 truncate text-[12px] text-ink-muted">
                  {o.output.label}
                </span>
                <select
                  className="min-w-0 flex-1 rounded-full bg-[var(--surface-sunken)] px-3 py-1.5 text-[12px] text-ink"
                  value={o.output.needsOutputIds[0] ?? ""}
                  disabled={busy}
                  onChange={(e) =>
                    void write(
                      current.map((c) =>
                        c.id === o.output.id
                          ? {
                              ...c,
                              needsOutputIds: e.target.value
                                ? [e.target.value]
                                : [],
                            }
                          : c,
                      ),
                    )
                  }
                >
                  <option value="">Nothing — can start right away</option>
                  {candidates.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.taskTitle} · {c.label}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
        </div>
      )}

      {error && (
        <div className="mt-3">
          <InlineError message={error} />
        </div>
      )}
    </Panel>
  );
}
