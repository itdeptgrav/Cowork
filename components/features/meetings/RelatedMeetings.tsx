"use client";

import Link from "next/link";
import { Chip, Panel, PanelHead } from "@/components/ui/Primitives";
import { useQuery } from "@/lib/hooks/useRepository";
import { formatDateTime } from "@/lib/utils/format";

/**
 * Meetings about this task.
 *
 * On the task rather than only on the meeting, because "what was decided about
 * this" is a question people ask from the work, not from a calendar. The list
 * is already scoped by `canView` in the repository, so a task shared with
 * somebody does not leak a meeting they were not part of.
 *
 * Renders nothing when there are none — most tasks never have a meeting, and a
 * permanent empty panel on every task detail would be noise on all of them.
 */
export function RelatedMeetings({ taskId }: { taskId: string }) {
  const meetings = useQuery((r) => r.listMeetingsForTask(taskId), [taskId]);
  const rows = meetings.data ?? [];
  if (meetings.isLoading || rows.length === 0) return null;

  return (
    <Panel padded={false}>
      <div className="px-5 pt-4">
        <PanelHead
          title="Meetings"
          sub={`${rows.length} about this task`}
        />
      </div>
      <div className="mt-2 divide-y divide-hairline">
        {rows.map((m) => (
          <Link
            key={m.id}
            href={`/meetings/${m.id}`}
            className="flex flex-wrap items-center gap-3 px-5 py-2.5 transition-colors hover:bg-[var(--control)]"
          >
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm text-ink">{m.title}</span>
              <span className="mt-0.5 block text-[11px] text-ink-faint">
                {formatDateTime(m.startsAt)}
                {m.actualDurationSecs !== null &&
                  ` · ran ${Math.round(m.actualDurationSecs / 60)}m`}
              </span>
            </span>
            <Chip tone={m.status === "live" ? "positive" : "neutral"}>
              {m.status === "waiting" ? "waiting room" : m.status}
            </Chip>
          </Link>
        ))}
      </div>
    </Panel>
  );
}
