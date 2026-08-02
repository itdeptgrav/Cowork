import { legacyFetch } from "./http.ts";
import type { LegacyResult } from "./envelope";

/**
 * The MEDIA surface of a meeting on the engine — recording metadata, AI summary,
 * Ask-AI, transcript, and the public share link.
 *
 * These sit alongside `meetings.ts` (which owns `/cowork/schedule-meet/*` and the
 * room lifecycle). The engine already implements all of these routes; this wires
 * the JSON ones through the one adapter. Two paths are deliberately NOT here:
 *
 *  · **Audio chunk / finalize** (`/cowork/audio/chunk`, `/finalize`, and the
 *    guest twins) are multipart uploads, which `legacyFetch` does not carry — the
 *    recording hook posts those with `FormData` directly.
 *  · **The `.docx` download** returns a binary blob, not JSON, so the summary
 *    view fetches it directly too.
 *
 * Everything else — reading a summary, triggering generation, asking a follow-up,
 * saving/reading a transcript, minting/revoking a public link, and the
 * no-auth guest lobby lookup — is an ordinary JSON call and lives here.
 */

/* ── AI summary ───────────────────────────────────────────────────────────── */

/** The stored summary, or `{ exists:false }` — `GET /cowork/audio/summary/:id`. */
export async function getMeetingSummary(input: {
  token: string;
  meetId: string;
}): Promise<LegacyResult<{ exists?: boolean; summary?: unknown }>> {
  return legacyFetch({
    path: `/cowork/audio/summary/${encodeURIComponent(input.meetId)}`,
    token: input.token,
  });
}

/**
 * Trigger (or force-regenerate) the Gemini summary —
 * `POST /cowork/audio/summary/:id[?force=true]`.
 *
 * Slow (it streams every participant's audio through the Gemini File API), so the
 * caller shows the pipeline steps while this is in flight. `force` re-runs even
 * when a fresh summary is cached.
 */
export async function generateMeetingSummary(input: {
  token: string;
  meetId: string;
  force?: boolean;
}): Promise<LegacyResult<{ summary?: unknown; cached?: boolean }>> {
  return legacyFetch({
    path: `/cowork/audio/summary/${encodeURIComponent(input.meetId)}`,
    method: "POST",
    query: input.force ? { force: "true" } : undefined,
    token: input.token,
    timeoutMs: 300_000, // Gemini pipeline: Drive download → File API upload → poll → generate
  });
}

/**
 * The summary for a GUEST who holds the public share token — no auth.
 * `GET /cowork/audio/summary/:id/public?token=…`.
 */
export async function getPublicMeetingSummary(input: {
  meetId: string;
  token: string;
}): Promise<LegacyResult<{ exists?: boolean; summary?: unknown }>> {
  return legacyFetch({
    path: `/cowork/audio/summary/${encodeURIComponent(input.meetId)}/public`,
    query: { token: input.token },
  });
}

/** Ask a follow-up question about the meeting — `POST /cowork/audio/ask/:id`. */
export async function askMeetingAI(input: {
  token: string;
  meetId: string;
  question: string;
}): Promise<LegacyResult<{ answer?: string; audioFilesUsed?: number }>> {
  return legacyFetch({
    path: `/cowork/audio/ask/${encodeURIComponent(input.meetId)}`,
    method: "POST",
    body: { question: input.question },
    token: input.token,
    timeoutMs: 120_000, // Gemini inference on audio can take up to ~2 minutes
  });
}

/** Every participant's uploaded recording — `GET /cowork/audio/recordings/:id`. */
export async function listMeetingRecordings(input: {
  token: string;
  meetId: string;
}): Promise<LegacyResult<unknown[]>> {
  return legacyFetch<unknown[]>({
    path: `/cowork/audio/recordings/${encodeURIComponent(input.meetId)}`,
    envelopeKey: "recordings",
    token: input.token,
  });
}

/* ── Transcript ───────────────────────────────────────────────────────────── */

/** Persist the live transcript (24h TTL) — `POST /cowork/transcript/save`. */
export async function saveMeetingTranscript(input: {
  token: string;
  meetId: string;
  meetTitle: string;
  meetDate: string;
  lines: { name: string; text: string; time: string; language?: string }[];
}): Promise<LegacyResult<unknown>> {
  return legacyFetch({
    path: "/cowork/transcript/save",
    method: "POST",
    body: {
      meetId: input.meetId,
      meetTitle: input.meetTitle,
      meetDate: input.meetDate,
      lines: input.lines,
    },
    token: input.token,
  });
}

/** Load a stored transcript — `GET /cowork/transcript/:id`. */
export async function getMeetingTranscript(input: {
  token: string;
  meetId: string;
}): Promise<LegacyResult<{ exists?: boolean; lines?: unknown[] }>> {
  return legacyFetch({
    path: `/cowork/transcript/${encodeURIComponent(input.meetId)}`,
    token: input.token,
  });
}

/* ── Public / guest link ──────────────────────────────────────────────────── */

/** Mint the shareable public link — `POST /cowork/livekit/public-link`. */
export async function createMeetingPublicLink(input: {
  token: string;
  meetId: string;
}): Promise<LegacyResult<{ publicShareToken?: string }>> {
  return legacyFetch({
    path: "/cowork/livekit/public-link",
    method: "POST",
    body: { meetId: input.meetId },
    token: input.token,
  });
}

/** Kill an outstanding public link — `POST /cowork/livekit/public-link/revoke`. */
export async function revokeMeetingPublicLink(input: {
  token: string;
  meetId: string;
}): Promise<LegacyResult<unknown>> {
  return legacyFetch({
    path: "/cowork/livekit/public-link/revoke",
    method: "POST",
    body: { meetId: input.meetId },
    token: input.token,
  });
}

/**
 * Guest join — NO AUTH.
 * `POST /cowork/public/guest-join`. Returns LiveKit creds + guest session.
 */
export async function guestJoinMeeting(input: {
  shareToken: string;
  guestName: string;
}): Promise<
  LegacyResult<{
    token?: string;
    url?: string;
    roomName?: string;
    meetId?: string;
    meetTitle?: string;
    guestId?: string;
    guestSessionId?: string;
  }>
> {
  return legacyFetch({
    path: "/cowork/public/guest-join",
    method: "POST",
    body: { token: input.shareToken, guestName: input.guestName },
  });
}

/**
 * The guest lobby's read of a share token — NO AUTH.
 * `GET /cowork/public/meeting-info/:token`.
 */
export async function getPublicMeetingInfo(input: {
  shareToken: string;
}): Promise<
  LegacyResult<{
    meetId?: string;
    meetTitle?: string;
    status?: string;
    canJoin?: boolean;
    participantCount?: number;
  }>
> {
  return legacyFetch({
    path: `/cowork/public/meeting-info/${encodeURIComponent(input.shareToken)}`,
  });
}
