"use client";

import { useMemo, useState } from "react";
import type { Employee } from "@/lib/domain";
import { useAction } from "@/lib/hooks/useRepository";
import { Button, InlineError } from "@/components/ui/Primitives";
import { Icon } from "@/components/ui/Icons";
import { EmployeePicker } from "./EmployeePicker";

/**
 * Add more internal people to a meeting that already exists — the organiser's
 * "invite someone I forgot" after the meeting is made. `setMeetingParticipants`
 * REPLACES the list, so the write is the current people plus the newly picked
 * ones; the organiser is always kept. Guest (outside-CoWork) invites are the
 * separate `PublicLinkPanel` — this is internal only.
 */
export function AddParticipants({
  meetingId,
  currentIds,
  organiserId,
  people,
}: {
  meetingId: string;
  /** Everyone already in the meeting, organiser included. */
  currentIds: string[];
  organiserId: string;
  people: Employee[];
}) {
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);

  /* Only people not already in — you cannot add someone twice. */
  const available = useMemo(
    () => people.filter((p) => !currentIds.includes(p.id)),
    [people, currentIds],
  );

  const [save, state] = useAction((r) =>
    r.setMeetingParticipants(meetingId, [
      ...new Set([organiserId, ...currentIds, ...picked]),
    ]),
  );

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-inset border border-dashed border-hairline py-2 text-sm text-ink-muted transition-colors hover:border-ink-faint hover:text-ink"
      >
        <Icon.plus className="h-3.5 w-3.5" />
        Add people
      </button>
    );
  }

  return (
    <div className="mt-3">
      {available.length === 0 ? (
        <p className="rounded-inset border border-hairline px-3 py-2 text-sm text-ink-faint">
          Everyone in the directory is already invited.
        </p>
      ) : (
        <EmployeePicker
          people={available}
          selected={picked}
          onToggle={(id) =>
            setPicked((c) => (c.includes(id) ? c.filter((x) => x !== id) : [...c, id]))
          }
          disabled={state.isPending}
          maxHeightClass="max-h-56"
        />
      )}

      {state.error && (
        <div className="mt-2">
          <InlineError compact message={state.error} code={state.errorCode} />
        </div>
      )}

      <div className="mt-2 flex items-center justify-end gap-2">
        <Button
          size="sm"
          onClick={() => {
            setOpen(false);
            setPicked([]);
          }}
        >
          Cancel
        </Button>
        <Button
          size="sm"
          tone="primary"
          loading={state.isPending}
          disabled={state.isPending || picked.length === 0}
          onClick={async () => {
            const r = await save();
            if (r.ok) {
              setOpen(false);
              setPicked([]);
            }
          }}
        >
          {state.isPending
            ? "Adding…"
            : `Add ${picked.length || ""}`.trim()}
        </Button>
      </div>
    </div>
  );
}
