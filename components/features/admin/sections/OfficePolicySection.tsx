"use client";

import { useState } from "react";
import {
  Button,
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
  DAY_KEYS,
  label as dayLabel,
  validateOfficePolicy,
  workingDayCount,
  type DayKey,
  type OfficePolicy,
  type RecurringBreak,
} from "@/lib/legacy/officePolicy";
import { SettingsShell } from "../SettingsShell";
import { SettingsSaveBar } from "../SettingsSaveBar";

/**
 * Office policy — working days, hours, breaks and the action gap.
 *
 * ## The split this closes
 *
 * Two panels wrote `cowork_settings/office`:
 *
 * ```
 *   OfficeSettings.tsx    → r.setOfficeHours(config, why)   ← unaudited, and
 *                                                            absent from the
 *                                                            legacy repository
 *                                                            entirely
 *   ProvisionalRulesArea  → r.setOfficePolicy(next)         ← audited
 * ```
 *
 * The audit was wired to the second and the console rendered the first. The test
 * asserting "the office document is written from exactly one place" passed only
 * because `setOfficeHours` did not exist in `LegacyRepository` — so in production
 * that panel could not even *load*, let alone save: `getOfficeHours` reached the
 * throwing proxy and the section rendered an unavailable state.
 *
 * It is closed by **removing the second path**, not by repointing it. The domain's
 * `OfficeHours` models one start and one end for the week; the engine's schedule
 * is per-day, so a company that closes early on Saturday is representable there
 * and not in that type — and the hours it would discard are the ones deadlines are
 * computed from. There was nothing to salvage by mapping through it.
 *
 * ## Read by everything
 *
 * This is the one section in the console that both applications read. Every
 * deadline, remaining-time figure and operational date in either product resolves
 * through it, which is why it is the section that carries the confirmation.
 */
export function OfficePolicySection() {
  const perms = usePermissions();
  const canEdit = perms.can("score.configure");
  const stored = useQuery((r) => r.getOfficePolicy(), []);

  /**
   * Unsaved edits, or null when nothing has been touched.
   *
   * DERIVED against the fetched value rather than seeded from it in an effect.
   * Seeding state from a query is the shape that goes wrong when the query
   * resolves twice: the second resolution either clobbers edits in progress or is
   * ignored and the form shows a stale document. Null means "no edits", so a
   * refetch is picked up for free and there is nothing to keep in step.
   */
  const [edits, setEdits] = useState<OfficePolicy | null>(null);
  const [saved, setSaved] = useState(false);

  const [save, saveState] = useAction((r, next: OfficePolicy, reason: string) =>
    r.setOfficePolicy(next, reason || undefined),
  );

  const draft = edits ?? stored.data ?? null;

  if (stored.isLoading && !draft) {
    return (
      <SettingsShell section="office-policy">
        <SkeletonRows rows={10} />
      </SettingsShell>
    );
  }
  if (stored.error && !draft) {
    return (
      <SettingsShell section="office-policy">
        <Panel>
          <ErrorState
            title="The office policy could not be loaded"
            body={stored.error}
            onRetry={stored.refetch}
          />
        </Panel>
      </SettingsShell>
    );
  }
  if (!draft) {
    return (
      <SettingsShell section="office-policy">
        <SkeletonRows rows={10} />
      </SettingsShell>
    );
  }

  const patch = (next: Partial<OfficePolicy>) => {
    setSaved(false);
    setEdits({ ...draft, ...next });
  };
  const setDay = (day: DayKey, next: Partial<OfficePolicy["schedule"][DayKey]>) =>
    patch({
      schedule: { ...draft.schedule, [day]: { ...draft.schedule[day], ...next } },
    });

  /* Compared against the FETCHED document, so a discard is simply dropping the
     edits and a save is confirmed by the refetch agreeing. */
  const dirty =
    edits !== null && JSON.stringify(draft) !== JSON.stringify(stored.data);

  return (
    <SettingsShell
      section="office-policy"
      count={
        <>
          <span data-figure>{workingDayCount(draft)}</span> working days ·{" "}
          <span data-figure>{draft.breaks.length}</span> daily breaks
        </>
      }
    >
      <div className="space-y-4">
        <WorkingHoursCard draft={draft} canEdit={canEdit} onChange={setDay} />
        <BreaksCard draft={draft} canEdit={canEdit} onChange={patch} />
        <SchedulingCard draft={draft} canEdit={canEdit} onChange={patch} />
      </div>

      {canEdit && (
        <SettingsSaveBar<OfficePolicy>
          before={stored.data ?? null}
          after={draft}
          dirty={dirty}
          refusal={validateOfficePolicy(draft)}
          error={saveState.error}
          pending={saveState.isPending}
          saved={saved}
          savedNote="Saved. Deadlines computed from now on use these rules."
          onDiscard={() => {
            setEdits(null);
            setSaved(false);
          }}
          onSave={async (reason) => {
            const result = await save(draft, reason);
            if (result.ok) {
              /* Drop the edits so the form falls back to the fetched document —
                 the refetch is what confirms the save actually landed. */
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

/* ── Working hours ────────────────────────────────────────────────────────── */

/**
 * When the office is open, per day.
 *
 * Per-day rather than one window for the week, because that is what the engine
 * stores and reads. Flattening it here would discard hours that deadlines are
 * computed from — see `addWorkingSecs`, which reads full day names and the
 * `isOff` / `inTime` / `outTime` fields directly.
 */
function WorkingHoursCard({
  draft,
  canEdit,
  onChange,
}: {
  draft: OfficePolicy;
  canEdit: boolean;
  onChange: (day: DayKey, next: Partial<OfficePolicy["schedule"][DayKey]>) => void;
}) {
  return (
    <Panel padded={false}>
      <PanelHead
        title="Working hours"
        sub="Every deadline is counted in these hours. Time outside them is not working time."
      />
      <div className="divide-y divide-hairline">
        {DAY_KEYS.map((day) => {
          const cfg = draft.schedule[day];
          return (
            <div
              key={day}
              className="grid grid-cols-1 items-center gap-2 px-4 py-2.5 deck:grid-cols-[120px_auto_1fr]"
            >
              <span className="text-sm text-ink">{dayLabel(day)}</span>
              <label className="flex items-center gap-2 text-xs text-ink-muted">
                <input
                  type="checkbox"
                  checked={!cfg.isOff}
                  disabled={!canEdit}
                  onChange={(e) => onChange(day, { isOff: !e.target.checked })}
                />
                Working day
              </label>
              {cfg.isOff ? (
                <span className="text-xs text-ink-faint">
                  Closed — no deadline time accrues
                </span>
              ) : (
                <span className="flex flex-wrap items-center gap-2">
                  <Input
                    type="time"
                    value={cfg.inTime}
                    disabled={!canEdit}
                    onChange={(e) => onChange(day, { inTime: e.target.value })}
                    className="w-[130px]"
                    aria-label={`${dayLabel(day)} opening time`}
                  />
                  <span className="text-xs text-ink-faint">to</span>
                  <Input
                    type="time"
                    value={cfg.outTime}
                    disabled={!canEdit}
                    onChange={(e) => onChange(day, { outTime: e.target.value })}
                    className="w-[130px]"
                    aria-label={`${dayLabel(day)} closing time`}
                  />
                </span>
              )}
            </div>
          );
        })}
      </div>
    </Panel>
  );
}

/* ── Breaks ───────────────────────────────────────────────────────────────── */

function BreaksCard({
  draft,
  canEdit,
  onChange,
}: {
  draft: OfficePolicy;
  canEdit: boolean;
  onChange: (next: Partial<OfficePolicy>) => void;
}) {
  const setBreak = (index: number, next: Partial<RecurringBreak>) =>
    onChange({
      breaks: draft.breaks.map((b, i) => (i === index ? { ...b, ...next } : b)),
    });

  return (
    <Panel padded={false}>
      <PanelHead
        title="Breaks"
        sub="Recurring breaks are subtracted from every working day. The allowance is how much personal break time is credited back to deadlines."
      />
      <div className="px-4 py-3">
        <Field
          label="Daily break allowance"
          hint="Per person, per day, in minutes. Break time beyond this is not credited back to deadlines."
          className="w-[220px]"
        >
          <Input
            value={String(draft.maxBreakMinutesPerDay)}
            inputMode="numeric"
            disabled={!canEdit}
            onChange={(e) =>
              onChange({
                maxBreakMinutesPerDay:
                  Number(e.target.value.replace(/\D/g, "")) || 0,
              })
            }
          />
        </Field>
      </div>
      <div className="divide-y divide-hairline border-t border-hairline">
        {draft.breaks.length === 0 ? (
          <p className="px-4 py-3 text-xs text-ink-faint">
            No recurring breaks. The whole working day counts as working time.
          </p>
        ) : (
          draft.breaks.map((b, i) => (
            <div key={i} className="flex flex-wrap items-center gap-2 px-4 py-2.5">
              <Input
                value={b.name}
                disabled={!canEdit}
                onChange={(e) => setBreak(i, { name: e.target.value })}
                className="w-[160px]"
                aria-label="Break name"
              />
              <Input
                type="time"
                value={b.start}
                disabled={!canEdit}
                onChange={(e) => setBreak(i, { start: e.target.value })}
                className="w-[130px]"
                aria-label="Break start"
              />
              <span className="text-xs text-ink-faint">to</span>
              <Input
                type="time"
                value={b.end}
                disabled={!canEdit}
                onChange={(e) => setBreak(i, { end: e.target.value })}
                className="w-[130px]"
                aria-label="Break end"
              />
              {canEdit && (
                <button
                  type="button"
                  onClick={() =>
                    onChange({ breaks: draft.breaks.filter((_, x) => x !== i) })
                  }
                  className="ml-auto text-xs text-ink-muted underline underline-offset-2 hover:text-ink"
                >
                  Remove
                </button>
              )}
            </div>
          ))
        )}
      </div>
      {canEdit && (
        <div className="px-4 py-3">
          <Button
            size="sm"
            onClick={() =>
              onChange({
                breaks: [
                  ...draft.breaks,
                  { name: "Break", start: "13:00", end: "13:30" },
                ],
              })
            }
          >
            Add a break
          </Button>
        </div>
      )}
    </Panel>
  );
}

/* ── Scheduling ───────────────────────────────────────────────────────────── */

function SchedulingCard({
  draft,
  canEdit,
  onChange,
}: {
  draft: OfficePolicy;
  canEdit: boolean;
  onChange: (next: Partial<OfficePolicy>) => void;
}) {
  return (
    <Panel>
      <PanelHead
        title="Task scheduling"
        sub="How a task's deadline is anchored when work does not start immediately."
      />
      <div className="mt-3">
        <Field
          label="Task action gap"
          hint="Minutes. A task left untouched longer than this anchors its deadline to the gap rather than to when it was created, so a forgotten task does not arrive already overdue."
          className="w-[220px]"
        >
          <Input
            value={String(draft.maxTaskActionGapMinutes)}
            inputMode="numeric"
            disabled={!canEdit}
            onChange={(e) =>
              onChange({
                maxTaskActionGapMinutes:
                  Number(e.target.value.replace(/\D/g, "")) || 0,
              })
            }
          />
        </Field>
      </div>
    </Panel>
  );
}
