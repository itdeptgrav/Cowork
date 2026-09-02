"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useRepo } from "@/lib/hooks/useRepository";
import {
  getRepositoryVersion,
  subscribeToRepository,
} from "@/lib/repositories/events";
import type {
  AttachmentEntity,
  AttachmentMeta,
} from "@/lib/legacy/attachments";

/**
 * Attachments, for every Cowork feature.
 *
 * Generic on purpose: there is no `ReworkUploader` and no `TaskUploader`, only
 * these, parameterised by `entityType`/`entityId`. A feature-specific uploader
 * is how a validation rule or a permission check comes to exist in one place
 * and not another.
 *
 * **No storage URL is ever constructed here.** Bytes arrive as a blob from the
 * authenticated route and become a short-lived object URL that is revoked when
 * the component unmounts — so nothing on screen is a link somebody can copy
 * out and share past the permission check.
 */

/* The rules live next door, JSX-free, so they can be tested directly. */
export {
  ACCEPT,
  MAX_BYTES,
  fileGlyph,
  formatBytes,
  isPdf,
  isPreviewableImage,
  localRefusal,
} from "./attachmentRules";
import {
  ACCEPT,
  fileGlyph,
  formatBytes,
  isPdf,
  isPreviewableImage,
  localRefusal,
} from "./attachmentRules";
import { formatStamp } from "@/lib/utils/format";

/* ── Download ─────────────────────────────────────────────────────────────── */

/**
 * Fetch and hand over the bytes.
 *
 * `<a download href>` cannot carry an Authorization header, so the file is
 * fetched, turned into an object URL for one click and revoked immediately.
 */
export function FileDownload({
  attachment,
  children,
}: {
  attachment: AttachmentMeta;
  children?: React.ReactNode;
}) {
  const repo = useRepo();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <>
      <button
        type="button"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError(null);
          const r = await repo.downloadAttachment(attachment.id);
          setBusy(false);
          if (!r.ok) {
            setError(r.message);
            return;
          }
          const url = URL.createObjectURL(r.data);
          const a = document.createElement("a");
          a.href = url;
          a.download = attachment.name;
          a.click();
          /* Revoked on the next tick — the click has already been dispatched,
             and holding the URL would leave a shareable handle alive. */
          setTimeout(() => URL.revokeObjectURL(url), 0);
        }}
        className="text-[13px] text-ink underline decoration-[var(--hairline)] underline-offset-2 hover:decoration-current disabled:opacity-60"
      >
        {children ?? (busy ? "Opening…" : "Download")}
      </button>
      {error && (
        <span className="ml-2 text-[12px] text-[var(--danger,#c4553d)]">
          {error}
        </span>
      )}
    </>
  );
}

/* ── Preview ──────────────────────────────────────────────────────────────── */

/**
 * A thumbnail, at thumbnail size.
 *
 * Sized to the CARD rather than to the image — the old version reserved a
 * 96px-tall block per file while its blob loaded, so a section of documents
 * that have no thumbnail at all was a column of empty grey rectangles. It now
 * occupies exactly the square it will fill, and renders nothing for a type that
 * has no preview.
 *
 * Fetched through the repository, so a thumbnail is subject to the same
 * permission check as a download. A preview that skipped it would be the leak
 * this whole system exists to prevent.
 */
export function FilePreview({
  attachment,
  size = 40,
}: {
  attachment: AttachmentMeta;
  size?: number;
}) {
  const repo = useRepo();
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const previewable = isPreviewableImage(attachment.type);

  useEffect(() => {
    if (!previewable) return;
    let objectUrl: string | null = null;
    let cancelled = false;

    void repo.downloadAttachment(attachment.id).then((r) => {
      if (cancelled) return;
      if (!r.ok) {
        setFailed(true);
        return;
      }
      objectUrl = URL.createObjectURL(r.data);
      setUrl(objectUrl);
    });

    /* Revoked on unmount. Without this every previewed image leaks a live
       handle for the lifetime of the tab. */
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [repo, attachment.id, previewable]);

  const box = { width: size, height: size };

  /* A file that cannot be previewed still needs its square filled, or the
     names in a mixed list do not line up. The glyph IS the fallback — there is
     no separate empty state, because "no thumbnail" is not a failure. */
  if (!previewable || failed || !url) {
    return (
      <span
        aria-hidden
        style={box}
        className={`grid shrink-0 place-items-center rounded-inset bg-[var(--surface-sunken)] text-[15px] ${
          previewable && !failed ? "animate-pulse" : ""
        }`}
      >
        {previewable && !failed ? "" : fileGlyph(attachment.type, attachment.name)}
      </span>
    );
  }

  return (
    /* eslint-disable-next-line @next/next/no-img-element --
       A blob: object URL from an authenticated fetch. `next/image` optimises by
       re-fetching the src on its own server, which cannot carry the viewer's
       token and would defeat the permission check this whole system exists for. */
    <img
      src={url}
      alt={attachment.name}
      style={box}
      className="shrink-0 rounded-inset border border-[var(--hairline)] object-cover"
    />
  );
}

/**
 * Open a file in its own tab.
 *
 * The bytes are fetched with the viewer's token and handed to the tab as an
 * object URL — the tab cannot carry an Authorization header itself, and the
 * engine's route requires one. The handle is revoked once the tab has it.
 */
function FileOpen({ attachment }: { attachment: AttachmentMeta }) {
  const repo = useRepo();
  const [busy, setBusy] = useState(false);
  if (!isPreviewableImage(attachment.type) && !isPdf(attachment.type)) {
    return null;
  }
  return (
    <button
      type="button"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        const r = await repo.downloadAttachment(attachment.id);
        setBusy(false);
        if (!r.ok) return;
        const url = URL.createObjectURL(r.data);
        window.open(url, "_blank", "noopener,noreferrer");
        setTimeout(() => URL.revokeObjectURL(url), 60_000);
      }}
      className="rounded-full bg-[var(--control)] px-2.5 py-1 text-[11px] text-ink-muted transition-colors hover:bg-[var(--control-hover)] hover:text-ink disabled:opacity-60"
    >
      {busy ? "Opening…" : "Preview"}
    </button>
  );
}

/* ── List ─────────────────────────────────────────────────────────────────── */

/** One file: what it is, whose it is, and what can be done with it. */
function FileCard({
  attachment,
  onRemove,
}: {
  attachment: AttachmentMeta;
  onRemove?: (id: string) => void;
}) {
  const meta = [
    attachment.size > 0 ? formatBytes(attachment.size) : null,
    attachment.uploadedBy ? `by ${attachment.uploadedBy}` : null,
    attachment.uploadedAt ? formatStamp(attachment.uploadedAt) : null,
  ].filter(Boolean);

  return (
    <li className="group flex items-center gap-3 rounded-inset border border-[var(--hairline)] bg-[var(--surface-sunken)] px-3 py-2.5 transition-colors hover:border-ink/20">
      <FilePreview attachment={attachment} />

      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] leading-snug text-ink">
          {attachment.name}
        </p>
        {meta.length > 0 && (
          <p className="mt-0.5 truncate text-[11px] text-ink-faint">
            {meta.join(" · ")}
          </p>
        )}
      </div>

      {/* Always present rather than revealed on hover: a touch device has no
          hover, and a download that only exists for a mouse is not a control. */}
      <div className="flex shrink-0 items-center gap-1.5">
        <FileOpen attachment={attachment} />
        <FileDownload attachment={attachment} />
        {onRemove && (
          <button
            type="button"
            onClick={() => onRemove(attachment.id)}
            aria-label={`Remove ${attachment.name}`}
            className="rounded-full px-2 py-1 text-[11px] text-ink-faint transition-colors hover:text-[var(--danger,#c4553d)]"
          >
            Remove
          </button>
        )}
      </div>
    </li>
  );
}

export function FileList({
  attachments,
  onRemove,
}: {
  attachments: AttachmentMeta[];
  /** Omitted where files are not the viewer's to remove. */
  onRemove?: (id: string) => void;
}) {
  if (attachments.length === 0) return null;
  return (
    <ul className="mt-2 space-y-1.5">
      {attachments.map((a) => (
        <FileCard key={a.id} attachment={a} onRemove={onRemove} />
      ))}
    </ul>
  );
}

/* ── Uploader ─────────────────────────────────────────────────────────────── */

interface Pending {
  key: string;
  name: string;
  progress: number;
  error: string | null;
}

export function FileUploader({
  entityType,
  entityId,
  attachments,
  onChange,
  label = "Attach reference files",
  staged,
  onStagedChange,
}: {
  entityType: AttachmentEntity;
  /**
   * Null while the thing being attached to does not exist yet.
   *
   * Task creation is the case: the engine checks permission against the TASK,
   * so a file cannot be uploaded before there is a task to check against.
   * Passing null puts this into staging — files are held, listed and removable,
   * and the caller uploads them once it has an id. Same component either way,
   * because a second uploader for "before the record exists" is how two upload
   * paths and two validation rules appear.
   */
  entityId: string | null;
  /** Already uploaded, owned by the caller so it can submit their ids. */
  attachments: AttachmentMeta[];
  onChange: (next: AttachmentMeta[]) => void;
  label?: string;
  /** Staging mode only: files chosen but not yet sent. */
  staged?: File[];
  onStagedChange?: (next: File[]) => void;
}) {
  const repo = useRepo();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [pending, setPending] = useState<Pending[]>([]);

  const isStaging = entityId === null;

  async function send(files: FileList | File[]) {
    /* No id to attach to yet: hold the files and let the caller send them once
       it has one. The same local refusals still apply, so somebody learns about
       an oversized file here rather than after the task is created. */
    if (isStaging) {
      const accepted: File[] = [];
      const refused: Pending[] = [];
      for (const file of Array.from(files)) {
        const refusal = localRefusal(file);
        if (refusal) {
          refused.push({
            key: `${file.name}-${file.size}-staged`,
            name: file.name,
            progress: 0,
            error: refusal,
          });
        } else {
          accepted.push(file);
        }
      }
      if (refused.length) setPending((p) => [...p, ...refused]);
      if (accepted.length) onStagedChange?.([...(staged ?? []), ...accepted]);
      return;
    }

    for (const file of Array.from(files)) {
      const refusal = localRefusal(file);
      const key = `${file.name}-${file.size}-${pending.length}`;
      if (refusal) {
        setPending((p) => [
          ...p,
          { key, name: file.name, progress: 0, error: refusal },
        ]);
        continue;
      }
      setPending((p) => [...p, { key, name: file.name, progress: 0, error: null }]);

      const r = await repo.uploadAttachment({
        file,
        entityType,
        entityId,
        onProgress: (fraction) =>
          setPending((p) =>
            p.map((x) => (x.key === key ? { ...x, progress: fraction } : x)),
          ),
      });

      if (r.ok) {
        /* Functional update: several files can be in flight, and reading the
           prop here would drop every result but the last. */
        setPending((p) => p.filter((x) => x.key !== key));
        onChange([...attachments, r.data]);
      } else {
        setPending((p) =>
          p.map((x) => (x.key === key ? { ...x, error: r.message } : x)),
        );
      }
    }
  }

  return (
    <div>
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          if (e.dataTransfer.files.length) void send(e.dataTransfer.files);
        }}
        onClick={() => inputRef.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            inputRef.current?.click();
          }
        }}
        className={`flex cursor-pointer items-center justify-center rounded-inset border border-dashed px-3.5 py-4 text-[13px] transition-colors ${
          dragging
            ? "border-ink/40 bg-[var(--control)] text-ink"
            : "border-[var(--hairline)] text-ink-faint hover:text-ink-muted"
        }`}
      >
        {label} — drop here or click to browse
      </div>
      <input
        ref={inputRef}
        type="file"
        multiple
        accept={ACCEPT}
        className="hidden"
        onChange={(e) => {
          if (e.target.files?.length) void send(e.target.files);
          /* Cleared so the same file can be chosen again after a removal. */
          e.target.value = "";
        }}
      />

      {pending.length > 0 && (
        <ul className="mt-2 space-y-1">
          {pending.map((p) => (
            <li key={p.key} className="text-[12px]">
              {p.error ? (
                <span className="text-[var(--danger,#c4553d)]">
                  {p.error}{" "}
                  <button
                    type="button"
                    onClick={() =>
                      setPending((prev) => prev.filter((x) => x.key !== p.key))
                    }
                    className="underline underline-offset-2"
                  >
                    Dismiss
                  </button>
                </span>
              ) : (
                <span className="text-ink-faint">
                  {p.name} — <span data-figure>{Math.round(p.progress * 100)}%</span>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}

      {/* Staged files are not attachments yet — no id, nothing stored — so
          they are listed here rather than through `FileList`, which fetches
          previews by id. */}
      {isStaging && (staged?.length ?? 0) > 0 && (
        <ul className="mt-2 space-y-1">
          {staged!.map((f, i) => (
            <li
              key={`${f.name}-${f.size}-${i}`}
              className="flex flex-wrap items-center gap-x-2 text-[13px]"
            >
              <span aria-hidden>{fileGlyph(f.type, f.name)}</span>
              <span className="truncate text-ink">{f.name}</span>
              <span data-figure className="text-[11px] text-ink-faint">
                {formatBytes(f.size)}
              </span>
              <button
                type="button"
                onClick={() =>
                  onStagedChange?.(staged!.filter((_, j) => j !== i))
                }
                className="text-[12px] text-ink-faint underline decoration-[var(--hairline)] underline-offset-2 hover:text-[var(--danger,#c4553d)]"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}

      {!isStaging && (
        <FileList
          attachments={attachments}
          onRemove={async (id) => {
            const r = await repo.deleteAttachment(id);
            if (r.ok) onChange(attachments.filter((a) => a.id !== id));
          }}
        />
      )}
    </div>
  );
}

/** Everything attached to one entity, loaded and rendered read-only. */
export function EntityAttachments({
  entityType,
  entityId,
  title,
  hint,
}: {
  entityType: AttachmentEntity;
  entityId: string;
  /* Rendered only when there is something to head. A caller that printed its
     own heading would show an empty section for every group a task happens not
     to have, which on a task with one kind of file is two of them. */
  title?: string;
  hint?: string;
}) {
  const repo = useRepo();

  /* Three states, and the middle one matters most: before this existed, a
     section that was still loading and a section with nothing in it looked
     identical, so a slow response read as "no files". */
  /* Keyed by entity so a change of task shows ITS loading state rather than the
     previous task's files — and set from the resolved promise rather than
     synchronously in the effect, which cascades a render. */
  const [state, setState] = useState<{
    key: string;
    files: AttachmentMeta[];
    error: string | null;
  } | null>(null);

  /**
   * **Revalidate when the repository changes, not only when the entity does.**
   *
   * This effect keyed on `[repo, entityType, entityId]` alone, so it fetched
   * once and never again. A file uploaded to this very entity — a submission's
   * work, a task's reference file — bumps the repository version but not the
   * entity id, so the list did not re-read and went on showing "No files
   * attached" over a file that was now there. Reported on the Submission tab:
   * the note said a sheet was attached and the section said there was none.
   *
   * Including the version makes it behave like `useQuery` — the standard way
   * every other read in the app stays fresh — so a freshly attached file
   * appears without navigating away and back.
   */
  const version = useSyncExternalStore(
    subscribeToRepository,
    getRepositoryVersion,
    () => 0,
  );

  useEffect(() => {
    let cancelled = false;
    void repo.getAttachments(entityType, entityId).then((r) => {
      if (cancelled) return;
      setState({
        key: `${entityType}:${entityId}`,
        files: r.ok ? r.data : [],
        error: r.ok ? null : r.message,
      });
    });
    return () => {
      cancelled = true;
    };
  }, [repo, entityType, entityId, version]);

  const heading = title ? (
    <>
      <p className="text-[11px] tracking-[0.09em] text-ink-faint uppercase">
        {title}
      </p>
      {hint && <p className="mt-0.5 text-[12px] text-ink-faint">{hint}</p>}
    </>
  ) : null;

  /* Not yet answered FOR THIS ENTITY. Comparing the key rather than holding a
     boolean is what stops a previous task's files showing under a new one. */
  const key = `${entityType}:${entityId}`;
  const settled = state?.key === key ? state : null;
  const files = settled?.files ?? [];
  const error = settled?.error ?? null;

  if (!settled) {
    return (
      <div>
        {heading}
        {/* One row-shaped placeholder, not a block. It occupies what a file
            card occupies, so nothing jumps when the answer arrives. */}
        <div className="mt-2 h-[58px] animate-pulse rounded-inset bg-[var(--surface-sunken)]" />
      </div>
    );
  }

  /*
   * A failure is SHOWN. Rendering null on error is what made a storage outage
   * look like a task with no files — the section simply was not there, so
   * there was nothing to investigate and the fault was chased in the UI for
   * two rounds before anyone looked at the collection.
   */
  if (error) {
    return (
      <div>
        {heading}
        <p className="mt-2 rounded-inset border border-[var(--danger,#c4553d)]/30 bg-[var(--danger,#c4553d)]/[0.06] px-3 py-2.5 text-[12px] text-[var(--danger,#c4553d)]">
          Unable to load files — {error}
        </p>
      </div>
    );
  }

  if (files.length === 0) {
    /* Only where the caller titled the group. An untitled one is embedded in
       somebody else's layout and should stay silent when it has nothing. */
    if (!title) return null;
    return (
      <div>
        {heading}
        <p className="mt-2 text-[12px] text-ink-faint">No files attached</p>
      </div>
    );
  }
  return (
    <div>
      {heading}
      <FileList attachments={files} />
    </div>
  );
}
