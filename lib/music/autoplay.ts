import type { MusicResult } from "@/lib/domain";
import { artistOf } from "./rank";

/**
 * Cowork Autoplay.
 *
 * NOT a YouTube recommendation. YouTube removed `relatedToVideoId` from the
 * Data API in August 2023 and offers no authorised replacement, so there is no
 * honest way to say "YouTube suggests this". What Cowork can honestly do is
 * look at what *this listener* already kept, and it says so by name wherever a
 * track arrives this way.
 *
 * Order of preference, and it never overrides a manual choice:
 *
 *   0. the manual queue always wins — this is only consulted once it is empty
 *   1. something already seen by the same artist (free: already in memory)
 *   2. a favourite not played recently                       (free)
 *   3. a recently played track from a recent artist          (free)
 *   4. one network search, only as a last resort             (100 quota units)
 *
 * When none of those yields a track it STOPS. Silence is the correct answer to
 * "I have nothing reliable to play", and inventing something is worse than
 * ending cleanly.
 */

export interface AutoplaySources {
  /** Everything the session has seen — search results, playlists, queue. */
  seen: MusicResult[];
  favourites: MusicResult[];
  recentlyPlayed: MusicResult[];
  /** Ids already played this session, so autoplay does not loop on one track. */
  playedIds: Set<string>;
}

export interface AutoplayPick {
  item: MusicResult;
  /** Shown to the listener so the provenance is never implied. */
  reason: string;
  /** True when satisfying this required a network search. */
  spentQuota: boolean;
}

function playable(r: MusicResult, playedIds: Set<string>): boolean {
  return (
    r.embeddable !== false && r.liveState === "none" && !playedIds.has(r.id)
  );
}

/**
 * Free tiers only — nothing here costs quota. Returns null when local material
 * is exhausted, which is the caller's cue to decide whether a search is worth
 * one hundred units.
 */
export function pickLocally(
  lastPlayed: MusicResult | null,
  sources: AutoplaySources,
): AutoplayPick | null {
  const { seen, favourites, recentlyPlayed, playedIds } = sources;

  if (lastPlayed) {
    const artist = artistOf(lastPlayed).toLowerCase();
    if (artist) {
      const sameArtist = seen.find(
        (r) => playable(r, playedIds) && artistOf(r).toLowerCase() === artist,
      );
      if (sameArtist) {
        return {
          item: sameArtist,
          reason: `More from ${artistOf(sameArtist)}`,
          spentQuota: false,
        };
      }
    }
  }

  const favourite = favourites.find((r) => playable(r, playedIds));
  if (favourite) {
    return {
      item: favourite,
      reason: "From your favourites",
      spentQuota: false,
    };
  }

  const recentArtists = new Set(
    recentlyPlayed
      .slice(0, 8)
      .map((r) => artistOf(r).toLowerCase())
      .filter(Boolean),
  );
  const fromRecentArtist = seen.find(
    (r) =>
      playable(r, playedIds) && recentArtists.has(artistOf(r).toLowerCase()),
  );
  if (fromRecentArtist) {
    return {
      item: fromRecentArtist,
      reason: `More from ${artistOf(fromRecentArtist)}`,
      spentQuota: false,
    };
  }

  const anyRecent = recentlyPlayed.find((r) => playable(r, playedIds));
  if (anyRecent) {
    return { item: anyRecent, reason: "Played recently", spentQuota: false };
  }

  return null;
}

/**
 * The last resort's query. Built from the listener's own material, so the
 * search is a continuation of what they were doing rather than a guess.
 */
export function autoplayQuery(
  lastPlayed: MusicResult | null,
  sources: AutoplaySources,
): string | null {
  const artist = lastPlayed ? artistOf(lastPlayed) : "";
  if (artist) return artist;
  const fromFav = sources.favourites[0] ? artistOf(sources.favourites[0]) : "";
  if (fromFav) return fromFav;
  return null;
}
