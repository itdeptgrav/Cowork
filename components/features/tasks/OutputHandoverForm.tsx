"use client";

import { useState } from "react";
import { Button, InlineError, Input } from "@/components/ui/Primitives";
import { FileUploader } from "@/components/features/attachments/Attachments";
import { UploadProgressRow } from "@/components/features/messages/MessageAttachments";
import { useAction, useRepo } from "@/lib/hooks/useRepository";
import type { ReportAttachment, TaskId } from "@/lib/domain";

/**
 * Handing one output over: the covering note, the work, and Send.
 *
 * ## Why it is its own component
 *
 * It is offered from two places — the output list on Overview and the one on
 * Submission — and there is exactly one right way to perform a handover. Two
 * copies is two upload paths, two definitions of what makes Send available and
 * two chances for one of them to fall behind the other, which is how a person
 * comes to attach a file on one screen and lose it on the other.
 *
 * The list is what differs between the two screens; this is what does not.
 *
 * ## Files
 *
 * Bytes go to Drive, browser-to-Google, never through the engine — the same
 * pipeline the message thread uses, so a large recording or a design archive is
 * viable rather than something that has to be shrunk first. `FileUploader` in
 * STAGING mode collects them: it already holds a list, refuses what it should,
 * shows what is chosen and lets one be taken back out, and a second picker
 * built here would be a second set of those rules to keep right.
 *
 * They upload on Send, not on choose — the engine writes the submission record
 * once, so it has to arrive with its files already attached.
 *
 * **Optional.** A note alone is a complete handover; not every output is a
 * document, and some are a sentence confirming something. The suggestion beside
 * the picker says why attaching helps rather than refusing without one.
 */

export function OutputHandoverForm({
  taskId,
  outputId,
  onDone,
  onCancel,
}: {
  taskId: TaskId;
  outputId: string;
  /** The handover succeeded — the caller closes the form and re-reads. */
  onDone: () => void;
  onCancel: () => void;
}) {
  const repo = useRepo();
  const [note, setNote] = useState("");
  const [staged, setStaged] = useState<File[]>([]);
  /** Named, because "upload failed" over four files does not say which. */
  const [uploadFailures, setUploadFailures] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  /**
   * How far each chosen file has got.
   *
   * `uploadDriveFile` has always taken an `onProgress` callback and this form
   * never passed one, so handing over a large document showed a bare spinner
   * for as long as it took — and a spinner cannot distinguish "still going"
   * from "stopped". The same row the message composer uses: a bar with the
   * percentage while the bytes move, then a turning ring and "Processing…"
   * while the server finalises, which reports no progress of its own.
   */
  const [uploads, setUploads] = useState<{ name: string; fraction: number }[]>(
    [],
  );

  const [submit, submitState] = useAction(
    (r, arg: { message: string; attachments: ReportAttachment[] }) =>
      r.submitOutput({
        taskId,
        outputId,
        message: arg.message,
        attachments: arg.attachments,
      }),
  );

  /* The engine's own control: absent means this build has no upload endpoint —
     the in-memory prototype — and a picker that cannot upload is worse than no
     picker. */
  const canUpload = typeof repo.uploadDriveFile === "function";
  const busy = uploading || submitState.isPending;

  async function send() {
    setUploadFailures([]);

    /**
     * **Upload first, submit second — and a failed file stops the submission.**
     *
     * Files are optional, but a file somebody CHOSE is not optional: they
     * decided the reviewer needed it. Submitting the note while their document
     * failed to upload would put work in front of a reviewer describing
     * something that is not there, and the person would believe they had sent
     * it. Nothing is written until every chosen file is up, so a failure costs
     * a retry and never a half-made handover.
     */
    const attachments: ReportAttachment[] = [];
    if (staged.length > 0) {
      if (!repo.uploadDriveFile) {
        setUploadFailures(staged.map((f) => f.name));
        return;
      }
      setUploading(true);
      /* Listed before the first byte moves, so the wait is accounted for from
         the moment it starts rather than when the first event happens to
         arrive. */
      setUploads(staged.map((file) => ({ name: file.name, fraction: 0 })));
      /* Together, not one after another. Each upload is independent, so the
         loop this replaced paid a whole round trip per file while somebody
         watched a spinner. `Promise.all` keeps the order, which matters: the
         handover lists these files and they should read in the order they were
         chosen rather than the order the network finished. */
      const results = await Promise.all(
        staged.map((file, at) =>
          /* By POSITION, not by name: two files chosen from different folders
             can share one, and matching on it would drive a single row from
             two uploads while another never moved. */
          repo.uploadDriveFile!(file, (fraction) =>
            setUploads((rows) =>
              rows.map((row, i) => (i === at ? { ...row, fraction } : row)),
            ),
          ),
        ),
      );
      const failed: string[] = [];
      results.forEach((up, i) => {
        const file = staged[i];
        if (up.ok) {
          attachments.push({
            url: up.data.url,
            name: up.data.name || file.name,
            mimeType: up.data.mimeType || file.type || "application/octet-stream",
          });
        } else {
          failed.push(file.name);
        }
      });
      setUploading(false);
      /* Cleared only once every upload has settled — a row that vanished at
         100% would hide the finalize step, which is the part people wait
         longest on. */
      setUploads([]);
      if (failed.length > 0) {
        setUploadFailures(failed);
        return;
      }
    }

    const r = await submit({ message: note, attachments });
    if (r && !r.ok) return;
    onDone();
  }

  return (
    <div className="mt-2.5 rounded-inset bg-[var(--surface-sunken)] p-3">
      <div className="mb-2 text-[11px] text-ink-faint">
        Describe what you are handing over. The reviewer sees this first.
      </div>
      <Input
        value={note}
        autoFocus
        placeholder="Copy and tariffs, temple timings confirmed"
        onChange={(e) => setNote(e.target.value)}
      />

      {canUpload ? (
        <div className="mt-2">
          <FileUploader
            entityType="submission"
            /* Staging: there is no submission to attach to until this one is
               written, and the id is the engine's to assign. */
            entityId={null}
            attachments={[]}
            onChange={() => {}}
            staged={staged}
            onStagedChange={setStaged}
            label="Attach the work — optional, any type, any size"
          />

          {/* Under the picker, where the chosen files are already listed, so
              the bars appear in the same place rather than somewhere new once
              Send is pressed. */}
          {uploads.length > 0 && (
            <ul className="mt-2 space-y-1.5" aria-live="polite">
              {uploads.map((u, i) => (
                <li key={`${u.name}-${i}`}>
                  <UploadProgressRow name={u.name} fraction={u.fraction} />
                </li>
              ))}
            </ul>
          )}
          {/* A suggestion, not a rule. Said once, beside the control it is
              about, and only while nothing is attached — repeating it under a
              list of four files would be nagging about a decision already
              made. */}
          {staged.length === 0 && (
            <p className="mt-1.5 text-[11px] text-ink-faint">
              Not required — a note on its own is a complete handover. Attaching
              the document, image, archive or recording usually saves a round
              trip, because the reviewer can decide without asking for it.
            </p>
          )}
        </div>
      ) : (
        <p className="mt-2 text-[11px] text-ink-faint">
          This build has no file storage, so the note is submitted on its own.
        </p>
      )}

      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          tone="primary"
          disabled={busy || !note.trim()}
          onClick={() => void send()}
        >
          {uploading
            ? "Uploading…"
            : submitState.isPending
              ? "Submitting…"
              : "Send for review"}
        </Button>
        <Button size="sm" disabled={busy} onClick={onCancel}>
          Cancel
        </Button>
      </div>

      {uploadFailures.length > 0 && (
        <div className="mt-2">
          <InlineError
            message={`Nothing was submitted — ${uploadFailures.join(", ")} did not upload. Try again, or remove the file and send the note on its own.`}
          />
        </div>
      )}
      {/* Surfaced, not swallowed. The engine refuses an empty message, a task
          that has not been started and an output still waiting on its inputs —
          a button that silently does nothing is worse than any of those. */}
      {submitState.error && (
        <div className="mt-2">
          <InlineError message={submitState.error} />
        </div>
      )}
    </div>
  );
}
