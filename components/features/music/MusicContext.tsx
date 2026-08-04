"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  DEFAULT_MUSIC_PREFERENCES,
  type MusicErrorCode,
  type MusicPage,
  type MusicPlaylist,
  type MusicPreferences,
  type MusicResult,
} from "@/lib/domain";
import { getRepository } from "@/lib/repositories";
import {
  pickLocally,
  autoplayQuery,
  type AutoplaySources,
} from "@/lib/music/autoplay";
import { playlistsHolding } from "@/lib/music/playlists";

/**
 * All music state, held above the router so playback survives navigation.
 *
 * The provider is mounted in the app shell, not in `/music`. That is the whole
 * mechanism behind "keep playing while I move around Cowork": the route subtree
 * unmounts, this does not, and the single iframe lives in a shell-owned element
 * that is never removed from the document — it only changes size and position.
 *
 * Nothing in here is reported anywhere. No scoring, no attendance, no timers,
 * no manager surface — see `lib/domain/music.ts`.
 */

/**
 * What to show when a search fails.
 *
 * A server-shaped failure carries copy written for a person. A transport
 * failure carries whatever the browser threw — "Failed to fetch" — which is a
 * diagnostic, not a sentence, and never belongs in front of a reader.
 */
function searchFailure(e: unknown): { code: MusicErrorCode; message: string } {
  const err = e as Error & { code?: MusicErrorCode };
  return err.code
    ? { code: err.code, message: err.message }
    : {
        code: "network",
        message:
          "Cowork could not reach the music service. Check your connection and try again.",
      };
}

interface StartHereState {
  status: "idle" | "loading" | "ready" | "error";
  items: MusicResult[];
}

const EMPTY_START_HERE: StartHereState = { status: "idle", items: [] };

interface SearchState {
  query: string;
  status: "idle" | "searching" | "loading_more" | "ready" | "empty" | "error";
  items: MusicResult[];
  nextPageToken: string | null;
  cached: boolean;
  errorCode: MusicErrorCode | null;
  errorMessage: string | null;
}

const EMPTY_SEARCH: SearchState = {
  query: "",
  status: "idle",
  items: [],
  nextPageToken: null,
  cached: false,
  errorCode: null,
  errorMessage: null,
};

interface MusicValue {
  enabled: boolean;
  search: SearchState;
  runSearch(q: string): Promise<void>;
  loadMore(): Promise<void>;
  clearSearch(): void;

  recentSearches: string[];
  clearRecentSearches(): void;

  /**
   * Real thumbnail cards for the "Start here" panel, rather than plain text
   * prompts. Loaded on demand — never on mount — because each distinct query
   * is a real 100-unit search; `loadStartHere` is a no-op if it already
   * fetched the exact same query set, so navigating away and back doesn't
   * re-spend quota. Results are shared across everyone hitting this Node
   * process for 30 minutes by the same `searchCache` every other search uses
   * (`lib/music/youtube.ts`), so a fixed preset only ever costs quota once
   * per window regardless of how many people load the page.
   */
  startHere: StartHereState;
  loadStartHere(queries: string[]): Promise<void>;

  favourites: MusicResult[];
  isFavourite(id: string): boolean;
  toggleFavourite(item: MusicResult): Promise<void>;
  recentlyPlayed: MusicResult[];

  /**
   * Named lists, newest activity first.
   *
   * Separate from favourites on purpose: a favourite is one flat set with no
   * order, a playlist is a sequence somebody chose. The rules — naming,
   * duplicates, limits — live in `lib/music/playlists.ts`; this only holds the
   * state and says what happened.
   */
  playlists: MusicPlaylist[];
  /**
   * Null when the name was refused. Callers check `nameProblem` from
   * `lib/music/playlists` first so the reader is told why before they submit;
   * this returning null is the backstop, not the error channel.
   */
  createPlaylist(name: string): Promise<MusicPlaylist | null>;
  renamePlaylist(id: string, name: string): Promise<boolean>;
  deletePlaylist(id: string): Promise<void>;
  /** False when the track was already in that playlist — the UI says so. */
  addToPlaylist(id: string, item: MusicResult): Promise<boolean>;
  removeFromPlaylist(id: string, trackId: string): Promise<void>;
  movePlaylistTrack(id: string, from: number, to: number): Promise<void>;
  /** Replace the queue with this playlist and start at its first track. */
  playPlaylist(id: string): void;
  /** Append this playlist to whatever is already queued. */
  queuePlaylist(id: string): void;
  /** Which playlists already hold a given track. */
  playlistsWith(trackId: string): Set<string>;

  queue: MusicResult[];
  currentIndex: number;
  current: MusicResult | null;
  playNow(item: MusicResult): void;
  enqueue(item: MusicResult): void;
  removeAt(index: number): void;
  moveItem(from: number, to: number): void;
  clearQueue(): void;
  next(): void;
  previous(): void;
  /** Play the current track again from the start. */
  replay(): void;

  /**
   * The queue ran out and nothing replaced it. A named state rather than an
   * absence, because "it stopped" has to look deliberate.
   */
  queueFinished: boolean;

  prefs: MusicPreferences;
  setPrefs(patch: Partial<MusicPreferences>): void;

  /** How the current track was chosen. Named so provenance is never implied. */
  autoplayNotice: string | null;
  /** Set by the player host so other surfaces can reflect real state. */
  reportPlaying(playing: boolean): void;
  playing: boolean;
  /** Requested transport intent, consumed by the player host. */
  intent: { action: "play" | "pause" | "replay" | "none"; nonce: number };
  requestPlay(): void;
  requestPause(): void;

  /**
   * Where the video should be drawn.
   *
   * `/music` registers a rectangle and the player fills it; with no rectangle
   * registered the player falls back to the compact bar. The iframe itself
   * never moves in the DOM — only this changes.
   */
  stage: DOMRect | null;
  registerStage(el: HTMLElement | null): void;
}

const Ctx = createContext<MusicValue | null>(null);

export function MusicProvider({
  enabled,
  children,
}: {
  enabled: boolean;
  children: ReactNode;
}) {
  const [search, setSearch] = useState<SearchState>(EMPTY_SEARCH);
  const [recentSearches, setRecentSearches] = useState<string[]>([]);
  const [favourites, setFavourites] = useState<MusicResult[]>([]);
  const [recentlyPlayed, setRecentlyPlayed] = useState<MusicResult[]>([]);
  const [playlists, setPlaylists] = useState<MusicPlaylist[]>([]);
  const [queue, setQueue] = useState<MusicResult[]>([]);
  const [currentIndex, setCurrentIndex] = useState(-1);
  const [prefs, setPrefsState] = useState<MusicPreferences>(
    DEFAULT_MUSIC_PREFERENCES,
  );
  const [autoplayNotice, setAutoplayNotice] = useState<string | null>(null);
  const [queueFinished, setQueueFinished] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [intent, setIntent] = useState<{
    action: "play" | "pause" | "replay" | "none";
    nonce: number;
  }>({ action: "none", nonce: 0 });
  const [hydrated, setHydrated] = useState(false);
  const [stage, setStage] = useState<DOMRect | null>(null);
  const [startHere, setStartHere] = useState<StartHereState>(EMPTY_START_HERE);
  /* The query set already fetched (or in flight), so `loadStartHere` called
     again with the same set — e.g. a remount from switching /music ↔ /yt —
     is a no-op rather than a second round of 100-unit searches. */
  const startHereKeyRef = useRef<string | null>(null);

  /* Everything the session has seen, for Cowork Autoplay's free tiers. */
  const seenRef = useRef<MusicResult[]>([]);
  const playedIdsRef = useRef<Set<string>>(new Set());
  const abortRef = useRef<AbortController | null>(null);

  const current = currentIndex >= 0 ? (queue[currentIndex] ?? null) : null;

  /* ── Hydrate from the repository once ────────────────────────────────── */
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const r = getRepository();
    /* `Promise.all` is not enough on its own: a repository method that throws
       SYNCHRONOUSLY throws while the array is being built, before there is a
       promise to reject, and that escapes the effect and blanks the shell. */
    const read = <T,>(f: () => Promise<T>, fallback: T): Promise<T> => {
      try {
        return Promise.resolve(f()).catch(() => fallback);
      } catch {
        return Promise.resolve(fallback);
      }
    };
    Promise.all([
      read(() => r.getMusicQueue(), { items: [], currentIndex: -1 }),
      read(() => r.listMusicFavourites(), []),
      read(() => r.listMusicSearches(), []),
      read(() => r.listMusicPlayed(), []),
      read(() => r.getMusicPreferences(), DEFAULT_MUSIC_PREFERENCES),
      read(() => r.listMusicPlaylists(), []),
    ]).then(([q, favs, searches, played, p, lists]) => {
      if (cancelled) return;
      setQueue(q.items);
      setCurrentIndex(q.currentIndex);
      setFavourites(favs);
      setRecentSearches(searches);
      setRecentlyPlayed(played);
      setPrefsState(p);
      setPlaylists(lists);
      /* Playlist tracks count as "seen", so Cowork Autoplay can reach for
         something the person deliberately kept before it spends any quota. */
      seenRef.current = [
        ...q.items,
        ...favs,
        ...played,
        ...lists.flatMap((l) => l.items),
      ];
      setHydrated(true);
    });
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  /* ── Persist the queue whenever it settles ─────────────────────────────
     Guarded for the same reason as `markPlayed`: this runs inside an effect,
     so a repository that throws would take the whole application down rather
     than lose a saved queue. */
  useEffect(() => {
    if (!hydrated) return;
    try {
      Promise.resolve(
        getRepository().saveMusicQueue({ items: queue, currentIndex }),
      ).catch(() => {});
    } catch {
      /* Session-only from here. Better than a blank page. */
    }
  }, [queue, currentIndex, hydrated]);

  /* ── Follow the stage element while it moves ──────────────────────────────
     `/music` puts a placeholder in the page and the fixed player is drawn over
     it. The placeholder is sticky, so it stays on screen while the page
     scrolls; this keeps the two in agreement through scroll, resize and any
     layout change beneath it. */
  const stageElRef = useRef<HTMLElement | null>(null);
  const [staged, setStaged] = useState(false);
  const registerStage = useCallback((el: HTMLElement | null) => {
    stageElRef.current = el;
    setStaged(!!el);
    setStage(el ? el.getBoundingClientRect() : null);
  }, []);

  useEffect(() => {
    if (!staged) return;
    /* Polled with rAF rather than driven by scroll events.
       Which element scrolls is not something this can afford to be wrong
       about — a page, a pane or a sticky container each dispatch differently,
       and a missed event leaves the video parked where the page used to be.
       A rect read per frame, only while `/music` is open, is the cheap and
       certain version of the same thing. */
    let frame = 0;
    const tick = () => {
      const node = stageElRef.current;
      if (node) {
        const next = node.getBoundingClientRect();
        setStage((prev) =>
          prev &&
          prev.top === next.top &&
          prev.left === next.left &&
          prev.width === next.width &&
          prev.height === next.height
            ? prev
            : next,
        );
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);

    /* rAF is suspended while a tab is hidden, and a layout can still change in
       that state — a resize, a restored window, a bfcache return. These cover
       the gap; they are cheap because `sync` only writes when the rect moved. */
    const sync = () => {
      const node = stageElRef.current;
      if (!node) return;
      const next = node.getBoundingClientRect();
      setStage((prev) =>
        prev &&
        prev.top === next.top &&
        prev.left === next.left &&
        prev.width === next.width &&
        prev.height === next.height
          ? prev
          : next,
      );
    };
    window.addEventListener("scroll", sync, { passive: true, capture: true });
    window.addEventListener("resize", sync, { passive: true });
    document.addEventListener("visibilitychange", sync);
    const ro = new ResizeObserver(sync);
    if (stageElRef.current) ro.observe(stageElRef.current);

    return () => {
      cancelAnimationFrame(frame);
      ro.disconnect();
      window.removeEventListener("scroll", sync, { capture: true });
      window.removeEventListener("resize", sync);
      document.removeEventListener("visibilitychange", sync);
    };
  }, [staged]);

  const remember = useCallback((items: MusicResult[]) => {
    const byId = new Map(seenRef.current.map((r) => [r.id, r]));
    for (const i of items) byId.set(i.id, i);
    seenRef.current = [...byId.values()].slice(-400);
  }, []);

  /* ── Search ──────────────────────────────────────────────────────────── */
  const fetchPage = useCallback(
    async (q: string, pageToken: string | null): Promise<MusicPage> => {
      abortRef.current?.abort();
      const ac = new AbortController();
      abortRef.current = ac;

      const url = new URL("/api/music/search", window.location.origin);
      url.searchParams.set("q", q);
      if (pageToken) url.searchParams.set("pageToken", pageToken);

      const res = await fetch(url, { signal: ac.signal });
      const body: unknown = await res.json().catch(() => null);
      if (!res.ok) {
        const e = (body ?? {}) as { error?: MusicErrorCode; message?: string };
        const err = new Error(e.message ?? "Search failed") as Error & {
          code?: MusicErrorCode;
        };
        err.code = e.error ?? "upstream_error";
        throw err;
      }
      return body as MusicPage;
    },
    [],
  );

  /**
   * A standalone fetch for `loadStartHere` — deliberately NOT `fetchPage`.
   * `fetchPage` cancels whatever it previously started via the shared
   * `abortRef`, which is correct for search-as-you-submit (a new query should
   * kill the old one) but wrong here: fetching several preset queries in
   * sequence must not abort the person's own in-progress search if they
   * start typing while the grid is still loading.
   */
  const fetchPreview = useCallback(async (q: string): Promise<MusicPage> => {
    const url = new URL("/api/music/search", window.location.origin);
    url.searchParams.set("q", q);
    const res = await fetch(url);
    const body: unknown = await res.json().catch(() => null);
    if (!res.ok) {
      const e = (body ?? {}) as { message?: string };
      throw new Error(e.message ?? "Search failed");
    }
    return body as MusicPage;
  }, []);

  const loadStartHere = useCallback(
    async (queries: string[]) => {
      const key = queries.join("|");
      if (startHereKeyRef.current === key) return;
      startHereKeyRef.current = key;
      setStartHere({ status: "loading", items: [] });

      /* One at a time — not `Promise.all` — so this never touches the shared
         abort controller `fetchPage` uses and can never race it. Each preset
         is a real search (cached for 30 minutes across everyone, so a fixed
         set only ever costs quota once per window), so there is no reason to
         rush them concurrently either. */
      const collected: MusicResult[] = [];
      for (const q of queries) {
        try {
          const page = await fetchPreview(q);
          collected.push(...page.items.slice(0, 3));
        } catch {
          // One preset failing shouldn't blank the whole grid.
        }
        if (startHereKeyRef.current !== key) return; // superseded mid-flight
      }
      remember(collected);
      setStartHere({
        status: collected.length ? "ready" : "error",
        items: collected,
      });
    },
    [fetchPreview, remember],
  );

  const runSearch = useCallback(
    async (q: string) => {
      const term = q.trim();
      if (term.length < 2) return;
      setSearch({ ...EMPTY_SEARCH, query: term, status: "searching" });

      try {
        const page = await fetchPage(term, null);
        remember(page.items);
        setSearch({
          query: term,
          status: page.items.length ? "ready" : "empty",
          items: page.items,
          nextPageToken: page.nextPageToken,
          cached: page.cached,
          errorCode: null,
          errorMessage: null,
        });
        await getRepository().recordMusicSearch(term);
        setRecentSearches(await getRepository().listMusicSearches());
      } catch (e) {
        if ((e as Error).name === "AbortError") return;
        const { code, message } = searchFailure(e);
        setSearch((s) => ({
          ...s,
          status: "error",
          errorCode: code,
          errorMessage: message,
        }));
      }
    },
    [fetchPage, remember],
  );

  const loadMore = useCallback(async () => {
    if (!search.nextPageToken || search.status === "loading_more") return;
    setSearch((s) => ({ ...s, status: "loading_more" }));
    try {
      const page = await fetchPage(search.query, search.nextPageToken);
      remember(page.items);
      setSearch((s) => ({
        ...s,
        status: "ready",
        items: [...s.items, ...page.items],
        nextPageToken: page.nextPageToken,
      }));
    } catch (e) {
      const { code, message } = searchFailure(e);
      setSearch((s) => ({
        ...s,
        status: "error",
        errorCode: code,
        errorMessage: message,
      }));
    }
  }, [fetchPage, remember, search.nextPageToken, search.query, search.status]);

  const clearSearch = useCallback(() => {
    abortRef.current?.abort();
    setSearch(EMPTY_SEARCH);
  }, []);

  /* ── Queue ───────────────────────────────────────────────────────────── */
  /**
   * Note that a track was played. Bookkeeping, and nothing else.
   *
   * Sealed off from the callers, because it is called from the middle of
   * `playNow` and `next` — BEFORE the play intent is raised. A repository that
   * threw here took the intent down with it: the track changed and nothing
   * ever started, so pressing play looked dead and the queue stopped advancing
   * at the end of every track. A list of what you listened to is not worth a
   * silent player, so a failure here costs the history and nothing more.
   */
  const markPlayed = useCallback((item: MusicResult) => {
    playedIdsRef.current.add(item.id);
    try {
      const r = getRepository();
      Promise.resolve(r.recordMusicPlayed(item))
        .then(() => r.listMusicPlayed())
        .then(setRecentlyPlayed)
        .catch(() => {
          /* The history is not worth interrupting playback for. */
        });
    } catch {
      /* A repository that throws synchronously must not reach the caller. */
    }
  }, []);

  const playNow = useCallback(
    (item: MusicResult) => {
      setAutoplayNotice(null);
      setQueueFinished(false);
      remember([item]);
      setQueue((q) => {
        const existing = q.findIndex((x) => x.id === item.id);
        if (existing >= 0) {
          setCurrentIndex(existing);
          return q;
        }
        const at = currentIndex >= 0 ? currentIndex + 1 : q.length;
        const next = [...q.slice(0, at), item, ...q.slice(at)];
        setCurrentIndex(at);
        return next;
      });
      markPlayed(item);
      setIntent((i) => ({ action: "play", nonce: i.nonce + 1 }));
    },
    [currentIndex, markPlayed, remember],
  );

  const enqueue = useCallback(
    (item: MusicResult) => {
      remember([item]);
      setQueueFinished(false);
      setQueue((q) => (q.some((x) => x.id === item.id) ? q : [...q, item]));
      setCurrentIndex((i) => (i < 0 ? 0 : i));
    },
    [remember],
  );

  const removeAt = useCallback((index: number) => {
    setQueue((q) => q.filter((_, i) => i !== index));
    setCurrentIndex((i) =>
      index < i ? i - 1 : index === i ? Math.min(i, 0) : i,
    );
  }, []);

  const moveItem = useCallback((from: number, to: number) => {
    setQueue((q) => {
      if (to < 0 || to >= q.length || from === to) return q;
      const next = [...q];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
    setCurrentIndex((i) => (i === from ? to : i));
  }, []);

  const clearQueue = useCallback(() => {
    setQueue([]);
    setCurrentIndex(-1);
    setAutoplayNotice(null);
    setQueueFinished(false);
  }, []);

  /**
   * Advance. The manual queue always has priority; Cowork Autoplay only acts
   * once the queue is spent, and stops cleanly when it has nothing reliable.
   */
  const next = useCallback(() => {
    setAutoplayNotice(null);
    if (currentIndex + 1 < queue.length) {
      const item = queue[currentIndex + 1];
      setCurrentIndex(currentIndex + 1);
      setQueueFinished(false);
      markPlayed(item);
      setIntent((i) => ({ action: "play", nonce: i.nonce + 1 }));
      return;
    }

    if (!prefs.autoplay) {
      setQueueFinished(true);
      return;
    }

    const sources: AutoplaySources = {
      seen: seenRef.current,
      favourites,
      recentlyPlayed,
      recentSearches,
      playedIds: playedIdsRef.current,
    };
    const pick = pickLocally(current, sources);
    if (pick) {
      setQueue((q) => [...q, pick.item]);
      setCurrentIndex(queue.length);
      setAutoplayNotice(`Cowork Autoplay · ${pick.reason}`);
      markPlayed(pick.item);
      setIntent((i) => ({ action: "play", nonce: i.nonce + 1 }));
      return;
    }

    /* Last resort: one search, and only if we can name what to search for.
       A hundred quota units is a real cost, so this never fires speculatively. */
    const q = autoplayQuery(current, sources);
    if (!q) {
      setQueueFinished(true);
      setAutoplayNotice(
        "Cowork Autoplay stopped — nothing reliable left to play.",
      );
      return;
    }
    fetchPage(q, null)
      .then((page) => {
        remember(page.items);
        const candidate = page.items.find(
          (r) =>
            r.embeddable !== false &&
            r.liveState === "none" &&
            !playedIdsRef.current.has(r.id),
        );
        if (!candidate) {
          setQueueFinished(true);
          setAutoplayNotice(
            "Cowork Autoplay stopped — nothing reliable left to play.",
          );
          return;
        }
        setQueue((prev) => [...prev, candidate]);
        setCurrentIndex(queue.length);
        setAutoplayNotice(`Cowork Autoplay · searched for ${q}`);
        markPlayed(candidate);
        setIntent((i) => ({ action: "play", nonce: i.nonce + 1 }));
      })
      .catch(() => {
        setQueueFinished(true);
        setAutoplayNotice("Cowork Autoplay stopped — could not reach YouTube.");
      });
  }, [
    current,
    currentIndex,
    favourites,
    fetchPage,
    markPlayed,
    prefs.autoplay,
    queue,
    recentSearches,
    recentlyPlayed,
    remember,
  ]);

  const previous = useCallback(() => {
    setAutoplayNotice(null);
    setQueueFinished(false);
    setCurrentIndex((i) => {
      const at = Math.max(0, i - 1);
      const item = queue[at];
      if (item) {
        markPlayed(item);
        setIntent((x) => ({ action: "play", nonce: x.nonce + 1 }));
      }
      return at;
    });
  }, [markPlayed, queue]);

  const replay = useCallback(() => {
    setQueueFinished(false);
    setIntent((i) => ({ action: "replay", nonce: i.nonce + 1 }));
  }, []);

  /* ── Favourites and preferences ──────────────────────────────────────── */
  const toggleFavourite = useCallback(async (item: MusicResult) => {
    await getRepository().toggleMusicFavourite(item);
    setFavourites(await getRepository().listMusicFavourites());
  }, []);

  const isFavourite = useCallback(
    (id: string) => favourites.some((f) => f.id === id),
    [favourites],
  );

  const setPrefs = useCallback((patch: Partial<MusicPreferences>) => {
    setPrefsState((p) => ({ ...p, ...patch }));
    getRepository().saveMusicPreferences(patch);
  }, []);

  /* ── Playlists ───────────────────────────────────────────────────────────
     Each write goes through the repository and the state is replaced with what
     came back, rather than patched optimistically. The list is small, the store
     is local, and the alternative — two copies of the rules, one here and one
     in `lib/music/playlists.ts` — is exactly the drift that produces a UI
     showing a playlist the storage refused to create. */
  const refreshPlaylists = useCallback(async () => {
    setPlaylists(await getRepository().listMusicPlaylists());
  }, []);

  /* `r?.ok` rather than `r.ok`: a repository is allowed to answer nothing for
     a surface it does not implement, and a thrown TypeError inside a click
     handler is an unhandled rejection with no visible cause. Reading it
     defensively degrades to "that did not happen" instead. */
  const createPlaylist = useCallback(
    async (name: string) => {
      const r = await getRepository().createMusicPlaylist(name);
      await refreshPlaylists();
      return r?.ok ? r.data : null;
    },
    [refreshPlaylists],
  );

  const renamePlaylist = useCallback(
    async (id: string, name: string) => {
      const r = await getRepository().renameMusicPlaylist(id, name);
      await refreshPlaylists();
      return !!r?.ok;
    },
    [refreshPlaylists],
  );

  const deletePlaylist = useCallback(
    async (id: string) => {
      await getRepository().deleteMusicPlaylist(id);
      await refreshPlaylists();
    },
    [refreshPlaylists],
  );

  const addToPlaylist = useCallback(
    async (id: string, item: MusicResult) => {
      remember([item]);
      const r = await getRepository().addToMusicPlaylist(id, item);
      await refreshPlaylists();
      return r?.ok ? r.data : false;
    },
    [refreshPlaylists, remember],
  );

  const removeFromPlaylist = useCallback(
    async (id: string, trackId: string) => {
      await getRepository().removeFromMusicPlaylist(id, trackId);
      await refreshPlaylists();
    },
    [refreshPlaylists],
  );

  const movePlaylistTrack = useCallback(
    async (id: string, from: number, to: number) => {
      await getRepository().moveMusicPlaylistTrack(id, from, to);
      await refreshPlaylists();
    },
    [refreshPlaylists],
  );

  /**
   * Play a playlist: the queue BECOMES the playlist.
   *
   * Not a merge. "Play this playlist" is a statement about what should be
   * playing now, and appending it under whatever was already queued would make
   * the chosen list start in twenty minutes' time. Adding to what is there is
   * the separate, differently-named `queuePlaylist`.
   */
  const playPlaylist = useCallback(
    (id: string) => {
      const list = playlists.find((p) => p.id === id);
      if (!list || list.items.length === 0) return;
      setAutoplayNotice(null);
      setQueueFinished(false);
      remember(list.items);
      setQueue(list.items);
      setCurrentIndex(0);
      markPlayed(list.items[0]);
      setIntent((i) => ({ action: "play", nonce: i.nonce + 1 }));
    },
    [markPlayed, playlists, remember],
  );

  const queuePlaylist = useCallback(
    (id: string) => {
      const list = playlists.find((p) => p.id === id);
      if (!list || list.items.length === 0) return;
      setQueueFinished(false);
      remember(list.items);
      setQueue((q) => {
        const have = new Set(q.map((x) => x.id));
        return [...q, ...list.items.filter((t) => !have.has(t.id))];
      });
      setCurrentIndex((i) => (i < 0 ? 0 : i));
    },
    [playlists, remember],
  );

  const playlistsWith = useCallback(
    (trackId: string) => playlistsHolding(playlists, trackId),
    [playlists],
  );

  const value = useMemo<MusicValue>(
    () => ({
      enabled,
      search,
      runSearch,
      loadMore,
      clearSearch,
      recentSearches,
      clearRecentSearches: () => {
        getRepository().clearMusicSearches();
        setRecentSearches([]);
      },
      startHere,
      loadStartHere,
      favourites,
      isFavourite,
      toggleFavourite,
      recentlyPlayed,
      playlists,
      createPlaylist,
      renamePlaylist,
      deletePlaylist,
      addToPlaylist,
      removeFromPlaylist,
      movePlaylistTrack,
      playPlaylist,
      queuePlaylist,
      playlistsWith,
      queue,
      currentIndex,
      current,
      playNow,
      enqueue,
      removeAt,
      moveItem,
      clearQueue,
      next,
      previous,
      replay,
      queueFinished,
      prefs,
      setPrefs,
      autoplayNotice,
      reportPlaying: setPlaying,
      playing,
      intent,
      requestPlay: () =>
        setIntent((i) => ({ action: "play", nonce: i.nonce + 1 })),
      requestPause: () =>
        setIntent((i) => ({ action: "pause", nonce: i.nonce + 1 })),
      stage,
      registerStage,
    }),
    [
      addToPlaylist,
      autoplayNotice,
      clearQueue,
      clearSearch,
      createPlaylist,
      current,
      currentIndex,
      deletePlaylist,
      enabled,
      enqueue,
      favourites,
      intent,
      isFavourite,
      loadMore,
      loadStartHere,
      moveItem,
      movePlaylistTrack,
      next,
      playNow,
      playPlaylist,
      playing,
      playlists,
      playlistsWith,
      prefs,
      previous,
      queue,
      queueFinished,
      queuePlaylist,
      recentSearches,
      recentlyPlayed,
      registerStage,
      removeAt,
      removeFromPlaylist,
      renamePlaylist,
      replay,
      runSearch,
      search,
      setPrefs,
      stage,
      startHere,
      toggleFavourite,
    ],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useMusic(): MusicValue {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useMusic must be used inside <MusicProvider>");
  return ctx;
}
