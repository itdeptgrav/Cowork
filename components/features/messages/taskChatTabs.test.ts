import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";

/**
 * The Task chat tab inside a direct message.
 *
 * Source-reading, in the style of `taskChatParity.test.ts` beside it: what is
 * protected here is that a capability is WIRED and wired to the one rule that
 * owns it, which a render test against an empty prototype thread cannot show.
 *
 * Every assertion below is a defect somebody would otherwise have to notice by
 * eye, in a pane that looks correct in all of them.
 */

const strip = (p: string) =>
  readFileSync(p, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

const AREA = strip("components/features/messages/MessagesArea.tsx");
const PANEL = strip("components/features/tasks/ChatPanel.tsx");
const PICKER = strip("components/features/messages/TaskChatPicker.tsx");
const CONTEXT_MENU = strip("components/features/messages/MessageContextMenu.tsx");

/* ── The pairing is decided by the rule, not by the component ─────────────── */

test("which tasks appear comes from pairedTaskChats", () => {
  /* The rule excludes closed tasks, orders P1 first and requires BOTH people.
     A filter written inline here would be a second answer to "whose task is
     this", and the two would drift the first time either changed. */
  assert.match(AREA, /pairedTaskChats\(\{/);
  assert.match(AREA, /viewerId,\s*otherId: other\.id,/);
});

test("the pairing is only attempted for a direct message", () => {
  /* A group has no assigner/assignee pair, so there is nothing to pair a task
     thread to. Without this the tabs would appear on a group thread and the
     picker would be empty. */
  assert.match(AREA, /c\.kind === "direct"/);
});

/* ── The tabs appear only where they lead somewhere ───────────────────────── */

test("no shared work means no tabs at all", () => {
  /* A DM with somebody you have never assigned work to must look exactly as it
     did before this feature existed, rather than carrying a dead control on
     every conversation in the list. */
  assert.match(AREA, /const hasTaskChats = taskChats\.length > 0;/);
  assert.match(AREA, /\{hasTaskChats && \(/);
});

test("the pane falls back to the normal thread when the open task goes away", () => {
  /* A task can close, or be reassigned, while its chat is on screen. Without
     the `hasTaskChats` and `openTask !== null` terms the pane would render an
     empty ChatPanel for a task that is no longer paired. */
  assert.match(
    AREA,
    /const showingTask =\s*pane === "task" && hasTaskChats && openTask !== null;/,
  );
});

/* ── The picker ───────────────────────────────────────────────────────────── */

test("the open task is held by id, never by index", () => {
  /* The list re-sorts when a rank changes. An index would silently point at a
     different task after a reorder, and somebody would be typing into a thread
     they did not choose. */
  assert.match(AREA, /useState<string \| null>\(null\)/);
  assert.match(AREA, /taskChats\.find\(\(t\) => t\.taskId === openTaskId\)/);
  assert.equal(
    /openTaskIndex|taskChats\[\s*openTaskI/.test(AREA),
    false,
    "the open task is being tracked positionally",
  );
});

test("the picker owns the chevron only, never the whole segment", () => {
  /* Whatever draws the picker, it must not cover the label: the segment's own
     click is what switches to the Task chat pane. */
  assert.match(AREA, /taskChats\.length > 1 && \(/);
  assert.match(AREA, /<TaskChatPicker/);
  assert.match(PICKER, /rounded-e-full pe-2\.5 ps-0\.5/);
});

/* ── The picker is the product's menu, not the operating system's ─────────── */

test("no native select renders the task list", () => {
  /* THE DEFECT THIS REPLACED. A `<select>` draws its popup with the OS: white
     sheet, system-blue selection, system font, square corners — on a dark
     frosted product that has none of those. `option` takes almost no CSS, so
     there is no version of that control which obeys this design system. */
  assert.equal(/<select/.test(PICKER), false, "the native select is back");
  assert.equal(/<select/.test(AREA), false, "the native select is back");
  assert.equal(/<option/.test(PICKER + AREA), false);
});

test("the menu wears the same surface as the product's other menu", () => {
  /* One menu, not two that merely resemble each other. These four are what
     make a menu look like a menu here; they are read off MessageContextMenu
     rather than written down twice and trusted. */
  for (const token of [
    /frost-bar/,
    /rounded-panel/,
    /border border-hairline/,
    /shadow-\[var\(--deck-seat\)\]/,
  ]) {
    assert.match(CONTEXT_MENU, token, "the incumbent menu changed its surface");
    assert.match(PICKER, token, "the picker has drifted from the incumbent menu");
  }
  assert.match(PICKER, /rounded-inset px-2\.5 py-1\.5/, "menu rows have drifted");
});

test("the keyboard handling a native select gave away is rebuilt", () => {
  /* The whole cost of dropping <select>. Arrow keys, Home/End, Escape, and a
     Tab that closes rather than leaving the menu open behind the focus. */
  for (const key of [/"ArrowDown"/, /"ArrowUp"/, /"Home"/, /"End"/, /"Escape"/, /"Tab"/]) {
    assert.match(PICKER, key, `the menu does not handle ${key}`);
  }
  assert.match(PICKER, /triggerRef\.current\?\.focus\(\)/, "focus is not returned to the trigger");
  assert.match(PICKER, /aria-haspopup="menu"/);
  assert.match(PICKER, /aria-expanded=\{open\}/);
});

test("one of N is stated, not implied by colour", () => {
  /* `menuitemradio` + `aria-checked` is what tells a screen reader this is a
     choice rather than a list of actions. The tick is the visual half; a hue
     would claim to be a score component under The Four Channels Rule. */
  assert.match(PICKER, /role="menuitemradio"/);
  assert.match(PICKER, /aria-checked=\{selected\}/);
  assert.match(PICKER, /Icon\.check/);
});

test("the menu is clamped to the window and can flip above", () => {
  /* It opens from a header inside a scrolling pane. A menu that runs off the
     bottom hides the very task somebody is reaching for. */
  assert.match(PICKER, /useLayoutEffect/);
  assert.match(PICKER, /window\.innerHeight/);
  assert.match(PICKER, /window\.innerWidth/);
  assert.match(PICKER, /maxHeight/);
});

test("the rank keeps its tabular chip", () => {
  /* The Tabular Rule: every figure carries `data-figure`. A P1 must read as
     the same fact here as in the task table. */
  assert.match(PICKER, /data-figure/);
  assert.match(PICKER, /c\.rank !== null \? `P\$\{c\.rank\}` : "—"/);
});

test("a single shared task gets no dropdown", () => {
  /* A menu whose only option is what is already open is a control with
     nothing to decide — and the label takes the chevron's padding back so the
     segment does not sit visibly off-centre. */
  assert.match(AREA, /taskChats\.length > 1 \? "ps-3 pe-1" : "px-3"/);
  assert.match(AREA, /\{taskChats\.length > 1 && \(/);
});

/* ── The shape: a full-width segmented control ────────────────────────────── */

const PRIMITIVES = strip("components/ui/Primitives.tsx");
/* Just the Segmented primitive, so a match cannot be satisfied by some other
   control further down the file. */
const SEGMENTED = PRIMITIVES.slice(PRIMITIVES.indexOf("export function Segmented"));

test("the control is a capsule, per The Capsule Is The Control Rule", () => {
  /* `.impeccable/surfaces/app-tasks-page-tsx.md` §Radius: "If a person can
     click it, it is fully rounded." An earlier pass drew these as browser tabs
     with square top corners — the one shape this system does not have. */
  assert.match(AREA, /rounded-full bg-\[var\(--surface-sunken\)\] p-\[3px\]/);
  assert.equal(
    /rounded-b-\[10px\]|rounded-t-\[10px\]/.test(AREA),
    false,
    "a control is drawing square corners again",
  );
});

test("it spans the pane, and the two segments are structurally identical", () => {
  /* Both segments must be a wrapper div holding a button. `flex-1 basis-0
     min-w-0` on both should split the track evenly whatever they contain, and
     does not: a bare <button> beside a <div> wrapper measured 268 / 244 in the
     real stylesheet — a 24px lean — because the two resolve their flex base
     size differently. Two wrappers measure 256 / 256.

     So the "unnecessary" wrapper around Normal chat is load-bearing, and a
     tidy-up that removes it silently un-levels the control. */
  assert.match(AREA, /className="flex w-full gap-0\.5 rounded-full/);
  const wrappers =
    AREA.match(/relative flex min-w-0 flex-1 items-center rounded-full/g) ?? [];
  assert.equal(
    wrappers.length,
    2,
    "the two segments are no longer structurally identical",
  );
  assert.equal(
    (AREA.match(/min-w-0 flex-1 truncate rounded-full/g) ?? []).length >= 2,
    true,
    "an option is not filling its segment",
  );
});

test("the treatment matches the Segmented primitive, token for token", () => {
  /* Hand-rolled only because the picker is a <select>, which cannot be nested
     inside a <button>. It must still LOOK like every other segmented control
     in the product, so the three tokens that define one are checked against
     the primitive itself rather than written down twice and trusted. */
  for (const token of [
    /rounded-full bg-\[var\(--surface-sunken\)\] p-\[3px\]/,
    /bg-ink text-\[var\(--body-bg\)\]/,
    /text-ink-muted hover:text-ink/,
  ]) {
    assert.match(SEGMENTED, token, "the primitive no longer uses this token");
    assert.match(AREA, token, "the tab strip has drifted from the primitive");
  }
});

test("no hue enters the control", () => {
  /* The Four Channels Rule: saturated colour in Cowork means "score
     component". A selected state carried by a hue would claim to be one. */
  const strip_ = AREA.slice(
    AREA.indexOf('aria-label="Conversations with this person"'),
  ).slice(0, 2000);
  assert.equal(
    /--c[1-4]|text-blue|bg-blue|text-\[var\(--channel/.test(strip_),
    false,
    "a channel hue reached the segmented control",
  );
});

test("arrow keys move between the options", () => {
  /* The primitive gives its options roving arrow keys. Without this the one
     hand-rolled segmented control in the product is also the only one a
     keyboard cannot move through. */
  assert.match(AREA, /e\.key !== "ArrowRight" && e\.key !== "ArrowLeft"/);
  assert.match(AREA, /role="radiogroup"/);
  assert.match(AREA, /tabIndex=\{!showingTask \? 0 : -1\}/);
});

/* ── The thread itself ────────────────────────────────────────────────────── */

test("the task thread is the real ChatPanel, embedded", () => {
  /* Not a second implementation. Replies, reactions, stars, read receipts,
     retryable uploads, drag-and-drop and per-task drafts all already live in
     that component — a copy here would be the send-only log the task panel
     spent months being. */
  assert.match(AREA, /<ChatPanel/);
  assert.match(AREA, /embedded\s*\/>/);
});

test("switching task remounts the panel, so drafts cannot leak between tasks", () => {
  /* The panel holds a draft, a reply quote and a staged upload batch per task.
     Reconciling instead of remounting would carry one task's half-written
     message into another task's composer. */
  assert.match(AREA, /key=\{openTask\.taskId\}/);
});

test("embedded drops the panel chrome rather than nesting a panel in a panel", () => {
  /* The thread pane is already a frosted Panel. A second one a few pixels
     inside it is the box-inside-a-box the design system rules out. */
  assert.match(PANEL, /embedded = false/);
  assert.match(PANEL, /return embedded \? \(/);
  assert.match(PANEL, /\{!embedded && \(/);
});

test("embedded scrolls the message list, not the page", () => {
  /* Without `min-h-0` a flex child refuses to shrink below its content, the
     column grows to the full length of the thread, and the composer leaves the
     bottom of the screen — the same defect the messages pane itself was fixed
     for. */
  assert.match(PANEL, /min-h-0 flex-1 overflow-y-auto/);
});

test("embedded is always the working thread", () => {
  /* The negotiation thread is a separate legacy route that is not wired:
     `listTaskChat` returns [] for it and `sendTaskChat` refuses. Offering it
     in a direct message would be offering an empty box that cannot be posted
     to. */
  assert.match(PANEL, /embedded \|\| started \? "chat" : "draft"/);
});

/* ── Forwarding, which shares this component ──────────────────────────────── */

test("forwarding opens the conversation it was forwarded to", () => {
  /* `ForwardDialog` hands back the destination's ID. It was being printed into
     a toast — "Forwarded to dm_GR0045_GR0108." — and going nowhere, so the
     sender was left in the thread they forwarded FROM with no way to see
     whether it landed. */
  assert.match(AREA, /function openForwarded\(id: string\)/);
  assert.match(AREA, /onForwarded=\{openForwarded\}/);
  assert.match(AREA, /onForwarded=\{onForwarded\}/);
  assert.equal(
    /Forwarded to \$\{where\}/.test(AREA),
    false,
    "the destination id is being rendered as if it were a name",
  );
});

test("the forward invalidates the conversation list before navigating", () => {
  /* `listConversations` carries a 30s staleTime whose cache is keyed without
     the repository version, so the send that just happened does not clear it.
     Without this the destination opens showing the preview it had BEFORE the
     forwarded message arrived. */
  const fn = AREA.slice(AREA.indexOf("function openForwarded"));
  assert.match(fn.slice(0, 300), /invalidateQuery\("listConversations"\)/);
});

/* ── The tab names the task, and carries its brief ────────────────────────── */

test("the segment shows the priority and the subject, not the words 'Task chat'", () => {
  /* The kind of thread is learned once; WHICH task is the thing a reader needs
     every time, and it was being spent on a row underneath. */
  assert.match(AREA, /\{openTask \? taskChatLabel\(openTask\) : "Task chat"\}/);
  /* The same builder the picker rows use, so a tab and its menu row can never
     read differently for one task. */
  assert.match(AREA, /taskChatLabel,/);
});

test("the accessible name still says it is a chat", () => {
  /* Out of context "P1 · Redesign the deck" does not say it is a conversation,
     and this is one radio of a pair. */
  assert.match(AREA, /Task chat — \$\{taskChatLabel\(openTask\)\}/);
});

test("the row under the tab is the brief, not a repeat of the title", () => {
  assert.match(AREA, /<TaskChatBrief chat=\{openTask\} \/>/);
  /* The old row printed the rank and title a second time, directly under a
     segment that now carries both. */
  assert.doesNotMatch(AREA, /openTask\.rank !== null \? `P\$\{openTask\.rank\}`/);
});

test("the brief is a disclosure, closed at rest", () => {
  /* A brief can run several paragraphs; open by default would push the newest
     message off a short pane to show text that never changes. */
  const brief = strip("components/features/messages/TaskChatBrief.tsx");
  assert.match(brief, /useState\(false\)/);
  assert.match(brief, /aria-expanded=\{open\}/);
});

test("it lists the deliverables in the task's own order, and says when there are none", () => {
  const brief = strip("components/features/messages/TaskChatBrief.tsx");
  assert.match(brief, /Deliverables/);
  assert.match(brief, /None listed — this task is delivered as a whole\./);
  assert.match(brief, /No brief was written for this task\./);
  /* Numbered from the order the rule sorted them into, never re-sorted here. */
  assert.match(brief, /outputs\.map\(\(o, i\) =>/);
});

test("the brief carries no controls, only a way through to the task", () => {
  /* A half-version of an approval chain in a 280px column would invite
     somebody to act on it. */
  const brief = strip("components/features/messages/TaskChatBrief.tsx");
  assert.match(brief, /href=\{`\/tasks\/\$\{chat\.taskId\}`\}/);
  assert.doesNotMatch(brief, /useAction|onApprove|needsOutputIds/);
});

test("the brief and deliverables ride on the pairing, costing no second read", () => {
  const rule = strip("lib/rules/messages/taskChats.ts");
  assert.match(rule, /description: v\.task\.description/);
  assert.match(rule, /\.sort\(\(a, b\) => a\.order - b\.order\)/);
});
