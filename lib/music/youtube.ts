import type { MusicPage, MusicResult } from "@/lib/domain";
import {
  COST_LIST,
  COST_SEARCH,
  DAILY_QUOTA_UNITS,
  REQUEST_TIMEOUT_MS,
  YOUTUBE_API,
  apiKey,
} from "./config";
import { TtlCache, quota } from "./cache";
import { MusicError, fromUpstream } from "./errors";
import { rank } from "./rank";
import {
  itemsOf,
  nextTokenOf,
  normaliseSearchItem,
  normaliseVideoItem,
  upstreamReason,
} from "./schema";
import type { MusicProvider, SearchQuery } from "./provider";

/**
 * The only implementation of `MusicProvider`, using documented YouTube Data
 * API v3 endpoints and nothing else.
 *
 * SERVER ONLY. It reads the API key, so importing it from a client module
 * would leak the secret into the browser bundle. Every caller is a route
 * handler under `app/api/music/`.
 *
 * No media is ever fetched, proxied or transformed here — only metadata.
 * Playback happens in YouTube's own iframe, in the browser, direct.
 *
 * This provider searches MUSIC and nothing else. There is no podcast mode, no
 * general-video mode and no all-audio mode: the search is constrained at the
 * API (`type=video`, `videoCategoryId=10`, `videoEmbeddable=true`), every row
 * is then re-checked against `videos.list`, and anything that is not a song is
 * removed rather than ranked low.
 */

/* Searches are the scarce resource: 100 units each against a 10,000/day
   ceiling. Thirty minutes of caching turns a re-search, a back navigation and
   two colleagues asking the same question into one upstream call. */
const searchCache = new TtlCache<MusicPage>(500, 30 * 60_000);
/* Details are 1 unit and change slowly, so they are cached far longer. */
const detailCache = new TtlCache<MusicResult[]>(800, 6 * 60 * 60_000);

async function call(
  path: string,
  params: Record<string, string>,
  signal: AbortSignal,
) {
  const url = new URL(`${YOUTUBE_API}/${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set("key", apiKey());

  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(), REQUEST_TIMEOUT_MS);
  const composite = AbortSignal.any([signal, timeout.signal]);

  let res: Response;
  try {
    res = await fetch(url, { signal: composite, cache: "no-store" });
  } catch (e) {
    clearTimeout(timer);
    if (timeout.signal.aborted)
      throw new MusicError("timeout", "YouTube did not respond in time.");
    if ((e as Error)?.name === "AbortError")
      throw new MusicError("network", "Request cancelled.");
    throw new MusicError("network", "Could not reach YouTube.");
  }
  clearTimeout(timer);

  if (!res.ok) {
    // The body is read ONLY to classify the failure. It is never forwarded,
    // logged or attached to the thrown error: Google's error payloads can
    // echo the request URL, and the request URL carries the key.
    let reason: string | undefined;
    try {
      reason = upstreamReason(await res.json());
    } catch {
      reason = undefined;
    }
    throw fromUpstream(res.status, reason);
  }

  try {
    return await res.json();
  } catch {
    throw new MusicError(
      "malformed_response",
      "YouTube returned something unreadable.",
    );
  }
}

function assertQuota(cost: number) {
  if (quota.spent + cost > DAILY_QUOTA_UNITS) {
    throw new MusicError(
      "quota_exceeded",
      "The daily YouTube allowance is used up. Cached results still work; new searches resume tomorrow.",
    );
  }
}

export class YouTubeMusicProvider implements MusicProvider {
  readonly id = "youtube" as const;

  normaliseResult(raw: unknown, kind: "search" | "video") {
    return kind === "search"
      ? normaliseSearchItem(raw)
      : normaliseVideoItem(raw);
  }

  async search(query: SearchQuery, signal: AbortSignal): Promise<MusicPage> {
    const key = `${query.q.toLowerCase()}|${query.pageToken ?? ""}`;

    const { value, cached } = await searchCache.remember(key, async () => {
      assertQuota(COST_SEARCH);

      const params: Record<string, string> = {
        part: "snippet",
        q: query.q,
        type: "video",
        // Music, and only music. The first of three gates.
        videoCategoryId: "10",
        // Only what this player can actually play, so a result never promises
        // something the iframe then refuses.
        videoEmbeddable: "true",
        videoSyndicated: "true",
        // Ask for more than we intend to show: the filtering below is severe,
        // and a page of eight songs is better than twenty-five maybes.
        maxResults: "40",
        safeSearch: "moderate",
      };
      if (query.pageToken) params.pageToken = query.pageToken;

      const payload = await call("search", params, signal);
      quota.spend(COST_SEARCH);

      const found = itemsOf(payload)
        .map((i) => normaliseSearchItem(i))
        .filter((r): r is MusicResult => r !== null);

      /* Second gate. `search.list` carries no duration, no embeddability, no
         category and no statistics, so every row is re-read through
         `videos.list` — one unit for the whole page — before anything is shown.
         A row that does not come back was deleted between the two calls. */
      const detailed = found.length
        ? await this.getVideoDetails(
            found.map((i) => i.id),
            signal,
          )
        : [];
      const byId = new Map(detailed.map((d) => [d.id, d]));
      const validated = found
        .map((i) => {
          const d = byId.get(i.id);
          // Search thumbnails are the ones already rendering in the list.
          return d ? { ...d, thumbnails: i.thumbnails } : null;
        })
        .filter((r): r is MusicResult => r !== null);

      /* Third gate, and the ordering: `rank` removes what is not a song and
         hides what it cannot vouch for. */
      return {
        items: rank(validated, query.q),
        nextPageToken: nextTokenOf(payload),
        cached: false,
      } satisfies MusicPage;
    });

    return { ...value, cached };
  }

  async getVideoDetails(
    ids: string[],
    signal: AbortSignal,
  ): Promise<MusicResult[]> {
    const unique = [...new Set(ids)]
      .filter((id) => /^[\w-]{6,20}$/.test(id))
      .slice(0, 50);
    if (!unique.length) return [];

    const key = unique.slice().sort().join(",");
    const { value } = await detailCache.remember(key, async () => {
      assertQuota(COST_LIST);
      const payload = await call(
        "videos",
        {
          // `statistics` is here for view count: the only signal that can tell
          // one identically-titled "Ghost" from another.
          part: "snippet,contentDetails,status,statistics",
          id: unique.join(","),
          maxResults: "50",
        },
        signal,
      );
      quota.spend(COST_LIST);
      return itemsOf(payload)
        .map((i) => normaliseVideoItem(i))
        .filter((r): r is MusicResult => r !== null);
    });
    return value;
  }
}

export const youtubeProvider = new YouTubeMusicProvider();
export { quota };
