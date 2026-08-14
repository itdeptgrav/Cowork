import {
  DEFAULT_MUSIC_PREFERENCES,
  type MusicPlaylist,
  type MusicPreferences,
  type MusicQueue,
  type MusicResult,
} from "@/lib/domain";
import {
  addTrack,
  createPlaylist,
  deletePlaylist,
  moveTrack,
  removeTrack,
  renamePlaylist,
} from "../../music/playlists.ts";

/**
 * Browser-backed storage for the music module.
 *
 * This is the FIRST persistent state in the prototype — everything else lives
 * in memory and resets on reload. It is namespaced under `cowork-music:` and
 * kept in its own module so it cannot disturb the task/score fixture, and so
 * the boundary is visible rather than remembered.
 *
 * Every read is defensive and every write is best-effort: private browsing,
 * a full quota or a disabled storage API degrades this to session-only rather
 * than throwing into a render.
 *
 * NOTHING HERE IS ANALYTICS. It records what a person chose to keep so their
 * own queue survives a refresh. It is never read by scoring, attendance,
 * timers or any manager-visible surface, and it must not become so.
 */

const NS = "cowork-music:";
const KEY = {
  favourites: `${NS}favourites`,
  queue: `${NS}queue`,
  searches: `${NS}searches`,
  played: `${NS}played`,
  prefs: `${NS}prefs`,
  playlists: `${NS}playlists`,
} as const;

const LIMITS = { favourites: 200, searches: 12, played: 30, queue: 200 };

function read<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed: unknown = JSON.parse(raw);
    return (parsed as T) ?? fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage disabled or full. The in-memory session continues; the user
    // simply loses persistence, which is better than losing the page.
  }
}

/** A stored result could be from an older shape — validate before trusting it. */
function isResult(v: unknown): v is MusicResult {
  if (!v || typeof v !== "object") return false;
  const r = v as Record<string, unknown>;
  return (
    typeof r.id === "string" &&
    typeof r.title === "string" &&
    typeof r.url === "string" &&
    !!r.thumbnails
  );
}

function readResults(key: string): MusicResult[] {
  return read<unknown[]>(key, []).filter(isResult);
}

/** Same defensiveness as a result: a stored playlist is untrusted input. */
function isPlaylist(v: unknown): v is MusicPlaylist {
  if (!v || typeof v !== "object") return false;
  const p = v as Record<string, unknown>;
  return (
    typeof p.id === "string" &&
    typeof p.name === "string" &&
    Array.isArray(p.items)
  );
}

function readPlaylists(): MusicPlaylist[] {
  return read<unknown[]>(KEY.playlists, [])
    .filter(isPlaylist)
    .map((p) => ({
      ...p,
      /* A track that no longer parses is dropped rather than rendered as a
         blank row with no title and no way to play it. */
      items: p.items.filter(isResult),
      createdAt: typeof p.createdAt === "string" ? p.createdAt : "",
      updatedAt: typeof p.updatedAt === "string" ? p.updatedAt : "",
    }));
}

function savePlaylists(next: MusicPlaylist[]): MusicPlaylist[] {
  write(KEY.playlists, next);
  return next;
}

function newId(): string {
  const c = typeof crypto !== "undefined" ? crypto : undefined;
  return c && "randomUUID" in c
    ? c.randomUUID()
    : `pl-${Math.random().toString(36).slice(2, 10)}`;
}

export const musicStore = {
  favourites(): MusicResult[] {
    return readResults(KEY.favourites);
  },

  toggleFavourite(item: MusicResult): boolean {
    /* No item means nothing was toggled — `false`, not a crash. Same reason as
       `recordSearch` and `saveQueue`. */
    if (!item || typeof item.id !== "string") return false;
    const list = readResults(KEY.favourites);
    const at = list.findIndex((f) => f.id === item.id);
    const next =
      at >= 0 ? list.filter((f) => f.id !== item.id) : [item, ...list];
    write(KEY.favourites, next.slice(0, LIMITS.favourites));
    return at < 0;
  },

  queue(): MusicQueue {
    const q = read<MusicQueue>(KEY.queue, { items: [], currentIndex: -1 });
    const items = Array.isArray(q.items) ? q.items.filter(isResult) : [];
    const idx = typeof q.currentIndex === "number" ? q.currentIndex : -1;
    return {
      items,
      currentIndex: idx >= items.length ? items.length - 1 : idx,
    };
  },

  saveQueue(q: MusicQueue): void {
    /* Nothing to save is a no-op, for the same reason as `recordSearch`: this
       is reached from a shell-mounted component, where a throw blanks the
       application rather than one widget. */
    if (!q || !Array.isArray(q.items)) return;
    write(KEY.queue, {
      items: q.items.slice(0, LIMITS.queue),
      currentIndex: q.currentIndex,
    });
  },

  searches(): string[] {
    return read<unknown[]>(KEY.searches, []).filter(
      (s): s is string => typeof s === "string",
    );
  },

  recordSearch(q: string): void {
    /* A missing or non-string query is a no-op, not a crash. This read
       `q.trim()` directly and threw a TypeError on `undefined` — and this store
       is reached from a shell-mounted component, where a rejection escapes and
       blanks the whole application rather than one widget. A search box with
       nothing in it is not an error worth taking the page down for. */
    if (typeof q !== "string") return;
    const term = q.trim();
    if (term.length < 2) return;
    const list = musicStore
      .searches()
      .filter((s) => s.toLowerCase() !== term.toLowerCase());
    write(KEY.searches, [term, ...list].slice(0, LIMITS.searches));
  },

  clearSearches(): void {
    write(KEY.searches, []);
  },

  played(): MusicResult[] {
    return readResults(KEY.played);
  },

  recordPlayed(item: MusicResult): void {
    const list = musicStore.played().filter((p) => p.id !== item.id);
    write(KEY.played, [item, ...list].slice(0, LIMITS.played));
  },

  preferences(): MusicPreferences {
    const p = read<Partial<MusicPreferences>>(KEY.prefs, {});
    return {
      volume:
        typeof p.volume === "number" && p.volume >= 0 && p.volume <= 100
          ? p.volume
          : DEFAULT_MUSIC_PREFERENCES.volume,
      muted:
        typeof p.muted === "boolean"
          ? p.muted
          : DEFAULT_MUSIC_PREFERENCES.muted,
      focusLayout:
        typeof p.focusLayout === "boolean"
          ? p.focusLayout
          : DEFAULT_MUSIC_PREFERENCES.focusLayout,
      autoplay:
        typeof p.autoplay === "boolean"
          ? p.autoplay
          : DEFAULT_MUSIC_PREFERENCES.autoplay,
      railCollapsed:
        typeof p.railCollapsed === "boolean"
          ? p.railCollapsed
          : DEFAULT_MUSIC_PREFERENCES.railCollapsed,
    };
  },

  savePreferences(patch: Partial<MusicPreferences>): MusicPreferences {
    const next = { ...musicStore.preferences(), ...patch };
    write(KEY.prefs, next);
    return next;
  },

  /* ── Playlists ──────────────────────────────────────────────────────────
     Every rule — naming, duplicates, ordering, limits — lives in
     `lib/music/playlists.ts` and is tested there. This layer only supplies the
     two things a pure function cannot have: an id and a clock. */

  playlists(): MusicPlaylist[] {
    return readPlaylists();
  },

  createPlaylist(name: string): MusicPlaylist | null {
    const { playlists, created } = createPlaylist(readPlaylists(), name, {
      id: newId(),
      now: new Date().toISOString(),
    });
    if (created) savePlaylists(playlists);
    return created;
  },

  renamePlaylist(id: string, name: string): MusicPlaylist[] {
    return savePlaylists(
      renamePlaylist(readPlaylists(), id, name, new Date().toISOString()),
    );
  },

  deletePlaylist(id: string): MusicPlaylist[] {
    return savePlaylists(deletePlaylist(readPlaylists(), id));
  },

  addToPlaylist(id: string, item: MusicResult): boolean {
    const { playlists, added } = addTrack(
      readPlaylists(),
      id,
      item,
      new Date().toISOString(),
    );
    if (added) savePlaylists(playlists);
    return added;
  },

  removeFromPlaylist(id: string, trackId: string): MusicPlaylist[] {
    return savePlaylists(
      removeTrack(readPlaylists(), id, trackId, new Date().toISOString()),
    );
  },

  movePlaylistTrack(id: string, from: number, to: number): MusicPlaylist[] {
    return savePlaylists(
      moveTrack(readPlaylists(), id, from, to, new Date().toISOString()),
    );
  },
};
