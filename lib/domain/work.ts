/**
 * Goals, conduct, attendance, and collaboration surfaces.
 */

import type { EmployeeId } from "./identity";
import type { TaskId } from "./tasks";

/* ── Goals (C2 · Goal Attainment) ─────────────────────────────────────────── */

export type GoalId = string;

export interface Goal {
  /**
   * Owning tenant. Every read is scoped to it; every write stamps it.
   *
   * Denormalised onto each directly-queried entity rather than joined through
   * a parent — that is what lets one predicate isolate a tenant, and it is the
   * shape a Postgres row-level-security policy expects. Phase 2 adds the
   * composite foreign key that makes it impossible for this to disagree with
   * the parent's tenant.
   */
  organisationId: string;
  id: GoalId;
  title: string;
  description: string | null;
  ownerId: EmployeeId;
  periodKey: string;
  /** The active pool must sum to ≤ 100 — a hard block, carried from legacy. */
  weightPercent: number;
  maximumPoints: number;
  targetValue: number | null;
  achievedValue: number;
  unit: string | null;
  status: "draft" | "active" | "completed" | "cancelled";
  createdById: EmployeeId;
  createdAt: string;
}

export type GoalActivityStatus =
  "pending" | "in_progress" | "submitted" | "approved" | "rejected";

export interface GoalActivity {
  id: string;
  goalId: GoalId;
  heading: string;
  description: string | null;
  points: number;
  dueAt: string | null;
  assigneeIds: EmployeeId[];
  status: GoalActivityStatus;
  /** Earns only when done AND not late — carried from legacy C2. */
  submittedLate: boolean;
  report: {
    text: string;
    attachmentIds: string[];
    submittedAt: string;
    submittedById: EmployeeId;
  } | null;
  reportRequestedAt: string | null;
  reportRequestedById: EmployeeId | null;
  linkedTaskId: TaskId | null;
}

/* ── Conduct (C3 · Conduct & Policy) ──────────────────────────────────────── */

export type ConductSeverity =
  "minor" | "moderate" | "serious" | "falsification" | "idle_pool";

export interface ConductPolicy {
  /**
   * Owning tenant. Every read is scoped to it; every write stamps it.
   *
   * Denormalised onto each directly-queried entity rather than joined through
   * a parent — that is what lets one predicate isolate a tenant, and it is the
   * shape a Postgres row-level-security policy expects. Phase 2 adds the
   * composite foreign key that makes it impossible for this to disagree with
   * the parent's tenant.
   */
  organisationId: string;
  id: string;
  name: string;
  description: string;
  /**
   * What a breach costs, in PERCENTAGE POINTS off the score.
   *
   * Not a point count. C1, C2 and C4 are percentages and C3 is subtracted from
   * their average, so five here means eighty becomes seventy-five — see
   * `lib/rules/scoring/conduct.ts`.
   */
  percent: number;
  severity: ConductSeverity | null;
  scope: "global" | "department";
  departmentIds: string[];
  isActive: boolean;
  /**
   * **A rule applies to nobody until somebody other than its author says so.**
   *
   * Written by a manager, approved by THEIR manager. `approverId` is stamped
   * when it is written, so the decision belongs to one named person rather than
   * to whoever holds a senior role — and a reorganisation later cannot move a
   * pending decision to somebody who was never asked for it.
   */
  status: "pending" | "approved" | "rejected";
  createdById: EmployeeId | null;
  createdByName: string | null;
  approverId: EmployeeId | null;
  approverName: string | null;
  decidedByName: string | null;
  rejectedReason: string | null;
}

export interface ConductEvent {
  id: string;
  employeeId: EmployeeId;
  policyId: string;
  policyName: string;
  severity: ConductSeverity;
  description: string;
  occurredOn: string;
  appliedById: EmployeeId;
  appliedByName: string;
  appliedAt: string;
  /** Disputes resolve by REVERSAL, never by mutating the original. */
  disputeStatus: "none" | "requested" | "upheld" | "overturned";
  disputeNote: string | null;
  reversalLedgerEntryId: string | null;
}

/* ── Attendance (C4 · Attendance) ─────────────────────────────────────────── */

export type AttendanceStatus =
  "present" | "absent" | "half_day" | "leave" | "holiday" | "week_off";

export interface AttendanceDay {
  /**
   * Owning tenant. Every read is scoped to it; every write stamps it.
   *
   * Denormalised onto each directly-queried entity rather than joined through
   * a parent — that is what lets one predicate isolate a tenant, and it is the
   * shape a Postgres row-level-security policy expects. Phase 2 adds the
   * composite foreign key that makes it impossible for this to disagree with
   * the parent's tenant.
   */
  organisationId: string;
  id: string;
  employeeId: EmployeeId;
  date: string;
  /**
   * From the work calendar, NOT from whether events happen to exist. Legacy
   * derived its denominator from ledger entries, so a missed sync silently
   * inflated the score (docs/specs/SCORING_LOGIC_SPEC.md §4.3).
   */
  isExpectedWorkingDay: boolean;
  scheduledStart: string | null;
  scheduledEnd: string | null;
  actualStart: string | null;
  actualEnd: string | null;
  /** Stored in minutes (owner-confirmed). */
  lateMinutes: number;
  earlyDepartureMinutes: number;
  status: AttendanceStatus;
}

export interface AttendanceEvent {
  id: string;
  employeeId: EmployeeId;
  occurredAt: string;
  kind:
    | "punch_in"
    | "punch_out"
    | "leave_approved"
    | "holiday"
    | "manual_correction";
  source: "biometric" | "hr_system" | "manual";
  sourceRef: string | null;
}

/* ── Collaboration ────────────────────────────────────────────────────────── */

export interface Conversation {
  /**
   * Owning tenant. Every read is scoped to it; every write stamps it.
   *
   * Denormalised onto each directly-queried entity rather than joined through
   * a parent — that is what lets one predicate isolate a tenant, and it is the
   * shape a Postgres row-level-security policy expects. Phase 2 adds the
   * composite foreign key that makes it impossible for this to disagree with
   * the parent's tenant.
   */
  organisationId: string;
  id: string;
  kind: "direct" | "group";
  participantIds: EmployeeId[];
  title: string | null;
  groupId: string | null;
  /**
   * The members who administer a GROUP — rename it, add or remove people, and
   * promote others. Empty/absent for a direct message. The creator starts as the
   * sole admin; a group that lost its admins (legacy data) falls back to treating
   * its creator as one so it is never left unmanageable.
   */
  adminIds?: EmployeeId[];
  lastMessageAt: string | null;
  lastMessagePreview: string | null;
  unreadCount: number;
  /**
   * When each participant's client was last live on this conversation.
   *
   * The delivery half of the message ticks: a message counts as delivered to
   * somebody once their stamp here is at or after the moment it was written.
   * Each person writes only their own entry, which is what makes it a fact
   * about them rather than a claim the sender makes on their behalf.
   *
   * One stamp per conversation rather than a flag on every message, and the
   * arithmetic is the reason: a per-message array costs a write per message per
   * recipient, and only records anything while that person has that exact
   * thread open — which is not what "delivered" means. See
   * `lib/rules/messages/messageStatus.ts`.
   *
   * Optional because it is additive: threads written before this existed, and
   * anything the older application writes, simply have no stamps and show a
   * single tick. Nothing breaks in its absence.
   */
  deliveredAt?: Record<EmployeeId, string>;
  /**
   * Messages pinned to the top of this conversation, oldest pin first.
   *
   * Any participant may pin or unpin, up to the cap in
   * `lib/rules/messages/pins.ts`. Optional because it is additive — a thread
   * that has never had a pin simply has none.
   */
  pinned?: PinnedMessage[];
}

/**
 * The identity of a direct conversation: its two people, order-independent.
 *
 * A direct thread is defined by the PAIR, not by who opened it. Without a
 * canonical key, "message Tobias" from either side produces a second thread
 * beside the first and neither person can tell which one the other reads — the
 * failure that makes a message list untrustworthy.
 *
 * It lives in the domain rather than inside a repository because every
 * implementation has to agree on it: a server that keyed on creation order
 * while the client deduped on the pair would disagree about how many
 * conversations exist.
 */
export function directConversationKey(participantIds: EmployeeId[]): string {
  return [...new Set(participantIds)].sort().join("|");
}

/**
 * A file carried by a message, stored INLINE on the message the way the existing
 * chat documents hold it — a URL and a kind, not a separate attachment record.
 *
 * Distinct from `Message.attachmentIds`, which references the normalised
 * `Attachment` records the prototype and mail use. Chat messages written by the
 * old app (and read back browser-direct) carry their media inline, so this is
 * what the real threads actually display.
 */
export interface MessageAttachment {
  url: string;
  /**
   * `voice` is every audio file, not only a recorded note — the name is
   * historical and is written into every message ever stored, so it stays.
   * See `attachmentKind` for how one is chosen.
   */
  kind: "image" | "pdf" | "voice" | "video" | "file";
  name: string | null;
  sizeBytes: number | null;
  /** Length of a voice note in seconds, where one is recorded. */
  durationSecs: number | null;
  /**
   * The Google Drive file id, where the media is Drive-hosted.
   *
   * Drive's own `thumbnail`/`googleusercontent` image URLs no longer load in an
   * `<img>` reliably, so the UI streams Drive files through the backend media
   * proxy keyed on this id instead. Null for a Cloudinary asset (voice, some
   * images), whose URL is served directly.
   */
  fileId: string | null;
}

/**
 * The message a reply quotes, denormalised onto the reply itself.
 *
 * Carries the quoted sender and a snippet of text so the quote renders without a
 * second read — and stays legible even when the original is older than the
 * loaded window or has since been deleted. `messageId` is the scroll target.
 */
export interface MessageReply {
  messageId: string;
  senderName: string;
  text: string;
}

/**
 * A message somebody pinned to the top of a conversation.
 *
 * Denormalised the same way a reply quote is: the sender and a snippet ride
 * along so the banner renders without loading the original — and stays legible
 * when the original is older than the loaded window. `messageId` is the jump
 * target.
 */
export interface PinnedMessage {
  messageId: string;
  senderName: string;
  text: string;
  pinnedById: EmployeeId;
  pinnedAt: string;
}

/**
 * The quick-reaction palette — the six every messaging product converges on.
 *
 * One list, shared by the picker and the help corpus, so the emojis offered and
 * the emojis documented cannot drift apart.
 */
export const MESSAGE_QUICK_REACTIONS = [
  "👍",
  "❤️",
  "😂",
  "😮",
  "😢",
  "🙏",
] as const;

/**
 * How many messages a thread shows before somebody has to ask for more.
 *
 * Opening a long-running conversation used to read every message it had ever
 * held in one query — fine for a new thread, and an ever-growing cost for an
 * old one that nobody was about to scroll back through anyway. The default
 * `listMessages` window; scrolling to the top of the loaded page asks for a
 * bigger one.
 */
export const MESSAGE_PAGE_SIZE = 50;

export interface Message {
  id: string;
  conversationId: string;
  senderId: EmployeeId;
  senderName: string;
  text: string;
  attachmentIds: string[];
  /**
   * Inline media on the message, where it has any. Optional because most
   * messages have none and the prototype models its few through `attachmentIds`;
   * the real (browser-direct) threads populate it from the stored document.
   */
  attachments?: MessageAttachment[];
  replyToId: string | null;
  /** The quoted message, where this one is a reply. */
  replyTo?: MessageReply | null;
  createdAt: string;
  /** When the sender last edited the text; null/absent if never edited. */
  editedAt?: string | null;
  /** True for a soft-deleted message — its slot and tombstone remain. */
  isDeleted?: boolean;
  readBy: EmployeeId[];
  /**
   * Emoji reactions: each emoji to the people who chose it. One reaction per
   * person per message — picking a second emoji replaces the first, the rule
   * every messaging product shares (`lib/rules/messages/reactions.ts`).
   *
   * Optional because it is additive: messages written before reactions existed,
   * and anything the older application writes, simply have none.
   */
  reactions?: Record<string, EmployeeId[]>;
  /**
   * Who has starred this message for themselves. A star is a personal bookmark
   * — each reader sees only their own — but it lives on the message so it
   * follows the message across devices. Optional for the same additive reason
   * as `reactions`.
   */
  starredBy?: EmployeeId[];
}

export interface Group {
  /**
   * Owning tenant. Every read is scoped to it; every write stamps it.
   *
   * Denormalised onto each directly-queried entity rather than joined through
   * a parent — that is what lets one predicate isolate a tenant, and it is the
   * shape a Postgres row-level-security policy expects. Phase 2 adds the
   * composite foreign key that makes it impossible for this to disagree with
   * the parent's tenant.
   */
  organisationId: string;
  id: string;
  name: string;
  description: string | null;
  memberIds: EmployeeId[];
  ownerId: EmployeeId;
  createdAt: string;
}

/**
 * Where a meeting is in its life.
 *
 * `waiting` and `archived` were added for the room; the other four already
 * existed and keep their spellings so nothing that reads a meeting today has to
 * change. `waiting` is the room being open before the organiser starts it —
 * people can arrive, and the meeting has not begun.
 */
export type MeetingStatus =
  | "scheduled"
  | "waiting"
  | "live"
  | "completed"
  | "cancelled"
  | "archived";

export interface Meeting {
  /**
   * Owning tenant. Every read is scoped to it; every write stamps it.
   *
   * Denormalised onto each directly-queried entity rather than joined through
   * a parent — that is what lets one predicate isolate a tenant, and it is the
   * shape a Postgres row-level-security policy expects. Phase 2 adds the
   * composite foreign key that makes it impossible for this to disagree with
   * the parent's tenant.
   */
  organisationId: string;
  id: string;
  title: string;
  description: string | null;
  organiserId: EmployeeId;
  participantIds: EmployeeId[];
  startsAt: string;
  endsAt: string;
  status: MeetingStatus;
  joinToken: string | null;
  recordingEnabled: boolean;
  /** Optional and opt-in. Cowork is not positioned as an AI product (D22). */
  hasSummary: boolean;

  /**
   * The LiveKit room this meeting occupies.
   *
   * Derived from the meeting id and stored, so the name a token is minted for
   * and the name the client joins can never be computed differently. Null until
   * the room is first opened — a scheduled meeting occupies no room.
   */
  livekitRoomName: string | null;
  /** Agenda, one line per item. Empty is normal, not a gap. */
  agenda: string[];
  /** What this meeting is about, if it is about a specific piece of work. */
  taskId: TaskId | null;
  projectId: string | null;

  /** Set when the organiser starts and ends it. Null before each happens. */
  startedAt: string | null;
  endedAt: string | null;
  /**
   * Wall-clock length of the actual meeting, in seconds.
   *
   * Measured from `startedAt` to `endedAt` rather than from the schedule, so a
   * meeting booked for an hour that ran twenty minutes records twenty.
   */
  actualDurationSecs: number | null;

  /**
   * Placeholders, deliberately inert.
   *
   * The shape a transcript and its action items will occupy, so the record does
   * not have to change when they arrive. Nothing writes them today and no AI
   * runs — D22 keeps Cowork from being positioned as an AI product, and an
   * empty field is an honest statement that the feature is not here yet.
   */
  transcriptId: string | null;
  actionItems: string[];
}

/**
 * One participant's recorded audio from one meeting, as it reached Drive.
 *
 * **The answer to "whose voice actually got saved".** Every participant records
 * their own microphone and uploads it independently, which is what makes a
 * meeting recoverable when one person's connection fails — but it also means
 * nobody could tell whether everybody's audio arrived. The engine has written
 * one of these per finished upload since recording existed, and nothing read
 * them back, so the only way to check was to open Drive.
 *
 * There is one record per UPLOAD, not per person: somebody who rejoins, or
 * whose host stops and restarts recording, produces a second file rather than
 * overwriting the first. `isRejoin` marks those so a reader can tell a second
 * segment from a duplicate.
 */
export interface MeetingRecording {
  id: string;
  meetingId: string;
  employeeId: EmployeeId;
  employeeName: string;
  fileName: string;
  /** Bytes, as merged on the server. Zero where the engine did not report it. */
  sizeBytes: number;
  mimeType: string;
  /** Opens the file in Drive. Empty where the upload has no link yet. */
  viewUrl: string;
  downloadUrl: string;
  uploadedAt: string;
  /** A later segment of the same person's audio, not a duplicate of it. */
  isRejoin: boolean;
  /**
   * Somebody else's browser captured this, because this person's own upload
   * never arrived.
   *
   * A second-generation copy — already compressed by their browser, carried
   * over the network and decoded — so it sounds worse than a real recording,
   * and whatever their connection lost is baked into it permanently. It exists
   * only where the alternative is silence, and it must never be presented as
   * the same thing: somebody reading a transcript needs to know which file is
   * evidence and which is a rescue.
   */
  isBackup: boolean;
  /** Who captured it. Empty unless `isBackup`. */
  recordedByName: string;
}

/** Why somebody is in the room. Decides their LiveKit grants and nothing else. */
export type MeetingRole = "organiser" | "participant";

export interface MeetingParticipant {
  id: string;
  meetingId: string;
  employeeId: EmployeeId;
  role: MeetingRole;
  /** Null until they first join. */
  joinedAt: string | null;
  /** Null while they are in the room; set on leave, reset on rejoin. */
  leftAt: string | null;
  attendanceStatus: "invited" | "joined" | "left" | "absent";
}

export type MeetingEventType =
  | "created"
  | "updated"
  | "participant_added"
  | "participant_removed"
  | "opened"
  | "started"
  | "joined"
  | "left"
  | "ended"
  | "cancelled"
  | "archived";

/** The audit trail. Append-only, like every other event log in the product. */
export interface MeetingEvent {
  id: string;
  meetingId: string;
  type: MeetingEventType;
  actorId: EmployeeId;
  actorName: string;
  detail: string;
  createdAt: string;
}

/* ── Notifications ────────────────────────────────────────────────────────── */

export type NotificationChannel = "in_app" | "push" | "email" | "socket";

export interface Notification {
  /**
   * Owning tenant. Every read is scoped to it; every write stamps it.
   *
   * Denormalised onto each directly-queried entity rather than joined through
   * a parent — that is what lets one predicate isolate a tenant, and it is the
   * shape a Postgres row-level-security policy expects. Phase 2 adds the
   * composite foreign key that makes it impossible for this to disagree with
   * the parent's tenant.
   */
  organisationId: string;
  id: string;
  recipientId: EmployeeId;
  type: string;
  title: string;
  body: string;
  data: Record<string, unknown>;
  sourceType: string | null;
  sourceId: string | null;
  channels: NotificationChannel[];
  /** Per-item read. Legacy had read-all only. */
  readAt: string | null;
  createdAt: string;
}

/* ── Workload flow ────────────────────────────────────────────────────────── */

/**
 * Work arriving against work leaving, per week.
 *
 * The dashboard's principal graph asks one operational question: are you taking
 * on work faster than you clear it? Channels above the baseline are arrivals,
 * channels below are departures, and the baseline is zero net change — so the
 * curves converge on a balanced week and fan apart on an unbalanced one.
 *
 * Every value is counted from timestamps that already exist on the record
 * (`createdAt`, `assignedAt`, `requestedAt`, `reviewedAt`, `completedAt`).
 * Nothing here is synthesised; a week with no movement is a genuine zero and
 * draws on the baseline.
 */
export type FlowDirection = "in" | "out";

export type FlowChannelId =
  | "created"
  | "assigned"
  | "rework"
  | "completed"
  | "approved"
  | "cancelled";

export interface FlowChannel {
  id: FlowChannelId;
  label: string;
  direction: FlowDirection;
  /**
   * A key from the FIELD palette, never a C1–C4 hue. The Four Channels Rule
   * reserves channel colour for score components; the flow graph is the second
   * sanctioned use of the iridescent field palette, after avatar monograms.
   */
  hue: string;
}

export interface FlowPoint {
  /** ISO date of the Monday that opens the week. */
  weekStart: string;
  /** Short axis label, e.g. "12 May". */
  label: string;
  values: Record<FlowChannelId, number>;
  /** arrivals − departures for the week. Positive means the queue grew. */
  net: number;
}

export interface WorkloadFlow {
  channels: FlowChannel[];
  points: FlowPoint[];
  /** Largest single-channel value across the series — the axis maximum. */
  peak: number;
  /** Sum of net across the window. */
  netTotal: number;
}
