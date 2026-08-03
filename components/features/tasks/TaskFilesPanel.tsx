"use client";

import { useMemo, useState } from "react";
import type { AttachmentMeta } from "@/lib/legacy/attachments";
import type { CoworkRepository, TaskView } from "@/lib/repositories";
import {
  FileDownload,
  FilePreview,
  FileUploader,
  fileGlyph,
} from "@/components/features/attachments/Attachments";
import { DriveImage } from "@/components/ui/DriveImage";
import { mediaUrl } from "@/components/features/messages/MessageAttachments";
import { Icon } from "@/components/ui/Icons";
import {
  EmptyState,
  InlineError,
  Input,
  Panel,
  SkeletonRows,
} from "@/components/ui/Primitives";
import { useQuery } from "@/lib/hooks/useRepository";
import { formatStamp } from "@/lib/utils/format";
import {
  KIND_LABEL,
  KIND_ORDER,
  NO_FILTER,
  SOURCE_HINT,
  SOURCE_LABEL,
  SOURCE_ORDER,
  countByKind,
  countBySource,
  filterTaskFiles,
  fromAttachments,
  fromChat,
  fromReports,
  sortTaskFiles,
  submissionContext,
  totalSize,
  type FileKind,
  type FileSource,
  type TaskFile,
} from "@/lib/rules/tasks/taskFiles";

/**
 * Every file on one task, in one place.
 *
 * ## Why this is a tab and not another card on Overview
 *
 * A task's files used to be three read-only groups near the top of Overview,
 * and everything else — chat attachments, files on daily reports — was
 * reachable only by scrolling the thread that carried it. Somebody looking for
 * "the spec" had to remember which surface it arrived through, which is the one
 * thing nobody remembers. The tab pools all five origins and keeps the origin
 * as a FILTER rather than as a place you have to go.
 *
 * The pooling rules — classification, ordering, filtering, counting — are in
 * `lib/rules/tasks/taskFiles.ts` and tested there. This file fetches and draws.
 *
 * ## The distinction this screen must not blur
 *
 * Reference, submitted and correction files are PRIVATE: stored by the engine
 * and streamed back only to somebody it will show the task to. Chat and report
 * files are public media — anybody holding the URL can open them. Both were
 * already true; collecting them into one list is what makes it worth saying, so
 * every link-access row is marked and the note under the list explains it once.
 */

/* ── Fetch ────────────────────────────────────────────────────────────────── */

interface Collected {
  files: TaskFile[];
  /**
   * Origins that could not be read, named.
   *
   * A partial answer is the honest one here: if the chat read fails there is no
   * reason to withhold the reference files that loaded. But a silent partial
   * answer is how "the file is gone" gets reported, so each failure appears as
   * itself rather than as a shorter list.
   */
  problems: string[];
}

async function collect(
  r: CoworkRepository,
  taskId: string,
): Promise<Collected> {
  const files: TaskFile[] = [];
  const problems: string[] = [];

  /* `allSettled`, not `all`: five independent reads, and one rejection must not
     take the other four with it. The task's own submissions are needed before
     their files can be asked for, so that pair runs as one step. */
  const [reference, correction, submissions, reports, chat, draft] =
    await Promise.allSettled([
      r.getAttachments("task", taskId),
      r.getAttachments("rework", taskId),
      r.listSubmissions(taskId),
      r.listDailyReports(taskId),
      r.listTaskChat(taskId, "chat"),
      r.listTaskChat(taskId, "draft"),
    ]);

  /**
   * A private group, and the two ways it can fail to arrive.
   *
   * A rejection is the proxy refusing (this repository has no such method); a
   * `!ok` result is the engine answering with a reason. They read differently
   * and only the second has anything to quote, but both mean the same thing to
   * somebody looking for a file: this origin is not in the list below.
   */
  function privateGroup(
    settled: PromiseSettledResult<Awaited<ReturnType<CoworkRepository["getAttachments"]>>>,
    source: "reference" | "correction",
    context: string,
    label: string,
  ) {
    if (settled.status === "rejected") {
      problems.push(`${label} could not be read.`);
      return;
    }
    if (!settled.value.ok) {
      problems.push(`${label} could not be read — ${settled.value.message}`);
      return;
    }
    files.push(...fromAttachments(settled.value.data, source, context));
  }

  privateGroup(reference, "reference", "Supplied with the task", "Reference files");
  privateGroup(
    correction,
    "correction",
    "Sent back for correction",
    "Correction files",
  );

  if (submissions.status === "rejected") {
    problems.push("Submitted work could not be read.");
  } else {
    /* One read per attempt. Each attempt's files hang off THAT submission's
       id — pooling them under the task would lose which version of the work a
       file belongs to, which is the whole audit trail after a rework. */
    const perAttempt = await Promise.allSettled(
      submissions.value.map(async (sub) => ({
        sub,
        res: await r.getAttachments("submission", sub.id),
      })),
    );
    for (const entry of perAttempt) {
      if (entry.status === "rejected") {
        problems.push("Files on one submission could not be read.");
        continue;
      }
      const { sub, res } = entry.value;
      if (!res.ok) {
        problems.push(
          `Files on ${submissionContext(sub).toLowerCase()} could not be read — ${res.message}`,
        );
        continue;
      }
      files.push(
        ...fromAttachments(res.data, "submission", submissionContext(sub)),
      );
    }
  }

  if (reports.status === "rejected") {
    problems.push("Daily reports could not be read.");
  } else {
    files.push(...fromReports(reports.value));
  }

  /* Both threads feed one Chat filter. Which thread a file came through is kept
     as its context line, because the negotiation thread is where the terms were
     argued and that is worth being able to tell. */
  for (const [settled, label] of [
    [chat, "Chat"],
    [draft, "The negotiation thread"],
  ] as const) {
    if (settled.status === "rejected") {
      problems.push(`${label} could not be read.`);
      continue;
    }
    files.push(...fromChat(settled.value));
  }

  return { files: sortTaskFiles(files), problems };
}

/* ── Chips ────────────────────────────────────────────────────────────────── */

function FilterChip({
  label,
  count,
  active,
  title,
  onClick,
}: {
  label: string;
  count: number;
  active: boolean;
  title?: string;
  onClick: () => void;
}) {
  /* A filter that can only ever return nothing is not offered. It reads as a
     control that is broken rather than as a category this task has none of —
     and the counts beside the ones that remain already say how much is where. */
  if (count === 0) return null;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      title={title}
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1 text-[13px] font-medium tracking-[-0.012em] transition-[color,background-color] duration-[180ms] ease-[var(--ease-deck)] ${
        active
          ? "bg-ink text-[var(--body-bg)]"
          : "bg-[var(--control)] text-ink-muted hover:bg-[var(--control-hover)] hover:text-ink"
      }`}
    >
      {label}
      <span
        data-figure
        className={`text-[11px] ${active ? "opacity-70" : "text-ink-faint"}`}
      >
        {count}
      </span>
    </button>
  );
}

/* ── One row ──────────────────────────────────────────────────────────────── */

function Thumb({ file }: { file: TaskFile }) {
  if (file.handle.via === "attachment") {
    return <FilePreview attachment={file.handle.attachment} />;
  }
  if (file.kind === "image" && file.handle.via === "media") {
    return (
      <span className="grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-md bg-[var(--surface-sunken)]">
        <DriveImage
          fileId={file.handle.media.fileId}
          url={file.handle.media.url}
          alt=""
          width={80}
          className="h-10 w-10 object-cover"
        />
      </span>
    );
  }
  return (
    <span
      aria-hidden="true"
      className="grid h-10 w-10 shrink-0 place-items-center rounded-md bg-[var(--surface-sunken)] text-[15px]"
    >
      {fileGlyph(file.kind === "voice" ? "audio/x" : "", file.name)}
    </span>
  );
}

function FileRow({ file }: { file: TaskFile }) {
  const meta = [
    SOURCE_LABEL[file.source] === file.context
      ? file.context
      : `${SOURCE_LABEL[file.source]} · ${file.context}`,
    file.uploadedBy ? `by ${file.uploadedBy}` : null,
    file.uploadedAt ? formatStamp(file.uploadedAt) : null,
  ].filter(Boolean);

  return (
    <li className="flex items-center gap-3 rounded-inset border border-[var(--hairline)] bg-[var(--surface-sunken)] px-3 py-2.5 transition-colors hover:border-ink/20">
      <Thumb file={file} />

      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] leading-snug text-ink">{file.name}</p>
        <p className="mt-0.5 truncate text-[11px] text-ink-faint">
          {meta.join(" · ")}
        </p>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        {/* Said on the row, not only in the note below it: a reader deciding
            whether to forward a file needs to know which kind it is at the
            moment they are looking at it. */}
        {file.access === "link" && (
          <span
            title="Stored as shared media — anyone with the link can open it. Reference, submitted and correction files are private to this task."
            className="hidden rounded-full bg-[var(--control)] px-2 py-0.5 text-[10px] tracking-[0.04em] text-ink-faint uppercase sm:inline"
          >
            Link
          </span>
        )}
        {file.handle.via === "attachment" ? (
          <FileDownload attachment={file.handle.attachment} />
        ) : (
          <a
            href={
              file.handle.via === "media"
                ? mediaUrl(file.handle.media)
                : file.handle.url
            }
            target="_blank"
            rel="noreferrer"
            className="text-[13px] text-ink underline decoration-[var(--hairline)] underline-offset-2 hover:decoration-current"
          >
            Open
          </a>
        )}
      </div>
    </li>
  );
}

/* ── The tab ──────────────────────────────────────────────────────────────── */

export function TaskFilesPanel({ view }: { view: TaskView }) {
  const taskId = view.task.id;
  const {
    data,
    isLoading,
    error,
    refetch,
  } = useQuery((r) => collect(r, taskId), [taskId, view.task.updatedAt]);

  const [sources, setSources] = useState<FileSource[]>([]);
  const [kinds, setKinds] = useState<FileKind[]>([]);
  const [query, setQuery] = useState("");
  /* Files uploaded here in this session, so a new reference file appears
     immediately rather than after the next task read. */
  const [added, setAdded] = useState<AttachmentMeta[]>([]);

  const all = useMemo(() => {
    const fresh = fromAttachments(added, "reference", "Supplied with the task");
    /* An upload that has already come back in the fetched list must not appear
       twice — the key is the attachment id, so identity is the test. */
    const known = new Set((data?.files ?? []).map((f) => f.key));
    return sortTaskFiles([
      ...(data?.files ?? []),
      ...fresh.filter((f) => !known.has(f.key)),
    ]);
  }, [data, added]);

  /* Counted over everything, never over the filtered list — a chip reading
     "Chat 0" because you are filtered to Reports describes the filter rather
     than the task. */
  const bySource = countBySource(all);
  const byKind = countByKind(all);
  const shown = filterTaskFiles(all, { sources, kinds, query });
  const filtered = sources.length > 0 || kinds.length > 0 || query.trim() !== "";
  const size = totalSize(all);

  function toggle<T>(list: T[], set: (next: T[]) => void, value: T) {
    set(list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);
  }

  return (
    <Panel>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className="text-sm font-medium text-ink">Files</h2>
        {!isLoading && (
          <p className="text-[11px] text-ink-faint">
            <span data-figure>{all.length}</span>
            {all.length === 1 ? " file" : " files"}
            {/* The pair, not a bare total: chat and report files record no size
                at all, so a lone figure would read as the whole. */}
            {size.covered > 0 && (
              <>
                {" · "}
                <span data-figure>{formatBytes(size.bytes)}</span>
                {size.covered < size.total && (
                  <> across {size.covered} of {size.total}</>
                )}
              </>
            )}
          </p>
        )}
      </div>

      {isLoading ? (
        <div className="mt-3">
          <SkeletonRows rows={4} />
        </div>
      ) : error ? (
        <div className="mt-3">
          <InlineError message={error} onRetry={refetch} />
        </div>
      ) : (
        <>
          {/* Named failures, above the list, so a missing origin is visible
              rather than inferred from a file that is not there. */}
          {(data?.problems.length ?? 0) > 0 && (
            <ul className="mt-3 space-y-1">
              {data?.problems.map((p) => (
                <li
                  key={p}
                  className="rounded-inset border border-[var(--danger,#c4553d)]/30 bg-[var(--danger,#c4553d)]/[0.06] px-3 py-2 text-[12px] text-[var(--danger,#c4553d)]"
                >
                  {p}
                </li>
              ))}
            </ul>
          )}

          {all.length > 0 && (
            <div className="mt-3 space-y-2">
              <label className="relative block">
                <span className="sr-only">Search files on this task</span>
                <Icon.search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-ink-faint" />
                <Input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search by name, where it came from, or who sent it"
                  className="!pl-9"
                />
              </label>

              {/* Where it came from, then what it is — the order people
                  actually remember a file in. Both rails scroll rather than
                  wrap into a block of buttons on a narrow window. */}
              <div className="rail flex items-center gap-1.5 overflow-x-auto">
                {SOURCE_ORDER.map((s) => (
                  <FilterChip
                    key={s}
                    label={SOURCE_LABEL[s]}
                    count={bySource[s]}
                    active={sources.includes(s)}
                    title={SOURCE_HINT[s]}
                    onClick={() => toggle(sources, setSources, s)}
                  />
                ))}
              </div>
              <div className="rail flex items-center gap-1.5 overflow-x-auto">
                {KIND_ORDER.map((k) => (
                  <FilterChip
                    key={k}
                    label={KIND_LABEL[k]}
                    count={byKind[k]}
                    active={kinds.includes(k)}
                    onClick={() => toggle(kinds, setKinds, k)}
                  />
                ))}
              </div>
            </div>
          )}

          {shown.length > 0 ? (
            <ul className="mt-3 space-y-1.5">
              {shown.map((f) => (
                <FileRow key={f.key} file={f} />
              ))}
            </ul>
          ) : filtered ? (
            /* A filtered-to-nothing list and a task with no files are different
               facts, and only one of them is fixed by clearing the filter. */
            <EmptyState
              compact
              title="Nothing matches that"
              body="No file on this task matches the filters you have set."
              action={
                <button
                  type="button"
                  onClick={() => {
                    setSources([]);
                    setKinds([]);
                    setQuery("");
                  }}
                  className="rounded-full bg-[var(--control)] px-3 py-1.5 text-[13px] text-ink transition-colors hover:bg-[var(--control-hover)]"
                >
                  Clear filters
                </button>
              }
            />
          ) : (
            <EmptyState
              compact
              title="No files on this task yet"
              body="Reference material, anything sent in the chat, files on a daily report and submitted work all collect here."
            />
          )}

          {/* Adding to the task's own reference set — the group that means
              "what this work is done from". Not gated by role: the engine
              checks against the task, and a second rule here is how the two
              come to disagree. */}
          <div className="mt-4 border-t border-hairline pt-4">
            <FileUploader
              entityType="task"
              entityId={taskId}
              attachments={added}
              onChange={setAdded}
              label="Add reference files"
            />
          </div>

          {all.some((f) => f.access === "link") && (
            <p className="mt-3 text-[11px] leading-relaxed text-ink-faint">
              Files marked <span className="text-ink-muted">Link</span> — those
              sent in the chat or attached to a daily report — are stored as
              shared media, so anybody with the address can open one. Reference,
              submitted and correction files are private to this task and are
              served only to people who can already see it.
            </p>
          )}
        </>
      )}
    </Panel>
  );
}

/** Bytes in the shortest honest unit. Local so the panel has no reason to
 *  import a component module for a number formatter. */
function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
