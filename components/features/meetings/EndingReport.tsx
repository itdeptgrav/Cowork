"use client";

import { useEffect, useState } from "react";
import { Button, Panel, PanelHead } from "@/components/ui/Primitives";
import { useLiveNow } from "@/lib/hooks/useLiveNow";
import {
  getCoworkSocket,
  joinMeetingRoom,
  leaveMeetingRoom,
  onParticipantStatus,
  type RecordingState,
  type UploadState,
} from "@/lib/legacy-ui/coworkSocket";

/**
 * End for everyone — the organiser's side of it.
 *
 * ## What pressing it does
 *
 * The status goes to `completed`. The engine then tells every browser in the
 * call — the meeting's socket room, guests included — to finalise its own
 * audio and leave, and deletes the LiveKit room so a browser that heard
 * neither is disconnected regardless. Each person's recording is uploaded by
 * THEIR browser: `/audio/finalize` takes the identity from the caller, so no
 * host and no server can push it for them. That is the fact the wording here
 * is built around, and why the confirmation does not say "saved".
 *
 * ## The wrap-up panel
 *
 * The organiser is the one person who wants to know it worked, and the room —
 * which used to carry the recording-status panel — is gone by then. So the
 * page watches instead: it joins the meeting's socket room itself and reads
 * the `participant_status` each recorder broadcasts as it finalises, for up
 * to thirty seconds. Non-blocking, by design: nothing here holds anybody's
 * upload, and leaving the page does not stop one. It closes itself once
 * everybody has reported and eight seconds have passed (so it can be read),
 * or at thirty seconds whatever has happened.
 */

const SOFT_MS = 8_000;
const HARD_MS = 30_000;

interface Row {
  id: string;
  name: string;
  recordingState?: RecordingState;
  uploadState?: UploadState;
}

/** The button, as it sits among the organiser's other controls. */
export function EndForEveryoneButton({
  pending,
  open,
  onToggle,
}: {
  pending: boolean;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <Button
      loading={pending}
      /* Red, because it disconnects everybody and cannot be undone — the one
         control on the page that should look like what it does. */
      tone="destructive"
      size="sm"
      disabled={pending}
      aria-expanded={open}
      onClick={onToggle}
    >
      End for everyone
    </Button>
  );
}

/**
 * The confirmation, drawn in the page rather than as a popover — the masthead
 * it would hang from is not a place a popover can be relied on to escape.
 */
export function EndForEveryoneConfirm({
  onConfirm,
  onCancel,
}: {
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Panel label="End the meeting for everyone?">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="text-sm font-medium text-ink">
            End the meeting for everyone?
          </p>
          <p className="mt-1 max-w-[60ch] text-xs leading-relaxed text-ink-muted">
            Everyone is disconnected from the room, guests included. Each
            person&rsquo;s audio is finalised and uploaded to Drive from their
            own computer, and you will see it arrive here.
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          <Button tone="primary" size="sm" onClick={onConfirm}>
            End for everyone
          </Button>
          <Button tone="ghost" size="sm" onClick={onCancel}>
            Keep going
          </Button>
        </div>
      </div>
    </Panel>
  );
}

/** What a row says, and whether there is anything left to wait for. */
function describe(r: Row): { text: string; done: boolean; tone: string } {
  if (!r.uploadState && !r.recordingState)
    return { text: "waiting for their browser…", done: false, tone: "var(--ink-faint)" };
  switch (r.uploadState) {
    case "uploaded":
      return { text: "saved to Drive", done: true, tone: "var(--state-positive)" };
    case "none":
      return { text: "no audio to save", done: true, tone: "var(--ink-faint)" };
    case "failed":
      return {
        text: "upload failed — it retries from their computer",
        done: true,
        tone: "var(--state-overdue)",
      };
    case "uploading":
      return { text: "uploading…", done: false, tone: "var(--state-risk)" };
    default:
      break;
  }
  if (r.recordingState === "recording" || r.recordingState === "paused")
    return { text: "finishing their recording…", done: false, tone: "var(--state-risk)" };
  if (r.recordingState === "failed")
    return { text: "microphone was not recording", done: true, tone: "var(--ink-faint)" };
  /* `not_rec` with nothing uploading: there was no recording running for
     them, so there is nothing to wait for. */
  return { text: "nothing was recording", done: true, tone: "var(--ink-faint)" };
}

export function EndingReport({
  meetId,
  employeeId,
  people,
  startedAt,
  onDismiss,
}: {
  meetId: string;
  /** Whose socket this is — the organiser's. */
  employeeId: string;
  /** Everybody who was in the room, so a row exists before they report. */
  people: { id: string; name: string }[];
  /** When End was pressed; the clock the two limits count from. */
  startedAt: number;
  onDismiss: () => void;
}) {
  const [seen, setSeen] = useState<Map<string, Row>>(() => new Map());
  const now = useLiveNow();
  const elapsed = now - startedAt;

  /* Watch the room's statuses from the page, after the room itself has gone.
     The recorder's own listener leaves the socket room on unmount, so this
     re-joins on a short interval — joining a room already joined is a no-op,
     and it is what keeps the statuses arriving. */
  useEffect(() => {
    if (!meetId || !employeeId) return;
    getCoworkSocket(employeeId);
    const off = onParticipantStatus((p) => {
      if (!p.employeeId) return;
      setSeen((prev) => {
        const next = new Map(prev);
        next.set(p.employeeId, {
          id: p.employeeId,
          name: p.employeeName || p.employeeId,
          recordingState: p.recordingState,
          uploadState: p.uploadState,
        });
        return next;
      });
    });
    joinMeetingRoom(meetId);
    const iv = setInterval(() => joinMeetingRoom(meetId), 3_000);
    return () => {
      clearInterval(iv);
      off();
      leaveMeetingRoom(meetId);
    };
  }, [meetId, employeeId]);

  /* The invited-and-joined list first, in its own order; anybody who reports
     without being on it — a guest — is appended. */
  const rows: Row[] = people.map((p) => seen.get(p.id) ?? { id: p.id, name: p.name });
  for (const [id, r] of seen) if (!people.some((p) => p.id === id)) rows.push(r);
  const described = rows.map((r) => ({ row: r, ...describe(r) }));
  const allDone = described.length > 0 && described.every((d) => d.done);

  /* Close itself: at thirty seconds whatever has happened, or once everybody
     has reported and eight seconds have passed — long enough to be read. */
  const shouldClose = elapsed >= HARD_MS || (elapsed >= SOFT_MS && allDone);
  useEffect(() => {
    if (shouldClose) onDismiss();
  }, [shouldClose, onDismiss]);

  const secondsLeft = Math.max(0, Math.ceil((HARD_MS - elapsed) / 1000));

  return (
    <Panel label="Ending the meeting" className="mb-4">
      <PanelHead
        title="Ending the meeting"
        sub="Everyone has been disconnected. Each person's audio is saved to Drive from their own computer."
      />
      {described.length === 0 ? (
        <p className="text-xs text-ink-muted">Nobody else was in the room.</p>
      ) : (
        <ul className="divide-y divide-hairline text-sm">
          {described.map(({ row, text, tone }) => (
            <li key={row.id} className="flex items-center gap-2.5 py-2">
              <span
                aria-hidden="true"
                className="h-1.5 w-1.5 shrink-0 rounded-full"
                style={{ backgroundColor: tone }}
              />
              <span className="min-w-0 flex-1 truncate text-ink">{row.name}</span>
              <span className="shrink-0 text-xs text-ink-muted">{text}</span>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs text-ink-muted">
          Their audio uploads from their own computer. Leaving now does not
          stop it.
          {!allDone && (
            <span className="text-ink-faint"> Closes in {secondsLeft}s.</span>
          )}
        </p>
        <Button tone="ghost" size="sm" onClick={onDismiss}>
          Done
        </Button>
      </div>
    </Panel>
  );
}
