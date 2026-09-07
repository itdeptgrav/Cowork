"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { Button, Field, InlineError, Input } from "@/components/ui/Primitives";
import { EmployeePicker } from "./EmployeePicker";
import { useAction, useQuery } from "@/lib/hooks/useRepository";

/**
 * Start an instant meeting without leaving the page.
 *
 * ## Why a pop-up and not the /meetings/new form
 *
 * An instant meeting is a name and who is in it — nothing else. Sending somebody
 * to the full new-meeting page (title, an agenda, a start time they do not need,
 * then a lobby) to begin "now" is a screenful of friction for a one-line intent.
 * This is that one line, over the page they are already on: name it, invite
 * people, start.
 *
 * ## It reuses the real machinery, it does not fork it
 *
 * The write is the SAME `createMeeting` the scheduled form calls, and the invite
 * control is the SAME `EmployeePicker` — an instant meeting is just a scheduled
 * one that starts now with no agenda, so there is nothing here the form does not
 * already do. On success it goes to the meeting page, which JOINS on open (see
 * `MeetingDetailArea`), so "Start meeting" lands you in the call rather than on
 * another form.
 *
 * Mounted only while open (the caller renders it conditionally), so its two
 * queries do not run until somebody actually starts a meeting, and every open is
 * a clean slate with no state to reset.
 */
export function InstantMeetingModal({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [participantIds, setParticipantIds] = useState<string[]>([]);
  /* `createPortal` needs `document`; guard the first (possibly server) render. */
  const [mounted, setMounted] = useState(false);

  const people = useQuery((r) => r.listEmployees(), []);
  const me = useQuery((r) => r.getCurrentEmployee(), []);
  const myId = me.data?.id ?? null;

  /* The organiser is in the meeting by construction — first, and de-duplicated
     against the picked ids — matching how the scheduled form builds the list. */
  const effectiveParticipantIds = myId
    ? [myId, ...participantIds.filter((id) => id !== myId)]
    : participantIds;

  const [create, state] = useAction((r) => {
    /* Instant: it starts the moment the button is pressed. Booked for an hour,
       exactly as the scheduled path books its chosen time. No agenda. */
    const start = new Date();
    return r.createMeeting({
      title: title.trim(),
      description: null,
      participantIds: effectiveParticipantIds,
      startsAt: start.toISOString(),
      endsAt: new Date(start.getTime() + 3600_000).toISOString(),
    });
  });

  useEffect(() => setMounted(true), []);

  /* Escape closes it, like every other dismissible surface in the app. */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (!mounted) return null;

  const canStart = Boolean(title.trim()) && !state.isPending;

  const start = async () => {
    if (!canStart) return;
    const r = await create();
    if (r.ok) {
      onClose();
      /* The meeting page joins on open, so this is "enter the meeting". */
      router.push(`/meetings/${r.data.id}`);
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[60] grid place-items-center bg-black/60 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="Start an instant meeting"
      /* Click the dimmed backdrop to dismiss — but only the backdrop itself, not
         a click that started inside the panel and released here. */
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="flex max-h-[calc(100dvh-2rem)] w-[min(92vw,440px)] flex-col overflow-hidden rounded-panel border border-hairline bg-[var(--surface-raised)] shadow-[var(--deck-seat)]">
        <div className="shrink-0 border-b border-hairline px-5 py-4">
          <h2 className="text-base font-medium text-ink">Start an instant meeting</h2>
          <p className="mt-1 text-[12px] leading-relaxed text-ink-muted">
            It begins now — name it and invite people, then step straight in.
          </p>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          <Field
            label="Meeting name"
            required
            error={state.errorField === "title" ? state.error : null}
          >
            <Input
              autoFocus
              value={title}
              placeholder="Enter meeting name"
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => {
                /* Enter starts it — the name is the only required field, so the
                   keyboard alone can begin the meeting. */
                if (e.key === "Enter") {
                  e.preventDefault();
                  void start();
                }
              }}
            />
          </Field>

          <div className="mt-4">
            <div className="mb-1.5 flex items-baseline justify-between gap-2">
              <span className="text-sm font-medium text-ink">Invite people</span>
              <span className="text-[11px] text-ink-faint">
                {participantIds.length
                  ? `${participantIds.length + 1} in this meeting`
                  : "just you so far"}
              </span>
            </div>
            <EmployeePicker
              people={people.data ?? []}
              selected={participantIds}
              onToggle={(id) =>
                setParticipantIds((c) =>
                  c.includes(id) ? c.filter((x) => x !== id) : [...c, id],
                )
              }
              fixedId={myId}
              maxHeightClass="max-h-56"
            />
          </div>

          {state.error && !state.errorField && (
            <div className="mt-3">
              <InlineError message={state.error} code={state.errorCode} />
            </div>
          )}
        </div>

        <div className="flex shrink-0 justify-end gap-2 border-t border-hairline px-5 py-3">
          <Button onClick={onClose} disabled={state.isPending}>
            Cancel
          </Button>
          <Button
            tone="primary"
            loading={state.isPending}
            disabled={!canStart}
            onClick={() => void start()}
          >
            {state.isPending ? "Starting…" : "Start meeting"}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
