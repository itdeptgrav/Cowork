"use client";

import { useState } from "react";
import {
  Chip,
  ErrorState,
  Input,
  Panel,
  ProvisionalBadge,
  Select,
  SkeletonRows,
} from "@/components/ui/Primitives";
import { useAction, useQuery } from "@/lib/hooks/useRepository";
import { usePermissions } from "@/lib/hooks/usePermissions";
import {
  ruleRows,
  validateRuleOverrides,
  type RuleOverrides,
} from "@/lib/rules/settings/ruleOverrides";
import { SettingsShell } from "../SettingsShell";
import { SettingsSaveBar } from "../SettingsSaveBar";

/**
 * Provisional rules — placeholders, and the decisions that resolve them.
 *
 * ## The fake state this closes
 *
 * These values were editable and the edits did not survive a refresh.
 * `lib/config/settings.ts` holds overrides in a module-level `Map`, which is the
 * right place for the *read* — the scoring engine is called from the repository,
 * well below any component, and a rule value that depended on render order would
 * be a scoring bug rather than a UI bug. But nothing ever wrote that map anywhere.
 * An administrator published a value, the card showed it, the engine used it, and a
 * reload restored the placeholder with nothing saying so. Two people looking at
 * the same rule on the same day could see different numbers depending on who had
 * reloaded most recently.
 *
 * They now persist to `cowork_settings/rule_overrides`, are loaded at session
 * start, and are installed into the module map on save so this browser stops using
 * the old figure without waiting for a reload.
 *
 * ## Publishing resolves the decision
 *
 * A rule with an override is no longer provisional and stops being badged as one —
 * somebody has decided. Clearing an override REMOVES the key rather than writing
 * the default back, because "an administrator chose 0.2" and "nobody has decided,
 * and the placeholder happens to be 0.2" are different facts, and the badge is how
 * a reader tells them apart.
 *
 * ## Enforced by Cowork only
 *
 * These feed this product's own rules and its derived scoring. The values the
 * Express engine computes published scores from are in Priority &amp; scoring, and
 * the two are deliberately separate screens: conflating them would let somebody
 * change a placeholder and believe they had changed a score.
 */
export function ProvisionalRulesSection() {
  const perms = usePermissions();
  const canEdit = perms.can("score.configure");
  const stored = useQuery((r) => r.getRuleOverrides(), []);

  const [edits, setEdits] = useState<RuleOverrides | null>(null);
  const [saved, setSaved] = useState(false);

  const [save, saveState] = useAction((r, next: RuleOverrides, reason: string) =>
    r.setRuleOverrides(next, reason || undefined),
  );

  const draft = edits ?? stored.data ?? null;

  if (stored.error && !draft) {
    return (
      <SettingsShell section="provisional-rules">
        <Panel>
          <ErrorState
            title="The published rule values could not be loaded"
            body={stored.error}
            onRetry={stored.refetch}
          />
        </Panel>
      </SettingsShell>
    );
  }
  if (!draft) {
    return (
      <SettingsShell section="provisional-rules">
        <SkeletonRows rows={10} />
      </SettingsShell>
    );
  }

  const rows = ruleRows(draft);
  const byDecision = new Map<string, typeof rows>();
  for (const row of rows) {
    byDecision.set(row.decisionId, [
      ...(byDecision.get(row.decisionId) ?? []),
      row,
    ]);
  }
  const groups = [...byDecision.entries()].sort((a, b) =>
    a[0].localeCompare(b[0]),
  );

  const publish = (key: string, value: string | number) => {
    setSaved(false);
    setEdits({ ...draft, [key]: value });
  };
  const clear = (key: string) => {
    setSaved(false);
    /* Deleted, not set to the default. `readRuleOverrides` treats an absent key
       as "no decision", which is what restores the Provisional badge. */
    const next = { ...draft };
    delete next[key];
    setEdits(next);
  };

  const dirty =
    edits !== null && JSON.stringify(draft) !== JSON.stringify(stored.data);
  const unresolved = rows.filter((r) => !r.isOverridden).length;

  return (
    <SettingsShell
      section="provisional-rules"
      count={
        <>
          <span data-figure>{unresolved}</span> of{" "}
          <span data-figure>{rows.length}</span> still unresolved
        </>
      }
    >
      <Panel className="mb-4">
        <p className="max-w-[72ch] text-sm leading-relaxed text-ink-muted">
          Every value below started as a placeholder so the product could run.
          None was a recommendation, and figures derived from an unresolved one
          are marked wherever they appear. Publishing a value records the
          decision and removes the mark.
        </p>
      </Panel>

      <div className="space-y-4">
        {groups.map(([decisionId, groupRows]) => (
          <Panel key={decisionId} padded={false}>
            <div className="flex flex-wrap items-center gap-2 border-b border-hairline px-4 py-2">
              <span data-figure className="text-sm font-medium text-ink">
                {decisionId}
              </span>
              <span className="text-[11px] text-ink-faint">
                <span data-figure>{groupRows.length}</span>{" "}
                {groupRows.length === 1 ? "rule" : "rules"} ·{" "}
                <span data-figure>
                  {groupRows.filter((r) => r.isOverridden).length}
                </span>{" "}
                resolved
              </span>
            </div>
            <div className="divide-y divide-hairline">
              {groupRows.map((row) => (
                <div key={row.key} className="px-4 py-3">
                  <div className="flex flex-wrap items-baseline gap-2">
                    <span className="text-sm text-ink">{row.label}</span>
                    {row.isOverridden ? (
                      <Chip
                        tone="positive"
                        title={`Published by an administrator. The seeded placeholder was ${String(row.seededValue)}.`}
                      >
                        Resolved
                      </Chip>
                    ) : (
                      <ProvisionalBadge />
                    )}
                    <span className="ml-auto text-[11px] text-ink-faint">
                      {row.unit}
                    </span>
                  </div>

                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    {row.choices ? (
                      <Select
                        aria-label={row.label}
                        className="max-w-[220px]"
                        disabled={!canEdit}
                        value={String(row.effectiveValue)}
                        onChange={(e) => publish(row.key, e.target.value)}
                      >
                        {row.choices.map((choice) => (
                          <option key={choice} value={choice}>
                            {choice}
                          </option>
                        ))}
                      </Select>
                    ) : (
                      <Input
                        aria-label={row.label}
                        className="w-[140px]"
                        inputMode="decimal"
                        disabled={!canEdit}
                        value={String(row.effectiveValue)}
                        onChange={(e) => {
                          const raw = e.target.value.trim();
                          /* Empty is not zero — clearing a field to retype it
                             would otherwise publish a zero on the way through,
                             and zero is a real value for most of these. */
                          if (raw === "") return;
                          if (typeof row.seededValue === "number") {
                            const n = Number(raw);
                            if (Number.isFinite(n)) publish(row.key, n);
                          } else {
                            publish(row.key, raw);
                          }
                        }}
                      />
                    )}
                    {canEdit && row.isOverridden && (
                      <button
                        type="button"
                        onClick={() => clear(row.key)}
                        title="Removes the decision and restores the placeholder. Not the same as publishing the placeholder's value."
                        className="text-xs text-ink-muted underline underline-offset-2 hover:text-ink"
                      >
                        Unpublish
                      </button>
                    )}
                    {row.isOverridden && (
                      <span className="text-[11px] text-ink-faint">
                        placeholder was{" "}
                        <span data-figure>{String(row.seededValue)}</span>
                      </span>
                    )}
                  </div>

                  <p className="mt-2 max-w-[72ch] text-[11px] leading-relaxed text-ink-faint">
                    {row.note}
                  </p>
                  <p className="mt-0.5 max-w-[72ch] text-[11px] leading-relaxed text-ink-faint">
                    <span className="text-ink-muted">Legacy:</span>{" "}
                    {row.legacyBehaviour}
                  </p>
                </div>
              ))}
            </div>
          </Panel>
        ))}
      </div>

      {canEdit && (
        <SettingsSaveBar<RuleOverrides>
          before={stored.data ?? null}
          after={draft}
          dirty={dirty}
          refusal={validateRuleOverrides(draft)}
          error={saveState.error}
          pending={saveState.isPending}
          saved={saved}
          savedNote="Published. These values survive a reload and are what the rules read."
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
