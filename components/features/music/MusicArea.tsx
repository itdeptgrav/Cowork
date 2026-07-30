"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import Image from "next/image";
import Link from "next/link";
import { useMusic } from "./MusicContext";
import { ResultRow } from "./ResultRow";
import { PlayerControls } from "./PlayerControls";
import { Icon } from "@/components/ui/Icons";
import {
  Chip,
  EmptyState,
  ErrorState,
  SkeletonRows,
} from "@/components/ui/Primitives";
import { Card } from "@/components/features/dashboard/Card";
import type { MusicResult } from "@/lib/domain";

/**
 * The music surface, in two modes.
 *
 * Search is the page in both. What differs is the now-playing block: `/music`
 * shows static artwork because its whole purpose is background audio that does
 * not ask to be watched, and `/yt` shows the player because watching is the
 * point of that route. Everything else — search, queue, favourites, recents —
 * is identical, so moving between them is a change of medium, not of product.
 *
 * Quota shapes the interaction: `search.list` costs 100 of 10,000 daily units,
 * so there is no search-as-you-type. Suggestions come from the reader's own
 * recent searches, which are local and free; the network is only touched on an
 * explicit submit.
 */

const FOCUS_PRESETS = [
  "lo-fi beats for focus",
  "instrumental study music",
  "ambient soundscape",
  "classical for concentration",
  "deep focus electronic",
];

export function MusicArea({
  enabled,
  /**
   * `audio` is `/music`: a static thumbnail and controls, no video anywhere on
   * the page. `video` is `/yt`: the same search and queue with the real player
   * in place of the artwork. One component, because they are the same product
   * with a different answer to "should I be watching this".
   */
  mode = "audio",
}: {
  enabled: boolean;
  mode?: "audio" | "video";
}) {
  const music = useMusic();
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  /* The committed query is restored from storage after mount, so the input has
     to catch up once. Adjusting during render is React's own answer to this —
     an effect would cascade a second render for the same result. */
  const [syncedQuery, setSyncedQuery] = useState(music.search.query);
  if (syncedQuery !== music.search.query) {
    setSyncedQuery(music.search.query);
    setDraft(music.search.query);
  }

  if (!enabled) {
    return (
      <Card title="Music">
        <EmptyState
          title="Music is turned off"
          body="This deployment has the feature flag disabled. Nothing is being requested from YouTube."
        />
      </Card>
    );
  }

  const s = music.search;
  const suggestions = draft.trim().length
    ? music.recentSearches.filter(
        (r) =>
          r.toLowerCase().includes(draft.trim().toLowerCase()) && r !== draft,
      )
    : [];

  function submit(e?: React.FormEvent) {
    e?.preventDefault();
    music.runSearch(draft);
  }

  return (
    <div className="flex flex-col gap-4">
      {/* ── Search ─────────────────────────────────────────────────────── */}
      <Card
        title={mode === "video" ? "YouTube" : "Music"}
        headerRight={
          <Toggle
            on={music.prefs.autoplay}
            onChange={(v) => music.setPrefs({ autoplay: v })}
            hint="When the queue runs out, keep playing from music Cowork already knows about. Never a YouTube recommendation."
          >
            Cowork Autoplay
          </Toggle>
        }
      >
        <form
          role="search"
          onSubmit={submit}
          className="flex flex-wrap items-center gap-2"
        >
          <label className="relative min-w-0 flex-1">
            <span className="sr-only">Search for a song, artist or album</span>
            <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-ink-faint">
              <Icon.search />
            </span>
            <input
              ref={inputRef}
              id="music-search"
              type="search"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Song, artist or album"
              autoComplete="off"
              className="h-10 w-full rounded-full bg-[var(--surface-sunken)] pr-3 pl-9 text-sm text-ink placeholder:text-ink-faint focus:outline-none focus-visible:ring-2 focus-visible:ring-ink"
            />
          </label>

          <button
            type="submit"
            disabled={draft.trim().length < 2 || s.status === "searching"}
            className="inline-flex h-10 items-center gap-1.5 rounded-full bg-ink px-4 text-sm font-medium text-[var(--body-bg)] transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            {s.status === "searching" ? "Searching…" : "Search"}
          </button>

          {(s.query || draft) && (
            <button
              type="button"
              onClick={() => {
                setDraft("");
                music.clearSearch();
                inputRef.current?.focus();
              }}
              className="inline-flex h-10 items-center rounded-full px-3 text-xs font-medium text-ink-muted transition-colors hover:bg-[var(--control)] hover:text-ink"
            >
              Clear
            </button>
          )}
        </form>

        {/* Suggestions come from this person's own history — free, and never a
            per-keystroke request against a 100-search daily budget. */}
        {suggestions.length > 0 && (
          <ul className="mt-2 flex flex-wrap gap-1.5">
            {suggestions.slice(0, 5).map((r) => (
              <li key={r}>
                <button
                  type="button"
                  onClick={() => {
                    setDraft(r);
                    music.runSearch(r);
                  }}
                  className="rounded-full bg-[var(--control)] px-2.5 py-1 text-[11px] text-ink-muted transition-colors hover:text-ink"
                >
                  {r}
                </button>
              </li>
            ))}
          </ul>
        )}

        <p aria-live="polite" className="sr-only">
          {s.status === "searching"
            ? "Searching YouTube"
            : s.status === "ready"
              ? `${s.items.length} results for ${s.query}`
              : s.status === "empty"
                ? `No music found for ${s.query}`
                : ""}
        </p>
      </Card>

      <div className="grid grid-cols-1 items-start gap-4 deck:grid-cols-12">
        {/* ── Results: the widest, tallest thing on the page ─────────────── */}
        <div className="min-w-0 deck:col-span-8">
          <Card
            title={s.query ? `Results for “${s.query}”` : "Start here"}
            padded={false}
            headerRight={
              s.cached ? (
                <Chip>Cached — no quota used</Chip>
              ) : s.status === "ready" ? (
                <Chip>{s.items.length} found</Chip>
              ) : null
            }
          >
            {s.status === "idle" ? (
              <div className="px-5 pb-2">
                <EmptyState
                  compact
                  title="Search for something to play"
                  body="Cowork searches music only — songs, artists and albums. Suggestions below are a starting point."
                />
                <ul className="mt-1 flex flex-wrap gap-1.5 pb-2">
                  {FOCUS_PRESETS.map((p) => (
                    <li key={p}>
                      <button
                        type="button"
                        onClick={() => {
                          setDraft(p);
                          music.runSearch(p);
                        }}
                        className="rounded-full bg-[var(--control)] px-3 py-1.5 text-[11px] text-ink-muted transition-colors hover:bg-[var(--control-hover)] hover:text-ink"
                      >
                        {p}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ) : s.status === "searching" ? (
              <div className="px-5 py-3">
                <SkeletonRows rows={6} />
              </div>
            ) : s.status === "error" ? (
              <div className="px-5">
                <ErrorState
                  title={
                    s.errorCode === "quota_exceeded"
                      ? "Daily YouTube allowance used up"
                      : s.errorCode === "disabled"
                        ? "Music is turned off"
                        : "Search did not complete"
                  }
                  body={s.errorMessage ?? undefined}
                  onRetry={
                    s.errorCode === "quota_exceeded"
                      ? undefined
                      : () => music.runSearch(s.query)
                  }
                />
              </div>
            ) : s.status === "empty" ? (
              <div className="px-5">
                <EmptyState
                  title="No music matched"
                  body="Cowork only shows results it can identify as music, so trailers, talk and clips never appear. Try the artist's name, or a shorter phrase."
                />
              </div>
            ) : (
              <>
                <ul
                  aria-label="Search results"
                  className="@container divide-y divide-hairline"
                >
                  {s.items.map((item) => (
                    <ResultRow key={item.id} item={item} />
                  ))}
                </ul>
                {s.nextPageToken && (
                  <div className="flex justify-center border-t border-hairline p-3">
                    <button
                      type="button"
                      onClick={music.loadMore}
                      disabled={s.status === "loading_more"}
                      className="rounded-full bg-[var(--control)] px-4 py-2 text-xs font-medium text-ink transition-colors hover:bg-[var(--control-hover)] disabled:opacity-50"
                    >
                      {s.status === "loading_more" ? "Loading…" : "Load more"}
                    </button>
                  </div>
                )}
              </>
            )}
          </Card>
        </div>

        {/* ── The player and the queue ───────────────────────────────────── */}
        <div className="flex min-w-0 flex-col gap-4 deck:col-span-4">
          <NowPlaying mode={mode} />

          <Card
            title="Queue"
            padded={false}
            headerRight={
              music.queue.length > 0 ? (
                <button
                  type="button"
                  onClick={music.clearQueue}
                  className="rounded-full px-2 py-1 text-[11px] text-ink-faint transition-colors hover:bg-[var(--control)] hover:text-ink"
                >
                  Clear
                </button>
              ) : null
            }
          >
            {music.queue.length === 0 ? (
              <Quiet>Nothing queued. Add a track from the results.</Quiet>
            ) : (
              <ul
                aria-label="Playback queue"
                className="@container divide-y divide-hairline"
              >
                {music.queue.map((item, i) => (
                  <ResultRow
                    key={`${item.id}-${i}`}
                    item={item}
                    index={i}
                    variant="queue"
                    onMove={music.moveItem}
                    onRemove={music.removeAt}
                  />
                ))}
              </ul>
            )}
          </Card>

          <Collection
            title="Favourites"
            items={music.favourites}
            empty="Nothing saved yet."
          />

          <Collection
            title="Recently played"
            items={music.recentlyPlayed}
            empty="Nothing played yet."
          />

          {music.recentSearches.length > 0 && (
            <Card
              title="Recent searches"
              headerRight={
                <button
                  type="button"
                  onClick={music.clearRecentSearches}
                  className="rounded-full px-2 py-1 text-[11px] text-ink-faint transition-colors hover:bg-[var(--control)] hover:text-ink"
                >
                  Clear
                </button>
              }
            >
              <ul className="flex flex-wrap gap-1.5">
                {music.recentSearches.map((r) => (
                  <li key={r}>
                    <button
                      type="button"
                      onClick={() => {
                        setDraft(r);
                        music.runSearch(r);
                      }}
                      className="rounded-full bg-[var(--control)] px-3 py-1.5 text-[11px] text-ink-muted transition-colors hover:bg-[var(--control-hover)] hover:text-ink"
                    >
                      {r}
                    </button>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          <p className="px-1 text-[11px] text-ink-faint">
            Search and playback use YouTube. This is not YouTube Music’s API,
            and Cowork does not record what you listen to for anyone but you —
            music is never connected to your score, attendance or task timers.
          </p>
        </div>
      </div>
    </div>
  );
}

/**
 * The now-playing block.
 *
 * In audio mode this is a still image and nothing else: no iframe, no overlay,
 * no play affordance on the artwork, `pointer-events-none` so it cannot be
 * clicked into a video. In video mode it is a reserved rectangle that the
 * shell-owned player is drawn over — the same element that keeps playing when
 * the route changes, which is why it is a hole here rather than an iframe.
 */
function NowPlaying({ mode }: { mode: "audio" | "video" }) {
  const music = useMusic();
  const { registerStage, current } = music;

  const attach = useCallback(
    (el: HTMLDivElement | null) => registerStage(el),
    [registerStage],
  );

  /* Registering the slot is what switches the engine into video presentation,
     so audio mode must never register one — and must release it on the way in,
     in case the reader arrived from `/yt`. */
  useEffect(() => {
    if (mode === "audio") registerStage(null);
  }, [mode, registerStage]);

  if (!current) {
    return (
      <Card title={mode === "video" ? "Player" : "Now playing"}>
        <EmptyState
          compact
          title="Nothing playing"
          body={
            mode === "video"
              ? "Play a result and the video appears here."
              : "Play a result and it appears here, then stays with you in a small bar as you work."
          }
        />
      </Card>
    );
  }

  return (
    <div className="deck:sticky deck:top-[84px]">
      <Card title="Now playing" padded={false}>
        <div className="px-4 pb-4">
          {mode === "video" ? (
            <div
              ref={attach}
              className="aspect-video w-full rounded-panel bg-black"
            />
          ) : (
            <span className="pointer-events-none relative block aspect-video w-full overflow-hidden rounded-panel bg-[var(--control)] select-none">
              <Image
                src={current.thumbnails.medium}
                alt=""
                fill
                sizes="(max-width: 1180px) 100vw, 360px"
                className="pointer-events-none object-cover select-none"
                draggable={false}
                unoptimized
              />
              {/* A wash, so text sitting under the artwork keeps its contrast
                  and the image reads as a still rather than a paused video. */}
              <span
                aria-hidden="true"
                className="absolute inset-0"
                style={{
                  background:
                    "linear-gradient(180deg, rgba(10,10,12,0) 45%, rgba(10,10,12,0.35) 100%)",
                }}
              />
            </span>
          )}

          <div className="mt-3 min-w-0">
            <p className="truncate text-sm font-medium text-ink">
              {current.title}
            </p>
            <p className="truncate text-xs text-ink-muted">
              {current.channelTitle}
              {music.queue.length > 1 && (
                <>
                  {" · "}
                  <span data-figure>
                    {music.currentIndex + 1}/{music.queue.length}
                  </span>
                </>
              )}
            </p>
          </div>

          {music.autoplayNotice && (
            <p className="mt-1 truncate text-[11px] text-ink-faint">
              {music.autoplayNotice}
            </p>
          )}

          {music.queueFinished && (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <span className="text-[11px] text-ink-faint">Queue finished</span>
              <button
                type="button"
                onClick={music.replay}
                className="rounded-full bg-[var(--control)] px-3 py-1 text-[11px] font-medium text-ink transition-colors hover:bg-[var(--control-hover)]"
              >
                Replay
              </button>
              <button
                type="button"
                onClick={() => document.getElementById("music-search")?.focus()}
                className="rounded-full bg-[var(--control)] px-3 py-1 text-[11px] font-medium text-ink transition-colors hover:bg-[var(--control-hover)]"
              >
                Search music
              </button>
            </div>
          )}

          <div className="mt-3">
            <PlayerControls />
          </div>

          <p className="mt-3 border-t border-hairline pt-2.5 text-[11px] text-ink-faint">
            {mode === "video" ? (
              <>
                Video plays here.{" "}
                <Link href="/music" className="underline underline-offset-2">
                  Music
                </Link>{" "}
                is the audio-only surface.
              </>
            ) : (
              <>
                Audio only — no video on this page.{" "}
                <Link href="/yt" className="underline underline-offset-2">
                  Open in YouTube view
                </Link>{" "}
                to watch.
              </>
            )}
          </p>
        </div>
      </Card>
    </div>
  );
}

/**
 * A supporting module that has nothing in it yet.
 *
 * One quiet line, not a centred illustration block: these cards sit in a narrow
 * column beside the real work, and a full empty state in each would open three
 * holes down the page for no information at all.
 */
function Quiet({ children }: { children: ReactNode }) {
  return <p className="px-5 pb-1 text-xs text-ink-faint">{children}</p>;
}

/** A quiet on/off switch, in the same segmented language as the rest of Cowork. */
function Toggle({
  on,
  onChange,
  hint,
  children,
}: {
  on: boolean;
  onChange: (v: boolean) => void;
  hint: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      title={hint}
      onClick={() => onChange(!on)}
      className={`rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors focus-visible:ring-2 focus-visible:ring-ink focus-visible:outline-none ${
        on
          ? "bg-[var(--control-active)] text-ink"
          : "text-ink-faint hover:bg-[var(--control)] hover:text-ink-muted"
      }`}
    >
      {children}
    </button>
  );
}

function Collection({
  title,
  items,
  empty,
}: {
  title: string;
  items: MusicResult[];
  empty: string;
}) {
  return (
    <Card title={title} padded={false}>
      {items.length === 0 ? (
        <Quiet>{empty}</Quiet>
      ) : (
        <ul aria-label={title} className="@container divide-y divide-hairline">
          {items.slice(0, 8).map((item) => (
            <ResultRow key={item.id} item={item} />
          ))}
        </ul>
      )}
    </Card>
  );
}
