"use client";

import { useEffect } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { Chip } from "@/components/ui/Primitives";
import { Icon } from "@/components/ui/Icons";
import { SubmittedFiles } from "./SubmittedFiles";
import { EntityAttachments } from "@/components/features/attachments/Attachments";
import { ReviewDecisionBox } from "./ReviewPanel";
import { mayReview } from "@/lib/rules/tasks/reviewChain";
import { mayReview as mayReviewOutput } from "@/lib/rules/tasks/outputs";
import { formatDateTime } from "@/lib/utils/format";
import type { TaskView } from "@/lib/repositories";
import type { TaskSubmission } from "@/lib/domain";

/**
 * Submitting work, and deciding on it, from inside the task's own thread.
 *
 * ## Why these belong in the chat at all
 *
 * A handover is a message. Somebody finishes a piece of work, says so, and
 * attaches it — and until now the saying and the attaching happened in two
 * different places: the sentence in the Discussion tab, the files in the
 * Submission tab, with nothing tying them together. The reviewer then got a
 * line in the thread reading "submitted work for completion review" and had to
 * leave the conversation to find out what was submitted or to answer it.
 *
 * So the composer offers both kinds of attachment, and the thread carries the
 * decision. Nothing here reimplements either flow: the dialog wraps the REAL
 * `SubmissionPanel` and the REAL `ReviewPanel`, so a rule that changes in the
 * Submission tab changes here in the same edit. This file is a doorway, not a
 * second implementation — which is the whole reason the review form is not
 * inlined into a chat bubble.
 */

/**
 * A dialog whose CHILD supplies the surface.
 *
 * `SubmissionPanel` and `ReviewPanel` each render their own `Panel`. Wrapping
 * them in a frosted dialog shell would put a panel inside a panel — the
 * box-inside-a-box the design system rules out — and draw two borders a few
 * pixels apart. So this contributes the backdrop, the scroll and the dismissal
 * behaviour, and nothing that paints.
 */
export function TaskPanelDialog({
  title,
  onClose,
  children,
}: {
  /** Names the dialog for assistive technology; the panel inside carries its
   *  own visible heading, so this is deliberately not drawn. */
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    /* The page behind must not scroll under a dialog that scrolls itself. */
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      /* A heavier scrim than a sheet or a menu takes. This one covers a task
         page dense with cards, and at 45% every one of them stayed legible
         around the dialog and competed with it. */
      className="fixed inset-0 z-[80] overflow-y-auto overscroll-contain bg-black/70 p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        /* `my-auto` centres a short panel and lets a tall one scroll from the
           top instead of being clipped at both ends. */
        className="mx-auto my-auto w-full max-w-2xl"
        /**
         * **The panel inside this must be OPAQUE.**
         *
         * `SubmissionPanel` paints itself with `frost-panel`, which is 74%
         * transparent and hides what is behind it with `backdrop-filter`. That
         * holds over the page's own ground and fails here: this is a portal on
         * `document.body`, so what is behind it is the entire task page, and it
         * read straight through — the submission form and the thread's own
         * cards drawn over each other, both legible, neither readable.
         *
         * Overriding the custom property rather than laying an opaque div under
         * the child: the property inherits, so the panel simply paints solid,
         * with no second element to line its corners up with and no second
         * border a hair outside the first. `--color-frost-panel` is what the
         * class actually reads; `--frost-panel` is set too because the
         * reduced-transparency rule mixes from that one.
         */
        style={
          {
            "--color-frost-panel": "var(--frost-panel-solid)",
            "--frost-panel": "var(--frost-panel-solid)",
          } as React.CSSProperties
        }
      >
        <div className="flex justify-end pb-2">
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="grid h-8 w-8 place-items-center rounded-full bg-[var(--control)] text-ink transition-colors hover:bg-[var(--control-hover)]"
          >
            <Icon.close className="h-4 w-4" />
          </button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}

/**
 * The task has not started, so its working thread has nothing in it.
 *
 * **The empty pane was telling the truth and hiding the reason.** Before a task
 * is confirmed there is no work to discuss, so the Task chat correctly showed
 * "No messages yet" — and left somebody looking at a blank pane with no idea
 * that the task was sitting on THEIR decision. The thread is now often the
 * first place a task is seen, so it has to say what the task is waiting for.
 *
 * The sentence comes from `nextAction`, the same resolver the task page's own
 * "Your move" banner uses, so this cannot claim a deadline needs approving when
 * what the task actually wants is the assignment confirmed. Its `href` is
 * preferred over the task's own page for the same reason: the resolver knows
 * whether the decision lives on the deadline tab or the overview.
 *
 * Embedded only. On the task page the banner is already on screen a few
 * hundred pixels above, and a second copy of it would be the same rule stated
 * twice on one screen.
 */
export function TaskNotStartedNotice({
  taskId,
  action,
}: {
  taskId: string;
  action: { label: string; actor: "you" | "them" | "nobody"; href?: string };
}) {
  const yours = action.actor === "you";
  return (
    /* No container. This stands in for the thread's empty state, and an empty
       state is not a card — it is the pane speaking. The border and fill made
       it read as an object sitting IN the conversation, which is the one thing
       it is not: there is no conversation yet. */
    <div className="mx-auto my-8 max-w-[42ch] px-4 text-center">
      <p className="text-xs font-medium text-ink">
        This task has not started yet
      </p>
      <p className="mt-1.5 text-[11px] leading-relaxed text-ink-muted">
        {yours
          ? /* The label is the action itself — "Approve the deadline",
               "Confirm the assignment" — so it reads as the sentence it is. */
            `${action.label}. The discussion opens once the task is under way.`
          : `Waiting on ${action.label.toLowerCase()}. The discussion opens once the task is under way.`}
      </p>
      <Link
        href={action.href ?? `/tasks/${taskId}`}
        /* `py-1.5 text-sm` is the tab strip's own option treatment, so this
           button stands exactly as tall as the "Task chat" segment above it.
           Two capsules of different heights on one narrow pane read as two
           different kinds of control. */
        className={`mt-4 inline-flex items-center gap-1.5 rounded-full px-4 py-1.5 text-sm font-medium tracking-[-0.012em] transition-colors duration-[180ms] ease-[var(--ease-deck)] ${
          yours
            ? "bg-ink text-[var(--body-bg)] hover:opacity-90"
            : "bg-[var(--control)] text-ink hover:bg-[var(--control-hover)]"
        }`}
      >
        {yours ? "Review the task" : "Open the task"}
        <Icon.chevronRight aria-hidden className="h-3.5 w-3.5" />
      </Link>
    </div>
  );
}

/**
 * The open submission, in the thread, with the decision attached to it.
 *
 * **What the thread said before, and what was missing.** The engine writes a
 * line reading "✅ Someone submitted work for completion review" — a fact with
 * no content and no consequence. What the assignee actually WROTE went to the
 * Submission tab, and the reviewer's answer lived on a third screen. This puts
 * the three together: the claim, the words, the files, and the two answers.
 *
 * Rendered from the task's own state rather than by matching that sentence.
 * Pattern-matching the engine's English would break the day it is reworded or
 * translated, and would attach a live control to a historical line — this card
 * describes what is open NOW, which is why it sits at the end of the thread.
 */
export function ChatSubmissionCard({
  view,
  submission,
  viewerId,
  onDecided,
}: {
  view: TaskView;
  submission: TaskSubmission;
  viewerId: string | null;
  /** A decision landed — refresh the thread and the submission behind it, so
   *  the card clears itself rather than sitting there already answered. */
  onDecided: () => void;
}) {
  /* The same pair of gates the review screen and the engine apply, imported
     rather than restated — a third copy is a third chance to offer somebody a
     decision the backend then refuses. */
  const canReview =
    mayReviewOutput({
      outputId: submission.outputId,
      taskStatus: view.task.status,
    }) &&
    mayReview({
      chain: submission.reviewChain,
      currentStage: submission.currentStage,
      viewerId: viewerId ?? null,
      submittedById: submission.submittedById,
    });

  const outputLabel = submission.outputId
    ? (view.task.outputs.find((o) => o.id === submission.outputId)?.label ??
      "Submitted output")
    : "Submitted work";

  return (
    <div className="my-3 rounded-inset border border-hairline bg-[var(--surface-sunken)] px-3.5 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <Icon.check aria-hidden className="h-4 w-4 shrink-0 text-ink" />
        <h3 className="text-xs font-medium text-ink">{outputLabel}</h3>
        <Chip>Attempt {submission.attempt}</Chip>
        {submission.wasLate && <Chip tone="overdue">Late</Chip>}
        <span className="ms-auto text-[11px] text-ink-faint">
          {formatDateTime(submission.submittedAt)}
        </span>
      </div>

      {/* **What the assignee wrote.** The thread announced that work had been
          submitted and then withheld the one thing the reviewer needed to read
          — the sentence explaining what was done. */}
      {submission.message ? (
        <p className="mt-2 max-w-[68ch] text-xs leading-relaxed whitespace-pre-wrap text-ink-muted">
          {submission.message}
        </p>
      ) : (
        <p className="mt-2 text-xs text-ink-faint">
          No note was written with this submission.
        </p>
      )}

      {/**
        * **The work itself — BOTH places it can live.**
        *
        * This card rendered `submission.attachments` alone, so a reviewer saw
        * the covering note and no way to open what it described: exactly the
        * fault `ReviewPanel` was fixed for, reintroduced here by carrying over
        * only half of what it does.
        *
        * A submission holds files in two stores and neither alone is the
        * answer. Cowork's own uploader puts them in the attachment service
        * keyed to this submission — private, streamed, and what
        * `EntityAttachments` fetches, which is where anything uploaded from
        * this app actually lands. The older application instead wrote URLs
        * onto the task record, and work submitted there still has to be
        * readable. `SubmittedFiles` renders nothing when its list is empty, so
        * the pair costs nothing when only one store has anything in it.
        */}
      <EntityAttachments
        entityType="submission"
        entityId={submission.id}
        title="Submitted work"
      />
      <SubmittedFiles files={submission.attachments} label="Also attached" />

      {canReview ? (
        /* **The real decision box, not a link to it.** Two buttons opening a
           dialog put a second screen in front of a choice that is two options
           and a sentence. `ReviewDecisionBox` is the same component the Review
           tab renders — `compact` only drops its panel frame, because the card
           around it is already the surface. Every rule it carries (the rework
           requirement gate, the deduction waiver, correction files, the
           re-rank) comes with it rather than being skipped. */
        <div className="mt-3 border-t border-hairline pt-3">
          <ReviewDecisionBox
            view={view}
            submission={submission}
            onChange={onDecided}
            compact
          />
        </div>
      ) : (
        /* Never a bare absence. Somebody who cannot decide should be told that
           the work is with somebody else, not left looking for a button. */
        <p className="mt-3 border-t border-hairline pt-3 text-[11px] text-ink-faint">
          {submission.submittedById === viewerId
            ? "Waiting on your reviewer."
            : "This is with its reviewer."}
        </p>
      )}
    </div>
  );
}
