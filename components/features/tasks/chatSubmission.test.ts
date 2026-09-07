import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";

/**
 * Submitting work, and deciding on it, from the task's own thread.
 *
 * Source-reading, like `taskChatParity.test.ts` beside it. What is protected
 * here is mostly NEGATIVE: that neither flow was rebuilt at chat size. A
 * handover numbers an attempt, resolves a review chain and checks the task's
 * requirements; a decision can waive a deduction, name failed criteria, carry
 * correction files and re-rank returned work. A bubble-sized copy of either
 * would look finished and quietly skip all of it.
 */

const strip = (p: string) =>
  readFileSync(p, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

const PANEL = strip("components/features/tasks/ChatPanel.tsx");
const CARD = strip("components/features/tasks/TaskChatSubmission.tsx");
/* Just the notice. Sliced to its own function because the same file holds the
   submission card, whose chip and buttons carry the same utility classes — an
   unbounded slice let those vouch for assertions about this one. */
const NOTICE = CARD.slice(
  CARD.indexOf("export function TaskNotStartedNotice"),
  CARD.indexOf("export function ChatSubmissionCard"),
);

/* ── One attach control, offering two kinds of attachment ─────────────────── */

const COMPOSER = strip("components/features/messages/CardComposer.tsx");
const THREAD = strip("components/features/messages/MessagesArea.tsx");

test("there is ONE attach control on the composer, not two", () => {
  /* It was a `+` beside a paperclip, and the paperclip opened the file picker
     — which is the first row of the menu the `+` opened. Two buttons a pixel
     apart, one a shortcut into the other, and no rule to tell them apart. */
  assert.match(PANEL, /<CardComposer/);
  assert.doesNotMatch(PANEL, /aria-label="Attach a file"/);
  assert.doesNotMatch(THREAD, /aria-label="Attach a file"/);
  /* The panel no longer owns menu state; the shared composer does. */
  assert.doesNotMatch(PANEL, /setAttachMenu/);
});

test("the one control wears the paperclip, not a plus", () => {
  /* Attaching is what it is opened for; `+` said "more" and left the common
     case unlabelled. */
  assert.match(COMPOSER, /<Icon\.attach className="h-4 w-4" \/>/);
  assert.doesNotMatch(COMPOSER, /<Icon\.plus className="h-4 w-4" \/>/);
  assert.match(COMPOSER, /aria-label="Attach"/);
});

test("task chat offers a file for the conversation and a file as the work", () => {
  /* The same PDF can be a reference to look at or the work being handed over.
     Only the second starts a review, so it must not be guessed from the file. */
  assert.match(COMPOSER, /label: "Photos & files"/);
  assert.match(PANEL, /submission=\{/);
  assert.match(COMPOSER, /id: "submission"/);
});

test("the second option says UPDATE once work has been sent", () => {
  /* Submitting again does not add a second submission beside the first — the
     engine overwrites the record in place and the attempt goes up. A menu
     still offering to "add" one invites somebody to think they are filing a
     separate thing when they are replacing what their reviewer is holding. */
  assert.match(
    PANEL,
    /hasSubmitted\s*\n?\s*\?\s*"Update submission"\s*\n?\s*:\s*"Add submission"/,
  );
  assert.match(PANEL, /Replaces what you sent and starts the review again\./);
});

test("the wording keys on ANY past submission, not the open one", () => {
  /* Work returned for rework has no OPEN submission, and the next send is
     still a replacement. Gating on the open one would flip the menu back to
     "Add submission" at exactly the moment somebody is resubmitting. */
  assert.match(PANEL, /const hasSubmitted = \(submissions\?\.length \?\? 0\) > 0;/);
});

test("each option says what it will do before it is chosen", () => {
  /* "Add submission" is irreversible in the way that matters: it moves the
     task and puts it in front of a reviewer. The consequence belongs on the
     menu item, not in a toast afterwards. */
  assert.match(COMPOSER, /Sent with your message\. Nothing is reviewed\./);
  assert.match(PANEL, /Hands the work over and starts its review\./);
  /* And only where there are two kinds to tell apart — a direct message needs
     no gloss on "Photos & files". */
  assert.match(COMPOSER, /hint: submission \?/);
});

test("the plain attach still opens the file picker", () => {
  assert.match(PANEL, /onPickFiles=\{\(\) => fileRef\.current\?\.click\(\)\}/);
  assert.match(COMPOSER, /run: \(\) => \{ setMenuOpen\(false\); onPickFiles\(\); \}/);
});

test("the menu opens upward, off a composer at the foot of the pane", () => {
  /* Dropped downward it would open past the end of the thread. */
  assert.match(COMPOSER, /absolute bottom-full left-0/);
});

test("clicking away closes the menu", () => {
  /* A menu that only closes on its own items is one somebody has to choose
     their way out of. */
  assert.match(COMPOSER, /document\.addEventListener\("mousedown", onDown\)/);
});

/* ── Neither flow is reimplemented ────────────────────────────────────────── */

test("the handover dialog mounts the REAL SubmissionPanel", () => {
  /* A rule that changes in the Submission tab changes here in the same edit,
     because it is the same component. */
  assert.match(PANEL, /<SubmissionPanel/);
  assert.match(PANEL, /import \{ SubmissionPanel \}/);
});

/**
 * CHANGED ON PURPOSE — OWNER DECISION.
 *
 * This previously asserted the card carried NO decision form: Approve and
 * Rework were two buttons that opened `ReviewPanel` in a dialog. The owner's
 * call is that the decision box belongs on the card itself, and it is right —
 * a second screen in front of two options and a sentence is a step nobody
 * needed.
 *
 * What the old test was protecting still holds, and is asserted below in a
 * stronger form: the card must host the REAL decision component, never a
 * chat-sized copy of it.
 */
test("the decision box on the card IS the review tab's, not a copy", () => {
  assert.match(CARD, /<ReviewDecisionBox/);
  assert.match(CARD, /import \{ ReviewDecisionBox \} from "\.\/ReviewPanel"/);
  /* The rules a copy would have skipped. If any of these appear HERE, the
     card has started being a second review screen and the two will drift. */
  for (const forbidden of [
    /reviewSubmission/,
    /reviewOutput/,
    /waiveDeduction/,
    /reworkRequirements/,
    /<Textarea/,
  ]) {
    assert.equal(
      forbidden.test(CARD),
      false,
      `the chat card is reimplementing the review form: ${forbidden}`,
    );
  }
});

test("the decision no longer costs a dialog, but the handover still does", () => {
  /* Submitting carries files, requirement checks and an attempt number, so it
     earns a screen. Deciding does not. */
  assert.match(PANEL, /flow === "submit" && taskView/);
  assert.equal(
    /"review"/.test(PANEL),
    false,
    "the review dialog is back in the thread",
  );
});

test("the shared box drops its frame on the card, not its function", () => {
  /* `compact` exists only to remove the Panel — a panel inside the card is the
     box-inside-a-box the design system rules out. It must not become a switch
     that hides fields. */
  assert.match(CARD, /compact\b/);
  const review = strip("components/features/tasks/ReviewPanel.tsx");
  assert.match(review, /export function ReviewDecisionBox/);
  assert.match(
    review,
    /return compact \? <div>\{body\}<\/div> : <Panel>\{body\}<\/Panel>;/,
    "compact is doing more than removing the frame",
  );
});

test("the dialog lets the panel inside be the surface", () => {
  /* SubmissionPanel and ReviewPanel each render their own Panel. A frosted
     dialog shell around one puts a panel inside a panel — the box-inside-a-box
     the design system rules out — and draws two borders a few pixels apart.

     Matched on the CLASS, not the bare word: the dialog now names
     `--frost-panel-solid` in a style override, which makes the panel inside it
     opaque — and a search for "frost-panel" hits that token too, so the loose
     version failed on a change that was the opposite of painting a surface. */
  assert.equal(
    /className="[^"]*frost-(bar|panel)/.test(
      CARD.slice(
        CARD.indexOf("TaskPanelDialog"),
        CARD.indexOf("ChatSubmissionCard"),
      ),
    ),
    false,
    "the dialog is painting a surface of its own",
  );
  assert.match(CARD, /aria-modal="true"/);
  assert.match(CARD, /e\.key === "Escape"/);
});

/* ── Which submission, and whose decision ─────────────────────────────────── */

test("the card is driven by task state, not by matching the engine's sentence", () => {
  /* The engine writes "✅ … submitted work for completion review". Matching
     that English would break the day it is reworded or translated, and would
     pin a LIVE decision to a historical line in the thread. */
  assert.match(PANEL, /listSubmissions/);
  assert.equal(
    /submitted work for completion/i.test(PANEL),
    false,
    "the thread is pattern-matching the engine's wording",
  );
});

test("a superseded attempt is not offered for decision", () => {
  /* A resubmission replaces the attempt before it. Showing both would put two
     live decisions in one thread for one piece of work. */
  assert.match(PANEL, /!s\.supersededById/);
});

test("a DECIDED submission leaves the thread, superseded or not", () => {
  /* THE REPORTED BUG. `!supersededById` alone reads a submission sent back for
     rework as still open — it has no replacement yet — so the card sat under
     the very message announcing the rework, telling the assignee their
     returned work was "waiting on your reviewer". The rule that answers this
     properly is `awaitsDecision`, and it is tested for real in
     lib/rules/tasks/outputs.test.ts rather than only asserted here. */
  assert.match(PANEL, /awaitsDecision\(\{/);
  assert.match(PANEL, /taskStatus: taskView\.task\.status/);
  assert.match(PANEL, /openSubmissions: taskView\.openSubmissions \?\? \[\]/);
});

test("the review gates are imported, never restated", () => {
  /* A third copy of the rule is a third chance to offer somebody a decision
     the backend then refuses — which is the exact defect the review screen's
     own hard-coded copy once caused. */
  assert.match(CARD, /from "@\/lib\/rules\/tasks\/reviewChain"/);
  assert.match(CARD, /from "@\/lib\/rules\/tasks\/outputs"/);
  assert.match(CARD, /submittedById: submission\.submittedById/);
  assert.match(CARD, /currentStage: submission\.currentStage/);
});

test("somebody who cannot decide is told why, not shown nothing", () => {
  /* A missing button reads as a fault; a sentence reads as a rule. */
  assert.match(CARD, /Waiting on your reviewer\./);
  assert.match(CARD, /This is with its reviewer\./);
});

/* ── A task that has not started says so, and offers the way in ──────────── */

test("an unstarted task explains the empty pane instead of just being empty", () => {
  /* THE REPORTED GAP. "No messages yet" was true and useless: the task was
     sitting on the reader's own decision and the pane said nothing about it. */
  assert.match(CARD, /This task has not started yet/);
  assert.match(PANEL, /<TaskNotStartedNotice/);
});

test("what the task is waiting for comes from nextAction, not a status check", () => {
  /* The resolver the task page's own "Your move" banner uses. A hand-written
     branch here could say the deadline needs approving when what the task
     actually wants is the assignment confirmed. */
  assert.match(PANEL, /nextAction\(taskView, viewerId \?\? ""\)/);
  assert.match(PANEL, /import \{ nextAction \}/);
});

test("the notice stands in for the empty state rather than stacking on it", () => {
  /* Two explanations of one blank pane is one too many. */
  assert.match(PANEL, /\) : gate \? \(/);
});

test("the button prefers the resolver's own href", () => {
  /* `nextAction` knows whether the decision lives on the deadline tab or the
     overview. Falling straight to /tasks/{id} would land people one more
     click away from the thing they came to do. */
  assert.match(CARD, /action\.href \?\? `\/tasks\/\$\{taskId\}`/);
});

test("the notice is embedded-only", () => {
  /* On the task page the same sentence is already on screen in the "Your move"
     banner. Two copies of one rule on one screen is how they come to
     disagree. */
  assert.match(PANEL, /embedded && !started && taskView/);
});

test("the notice is the pane speaking, not a card in the thread", () => {
  /* OWNER RULE. An empty state is not an object sitting IN the conversation —
     there is no conversation yet. The border and fill made it read as one. */
  const root = NOTICE.slice(NOTICE.indexOf("<div"), NOTICE.indexOf("</p>"));
  assert.equal(
    /border|bg-\[var\(--surface-sunken\)\]/.test(root),
    false,
    "the notice has grown a container again",
  );
  assert.match(root, /text-center/);
});

test("the button stands as tall as the Task chat segment above it", () => {
  /* Measured at 32px against both. Two capsules of different heights on one
     narrow pane read as two different kinds of control — so this carries the
     tab strip's own option treatment rather than a smaller one. */
  assert.match(NOTICE, /py-1\.5 text-sm font-medium tracking-\[-0\.012em\]/);
  assert.equal(
    /rounded-full[^`]*text-xs/.test(NOTICE),
    false,
    "the button has shrunk below the segment height again",
  );
});

test("the button's words follow whose move it is", () => {
  /* "Review the task" to somebody who must act; "Open the task" to somebody
     who is waiting on another person. Telling a bystander to review something
     is an instruction they cannot carry out. */
  assert.match(CARD, /yours \? "Review the task" : "Open the task"/);
});

/* ── What the assignee wrote ──────────────────────────────────────────────── */

test("the submission's own message is shown with it", () => {
  /* THE REPORTED GAP. The thread announced that work had been submitted and
     then withheld the one thing the reviewer needed to read. */
  assert.match(CARD, /submission\.message/);
  assert.match(CARD, /whitespace-pre-wrap/, "a multi-line note is being collapsed");
});

test("a submission with no note says so rather than showing a blank", () => {
  assert.match(CARD, /No note was written with this submission\./);
});

test("the submitted files are listed, with their names", () => {
  /* `attachmentIds` is bare URLs; `attachments` carries the names and download
     links. Listing the first would give the reviewer nothing clickable. */
  assert.match(CARD, /submission\.attachments/);
  assert.match(CARD, /SubmittedFiles/);
});

test("the attempt and lateness travel with it", () => {
  assert.match(CARD, /Attempt \{submission\.attempt\}/);
  assert.match(CARD, /submission\.wasLate/);
});

/* ── Only the assignee hands work over ────────────────────────────────────── */

test("submitting is offered only to the person doing the work", () => {
  /* THE REPORTED BUG. The assigner saw "Update submission" — they have nothing
     to hand in, they are the one being handed TO, and the form behind it would
     have refused them. */
  assert.match(PANEL, /const canSubmitHere =/);
  assert.match(PANEL, /holds === "yes"/);
  assert.match(PANEL, /viewerHolds\(\{/);
  assert.match(PANEL, /import \{ viewerHolds \}/);
});

test("an unresolved viewer hides the option rather than refusing them", () => {
  /* `viewerHolds` answers "unknown" while the viewer is being read. Gating on
     `!== "no"` would offer submission to a person nobody has identified;
     gating on `=== "yes"` hides it for that moment and shows it when they
     land. Asserting the shape, because `!== "no"` is the tempting typo. */
  assert.equal(
    /holds !== "no"/.test(PANEL),
    false,
    "the gate admits an unidentified viewer",
  );
});

test("the gate matches the form it opens, condition for condition", () => {
  /* "A control that exists only to be refused is worse than no control."
     These are SubmissionPanel's own three; if they drift, the menu starts
     offering a handover the panel declines. */
  assert.match(PANEL, /taskView\.task\.outputs\.length === 0/);
  assert.match(PANEL, /taskView\.task\.status === "in_progress"/);
  const submission = strip("components/features/tasks/SubmissionPanel.tsx");
  assert.match(submission, /isAssignee && !deliversByOutput && view\.task\.status === "in_progress"/);
});

test("somebody who cannot submit is not offered the row", () => {
  /* A control that exists only to be refused is worse than no control. The
     other rows — poll, location, contact — are unaffected, so the menu itself
     still opens; it simply holds one fewer thing. */
  assert.match(PANEL, /canSubmitHere\s*\n?\s*\?\s*\{/);
  assert.match(PANEL, /:\s*undefined\s*\n\s*\}/);
  assert.match(COMPOSER, /\.\.\.\(submission/);
});

test("the trigger always announces a menu, because there always is one", () => {
  /* The old paperclip sometimes opened a file picker directly, so its ARIA had
     to be conditional. This control always opens the same menu — poll, location
     and contact are there for everybody — so it can say so plainly. */
  assert.match(COMPOSER, /aria-haspopup="menu"/);
  assert.match(COMPOSER, /aria-expanded=\{menuOpen\}/);
});
