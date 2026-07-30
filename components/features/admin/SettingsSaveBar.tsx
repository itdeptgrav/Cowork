"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import {
  Button,
  Field,
  InlineError,
  Input,
} from "@/components/ui/Primitives";
import {
  affectsDeadlines,
  diffFields,
  type AuditField,
} from "@/lib/rules/settings/audit";

/**
 * Save, with what is about to change shown first.
 *
 * **One component so no section can forget the confirmation.** The office-hours
 * panel had a review dialog; the provisional-rules panel, writing the same
 * document, had a bare Save button. Two editors for one document with two
 * different levels of care is how a change that moves every deadline in the
 * company gets made by accident.
 *
 * ## The diff is the audit entry's diff
 *
 * `diffFields` is the same function the audit log records with, so the rows a
 * person confirms are exactly the rows that will be written. A separately-built
 * preview drifts, and then the screen and the log describe the same save
 * differently — which is worse than no preview, because both look authoritative.
 *
 * ## Why the deadline warning is derived, not passed in
 *
 * `affectsDeadlines` reads the changed paths. A timezone edit and a holiday edit
 * are the same section and not the same consequence, so a section-level flag
 * would either warn about everything or miss the holiday. The section registry's
 * `mayAffectDeadlines` decides whether a section *can* — this decides whether
 * this particular save does.
 */
export function SettingsSaveBar<T>({
  before,
  after,
  dirty,
  refusal,
  error,
  pending,
  saved,
  onSave,
  onDiscard,
  savedNote,
}: {
  before: T | null;
  after: T;
  dirty: boolean;
  /** Why this cannot be saved, from the section's own validation. */
  refusal: string | null;
  /** A failure from the last attempt. */
  error: string | null;
  pending: boolean;
  saved: boolean;
  onSave: (reason: string) => Promise<{ ok: boolean }>;
  onDiscard: () => void;
  /** What to say after a successful save. Section-specific. */
  savedNote: string;
}) {
  const [confirming, setConfirming] = useState(false);
  const [reason, setReason] = useState("");

  const fields = diffFields(before ?? {}, after);
  const touchesDeadlines = affectsDeadlines(fields);

  return (
    <>
      {(refusal || error) && (
        <div className="mt-4">
          <InlineError message={refusal ?? error ?? ""} />
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-hairline pt-4">
        <p className="min-w-0 flex-1 text-[11px] text-ink-faint">
          {dirty ? (
            <>
              <span data-figure>{fields.length}</span>{" "}
              {fields.length === 1 ? "change" : "changes"} not saved.
            </>
          ) : saved ? (
            savedNote
          ) : (
            "No changes."
          )}
        </p>
        {dirty && !pending && (
          <button
            type="button"
            onClick={() => {
              onDiscard();
              setReason("");
            }}
            className="text-xs text-ink-muted underline underline-offset-2 hover:text-ink"
          >
            Discard changes
          </button>
        )}
        <Button
          tone="primary"
          size="sm"
          disabled={!dirty || !!refusal || pending}
          onClick={() => setConfirming(true)}
        >
          Review and save
        </Button>
      </div>

      {confirming && (
        <ConfirmSettingsChange
          fields={fields}
          touchesDeadlines={touchesDeadlines}
          reason={reason}
          onReason={setReason}
          pending={pending}
          onCancel={() => setConfirming(false)}
          onConfirm={async () => {
            const result = await onSave(reason);
            if (result.ok) {
              setConfirming(false);
              setReason("");
            }
          }}
        />
      )}
    </>
  );
}

/**
 * What is about to change, and what it touches.
 *
 * The deadline line is a **warning about recalculation, not a threat to the
 * commitment**, and it says which. `deadline.dueAt` is legacy's stored figure and
 * scoring measures against it; what moves is `operationalDueAt`, derived per read
 * from the queue and the calendar. Saying "your deadlines will change" without
 * that distinction would make an administrator afraid of a correct edit.
 */
function ConfirmSettingsChange({
  fields,
  touchesDeadlines,
  reason,
  onReason,
  pending,
  onCancel,
  onConfirm,
}: {
  fields: AuditField[];
  touchesDeadlines: boolean;
  reason: string;
  onReason: (v: string) => void;
  pending: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  if (typeof document === "undefined") return null;
  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="settings-confirm"
      className="fixed inset-0 z-[95] grid place-items-center p-4"
    >
      <button
        type="button"
        aria-label="Close"
        onClick={onCancel}
        className="absolute inset-0 cursor-default bg-[var(--body-bg)]/60 backdrop-blur-[4px]"
      />
      <div className="frost-panel relative w-[min(560px,96vw)] rounded-panel px-6 py-5">
        <h2
          id="settings-confirm"
          className="text-[22px] leading-tight font-light tracking-[-0.03em] text-ink"
        >
          {touchesDeadlines
            ? "This change may recalculate active task deadlines"
            : "Confirm this change"}
        </h2>

        {touchesDeadlines && (
          <p className="mt-2 text-sm leading-relaxed text-ink-muted">
            Committed deadlines are not moved. What is recalculated is the
            operational date — when the work is now expected to finish once it is
            laid out through the working calendar.
          </p>
        )}

        <ul className="mt-4 flex max-h-[280px] flex-col gap-3 overflow-y-auto scroll-slim">
          {fields.map((field) => (
            <li key={field.path}>
              <p className="text-[11px] tracking-[0.09em] text-ink-faint uppercase">
                {field.path}
              </p>
              <p className="mt-0.5 text-sm text-ink-muted">
                {show(field.oldValue)}
              </p>
              <p className="text-sm text-ink">↓ {show(field.newValue)}</p>
            </li>
          ))}
        </ul>

        <Field
          label="Why (optional)"
          hint="Recorded against this entry in the audit log."
          className="mt-4"
        >
          <Input
            value={reason}
            onChange={(e) => onReason(e.target.value)}
            placeholder="e.g. Board approved the revised working week"
          />
        </Field>

        <div className="mt-5 flex justify-end gap-2">
          <Button tone="ghost" size="sm" onClick={onCancel}>
            Cancel
          </Button>
          <Button tone="primary" size="sm" disabled={pending} onClick={onConfirm}>
            {pending ? "Saving…" : touchesDeadlines ? "Continue" : "Save"}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/**
 * A value as a person reads it.
 *
 * The same three cases `describeField` uses for the log — "not set" for absent,
 * strings bare, everything else as JSON — so a null reads identically in the
 * dialog somebody confirms and in the row that records it. The dialog stacks the
 * two halves with an arrow instead of joining them, which is why it formats one
 * value rather than calling that function.
 */
function show(value: unknown): string {
  if (value === null || value === undefined) return "not set";
  return typeof value === "string" ? value : JSON.stringify(value);
}
