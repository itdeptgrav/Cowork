"use client";

import Link from "next/link";
import { Icon, type IconName } from "@/components/ui/Icons";
import { clockTime, duration } from "./MonitorParts";
import type { ActivityEvent, ActivityKind } from "@/lib/domain";

/**
 * The working day, most recent first.
 *
 * A rail with a hairline spine and a node per event — the shape a timeline
 * needs and the only new geometry on the page. Rows separate with hairlines and
 * space, per the system; nothing here is a nested card.
 *
 * Two decisions worth stating:
 *
 *  · **Idle is drawn, not omitted.** A gap that disappears reads as continuous
 *    work. Idle rows use the hatched track the system already owns for
 *    "nothing tracked", so the absence is encoded without colour and survives
 *    both themes and colour-vision differences.
 *  · **Notable is a weight, not an alarm.** The provider marks what stands out;
 *    the row answers with a slightly stronger node and full-strength ink, never
 *    a red border. A monitoring surface that dramatises every anomaly trains
 *    its reader to stop looking.
 */

const KIND_GLYPH: Record<ActivityKind, IconName> = {
  website: "external",
  application: "projects",
  task: "tasks",
  meeting: "meeting",
  attendance: "attendance",
  idle: "clock",
};

const KIND_LABEL: Record<ActivityKind, string> = {
  website: "Website",
  application: "Application",
  task: "Task",
  meeting: "Meeting",
  attendance: "Attendance",
  idle: "Idle",
};

export function ActivityTimeline({
  events,
  timezone,
  className = "max-h-[420px]",
}: {
  events: ActivityEvent[];
  timezone: string;
  className?: string;
}) {
  return (
    <ol
      className={`relative -mx-1 overflow-y-auto pr-1 pl-1 scroll-slim ${className}`}
    >
      {/* The spine. Absolute so it runs behind the nodes without adding a
          border to any row — the system separates with hairlines, and this is
          one hairline for the whole list rather than one per item. */}
      <span
        aria-hidden="true"
        className="absolute top-2 bottom-2 left-[9px] w-px bg-hairline"
      />
      {events.map((e) => (
        <TimelineRow key={e.id} event={e} timezone={timezone} />
      ))}
    </ol>
  );
}

function TimelineRow({
  event,
  timezone,
}: {
  event: ActivityEvent;
  timezone: string;
}) {
  const Glyph = Icon[KIND_GLYPH[event.kind]];
  const idle = event.kind === "idle";
  const open = event.endedAt === null;

  const body = (
    <>
      <span className="relative z-10 mt-[3px] grid h-[18px] w-[18px] shrink-0 place-items-center rounded-full">
        <span
          aria-hidden="true"
          className={`absolute inset-0 rounded-full ${
            idle
              ? "hatch bg-[var(--surface-sunken)]"
              : event.notable
                ? "bg-[var(--control-active)]"
                : "bg-[var(--control)]"
          }`}
        />
        <Glyph
          className={`relative h-[11px] w-[11px] ${
            event.notable ? "text-ink" : "text-ink-faint"
          }`}
        />
      </span>

      <span className="min-w-0 flex-1">
        {/* Two lines before an ellipsis, not one. The rail is narrow and an
            event label is data — "Submitted for review: Meeting notes…" tells a
            manager less than the sentence it came from. */}
        <span
          className={`block text-xs [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:2] overflow-hidden ${
            event.notable ? "font-medium text-ink" : "text-ink"
          }`}
        >
          {event.label}
          {open && (
            <span className="ml-1.5 text-[11px] text-[var(--state-positive-ink)]">
              now
            </span>
          )}
        </span>
        {event.detail && (
          <span className="mt-0.5 block truncate text-[11px] text-ink-faint">
            {event.detail}
          </span>
        )}
      </span>

      <span className="shrink-0 pt-px text-right">
        <span data-figure className="block text-[11px] text-ink-muted">
          {clockTime(event.startedAt, timezone)}
        </span>
        <span data-figure className="mt-0.5 block text-[11px] text-ink-faint">
          {duration(event.durationSecs)}
        </span>
      </span>
    </>
  );

  return (
    <li>
      {event.href ? (
        <Link
          href={event.href}
          className="-mx-2 flex items-start gap-2.5 rounded-inset px-2 py-2 transition-colors hover:bg-[var(--row-hover)]"
        >
          {body}
          <span className="sr-only">
            {KIND_LABEL[event.kind]} — open in Cowork
          </span>
        </Link>
      ) : (
        <div className="-mx-2 flex items-start gap-2.5 px-2 py-2">
          {body}
          <span className="sr-only">{KIND_LABEL[event.kind]}</span>
        </div>
      )}
    </li>
  );
}
