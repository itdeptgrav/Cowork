import type { MusicPlaylist, MusicResult } from "@/lib/domain";

/**
 * The rules a playlist obeys, as pure functions over a list.
 *
 * They live apart from storage and apart from React on purpose: every one of
 * these is a decision a person will notice — whether adding a track they
 * already added silently duplicates it, whether two playlists may share a
 * name, what happens when a name is nothing but spaces — and decisions people
 * notice should be testable without a browser or a render.
 *
 * Every function returns a NEW list and never mutates its argument, so the
 * caller can hand the result straight to `setState` and the store can write it
 * without wondering who else is holding a reference.
 *
 * Identity and time come in as arguments rather than being read here. A pure
 * module that calls `Date.now()` is not pure, and a test that has to guess a
 * timestamp is a test that fails on a slow machine.
 */

export const PLAYLIST_LIMITS = {
  /** Per person. Past this the list stops being something you can scan. */
  playlists: 50,
  /** Per playlist. Generous; it exists so storage cannot be filled by accident. */
  tracks: 500,
  nameLength: 60,
} as const;

/** What a name has to be before it can be a playlist. */
export type NameProblem = "empty" | "too_long" | "duplicate";

export function nameProblem(
  playlists: MusicPlaylist[],
  name: string,
  /** Ignored when renaming — a playlist never collides with itself. */
  exceptId?: string,
): NameProblem | null {
  const trimmed = name.trim();
  if (!trimmed) return "empty";
  if (trimmed.length > PLAYLIST_LIMITS.nameLength) return "too_long";
  const clash = playlists.some(
    (p) => p.id !== exceptId && p.name.toLowerCase() === trimmed.toLowerCase(),
  );
  return clash ? "duplicate" : null;
}

/**
 * Copy for a rejected name.
 *
 * Written here rather than in the component so the help article can quote the
 * sentence a reader actually sees — a help entry that paraphrases a refusal is
 * hard to match against the screen.
 */
export const NAME_PROBLEM_MESSAGE: Record<NameProblem, string> = {
  empty: "Give the playlist a name.",
  too_long: `Keep the name to ${PLAYLIST_LIMITS.nameLength} characters or fewer.`,
  duplicate: "You already have a playlist with that name.",
};

export function createPlaylist(
  playlists: MusicPlaylist[],
  name: string,
  meta: { id: string; now: string },
): { playlists: MusicPlaylist[]; created: MusicPlaylist | null } {
  if (nameProblem(playlists, name)) return { playlists, created: null };
  if (playlists.length >= PLAYLIST_LIMITS.playlists)
    return { playlists, created: null };

  const created: MusicPlaylist = {
    id: meta.id,
    name: name.trim(),
    items: [],
    createdAt: meta.now,
    updatedAt: meta.now,
  };
  /* Newest first. A playlist made two seconds ago is the one being filled. */
  return { playlists: [created, ...playlists], created };
}

export function renamePlaylist(
  playlists: MusicPlaylist[],
  id: string,
  name: string,
  now: string,
): MusicPlaylist[] {
  if (nameProblem(playlists, name, id)) return playlists;
  return playlists.map((p) =>
    p.id === id ? { ...p, name: name.trim(), updatedAt: now } : p,
  );
}

export function deletePlaylist(
  playlists: MusicPlaylist[],
  id: string,
): MusicPlaylist[] {
  return playlists.filter((p) => p.id !== id);
}

/**
 * Add a track, unless it is already there.
 *
 * `added: false` is a real answer and the caller says so out loud. Silently
 * doing nothing would read as a broken button, and silently adding a second
 * copy would make the same track come round twice with no way to tell which
 * row to remove.
 */
export function addTrack(
  playlists: MusicPlaylist[],
  id: string,
  item: MusicResult,
  now: string,
): { playlists: MusicPlaylist[]; added: boolean } {
  const target = playlists.find((p) => p.id === id);
  if (!target) return { playlists, added: false };
  if (target.items.some((t) => t.id === item.id))
    return { playlists, added: false };
  if (target.items.length >= PLAYLIST_LIMITS.tracks)
    return { playlists, added: false };

  return {
    playlists: playlists.map((p) =>
      p.id === id ? { ...p, items: [...p.items, item], updatedAt: now } : p,
    ),
    added: true,
  };
}

export function removeTrack(
  playlists: MusicPlaylist[],
  id: string,
  trackId: string,
  now: string,
): MusicPlaylist[] {
  return playlists.map((p) =>
    p.id === id
      ? {
          ...p,
          items: p.items.filter((t) => t.id !== trackId),
          updatedAt: now,
        }
      : p,
  );
}

/** Reorder within a playlist. An out-of-range move is a no-op, not a throw. */
export function moveTrack(
  playlists: MusicPlaylist[],
  id: string,
  from: number,
  to: number,
  now: string,
): MusicPlaylist[] {
  return playlists.map((p) => {
    if (p.id !== id) return p;
    if (from === to) return p;
    if (from < 0 || from >= p.items.length) return p;
    if (to < 0 || to >= p.items.length) return p;
    const items = [...p.items];
    const [moved] = items.splice(from, 1);
    items.splice(to, 0, moved);
    return { ...p, items, updatedAt: now };
  });
}

/** Which playlists already hold this track — the ticks in the add dialog. */
export function playlistsHolding(
  playlists: MusicPlaylist[],
  trackId: string,
): Set<string> {
  return new Set(
    playlists.filter((p) => p.items.some((t) => t.id === trackId)).map((p) => p.id),
  );
}
