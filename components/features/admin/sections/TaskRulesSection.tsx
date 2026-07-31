"use client";

import { useState } from "react";
import {
  ErrorState,
  Field,
  Input,
  Panel,
  PanelHead,
  SkeletonRows,
} from "@/components/ui/Primitives";
import { useAction, useQuery } from "@/lib/hooks/useRepository";
import { usePermissions } from "@/lib/hooks/usePermissions";
import {
  validateTaskRules,
  type TaskRules,
} from "@/lib/rules/settings/taskRules";
import { SettingsShell } from "../SettingsShell";
import { SettingsSaveBar } from "../SettingsSaveBar";
import { ChoiceRow } from "./ChoiceRow";

/**
 * Task rules — the gates a task passes through.
 *
 * Five settings, and the restraint is the design. Statuses, priority arithmetic
 * and the budget/deadline unit split are all absent on purpose: they are what the
 * product *is* rather than values somebody chooses, and making them configurable
 * would leave the tests asserting defaults while the real behaviour lived in a
 * document. See `lib/rules/settings/taskRules.ts` for the test a rule has to pass
 * to appear here.
 *
 * Every default reproduces today's behaviour exactly, so an unsaved document
 * changes nothing.
 */
export function TaskRulesSection() {
  const perms = usePermissions();
  const canEdit = perms.can("score.configure");
  const stored = useQuery((r) => r.getTaskRules(), []);

  const [edits, setEdits] = useState<TaskRules | null>(null);
  const [saved, setSaved] = useState(false);

  const [save, saveState] = useAction((r, next: TaskRules, reason: string) =>
    r.setTaskRules(next, reason || undefined),
  );

  const draft = edits ?? stored.data ?? null;

  if (stored.error && !draft) {
    return (
      <SettingsShell section="task-rules">
        <Panel>
          <ErrorState
            title="The task rules could not be loaded"
            body={stored.error}
            onRetry={stored.refetch}
          />
        </Panel>
      </SettingsShell>
    );
  }
  if (!draft) {
    return (
      <SettingsShell section="task-rules">
        <SkeletonRows rows={6} />
      </SettingsShell>
    );
  }

  const patch = (next: Partial<TaskRules>) => {
    setSaved(false);
    setEdits({ ...draft, ...next });
  };
  const dirty =
    edits !== null && JSON.stringify(draft) !== JSON.stringify(stored.data);

  return (
    <SettingsShell section="task-rules">
      <div className="space-y-4">
        <Panel padded={false}>
          <PanelHead
            title="Submission"
            sub="What a person must have done before work can be handed over for review."
          />
          <div className="divide-y divide-hairline">
            <ChoiceRow
              label="Outstanding acceptance criteria"
              hint="A task with no criteria is unaffected either way — gating those would turn an optional field into a mandatory one across the product."
              value={draft.requirementsBeforeSubmit}
              disabled={!canEdit}
              onChange={(v) => patch({ requirementsBeforeSubmit: v })}
              options={[
                {
                  id: "off",
                  label: "Reference only",
                  hint: "Default. Criteria are the reviewer's reference for rework — never ticked at submission and never blocking it.",
                },
                {
                  id: "warn",
                  label: "Warn and allow",
                  hint: "Names what is unfinished and lets it through. For criteria that are a checklist rather than a contract.",
                },
                {
                  id: "block",
                  label: "Block submission",
                  hint: "The strictest option. Nothing can be submitted while a criterion is outstanding.",
                },
              ]}
            />
            <ChoiceRow
              label="Recorded time"
              hint="A task submitted with no measured effort makes its budget unmeasurable, and the workload queue is computed from measured effort."
              value={draft.timerBeforeSubmit}
              disabled={!canEdit}
              onChange={(v) => patch({ timerBeforeSubmit: v })}
              options={[
                {
                  id: "allow",
                  label: "Not required",
                  hint: "Today's behaviour.",
                },
                {
                  id: "require",
                  label: "Timer must have run",
                  hint: "Refuses a submission with zero logged seconds.",
                },
              ]}
            />
            <ChoiceRow
              label="Submission note"
              hint="The reviewer sees this before the work itself."
              value={draft.submissionNote}
              disabled={!canEdit}
              onChange={(v) => patch({ submissionNote: v })}
              options={[
                { id: "optional", label: "Optional", hint: "Today's behaviour." },
                {
                  id: "required",
                  label: "Required",
                  hint: "A submission with an empty note is refused.",
                },
              ]}
            />
          </div>
        </Panel>

        <Panel padded={false}>
          <PanelHead
            title="After a decision"
            sub="What happens once a reviewer has answered, and how long an unanswered proposal stands."
          />
          <div className="divide-y divide-hairline">
            <ChoiceRow
              label="A rejected task"
              value={draft.afterRejection}
              disabled={!canEdit}
              onChange={(v) => patch({ afterRejection: v })}
              options={[
                {
                  id: "allow_resubmit",
                  label: "May be resubmitted",
                  hint: "Today's behaviour. The assignee fixes it and submits again.",
                },
                {
                  id: "require_reopen",
                  label: "Must be reopened first",
                  hint: "Someone with authority puts it back into progress before it can move again.",
                },
              ]}
            />
            <div className="px-4 py-3">
              <Field
                label="Proposal expiry"
                hint="Hours an unanswered proposal stands before it lapses. Zero means it never lapses — a lapsed proposal is the absence of a decision, not a refusal, and the product says so rather than treating silence as no."
                className="w-[220px]"
              >
                <Input
                  value={String(draft.proposalExpiryHours)}
                  inputMode="numeric"
                  disabled={!canEdit}
                  onChange={(e) =>
                    patch({
                      proposalExpiryHours:
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
        <SettingsSaveBar<TaskRules>
          before={stored.data ?? null}
          after={draft}
          dirty={dirty}
          refusal={validateTaskRules(draft)}
          error={saveState.error}
          pending={saveState.isPending}
          saved={saved}
          savedNote="Saved. These gates apply to work from now on."
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
