"use client";

/**
 * The workbook's header line — its title, and where it stands with saving.
 *
 * The title is editable in place and renames the workbook on commit. The chip on
 * the right is the save state (requirement 7): a quiet "Saved", a live
 * "Saving…", or an "Offline"/"Error"/"Edited elsewhere" that offers a retry.
 * None of it blocks editing — the grid stays live whatever the chip says.
 */

import type { SaveState, WorkbookPersistence } from "./useWorkbookPersistence";
import { Presence } from "@/components/features/workspace/Presence";
import type { WorkbookCollab } from "./useWorkbookCollab";

const LABEL: Record<SaveState, string> = {
  loading: "Loading…",
  saving: "Saving…",
  saved: "Saved",
  offline: "Offline",
  error: "Couldn’t save",
  conflict: "Edited elsewhere",
};

const DOT: Record<SaveState, string> = {
  loading: "var(--ink-faint)",
  saving: "#d0a215",
  saved: "#3f9142",
  offline: "var(--ink-muted)",
  error: "#c0392b",
  conflict: "#c0392b",
};

function SaveChip({ persistence }: { persistence: WorkbookPersistence }) {
  const { state, errorMessage, retry } = persistence;
  const canRetry = state === "offline" || state === "error" || state === "conflict";
  return (
    <div
      className="flex shrink-0 items-center gap-1.5 text-[12px]"
      title={errorMessage ?? undefined}
      /* Saving is background work, so its state has to be announced rather than
         seen — a screen-reader user never looks at the chip. */
      role="status"
      aria-live="polite"
    >
      <span
        aria-hidden
        className={`h-2 w-2 rounded-full ${state === "saving" || state === "loading" ? "animate-pulse" : ""}`}
        style={{ background: DOT[state] }}
      />
      <span className="text-ink-muted">{LABEL[state]}</span>
      {canRetry && (
        <button
          type="button"
          onClick={retry}
          className="rounded-full px-2 py-0.5 text-ink transition-colors hover:bg-[color-mix(in_srgb,var(--ink)_8%,transparent)]"
        >
          Retry
        </button>
      )}
    </div>
  );
}

export function WorkbookHeader({
  persistence,
  onBack,
  collab,
}: {
  persistence: WorkbookPersistence;
  onBack?: () => void;
  collab?: WorkbookCollab;
}) {
  return (
    <div className="flex shrink-0 items-center justify-between gap-3">
      {onBack && (
        <button
          type="button"
          onClick={onBack}
          title="Back to all sheets"
          className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-[13px] text-ink-muted transition-colors hover:bg-[color-mix(in_srgb,var(--ink)_8%,transparent)] hover:text-ink"
        >
          ← All sheets
        </button>
      )}
      {/* Uncontrolled, keyed on the canonical title: a load or rename remounts it
          with the new value, while a live edit stays local until it commits. */}
      <input
        key={persistence.title}
        aria-label="Workbook title"
        defaultValue={persistence.title}
        onBlur={(e) => persistence.rename(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          else if (e.key === "Escape") {
            e.currentTarget.value = persistence.title;
            e.currentTarget.blur();
          }
        }}
        className="min-w-0 max-w-[320px] flex-1 rounded-md bg-transparent px-1.5 py-0.5 text-[17px] font-medium text-ink outline-none transition-colors hover:bg-[color-mix(in_srgb,var(--ink)_6%,transparent)] focus:bg-[color-mix(in_srgb,var(--ink)_6%,transparent)]"
      />
      {collab?.connected && <Presence peers={collab.peers} />}
      {collab && !collab.connected && collab.reason && persistence.workbookId && (
        <span className="hidden text-[11px] text-ink-faint md:inline" title={collab.reason}>
          Live editing off
        </span>
      )}
      <SaveChip persistence={persistence} />
    </div>
  );
}
