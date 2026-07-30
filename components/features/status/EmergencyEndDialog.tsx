"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Icon } from "@/components/ui/Icons";
import {
  Button,
  Field,
  InlineError,
  Textarea,
} from "@/components/ui/Primitives";
import { useAction } from "@/lib/hooks/useRepository";
import { formatDuration } from "@/lib/utils/format";
import { emergencyRequestRefusal } from "@/lib/rules/tasks/emergency";
import { EMERGENCY_DOC_TYPES } from "@/lib/domain";

/**
 * What ending Emergency Mode asks for.
 *
 * **Nothing is applied here.** Legacy shifted every one of the person's due
 * dates from the browser as soon as a manager clicked approve; ending the mode
 * now only raises a request, and the deadlines move — or do not — on the
 * manager's decision alone.
 *
 * The reason is collected HERE rather than on the way in, which is the one
 * deliberate departure from legacy: legacy demanded an explanation before the
 * emergency had happened, so what it recorded was a prediction. Asked at the
 * end, it describes something.
 *
 * The document is required and must be a PDF or a Word file. It is RECORDED,
 * not uploaded — `Attachment.storageKey` is a synthetic handle throughout this
 * prototype, so what is kept is that a file of this name, type and size was
 * supplied. The dialog says so rather than implying a transfer that is not
 * happening.
 */
export function EmergencyEndDialog({
  startedAt,
  endedAt,
  onClose,
  onRaised,
}: {
  startedAt: string;
  endedAt: string;
  onClose: () => void;
  onRaised: () => void;
}) {
  const [reason, setReason] = useState("");
  const [file, setFile] = useState<{
    filename: string;
    mimeType: string;
    sizeBytes: number;
  } | null>(null);

  const durationSecs = Math.max(
    0,
    Math.round((Date.parse(endedAt) - Date.parse(startedAt)) / 1000),
  );

  const [raise, state] = useAction((r) =>
    r.createEmergencyRequest({ startedAt, endedAt, reason, document: file }),
  );

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  /* The client's copy of the rule, from the module the repository refuses with.
     `managerId` is not known here — the repository resolves it — so it is
     passed as present and that one refusal arrives from the server. */
  const refusal = emergencyRequestRefusal({
    durationSecs,
    reason,
    document: file,
    managerId: "unknown",
  });

  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="em-title"
      className="fixed inset-0 z-[95] grid place-items-center p-4"
    >
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 cursor-default bg-[var(--body-bg)]/60 backdrop-blur-[4px]"
      />

      <div className="frost-panel relative w-[min(560px,96vw)] rounded-panel px-6 py-5">
        <h2
          id="em-title"
          className="text-[22px] leading-tight font-light tracking-[-0.03em] text-ink"
        >
          End Emergency Mode
        </h2>
        <p className="mt-1.5 max-w-[56ch] text-sm leading-relaxed text-ink-muted">
          You have been in Emergency Mode for{" "}
          <span className="text-ink">{formatDuration(durationSecs)}</span>. To
          leave it you must record what happened and attach proof — you stay in
          Emergency Mode until this is sent.
        </p>

        <Field label="What happened" required className="mt-4">
          <Textarea
            autoFocus
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Building evacuated after a fire alarm; no access to a machine."
          />
        </Field>

        <div className="mt-4">
          <p className="text-sm font-medium text-ink">
            Supporting document <span className="text-ink-faint">— required</span>
          </p>
          <p className="mt-0.5 text-[11px] text-ink-faint">
            PDF or Word. The file is not uploaded in this prototype — its name,
            type and size are recorded against the request.
          </p>
          <label className="mt-2 flex cursor-pointer items-center gap-3 rounded-inset bg-[var(--surface-sunken)] px-3 py-2.5 transition-colors hover:bg-[var(--control)]">
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[var(--control)] text-ink-faint">
              <Icon.link className="h-4 w-4" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm text-ink">
                {file ? file.filename : "Choose a file"}
              </span>
              <span className="block text-[11px] text-ink-faint">
                {file
                  ? `${Math.max(1, Math.round(file.sizeBytes / 1024))} KB`
                  : "PDF or DOCX"}
              </span>
            </span>
            <input
              type="file"
              className="sr-only"
              accept={EMERGENCY_DOC_TYPES.join(",")}
              onChange={(e) => {
                const f = e.target.files?.[0];
                setFile(
                  f
                    ? {
                        filename: f.name,
                        mimeType: f.type,
                        sizeBytes: f.size,
                      }
                    : null,
                );
              }}
            />
          </label>
        </div>

        {state.error && (
          <div className="mt-4">
            <InlineError message={state.error} code={state.errorCode} />
          </div>
        )}

        <div className="mt-5 flex items-center justify-between gap-3">
          <p className="min-w-0 text-[11px] text-ink-faint">
            {refusal ?? `Goes to your manager for a decision.`}
          </p>
          <div className="flex shrink-0 items-center gap-2">
            <Button tone="ghost" size="sm" onClick={onClose}>
              Stay in Emergency
            </Button>
            <Button
              tone="primary"
              size="sm"
              disabled={!!refusal || state.isPending}
              onClick={async () => {
                const r = await raise();
                if (r.ok) onRaised();
              }}
            >
              {state.isPending ? "Sending…" : "Send for approval"}
            </Button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
