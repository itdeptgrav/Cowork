import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CONFIDENCE_FLOOR,
  authorityOf,
  classify,
  hasMusicEvidence,
  parseTitle,
  rank,
  rankWithScores,
} from "./rank.ts";
import type { MusicResult } from "../domain/music.ts";

/**
 * Ranking regression tests.
 *
 * The fixture is the real shape of a YouTube search for "ghost" — the case that
 * was wrong: an official VEVO release competing with identically-titled tracks
 * from unknown channels, a film trailer filed under Music, a Short, a live
 * cover and a three-hour mix. Everything here is metadata that `videos.list`
 * actually returns, so a passing test means the production path would behave
 * the same way.
 *
 * Run with `npm test` (plain `node --test`; no build step, no mocks).
 */

function result(
  over: Partial<MusicResult> & { id: string; title: string },
): MusicResult {
  return {
    channelTitle: "Unknown Channel",
    channelId: "UC0",
    thumbnails: {
      small: `https://i.ytimg.com/vi/${over.id}/default.jpg`,
      medium: `https://i.ytimg.com/vi/${over.id}/mqdefault.jpg`,
    },
    durationSecs: 213,
    publishedAt: "2021-10-08T04:00:07Z",
    embeddable: true,
    liveState: "none",
    categoryId: "10",
    viewCount: 10_000,
    sourceHints: [],
    url: `https://www.youtube.com/watch?v=${over.id}`,
    ...over,
  };
}

/* The official release. */
const BIEBER_VEVO = result({
  id: "m7Bc3pLyij0",
  title: "Justin Bieber - Ghost",
  channelTitle: "JustinBieberVEVO",
  channelId: "UCHkj014U2CQ2Nv0UZeYpE_A",
  durationSecs: 213,
  viewCount: 780_000_000,
});

/* The same recording, released as audio on the auto-generated artist channel. */
const BIEBER_TOPIC = result({
  id: "topic01",
  title: "Ghost",
  channelTitle: "Justin Bieber - Topic",
  durationSecs: 273,
  viewCount: 21_000_000,
});

/* An official visualiser — legitimate, ranks under the main release. */
const BIEBER_VISUALISER = result({
  id: "vis01",
  title: "Justin Bieber - Ghost (Official Visualizer)",
  channelTitle: "JustinBieberVEVO",
  durationSecs: 212,
  viewCount: 9_400_000,
});

/* Weak exact-title matches: the exact word, nobody behind it. */
const UNKNOWN_GHOST = result({
  id: "weak01",
  title: "Ghost",
  channelTitle: "SoundLab Uploads",
  viewCount: 4_100,
});
const UNKNOWN_GHOST_2 = result({
  id: "weak02",
  title: "Ghost",
  channelTitle: "Free Beats Daily",
  viewCount: 900,
});

/* Not music, filed under Music by its uploader. */
const TRAILER = result({
  id: "trail01",
  title: "GHOST — Official Trailer (2024)",
  channelTitle: "Paramount Pictures",
  durationSecs: 148,
  viewCount: 12_000_000,
});
const REACTION = result({
  id: "react01",
  title: "Justin Bieber - Ghost REACTION!! (first time hearing)",
  channelTitle: "TwoGuysReact",
  viewCount: 400_000,
});

/* A Short. */
const SHORT = result({
  id: "short01",
  title: "Ghost",
  channelTitle: "clipsdaily",
  durationSecs: 28,
  viewCount: 2_000_000,
});

/* A live cover with a real audience — a different request from "ghost", but
   not something the music gate should mistake for a random upload. */
const LIVE_COVER = result({
  id: "cover01",
  title: "Ghost (Justin Bieber Cover) - Live at Abbey Road",
  channelTitle: "Ellie Sings",
  durationSecs: 240,
  viewCount: 1_200_000,
});

/* A file titled like a song by nobody, with nobody watching. The case the
   music-evidence gate exists for. */
const RANDOM_UPLOAD = result({
  id: "rand01",
  title: "Ghost",
  channelTitle: "user827194",
  viewCount: 320,
});

/* Wrong category. */
const PODCAST = result({
  id: "pod01",
  title: "Ghost stories that keep me awake",
  channelTitle: "Night Shift Podcast",
  categoryId: "22",
  durationSecs: 3_400,
  viewCount: 500_000,
});

/* Not embeddable — playable on YouTube, not here. */
const BLOCKED = result({
  id: "block01",
  title: "Ghost",
  channelTitle: "Some Artist - Topic",
  embeddable: false,
  viewCount: 5_000_000,
});

const GHOST_FIXTURE = [
  UNKNOWN_GHOST,
  TRAILER,
  SHORT,
  BIEBER_TOPIC,
  UNKNOWN_GHOST_2,
  LIVE_COVER,
  BIEBER_VEVO,
  PODCAST,
  REACTION,
  BIEBER_VISUALISER,
  BLOCKED,
  RANDOM_UPLOAD,
];

test('"ghost": the official Justin Bieber release ranks first', () => {
  const ranked = rank(GHOST_FIXTURE, "ghost");
  const scores = rankWithScores(GHOST_FIXTURE, "ghost");
  const explain = scores
    .map(
      (s) =>
        `${s.score.toFixed(1)}  ${s.result.title} — ${s.result.channelTitle}`,
    )
    .join("\n");

  assert.equal(
    ranked[0]?.id,
    BIEBER_VEVO.id,
    `expected the VEVO release first, got:\n${explain}`,
  );
});

test('"ghost": weak same-title results rank below the official release', () => {
  const ranked = rank(GHOST_FIXTURE, "ghost");
  const at = (id: string) => ranked.findIndex((r) => r.id === id);

  assert.ok(
    at(BIEBER_VEVO.id) < at(UNKNOWN_GHOST.id) || at(UNKNOWN_GHOST.id) === -1,
  );
  assert.ok(
    at(BIEBER_VEVO.id) < at(UNKNOWN_GHOST_2.id) ||
      at(UNKNOWN_GHOST_2.id) === -1,
  );
});

test('"ghost": the Topic release and the visualiser stay in the results', () => {
  const ids = rank(GHOST_FIXTURE, "ghost").map((r) => r.id);
  assert.ok(
    ids.includes(BIEBER_TOPIC.id),
    "the artist Topic channel release should survive",
  );
  assert.ok(
    ids.includes(BIEBER_VISUALISER.id),
    "the official visualiser should survive",
  );
});

test("trailers, reactions, Shorts, podcasts and blocked videos are removed entirely", () => {
  const ids = rank(GHOST_FIXTURE, "ghost").map((r) => r.id);
  for (const gone of [TRAILER, REACTION, SHORT, PODCAST, BLOCKED]) {
    assert.ok(
      !ids.includes(gone.id),
      `${gone.title} should have been filtered out`,
    );
  }
  assert.equal(classify(TRAILER, "ghost").reason, "not_a_song");
  assert.equal(classify(SHORT, "ghost").reason, "too_short");
  assert.equal(classify(PODCAST, "ghost").reason, "not_music_category");
  assert.equal(classify(BLOCKED, "ghost").reason, "not_embeddable");
});

test("a live cover is not what a bare song query means", () => {
  const ranked = rank(GHOST_FIXTURE, "ghost");
  const cover = ranked.findIndex((r) => r.id === LIVE_COVER.id);
  const official = ranked.findIndex((r) => r.id === BIEBER_VEVO.id);
  assert.ok(
    cover === -1 || cover > official,
    "the live cover must not outrank the release",
  );
});

test("asking for a cover stops penalising covers", () => {
  const withoutAsking = rankWithScores(GHOST_FIXTURE, "ghost").find(
    (s) => s.result.id === LIVE_COVER.id,
  );
  const whenAsked = rankWithScores(GHOST_FIXTURE, "ghost cover").find(
    (s) => s.result.id === LIVE_COVER.id,
  );
  assert.ok(
    whenAsked && withoutAsking && whenAsked.score > withoutAsking.score,
  );
});

test("naming the artist lifts that artist's recording", () => {
  const ranked = rank(GHOST_FIXTURE, "justin bieber ghost");
  assert.equal(ranked[0]?.id, BIEBER_VEVO.id);
});

test("popularity breaks ties but never beats an exact match on an official channel", () => {
  // A wildly popular unrelated track cannot displace the release being searched.
  const loud = result({
    id: "loud01",
    title: "Some Other Song",
    channelTitle: "BigChannelVEVO",
    viewCount: 3_000_000_000,
  });
  const ranked = rank([loud, BIEBER_VEVO], "ghost");
  assert.equal(ranked[0]?.id, BIEBER_VEVO.id);
});

test("low-confidence results are hidden once enough strong ones exist", () => {
  const scores = rankWithScores(GHOST_FIXTURE, "ghost");
  const shown = rank(GHOST_FIXTURE, "ghost");
  const weak = scores.filter((s) => s.score < CONFIDENCE_FLOOR);
  if (scores.filter((s) => s.score >= CONFIDENCE_FLOOR).length >= 3) {
    for (const w of weak) {
      assert.ok(
        !shown.some((r) => r.id === w.result.id),
        `${w.result.title} scored ${w.score.toFixed(1)} and should be hidden`,
      );
    }
  }
});

test("a query that matches no music returns nothing rather than filler", () => {
  const obscure = rank(GHOST_FIXTURE, "a query nothing matches");
  assert.equal(
    obscure.length,
    0,
    "weak rows dressed as an answer are worse than an honest empty state",
  );
});

test('"justin bieber ghost": the artist\'s own channel beats a bigger reupload', () => {
  const REUPLOAD = result({
    id: "reup01",
    title: "Justin Bieber - Ghost",
    channelTitle: "LatinHype",
    durationSecs: 154,
    viewCount: 54_300_000,
  });
  const OWN = result({
    id: "own01",
    title: "Justin Bieber - Ghost (Lyric Video)",
    channelTitle: "Justin Bieber",
    durationSecs: 154,
    viewCount: 1_700_000,
  });
  const ranked = rank([REUPLOAD, OWN], "justin bieber ghost");
  assert.equal(ranked[0]?.id, OWN.id);
});

test("title parsing separates artist from song", () => {
  assert.deepEqual(parseTitle("Justin Bieber - Ghost"), {
    artist: "Justin Bieber",
    song: "Ghost",
  });
  assert.deepEqual(parseTitle("Justin Bieber - Ghost (Official Video)"), {
    artist: "Justin Bieber",
    song: "Ghost",
  });
  assert.deepEqual(parseTitle("Ghost"), { artist: null, song: "Ghost" });
});

test("channel authority is read from the channel's own name", () => {
  assert.equal(authorityOf(BIEBER_VEVO), "vevo");
  assert.equal(authorityOf(BIEBER_TOPIC), "topic");
  assert.equal(authorityOf(UNKNOWN_GHOST), "none");
  assert.equal(
    authorityOf(
      result({
        id: "l",
        title: "Nils Frahm - Says",
        channelTitle: "Erased Tapes Records",
      }),
    ),
    "label",
  );
  assert.equal(
    authorityOf(
      result({
        id: "s",
        title: "Nils Frahm - Says",
        channelTitle: "Nils Frahm",
      }),
    ),
    "self_titled",
  );
});

test("a result must carry positive evidence that it is a released recording", () => {
  assert.equal(hasMusicEvidence(RANDOM_UPLOAD), false);
  assert.equal(classify(RANDOM_UPLOAD, "ghost").reason, "no_music_evidence");
  assert.ok(
    !rank(GHOST_FIXTURE, "ghost").some((r) => r.id === RANDOM_UPLOAD.id),
  );

  // Each of the four kinds of evidence is enough on its own.
  assert.equal(hasMusicEvidence(BIEBER_VEVO), true); // VEVO channel
  assert.equal(hasMusicEvidence(BIEBER_TOPIC), true); // - Topic channel
  assert.equal(
    hasMusicEvidence(
      result({
        id: "m1",
        title: "Something (Official Audio)",
        channelTitle: "someone",
        viewCount: 40,
      }),
    ),
    true,
  );
  assert.equal(
    hasMusicEvidence(
      result({
        id: "m2",
        title: "Something",
        channelTitle: "someone",
        viewCount: 4_000_000,
      }),
    ),
    true,
  );
});

test("non-music formats are rejected by title, whatever the channel claims", () => {
  const cases: [string, string][] = [
    ["GHOST — Official Trailer (2024)", "trailer"],
    ["Ghost REACTION!!", "reaction"],
    ["Ghost — full movie", "movie"],
    ["Learn SQL in 10 minutes", "tutorial subject"],
    ["Ghost gameplay walkthrough part 3", "gaming"],
    ["Ghost #shorts", "short"],
    ["Ghost — episode 4", "series"],
    ["Ghost stories | Night Shift Podcast", "podcast"],
  ];
  for (const [title, why] of cases) {
    const r = result({
      id: `x-${why}`,
      title,
      channelTitle: "Big Channel",
      viewCount: 9_000_000,
    });
    assert.equal(
      classify(r, "ghost").keep,
      false,
      `${title} should be rejected (${why})`,
    );
  }
});
