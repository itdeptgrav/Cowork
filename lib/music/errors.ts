import type { MusicErrorCode } from "@/lib/domain";

/**
 * A failure the client is allowed to see.
 *
 * Upstream bodies are mapped into this before serialisation. Google's error
 * payloads can include the request URL, which carries the key — so the raw
 * body is never forwarded, never logged and never attached here.
 */
export class MusicError extends Error {
  constructor(
    readonly code: MusicErrorCode,
    message: string,
    readonly retryAfter?: number,
  ) {
    super(message);
    this.name = "MusicError";
  }
}

export function statusFor(code: MusicErrorCode): number {
  switch (code) {
    case "disabled":
      return 404;
    case "not_configured":
      return 503;
    case "invalid_query":
      return 400;
    case "quota_exceeded":
      return 429;
    case "timeout":
      return 504;
    default:
      return 502;
  }
}

/**
 * Maps an upstream HTTP status and reason to our own vocabulary.
 *
 * `reason` comes from Google's structured error object, not from free text, so
 * nothing user-supplied or key-bearing is carried across.
 */
export function fromUpstream(status: number, reason?: string): MusicError {
  if (
    status === 403 &&
    (reason === "quotaExceeded" || reason === "dailyLimitExceeded")
  ) {
    return new MusicError(
      "quota_exceeded",
      "The daily YouTube search allowance is used up. Cached results still work; new searches resume after the quota resets.",
      secondsToMidnightPacific(),
    );
  }
  if (status === 403) {
    return new MusicError("upstream_error", "YouTube refused the request.");
  }
  if (status === 400) {
    return new MusicError(
      "invalid_query",
      "That search could not be understood.",
    );
  }
  return new MusicError(
    "upstream_error",
    "YouTube did not answer correctly. Try again shortly.",
  );
}

/** YouTube quota resets at midnight Pacific. Approximate, and only advisory. */
export function secondsToMidnightPacific(): number {
  const now = new Date();
  const pacificOffsetHours = 8; // Standard time; an hour out during DST, and advisory only.
  const utcMs = now.getTime();
  const pacific = new Date(utcMs - pacificOffsetHours * 3600_000);
  const nextMidnight = Date.UTC(
    pacific.getUTCFullYear(),
    pacific.getUTCMonth(),
    pacific.getUTCDate() + 1,
  );
  return Math.max(60, Math.round((nextMidnight - pacific.getTime()) / 1000));
}
