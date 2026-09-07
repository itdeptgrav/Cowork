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
import type { LocalFileBinding } from "./useLocalFileBinding";

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

/**
 * The file on this computer, when there is one.
 *
 * A SECOND chip rather than a merged one, because they are two different
 * places: a sheet can be saved in Cowork and stale on disk, or the other way
 * round, and one chip would have to pick which truth to tell. Absent entirely
 * when no file is bound, so a sheet that lives only in Cowork looks exactly as
 * it did before this existed.
 */
function FileChip({ local }: { local: LocalFileBinding }) {
  if (local.state === "none" || !local.fileName) return null;
  const denied = local.state === "denied";
  const failed = local.state === "error";

  /* The file moved under us AND there are edits here that a reload would
     discard. Shown ahead of the ordinary states because it is the only one
     where doing nothing loses something. */
  if (local.externalChange) {
    return (
      <div
        className="flex min-w-0 shrink-0 items-center gap-1.5 text-[12px]"
        title={`${local.fileName} changed on this computer. Reloading discards what you have typed since.`}
        role="status"
        aria-live="polite"
      >
        <span aria-hidden className="h-2 w-2 rounded-full" style={{ background: "#d0a215" }} />
        <span className="text-ink-muted">File changed on disk</span>
        <button
          type="button"
          onClick={() => void local.reloadFromFile()}
          className="rounded-full px-2 py-0.5 text-ink transition-colors hover:bg-[color-mix(in_srgb,var(--ink)_8%,transparent)]"
        >
          Reload
        </button>
      </div>
    );
  }
  return (
    <div
      className="flex min-w-0 shrink-0 items-center gap-1.5 text-[12px]"
      title={
        local.errorMessage ??
        (denied
          ? "Cowork's permission to write to this file has lapsed."
          : `Saving to ${local.fileName} on this computer`)
      }
      role="status"
      aria-live="polite"
    >
      <span
        aria-hidden
        className={`h-2 w-2 rounded-full ${local.state === "saving" ? "animate-pulse" : ""}`}
        style={{
          background: denied || failed ? "#c0392b" : local.state === "saving" ? "#d0a215" : "#3f9142",
        }}
      />
      <span className="max-w-[180px] truncate text-ink-muted">
        {denied ? "File disconnected" : failed ? "File not saved" : local.fileName}
      </span>
      {/* Reconnecting raises a browser prompt, and a prompt only opens from a
          real click — which is exactly why this is a button and not a retry
          the chip could have attempted on its own. */}
      {(denied || failed) && (
        <button
          type="button"
          onClick={() => void local.reconnect()}
          className="rounded-full px-2 py-0.5 text-ink transition-colors hover:bg-[color-mix(in_srgb,var(--ink)_8%,transparent)]"
        >
          Reconnect
        </button>
      )}
    </div>
  );
}

export function WorkbookHeader({
  persistence,
  onBack,
  collab,
  local,
  notice,
}: {
  persistence: WorkbookPersistence;
  onBack?: () => void;
  collab?: WorkbookCollab;
  /** The file on disk this sheet is bound to, if any. */
  local?: LocalFileBinding;
  /**
   * A passing line about what just happened — a file opened, a copy made.
   *
   * **On the header line, not above the ribbon.** It used to sit in a row of
   * its own between the two, which pushed the whole toolbar down and then let
   * it spring back six seconds later; every notice moved the tabs under the
   * pointer. Up here it sits with the other things that report state, and
   * changing it moves nothing.
   */
  notice?: string | null;
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
      {notice && (
        /* `min-w-0 truncate` and the title's own `flex-1` share the row: a long
           file name shortens rather than pushing the save chip off the end. */
        <span
          role="status"
          aria-live="polite"
          title={notice}
          className="ms-auto min-w-0 max-w-[46ch] truncate text-[12px] text-ink-muted"
        >
          {notice}
        </span>
      )}
      {local && <FileChip local={local} />}
      <SaveChip persistence={persistence} />
    </div>
  );
}
