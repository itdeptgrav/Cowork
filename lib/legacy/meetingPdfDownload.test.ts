import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { backendAvailable, backendSource } from "./backendSource.ts";

/**
 * **A PDF beside each Download .docx.** Asked for 21 September 2026.
 *
 * Two documents, two formats, and the thing that matters is that the two
 * formats of one document say the same thing — a PDF that disagreed with the
 * .docx about what somebody has to do would be worse than not having one.
 */

const skip = backendAvailable()
  ? false
  : "the engine checkout was not found — set COWORK_BACKEND";

const routes = () =>
  backendSource("routes/task_routes/meetingSummary.routes.js");
const panel = (name: string) =>
  readFileSync(`components/features/meetings/${name}`, "utf8");

/**
 * The same file with its comments taken out.
 *
 * What follows asserts about what the page RENDERS, and the comment that
 * explains why the .docx button went away says ".docx" as plainly as the
 * button did — matching prose would make the note about a change fail the
 * test for that change. Block comments go first, which takes the JSX
 * brace-and-star form with them; line comments are stripped only where
 * they start a line, so an `https://` inside a string survives.
 */
const code = (name: string) =>
  panel(name)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

/* ── One document, one URL ────────────────────────────────────────────────── */

test("both downloads answer PDF on the same route", { skip }, () => {
  /* A second path would have been a second permission check and a second place
     for the contents to drift. `format=pdf` changes only the rendering. */
  const src = routes();
  assert.match(src, /const wantsPdf = String\(req\.query\.format \|\| ""\)\.toLowerCase\(\) === "pdf"/);
  assert.match(src, /if \(String\(req\.query\.format \|\| ""\)\.toLowerCase\(\) === "pdf"\)/);

  /* And the file is named for what it actually is. */
  assert.match(src, /\$\{wantsPdf \? "pdf" : "docx"\}/);
  assert.match(src, /Meeting_Transcript_\$\{suffix\}_\$\{meetId\}\.pdf/);
  assert.match(src, /res\.setHeader\("Content-Type", "application\/pdf"\)/);
});

test("the PDF reads Needs Action exactly as the .docx does", { skip }, () => {
  /**
   * The one thing that must not drift. The .docx builder owns the reading of
   * the three lists, and the PDF is handed the result rather than repeating
   * the parse — so a change to one cannot leave the other behind.
   */
  const src = routes();
  assert.match(src, /const \{ generateSummaryDocx, needsActionGroups \} = require\("\.\/generateSummaryDocx"\)/);
  assert.match(src, /needsActionGroups\(\s*summaryWithMeta\.tasksAssigned,\s*summaryWithMeta\.deadlines,\s*summaryWithMeta\.actionItems,\s*\)/);

  const docx = backendSource("routes/task_routes/generateSummaryDocx.js");
  assert.match(docx, /module\.exports = \{ generateSummaryDocx, needsActionGroups \}/);
});

test("the PDF says the same things, in the same order", { skip }, () => {
  const pdf = backendSource("routes/task_routes/meetingPdf.js");
  /* Needs Action first, then the numbered sections the .docx carries. */
  const order = [
    "Needs Action",
    "1.&nbsp;&nbsp;Meeting Overview",
    "2.&nbsp;&nbsp;Conversation Flow",
    "3.&nbsp;&nbsp;Tasks Assigned",
    "4.&nbsp;&nbsp;Deadlines Mentioned",
    "5.&nbsp;&nbsp;Action Items",
  ];
  let last = -1;
  for (const heading of order) {
    const at = pdf.indexOf(heading);
    assert.ok(at > 0, `the PDF lost "${heading}"`);
    assert.ok(at > last, `"${heading}" is out of order in the PDF`);
    last = at;
  }
});

test("every value that reaches the page is escaped", { skip }, () => {
  /* It is all somebody's speech or a model's output. An unescaped `<` in a
     transcript line would silently eat the rest of the document. */
  const pdf = backendSource("routes/task_routes/meetingPdf.js");
  assert.match(pdf, /function esc\(value\)/);
  assert.match(pdf, /\.replace\(\/&\/g, "&amp;"\)/);
  assert.doesNotMatch(
    pdf,
    /\$\{(?:u\?\.text|i\.what|summary\.summary)\}/,
    "a value reaches the page unescaped",
  );
});

/* ── When Chromium cannot run ─────────────────────────────────────────────── */

test("a server with no renderer says so, and points at the .docx", { skip }, () => {
  /**
   * The PDF needs a Chromium; the .docx does not. Collapsing that into a 500
   * would read as "the summary failed", which is not what happened and not
   * what the reader should do about it.
   */
  const src = routes();
  assert.match(src, /RendererUnavailableError \|\| e\?\.rendererUnavailable/);
  assert.match(src, /res\.status\(503\)/);
  assert.match(
    src,
    /The PDF renderer is not available on this server\. The \.docx download still works\./,
  );
});

/* ── The buttons ──────────────────────────────────────────────────────────── */

test("each panel offers ONE download, and it is PDF", () => {
  /**
   * **OWNER DECISION, 21 September 2026.** Both panels briefly carried two
   * buttons — Download .docx and PDF. Asked to drop the .docx one and leave a
   * single button reading Download PDF.
   *
   * The .docx is not removed, only unoffered: the engine still builds it and
   * the route still serves it without `format=pdf`. That is the difference
   * between taking a button away and taking a capability away — anything
   * linking to the document keeps working, and putting the button back is one
   * element.
   */
  for (const name of ["MeetingSummaryPanel.tsx", "VerbatimTranscriptPanel.tsx"]) {
    const src = code(name);

    assert.match(src, /[Dd]ownload\("pdf"\)/, name);
    assert.doesNotMatch(
      src,
      /[Dd]ownload\("docx"\)/,
      `${name}: the .docx button is back`,
    );
    assert.match(src, /"Download PDF"/, name);
    assert.doesNotMatch(src, /Download \.docx/, name);

    /* One button, so the label no longer has to say WHICH format is working. */
    assert.match(src, /dlLoading !== null \? "Preparing…" : "Download PDF"/, name);
    assert.match(src, /disabled=\{dlLoading !== null/, name);
  }

  /* The format is still a parameter rather than being hard-coded into the
     fetch — which is what keeps the .docx one argument away. */
  for (const name of ["MeetingSummaryPanel.tsx", "VerbatimTranscriptPanel.tsx"]) {
    assert.match(code(name), /format: "docx" \| "pdf"/, name);
  }
});

test("the engine still serves the .docx it no longer offers", { skip }, () => {
  /* A button removed from a page is not a route removed from a server. Both
     documents must still answer without `format=pdf`, or a link somebody saved
     stops working. */
  const src = routes();
  assert.match(src, /const buffer = await generateSummaryDocx\(summaryWithMeta, meetId\)/);
  assert.match(src, /const buffer = await renderTranscriptDocx\(/);
  assert.match(
    src,
    /"application\/vnd\.openxmlformats-officedocument\.wordprocessingml\.document"/,
  );
});

test("the engine's refusal reaches the reader instead of a status code", () => {
  /* "The PDF renderer is not available… the .docx still works" is worth
     reading; "HTTP 503" is not. */
  const src = panel("MeetingSummaryPanel.tsx");
  assert.match(src, /const body = \(await res\.json\(\)\) as \{ error\?: string \}/);
});

/* ── A Summary box in front of the transcript ─────────────────────────────── */

test(
  "the transcript documents lead with the summary, then the tasks",
  { skip },
  () => {
    /**
     * The structure asked for on 21 September 2026, in these words: page one
     * carries the meeting information, then a **Meeting Summary** of 10–15
     * lines, then **Tasks / Action Items with assigned users and deadlines**,
     * and the full communication after that.
     *
     * The point of the order: somebody handed the file should be able to close
     * it after the first page knowing what happened, who owes what and by when.
     */
    const src = routes();
    const pdf = backendSource("routes/task_routes/meetingPdf.js");

    for (const [name, text] of [
      ["docx", src],
      ["pdf", pdf],
    ] as const) {
      const summary = text.indexOf("Meeting Summary");
      const tasks = text.indexOf("Tasks &" + (name === "pdf" ? "amp;" : "") + " Action Items");
      assert.ok(summary > 0, `${name}: no Meeting Summary heading`);
      assert.ok(tasks > summary, `${name}: tasks are not after the summary`);
    }

    /* The .docx renderer is handed the summary and reads the tasks through the
       SAME grouping the summary document and the panel use. */
    assert.match(
      src,
      /async function renderTranscriptDocx\(transcript, result, mode, meetId, summary\)/,
    );
    assert.match(
      src,
      /needsActionGroups\(\s*summary\.tasksAssigned,\s*summary\.deadlines,\s*summary\.actionItems,\s*\)/,
    );
    assert.match(
      pdf,
      /function transcriptHtml\(record, result, mode, meetId, summary, needsActionGroups\)/,
    );
    assert.ok(
      pdf.indexOf("<h2>Transcript</h2>") < pdf.indexOf("<thead><tr><th>Time"),
      "the PDF dialogue table is not under the Transcript heading",
    );

    /* The route reads the summary, and a missing one never costs the
       transcript its download. */
    assert.match(src, /db\.collection\("meeting_summaries"\)\.doc\(meetId\)\.get\(\)/);
    assert.match(src, /console\.warn\("\[Transcript\] summary read failed:"/);
  },
);

test("task, owner and deadline are three columns, not one line", { skip }, () => {
  /**
   * Asked for by name: "If a task is assigned to a specific user, show: Task /
   * Assigned To / Deadline". Three facts about one task belong on one row, and
   * a reader scans DOWN the column they care about — usually their own name.
   */
  const src = routes();
  const pdf = backendSource("routes/task_routes/meetingPdf.js");

  assert.match(src, /text: "Task", bold: true/);
  assert.match(src, /text: "Assigned To", bold: true/);
  assert.match(src, /text: "Deadline", bold: true/);
  assert.match(pdf, /<th>Task<\/th><th>Assigned To<\/th><th>Deadline<\/th>/);

  /* An em dash where no date was given, so the column never leaves the reader
     wondering whether one was missed. */
  assert.match(src, /text: r\.due \|\| "—"/);
  assert.match(pdf, /esc\(i\.due \|\| "—"\)/);
});

test(
  "the summary is written WITH the transcript, not by a second press",
  { skip },
  () => {
    /**
     * **The actual complaint.** The box read "No summary has been generated for
     * this meeting yet" because the summary was a separate button nobody had
     * pressed. The answer asked for was not better wording — it was that there
     * should be nothing to press: "generate the Summary and Transcription at
     * the same time from the same meeting communication."
     *
     * So the transcript route summarises what it has just produced, from the
     * TRANSCRIPT rather than from the audio: same communication by
     * construction, and one cheap text call rather than a second pass over
     * fifty minutes of recording.
     */
    const src = routes();
    assert.match(src, /async function summariseFromTranscript\(apiKey, utterances, participantNames, meetTitle\)/);
    assert.match(src, /const made = await summariseFromTranscript\(/);
    assert.match(src, /db\.collection\("meeting_summaries"\)\.doc\(meetId\)/);

    /* It asks for the length that was asked for. */
    assert.match(src, /10 to 15 lines\. Not five, not thirty\./);
    /* And for the things the summary has to carry. */
    for (const must of [
      "the decisions taken and what was agreed",
      "who has to DO it, not the person who asked",
      "Only dates that were actually spoken",
    ]) {
      assert.ok(src.includes(must), `the prompt dropped: ${must}`);
    }

    /* Merged, never overwritten: a richer summary made from the audio keeps its
       dialogue, which this pass cannot produce. */
    assert.match(src, /\{ merge: true \}/);
    assert.match(src, /!\(already\.data\(\)\.conversationFlow \|\| \[\]\)\.length/);

    /* A failed summary must not cost a transcript that worked. */
    assert.match(src, /console\.error\("\[Transcript\] summary step failed:"/);

    /* And the separate audio route is untouched — nothing was removed. */
    assert.match(src, /"\/audio\/summary\/:meetId"/);
  },
);

test("every table declares its columns, so Google Docs can lay it out", { skip }, () => {
  /**
   * **Reported 21 September 2026, with the transcript open in Google Docs.**
   * The three columns had collapsed to one character wide: the header read
   * T-i-m-e down the page and every line of speech was a vertical ribbon.
   *
   * The transcript table declared its own width and never declared its
   * COLUMNS. `docx` only emits a `<w:tblGrid>` when `columnWidths` is given,
   * and without that grid Word infers one from the cells and looks right while
   * Google Docs auto-fits to something unreadable. Every other table in this
   * codebase already carried it — this one was the exception, which is why
   * only this document was wrong.
   *
   * `TableLayoutType.FIXED` is the other half: use the grid as given rather
   * than re-fitting to content, which is what stops a 400-row transcript
   * re-flowing differently on every page.
   */
  const src = routes();

  /* Both tables in the transcript document. */
  assert.match(src, /columnWidths: \[W_TIME, W_WHO, W_TEXT\]/);
  assert.match(src, /columnWidths: \[W_TASK, W_WHO, W_DUE\]/);
  assert.equal(
    (src.match(/layout: TableLayoutType\.FIXED/g) || []).length,
    2,
    "both tables must fix their layout",
  );
  assert.match(src, /TableLayoutType,/, "the enum has to be imported");

  /* And the widths have to add up, or a reader distributes the remainder
     however it likes. */
  assert.match(src, /const W_TEXT = CONTENT_W - W_TIME - W_WHO;/);
  assert.match(src, /const W_DUE = CONTENT_W - W_TASK - W_WHO;/);

  /* The summary document's tables were already right and are left alone. */
  /* A window rather than a brace match: `width: { … }` closes before
     `columnWidths` is reached, so a lazy `[\s\S]*?\}` stops too early and
     reports a grid that is plainly there as missing. */
  const docx = backendSource("routes/task_routes/generateSummaryDocx.js");
  const opens = [...docx.matchAll(/new Table\(\{/g)];
  assert.ok(opens.length >= 3, "the summary document lost a table");
  for (const m of opens) {
    assert.ok(
      docx.slice(m.index, m.index + 400).includes("columnWidths"),
      "a table in the summary document lost its column grid",
    );
  }
});
