import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";

/**
 * The task discussion behaves like the message thread.
 *
 * **Why this is asserted rather than trusted.** The two are separate
 * components over separate storage, and they drifted once already: the task
 * panel was send-only for months while the message thread grew replies,
 * reactions, receipts and a retryable upload. Nothing failed — it simply did
 * less, quietly, and the gap was reported as "task chat is slower" because a
 * silent four-minute upload is indistinguishable from a stuck one.
 *
 * These read source rather than render, in the style of the other parity tests
 * here: what is protected is that a capability is WIRED, which a rendering test
 * of an empty prototype thread cannot show.
 */

const strip = (p: string) =>
  readFileSync(p, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

const PANEL = strip("components/features/tasks/ChatPanel.tsx");
/* The progress row itself, which BOTH threads now render — see
   `UploadProgressRow`. The markup these tests guard used to be written out
   twice; asserting it here keeps the guarantee while there is one copy of it. */
const ROW = strip("components/features/messages/MessageAttachments.tsx");
const STAGE = strip("lib/rules/messages/uploadStage.ts");
const REPO = strip("lib/repositories/legacy/index.ts");
const MOCK = strip("lib/repositories/mock/index.ts");
const TYPES = strip("lib/repositories/types.ts");

/* ── Uploads: the same pipeline, and it says so ───────────────────────────── */

test("files go straight to storage, not through the application server", () => {
  /* The whole reason a large file is viable at all. `uploadMessageAttachment`
     opens a resumable Drive session and PUTs the bytes to Google; the engine
     sees two small JSON calls. A task panel that posted a multipart form to
     the backend instead would buffer half a gigabyte in its memory. */
  assert.match(PANEL, /repo\.uploadMessageAttachment!\(/);
  assert.equal(
    /FormData|multipart/.test(PANEL),
    false,
    "the task panel is posting file bytes to the server",
  );
});

test("upload progress is reported per file, from real bytes", () => {
  /* It showed three bouncing dots for the whole transfer. Over four minutes
     that is not enough to tell working from hung, which is what made an
     identical upload feel slower here than in a direct message. */
  assert.match(PANEL, /repo\.uploadMessageAttachment!\(file, \(fraction\) =>/);
  assert.match(PANEL, /<UploadProgressRow/, "the panel draws no progress row");
  assert.match(ROW, /role="progressbar"/);
});

test("a file still being processed does not look finished", () => {
  /*
   * `uploadToDrive` reports 0–1 across the BYTE TRANSFER only — the finalize
   * call that follows makes the file readable and reports nothing. So the bar
   * reached 100% and sat there, which reads as done on an attachment that was
   * still being handled. That is the reported fault.
   *
   * The row swaps to an indeterminate spinner for that window. It must not keep
   * an `aria-valuenow` while it does: a progressbar pinned at 100 tells a screen
   * reader the opposite of what is true.
   */
  assert.match(ROW, /uploadStage\(fraction\)/);
  assert.match(ROW, /animate-spin/);
  assert.match(ROW, /aria-valuetext=\{uploadStageLabel\(stage\)\}/);
  const processing = ROW.slice(ROW.indexOf("processing ? ("), ROW.indexOf(") : ("));
  assert.equal(
    /aria-valuenow/.test(processing),
    false,
    "the processing stage claims a percentage it does not have",
  );
  assert.match(STAGE, />= 100 \? "processing" : "sending"/);
});

test("Send stays unavailable until the upload actually resolves", () => {
  /* `uploading` clears only after the batch's promises settle — which is after
     the finalize, not at 100%. Both the send control and the canSend rule read
     it, so neither stage of the upload offers a send. */
  assert.match(PANEL, /const canSend = [^;]*&& !uploading/);
  assert.match(PANEL, /disabled=\{!canSend \|\| state\.isPending\}/);
  const finished = PANEL.indexOf("setUploading(false)");
  const awaited = PANEL.indexOf("await Promise.all");
  assert.ok(
    awaited !== -1 && finished > awaited,
    "uploading clears before the uploads have settled",
  );
});

test("a failed upload keeps the file and offers Retry", () => {
  /* Without this a failure at 95% sent somebody back to the file picker — on a
     large file, minutes rather than seconds. */
  assert.match(PANEL, /failedUploads/);
  assert.match(PANEL, /retryFailedUploads/);
  assert.match(PANEL, /file: batch\[i\]\.file/, "the File itself is not kept");
});

test("no number is rounded straight into a style or a label", () => {
  /* `Math.round(undefined)` is NaN: unsayable in `aria-valuenow`, discarded as
     `width: NaN%`, and printed as "NaN%".

     The guard moved into `uploadPercent` when the row became shared, so it now
     protects both threads from one place instead of being written out twice —
     and is asserted on the row and on the rule rather than on the panel that no
     longer contains the markup. */
  for (const [name, src] of [
    ["ChatPanel", PANEL],
    ["the shared row", ROW],
  ] as const) {
    assert.equal(
      /\{Math\.round\([^}]*\)\}%/.test(src),
      false,
      `${name} rounds straight into a label`,
    );
  }
  assert.match(ROW, /uploadPercent\(fraction\)/);
  /* The clamp, at its source: NaN in, 0 out — and never above 100. */
  assert.match(STAGE, /Number\(fraction\) \|\| 0/);
  assert.match(STAGE, /Math\.max\(0, Math\.min\(100, pct\)\)/);
});

/* ── The conversation features ────────────────────────────────────────────── */

test("every message action the thread offers is wired here too", () => {
  for (const [what, needle] of [
    ["reply", /startReply\(/],
    ["edit", /repo\.editTaskChat\(/],
    ["delete", /repo\.deleteTaskChat\(/],
    ["react", /repo\.toggleTaskChatReaction\(/],
    ["star", /repo\.toggleTaskChatStar\(/],
    ["read receipts", /repo\.markTaskChatRead\(/],
  ] as const)
    assert.match(PANEL, needle, `${what} is not wired into the task panel`);
});

test("the menu is the message thread's own component, not a second one", () => {
  /* Two menus would mean two sets of wording for one set of rules. */
  assert.match(PANEL, /<MessageContextMenu/);
  assert.equal(
    /function TaskMessageMenu|function ChatMenu/.test(PANEL),
    false,
    "a rival context menu appeared",
  );
});

test("attachments render through the shared component", () => {
  /* So an image grid, a lightbox, a video player and a download behave the
     same in a task as in a direct message — including the video kind, which
     this thread's own mapper used to file as a generic file. */
  assert.match(PANEL, /<MessageAttachments/);
});

test("a deleted message is shown as deleted, not removed", () => {
  assert.match(PANEL, /This message was deleted\./);
});

/* ── Both repositories, so the prototype is not a smaller product ─────────── */

test("the engine implements every task-chat action", () => {
  for (const m of [
    "editTaskChat",
    "deleteTaskChat",
    "toggleTaskChatReaction",
    "toggleTaskChatStar",
    "markTaskChatRead",
  ])
    assert.match(REPO, new RegExp(`async ${m}\\(`), `${m} is missing from the engine`);
});

test("the in-memory store implements them too", () => {
  /* A surface hides a control the repository lacks. Leaving these out would
     make the task discussion silently lose its menu on the prototype, and be
     reported as missing rather than as unimplemented. */
  for (const m of [
    "editTaskChat",
    "deleteTaskChat",
    "toggleTaskChatReaction",
    "toggleTaskChatStar",
    "markTaskChatRead",
  ])
    assert.match(MOCK, new RegExp(`async ${m}\\(`), `${m} is missing from the mock`);
});

test("the new methods are optional on the interface", () => {
  /* So a repository that does not have them still satisfies the type, and the
     surface asks rather than assuming. */
  for (const m of ["editTaskChat", "deleteTaskChat", "toggleTaskChatReaction"])
    assert.match(TYPES, new RegExp(`${m}\\?\\(`), `${m} is mandatory`);
});

/* ── The read tick means something different here ─────────────────────────── */

test("the receipt uses the task rule, not the direct-message one", () => {
  /* A DM has one other person, so `readBy` being non-empty is the answer. A
     task has several, and the DM rule would turn the tick the moment one of
     five opened the tab. */
  assert.match(PANEL, /taskChatStatus\(/);
  assert.equal(
    /\bmessageStatus\(/.test(PANEL),
    false,
    "the task panel is using the direct-message receipt rule",
  );
});

/* ── Drafts are per task AND per thread ───────────────────────────────────── */

test("an unsent message is kept per task and per thread", () => {
  /* The working and negotiation threads are different conversations; one key
     for both would restore a note into the wrong one. */
  assert.match(PANEL, /`task:\$\{taskId\}:\$\{thread\}`/);
  assert.match(PANEL, /useState\(\(\) => readDraft\(draftKey\)\)/);
  assert.match(PANEL, /clearDraft\(draftKey\)/);
});

/* ── The layout itself ────────────────────────────────────────────────────── */

const THREAD = strip("components/features/messages/MessagesArea.tsx");

test("messages are bubbles, sided like the message thread's", () => {
  /* It was a divided list of rows — avatar, name, timestamp, text — which read
     as a feed rather than a conversation and looked nothing like Messages.
     Own messages take deck ink on the right; everybody else's take the raised
     surface on the left. */
  assert.match(PANEL, /mine \? "items-end" : "items-start"/);
  assert.match(PANEL, /bg-ink text-\[var\(--body-bg\)\]/);
  assert.match(PANEL, /bg-\[var\(--surface-raised\)\] text-ink shadow-\[inset_0_0_0_1px_var\(--color-hairline\)\]/);
  assert.equal(
    /divide-y divide-hairline/.test(PANEL),
    false,
    "the divided list is back",
  );
});

test("the bubble cap is the thread's own, phone figure included", () => {
  /* 88% on a phone and 78% from `sm` up: the desktop figure is a line-length
     decision, and at 360px it left a 74px margin beside every bubble and broke
     short sentences over two lines. Asserted against the thread's own string so
     the two cannot drift apart silently. */
  const cap = /max-w-\[min\(88%,60ch\)\] items-end gap-2 sm:max-w-\[min\(78%,60ch\)\]/;
  assert.match(PANEL, cap);
  assert.match(THREAD, cap, "the thread's cap changed — this one is now stale");
});

test("long unbroken text cannot widen the thread", () => {
  /* `anywhere`, not `break-word`: a pasted token is one indivisible word and
     `break-word` leaves min-content measured on it, so one message gives the
     whole pane a horizontal scrollbar. */
  assert.match(PANEL, /\[overflow-wrap:anywhere\] whitespace-pre-wrap/);
});

test("a run of messages shows one face and one time", () => {
  /* A stamp and an avatar against every line turns a fast exchange into a
     column of near-identical numbers beside near-identical faces. */
  assert.match(PANEL, /const sameRun = continuesRun\(prev, m\)/);
  assert.match(PANEL, /const endsRun = !continuesRun\(m, next\)/);
  assert.match(PANEL, /!mine && !sameRun && person/, "the avatar repeats within a run");
  assert.match(PANEL, /endsRun && \(/, "the timestamp repeats within a run");
});

test("the avatar column is reserved even when empty", () => {
  /* So every bubble in a run keeps one edge rather than shifting left when the
     picture is dropped. */
  assert.match(PANEL, /<span className="w-7 shrink-0">/);
});

test("days are divided, and system lines belong to neither side", () => {
  /* A confirmation or a deadline decision is the engine's own record — it is
     addressed to nobody, so it is centred and quiet rather than bubbled. */
  assert.match(PANEL, /formatDate\(m\.createdAt\)/);
  assert.match(PANEL, /my-2 text-center text-\[11px\]/);
});

test("reaction pills float over the bubble's bottom edge", () => {
  /* A sibling under the bubble, not a row inside it — inside, they stretch the
     bubble taller instead of overlapping it. */
  assert.match(PANEL, /relative z-\[1\] -mt-2 flex flex-wrap/);
});

/* ── Sending feels immediate, despite the longer path ─────────────────────── */

test("a sent message is drawn before the engine confirms it", () => {
  /* The task path is browser → engine → Firestore → back, then a refetch —
     because the engine is what sends everyone the notification. A direct
     message is one Firestore write from the browser. That extra hop is what
     made Send feel slow, and it is not the thing to remove. */
  assert.match(PANEL, /setSending\(\(prev\) => \[\.\.\.prev, optimistic\]\)/);
  assert.match(PANEL, /const shown = useMemo\(/);
  assert.match(PANEL, /\[\.\.\.stored, \.\.\.waiting\]/);
});

test("a failed send puts the message back exactly as it was", () => {
  /* Clearing the composer up front is only safe because of this. The message
     thread deliberately does NOT clear before the result — it has no optimistic
     copy holding the text, so an early clear there would lose a message to a
     dropped connection. Here the copy exists, and the restore is what makes it
     equivalent. */
  const submit = PANEL.slice(PANEL.indexOf("async function submit"));
  const body = submit.slice(0, submit.indexOf("\n  const composerReadOnly"));
  assert.match(body, /setText\(draft\.text\)/);
  assert.match(body, /setPending\(draft\.attachments\)/);
  assert.match(body, /setReplyingTo\(draft\.replyTo\)/);
  /* And the draft on disk survives too: only a SUCCESSFUL send clears it. */
  const clearAt = body.indexOf("clearDraft(draftKey)");
  const okAt = body.indexOf("if (r.ok)");
  assert.ok(clearAt > okAt, "the stored draft is cleared before the send succeeds");
});

test("the optimistic copy is always taken back", () => {
  /* Left behind on failure it would show a message that does not exist; left
     behind on success it would show the same message twice. */
  /* Measured from the SEND, not from the top of `submit` — the edit branch
     above has an `if (r.ok)` of its own and anchoring on that compares the
     wrong two positions. */
  const send = PANEL.slice(PANEL.indexOf("const r = await send()"));
  assert.match(send, /setSending\(\(prev\) => prev\.filter\(\(m\) => m\.id !== optimistic\.id\)\)/);
  assert.ok(
    send.indexOf("m.id !== optimistic.id") < send.indexOf("if (r.ok)"),
    "the copy is dropped inside one branch, so the other outcome leaves it on screen",
  );
});

test("an unsent message offers no actions and claims no receipt", () => {
  /* A reply or a delete aimed at an id the engine has never seen would fail,
     and a tick would report a delivery that has not happened. */
  assert.match(PANEL, /const unsent = m\.id\.startsWith\("pending-"\)/);
  assert.match(PANEL, /onContextMenu=\{\s*unsent\s*\?\s*undefined/);
  assert.match(PANEL, /unsent \? "Sending…" : formatClock/);
  assert.match(PANEL, /mine && !deleted && !unsent && \(/);
});

/* ── Live, and never doubled ──────────────────────────────────────────────── */

test("somebody else's message arrives without anything else happening", () => {
  /* The thread had NO live channel: it read once on mount and again after the
     viewer's own writes, so a colleague's reply never showed up on its own and
     two people on one task each saw half the conversation. */
  assert.match(PANEL, /repo\.watchTaskChat\?\.\(taskId as TaskId\)/);
  assert.match(REPO, /watchTaskChat\(taskId: TaskId\): \(\) => void/);
  assert.match(REPO, /onSnapshot\(\s*\n?\s*collection\(legacyDb\(\), "cowork_tasks", String\(taskId\), "chat"\)/);
  /* Skipping the first snapshot is what stops every open refetching itself. */
  const watch = REPO.slice(REPO.indexOf("watchTaskChat(taskId: TaskId)"));
  assert.match(watch.slice(0, 1400), /if \(first\) \{/);
});

test("a sent message is never drawn twice", () => {
  /* **The duplicate.** The write triggers a refetch of its own, so the stored
     message can arrive BEFORE the promise that would have cleared the
     optimistic copy — and for a second or two both were on screen. Waiting for
     the promise instead leaves a gap where neither is drawn. Matching on
     content is the only thing that holds for every ordering. */
  assert.match(PANEL, /const landed = useMemo\(/);
  /* Keyed on content, since the ids differ — the copy's is local, the stored
     one's is the engine's uuid, so nothing matches them but what they say. */
  assert.ok(
    PANEL.includes("!landed.has(`${m.text} ${m.attachmentIds.length}`)"),
    "the copy is not retired by matching its content against what landed",
  );
  /* Only the viewer's own stored messages can retire a copy — somebody else
     happening to send the same word must not silently drop yours. */
  assert.match(PANEL, /if \(m\.senderId !== viewerId\) continue;/);
});
