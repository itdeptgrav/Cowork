"use client";

import { useState } from "react";
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
import { FileUploader } from "@/components/features/attachments/Attachments";
import { useViewerId } from "@/lib/hooks/usePermissions";
import { formatDateTime } from "@/lib/utils/format";
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

  const isAssignee = view.assignments.some((a) => a.employeeId === me);
  const canSubmit = isAssignee && view.task.status === "in_progress";
  const latest = submissions.data?.[0];

  return (
    <div className="flex flex-col gap-4">
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

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              onClick={() => setFiles((f) => [...f, `at-demo-${f.length + 1}`])}
            >
              <Icon.attach className="h-3.5 w-3.5" /> Attach file
            </Button>
            {files.map((f) => (
              <Chip key={f}>
                {f}
                <button
                  type="button"
                  aria-label={`Remove ${f}`}
                  onClick={() => setFiles((cur) => cur.filter((x) => x !== f))}
                  className="ml-1 opacity-60 hover:opacity-100"
                >
                  <Icon.close className="h-3 w-3" />
                </button>
              </Chip>
            ))}
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

          <div className="mt-3 flex justify-end">
            <Button
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
            {!isAssignee
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
                  <span className="text-sm text-ink">Attempt {s.attempt}</span>
                  {s.wasLate && <Chip tone="overdue">Late</Chip>}
                  {s.supersededById && <Chip>Superseded</Chip>}
                  <span className="ml-auto text-xs text-ink-faint">
                    {formatDateTime(s.submittedAt)}
                  </span>
                </div>
                <p className="mt-1.5 text-sm text-ink-muted">{s.message}</p>
                {s.attachmentIds.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {s.attachmentIds.map((a) => (
                      <Chip key={a}>
                        <Icon.attach className="h-3 w-3" /> {a}
                      </Chip>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
}
