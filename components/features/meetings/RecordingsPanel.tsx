"use client";

import { Panel, PanelHead, SkeletonRows } from "@/components/ui/Primitives";
import { Icon } from "@/components/ui/Icons";
import { useQuery } from "@/lib/hooks/useRepository";
import { formatDateTime } from "@/lib/utils/format";
import type { MeetingParticipant } from "@/lib/domain";

/**
 * Whose audio actually reached Drive.
 *
 * ## Why a screen for this exists at all
 *
 * Every participant records their own microphone and uploads it on their own —
 * that independence is what stops one bad connection costing the whole
 * meeting. Its cost is that nobody could see the result: three people finish a
 * two-hour call and there is no way to tell whether three files were saved,
 * or two, without opening Drive and counting.
 *
 * The engine has written a record per finished upload since recording existed.
 * Nothing read them back. This does.
 *
 * ## Naming who is MISSING, not just who is present
 *
 * A list of files that arrived cannot be checked against a list nobody has. So
 * this crosses the recordings against the people who were in the room and says
 * plainly which of them produced no audio — the one fact somebody is looking
 * for, and the only one that prompts action while a recovery is still
 * possible. A missing person is not called a failure: they may simply never
 * have spoken, or never have started recording.
 *
 * A second file for one person is a REJOIN, not a duplicate. Somebody whose tab
 * reloaded, or whose host stopped and restarted, produces another segment; the
 * engine marks it and this says so, because two rows against one name otherwise
 * reads as something having gone wrong.
 */

function sizeLabel(bytes: number): string {
  if (bytes <= 0) return "";
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function RecordingsPanel({
  meetingId,
  participants,
  nameFor,
}: {
  meetingId: string;
  participants: MeetingParticipant[];
  /**
   * A participant's name.
   *
   * Passed in rather than looked up here: the page already holds the directory
   * it resolves every other name on this screen from, and a second lookup
   * would be a second answer to "what is this person called" — which is how
   * one screen comes to show two names for one person.
   */
  nameFor: (employeeId: string) => string;
}) {
  const recordings = useQuery(
    (r) => r.listMeetingRecordings(meetingId),
    [meetingId],
  );

  const rows = recordings.data ?? [];
  const withAudio = new Set(rows.map((r) => String(r.employeeId)));
  /* Only people who were actually in the room. Somebody invited who never
     joined has no audio to be missing. */
  const missing = participants.filter(
    (p) => p.joinedAt && !withAudio.has(String(p.employeeId)),
  );

  return (
    <Panel>
      <PanelHead
        title="Recorded audio"
        sub="One file per person — check everybody's arrived"
      />

      {recordings.isLoading ? (
        <SkeletonRows rows={2} />
      ) : recordings.isUnavailable ? (
        <p className="text-sm text-ink-muted">
          This build does not store recordings.
        </p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-ink-muted">
          No audio was recorded for this meeting.
        </p>
      ) : (
        <>
          <p className="mb-2 text-[12px] text-ink-faint" data-figure>
            {rows.length} file{rows.length === 1 ? "" : "s"} from{" "}
            {withAudio.size} {withAudio.size === 1 ? "person" : "people"}
          </p>
          <ul className="divide-y divide-hairline">
            {rows.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-2 py-2">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm text-ink">
                    {r.employeeName}
                    {r.isRejoin && (
                      <span className="ml-1.5 text-[11px] text-ink-faint">
                        · later segment
                      </span>
                    )}
                  </span>
                  <span className="block truncate text-[11px] text-ink-faint">
                    {r.uploadedAt ? formatDateTime(r.uploadedAt) : "Uploaded"}
                    {sizeLabel(r.sizeBytes) ? ` · ${sizeLabel(r.sizeBytes)}` : ""}
                  </span>
                </span>
                {/* The link is the verification. A row saying "uploaded" that
                    cannot be opened proves nothing. */}
                {r.viewUrl ? (
                  <a
                    href={r.viewUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex shrink-0 items-center gap-1.5 text-[13px] text-ink underline decoration-[var(--hairline)] underline-offset-2 hover:decoration-current"
                  >
                    <Icon.external className="h-3.5 w-3.5" />
                    Open in Drive
                  </a>
                ) : (
                  <span className="shrink-0 text-[11px] text-ink-faint">
                    No link recorded
                  </span>
                )}
              </li>
            ))}
          </ul>
        </>
      )}

      {/* Said whether or not anything was recorded: on a meeting with no files
          at all, "everybody is missing" is the most useful thing on screen. */}
      {!recordings.isLoading && !recordings.isUnavailable && missing.length > 0 && (
        <p className="mt-3 border-t border-hairline pt-3 text-[12px] leading-relaxed text-ink-muted">
          <strong className="text-ink">No audio from</strong>{" "}
          {missing.map((p) => nameFor(String(p.employeeId))).join(", ")}. They may not have
          spoken, or their recording may not have finished uploading — anything
          still waiting is kept in their own browser and sent when they next
          open Cowork.
        </p>
      )}
    </Panel>
  );
}
