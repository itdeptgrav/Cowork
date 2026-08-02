/**
 * Focus Music.
 *
 * A PERSONAL UTILITY. Nothing in this module is connected to performance
 * scoring, attendance, task timers, work commits, manager visibility or any
 * analytics surface, and nothing here may become so. Listening is not work
 * product and is never evidence about a person.
 *
 * The types deliberately live in their own domain module rather than beside
 * tasks or scoring, so that boundary is structural rather than a convention
 * someone has to remember.
 */

/**
 * Evidence about where a result came from — never a verdict.
 *
 * YouTube does not expose an "official" flag. What it does expose is the
 * channel's own name and shape, so these hints say exactly what was observed
 * ("this is an auto-generated Topic channel") and let the reader draw the
 * conclusion. Nothing in the UI prints the word "Official" unless the channel
 * itself is a Topic or VEVO channel, and even then it names the evidence.
 */
export type SourceHint =
  | "topic_channel"
  | "vevo"
  | "label_channel"
  | "artist_channel"
  | "official_audio"
  | "official_video"
  | "lyric_video"
  | "popular"
  | "verified_length"
  | "long_form";

export interface MusicResult {
  id: string;
  title: string;
  channelTitle: string;
  channelId: string;
  thumbnails: { small: string; medium: string };
  /** Null when the upstream response omitted contentDetails. */
  durationSecs: number | null;
  publishedAt: string | null;
  /** From `videos.list.status.embeddable`. Null until details are fetched. */
  embeddable: boolean | null;
  liveState: "none" | "live" | "upcoming";
  /** `snippet.categoryId`. "10" is Music; anything else is not a track. */
  categoryId: string | null;
  /** From `videos.list.statistics`. A popularity signal, never a verdict. */
  viewCount: number | null;
  sourceHints: SourceHint[];
  /** Canonical youtube.com URL. Always offered — never a proxy. */
  url: string;
}

export interface MusicPage {
  items: MusicResult[];
  nextPageToken: string | null;
  /** True when the payload came from cache and cost no upstream quota. */
  cached: boolean;
}

export interface MusicQueue {
  items: MusicResult[];
  /** −1 when nothing has been selected yet. */
  currentIndex: number;
}

/**
 * A list somebody built themselves.
 *
 * Distinct from favourites, which is one flat set with no order and no name:
 * a playlist says "these, in this order, for this" — the difference between
 * liking a track and choosing what a morning sounds like.
 *
 * It holds whole `MusicResult`s rather than ids because there is no library to
 * resolve an id against; a stored id with no way to render a title would be a
 * playlist of blank rows the moment the search cache expired.
 *
 * Like everything else in this module it is PERSONAL. A playlist is never
 * shared, never visible to a manager and never read by scoring.
 */
export interface MusicPlaylist {
  id: string;
  name: string;
  items: MusicResult[];
  createdAt: string;
  /** Bumped by every edit, so the list can be shown most-recently-touched. */
  updatedAt: string;
}

export interface MusicPreferences {
  volume: number;
  muted: boolean;
  /** Quietens everything AROUND the video. Never the video itself. */
  focusLayout: boolean;
  /**
   * Cowork Autoplay. Off by default, and it never pre-empts the manual queue —
   * it only acts once the queue is exhausted.
   */
  autoplay: boolean;
  railCollapsed: boolean;
}

export const DEFAULT_MUSIC_PREFERENCES: MusicPreferences = {
  volume: 70,
  muted: false,
  focusLayout: false,
  autoplay: false,
  railCollapsed: false,
};

/** Machine-readable failures. Upstream error bodies never reach the client. */
export type MusicErrorCode =
  | "disabled"
  | "not_configured"
  | "invalid_query"
  | "quota_exceeded"
  | "quota_low"
  | "upstream_error"
  | "malformed_response"
  | "timeout"
  | "network";

export interface MusicErrorBody {
  error: MusicErrorCode;
  message: string;
  /** Seconds until quota is expected to reset, when known. */
  retryAfter?: number;
}
