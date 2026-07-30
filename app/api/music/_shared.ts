import { NextResponse } from "next/server";
import { MUSIC_ENABLED, hasApiKey } from "@/lib/music/config";
import { MusicError, statusFor } from "@/lib/music/errors";
import type { MusicErrorBody } from "@/lib/domain";

/**
 * Shared guard and error shaping for every music route.
 *
 * The single rule these enforce: nothing derived from the API key, and nothing
 * taken from an upstream error body, is ever serialised to the client. Failures
 * are translated into our own vocabulary first.
 */

export function guard(): NextResponse | null {
  if (!MUSIC_ENABLED) return fail(new MusicError("disabled", "Focus Music is turned off."));
  if (!hasApiKey())
    return fail(
      new MusicError("not_configured", "Focus Music is not configured on this deployment."),
    );
  return null;
}

export function fail(e: unknown): NextResponse {
  const err =
    e instanceof MusicError
      ? e
      : new MusicError("upstream_error", "Something went wrong reaching YouTube.");

  const body: MusicErrorBody = { error: err.code, message: err.message };
  if (err.retryAfter) body.retryAfter = err.retryAfter;

  return NextResponse.json(body, {
    status: statusFor(err.code),
    headers: err.retryAfter ? { "Retry-After": String(err.retryAfter) } : undefined,
  });
}

/** Trimmed, length-bounded, control characters stripped. */
export function readQuery(raw: string | null): string {
  const stripped = Array.from(raw ?? "")
    .filter((ch) => {
      const c = ch.codePointAt(0) ?? 0;
      return c >= 0x20 && c !== 0x7f;
    })
    .join("");
  return stripped.trim().slice(0, 120);
}

export function readPageToken(raw: string | null): string | null {
  const t = (raw ?? "").trim();
  // YouTube page tokens are opaque, but always URL-safe.
  return t && /^[\w=-]{1,64}$/.test(t) ? t : null;
}
