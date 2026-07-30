/**
 * Environment access for the music feature.
 *
 * THE API KEY NEVER LEAVES THIS MODULE, and this module is only ever imported
 * by server route handlers. It exports booleans and a getter that throws if
 * called anywhere a key would be absent — never the value itself, never a
 * prefix of it, never its length. Nothing here is logged.
 */

/** Public flag. Safe in client code; it is only an on/off switch. */
export const MUSIC_ENABLED =
  process.env.NEXT_PUBLIC_ENABLE_YOUTUBE_MUSIC === "true";

/** Server-only. Never call from a "use client" module. */
export function hasApiKey(): boolean {
  return (
    typeof process.env.YOUTUBE_API_KEY === "string" &&
    process.env.YOUTUBE_API_KEY.length > 0
  );
}

/**
 * Server-only. The single read of the secret in the codebase.
 *
 * Callers pass it straight into a URL that is never returned, echoed or
 * logged. If you find yourself wanting to log the request URL, log the path
 * and the parameter NAMES instead.
 */
export function apiKey(): string {
  const k = process.env.YOUTUBE_API_KEY;
  if (!k) throw new Error("YOUTUBE_API_KEY is not configured");
  return k;
}

export const YOUTUBE_API = "https://www.googleapis.com/youtube/v3";

/** Upstream requests are abandoned at this point rather than hanging a route. */
export const REQUEST_TIMEOUT_MS = 6000;

/**
 * Daily quota for a default Google Cloud project. `search.list` costs 100 units
 * against it, which is the single hardest constraint on this feature: roughly
 * one hundred network searches per day for the whole deployment. Everything
 * about the caching strategy follows from this number.
 */
export const DAILY_QUOTA_UNITS = 10_000;
export const COST_SEARCH = 100;
export const COST_LIST = 1;
