import type { MusicPage, MusicResult } from "@/lib/domain";

export interface SearchQuery {
  q: string;
  pageToken: string | null;
}

/**
 * The seam between Cowork and whatever supplies music metadata.
 *
 * Only ONE implementation exists and only one is planned, but the interface is
 * real: it is what keeps YouTube-shaped assumptions out of the components, and
 * it is where a different catalogue would attach.
 *
 * There is no search type and no playlist lookup: Cowork searches music, and
 * only music. Removing the modes removed the ways to leave that promise.
 *
 * Note the absence of any `getRelatedItems`. YouTube removed
 * `relatedToVideoId` from the Data API in August 2023 and offers no authorised
 * replacement, so there is no honest way to implement it. Cowork Autoplay uses
 * the listener's own history instead — see `lib/music/autoplay.ts`.
 */
export interface MusicProvider {
  readonly id: "youtube";
  search(q: SearchQuery, signal: AbortSignal): Promise<MusicPage>;
  getVideoDetails(ids: string[], signal: AbortSignal): Promise<MusicResult[]>;
  /** Returns null for anything malformed rather than throwing. */
  normaliseResult(raw: unknown, kind: "search" | "video"): MusicResult | null;
}
