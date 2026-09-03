"use client";

import { useMemo, useState } from "react";
import {
  Button,
  Chip,
  Field,
  InlineError,
  Panel,
  SkeletonRows,
  Textarea,
} from "@/components/ui/Primitives";
import { Icon } from "@/components/ui/Icons";
import { useAction, useQuery, useRepo } from "@/lib/hooks/useRepository";
import {
  EntityAttachments,
  FileList,
  FileUploader,
} from "@/components/features/attachments/Attachments";
import { clusterSubmissionAttempts } from "@/lib/rules/tasks/submissionAttempts";
import { SubmittedFiles } from "./SubmittedFiles";
import { OutputSubmitList } from "./OutputSubmitList";
import { useViewerId } from "@/lib/hooks/usePermissions";
import { viewerHolds } from "@/lib/rules/tasks/viewerHolds";
import { useLiveNow } from "@/lib/hooks/useLiveNow";
import {
  istDayKey,
  hasReportFor,
  workedToday,
} from "@/lib/rules/tasks/dailyReport";
import { formatDateTime, formatDuration } from "@/lib/utils/format";
import type { TaskView } from "@/lib/repositories";

/**
 * Submission.
 *
 * Attempts are append-only and every prior attempt stays readable — legacy
 * overwrote the previous submission silently, which made a rework cycle
 * impossible to audit.
 */
export function SubmissionPanel({
  view,
  onChange,
  historyOnly = false,
}: {
  view: TaskView;
  onChange: () => void;
  /**
   * Render ONLY the earlier attempts, as a history section — no composer, no
   * "current submission". The reviewer's screen wants the current work and the
   * decision up top (that is `ReviewPanel`'s job) and the older attempts below
   * it, so it renders this panel in history-only mode beneath the decision.
   */
  historyOnly?: boolean;
}) {
  const me = useViewerId();
  const taskId = view.task.id;
  const [message, setMessage] = useState("");
  const [files, setFiles] = useState<string[]>([]);
  /* Chosen but not sent. A submission has no id until it is created, and the
     engine checks permission against the task the id resolves to — so these go
     up once the submission exists, keyed to THAT submission rather than to the
     task. Pooling them on the task would merge every attempt's files into one
     list and lose the audit trail rework depends on. */
  const [staged, setStaged] = useState<File[]>([]);
  const [uploadFailures, setUploadFailures] = useState<string[]>([]);
  const repo = useRepo();
  const submissions = useQuery(
    (r) => r.listSubmissions(taskId),
    [taskId, view.task.updatedAt],
  );
  const reworks = useQuery((r) => r.listReworkRequests(taskId), [taskId]);

  const [submit, state] = useAction((r) =>
    r.submitCompletion({ taskId, message, attachmentIds: files }),
  );

  /**
   * **The daily report is filed from this same composer.**
   *
   * They were two forms on two tabs asking the same question — what did you
   * do, and what can somebody look at — and the second was usually the first
   * reworded. One box, two buttons: log today's progress, or hand the work
   * over. What differs is the consequence, not the writing.
   *
   * `useLiveNow`, not `useNow`: `useNow` floors to the current minute, so a
   * timer started seconds ago computes a negative elapsed and `workedToday`
   * drops it — the task would not count as worked until the minute rolled.
   */
  const nowMs = useLiveNow();
  const today = istDayKey(nowMs);
  const reports = useQuery((r) => r.listDailyReports(taskId), [taskId]);
  const commits = useQuery((r) => r.listDayCommits(today), [today]);
  const timers = useQuery((r) => r.listTimers(), []);

  const workedThis = useMemo(() => {
    const worked = workedToday(
      commits.data ?? [],
      (timers.data ?? []) as Parameters<typeof workedToday>[1],
      nowMs,
    );
    return worked.find((w) => w.taskId === taskId) ?? null;
  }, [commits.data, timers.data, nowMs, taskId]);

  /**
   * When a report is owed: you worked on it, you have not filed one today, and
   * the task is NOT finished.
   *
   * The last condition is the new one. A report is the record of a day spent on
   * work still in progress — once the task is completed the submission is the
   * account of it, and asking for a daily report as well would be asking twice
   * for the same day.
   */
  const isClosed =
    view.task.status === "completed" ||
    view.task.status === "cancelled" ||
    view.task.status === "assignment_rejected";
  const reportOwed =
    Boolean(me) &&
    !isClosed &&
    workedThis !== null &&
    !hasReportFor(reports.data ?? [], String(me ?? ""), today);

  const [filing, setFiling] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);

  /**
   * A daily report needs its supporting documents; a submission does not.
   *
   * Deliberately different, and the reason is what each is for. A submission is
   * read by a reviewer who can ask for anything missing; a daily report is read
   * later, by somebody reconstructing what a day went on, and a sentence with
   * nothing attached is not a record of work. So the report button waits for a
   * file and the submit button does not.
   */
  const canFileReport =
    reportOwed && message.trim().length > 0 && staged.length > 0;

  async function fileReport() {
    setFiling(true);
    setFileError(null);
    const r = await repo.submitDailyReport({
      taskId,
      message: message.trim(),
      /* Still on the contract, no longer meaningful and no longer shown —
         nobody can compute what fraction of a task is done, so the figure was
         only ever an assertion. Written as zero rather than invented. */
      progressPercent: 0,
      attachmentIds: [],
      /* Named and typed from the chosen files. `url` is empty because nothing
         has been uploaded yet — the report records WHAT was attached; the
         bytes follow the same staging path the submission uses. */
      attachments: staged.map((f) => ({
        name: f.name,
        url: "",
        mimeType: f.type || "application/octet-stream",
      })),
    });
    setFiling(false);
    if (!r.ok) {
      setFileError(r.message);
      return;
    }
    setMessage("");
    setStaged([]);
    onChange();
  }

  /**
   * **Three answers, not two — see `viewerHolds`.**
   *
   * This was `assignments.some((a) => a.employeeId === me)`, and `me` is null
   * while the viewer is being read and again if that read failed. `some` on
   * null is false, so the panel told the assignee "Only an assignee can submit
   * this task" about a person it had not yet identified. T051's assignee hit
   * exactly that: the task was correct and the viewer had simply not resolved.
   */
  const holds = viewerHolds({ viewerId: me, assignments: view.assignments });
  const isAssignee = holds === "yes";
  /**
   * A task that declares outputs is delivered output by output.
   *
   * It completes when they are all approved, so a whole-task submission would
   * ask a reviewer to approve work the same chain is approving one piece at a
   * time — and would flip the task to `in_review` while its assignee still has
   * outputs to write. The engine refuses it; this stops the form being offered
   * at all, because a control that exists only to be refused is worse than no
   * control.
   */
  const deliversByOutput = view.task.outputs.length > 0;
  const canSubmit =
    isAssignee && !deliversByOutput && view.task.status === "in_progress";
  const latest = submissions.data?.[0];
  const submissionId = latest?.id ?? null;

  /**
   * The pooled files on the single submission record.
   *
   * The engine keeps NO submission history — one `completionSubmission`,
   * overwritten on every resubmit, its files all under one fixed id (see
   * `listSubmissions`). So this one read returns every attempt's files mixed
   * together, which is exactly why the tab used to read as one submission with
   * two files. They are split back into attempts below, by upload time.
   */
  const pooled = useQuery(
    (r) =>
      submissionId
        ? r
            .getAttachments("submission", submissionId)
            .then((res) => (res.ok ? res.data : []))
        : Promise.resolve([]),
    [submissionId, view.task.updatedAt],
  );

  /**
   * The attempts, reconstructed. One submit uploads its files in a burst; a
   * resubmission comes minutes later — so a gap between uploads (or a recorded
   * rework) marks the boundary between attempts. Oldest first; the last is the
   * current one. See `clusterSubmissionAttempts`.
   */
  const attempts = useMemo(
    () =>
      latest
        ? clusterSubmissionAttempts(pooled.data ?? [], reworks.data ?? [])
        : [],
    [latest, pooled.data, reworks.data],
  );

  function renderAttempt(a: (typeof attempts)[number]) {
    const { isCurrent, rework } = a;
    const kind = a.attempt === 1 ? "Initial submission" : "Resubmission";
    /* The current attempt's status follows the task; an earlier attempt was
       superseded by a later submit, which only happens after it is sent back —
       so it reads "Rework requested" whether or not a rework record survived to
       name the reason. */
    const status = isCurrent
      ? view.task.status === "completed"
        ? { label: "Approved", tone: "positive" as const }
        : view.task.status === "in_review"
          ? { label: "Under review", tone: "extension" as const }
          : { label: "Submitted", tone: "neutral" as const }
      : { label: "Rework requested", tone: "rework" as const };
    /* A coloured left edge signals which is which at a glance — the current
       attempt in the review tone, a reworked one in the rework tone. */
    const accent = isCurrent
      ? "var(--state-extension)"
      : "var(--state-rework)";
    /* The current attempt carries the submission's real time; an earlier one has
       none on the record, so its header falls back to its last file's upload. */
    const stamp = isCurrent
      ? (latest?.submittedAt ?? null)
      : (a.files
          .map((f) => f.uploadedAt ?? "")
          .filter(Boolean)
          .sort()
          .at(-1) ?? null);
    return (
      <div
        key={a.attempt}
        className="rounded-xl border border-hairline border-l-2 p-4"
        style={{ borderLeftColor: accent }}
      >
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
          <span className="text-sm font-medium text-ink">Attempt {a.attempt}</span>
          <span className="text-xs text-ink-faint">· {kind}</span>
          {isCurrent ? <Chip tone="extension">Latest</Chip> : <Chip>Previous</Chip>}
          {stamp && (
            <span className="ml-auto text-xs text-ink-faint">
              {formatDateTime(stamp)}
            </span>
          )}
        </div>

        <div className="mt-2 flex items-center gap-2">
          <span className="text-xs text-ink-faint">Status</span>
          <Chip tone={status.tone}>{status.label}</Chip>
        </div>

        {/* This attempt's files — split out of the pooled record by upload time,
            so what was sent first is no longer mixed with what was sent after. */}
        <p className="mt-3 text-[11px] tracking-[0.09em] text-ink-faint uppercase">
          Submitted files ({a.files.length})
        </p>
        {a.files.length > 0 ? (
          <FileList attachments={a.files} />
        ) : (
          <p className="mt-2 text-xs text-ink-faint">No files on this attempt.</p>
        )}
        {/* Legacy URL attachments (old application) sit on the record itself, not
            in the file service, and cannot be dated — so they show on current. */}
        {isCurrent && latest && (
          <SubmittedFiles files={latest.attachments} label="Also attached" />
        )}

        {isCurrent && latest?.message && (
          <div className="mt-3">
            <p className="text-[11px] tracking-[0.09em] text-ink-faint uppercase">
              Notes
            </p>
            <p className="mt-1 text-sm text-ink-muted">{latest.message}</p>
          </div>
        )}

        {rework && (
          <div className="mt-3 rounded-lg border border-hairline bg-[var(--surface-sunken)] p-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="flex items-center gap-1.5 text-xs font-medium text-ink">
                <Icon.chat className="h-3.5 w-3.5" />
                Reviewer feedback
              </span>
              {rework.deductionWaived && (
                <Chip tone="positive">Deduction waived</Chip>
              )}
              <span className="ml-auto text-xs text-ink-faint">
                {formatDateTime(rework.requestedAt)}
              </span>
            </div>
            <p className="mt-1.5 text-sm text-ink">{rework.reason}</p>
            {rework.newDueAt && (
              <p className="mt-1 text-xs text-ink-faint">
                Deadline re-granted to {formatDateTime(rework.newDueAt)} — you
                keep the time you had left when you submitted.
              </p>
            )}
          </div>
        )}
      </div>
    );
  }

  /* History-only: the earlier attempts, rendered INSIDE the reviewer's "Review
     history" section (by `ReviewPanel`) so all of a task's history — the files
     submitted before AND the decisions taken before — reads as one block beneath
     the decision, rather than as a second "Previous submissions" panel above it.
     Self-contained: it carries its own padding and caption to sit in a
     `padded={false}` Panel, and returns null until there has actually been an
     earlier attempt so a first submission adds no empty row. */
  if (historyOnly) {
    const previous = attempts.slice(0, -1);
    if (submissions.isLoading || pooled.isLoading || previous.length === 0) {
      return null;
    }
    return (
      <div className="border-b border-hairline px-5 py-4">
        <p className="mb-2 flex items-center gap-2 text-[11px] tracking-[0.09em] text-ink-faint uppercase">
          Previous submissions
          <Chip>{previous.length}</Chip>
        </p>
        <div className="flex flex-col gap-3">
          {/* Newest previous attempt first — nearest the current one. */}
          {[...previous].reverse().map((a) => renderAttempt(a))}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {deliversByOutput && (
        /**
         * **The outputs are submitted HERE, not described here.**
         *
         * This was a panel whose entire content was "Submit them from
         * Overview" — a screen that explained the flow and then sent the reader
         * two tabs away to take part in it, on the one tab named after the
         * thing they came to do. The review that decides on the handover
         * already renders directly beneath this, so submit and decide now sit
         * on one screen in the order the work moves.
         */
        <OutputSubmitList view={view} viewerId={me} onChange={onChange} />
      )}
      {canSubmit ? (
        <Panel>
          <h2 className="text-sm font-medium text-ink">
            {(submissions.data?.length ?? 0) > 0
              ? "Resubmit"
              : "Submit for review"}
          </h2>
          <p className="mt-1 text-xs text-ink-faint">
            Goes to{" "}
            {latest?.reviewChain[0] ? "your reporting line" : "your manager"}{" "}
            for review. Your timer stops on submit.
          </p>
          <Field
            label="What you completed"
            required
            className="mt-3"
            error={state.errorField === "message" ? state.error : null}
          >
            <Textarea
              data-help="submission-message-field"
              rows={4}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Describe the work so it can be reviewed without opening every file."
            />
          </Field>

          {/**
           * **The demo "Attach file" button is gone, and it was the bug.**
           *
           * It appended the literal string `at-demo-1`, `at-demo-2`… and drew
           * each as a chip indistinguishable from a real attachment. Nothing
           * opened a file picker, nothing was uploaded, and the ids it produced
           * were dropped on the way to the engine — so somebody who used the
           * obvious paperclip button watched their document "attach" and then
           * reach nobody. The real uploader is below, and is now the only one.
           */}
          <div className="mt-3 flex flex-wrap items-center gap-2">
          </div>

          {/* The shared uploader in staging mode — no submission id yet. */}
          <div className="mt-3">
            <p className="text-[11px] tracking-[0.09em] text-ink-faint uppercase">
              Attachments
            </p>
            <p className="mt-0.5 mb-2 text-[12px] text-ink-faint">
              Optional. The work itself, or anything the reviewer needs to see.
            </p>
            <FileUploader
              entityType="submission"
              entityId={null}
              attachments={[]}
              onChange={() => {}}
              staged={staged}
              onStagedChange={setStaged}
              label="Attach submitted files"
            />
          </div>

          {uploadFailures.length > 0 && (
            <InlineError
              message={`Your work was submitted, but these files did not upload: ${uploadFailures.join(", ")}. You can add them from the task.`}
            />
          )}

          {state.error && !state.errorField && (
            <div className="mt-3">
              <InlineError message={state.error} code={state.errorCode} />
            </div>
          )}

          {fileError && (
            <div className="mt-3">
              <InlineError message={fileError} />
            </div>
          )}

          <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
            {/* **File a daily report, from the same box.**
                Only when one is actually owed — the timer ran on this task
                today, nothing has been filed, and the task is still open. On a
                task nobody worked today this button is simply absent rather
                than present and refused. */}
            {reportOwed && (
              <>
                <span className="mr-auto text-[11px] text-ink-faint">
                  {formatDuration(workedThis?.totalSecs ?? 0)} worked today
                  {staged.length === 0 &&
                    " · attach the supporting work to file a report"}
                </span>
                <Button
                  disabled={filing || !canFileReport}
                  onClick={() => void fileReport()}
                >
                  {filing ? "Filing…" : "File daily report"}
                </Button>
              </>
            )}
            <Button loading={state.isPending}
              data-help="task-submit-work-button"
              tone="primary"
              disabled={state.isPending || !message.trim()}
              onClick={async () => {
                const r = await submit();
                if (!r.ok) return;

                /*
                 * Files follow the submission, for the same reason task files
                 * follow the task: there is nothing to attach to until it
                 * exists. The newest submission is re-read rather than assumed,
                 * because the engine assigns the id.
                 *
                 * A failed upload does NOT undo the submission — the work is
                 * already with the reviewer, and retracting it would be worse
                 * than a missing file the person can still add.
                 */
                if (staged.length > 0) {
                  const fresh = await repo.listSubmissions(taskId);
                  const target = fresh[0]?.id ?? null;
                  const failed: string[] = [];
                  for (const file of staged) {
                    if (!target) {
                      failed.push(file.name);
                      continue;
                    }
                    const up = await repo.uploadAttachment({
                      file,
                      entityType: "submission",
                      entityId: target,
                    });
                    if (!up.ok) failed.push(file.name);
                  }
                  setUploadFailures(failed);
                }

                setMessage("");
                setFiles([]);
                setStaged([]);
                onChange();
              }}
            >
              {state.isPending ? "Submitting…" : "Submit for review"}
            </Button>
          </div>
        </Panel>
      ) : (
        <Panel>
          <p className="text-sm text-ink-muted">
            {/* A refusal is a statement about somebody's permissions. While the
                viewer is unresolved there is nothing true to say, so it says
                what is actually happening instead of accusing them of not
                holding their own task. */}
            {holds === "unknown"
              ? "Working out who you are…"
              : holds === "no"
                ? "Only an assignee can submit this task."
                : view.task.status === "in_review"
                  ? "This task is with a reviewer."
                  : view.task.status === "completed"
                    ? "This task is complete."
                    : "Start the task before submitting it."}
          </p>
        </Panel>
      )}

      {/* Submissions, split back into attempts so a rework cycle reads as a
          sequence — what was sent first, what came after the rework — rather
          than one merged pile of files. The current attempt is shown in full;
          earlier ones sit below, foldable, each carrying the feedback that sent
          it back. */}
      {submissions.isLoading || pooled.isLoading ? (
        <Panel>
          <SkeletonRows rows={2} />
        </Panel>
      ) : deliversByOutput ? (
        /* Output tasks submit per output, so each submission is one output's
           attempt and keeps its own id — the rework-boundary reconstruction
           does not apply. They are listed as they are, each naming its output. */
        !submissions.data?.length ? (
          <Panel>
            <p className="text-sm text-ink-faint">Not yet submitted.</p>
          </Panel>
        ) : (
          <div className="flex flex-col gap-3">
            {submissions.data.map((s) => (
              <div key={s.id} className="rounded-xl border border-hairline p-4">
                <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
                  <span className="text-sm font-medium text-ink">
                    {s.outputId
                      ? (view.task.outputs.find((o) => o.id === s.outputId)
                          ?.label ?? "Output")
                      : "Output"}{" "}
                    · attempt {s.attempt}
                  </span>
                  {s.wasLate && <Chip tone="overdue">Late</Chip>}
                  <span className="ml-auto text-xs text-ink-faint">
                    {formatDateTime(s.submittedAt)}
                  </span>
                </div>
                <EntityAttachments
                  entityType="submission"
                  entityId={s.id}
                  title="Submitted files"
                />
                <SubmittedFiles files={s.attachments} label="Also attached" />
                {s.message && (
                  <p className="mt-2 text-sm text-ink-muted">{s.message}</p>
                )}
              </div>
            ))}
          </div>
        )
      ) : attempts.length === 0 ? (
        <Panel>
          <p className="text-sm text-ink-faint">Not yet submitted.</p>
        </Panel>
      ) : (
        /* Only the CURRENT submission here — the earlier attempts moved into the
           reviewer's "Review history" (rendered by `ReviewPanel` in `historyOnly`
           mode), so the history reads as one section beneath the decision rather
           than a second block above it. */
        <section>
          <p className="mb-2 text-[11px] tracking-[0.09em] text-ink-faint uppercase">
            Current submission
          </p>
          {renderAttempt(attempts[attempts.length - 1])}
        </section>
      )}
    </div>
  );
}
