"use client";

import { useState } from "react";
import {
  Button,
  Field,
  InlineError,
  Input,
  Panel,
  PanelHead,
} from "@/components/ui/Primitives";
import { useAction, useQuery } from "@/lib/hooks/useRepository";
import { formatDuration } from "@/lib/utils/format";

/**
 * The daily break allowance.
 *
 * Legacy kept this on a single `cowork_settings/office` document, read by
 * `getMaxBreakSecs()` and defaulting to sixty minutes when unset. This is that
 * setting, edited under `score.configure` — the capability every other
 * organisation-wide policy on this screen already uses, so it introduces no new
 * permission.
 *
 * **The copy is careful about what the number does**, because getting this
 * wrong would change the product. It bounds how much break time is credited
 * back to deadlines in a day. It is not a limit on rest, it does not stop
 * anybody taking a break, and nothing refuses a break when it runs out.
 */
export function BreakAllowanceEditor({ canEdit }: { canEdit: boolean }) {
  const settings = useQuery((r) => r.getOrganisationSettings(), []);
  const [draft, setDraft] = useState<string | null>(null);
  const [save, state] = useAction((r, minutes: number) =>
    r.setMaxBreakMinutesPerDay(minutes),
  );

  const current = settings.data?.maxBreakMinutesPerDay ?? null;
  const value = draft ?? (current === null ? "" : String(current));
  const parsed = Number(value);
  const dirty = current !== null && parsed !== current;

  return (
    <Panel>
      <PanelHead
        title="Break allowance"
        sub="How much break time a day is credited back to deadlines, per person"
      />

      <p className="mt-1 max-w-[70ch] text-xs leading-relaxed text-ink-muted">
        When somebody ends a break, that time is added to the deadlines of every
        live task they hold — up to this much per day. Beyond it a break still
        happens and is still recorded; it simply stops moving deadlines.{" "}
        <span className="text-ink">Nobody is prevented from taking a break.</span>{" "}
        A break moves the working deadline only, never the scored one, so it
        gives time back without forgiving lateness.
      </p>

      {state.error && (
        <div className="mt-3">
          <InlineError message={state.error} code={state.errorCode} />
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-end gap-3">
        <Field label="Minutes per day" className="w-[180px]">
          <Input
            type="number"
            min={1}
            max={24 * 60}
            value={value}
            disabled={!canEdit || settings.isLoading}
            onChange={(e) => setDraft(e.target.value)}
          />
        </Field>
        <p className="pb-2 text-[11px] text-ink-faint">
          {Number.isFinite(parsed) && parsed > 0
            ? `${formatDuration(Math.round(parsed) * 60)} a day`
            : "—"}
        </p>
        {canEdit && (
          <Button
            size="sm"
            tone="primary"
            className="mb-1"
            disabled={!dirty || !Number.isFinite(parsed) || state.isPending}
            onClick={async () => {
              const r = await save(Math.round(parsed));
              if (r.ok) setDraft(null);
            }}
          >
            {state.isPending ? "Saving…" : "Save"}
          </Button>
        )}
      </div>
    </Panel>
  );
}
