"use client";

import { useState } from "react";
import { Button, Chip, Panel } from "@/components/ui/Primitives";
import { OutputHandoverForm } from "./OutputHandoverForm";
import type { TaskView } from "@/lib/repositories";
import { OUTPUT_TONE } from "./outputTone";

/**
 * The outputs a task hands over, on the Submission tab.
 *
 * ## Why it is here as well as on Overview
 *
 * The Submission tab used to say only "Submit them from Overview" — a screen
 * whose entire content was directions to another screen, on the one tab named
 * after the thing the reader came to do. `TaskDetail` renders `ReviewPanel`
 * directly beneath this, so submit and decide now sit together in the order the
 * work moves: the person handing work in and the person judging it read one
 * screen.
 *
 * Overview keeps its own copy of the list, because naming an output and handing
 * it over are one thought when the work is fresh in front of you. Both drive
 * `OutputHandoverForm`, so there is one upload path and one definition of a
 * complete handover no matter which screen it was started from.
 */

export function OutputSubmitList({
  view,
  viewerId,
  onChange,
}: {
  view: TaskView;
  viewerId: string | null;
  onChange: () => void;
}) {
  const [submitting, setSubmitting] = useState<string | null>(null);
  const mine = view.assignments.some((a) => a.employeeId === viewerId);

  if (view.outputs.length === 0) return null;

  const approved = view.outputs.filter((o) => o.state === "approved").length;

  return (
    <Panel>
      <div className="mb-1 flex items-baseline gap-2">
        <h2 className="text-sm font-medium text-ink">Outputs to hand over</h2>
        <span className="text-xs text-ink-faint" data-figure>
          {approved} of {view.outputs.length} approved
        </span>
      </div>
      <p className="mb-3 max-w-[68ch] text-[12px] text-ink-muted">
        Each one is submitted and reviewed on its own. The task completes when
        all of them are approved — there is no separate submission for the task
        itself.
      </p>

      <div className="divide-y divide-hairline">
        {view.outputs.map((o) => {
          const meta = OUTPUT_TONE[o.state];
          const canSubmit =
            mine &&
            o.isWorkable &&
            (o.state === "not_started" || o.state === "rework");
          const open = submitting === o.output.id;

          return (
            <div key={o.output.id} className="py-2.5">
              <div className="flex flex-wrap items-center gap-2.5">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm text-ink">
                    {o.output.label}
                  </div>
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
                {canSubmit && !open && (
                  <Button
                    size="sm"
                    tone="primary"
                    onClick={() => setSubmitting(o.output.id)}
                  >
                    {o.state === "rework" ? "Resubmit" : "Submit"}
                  </Button>
                )}
              </div>

              {/* Opening under the row it belongs to rather than in a dialog:
                  it is a note and a file list, and taking the page over for it
                  would be heavier than the step deserves — and would hide which
                  output is being handed over. */}
              {open && (
                <OutputHandoverForm
                  taskId={view.task.id}
                  outputId={o.output.id}
                  onCancel={() => setSubmitting(null)}
                  onDone={() => {
                    setSubmitting(null);
                    onChange();
                  }}
                />
              )}
            </div>
          );
        })}
      </div>
    </Panel>
  );
}
