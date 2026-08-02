"use client";

import { useMemo, useState } from "react";
import {
  Button,
  Field,
  InlineError,
  Input,
  Panel,
  PanelHead,
  PermissionDenied,
  ProvisionalBadge,
  Select,
  SkeletonRows,
} from "@/components/ui/Primitives";
import { IconTabs, WorkspaceHead } from "@/components/ui/Workspace";
import { useAction, useQuery } from "@/lib/hooks/useRepository";
import { usePermissions, useViewerId } from "@/lib/hooks/usePermissions";
import { isWorkedStatus } from "@/lib/rules/attendance/record";
import type { AttendanceStatus } from "@/lib/domain";

/**
 * Recording someone's attendance.
 *
 * A manager records for a direct report; People Operations and administrators
 * for anyone. Nobody records their own day — the reporting scope forbids it, so
 * the picker never lists the viewer. The recorded day feeds C4 · Attendance the
 * moment it is saved.
 *
 * Presentation only gates who is offered; the repository refuses the write for
 * anyone out of scope regardless of what this form shows.
 */

const STATUS_OPTIONS: { id: AttendanceStatus; label: string }[] = [
  { id: "present", label: "Present" },
  { id: "half_day", label: "Half day" },
  { id: "absent", label: "Absent" },
  { id: "leave", label: "Approved leave" },
  { id: "holiday", label: "Holiday" },
  { id: "week_off", label: "Week off" },
];

const ATTENDANCE_TABS = [
  { id: "current", label: "This period", href: "/attendance", icon: "calendar" as const },
  { id: "history", label: "History", href: "/attendance/history", icon: "history" as const },
  { id: "record", label: "Record", href: "/attendance/record", icon: "plus" as const },
];

export function AttendanceRecorder() {
  const perms = usePermissions();
  const viewerId = useViewerId();
  const people = useQuery((r) => r.listEmployees(), []);

  // Only the people this viewer may actually record for, and never themselves.
  const recordable = useMemo(() => {
    if (!perms.ready || !people.data) return [];
    return people.data.filter(
      (e) =>
        !e.exitedAt &&
        e.id !== viewerId &&
        perms.can("attendance.record", e.id),
    );
  }, [perms, people.data, viewerId]);

  const [employeeId, setEmployeeId] = useState("");
  const [date, setDate] = useState("");
  const [status, setStatus] = useState<AttendanceStatus>("present");
  const [lateMinutes, setLateMinutes] = useState("");
  const [earlyMinutes, setEarlyMinutes] = useState("");
  const [scheduledEnd, setScheduledEnd] = useState("18:00");
  const [actualEnd, setActualEnd] = useState("");
  const [savedFor, setSavedFor] = useState<string | null>(null);

  const [record, state] = useAction(
    (
      r,
      input: {
        employeeId: string;
        date: string;
        status: AttendanceStatus;
        lateMinutes?: number;
        earlyDepartureMinutes?: number;
        scheduledEnd?: string | null;
        actualEnd?: string | null;
      },
    ) => r.recordAttendance(input),
  );

  const worked = isWorkedStatus(status);

  if (perms.ready && recordable.length === 0 && !people.isLoading) {
    return (
      <>
        <Head />
        <PermissionDenied what="attendance recording" />
      </>
    );
  }

  return (
    <>
      <Head />
      {people.isLoading ? (
        <SkeletonRows rows={6} />
      ) : (
        <div className="grid grid-cols-1 items-start gap-4 deck:grid-cols-12">
          <div className="deck:col-span-7">
            <Panel>
              <PanelHead
                title="Record a day"
                sub="Recording a day, or correcting one already recorded, updates that person's C4 · Attendance straight away."
              />
              {state.error && (
                <div className="mb-3">
                  <InlineError message={state.error} />
                </div>
              )}
              {savedFor && !state.error && (
                <div className="mb-3 rounded-inset bg-[var(--surface-sunken)] px-3 py-2 text-xs text-ink-muted">
                  Saved. {savedFor}&rsquo;s attendance now reflects this day.
                </div>
              )}

              <div className="grid gap-3 deck:grid-cols-2">
                <Field label="Whose day" required>
                  <Select
                    value={employeeId}
                    onChange={(e) => setEmployeeId(e.target.value)}
                  >
                    <option value="">Choose…</option>
                    {recordable.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.displayName}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Date" required>
                  <Input
                    type="date"
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                  />
                </Field>
                <Field
                  label="Status"
                  className="deck:col-span-2"
                  hint="Approved leave and holidays keep a full-credit day. Absence is the only status that removes the day's points."
                >
                  <Select
                    value={status}
                    onChange={(e) =>
                      setStatus(e.target.value as AttendanceStatus)
                    }
                  >
                    {STATUS_OPTIONS.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.label}
                      </option>
                    ))}
                  </Select>
                </Field>

                {worked && (
                  <>
                    <Field
                      label="Minutes late"
                      hint="Lateness deducts proportionally after the grace period."
                    >
                      <Input
                        type="number"
                        min={0}
                        value={lateMinutes}
                        onChange={(e) => setLateMinutes(e.target.value)}
                        placeholder="0"
                      />
                    </Field>
                    <Field label="Minutes left early">
                      <Input
                        type="number"
                        min={0}
                        value={earlyMinutes}
                        onChange={(e) => setEarlyMinutes(e.target.value)}
                        placeholder="0"
                      />
                    </Field>
                    <Field label="Scheduled end" hint="Used to measure overtime.">
                      <Input
                        type="time"
                        value={scheduledEnd}
                        onChange={(e) => setScheduledEnd(e.target.value)}
                      />
                    </Field>
                    <Field
                      label="Actually left"
                      hint="Leaving later than scheduled earns an overtime offset."
                    >
                      <Input
                        type="time"
                        value={actualEnd}
                        onChange={(e) => setActualEnd(e.target.value)}
                      />
                    </Field>
                  </>
                )}
              </div>

              <div className="mt-4 flex items-center gap-2 border-t border-hairline pt-3">
                <Button
                  tone="primary"
                  size="sm"
                  disabled={!employeeId || !date || state.isPending}
                  onClick={async () => {
                    const res = await record({
                      employeeId,
                      date,
                      status,
                      lateMinutes: worked ? Number(lateMinutes || 0) : undefined,
                      earlyDepartureMinutes: worked
                        ? Number(earlyMinutes || 0)
                        : undefined,
                      scheduledEnd: worked ? scheduledEnd || null : null,
                      actualEnd: worked ? actualEnd || null : null,
                    });
                    if (res.ok) {
                      const name =
                        recordable.find((p) => p.id === employeeId)
                          ?.displayName ?? "That person";
                      setSavedFor(name);
                    }
                  }}
                >
                  {state.isPending ? "Saving…" : "Record day"}
                </Button>
              </div>
            </Panel>
          </div>

          <div className="deck:col-span-5">
            <Panel>
              <h2 className="text-sm font-medium text-ink">
                How this scores
              </h2>
              <ul className="mt-3 space-y-2 text-xs leading-relaxed text-ink-muted">
                <li>
                  Every expected working day is one unit worth a full point.
                  Present and on time earns the whole point.
                </li>
                <li>
                  Lateness and leaving early each deduct in proportion to the
                  minutes — never a flat penalty. <ProvisionalBadge decisionId="O5" label="Attendance rates" />
                </li>
                <li>
                  Absence removes the day&rsquo;s point. Approved leave and
                  holidays keep it, so time off never lowers a score.
                </li>
                <li>
                  Staying past the scheduled end earns an overtime offset that
                  can cancel the same day&rsquo;s lateness — but a day never
                  exceeds a full point, and C4 never exceeds 100%.
                </li>
              </ul>
            </Panel>
          </div>
        </div>
      )}
    </>
  );
}

function Head() {
  return (
    <WorkspaceHead
      title="Record attendance"
      count="C4 · Attendance"
      tabs={<IconTabs items={ATTENDANCE_TABS} active="record" />}
    />
  );
}
