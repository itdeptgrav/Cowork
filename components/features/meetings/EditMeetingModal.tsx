"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import {
  Button,
  Field,
  InlineError,
  Input,
  Select,
  Textarea,
} from "@/components/ui/Primitives";
import { EmployeePicker } from "./EmployeePicker";
import { useAction, useQuery } from "@/lib/hooks/useRepository";
import type { Meeting } from "@/lib/domain";

/**
 * Change a booking without leaving the list.
 *
 * ## The same shape as the schedule form, on purpose
 *
 * Title, agenda, when, how long, who — the fields somebody filled in to make
 * the meeting are the fields they come back to change, in the same order and
 * with the same controls (`EmployeePicker` included), so editing reads as
 * "the form again, filled in" rather than a second, different form.
 *
 * ## Only the organiser gets here
 *
 * The menu that opens this is drawn from `manageRefusal`, the same rule the
 * repository and the engine refuse with, so the dialog never opens for a
 * meeting the person cannot change. The write is one `updateMeeting` call:
 * the repository keeps the organiser on the meeting whatever the picker sends,
 * tells everybody invited, and writes the change to the meeting's history.
 *
 * Mounted only while open, so every open starts from the meeting as it is
 * now rather than from a draft left behind last time.
 */

/** ISO → what a `datetime-local` input wants, in the reader's own zone. */
function toLocalInput(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** The lengths offered. A meeting booked for some other length keeps it. */
const LENGTHS = [15, 30, 45, 60, 90, 120, 180];

function currentLength(m: Meeting): number {
  const secs = (Date.parse(m.endsAt) - Date.parse(m.startsAt)) / 1000;
  if (!Number.isFinite(secs) || secs <= 0) return 60;
  return Math.max(5, Math.round(secs / 60));
}

function lengthLabel(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h} h ${m} min` : `${h} hour${h === 1 ? "" : "s"}`;
}

export function EditMeetingModal({
  meeting,
  onClose,
  onSaved,
}: {
  meeting: Meeting;
  onClose: () => void;
  /** The meeting as the store now holds it. */
  onSaved?: (meeting: Meeting) => void;
}) {
  const [title, setTitle] = useState(meeting.title);
  const [description, setDescription] = useState(meeting.description ?? "");
  const [startsAt, setStartsAt] = useState(() => toLocalInput(meeting.startsAt));
  const [minutes, setMinutes] = useState(() => currentLength(meeting));
  /* The picker holds who is TICKED; the organiser is fixed at its top and is
     kept on the meeting by the repository, so they are not in this list. */
  const [participantIds, setParticipantIds] = useState<string[]>(() =>
    meeting.participantIds.filter((id) => id !== meeting.organiserId),
  );
  /* `createPortal` needs `document`; guard the first (possibly server) render. */
  const [mounted, setMounted] = useState(false);

  const people = useQuery((r) => r.listEmployees(), []);

  const [save, state] = useAction((r) => {
    const start = new Date(startsAt);
    return r.updateMeeting(meeting.id, {
      title: title.trim(),
      description: description.trim() || null,
      startsAt: start.toISOString(),
      endsAt: new Date(start.getTime() + minutes * 60_000).toISOString(),
      participantIds,
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

  const canSave =
    Boolean(title.trim()) && Boolean(startsAt) && !state.isPending;

  const submit = async () => {
    if (!canSave) return;
    const r = await save();
    if (r.ok) {
      onSaved?.(r.data);
      onClose();
    }
  };

  const lengths = LENGTHS.includes(minutes)
    ? LENGTHS
    : [...LENGTHS, minutes].sort((a, b) => a - b);

  return createPortal(
    <div
      className="fixed inset-0 z-[60] grid place-items-center bg-black/60 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="Edit meeting"
      /* Click the dimmed backdrop to dismiss — but only the backdrop itself,
         not a click that started inside the panel and released here. */
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="flex max-h-[calc(100dvh-2rem)] w-[min(92vw,520px)] flex-col overflow-hidden rounded-panel border border-hairline bg-[var(--surface-raised)] shadow-[var(--deck-seat)]">
        <div className="shrink-0 border-b border-hairline px-5 py-4">
          <h2 className="text-base font-medium text-ink">Edit meeting</h2>
          <p className="mt-1 text-[12px] leading-relaxed text-ink-muted">
            Everyone invited is told what changed.
          </p>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
          <Field
            label="Title"
            required
            error={state.errorField === "title" ? state.error : null}
          >
            <Input
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void submit();
                }
              }}
            />
          </Field>

          <Field label="Agenda">
            <Textarea
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </Field>

          {/* When and how long, side by side where there is room: one question
              about time, not two paragraphs of form. */}
          <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_9rem]">
            <Field
              label="Starts"
              required
              error={state.errorField === "startsAt" ? state.error : null}
            >
              <Input
                type="datetime-local"
                value={startsAt}
                onChange={(e) => setStartsAt(e.target.value)}
                className="[&::-webkit-calendar-picker-indicator]:cursor-pointer [&::-webkit-calendar-picker-indicator]:opacity-70 [&::-webkit-calendar-picker-indicator]:transition-opacity hover:[&::-webkit-calendar-picker-indicator]:opacity-100"
              />
            </Field>
            <Field
              label="Length"
              error={state.errorField === "endsAt" ? state.error : null}
            >
              <Select
                value={minutes}
                onChange={(e) => setMinutes(Number(e.target.value))}
              >
                {lengths.map((l) => (
                  <option key={l} value={l}>
                    {lengthLabel(l)}
                  </option>
                ))}
              </Select>
            </Field>
          </div>

          <div>
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
              fixedId={meeting.organiserId}
              maxHeightClass="max-h-48"
            />
          </div>

          {state.error && !state.errorField && (
            <InlineError message={state.error} code={state.errorCode} />
          )}
        </div>

        <div className="flex shrink-0 justify-end gap-2 border-t border-hairline px-5 py-3">
          <Button onClick={onClose} disabled={state.isPending}>
            Cancel
          </Button>
          <Button
            tone="primary"
            loading={state.isPending}
            disabled={!canSave}
            onClick={() => void submit()}
          >
            {state.isPending ? "Saving…" : "Save changes"}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
