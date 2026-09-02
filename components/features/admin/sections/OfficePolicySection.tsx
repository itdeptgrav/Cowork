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
import { type TimerSopConfig } from "@/lib/rules/scoring/timerSop";

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
        <ScreenShareCard draft={draft} canEdit={canEdit} onChange={patch} />
        <SchedulingCard draft={draft} canEdit={canEdit} onChange={patch} />
        <TimerSopCard canEdit={canEdit} />
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

/* ── Screen sharing ───────────────────────────────────────────────────────── */

/**
 * Whether Online means a shared screen, or just means Online.
 *
 * **This changes what a status MEANS, which is why it is a switch and not a
 * preference.** With it on, Online is a consequence: a live, whole-screen share
 * that the person's primary manager can open, and nothing anybody types can
 * assert it. With it off, presence is an ordinary declaration — press Online,
 * you are online, nothing is captured and nobody is watched.
 *
 * The second is not a degraded version of the first. It is a different promise
 * to the people using it, so the card states both, and everything downstream —
 * the pill, the menu, the manager's panel and the help — follows this one value
 * rather than each carrying its own assumption.
 */
function ScreenShareCard({
  draft,
  canEdit,
  onChange,
}: {
  draft: OfficePolicy;
  canEdit: boolean;
  onChange: (next: Partial<OfficePolicy>) => void;
}) {
  const on = draft.requireScreenShare;
  return (
    <Panel padded={false}>
      <div className="flex items-start gap-3 border-b border-hairline px-4 py-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-medium text-ink">
            Screen sharing for Online
          </h2>
          <p className="mt-0.5 text-xs text-ink-muted">
            Whether going Online requires sharing an entire screen.
          </p>
        </div>
        <label className="flex shrink-0 items-center gap-2 text-xs text-ink-muted">
          <input
            type="checkbox"
            checked={on}
            disabled={!canEdit}
            onChange={(e) => onChange({ requireScreenShare: e.target.checked })}
          />
          {on ? "On" : "Off"}
        </label>
      </div>

      <p className="px-4 py-3 text-xs leading-relaxed text-ink-muted">
        {on ? (
          <>
            Choosing <span className="text-ink">Go online</span> asks for the
            screen first, and only a live whole-screen share turns the pill
            green — a window or a browser tab is refused by the service. Each
            person’s primary manager, and nobody else, can open that screen while
            it is running.
          </>
        ) : (
          <>
            <span className="text-ink">Nobody is asked to share a screen.</span>{" "}
            Online and Offline are set directly, breaks and emergencies are
            unchanged, and the monitoring panels show that screen sharing is
            switched off for this workspace rather than reporting people as not
            sharing. Anyone sharing right now keeps sharing until they stop.
          </>
        )}
      </p>
    </Panel>
  );
}

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

/* ── Timer SOP Point Engine ───────────────────────────────────────────────── */

/**
 * Auto-deduct or reward points from tracked WORK TIME — the legacy Timer SOP
 * engine, ported. Each working day's shortfall against a daily target builds a
 * deficit; time worked after office close builds overtime. Every threshold
 * crossing moves points, and the remainder carries forward.
 *
 * It starts PAUSED, and while paused nothing is cut or added. Every rate and
 * threshold is unconfirmed (O5), so the counters it drives are shown as
 * provisional wherever they appear.
 */
function TimerSopCard({ canEdit }: { canEdit: boolean }) {
  const stored = useQuery((r) => r.getTimerSopConfig(), []);
  const [edits, setEdits] = useState<TimerSopConfig | null>(null);
  const [saved, setSaved] = useState(false);
  const [save, saveState] = useAction((r, next: TimerSopConfig) =>
    r.setTimerSopConfig(next),
  );

  const draft = edits ?? stored.data ?? null;
  if (!draft) {
    return (
      <Panel>
        <SkeletonRows rows={6} />
      </Panel>
    );
  }

  const patch = (next: Partial<TimerSopConfig>) => {
    setSaved(false);
    setEdits({ ...draft, ...next });
  };
  const dirty =
    edits !== null && JSON.stringify(draft) !== JSON.stringify(stored.data);
  const num = (v: string) => {
    const n = Number(v.replace(/[^\d.]/g, ""));
    return Number.isFinite(n) ? n : 0;
  };

  return (
    <Panel padded={false}>
      <div className="flex items-start gap-3 border-b border-hairline px-4 py-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-medium text-ink">
            Timer SOP Point Engine
          </h2>
          <p className="mt-0.5 text-xs text-ink-muted">
            Auto-deduct or reward points based on accumulated work time.
          </p>
        </div>
        <label className="flex shrink-0 items-center gap-2 text-xs text-ink-muted">
          <input
            type="checkbox"
            checked={draft.enabled}
            disabled={!canEdit}
            onChange={(e) => patch({ enabled: e.target.checked })}
          />
          {draft.enabled ? "On" : "Off"}
        </label>
      </div>

      {!draft.enabled && (
        <p className="mx-4 mt-3 rounded-inset bg-[var(--state-rework-surface,var(--surface-sunken))] px-3 py-2 text-xs text-ink-muted">
          Paused — no points are cut or added for any employee until this is
          switched back on.
        </p>
      )}

      <div className="grid gap-4 px-4 py-4 deck:grid-cols-2">
        <Field
          label="Daily minimum required hours"
          hint="Fallback only — ignored while the percentage below is above 0."
        >
          <Input
            value={String(draft.dailyMinHours)}
            inputMode="decimal"
            disabled={!canEdit}
            onChange={(e) => patch({ dailyMinHours: num(e.target.value) })}
          />
        </Field>
        <Field
          label="Daily minimum — % of expected hours"
          hint="Above 0, this replaces the hours field: required hours become this % of each day's scheduled span, minus breaks. Leave at 0 to keep flat hours."
        >
          <Input
            value={String(draft.dailyMinPercent)}
            inputMode="decimal"
            disabled={!canEdit}
            onChange={(e) => patch({ dailyMinPercent: num(e.target.value) })}
          />
        </Field>
      </div>

      <div className="grid gap-4 px-4 pb-4 deck:grid-cols-2">
        <div className="rounded-inset border border-hairline p-3">
          <p className="text-[11px] font-medium tracking-[0.08em] text-[var(--state-rework-ink)] uppercase">
            Deficit penalty rule
          </p>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <Field label="Penalty threshold (hrs)">
              <Input
                value={String(draft.deficitThresholdHours)}
                inputMode="decimal"
                disabled={!canEdit}
                onChange={(e) =>
                  patch({ deficitThresholdHours: num(e.target.value) })
                }
              />
            </Field>
            <Field label="Points deducted">
              <Input
                value={String(draft.deficitPoints)}
                inputMode="decimal"
                disabled={!canEdit}
                onChange={(e) => patch({ deficitPoints: num(e.target.value) })}
              />
            </Field>
          </div>
          <p className="mt-2 text-[11px] leading-relaxed text-ink-faint">
            Miss 20 min/day × 3 days = 1h deficit → cut the points → the
            accumulator drops by the threshold, remainder carries forward.
          </p>
        </div>

        <div className="rounded-inset border border-hairline p-3">
          <p className="text-[11px] font-medium tracking-[0.08em] text-[var(--state-positive-ink)] uppercase">
            Overtime reward rule
          </p>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <Field label="Reward threshold (hrs)">
              <Input
                value={String(draft.overtimeThresholdHours)}
                inputMode="decimal"
                disabled={!canEdit}
                onChange={(e) =>
                  patch({ overtimeThresholdHours: num(e.target.value) })
                }
              />
            </Field>
            <Field label="Points added">
              <Input
                value={String(draft.overtimePoints)}
                inputMode="decimal"
                disabled={!canEdit}
                onChange={(e) => patch({ overtimePoints: num(e.target.value) })}
              />
            </Field>
          </div>
          <p className="mt-2 text-[11px] leading-relaxed text-ink-faint">
            Work 30 min extra/day × 2 days = 1h overtime → add the points →
            accumulator drops by the threshold, remainder carries forward.
          </p>
        </div>
      </div>

      {canEdit && (
        <div className="flex items-center gap-3 border-t border-hairline px-4 py-3">
          <Button loading={saveState.isPending}
            tone="primary"
            size="sm"
            disabled={!dirty || saveState.isPending}
            onClick={async () => {
              const res = await save(draft);
              if (res.ok) {
                setEdits(null);
                setSaved(true);
                stored.refetch();
              }
            }}
          >
            {saveState.isPending ? "Saving…" : "Save engine settings"}
          </Button>
          {saved && !dirty && (
            <span className="text-xs text-ink-muted">Saved.</span>
          )}
          {saveState.error && (
            <span className="text-xs text-[var(--state-rework-ink)]">
              {saveState.error}
            </span>
          )}
        </div>
      )}
    </Panel>
  );
}
