import type { MusicResult } from "@/lib/domain";
import { hintsFor } from "./rank";

/**
 * Hand-written validators for the upstream payloads.
 *
 * Deliberately narrow and deliberately forgiving IN ONE DIRECTION: an item that
 * fails validation is dropped, never thrown on. YouTube returns heterogeneous
 * rows — a deleted video inside a playlist has no thumbnails, a live stream has
 * no duration — and one bad row must never take a page down with it.
 *
 * No schema library: the shapes we consume are small and stable, and a
 * dependency here would be more surface than the twenty lines it replaces.
 */

function str(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}
function obj(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}
function num(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && /^\d+$/.test(v)) return Number(v);
  return null;
}

/** ISO-8601 durations, the subset YouTube actually emits. */
export function parseDuration(iso: unknown): number | null {
  const s = str(iso);
  if (!s) return null;
  const m = /^P(?:(\d+)D)?T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(s);
  if (!m) return null;
  const [, d, h, min, sec] = m;
  const total =
    Number(d ?? 0) * 86400 +
    Number(h ?? 0) * 3600 +
    Number(min ?? 0) * 60 +
    Number(sec ?? 0);
  return total > 0 ? total : null;
}

function thumbs(
  snippet: Record<string, unknown>,
): { small: string; medium: string } | null {
  const t = obj(snippet.thumbnails);
  if (!t) return null;
  const pick = (k: string) => {
    const e = obj(t[k]);
    return e ? str(e.url) : null;
  };
  const small = pick("default") ?? pick("medium") ?? pick("high");
  const medium = pick("medium") ?? pick("high") ?? small;
  if (!small || !medium) return null;
  // Only ever an i.ytimg.com/img.youtube.com host — we render YouTube's own art.
  if (!/^https:\/\/(i\.ytimg\.com|img\.youtube\.com)\//.test(medium))
    return null;
  return { small, medium };
}

interface Raw {
  id: string;
  snippet: Record<string, unknown>;
  durationSecs?: number | null;
  embeddable?: boolean | null;
  viewCount?: number | null;
}

function build(raw: Raw): MusicResult | null {
  const title = str(raw.snippet.title);
  const channelTitle = str(raw.snippet.channelTitle) ?? "Unknown channel";
  const th = thumbs(raw.snippet);
  if (!title || !th) return null;
  // YouTube uses this placeholder for removed items inside playlists.
  if (title === "Deleted video" || title === "Private video") return null;

  const liveRaw = str(raw.snippet.liveBroadcastContent) ?? "none";
  const liveState =
    liveRaw === "live" || liveRaw === "upcoming" ? liveRaw : "none";

  const partial: MusicResult = {
    id: raw.id,
    title,
    channelTitle,
    channelId: str(raw.snippet.channelId) ?? "",
    thumbnails: th,
    durationSecs: raw.durationSecs ?? null,
    publishedAt: str(raw.snippet.publishedAt),
    embeddable: raw.embeddable ?? null,
    liveState,
    categoryId: str(raw.snippet.categoryId),
    viewCount: raw.viewCount ?? null,
    sourceHints: [],
    url: `https://www.youtube.com/watch?v=${raw.id}`,
  };

  // Hints are derived from the finished row, so the badges a reader sees and
  // the evidence the ranking used are the same computation.
  return { ...partial, sourceHints: hintsFor(partial) };
}

/** `search.list` rows. Ids arrive nested and typed by kind. */
export function normaliseSearchItem(item: unknown): MusicResult | null {
  const o = obj(item);
  if (!o) return null;
  const snippet = obj(o.snippet);
  const idObj = obj(o.id);
  if (!snippet || !idObj) return null;

  const videoId = str(idObj.videoId);
  if (!videoId) return null;
  return build({ id: videoId, snippet });
}

/** `videos.list` rows — the only place duration and embeddability exist. */
export function normaliseVideoItem(item: unknown): MusicResult | null {
  const o = obj(item);
  if (!o) return null;
  const snippet = obj(o.snippet);
  const id = str(o.id);
  if (!snippet || !id) return null;
  const content = obj(o.contentDetails);
  const status = obj(o.status);
  const stats = obj(o.statistics);
  return build({
    id,
    snippet,
    durationSecs: content ? parseDuration(content.duration) : null,
    embeddable:
      status && typeof status.embeddable === "boolean"
        ? status.embeddable
        : null,
    viewCount: stats ? num(stats.viewCount) : null,
  });
}

export function itemsOf(payload: unknown): unknown[] {
  const o = obj(payload);
  return o && Array.isArray(o.items) ? o.items : [];
}

export function nextTokenOf(payload: unknown): string | null {
  const o = obj(payload);
  return o ? str(o.nextPageToken) : null;
}

/** Google's structured error reason, used only to classify. */
export function upstreamReason(payload: unknown): string | undefined {
  const o = obj(payload);
  const err = o ? obj(o.error) : null;
  const errors = err && Array.isArray(err.errors) ? err.errors : [];
  const first = errors.length ? obj(errors[0]) : null;
  return first ? (str(first.reason) ?? undefined) : undefined;
}
