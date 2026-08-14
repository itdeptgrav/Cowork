"use client";

import { useState } from "react";
import { mayReview } from "@/lib/rules/tasks/reviewChain";
import {
  Button,
  Chip,
  Field,
  InlineError,
  Panel,
  PermissionDenied,
  ProvisionalBadge,
  SkeletonRows,
  Textarea,
} from "@/components/ui/Primitives";
import { useAction, useQuery } from "@/lib/hooks/useRepository";
import {
  EntityAttachments,
  FileUploader,
} from "@/components/features/attachments/Attachments";
import { SubmittedFiles } from "./SubmittedFiles";
import type { AttachmentMeta } from "@/lib/legacy/attachments";
import { useViewerId } from "@/lib/hooks/usePermissions";
import { formatDateTime } from "@/lib/utils/format";
import { REWORK_DEDUCTION } from "@/lib/rules/scoring/engine";
import { PROVISIONAL_RULES } from "@/lib/config/provisional";
import type { TaskView } from "@/lib/repositories";
import type { ReviewDecision } from "@/lib/domain";

/**
 * Review: approve, rework or reject.
 *
 * The score consequence of each choice is stated before the reviewer commits,
 * because the difference between rework and rejection is entirely a scoring
 * difference and legacy showed the reviewer nothing.
 *
 * Two guards legacy lacked: a submitter cannot review their own work, and a
 * reviewer must be in the submission's chain.
 */
export function ReviewPanel({
  view,
  onChange,
}: {
  view: TaskView;
  onChange: () => void;
}) {
  const taskId = view.task.id;
  const [decision, setDecision] = useState<ReviewDecision>("approved");
  const [reason, setReason] = useState("");
  const [waive, setWaive] = useState(false);
  /* The acceptance criteria this reviewer says have NOT been met. Held as text
     rather than ids because that is what the engine records and what the
     assignee reads — an id would be meaningless in the history. */
  const [failed, setFailed] = useState<string[]>([]);
  /* Optional, and deliberately separate from the required review note: that
     one says why the work came back, this one says what to do about it. */
  const [correction, setCorrection] = useState("");
  /* Uploaded already — the reviewer sends IDs, never bytes.
     `entityType: "rework"` keeps correction files OUT of the task's own
     reference list; attaching them as `task` (which this did) mixed a
     reviewer's screenshots into the files the creator supplied, and the two
     mean different things to whoever opens the task.
     `entityId` is still the task id, because the rework record has no id until
     this form is submitted — and the engine resolves every entity type back to
     its task for the permission check, so the gate is unchanged. */
  const [files, setFiles] = useState<AttachmentMeta[]>([]);

  /* The task's own requirements, from the completion state the rest of the
     product already uses. Not a second checklist. */
  const requirements = view.completion.requirements;

  const me = useViewerId();
  const submissions = useQuery(
    (r) => r.listSubmissions(taskId),
    [taskId, view.task.updatedAt],
  );
  const reviews = useQuery(
    (r) => r.listReviews(taskId),
    [taskId, view.task.updatedAt],
  );

  const [review, state] = useAction((r, sid: string) =>
    r.reviewSubmission({
      submissionId: sid,
      decision,
      reason,
      reworkRequirements: decision === "rework" ? failed : [],
      reworkNote: decision === "rework" ? correction : "",
      reworkAttachmentIds: decision === "rework" ? files.map((f) => f.id) : [],
      waiveDeduction: waive,
    }),
  );

  const latest = submissions.data?.find((s) => !s.supersededById);
  /* One predicate, shared with the repository's own resolution. It gates on
     the stage that is OPEN rather than on membership anywhere in the chain: on
     a two-stage flow the second reviewer is in the chain from the start, and
     letting them decide early would skip the first stage entirely. */
  const canReview =
    !!latest &&
    view.task.status === "in_review" &&
    mayReview({
      chain: latest.reviewChain,
      currentStage: latest.currentStage,
      viewerId: me ?? null,
      submittedById: latest.submittedById,
    });

  const rejectionRule = PROVISIONAL_RULES.rejectionDeduction;

  return (
    <div className="flex flex-col gap-4">
      {latest ? (
        <Panel>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-medium text-ink">Submitted work</h2>
            <Chip>Attempt {latest.attempt}</Chip>
            {latest.wasLate && <Chip tone="overdue">Late</Chip>}
            <span className="ml-auto text-xs text-ink-faint">
              {formatDateTime(latest.submittedAt)}
            </span>
          </div>
          <p className="mt-2 max-w-[68ch] text-sm text-ink-muted">
            {latest.message}
          </p>
          {/**
           * **The work itself.**
           *
           * This panel showed the covering note and the review chain and
           * nothing else, so somebody deciding whether to approve a document
           * could not open the document.
           *
           * Both origins are rendered, because a submission can carry files in
           * two places and neither alone is the answer. Cowork's own uploader
           * puts them in the attachment service keyed to this submission —
           * private, streamed, and what `EntityAttachments` fetches. The old
           * application instead wrote URLs onto the task record itself, and
           * work submitted there still has to be reviewable here.
           */}
          <EntityAttachments
            entityType="submission"
            entityId={latest.id}
            title="Submitted work"
          />
          <SubmittedFiles files={latest.attachments} label="Also attached" />
          {latest.reviewChain.length > 1 && (
            <p className="mt-2 text-xs text-ink-faint">
              Stage {latest.currentStage} of {latest.reviewChain.length} —
              approving passes this to the next reviewer rather than completing
              the task.
            </p>
          )}
        </Panel>
      ) : (
        <Panel>
          <p className="text-sm text-ink-muted">
            Nothing has been submitted for review yet.
          </p>
        </Panel>
      )}

      {latest && !canReview && (
        <Panel>
          {latest.submittedById === me ? (
            <PermissionDenied
              what="review this"
              reason="You submitted this work. Nobody can review their own submission."
            />
          ) : !latest.reviewChain.includes(me ?? "") ? (
            <PermissionDenied
              what="review this"
              reason={
                latest.reviewChain.length === 0
                  ? "No reviewer could be resolved for this task. Its approval workflow names a role that nobody currently fills."
                  : "Review follows the reporting chain. This submission is with someone else."
              }
            />
          ) : latest.reviewChain[latest.currentStage - 1] !== me ? (
            /* In the chain, but not yet this person's turn — a real state on a
               two-stage flow, and quite different from having no access. */
            <p className="text-sm text-ink-muted">
              This is with stage {latest.currentStage} of{" "}
              {latest.reviewChain.length}. It reaches you once that decision is
              made.
            </p>
          ) : (
            <p className="text-sm text-ink-muted">
              This task is not awaiting review.
            </p>
          )}
        </Panel>
      )}

      {canReview && (
        <Panel>
          <h2 className="text-sm font-medium text-ink">Your decision</h2>

          <div className="mt-3 grid gap-2 sm:grid-cols-3">
            <Choice
              id="approved"
              active={decision === "approved"}
              onClick={() => setDecision("approved")}
              title="Approve"
              body="Closes the task and settles its score."
              impact="No deduction"
              tone="positive"
            />
            <Choice
              id="rework"
              active={decision === "rework"}
              onClick={() => setDecision("rework")}
              title="Rework"
              body="Back to in progress. Time left at submission is re-granted."
              impact={`−${REWORK_DEDUCTION} per occurrence`}
              tone="rework"
              confirmed
            />
            <Choice
              id="rejected"
              active={decision === "rejected"}
              onClick={() => setDecision("rejected")}
              title="Reject"
              body="Records an adverse review. Resubmission stays possible."
              impact={`−${rejectionRule.value} placeholder`}
              tone="overdue"
            />
          </div>

          {decision === "rework" && requirements.length > 0 && (
            <div className="mt-3 rounded-inset bg-[var(--surface-sunken)] px-3.5 py-3">
              {/* The task's OWN acceptance criteria, not a second checklist.
                  They were agreed at creation, so pointing at them is more
                  precise than describing the problem again in prose — and it
                  is what the assignee will see highlighted. */}
              <p className="text-sm text-ink">
                Which requirements need changes?
              </p>
              <p className="mt-0.5 text-xs text-ink-faint">
                The person who submitted this sees exactly what you pick.
              </p>
              <div className="mt-2 space-y-1.5">
                {requirements.map((r) => (
                  <label
                    key={r.requirement.id}
                    className="flex items-start gap-2 text-sm text-ink-muted"
                  >
                    <input
                      type="checkbox"
                      checked={failed.includes(r.requirement.text)}
                      onChange={(e) =>
                        setFailed((prev) =>
                          e.target.checked
                            ? [...prev, r.requirement.text]
                            : prev.filter((t) => t !== r.requirement.text),
                        )
                      }
                      className="mt-0.5 h-3.5 w-3.5 accent-[var(--color-ink)]"
                    />
                    <span>{r.requirement.text}</span>
                  </label>
                ))}
              </div>
              {failed.length === 0 && (
                <p className="mt-2 text-xs text-[var(--danger,#c4553d)]">
                  Select at least one completion requirement that needs
                  correction.
                </p>
              )}

              {/* The shared uploader, not a rework-specific one. Every other
                  feature will mount this same component with its own entity. */}
              <div className="mt-3">
                <FileUploader
                  entityType="rework"
                  entityId={taskId}
                  attachments={files}
                  onChange={setFiles}
                  label="Attach correction files"
                />
              </div>

              <Field
                label="Correction notes"
                className="mt-3"
                hint="Optional. What the person should do about it — shown with the requested changes."
              >
                <Textarea
                  data-help="rework-correction-notes"
                  rows={2}
                  value={correction}
                  onChange={(e) => setCorrection(e.target.value)}
                />
              </Field>
            </div>
          )}

          {decision === "rework" && (
            <label className="mt-3 flex items-center gap-2 text-sm text-ink-muted">
              <input
                type="checkbox"
                checked={waive}
                onChange={(e) => setWaive(e.target.checked)}
                className="h-3.5 w-3.5 accent-[var(--color-ink)]"
              />
              Waive the deduction for this rework
              <ProvisionalBadge decisionId="O18" label="Rework waiver" />
            </label>
          )}

          {decision === "rejected" && (
            <div className="mt-3 rounded-inset bg-[var(--surface-sunken)] px-3.5 py-3">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm text-ink">
                  Rejection deduction is not approved
                </p>
                <ProvisionalBadge decisionId="O4" label="Rejection deduction" />
              </div>
              <p className="mt-1 text-xs text-ink-faint">
                Legacy zeroed the whole task for a rejection. That rule has not
                been approved here, so a deduction of{" "}
                {String(rejectionRule.value)} applies instead and is marked
                provisional wherever it appears on a score.
              </p>
            </div>
          )}

          <Field
            label="Review note"
            required
            className="mt-3"
            hint="Recorded on the task and sent to the person who submitted."
            error={state.errorField === "reason" ? state.error : null}
          >
            <Textarea
              data-help="review-reason-field"
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </Field>

          {state.error && !state.errorField && (
            <div className="mt-3">
              <InlineError message={state.error} code={state.errorCode} />
            </div>
          )}

          <div className="mt-3 flex justify-end">
            <Button
              tone="primary"
              /* The engine refuses a rework with nothing selected, so the
                 button refuses first — a round trip to be told to pick
                 something is worse than not being able to press it. */
              disabled={
                state.isPending ||
                !reason.trim() ||
                (decision === "rework" &&
                  requirements.length > 0 &&
                  failed.length === 0)
              }
              onClick={async () => {
                const r = await review(latest.id);
                if (r.ok) {
                  setReason("");
                  setFailed([]);
                  setCorrection("");
                  setFiles([]);
                  onChange();
                }
              }}
            >
              {state.isPending
                ? "Saving…"
                : decision === "approved"
                  ? "Approve"
                  : decision === "rework"
                    ? "Send back for rework"
                    : "Reject"}
            </Button>
          </div>
        </Panel>
      )}

      <Panel padded={false}>
        <div className="border-b border-hairline px-5 py-3">
          <h2 className="text-sm font-medium text-ink">Review history</h2>
        </div>
        {reviews.isLoading ? (
          <div className="px-5 py-3">
            <SkeletonRows rows={2} />
          </div>
        ) : !reviews.data?.length ? (
          <p className="px-5 py-4 text-sm text-ink-faint">No reviews yet.</p>
        ) : (
          <div className="divide-y divide-hairline">
            {reviews.data.map((rv) => (
              <div key={rv.id} className="px-5 py-2.5">
                <div className="flex flex-wrap items-center gap-2">
                  <Chip
                    tone={
                      rv.decision === "approved"
                        ? "positive"
                        : rv.decision === "rework"
                          ? "rework"
                          : "overdue"
                    }
                  >
                    {rv.decision}
                  </Chip>
                  <span className="text-xs text-ink-faint">
                    Stage {rv.stage}
                  </span>
                  <span className="ml-auto text-xs text-ink-faint">
                    {formatDateTime(rv.reviewedAt)}
                  </span>
                </div>
                {rv.reason && (
                  <p className="mt-1 text-sm text-ink-muted">{rv.reason}</p>
                )}
              </div>
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
}

function Choice({
  active,
  onClick,
  title,
  body,
  impact,
  tone,
  confirmed = false,
}: {
  id: string;
  active: boolean;
  onClick: () => void;
  title: string;
  body: string;
  impact: string;
  tone: "positive" | "rework" | "overdue";
  confirmed?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`rounded-inset px-3 py-2.5 text-left transition-colors ${
        active
          ? "bg-[var(--control-active)] shadow-[inset_0_0_0_1.5px_var(--color-ink)]"
          : "bg-[var(--surface-sunken)] hover:bg-[var(--control)]"
      }`}
    >
      <span className="flex items-center gap-1.5">
        <span className="text-sm font-medium text-ink">{title}</span>
      </span>
      <span className="mt-1 block text-[11px] text-ink-faint">{body}</span>
      <span className="mt-2 flex items-center gap-1">
        <Chip tone={tone}>{impact}</Chip>
        {confirmed && (
          <span className="text-[11px] text-ink-faint">confirmed</span>
        )}
      </span>
    </button>
  );
}
