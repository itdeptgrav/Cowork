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

/* ── Transcript (verbatim / translated) ──────────────────────────────────────
 * A DIFFERENT thing from the summary above, not a variant of it. The
 * summary's own CONVERSATION section translates non-English speech and
 * paraphrases anything unclear — right for a quick-scan summary, wrong for a
 * record meant to be trusted word-for-word.
 *
 * Two independent modes, stored side by side — generating one never erases
 * the other:
 *  - "verbatim": exact words, original language preserved (Hindi/Odia/etc.
 *    stay as spoken), explicit uncertainty instead of a guess.
 *  - "translate": renders everything into English, but marks exactly which
 *    words were translated with a `translated: true` flag rather than
 *    silently blending them in — for a reader who doesn't read the original
 *    language but still needs to know a translation happened.
 * See `routes/task_routes/meetingTranscript.routes.js` on the engine. */

export type TranscriptMode = "verbatim" | "translate";

export interface TranscriptUtterance {
  start: number;
  end: number;
  speaker: string;
  text: string;
  needsReview: boolean;
  /** Only meaningful in "translate" mode — this line (or part of it) was
   * translated from another language, not originally said in English. */
  translated?: boolean;
}

export interface TranscriptModeResult {
  utterances: TranscriptUtterance[];
  unparsedLineCount: number;
  createdAtMs: number;
}

export interface MeetingTranscript {
  meetId: string;
  participantNames: string[];
  audioFileCount: number;
  pipeline: string;
  /** Present once that mode has been generated at least once; absent (not
   * an empty array) until then — the UI reads absence as "not generated",
   * not as "generated but empty". */
  verbatim?: TranscriptModeResult;
  translate?: TranscriptModeResult;
}

/** Whatever has been generated so far, in either mode —
 * `GET /cowork/audio/transcript/:id`. 404 reads as "nothing generated yet". */
export async function getMeetingTranscriptGemini(input: {
  token: string;
  meetId: string;
}): Promise<LegacyResult<{ transcript?: MeetingTranscript }>> {
  return legacyFetch({
    path: `/cowork/audio/transcript/${encodeURIComponent(input.meetId)}`,
    token: input.token,
  });
}

/**
 * Trigger (or force-regenerate) ONE mode's transcript —
 * `POST /cowork/audio/transcript/:id?mode=verbatim|translate[&force=true]`.
 * Slow for the same reason the summary is: it streams every participant's
 * audio through the Gemini File API. Generating "translate" does not affect
 * an already-generated "verbatim" on the same meeting, or vice versa.
 */
export async function generateMeetingTranscriptGemini(input: {
  token: string;
  meetId: string;
  mode: TranscriptMode;
  force?: boolean;
}): Promise<LegacyResult<{ transcript?: MeetingTranscript; cached?: boolean }>> {
  return legacyFetch({
    path: `/cowork/audio/transcript/${encodeURIComponent(input.meetId)}`,
    method: "POST",
    query: { mode: input.mode, ...(input.force ? { force: "true" } : {}) },
    token: input.token,
    timeoutMs: 300_000,
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

/* ── Waiting out a generation the connection did not survive ──────────────────
 *
 * **Reported 21 September 2026.** Generating the transcript for a 45–50 minute
 * meeting — three participants, ~7 MB of audio each — answered *Could not reach
 * the Cowork server. Check your connection and try again.*
 *
 * Nothing was wrong with the connection, and the generation had not failed.
 * Both routes do the slow work FIRST and store it, then answer:
 * `callGemini` runs (three models, two attempts each, with backoff between
 * retries on a quota error), the result is written to Firestore, and only then
 * does `res.json()` go out. A meeting long enough to push that past whatever
 * sits in front of the engine — a proxy's read timeout, a dropped keep-alive —
 * loses the ANSWER, not the work. The transcript is generated and saved, and
 * the person is told it failed.
 *
 * `legacyFetch` already separates the two cases it can tell apart: its own
 * 300-second abort reports "did not answer within 300s", and a connection that
 * broke underneath it reports the generic message above. The generic one is
 * what was seen, which is how we know the client had not given up.
 *
 * So a broken connection is not treated as a failure any more: the caller polls
 * the GET route until the record appears. That is safe because the routes are
 * idempotent about it — a second POST while the first is still working answers
 * **429 "already in progress"** rather than starting a duplicate run, which is
 * why 429 is read here as "keep waiting" too.
 */

/** A generate call failed. Does it mean the engine might still be working? */
export function generationMayStillBeRunning(error: {
  status: number;
}): boolean {
  /* 0 is `legacyFetch`'s own code for "no HTTP response at all" — a dropped
     connection or a timeout. 429 is the engine's per-meeting lock saying it is
     already generating this. Every other status is a real answer: a 403 key
     problem, a 404 meeting, a 500 pipeline error. Those are reported. */
  return error.status === 0 || error.status === 429;
}

/** How often to ask, and how long to keep asking. */
export const GENERATION_POLL_EVERY_MS = 10_000;
/**
 * Long enough for the slowest real case.
 *
 * Was 15 minutes. A transcript is now one pass per ~5 minutes of recording,
 * per speaker — the speakers run together, so the wall clock is the passes,
 * not the files. A 55-minute meeting is about fourteen of them, which can
 * reach a quarter of an hour on its own before the Drive-to-Gemini uploads.
 */
export const GENERATION_POLL_FOR_MS = 25 * 60_000;

export interface PollOptions {
  everyMs?: number;
  forMs?: number;
  /** Injected by the tests so they do not wait in real time. */
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

const realSleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Wait for a transcript the engine is still making.
 *
 * `newerThanMs` is what makes **Regenerate** honest: forcing a new transcript
 * over an existing one would otherwise be satisfied instantly by the old one
 * sitting in the store. Pass the `createdAtMs` on screen, or 0 when there is
 * nothing there yet.
 *
 * A failed read is never fatal — a 404 means "nothing yet", and a blip means
 * ask again. Only the deadline ends the wait, and it returns null rather than
 * throwing so the caller can word its own message.
 */
export async function waitForMeetingTranscript(
  input: {
    getToken: () => Promise<string>;
    meetId: string;
    mode: TranscriptMode;
    newerThanMs: number;
  } & PollOptions,
): Promise<MeetingTranscript | null> {
  const everyMs = input.everyMs ?? GENERATION_POLL_EVERY_MS;
  const now = input.now ?? Date.now;
  const sleep = input.sleep ?? realSleep;
  const deadline = now() + (input.forMs ?? GENERATION_POLL_FOR_MS);

  while (now() < deadline) {
    await sleep(everyMs);
    let token: string;
    try {
      token = await input.getToken();
    } catch {
      /* A token that could not be minted this second is not a verdict on the
         transcript. Ask again on the next turn. */
      continue;
    }
    const got = await getMeetingTranscriptGemini({ token, meetId: input.meetId });
    if (!got.ok) continue;
    const record = got.data?.transcript;
    const generated = record?.[input.mode];
    if (record && generated && generated.createdAtMs > input.newerThanMs) {
      return record;
    }
  }
  return null;
}

/** The same wait, for the summary. See `waitForMeetingTranscript`. */
export async function waitForMeetingSummary(
  input: {
    getToken: () => Promise<string>;
    meetId: string;
    newerThanMs: number;
  } & PollOptions,
): Promise<{ createdAtMs?: number } | null> {
  const everyMs = input.everyMs ?? GENERATION_POLL_EVERY_MS;
  const now = input.now ?? Date.now;
  const sleep = input.sleep ?? realSleep;
  const deadline = now() + (input.forMs ?? GENERATION_POLL_FOR_MS);

  while (now() < deadline) {
    await sleep(everyMs);
    let token: string;
    try {
      token = await input.getToken();
    } catch {
      continue;
    }
    const got = await getMeetingSummary({ token, meetId: input.meetId });
    if (!got.ok) continue;
    const summary = got.data?.summary as { createdAtMs?: number } | undefined;
    if (summary && (summary.createdAtMs ?? 0) > input.newerThanMs) return summary;
  }
  return null;
}
