"use client";

import { useState } from "react";
import {
  Chip,
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
  DEFAULT_SCORING_SETTINGS,
  effectiveDailyTarget,
  validateScoringSettings,
  type ScoringSettings,
} from "@/lib/rules/settings/scoringSettings";
import { SettingsShell } from "../SettingsShell";
import { SettingsSaveBar } from "../SettingsSaveBar";

/**
 * Priority and scoring — the values the Express engine computes scores from.
 *
 * ## This document was already load-bearing
 *
 * `cowork_sop_settings/task_events` is read by the engine in seven places —
 * `c1Service.getC1Config`, `pmpService.computeC2ForEmployee`,
 * `timerSop.evaluateTimerSop`, `c2Band.routes`, and the SOP catalogue route.
 * Legacy writes it from the browser in `app/coworking/sop/page.js`, gated on
 * `role === "ceo"`. So nothing here needed a backend change: what was missing was
 * an admin surface in *this* product writing the document the engine already reads.
 *
 * ## Two stores, one save
 *
 * The repository writes Firestore **and** mirrors into MongoDB `BandConfig`
 * through `POST /cowork/sop/settings/sync`. Both, or a score is computed from one
 * copy and explained from the other with nothing reporting it. If the mirror
 * fails, the save reports the disagreement rather than claiming success.
 *
 * ## Why priority position is not here
 *
 * Priority is a POSITION IN A QUEUE, derived per read from
 * `resolveTaskPriority` and the chained workload. There is no weight to set. What
 * priority does to a score is `priorityScoreEffect`, an unresolved owner decision
 * that lives in Provisional rules until somebody takes it.
 */
export function PriorityScoringSection() {
  const perms = usePermissions();
  const canEdit = perms.can("score.configure");
  const stored = useQuery((r) => r.getScoringSettings(), []);

  const [edits, setEdits] = useState<ScoringSettings | null>(null);
  const [saved, setSaved] = useState(false);

  const [save, saveState] = useAction(
    (r, next: ScoringSettings, reason: string) =>
      r.setScoringSettings(next, reason || undefined),
  );

  const draft = edits ?? stored.data ?? null;

  if (stored.error && !draft) {
    return (
      <SettingsShell section="priority-scoring">
        <Panel>
          <ErrorState
            title="The scoring settings could not be loaded"
            body={stored.error}
            onRetry={stored.refetch}
          />
        </Panel>
      </SettingsShell>
    );
  }
  if (!draft) {
    return (
      <SettingsShell section="priority-scoring">
        <SkeletonRows rows={8} />
      </SettingsShell>
    );
  }

  const patch = (next: Partial<ScoringSettings>) => {
    setSaved(false);
    setEdits({ ...draft, ...next });
  };
  const dirty =
    edits !== null && JSON.stringify(draft) !== JSON.stringify(stored.data);
  const target = effectiveDailyTarget(draft);

  const num = (key: keyof ScoringSettings) => ({
    value: String(draft[key]),
    disabled: !canEdit,
    inputMode: "decimal" as const,
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => {
      const raw = e.target.value.trim();
      /* Empty is not zero. Clearing a field to retype it would otherwise commit
         a zero on the way — and zero is a real setting here (it switches a
         deduction off), so the audit would record a change nobody made. */
      if (raw === "") return;
      const n = Number(raw);
      if (Number.isFinite(n)) patch({ [key]: n } as Partial<ScoringSettings>);
    },
  });

  return (
    <SettingsShell section="priority-scoring">
      <div className="space-y-4">
        {/* The kill switch first. It overrides everything below it, and burying
            it under sixteen numeric fields would let somebody tune values that
            are not being applied at all. */}
        <Panel>
          <PanelHead
            title="Point cutting"
            sub="Checked before anything else the timer SOP does — the pause, the auto-stop, the daily job and the test tool all pass through one function."
          />
          <label className="mt-3 flex cursor-pointer items-start gap-2.5">
            <input
              type="checkbox"
              checked={draft.timerSopEnabled}
              disabled={!canEdit}
              onChange={(e) => patch({ timerSopEnabled: e.target.checked })}
              className="mt-0.5"
            />
            <span className="min-w-0">
              <span className="flex flex-wrap items-center gap-2 text-sm text-ink">
                Points are being cut and added
                {draft.timerSopEnabled ? (
                  <Chip tone="positive">On</Chip>
                ) : (
                  <Chip tone="risk">Paused</Chip>
                )}
              </span>
              <span className="mt-1 block max-w-[70ch] text-[11px] leading-relaxed text-ink-faint">
                Turning this off pauses the timer shortfall deduction and the
                overtime credit for everybody, immediately. Deductions already
                written stay written — this stops new ones rather than reversing
                past ones.
              </span>
            </span>
          </label>
        </Panel>

        <Panel padded={false}>
          <PanelHead
            title="C1 · execution quality"
            sub="A task starts at the base score and loses these amounts. The component's pool is scaled by the resulting quality rate."
          />
          <div className="grid gap-x-4 gap-y-3 px-4 py-3 sm:grid-cols-2 deck:grid-cols-3">
            <Numeric
              label="Component maximum"
              hint="Points available for C1 across the period."
              engineDefault={DEFAULT_SCORING_SETTINGS.c1MaxPoints}
              current={draft.c1MaxPoints}
              input={num("c1MaxPoints")}
            />
            <Numeric
              label="Base score"
              hint="What a task is worth before any deduction."
              engineDefault={DEFAULT_SCORING_SETTINGS.c1BaseScore}
              current={draft.c1BaseScore}
              input={num("c1BaseScore")}
            />
            <Numeric
              label="Missed deadline"
              hint="Deducted per miss."
              engineDefault={DEFAULT_SCORING_SETTINGS.c1DeadlineDeduction}
              current={draft.c1DeadlineDeduction}
              input={num("c1DeadlineDeduction")}
            />
            <Numeric
              label="Extension filed"
              hint="Deducted per charged extension."
              engineDefault={DEFAULT_SCORING_SETTINGS.c1ExtensionDeduction}
              current={draft.c1ExtensionDeduction}
              input={num("c1ExtensionDeduction")}
            />
            <Numeric
              label="Rework returned"
              hint="Deducted each time a submission comes back."
              engineDefault={DEFAULT_SCORING_SETTINGS.c1ReworkDeduction}
              current={draft.c1ReworkDeduction}
              input={num("c1ReworkDeduction")}
            />
            <Numeric
              label="Rejected task score"
              hint="A rejection overrides the score to this figure — it is not a deduction from the base."
              engineDefault={DEFAULT_SCORING_SETTINGS.c1RejectScore}
              current={draft.c1RejectScore}
              input={num("c1RejectScore")}
            />
          </div>
        </Panel>

        <Panel padded={false}>
          <PanelHead
            title="C2 · goals"
            sub="Goal points earned against goal points assigned."
          />
          <div className="grid gap-x-4 gap-y-3 px-4 py-3 sm:grid-cols-2 deck:grid-cols-3">
            <Numeric
              label="Global maximum"
              hint="For anybody without a band. A band configuration overrides this per employee and takes precedence."
              engineDefault={DEFAULT_SCORING_SETTINGS.c2GlobalMaxPoints}
              current={draft.c2GlobalMaxPoints}
              input={num("c2GlobalMaxPoints")}
            />
            <Numeric
              label="Goal total points"
              engineDefault={DEFAULT_SCORING_SETTINGS.goalTotalPoints}
              current={draft.goalTotalPoints}
              input={num("goalTotalPoints")}
            />
            <Numeric
              label="Final-node weight"
              hint="Percentage of a goal's points carried by its last component."
              engineDefault={DEFAULT_SCORING_SETTINGS.goalFinalNodeWeightPct}
              current={draft.goalFinalNodeWeightPct}
              input={num("goalFinalNodeWeightPct")}
            />
            <Numeric
              label="Goal bonus"
              engineDefault={DEFAULT_SCORING_SETTINGS.goalBonusPoints}
              current={draft.goalBonusPoints}
              input={num("goalBonusPoints")}
            />
          </div>
        </Panel>

        <Panel padded={false}>
          <PanelHead
            title="C3 · idle pool"
            sub="Measured from recorded timer hours against a daily target."
          />
          <div className="px-4 pt-3">
            <p className="rounded-inset bg-[var(--surface-sunken)] px-3 py-2 text-[11px] leading-relaxed text-ink-muted">
              <span className="text-ink">In force:</span> {target.sentence}
            </p>
          </div>
          <div className="grid gap-x-4 gap-y-3 px-4 py-3 sm:grid-cols-2 deck:grid-cols-3">
            <Numeric
              label="Daily target percentage"
              hint="Of the day's available hours. Above zero, this is used and the hours figure below is ignored."
              engineDefault={DEFAULT_SCORING_SETTINGS.timerMinDailyPct}
              current={draft.timerMinDailyPct}
              input={num("timerMinDailyPct")}
            />
            <Numeric
              label="Daily target hours"
              hint="Used only while the percentage is zero."
              engineDefault={DEFAULT_SCORING_SETTINGS.timerMinDailyHrs}
              current={draft.timerMinDailyHrs}
              input={num("timerMinDailyHrs")}
            />
            <Numeric
              label="Shortfall threshold"
              hint="Accumulated hours behind target before the deduction fires."
              engineDefault={DEFAULT_SCORING_SETTINGS.timerDeficitThresholdHrs}
              current={draft.timerDeficitThresholdHrs}
              input={num("timerDeficitThresholdHrs")}
            />
            <Numeric
              label="Shortfall deduction"
              engineDefault={DEFAULT_SCORING_SETTINGS.timerDeficitPoints}
              current={draft.timerDeficitPoints}
              input={num("timerDeficitPoints")}
            />
            <Numeric
              label="Overtime threshold"
              hint="Accumulated hours ahead of target before a credit is given."
              engineDefault={DEFAULT_SCORING_SETTINGS.timerOvertimeThresholdHrs}
              current={draft.timerOvertimeThresholdHrs}
              input={num("timerOvertimeThresholdHrs")}
            />
            <Numeric
              label="Overtime credit"
              engineDefault={DEFAULT_SCORING_SETTINGS.timerOvertimePoints}
              current={draft.timerOvertimePoints}
              input={num("timerOvertimePoints")}
            />
          </div>
        </Panel>

        <Panel>
          <PanelHead
            title="C4 · attendance"
            sub="Not configurable from Cowork, and the reason is not a missing screen."
          />
          <p className="mt-2 max-w-[70ch] text-sm leading-relaxed text-ink-muted">
            Lateness, absence and early-departure values live in HR&rsquo;s own
            MongoDB configuration and are read by the attendance engine, which
            authenticates against HR rather than Cowork. Editing them here would
            need a second authentication domain and would create a second place
            an attendance rule can be changed.
          </p>
        </Panel>
      </div>

      {canEdit && (
        <SettingsSaveBar<ScoringSettings>
          before={stored.data ?? null}
          after={draft}
          dirty={dirty}
          refusal={validateScoringSettings(draft)}
          error={saveState.error}
          pending={saveState.isPending}
          saved={saved}
          savedNote="Saved to Firestore and mirrored to the scoring store. Scores computed from now on use these values."
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
 * One scoring value, with the engine's own default beside it.
 *
 * **The default shown is `c1Service.js`'s, not ours.** Three places in the
 * codebase state a default for the missed-deadline deduction — the engine says
 * 0.5, legacy's Mongo sync route says 0.2, and `PROVISIONAL_RULES` says 0.2. Only
 * the first is the function that computes the score, so it is the only one worth
 * showing; the others would tell an administrator the engine uses a figure it
 * never has.
 */
function Numeric({
  label,
  hint,
  engineDefault,
  current,
  input,
}: {
  label: string;
  hint?: string;
  engineDefault: number;
  current: number;
  input: React.ComponentProps<typeof Input>;
}) {
  const changed = current !== engineDefault;
  return (
    <Field
      label={label}
      hint={
        hint ??
        (changed ? `Engine default is ${engineDefault}.` : undefined)
      }
    >
      <Input {...input} aria-label={label} />
      {hint && changed && (
        <p className="mt-1 text-[11px] text-ink-faint">
          Engine default is <span data-figure>{engineDefault}</span>.
        </p>
      )}
    </Field>
  );
}
