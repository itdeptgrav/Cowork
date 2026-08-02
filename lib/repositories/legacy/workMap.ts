import type {
  Meeting,
  MeetingEvent,
  MeetingParticipant,
  Notification,
} from "@/lib/domain";
import { LEGACY_ORGANISATION_ID } from "./map.ts";
import { notificationTarget } from "../../rules/notifications/target.ts";

/**
 * Notifications, meetings and workload, as domain types.
 *
 * Written against the shapes `/legacy/validate` reported from live responses,
 * not against the route files — which is why these three are mapped and the
 * eleven inferred ones were not.
 *
 * The rule from the rest of this migration holds: **absent stays absent**. A
 * field legacy does not send is null, empty or zero-with-a-reason, never a
 * default that reads as real.
 */

/* ── Notifications ────────────────────────────────────────────────────────── */

export interface LegacyNotificationDoc {
  id?: string;
  _id?: string;
  recipientEmployeeId?: string;
  type?: string;
  title?: string;
  body?: string;
  data?: Record<string, unknown>;
  read?: boolean;
  createdAt?: unknown;
}

/**
 * One notification.
 *
 * The only judgement here is `read` → `readAt`. The domain records **when** a
 * notification was read; legacy records only **whether**. There is no timestamp
 * to recover, so a read notification takes the empty string — truthful about
 * "read, time unknown" in a way that a fabricated timestamp would not be, and
 * distinguishable from `null`, which means genuinely unread.
 */
export function toNotification(
  doc: LegacyNotificationDoc,
): Notification | null {
  const id = doc.id ?? doc._id;
  if (!id) return null;

  const type = doc.type ?? "";
  const data = doc.data ?? {};
  /* Legacy carries no source FIELD, but it has always written the ids into
     `data` — so the reference is there and was simply never read. See
     `notificationTarget`, which is also where the precedence lives. */
  const target = notificationTarget(type, data);

  return {
    organisationId: LEGACY_ORGANISATION_ID,
    id: String(id),
    recipientId: doc.recipientEmployeeId ?? "",
    type,
    title: doc.title ?? "",
    body: doc.body ?? "",
    data,
    sourceType: target?.sourceType ?? null,
    sourceId: target?.sourceId ?? null,
    /* Delivered in the product; legacy does not report which channels fired. */
    channels: ["in_app"],
    readAt: doc.read === true ? "" : null,
    createdAt: toIso(doc.createdAt) ?? "",
  };
}

export function toNotifications(
  docs: readonly LegacyNotificationDoc[],
): Notification[] {
  return docs
    .map(toNotification)
    .filter((n): n is Notification => n !== null);
}

/* ── Meetings ─────────────────────────────────────────────────────────────── */

export interface LegacyMeetingDoc {
  id?: string;
  meetId?: string;
  dateTime?: unknown;
  createdBy?: string;
  participants?: unknown;
  title?: string;
  description?: string;
  googleMeetLink?: string;
  status?: string;
  isCancelled?: boolean;
  livekitRoomName?: string;
  createdAt?: unknown;
  /* Written by the engine only since the meetings page was connected. Every
     one of these is absent on a meeting scheduled before that, which is why
     each reads through a fallback rather than being assumed present. */
  endsAt?: unknown;
  agenda?: unknown;
  taskId?: string | null;
  startedAt?: unknown;
  endedAt?: unknown;
  presence?: Record<string, { joinedAt?: unknown; leftAt?: unknown }>;
}

/** One row of `cowork_scheduled_meets/{id}/events`. */
export interface LegacyMeetingEventDoc {
  id?: string;
  type?: string;
  actorId?: string;
  actorName?: string;
  detail?: string;
  createdAt?: unknown;
}

/**
 * A scheduled meeting.
 *
 * **No duration is invented.** Legacy stores `dateTime` — a single instant —
 * and no end. The domain's `endsAt` is a required string, so it takes the empty
 * string: "not known", plainly, rather than `startsAt` repeated (which would
 * assert a zero-length meeting) or an assumed hour (which would put a made-up
 * block in somebody's day).
 *
 * `isCancelled` wins over `status` where set, because it is the unambiguous
 * signal: legacy leaves `status` at its scheduled value on a cancelled meeting.
 */
export function toMeeting(doc: LegacyMeetingDoc): Meeting | null {
  const id = doc.id ?? doc.meetId;
  if (!id) return null;

  return {
    organisationId: LEGACY_ORGANISATION_ID,
    id: String(id),
    title: doc.title?.trim() || "Untitled meeting",
    description: doc.description?.trim() || null,
    organiserId: doc.createdBy ?? "",
    participantIds: readParticipants(doc.participants),
    startsAt: toIso(doc.dateTime) ?? "",
    /* Still empty for a meeting scheduled before the engine recorded one — the
       old rule holds, absent stays absent rather than becoming a guessed hour. */
    endsAt: toIso(doc.endsAt) ?? "",
    status: readMeetingStatus(doc),
    joinToken: null,
    /* Legacy reports neither, and both are claims about what was captured. */
    recordingEnabled: false,
    hasSummary: false,
    livekitRoomName: doc.livekitRoomName ?? null,
    agenda: Array.isArray(doc.agenda)
      ? doc.agenda.filter((a): a is string => typeof a === "string" && a.trim() !== "")
      : [],
    taskId: doc.taskId ?? null,
    projectId: null,
    startedAt: toIso(doc.startedAt),
    endedAt: toIso(doc.endedAt),
    /* Measured from the actual run, never from the schedule: a meeting booked
       for an hour that ran twenty records twenty. Null unless BOTH ends are
       recorded — one alone cannot produce a duration. */
    actualDurationSecs: readActualDurationSecs(doc),
    transcriptId: null,
    actionItems: [],
  };
}

export function toMeetings(docs: readonly LegacyMeetingDoc[]): Meeting[] {
  return docs.map(toMeeting).filter((m): m is Meeting => m !== null);
}

/**
 * Participants, however legacy stored them.
 *
 * Observed as both a list of ids and a list of objects. Reading only one form
 * would render a meeting as unattended.
 */
export function readParticipants(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => {
      if (typeof entry === "string") return entry;
      if (entry && typeof entry === "object") {
        const r = entry as Record<string, unknown>;
        const id = r.employeeId ?? r.id ?? r._id;
        return typeof id === "string" ? id : null;
      }
      return null;
    })
    .filter((id): id is string => Boolean(id));
}

/**
 * How long the meeting actually ran, or null.
 *
 * Requires BOTH ends. A meeting that started and has not ended has no duration
 * yet — reporting the time so far as its length would make a running meeting
 * look finished, and reporting zero would be worse.
 */
export function readActualDurationSecs(doc: LegacyMeetingDoc): number | null {
  const started = toIso(doc.startedAt);
  const ended = toIso(doc.endedAt);
  if (!started || !ended) return null;
  const secs = (Date.parse(ended) - Date.parse(started)) / 1000;
  return Number.isFinite(secs) && secs >= 0 ? Math.round(secs) : null;
}

/**
 * The participant list, derived from the meeting document.
 *
 * There is no participants endpoint and there does not need to be: the engine
 * already sends `participants` and `presence` on the meeting itself, so a
 * separate call would be a second round trip for data already in hand.
 *
 * The ORGANISER is included even when absent from `participants` — legacy
 * stores them separately in `createdBy`, and a meeting whose own organiser does
 * not appear in its attendance list reads as a data fault.
 */
export function toMeetingParticipants(
  doc: LegacyMeetingDoc,
): MeetingParticipant[] {
  const meetingId = String(doc.id ?? doc.meetId ?? "");
  if (!meetingId) return [];

  const organiserId = doc.createdBy ?? "";
  const ids = readParticipants(doc.participants);
  const ordered = organiserId && !ids.includes(organiserId) ? [organiserId, ...ids] : ids;

  return ordered.map((employeeId) => {
    const p = doc.presence?.[employeeId];
    const joinedAt = toIso(p?.joinedAt);
    const leftAt = toIso(p?.leftAt);
    return {
      id: `${meetingId}:${employeeId}`,
      meetingId,
      employeeId,
      role: employeeId === organiserId ? "organiser" : "participant",
      joinedAt,
      leftAt,
      /* "absent" is a judgement about a meeting that is over, and this mapper
         does not know whether it is. Somebody who never joined is `invited`
         until something with that knowledge says otherwise. */
      attendanceStatus: !joinedAt ? "invited" : leftAt ? "left" : "joined",
    };
  });
}

const MEETING_EVENT_TYPES: readonly MeetingEvent["type"][] = [
  "created", "updated", "participant_added", "participant_removed", "opened",
  "started", "joined", "left", "ended", "cancelled", "archived",
];

export function toMeetingEvents(
  meetingId: string,
  docs: readonly LegacyMeetingEventDoc[],
): MeetingEvent[] {
  return docs
    .map((d, i): MeetingEvent | null => {
      const type = MEETING_EVENT_TYPES.find((t) => t === d.type);
      /* An unrecognised type is dropped rather than coerced to "updated": the
         log is the audit trail, and an entry relabelled to something that did
         not happen is worse than a gap. */
      if (!type) return null;
      return {
        id: String(d.id ?? `${meetingId}:${i}`),
        meetingId,
        type,
        actorId: d.actorId ?? "",
        actorName: d.actorName?.trim() || d.actorId || "",
        detail: d.detail?.trim() ?? "",
        createdAt: toIso(d.createdAt) ?? "",
      };
    })
    .filter((e): e is MeetingEvent => e !== null);
}

export function readMeetingStatus(doc: LegacyMeetingDoc): Meeting["status"] {
  if (doc.isCancelled === true) return "cancelled";
  switch (doc.status) {
    case "live":
    case "waiting":
    case "completed":
    case "cancelled":
    case "archived":
    case "scheduled":
      return doc.status;
    default:
      return "scheduled";
  }
}

/* ── Workload ─────────────────────────────────────────────────────────────── */

/**
 * A row of legacy's workload summary.
 *
 * **Deliberately not mapped to `WorkloadFlow`.** They are different concepts:
 * legacy returns a per-employee table of hours and counts, while `WorkloadFlow`
 * is a weekly time series of work arriving against work leaving. Neither can be
 * derived from the other — legacy has no per-week arrival or departure counts —
 * so `getWorkloadFlow` stays unavailable and this is exposed under its own
 * shape instead.
 *
 * Only fields the engine actually sends. No `openTasks`, `load`, `week` or
 * `period`, because legacy reports none of them.
 */
export interface LegacyWorkloadRow {
  employeeId: string;
  name: string;
  department: string | null;
  role: string | null;
  totalHours: number | null;
  pendingHours: number | null;
  overdueCount: number | null;
  overdueHours: number | null;
  c1Count: number | null;
  c2Count: number | null;
}

export function toWorkloadRow(raw: unknown): LegacyWorkloadRow | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const employeeId = r.employeeId;
  if (typeof employeeId !== "string" || !employeeId) return null;

  return {
    employeeId,
    name: typeof r.name === "string" ? r.name : employeeId,
    department: text(r.department),
    role: text(r.role),
    /* Null, not zero. "No hours reported" and "reported zero hours" are
       different statements about somebody's week. */
    totalHours: numberOrNull(r.totalHours),
    pendingHours: numberOrNull(r.pendingHours),
    overdueCount: numberOrNull(r.overdueCount),
    overdueHours: numberOrNull(r.overdueHours),
    c1Count: numberOrNull(r.c1Count),
    c2Count: numberOrNull(r.c2Count),
  };
}

export function toWorkloadRows(raw: readonly unknown[]): LegacyWorkloadRow[] {
  return raw
    .map(toWorkloadRow)
    .filter((r): r is LegacyWorkloadRow => r !== null);
}

/* ── Shared ───────────────────────────────────────────────────────────────── */

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function numberOrNull(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/**
 * A legacy timestamp as an ISO string.
 *
 * Legacy writes ISO strings, epoch numbers and Firestore `Timestamp` objects in
 * the same field across records of different vintages. Reading one form would
 * leave whole cohorts undated.
 */
export function toIso(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? null : new Date(parsed).toISOString();
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return new Date(value).toISOString();
  }
  if (typeof value === "object") {
    const v = value as Record<string, unknown>;
    const seconds = v.seconds ?? v._seconds;
    if (typeof seconds === "number") {
      const nanos = (v.nanoseconds ?? v._nanoseconds ?? 0) as number;
      return new Date(seconds * 1000 + Math.floor(nanos / 1e6)).toISOString();
    }
  }
  return null;
}
