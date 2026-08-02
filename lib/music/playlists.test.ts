import assert from "node:assert/strict";
import { test } from "node:test";
import {
  NAME_PROBLEM_MESSAGE,
  PLAYLIST_LIMITS,
  addTrack,
  createPlaylist,
  deletePlaylist,
  moveTrack,
  nameProblem,
  playlistsHolding,
  removeTrack,
  renamePlaylist,
} from "./playlists.ts";
import type { MusicPlaylist, MusicResult } from "../domain/music.ts";

/**
 * Playlist rules.
 *
 * Each of these is something a person would notice going wrong: a track added
 * twice, two playlists with the same name, a rename that quietly did nothing,
 * a reorder that dropped a song. Pure functions, so `node --test` runs them
 * with no build step and no DOM.
 */

const NOW = "2026-08-02T09:00:00.000Z";
const LATER = "2026-08-02T10:00:00.000Z";

function track(id: string, title = `Track ${id}`): MusicResult {
  return {
    id,
    title,
    channelTitle: "Someone",
    channelId: "UC0",
    thumbnails: { small: "s.jpg", medium: "m.jpg" },
    durationSecs: 200,
    publishedAt: null,
    embeddable: true,
    liveState: "none",
    categoryId: "10",
    viewCount: null,
    sourceHints: [],
    url: `https://www.youtube.com/watch?v=${id}`,
  };
}

function seed(name: string, ids: string[] = []): MusicPlaylist {
  return {
    id: `pl-${name}`,
    name,
    items: ids.map((i) => track(i)),
    createdAt: NOW,
    updatedAt: NOW,
  };
}

/* ── Naming ───────────────────────────────────────────────────────────────── */

test("a name of nothing but spaces is not a name", () => {
  assert.equal(nameProblem([], "   "), "empty");
  assert.equal(nameProblem([], ""), "empty");
  assert.equal(nameProblem([], "Morning"), null);
});

test("names collide case-insensitively, and a playlist never collides with itself", () => {
  const list = [seed("Morning")];
  assert.equal(nameProblem(list, "morning"), "duplicate");
  assert.equal(nameProblem(list, "  MORNING  "), "duplicate");
  /* Renaming "Morning" to "Morning" is a no-op, not a clash. */
  assert.equal(nameProblem(list, "Morning", "pl-Morning"), null);
});

test("the length limit is stated in the message the reader sees", () => {
  const long = "x".repeat(PLAYLIST_LIMITS.nameLength + 1);
  assert.equal(nameProblem([], long), "too_long");
  assert.ok(
    NAME_PROBLEM_MESSAGE.too_long.includes(String(PLAYLIST_LIMITS.nameLength)),
    "the refusal must name the actual limit",
  );
});

/* ── Creating ─────────────────────────────────────────────────────────────── */

test("a new playlist is trimmed, empty and first in the list", () => {
  const before = [seed("Old")];
  const { playlists, created } = createPlaylist(before, "  Deep work  ", {
    id: "pl-1",
    now: LATER,
  });
  assert.equal(created?.name, "Deep work");
  assert.deepEqual(created?.items, []);
  assert.equal(created?.createdAt, LATER);
  assert.equal(playlists[0].id, "pl-1", "newest first");
  assert.equal(playlists.length, 2);
  assert.deepEqual(before, [seed("Old")], "the input list is untouched");
});

test("a rejected name creates nothing and changes nothing", () => {
  const before = [seed("Morning")];
  for (const bad of ["", "   ", "morning"]) {
    const { playlists, created } = createPlaylist(before, bad, {
      id: "pl-2",
      now: LATER,
    });
    assert.equal(created, null, `"${bad}" should be refused`);
    assert.equal(playlists, before, "the same list is handed back");
  }
});

test("the playlist count has a ceiling", () => {
  const full = Array.from({ length: PLAYLIST_LIMITS.playlists }, (_, i) =>
    seed(`P${i}`),
  );
  const { created } = createPlaylist(full, "One more", {
    id: "pl-x",
    now: LATER,
  });
  assert.equal(created, null);
});

/* ── Renaming and deleting ────────────────────────────────────────────────── */

test("renaming trims, stamps and leaves the tracks alone", () => {
  const before = [seed("Morning", ["a", "b"])];
  const after = renamePlaylist(before, "pl-Morning", "  Evening ", LATER);
  assert.equal(after[0].name, "Evening");
  assert.equal(after[0].updatedAt, LATER);
  assert.equal(after[0].items.length, 2);
  assert.equal(before[0].name, "Morning", "the input is untouched");
});

test("renaming onto another playlist's name is refused", () => {
  const before = [seed("Morning"), seed("Evening")];
  const after = renamePlaylist(before, "pl-Morning", "evening", LATER);
  assert.equal(after, before);
});

test("deleting removes one playlist and only that one", () => {
  const after = deletePlaylist([seed("A"), seed("B")], "pl-A");
  assert.deepEqual(
    after.map((p) => p.name),
    ["B"],
  );
});

/* ── Tracks ───────────────────────────────────────────────────────────────── */

test("a track is added once; adding it again says so rather than duplicating", () => {
  const first = addTrack([seed("Morning")], "pl-Morning", track("a"), LATER);
  assert.equal(first.added, true);
  assert.equal(first.playlists[0].items.length, 1);
  assert.equal(first.playlists[0].updatedAt, LATER);

  const again = addTrack(first.playlists, "pl-Morning", track("a"), LATER);
  assert.equal(again.added, false);
  assert.equal(again.playlists[0].items.length, 1);
});

test("adding to a playlist that is not there is a no-op, not a crash", () => {
  const before = [seed("Morning")];
  const r = addTrack(before, "pl-ghost", track("a"), LATER);
  assert.equal(r.added, false);
  assert.equal(r.playlists, before);
});

test("tracks append in the order they were added", () => {
  let list = [seed("Morning")];
  for (const id of ["a", "b", "c"]) {
    list = addTrack(list, "pl-Morning", track(id), LATER).playlists;
  }
  assert.deepEqual(
    list[0].items.map((t) => t.id),
    ["a", "b", "c"],
  );
});

test("a full playlist refuses the next track", () => {
  const full = seed("Morning");
  full.items = Array.from({ length: PLAYLIST_LIMITS.tracks }, (_, i) =>
    track(`t${i}`),
  );
  const r = addTrack([full], "pl-Morning", track("one-more"), LATER);
  assert.equal(r.added, false);
});

test("removing takes out the named track and nothing else", () => {
  const after = removeTrack(
    [seed("Morning", ["a", "b", "c"])],
    "pl-Morning",
    "b",
    LATER,
  );
  assert.deepEqual(
    after[0].items.map((t) => t.id),
    ["a", "c"],
  );
  assert.equal(after[0].updatedAt, LATER);
});

test("reordering moves one track and keeps the rest", () => {
  const after = moveTrack(
    [seed("Morning", ["a", "b", "c"])],
    "pl-Morning",
    2,
    0,
    LATER,
  );
  assert.deepEqual(
    after[0].items.map((t) => t.id),
    ["c", "a", "b"],
  );
});

test("an out-of-range move changes nothing", () => {
  const before = [seed("Morning", ["a", "b"])];
  for (const [from, to] of [
    [0, 5],
    [-1, 0],
    [1, 1],
    [9, 0],
  ]) {
    const after = moveTrack(before, "pl-Morning", from, to, LATER);
    assert.deepEqual(
      after[0].items.map((t) => t.id),
      ["a", "b"],
      `move ${from}→${to} should be a no-op`,
    );
  }
});

/* ── Membership ───────────────────────────────────────────────────────────── */

test("membership reports every playlist holding the track", () => {
  const list = [
    seed("Morning", ["a", "b"]),
    seed("Evening", ["b"]),
    seed("Focus", []),
  ];
  assert.deepEqual([...playlistsHolding(list, "b")].sort(), [
    "pl-Evening",
    "pl-Morning",
  ]);
  assert.deepEqual([...playlistsHolding(list, "zzz")], []);
});
