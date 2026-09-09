"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Button, InlineError } from "@/components/ui/Primitives";
import { Icon } from "@/components/ui/Icons";
import { MenuItem, Popover } from "@/components/ui/Workspace";
import { useAction } from "@/lib/hooks/useRepository";
import { manageRefusal } from "@/lib/rules/meetings/access";
import type { Meeting } from "@/lib/domain";
import { EditMeetingModal } from "./EditMeetingModal";

/**
 * The ⋮ beside a meeting on the dashboard: Edit meeting, Delete meeting.
 *
 * ## Drawn for the organiser, nobody else
 *
 * `manageRefusal` is the one rule for changing a meeting — the repository and
 * the engine refuse with it — so the menu is offered exactly where its items
 * would succeed. A participant sees the row and no ⋮, which is the same
 * distinction the Join button already draws with `canJoin`: a control that
 * would be refused is not a control.
 *
 * ## Edit and Delete are different acts
 *
 * Edit reopens the booking as a form. Delete removes the record — for
 * everybody, with its history and its chat — so it asks first, and it is
 * refused while the room is open: people are in it, and End for everyone is
 * the path that finalises their audio before the room goes. The dialog says
 * that instead of offering a button that would be refused.
 */

/** A cancelled or finished meeting is a record, not something to edit. */
const EDITABLE: readonly Meeting["status"][] = ["scheduled", "waiting", "live"];
/** A room with people in it is ended, not deleted from under them. */
const RUNNING: readonly Meeting["status"][] = ["waiting", "live"];

export function MeetingRowMenu({
  meeting,
  viewerId,
  onChanged,
}: {
  meeting: Meeting;
  viewerId: string;
  /** After a change or a deletion — the list re-reads itself. */
  onChanged?: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);

  if (manageRefusal(meeting, viewerId)) return null;
  const canEdit = EDITABLE.includes(meeting.status);

  return (
    <>
      <Popover
        label={`Options for ${meeting.title}`}
        align="right"
        trigger={({ open, toggle }) => (
          <button
            type="button"
            onClick={toggle}
            aria-haspopup="menu"
            aria-expanded={open}
            aria-label="Meeting options"
            title="Meeting options"
            /* 32px — the same thumb-sized target the rest of the meeting
               surfaces keep on a phone. */
            className={`grid h-8 w-8 shrink-0 place-items-center rounded-full transition-colors ${
              open
                ? "bg-[var(--control)] text-ink"
                : "text-ink-muted hover:bg-[var(--control)] hover:text-ink"
            }`}
          >
            <Icon.more className="h-4 w-4" />
          </button>
        )}
      >
        {(close) => (
          <>
            {canEdit && (
              <MenuItem
                icon="edit"
                onClick={() => {
                  close();
                  setEditing(true);
                }}
              >
                Edit meeting
              </MenuItem>
            )}
            <MenuItem
              icon="trash"
              danger
              onClick={() => {
                close();
                setDeleting(true);
              }}
            >
              Delete meeting
            </MenuItem>
          </>
        )}
      </Popover>

      {editing && (
        <EditMeetingModal
          meeting={meeting}
          onClose={() => setEditing(false)}
          onSaved={() => onChanged?.()}
        />
      )}
      {deleting && (
        <DeleteMeetingDialog
          meeting={meeting}
          onClose={() => setDeleting(false)}
          onDeleted={() => onChanged?.()}
        />
      )}
    </>
  );
}

/**
 * "Delete this meeting?" — asked in the reader's own words for what is about
 * to happen, because it cannot be undone. A running meeting gets the rule
 * instead of the button.
 */
function DeleteMeetingDialog({
  meeting,
  onClose,
  onDeleted,
}: {
  meeting: Meeting;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const running = RUNNING.includes(meeting.status);
  const [remove, state] = useAction((r) => r.deleteMeeting(meeting.id));
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (!mounted) return null;

  const confirm = async () => {
    const r = await remove();
    if (r.ok) {
      onDeleted();
      onClose();
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[60] grid place-items-center bg-black/60 p-4 backdrop-blur-sm"
      role="alertdialog"
      aria-modal="true"
      aria-label="Delete meeting"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-[min(92vw,440px)] overflow-hidden rounded-panel border border-hairline bg-[var(--surface-raised)] shadow-[var(--deck-seat)]">
        <div className="px-5 py-4">
          <h2 className="text-base font-medium text-ink">
            {running ? "This meeting is running" : "Delete this meeting?"}
          </h2>
          <p className="mt-1.5 text-sm leading-relaxed text-ink-muted">
            {running ? (
              <>
                People are in &ldquo;{meeting.title}&rdquo; right now. End the
                meeting for everyone first, then delete it.
              </>
            ) : (
              <>
                &ldquo;{meeting.title}&rdquo; is removed for everyone invited,
                with its history and its chat. This cannot be undone. Audio
                already saved to Drive stays where it is.
              </>
            )}
          </p>
          {state.error && (
            <div className="mt-3">
              <InlineError message={state.error} code={state.errorCode} />
            </div>
          )}
        </div>
        <div className="flex justify-end gap-2 border-t border-hairline px-5 py-3">
          <Button onClick={onClose} disabled={state.isPending}>
            {running ? "Close" : "Keep it"}
          </Button>
          {!running && (
            <Button
              tone="destructive"
              loading={state.isPending}
              disabled={state.isPending}
              onClick={() => void confirm()}
            >
              {state.isPending ? "Deleting…" : "Delete meeting"}
            </Button>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
