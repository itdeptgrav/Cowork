"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { PreJoin } from "@livekit/components-react";
import "@livekit/components-styles";
import { Button, Chip, InlineError } from "@/components/ui/Primitives";
import { Icon } from "@/components/ui/Icons";
import { useAction } from "@/lib/hooks/useRepository";
import { formatDateTime } from "@/lib/utils/format";
import type { Meeting } from "@/lib/domain";

/**
 * The lobby — camera and microphone before the room, not after it.
 *
 * **Why this exists at all.** Scheduling a meeting used to end at a sentence
 * saying it had been scheduled: to actually start it you went back to the list,
 * found the meeting you had just made and opened it. Three navigations to reach
 * something you were already looking at.
 *
 * ## What it deliberately does not do
 *
 * It does not connect. `PreJoin` reads the local devices only — no token is
 * minted, no room is entered, nobody is told you are here. That matters because
 * the organiser checking their hair is not an event anybody should receive a
 * notification about, and a room entered by accident is one somebody has to
 * leave.
 *
 * ## Opening the room is a separate act from scheduling one
 *
 * `openMeetingRoom` is what mints the LiveKit room, and it is called on JOIN
 * rather than on create. A meeting scheduled for Thursday should not hold an
 * open room from Monday — LiveKit closes an empty room after five minutes
 * anyway, so creating it early would produce a room that is already gone by the
 * time anybody arrives.
 *
 * `PreJoin` is LiveKit's own: it already solves device enumeration, permission
 * prompts, the mirrored preview and remembering the choice. Same reasoning as
 * `MeetingRoom` — a second media stack is a second one to keep correct. It is
 * seated on the slab because that is the material for moving picture.
 */
export function MeetingLobby({
  meeting,
  displayName,
  onDismiss,
}: {
  meeting: Meeting;
  displayName: string;
  /** Rendered as "Not now" when present. Absent on a page that is only a lobby. */
  onDismiss?: () => void;
}) {
  const router = useRouter();
  const [open, openState] = useAction((r) => r.openMeetingRoom(meeting.id));
  const [failed, setFailed] = useState<string | null>(null);

  /**
   * Open the room, then go to it.
   *
   * Navigates only on success. Routing first and letting the detail page
   * discover the failure would replace a sentence saying what went wrong with a
   * room that silently is not there.
   */
  const join = async () => {
    setFailed(null);
    const result = await open();
    if (result.ok) {
      router.push(`/meetings/${encodeURIComponent(meeting.id)}`);
    } else {
      setFailed(result.message);
    }
  };

  const busy = openState.isPending;

  return (
    <section
      aria-label={`${meeting.title} — lobby`}
      className="slab slab-flat flex flex-col overflow-hidden rounded-card"
      data-on-slab
    >
      <header className="flex shrink-0 flex-wrap items-center gap-3 border-b border-white/10 px-4 py-3">
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-slab-ink">
            {meeting.title}
          </span>
          <span className="block truncate text-[11px] text-slab-ink-muted">
            {formatDateTime(meeting.startsAt)}
          </span>
        </span>
        <Chip tone="positive">scheduled</Chip>
      </header>

      {/* PreJoin brings its own controls and its own join button, so the only
          thing added underneath is the way OUT — there is no second "join". */}
      <div className="min-h-0 flex-1 p-3">
        <PreJoin
          joinLabel={busy ? "Opening the room…" : "Join now"}
          micLabel="Microphone"
          camLabel="Camera"
          userLabel={displayName}
          defaults={{ username: displayName, videoEnabled: true, audioEnabled: true }}
          persistUserChoices
          onSubmit={() => void join()}
          onError={(e) => setFailed(e.message)}
          data-lk-theme="default"
        />
      </div>

      {(failed || openState.error) && (
        <div className="px-3 pb-3">
          <InlineError message={failed ?? openState.error ?? ""} />
        </div>
      )}

      <footer className="flex shrink-0 flex-wrap items-center gap-2 border-t border-white/10 px-4 py-3">
        <p className="min-w-0 flex-1 text-[11px] leading-relaxed text-slab-ink-muted">
          {/* Said plainly, because a preview that looked like a live room would
              have people talking to nobody. */}
          Nobody can see or hear you yet. The room opens when you join.
        </p>
        {onDismiss && (
          <Button size="sm" tone="ghost" disabled={busy} onClick={onDismiss}>
            Not now
          </Button>
        )}
      </footer>
    </section>
  );
}

/** The lobby's own empty state, for a meeting that cannot be entered. */
export function LobbyClosed({ reason }: { reason: string }) {
  return (
    <section
      className="slab slab-flat grid min-h-[240px] place-items-center rounded-card px-8 text-center"
      data-on-slab
    >
      <div className="max-w-[38ch]">
        <span
          aria-hidden="true"
          className="mx-auto mb-4 grid h-11 w-11 place-items-center rounded-full bg-white/[0.07] text-slab-ink-muted"
        >
          <Icon.meeting className="h-5 w-5" />
        </span>
        <p className="text-[15px] font-medium text-slab-ink">
          This meeting cannot be opened
        </p>
        <p className="mt-1.5 text-xs leading-relaxed text-slab-ink-muted">
          {reason}
        </p>
      </div>
    </section>
  );
}
