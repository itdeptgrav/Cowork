"use client";

import { useState } from "react";
import {
  ErrorState,
  Field,
  Input,
  Panel,
  PanelHead,
  Select,
  SkeletonRows,
} from "@/components/ui/Primitives";
import { useAction, useQuery } from "@/lib/hooks/useRepository";
import { usePermissions } from "@/lib/hooks/usePermissions";
import {
  validateWorkflowRouting,
  type WorkflowRouting,
} from "@/lib/rules/settings/workflowRouting";
import { SettingsShell } from "../SettingsShell";
import { SettingsSaveBar } from "../SettingsSaveBar";
import { ChoiceRow } from "./ChoiceRow";

/**
 * Workflow routing — who answers, and what happens when nobody is named.
 *
 * ## The chains are shown and are NOT editable
 *
 * That is the honest treatment rather than an omission. Hours go to the primary
 * manager because it is a decision about one employee's workload and the reporting
 * line owns it; a date goes to the assignor because it is a commitment they made,
 * possibly onward to somebody else. Offering a control would imply those are
 * preferences — and routing a date decision to a manager who cannot see the queue,
 * or an hours decision to somebody with no view of the person, are the two bugs
 * `extensionRouting.ts` exists to have fixed.
 *
 * They are displayed because "why did this go to Pramod?" is a question an
 * administrator should be able to answer from this screen.
 *
 * ## What IS editable is where the code currently guesses
 *
 * `budgetApproverId` returns `primaryManagerId ?? assigneeId` — defensible for a
 * chief executive, wrong for a new joiner whose HR record is incomplete, and the
 * code cannot tell those two apart. That fallback is now a decision.
 */
export function WorkflowRoutingSection() {
  const perms = usePermissions();
  const canEdit = perms.can("score.configure");
  const stored = useQuery((r) => r.getWorkflowRouting(), []);
  const people = useQuery((r) => r.listEmployees(), []);

  const [edits, setEdits] = useState<WorkflowRouting | null>(null);
  const [saved, setSaved] = useState(false);

  const [save, saveState] = useAction((r, next: WorkflowRouting, reason: string) =>
    r.setWorkflowRouting(next, reason || undefined),
  );

  const draft = edits ?? stored.data ?? null;

  if (stored.error && !draft) {
    return (
      <SettingsShell section="workflow-routing">
        <Panel>
          <ErrorState
            title="The routing rules could not be loaded"
            body={stored.error}
            onRetry={stored.refetch}
          />
        </Panel>
      </SettingsShell>
    );
  }
  if (!draft) {
    return (
      <SettingsShell section="workflow-routing">
        <SkeletonRows rows={6} />
      </SettingsShell>
    );
  }

  const patch = (next: Partial<WorkflowRouting>) => {
    setSaved(false);
    setEdits({ ...draft, ...next });
  };
  const dirty =
    edits !== null && JSON.stringify(draft) !== JSON.stringify(stored.data);
  const needsFallback =
    draft.budgetApproverWhenNoManager === "named_fallback" ||
    draft.deadlineApproverWhenNoAssignor === "named_fallback";

  return (
    <SettingsShell section="workflow-routing">
      <div className="space-y-4">
        <ChainCard />

        <Panel padded={false}>
          <PanelHead
            title="When nobody is named"
            sub="The reporting line and the assignor are usually enough. These decide the cases where the record is incomplete."
          />
          <div className="divide-y divide-hairline">
            <ChoiceRow
              label="Extra hours, and HR names no primary manager"
              value={draft.budgetApproverWhenNoManager}
              disabled={!canEdit}
              onChange={(v) => patch({ budgetApproverWhenNoManager: v })}
              options={[
                {
                  id: "self",
                  label: "The assignee decides their own hours",
                  hint: "Today's behaviour. Correct for somebody with nobody above them; wrong for a new joiner whose reporting line has not been filled in.",
                },
                {
                  id: "named_fallback",
                  label: "Send it to the fallback approver",
                  hint: "One named person answers every request that has no manager to answer it.",
                },
                {
                  id: "block",
                  label: "Refuse the request, and say why",
                  hint: "Names the missing reporting line instead of routing around it. Nothing is silently self-approved.",
                },
              ]}
            />
            <ChoiceRow
              label="A date change, and the task records no assignor"
              value={draft.deadlineApproverWhenNoAssignor}
              disabled={!canEdit}
              onChange={(v) => patch({ deadlineApproverWhenNoAssignor: v })}
              options={[
                {
                  id: "block",
                  label: "No control is offered",
                  hint: "Today's behaviour. A commitment with no owner cannot be moved by anybody.",
                },
                {
                  id: "named_fallback",
                  label: "Send it to the fallback approver",
                  hint: "Use where historical tasks have lost their assignor.",
                },
              ]}
            />
            <div className="px-4 py-3">
              <Field
                label="Fallback approver"
                hint="Used by either option above. A request routed to nobody looks exactly like one waiting on somebody who will never answer, so this is required once a fallback is selected."
                className="max-w-[320px]"
              >
                <Select
                  value={draft.fallbackApproverId ?? ""}
                  disabled={!canEdit}
                  onChange={(e) =>
                    patch({ fallbackApproverId: e.target.value || null })
                  }
                >
                  <option value="">
                    {needsFallback ? "Choose somebody…" : "Nobody"}
                  </option>
                  {(people.data ?? []).map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.displayName}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
          </div>
        </Panel>

        <Panel padded={false}>
          <PanelHead
            title="Escalation"
            sub="What a manager may do when the workload engine says the extra time will not fit."
          />
          <div className="divide-y divide-hairline">
            <ChoiceRow
              label="Hours the queue says will miss the deadline"
              value={draft.infeasibleBudget}
              disabled={!canEdit}
              onChange={(v) => patch({ infeasibleBudget: v })}
              options={[
                {
                  id: "escalate",
                  label: "Must be taken to the assignor",
                  hint: "Today's behaviour. The manager carries the earliest date their employee can actually achieve; the assignor decides whether to accept it.",
                },
                {
                  id: "allow_override",
                  label: "The manager may grant them anyway",
                  hint: "The slip is accepted and recorded. The assignor is not consulted about a commitment that will now be missed.",
                },
              ]}
            />
            <div className="px-4 py-3">
              <Field
                label="Report an approval as stuck after"
                hint="Hours. Zero turns the report off. The decision is reported, never reassigned — automatically moving it would produce an approval nobody consciously gave."
                className="w-[220px]"
              >
                <Input
                  value={String(draft.stuckAfterHours)}
                  inputMode="numeric"
                  disabled={!canEdit}
                  onChange={(e) =>
                    patch({
                      stuckAfterHours:
                        Number(e.target.value.replace(/\D/g, "")) || 0,
                    })
                  }
                />
              </Field>
            </div>
          </div>
        </Panel>
      </div>

      {canEdit && (
        <SettingsSaveBar<WorkflowRouting>
          before={stored.data ?? null}
          after={draft}
          dirty={dirty}
          refusal={validateWorkflowRouting(draft)}
          error={saveState.error}
          pending={saveState.isPending}
          saved={saved}
          savedNote="Saved. New requests route by these rules."
          onDiscard={() => {
            setEdits(null);
            setSaved(false);
          }}
          onSave={async (reason) => {
            const result = await save(draft, reason);
            if (result.ok) {
              setEdits(null);
              setSaved(true);
              stored.refetch();
            }
            return { ok: result.ok };
          }}
        />
      )}
    </SettingsShell>
  );
}

/**
 * The two chains, as the product runs them.
 *
 * Read-only, and labelled as settled rather than as unimplemented. The
 * distinction matters: an administrator who reads "not configurable yet" waits
 * for a release, while one who reads "this is the rule and here is why" can act.
 */
function ChainCard() {
  return (
    <Panel>
      <PanelHead
        title="Approval chains"
        sub="Settled product behaviour, shown so a routing decision can be explained. Not configurable — and the reason is below."
      />
      <div className="mt-3 grid gap-3 deck:grid-cols-2">
        <Chain
          title="Extra working time"
          unit="Measured in working hours"
          steps={["Assignee", "Primary manager"]}
          why="A decision about one person's workload. The reporting line owns it, and the manager is the only one who can see whether the hours fit."
        />
        <Chain
          title="A later deadline"
          unit="Measured as a date and time"
          steps={["Manager", "Assignor"]}
          why="A commitment the assignor made, possibly onward to somebody else. Only they may move it — and the manager escalates, carrying the earliest achievable date rather than the assignee guessing one."
        />
      </div>
      <p className="mt-3 border-t border-hairline pt-3 text-[11px] leading-relaxed text-ink-faint">
        Hours are always asked for first, because they are usually enough:
        somebody a queue position ahead of their deadline can absorb two extra
        hours without any commitment moving. Only when the workload engine says
        they cannot fit does this become a conversation about a date.
      </p>
    </Panel>
  );
}

function Chain({
  title,
  unit,
  steps,
  why,
}: {
  title: string;
  unit: string;
  steps: string[];
  why: string;
}) {
  return (
    <div className="rounded-inset bg-[var(--surface-sunken)] px-3.5 py-3">
      <p className="text-sm font-medium text-ink">{title}</p>
      <p className="mt-0.5 text-[11px] text-ink-faint">{unit}</p>
      {/* The arrow sits in its own fixed-width cell so the names left-align
          regardless of which rows have one. Prefixing the label instead made the
          first step hang half a character out from the rest. */}
      <ol className="mt-2.5 flex flex-col gap-1">
        {steps.map((step, i) => (
          <li
            key={step}
            className="grid grid-cols-[14px_minmax(0,1fr)] items-center gap-1.5 text-xs text-ink"
          >
            <span aria-hidden className="text-center text-ink-faint">
              {i > 0 ? "↓" : ""}
            </span>
            <span className="min-w-0 truncate">{step}</span>
          </li>
        ))}
      </ol>
      <p className="mt-2.5 text-[11px] leading-relaxed text-ink-muted">{why}</p>
    </div>
  );
}
