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
  FileUploader,
} from "@/components/features/attachments/Attachments";
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
}: {
  view: TaskView;
  onChange: () => void;
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
      {reworks.data && reworks.data.length > 0 && (
        <Panel>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-medium text-ink">Rework requested</h2>
            <Chip tone="rework">{reworks.data.length}×</Chip>
          </div>
          <ul className="mt-3 space-y-2.5">
            {reworks.data.map((rw) => (
              <li
                key={rw.id}
                className="border-t border-hairline pt-2.5 first:border-0 first:pt-0"
              >
                <div className="flex items-baseline gap-2">
                  <span className="text-xs text-ink-faint">
                    Rework #{rw.occurrence}
                  </span>
                  <span className="text-xs text-ink-faint">
                    {formatDateTime(rw.requestedAt)}
                  </span>
                  {rw.deductionWaived && (
                    <Chip tone="positive">Deduction waived</Chip>
                  )}
                </div>
                <p className="mt-1 text-sm text-ink">{rw.reason}</p>
                {rw.newDueAt && (
                  <p className="mt-1 text-xs text-ink-faint">
                    Deadline re-granted to {formatDateTime(rw.newDueAt)} — you
                    keep the time you had left when you submitted.
                  </p>
                )}
              </li>
            ))}
          </ul>
        </Panel>
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

      <Panel padded={false}>
        <div className="flex items-center gap-2 border-b border-hairline px-5 py-3">
          <h2 className="text-sm font-medium text-ink">Attempts</h2>
          <span data-figure className="text-xs text-ink-faint">
            {submissions.data?.length ?? 0}
          </span>
        </div>
        {submissions.isLoading ? (
          <div className="px-5 py-3">
            <SkeletonRows rows={2} />
          </div>
        ) : !submissions.data?.length ? (
          <p className="px-5 py-4 text-sm text-ink-faint">Not yet submitted.</p>
        ) : (
          <div className="divide-y divide-hairline">
            {submissions.data.map((s) => (
              <div key={s.id} className="px-5 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  {/* **Which output, where there is one.** A task delivering
                      three outputs listed three rows reading "Attempt 1", and
                      the person who submitted them could not tell which was
                      which — the one question this list exists to answer. */}
                  <span className="text-sm text-ink">
                    {s.outputId
                      ? (view.task.outputs.find((o) => o.id === s.outputId)
                          ?.label ?? "Output")
                      : "Attempt"}{" "}
                    {s.outputId ? `· attempt ${s.attempt}` : s.attempt}
                  </span>
                  {s.wasLate && <Chip tone="overdue">Late</Chip>}
                  {s.supersededById && <Chip>Superseded</Chip>}
                  <span className="ml-auto text-xs text-ink-faint">
                    {formatDateTime(s.submittedAt)}
                  </span>
                </div>
                <p className="mt-1.5 text-sm text-ink-muted">{s.message}</p>
                {/* Both origins, exactly as the reviewer sees them — Cowork's
                    uploader writes to the attachment service, the old
                    application wrote URLs onto the task record. A chip carrying
                    the raw URL as text stood here before: unreadable, and not a
                    link, so the file could be neither identified nor opened. */}
                <EntityAttachments
                  entityType="submission"
                  entityId={s.id}
                  title="Attached"
                />
                <SubmittedFiles files={s.attachments} label="Also attached" />
              </div>
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
}
