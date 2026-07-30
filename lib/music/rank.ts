import type { MusicResult, SourceHint } from "@/lib/domain";

/**
 * What counts as music, and what order it comes back in.
 *
 * Two jobs live here on purpose, because they are the same judgement made
 * twice: first "is this a song at all", then "which song did they mean". A
 * result that fails the first test is never ranked — it is removed — and the
 * ranking that follows is built out of the same evidence, so the two can never
 * disagree about what a piece of metadata means.
 *
 * This file has no value imports. It is pure, deterministic and directly
 * testable, which is why the regression test beside it can run under plain
 * `node --test` with no build step and no mocks.
 */

/* ── Text ────────────────────────────────────────────────────────────────── */

/** Case, punctuation and accents removed, so comparisons are about words. */
export function fold(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[’'`´]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/**
 * Split "Artist - Song (Official Video)" into its parts.
 *
 * YouTube music titles are overwhelmingly `Artist - Song` with a parenthesised
 * or bracketed suffix. Reading that structure is what makes an exact SONG-title
 * match possible: a query for "ghost" should recognise "Justin Bieber - Ghost"
 * as an exact hit on the song, which naive whole-title equality never would.
 */
export function parseTitle(raw: string): {
  artist: string | null;
  song: string;
} {
  // Strip trailing qualifiers: (Official Video), [Lyrics], etc.
  const stripped = raw.replace(/\s*[([][^)\]]*[)\]]\s*$/g, "").trim();
  const dash = stripped.match(/^(.{1,60}?)\s+[-–—]\s+(.+)$/);
  if (dash) return { artist: dash[1].trim(), song: dash[2].trim() };
  return { artist: null, song: stripped };
}

/** The artist a result most likely belongs to, for Cowork Autoplay. */
export function artistOf(r: MusicResult): string {
  const fromChannel = r.channelTitle
    .replace(/\s*-\s*Topic$/i, "")
    .replace(/VEVO$/i, "")
    .trim();
  if (fromChannel) return fromChannel;
  return parseTitle(r.title).artist ?? r.channelTitle;
}

/* ── What is not music ───────────────────────────────────────────────────── */

/**
 * Genres of video that are not songs.
 *
 * YouTube's category 10 is broad and self-declared: uploaders file trailers,
 * reactions and tutorials under Music constantly. This is the second gate, and
 * it reads the title and channel rather than trusting the category.
 */
const NOT_MUSIC =
  /\b(official )?(trailer|teaser)\b|\bmovie clip\b|\bfilm clip\b|\breact(ion|ing|s)?\b|\breview(ed|s)?\b|\binterview\b|\btutorial\b|\bhow to\b|\blesson\b|\bmasterclass\b|\bgameplay\b|\bwalkthrough\b|\bspeedrun\b|\bnews\b|\bpodcast\b|\bepisode \d+\b|\bep\.? ?\d+\b|\bfull (movie|episode|documentary|match|game)\b|\bdocumentary\b|\bbehind the scenes\b|\bmaking of\b|\bexplained\b|\bbreakdown\b|\btop \d+\b|\bcompilation\b|\bunboxing\b|\bvlog\b|\btrailer music\b|#shorts?\b|\bshort film\b|\bcourse\b|\blecture\b|\bwebinar\b|\bsermon\b|\btestimony\b|\bhighlights\b|\bprank\b|\bchallenge\b|\bstorytime\b|\bq&a\b|\btier list\b|\bsql|\bexcel\b|\bpython\b|\bjavascript\b/i;

/** Channels that publish those things, whatever an individual title says. */
const NOT_MUSIC_CHANNEL =
  /\b(movies?|film|cinema|pictures|studios|tv|news|network|gaming|games|esports|sports|tutorials?|academy|university|college|institute|podcast|church|ministry|learning|training|coaching|analytics|labs?)\b/i;

/** Reworkings. Wanted only when the query asks for them. */
const COVER =
  /\b(cover|covered by|acoustic version|karaoke|instrumental version)\b/i;
const REMIX =
  /\b(remix|remixed|bootleg|mashup|edit|flip|vip mix|sped up|slowed|nightcore|8d audio)\b/i;
const LIVE =
  /\b(live at|live from|live in|live on|live session|live performance|concert|tour|festival|unplugged|session live)\b|\(live\b|\[live\b/i;
const SHORTENED =
  /\b(snippet|preview|teaser|short version|excerpt|clip|shorts)\b/i;

/* ── Where it came from ──────────────────────────────────────────────────── */

/** Auto-generated artist channels. YouTube's own naming, not an inference. */
const TOPIC = /\s-\s*Topic$/i;
const VEVO = /VEVO$/i;
/** Publishers whose channel names are observable facts, not guesses. */
const LABEL =
  /\b(records|recordings|music group|entertainment|def jam|interscope|columbia|atlantic|capitol|warner|universal|sony music|rca|republic|island|polydor|parlophone|domino|xl recordings|4ad|sub pop|matador|ninja tune|warp|erased tapes|deutsche grammophon|blue note|nonesuch)\b/i;

const OFFICIAL_AUDIO = /\bofficial (audio|track|song)\b|\baudio\b\s*[)\]]?$/i;
const OFFICIAL_VIDEO = /\bofficial (music )?video\b/i;
/* A visualiser is a secondary upload of a recording that already exists. It is
   legitimate and it is not the primary release, so it is scored as neither. */
const VISUALISER = /\bvisuali[sz]er\b/i;
const LYRIC_VIDEO = /\blyrics?\b|\blyric video\b/i;

/** Any parenthesised or bracketed qualifier: (Official Video), [Lyrics], (Live). */
const QUALIFIED = /[([][^)\]]*[)\]]/;

/** Folded, with spaces removed — "JustinBieberVEVO" and "Justin Bieber" agree. */
function compact(s: string): string {
  return fold(s).replace(/ /g, "");
}

export type Authority = "vevo" | "topic" | "label" | "self_titled" | "none";

/**
 * How much the channel itself vouches for the recording.
 *
 * None of these are YouTube's "official" flag, because there is no such flag.
 * They are things the channel's own name says out loud.
 */
export function authorityOf(r: MusicResult): Authority {
  const channel = r.channelTitle;
  if (VEVO.test(channel)) return "vevo";
  if (TOPIC.test(channel)) return "topic";
  if (LABEL.test(channel)) return "label";
  // The channel is named after the artist credited in the title.
  const artist = parseTitle(r.title).artist;
  if (artist && compact(channel) === compact(artist)) return "self_titled";
  return "none";
}

export function hintsFor(r: MusicResult): SourceHint[] {
  const out: SourceHint[] = [];
  const a = authorityOf(r);
  if (a === "vevo") out.push("vevo");
  if (a === "topic") out.push("topic_channel");
  if (a === "label") out.push("label_channel");
  if (a === "self_titled") out.push("artist_channel");
  if (OFFICIAL_VIDEO.test(r.title) || VISUALISER.test(r.title))
    out.push("official_video");
  else if (OFFICIAL_AUDIO.test(r.title)) out.push("official_audio");
  else if (LYRIC_VIDEO.test(r.title)) out.push("lyric_video");
  if ((r.viewCount ?? 0) >= 1_000_000) out.push("popular");
  if (r.durationSecs !== null && r.durationSecs >= 90 && r.durationSecs <= 600)
    out.push("verified_length");
  if (r.durationSecs !== null && r.durationSecs > 20 * 60)
    out.push("long_form");
  return out;
}

/* ── The music gate ──────────────────────────────────────────────────────── */

/** Sixty seconds. Below it, a "song" is a Short, a snippet or an advert. */
export const MIN_TRACK_SECS = 60;

export interface Verdict {
  keep: boolean;
  /** Why it was dropped. Not shown to anyone; it exists so tests can be exact. */
  reason?:
    | "not_music_category"
    | "not_a_song"
    | "too_short"
    | "live_broadcast"
    | "not_embeddable"
    | "no_music_evidence"
    | "low_confidence";
}

/**
 * Positive evidence that this is a released recording.
 *
 * The gates above remove what is obviously not music. This one requires
 * something to be obviously music, which is the stricter and more useful test:
 * anyone can upload a file titled like a song, and the category is
 * self-declared. Any one of these is enough —
 *
 *   · a channel nobody else can publish into (VEVO, `- Topic`, a known label)
 *   · a channel named after the artist credited in the title
 *   · the title calling itself an official audio, video or lyric video
 *   · an audience large enough that a released recording is the likeliest
 *     explanation for it
 *
 * — and nothing else gets through. A random upload with none of the four is
 * exactly the result this search is supposed to stop returning.
 */
const POPULAR_ENOUGH_TO_BE_RELEASED = 250_000;

export function hasMusicEvidence(r: MusicResult): boolean {
  if (authorityOf(r) !== "none") return true;
  if (
    OFFICIAL_VIDEO.test(r.title) ||
    OFFICIAL_AUDIO.test(r.title) ||
    VISUALISER.test(r.title) ||
    LYRIC_VIDEO.test(r.title)
  )
    return true;
  return (r.viewCount ?? 0) >= POPULAR_ENOUGH_TO_BE_RELEASED;
}

/** Does the query itself ask for a reworking? Then it is not a penalty. */
function asked(query: string, re: RegExp): boolean {
  return re.test(query);
}

/**
 * Whether a result is a song someone searched for, at all.
 *
 * Runs BEFORE ranking. Everything it rejects disappears rather than sinking,
 * because a trailer at position forty is still a trailer in a music search.
 */
export function classify(r: MusicResult, query: string): Verdict {
  if (r.categoryId !== null && r.categoryId !== "10")
    return { keep: false, reason: "not_music_category" };
  if (r.liveState !== "none") return { keep: false, reason: "live_broadcast" };
  if (r.embeddable === false) return { keep: false, reason: "not_embeddable" };
  if (r.durationSecs !== null && r.durationSecs < MIN_TRACK_SECS)
    return { keep: false, reason: "too_short" };

  const title = r.title;
  if (NOT_MUSIC.test(title)) return { keep: false, reason: "not_a_song" };
  if (NOT_MUSIC_CHANNEL.test(r.channelTitle) && authorityOf(r) === "none")
    return { keep: false, reason: "not_a_song" };
  if (SHORTENED.test(title) && !asked(query, SHORTENED))
    return { keep: false, reason: "not_a_song" };
  if (relevanceOf(r, query) < MIN_RELEVANCE)
    return { keep: false, reason: "low_confidence" };
  if (!hasMusicEvidence(r)) return { keep: false, reason: "no_music_evidence" };

  return { keep: true };
}

/* ── Ranking ─────────────────────────────────────────────────────────────── */

/**
 * Popularity, compressed.
 *
 * Views are the strongest available proxy for "the recording people mean" and
 * the only way to disambiguate a one-word query like "ghost", where a dozen
 * results carry the identical title. It is deliberately logarithmic and capped:
 * it must break ties, never win arguments against an exact match.
 */
function popularity(views: number | null): number {
  if (!views || views <= 0) return 0;
  // Slope and ceiling are set so the range that actually matters — a few
  // million plays against a few hundred million — still separates cleanly
  // rather than flattening against the cap.
  return Math.min(34, Math.max(0, (Math.log10(views) - 4) * 7));
}

/** Queries that are asking for something long on purpose. */
const WANTS_LONG =
  /\b(mix|mixtape|playlist|radio|hours?|full album|album|set|compilation|lofi|lo-fi|study|focus|ambient|sleep|beats)\b/i;

export interface Scored {
  result: MusicResult;
  score: number;
}

/**
 * How well the title answers the query, on its own.
 *
 * Separated from the total score because the two answer different questions.
 * The score says "how good is this recording"; this says "is it what was
 * asked for at all" — and a Topic channel with a hundred million plays can
 * score highly on the first while having nothing to do with the second.
 */
export function relevanceOf(r: MusicResult, query: string): number {
  const q = fold(query);
  const qWords = q.split(" ").filter(Boolean);
  const { artist, song } = parseTitle(r.title);
  const foldedSong = fold(song);
  const foldedArtist = artist ? fold(artist) : "";
  const foldedTitle = fold(r.title);

  const exactSong = foldedSong === q;
  /* "justin bieber ghost" names the artist AND the song. Without this the
     whole-phrase query matches nothing exactly, every candidate falls back to
     a weak partial score, and popularity decides — which is how a reupload
     outranks the artist's own channel. */
  const exactCredit = !!foldedArtist && `${foldedArtist} ${foldedSong}` === q;

  if (exactSong || exactCredit) return 46;
  if (foldedTitle === q) return 40;
  if (foldedSong.startsWith(`${q} `)) return 22;
  if (
    new RegExp(`\\b${q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(
      foldedTitle,
    )
  )
    return 16;

  // Every query word present somewhere — a weak but real match.
  const present = qWords.filter((w) => foldedTitle.includes(w)).length;
  return qWords.length ? (present / qWords.length) * 10 : 0;
}

/**
 * The relevance floor.
 *
 * Below it the result is not an answer to this query, however good a recording
 * it is. This is what stops a search from quietly becoming "here is some
 * popular music" whenever the words match nothing.
 */
export const MIN_RELEVANCE = 6;

export function scoreResult(r: MusicResult, query: string): number {
  const q = fold(query);
  const { artist, song } = parseTitle(r.title);
  const foldedSong = fold(song);
  const foldedArtist = artist ? fold(artist) : "";
  const bareChannel = r.channelTitle.replace(TOPIC, "").replace(VEVO, "");
  const foldedChannel = fold(bareChannel);
  const authority = authorityOf(r);

  /* 1 — how well the title answers the query. */
  let score = relevanceOf(r, query);
  const exactSong = foldedSong === q;
  const exactCredit = !!foldedArtist && `${foldedArtist} ${foldedSong}` === q;

  /* 2 — exact title AND a recognised artist. The strongest signal there is:
        the query named the song, and the channel is the act that made it. */
  const queryNamesArtist =
    (!!foldedArtist && q.includes(foldedArtist)) ||
    (!!foldedChannel && q.includes(foldedChannel));
  const channelMatchesCredit =
    !!artist && !!bareChannel && compact(bareChannel) === compact(artist);
  if ((exactSong || exactCredit) && queryNamesArtist) score += 30;
  else if (queryNamesArtist) score += 14;
  /* The channel is named after the artist credited in its own title. That is
     self-consistency, not disambiguation — anyone can name a channel after the
     string they put in front of the dash — so it counts for little. */
  if (channelMatchesCredit) score += 8;

  /* 3 — official artist, VEVO, Topic or a recognised label. */
  /* VEVO and `- Topic` are namespaces YouTube and the labels control: nobody
     else can publish into them. A channel merely NAMED after the artist is a
     naming convention, so it is worth about half as much. */
  score +=
    authority === "vevo"
      ? 32
      : authority === "topic"
        ? 30
        : authority === "label"
          ? 18
          : authority === "self_titled"
            ? 16
            : 0;

  /* 4 — music-confidence metadata carried in the title itself, and the shape of
        the title. On a channel that vouches for the recording, a title with no
        qualifier at all IS the primary release: "Justin Bieber - Ghost" is the
        song, and "… (Official Visualizer)" is a companion upload of it. */
  if (OFFICIAL_VIDEO.test(r.title)) score += 12;
  else if (OFFICIAL_AUDIO.test(r.title)) score += 10;
  else if (VISUALISER.test(r.title)) score += 5;
  else if (LYRIC_VIDEO.test(r.title)) score += 5;
  const controlled =
    authority === "vevo" || authority === "topic" || authority === "label";
  if (controlled && !QUALIFIED.test(r.title)) score += 12;

  /* 5 — popularity, secondary. */
  score += popularity(r.viewCount);

  /* 6 — playable. Unknown embeddability is not held against a result; a known
        false one is already gone by this point. */
  if (r.embeddable === false) score -= 100;

  /* 7 — plausible song length. */
  if (r.durationSecs !== null) {
    if (r.durationSecs >= 90 && r.durationSecs <= 8 * 60) score += 10;
    else if (r.durationSecs > 20 * 60 && !WANTS_LONG.test(query)) score -= 14;
  }

  /* 8 — recency, as a tie-breaker and nothing more. */
  if (r.publishedAt) {
    const years = (Date.now() - Date.parse(r.publishedAt)) / 31_557_600_000;
    if (Number.isFinite(years))
      score += Math.max(-3, Math.min(3, 3 - years / 4));
  }

  /* Reworkings and live takes, unless they were asked for. A studio recording
     is what "ghost" means; "ghost live" is a different request. */
  /* Heavy on purpose. A remix on a Topic channel carries every other signal
     the original does — exact title, controlled channel, real plays — so a
     mild penalty leaves it competing with the recording it was derived from. */
  if (COVER.test(r.title) && !asked(query, COVER)) score -= 40;
  if (REMIX.test(r.title) && !asked(query, REMIX)) score -= 40;
  if (LIVE.test(r.title) && !asked(query, LIVE)) score -= 34;

  return score;
}

/**
 * The confidence floor.
 *
 * Below it a result is hidden rather than shown low: a music search that
 * returns four songs and sixteen maybes has not answered the question. The
 * floor is a score, not a category, so a weak title on a Topic channel still
 * clears it while a strong title on an unknown channel with no plays does not.
 */
export const CONFIDENCE_FLOOR = 18;

/**
 * Filter to music, score, order, and drop everything below the floor.
 *
 * There is deliberately no "return at least N" fallback. A query that matches
 * no music should say so — three weak rows dressed as an answer is worse than
 * an empty state that explains what was filtered and suggests what to try.
 */
export function rank(results: MusicResult[], query: string): MusicResult[] {
  const kept: Scored[] = [];
  for (const result of results) {
    if (!classify(result, query).keep) continue;
    const score = scoreResult(result, query);
    if (score < CONFIDENCE_FLOOR) continue;
    kept.push({ result, score });
  }
  kept.sort((a, b) => b.score - a.score);
  return kept.map((s) => s.result);
}

/** Exposed for the regression test, so ordering failures name their scores. */
export function rankWithScores(
  results: MusicResult[],
  query: string,
): Scored[] {
  return results
    .filter((r) => classify(r, query).keep)
    .map((result) => ({ result, score: scoreResult(result, query) }))
    .sort((a, b) => b.score - a.score);
}
