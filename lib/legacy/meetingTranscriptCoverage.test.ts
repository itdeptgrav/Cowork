import assert from "node:assert/strict";
import { test } from "node:test";
import { backendAvailable, backendSource } from "./backendSource.ts";

/**
 * **Reported 21 September 2026: a 50-minute meeting produced a one-minute
 * transcript.** M084, three participants, ~7 MB of audio each.
 *
 * What the stored record showed, and which fault each half points at:
 *
 *   verbatim   9 parsed · **55 unparsed** · last line ends **0:58**
 *   translate  42 parsed · 0 unparsed · last line ends **2:18**
 *
 * Two different failures wearing one symptom.
 *
 * **The parser.** Its stamp was `(\d+)-(\d+)` — whole seconds only. Past the
 * first minute a model writes `[1:02-1:08]`, which is what anybody would write
 * and what the prompt's examples (every one under ten seconds) never showed it
 * not to do. Those 55 lines were not missing; they were parsed and thrown away.
 * That is the verbatim column exactly: everything that survived ends at 0:58.
 *
 * **The prompt.** The translate run drifted not at all — zero unparsed — and
 * still stopped at 2:18, because nothing told the model how long the recording
 * was or that it had to reach the end.
 *
 * Both are pinned here rather than in the engine because this repository is
 * where the meetings UI lives and where the regression would be noticed.
 */

const routes = () =>
  backendSource("routes/task_routes/meetingSummary.routes.js");

const skip = backendAvailable()
  ? false
  : "the engine checkout was not found — set COWORK_BACKEND";

/* ── The parser reads a clock ─────────────────────────────────────────────── */

test("the timestamp is read as a clock, not as whole seconds", { skip }, () => {
  const src = routes();

  /* The reader exists and is right-to-left, so 1:02 is 62 whether or not an
     hour was written. */
  assert.match(src, /function stampToSeconds\(raw\)/);
  assert.match(src, /parts\.reduce\(\(total, n\) => total \* 60 \+ n, 0\)/);

  /* Both ends of the range go through it. Reading one as a clock and the other
     as an integer would put a line's end before its start. */
  assert.match(src, /const start = stampToSeconds\(m\[1\]\)/);
  assert.match(src, /const end = stampToSeconds\(m\[2\]\)/);

  /* And the line pattern admits a colon at all — this is the character whose
     absence cost M084 fifty-five lines. */
  assert.match(src, /\[\\d:\]\+/);
  assert.doesNotMatch(
    src,
    /\^\\\[\\s\*\(\\d\+\)\\s\*\[-–\]/,
    "the seconds-only stamp is back",
  );
});

test("the shapes a model actually writes are accepted", { skip }, () => {
  /* An en dash, the word "to", an "s" suffix, and a bullet in front. Each is a
     spelling of the same thing, and each used to cost a line. */
  const src = routes();
  assert.match(src, /\[-–—\]\|to/);
  assert.match(src, /\^\[-\*•\]\\s\+/);
});

/* ── The prompt asks for the whole recording ──────────────────────────────── */

test("the model is told how long the recording is", { skip }, () => {
  const src = routes();
  assert.match(
    src,
    /This recording is about \$\{Math\.round\(durationSecs \/ 60\)\} minutes long/,
  );

  /**
   * **And the length has a source that exists.**
   *
   * The first attempt read it from the speech timeline. That timeline is
   * EMPTY on every recording this product has written — M084's three rows
   * carry zero intervals — so `durationSecs` came out 0, the paragraph above
   * was never added to the prompt, and the fix shipped doing nothing. The
   * meeting's own clock is the real source.
   */
  assert.match(src, /const fromTimeline = timeline\.reduce\(/);
  assert.match(src, /\.collection\("cowork_scheduled_meets"\)/);
  assert.match(src, /Date\.parse\(meet\?\.startedAt \|\| meet\?\.dateTime \|\| ""\)/);
  assert.match(src, /Date\.parse\(meet\?\.endedAt \|\| ""\)/);
});

test("the model is told to reach the end, and not to summarise", { skip }, () => {
  const src = routes();
  assert.match(src, /Transcribe ALL of it, to the very end/);
  assert.match(src, /Do not stop part-way, do not summarise/);
  /* A silent stretch is a reason to carry on, not a place to stop. */
  assert.match(src, /skip it and carry on/);
});

test("each speaker is transcribed from their OWN microphone", { skip }, () => {
  /**
   * **The fault this replaced.** All three files went to one call, which was
   * asked to merge them and work out who was speaking. On M084 that produced
   * 48 lines in which TRINAYAN DOLEY appeared not once — three people
   * recorded, two on the page.
   *
   * It was being asked blind: the speaking-order block that was supposed to
   * carry the attribution is built from `speechIntervals`, which is empty on
   * every recording. Per file there is nothing to infer — the file IS the
   * speaker.
   */
  const src = routes();
  assert.match(src, /async function transcribeSpeaker\(/);
  assert.match(src, /ONE person's own microphone: \$\{speakerName\}/);
  assert.match(src, /ignore them completely/);

  /* The name is stamped on, never read back out of the model's answer. */
  assert.match(src, /utterances\.push\(\{ \.\.\.u, speaker: speakerName \}\)/);

  /* One call per file, run together, merged on the clock afterwards. */
  assert.match(src, /uploadedGeminiFiles\.map\(\(file, i\) =>/);
  assert.match(src, /\.sort\(\(a, b\) => a\.start - b\.start \|\| a\.end - b\.end\)/);
});

test("a file that fails does not cost the others their transcript", { skip }, () => {
  const src = routes();
  assert.match(src, /return \{ utterances: \[\], unparsedLineCount: 0 \};/);
});

test("it keeps asking until the recording is covered, and cannot spin", { skip }, () => {
  /**
   * A model handed fifty minutes of audio answers with an opening and stops —
   * M084 ended at 2:18, then at 6:21. So each pass resumes where the last one
   * reached.
   *
   * Three separate things stop the loop, and all three are needed: the end of
   * the recording, a pass that returns nothing new, and a pass that does not
   * advance. The last is the one that matters when a model ignores the resume
   * and repeats its opening for ever.
   */
  const src = routes();
  assert.match(src, /You have already transcribed everything before \$\{clockOf\(from\)\}/);
  assert.match(src, /Do NOT repeat anything earlier than/);

  /* Only genuinely new lines are kept, so a repeated pass cannot double them. */
  assert.match(src, /parsed\.utterances\.filter\(\(u\) => u\.end > reached\)/);

  assert.match(src, /if \(!fresh\.length\) break;/);
  assert.match(src, /if \(now <= reached\) break;/);
  assert.match(src, /if \(now >= durationSecs - TRANSCRIBE_TAIL_SLACK_SECS\) break;/);

  /**
   * The budget follows the recording. A flat eight passes covered about
   * forty-eight minutes at the rate a model actually answers, so a 55-minute
   * meeting stopped short with nothing saying it had.
   */
  assert.match(src, /Math\.ceil\(\(durationSecs > 0 \? durationSecs : 0\) \/ 300\) \+ 2/);
  assert.match(src, /Math\.min\(\s*TRANSCRIBE_MAX_PASSES,/);
});

/* ── Roman letters, not Devanagari ───────────────────────────────────────── */

test(
  "a verbatim Hindi line is asked for in Roman letters, not translated",
  { skip },
  () => {
    /**
     * **Reported 21 September 2026, with a picture of a transcript in two
     * scripts.** One speaker's Hindi came back as Devanagari and the next
     * speaker's as Hinglish, in the same meeting, because nothing in the
     * prompt had ever named a script and the model chose per request.
     *
     * The ask reads like a translation request and is the opposite of one:
     * same words, same meaning, different letters. So this pins BOTH halves
     * — that the script is demanded, and that translating is still refused —
     * because an implementation that satisfied only the first would read as
     * fixed on screen while quietly turning verbatim into English.
     */
    const src = routes();

    assert.match(src, /Write every line in the LATIN ALPHABET/);
    assert.match(src, /never in Devanagari or any other script/);
    assert.match(src, /This is NOT a translation/);

    /* Still verbatim. The instruction that was there before has to survive
       the one added next to it. */
    assert.match(src, /Transcribe VERBATIM, in the language each line was actually spoken in. Do not translate./);

    /**
     * The examples are not decoration. A model told only to use Roman
     * letters transliterates character by character and returns "sakate
     * hain" and "aura" — right by the letter, and not how one person on
     * earth types Hindi. The prompt shows the natural spelling against the
     * mechanical one, and shows the English translation as a third WRONG
     * answer so romanising cannot be mistaken for translating.
     */
    assert.match(src, /sakte hain" rather than "sakate hain"/);
    assert.match(src, /WRONG, translated into English/);
    assert.ok(
      src.includes("और"),
      "the prompt lost its Devanagari counter-example",
    );

    /* And a mixed line stays mixed rather than being pushed either way. */
    assert.match(src, /stays mixed, with the English words spelled in English/);
  },
);

test("the translated tab is untouched by the script rule", { skip }, () => {
  /* Two tabs, two jobs. Translate still renders English and still marks the
     lines it translated; nothing about letters belongs in that branch. */
  const src = routes();
  assert.match(src, /Render every line in ENGLISH/);
  assert.match(src, /append the marker <<T>> at the very end of that line/);
});

test("the documents say which script the words are in", { skip }, () => {
  /* The sub-heading under CoWork Meeting Transcript is the only thing in the
     file that explains why a Hindi sentence is in English letters. Both
     renderers carry it, and they carry the same sentence. */
  const caption =
    "Verbatim — the exact words, in the language they were spoken, written in Roman letters";
  assert.ok(routes().includes(caption), "the .docx lost the caption");
  assert.ok(
    backendSource("routes/task_routes/meetingPdf.js").includes(caption),
    "the PDF lost the caption",
  );
});
