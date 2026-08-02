"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { InlineError, Skeleton } from "@/components/ui/Primitives";
import { DocIcon } from "./docs/DocsIcons";

/**
 * The surface a document or a sheet opens onto: the whole window, always.
 *
 * ## Why there is no windowed mode any more
 *
 * There used to be two: a document sat in a clamped box on the workspace page,
 * and a button maximised it. That is two layouts to keep correct, and the small
 * one was never the right answer — a page of prose in a 520px box scrolls
 * against its own chrome, and a spreadsheet in the right half of a two-column
 * grid shows about six columns. Every serious editor takes the screen, and the
 * ones that offer a small mode are the ones nobody uses it in.
 *
 * Removing it also removes a state that could disagree with itself. The old
 * `full` flag lived in both the editor and the grid, and the browser could turn
 * native fullscreen off underneath it — so there were two booleans describing
 * one thing, kept in step by an effect. There is now one shape.
 *
 * ## What this owns, and what it does not
 *
 * It owns the surface: the fixed frame, the ground under it, and the page's
 * scrollbar while it is up — the document behind must not scroll under a
 * document in front of it. It owns no keys. Escape belongs to whatever is
 * innermost, which inside a document is a menu, then find-and-replace, then a
 * dialog; a stage that grabbed it would close the whole document on the first
 * press meant for one of those.
 */
export function WorkspaceStage({
  label,
  children,
}: {
  /** Named for a screen reader: "Quarterly notes", not "Editor". */
  label: string;
  children: ReactNode;
}) {
  const restore = useRef<string | null>(null);

  useEffect(() => {
    /* Stored and put back rather than set to `auto` on exit — the page may
       have had a scroll lock of its own from something that opened this. */
    restore.current = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = restore.current ?? "";
    };
  }, []);

  return (
    <div
      /* Not `role="dialog"`: this is where the work happens, for as long as it
         takes, and a screen reader announcing a dialog would have somebody
         hunting for the way out of one. It is a region with a name. */
      role="region"
      aria-label={label}
      className="fixed inset-0 z-[90] flex flex-col overflow-hidden bg-[var(--body-bg)]"
    >
      {children}
    </div>
  );
}

/**
 * The header every non-final stage state shares — loading, and refused.
 *
 * Same Back control, same corner, as the real document and sheet headers
 * use. **This is the fix for a real defect**, not decoration: before the
 * stage took the whole window, a document or sheet loading opened into a
 * bounded box on the ordinary page, so a bare `<SkeletonRows>` — a plain list
 * of grey bars with no card, no padding — still sat inside a bordered panel
 * with the top bar above it. Once the stage went full-window, that same bare
 * fallback filled the entire viewport with nothing around it.
 *
 * **`--doc-page`, not `--surface-raised`.** The rest of the app's translucent
 * surface tokens — `--surface-raised` is `rgba(255,255,255,0.05)` in dark
 * mode, `--surface-sunken` is `rgba(0,0,0,0.24)` — are tuned to sit ON TOP OF
 * the moving iridescent field, which is where their contrast comes from. The
 * stage deliberately has no field behind it (`--body-bg` flat, `#0c0c0e`), so
 * both tokens collapse into the same near-black and the first version of this
 * screen read as an empty void with a barely-visible smudge floating in it.
 * `--doc-page` is an opaque, independently-lit colour (`#191920` dark) —
 * "a lifted panel," per its own comment — built to read on its own regardless
 * of what is or is not moving behind it.
 */
function StageChrome({
  onClose,
  right,
  toolbar = false,
}: {
  onClose?: () => void;
  right?: ReactNode;
  /**
   * A second row of small control placeholders. Loading only — an error has
   * no controls coming, and previewing a toolbar there would promise
   * something this screen cannot deliver.
   */
  toolbar?: boolean;
}) {
  return (
    <div className="shrink-0 border-b border-hairline bg-[var(--doc-page)]">
      <div className="flex items-center gap-2 px-3 py-2.5">
        {onClose ? (
          <button
            type="button"
            aria-label="Back"
            title="Back"
            onClick={onClose}
            className="grid h-8 w-8 shrink-0 place-items-center rounded-inset bg-[var(--control)] text-ink-muted transition-colors hover:bg-[var(--control-hover)] hover:text-ink"
          >
            <DocIcon.chevronLeft className="h-4 w-4" />
          </button>
        ) : (
          <span className="h-8 w-8 shrink-0" aria-hidden="true" />
        )}
        {right}
      </div>
      {toolbar && (
        <div className="flex items-center gap-1.5 border-t border-hairline px-3 py-1.5">
          {Array.from({ length: 12 }).map((_, i) => (
            <Skeleton key={i} block className="h-6 w-6 shrink-0" />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Loading. A header shape — title row, then a toolbar row, matching the two
 * strips of chrome the real editor and grid both carry — and a page shape
 * below, centred and given real weight rather than pinned to the top of a
 * mostly-empty frame. It previews what is coming instead of describing
 * "loading" in the abstract, and it keeps a working way out: a load that
 * hangs on a slow connection must not be a dead end just because it is brief
 * in the common case.
 */
export function StageSkeleton({ onClose }: { onClose?: () => void }) {
  return (
    <div className="flex h-full min-h-0 flex-col" role="status" aria-label="Loading">
      <StageChrome
        onClose={onClose}
        toolbar
        right={
          <>
            <Skeleton className="h-4 w-40" />
            <span className="ml-auto flex shrink-0 items-center gap-1.5">
              <Skeleton block className="h-7 w-7" />
              <Skeleton block className="h-7 w-7" />
            </span>
          </>
        }
      />
      <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden px-6 py-8">
        <div className="flex w-full max-w-[760px] flex-col gap-3 rounded-[3px] border border-hairline bg-[var(--doc-page)] p-9 shadow-[var(--shadow-deck-seat)]">
          <Skeleton className="h-6 w-1/2" />
          <div className="mt-3 flex flex-col gap-3.5">
            {Array.from({ length: 9 }).map((_, i) => (
              <Skeleton
                key={i}
                className="h-3.5"
                style={{ width: `${64 + ((i * 13) % 32)}%` }}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Refused or gone — deleted, or a permission that no longer reaches it. The
 * same header as loading, minus the toolbar row it cannot promise, so leaving
 * works exactly the way it does everywhere else in the stage rather than
 * depending on the browser's own Back button. The message sits on the same
 * `--doc-page` card as the loading state, for the same reason: a bare message
 * on a flat, field-less frame is the same "is this broken" failure as before.
 */
export function StageError({
  message,
  onClose,
}: {
  message: string;
  onClose?: () => void;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <StageChrome onClose={onClose} />
      <div className="grid min-h-0 flex-1 place-items-center px-6">
        <div className="max-w-[420px] rounded-[3px] border border-hairline bg-[var(--doc-page)] p-6 shadow-[var(--shadow-deck-seat)]">
          <InlineError message={message} />
        </div>
      </div>
    </div>
  );
}
