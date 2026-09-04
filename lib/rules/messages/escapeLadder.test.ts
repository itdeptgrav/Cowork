import assert from "node:assert/strict";
import { test } from "node:test";
import {
  escapeAction,
  type ThreadEscapeState,
} from "./escapeLadder.ts";

/** Nothing open, and leaving is possible — the ordinary case. */
const IDLE: ThreadEscapeState = {
  modalOpen: false,
  menuOpen: false,
  forwarding: false,
  groupSettingsOpen: false,
  editing: false,
  replying: false,
  searchOpen: false,
  canClose: true,
};

test("Escape in a plain open thread leaves the conversation", () => {
  assert.equal(escapeAction(IDLE), "close-thread");
});

test("a modal swallows Escape entirely, whatever else is open", () => {
  /* The bug this ordering exists for: both the lightbox and the thread listen
     on `document`, so without this rung, dismissing a photo would dismiss the
     conversation behind it too. */
  assert.equal(escapeAction({ ...IDLE, modalOpen: true }), "none");
  assert.equal(
    escapeAction({ ...IDLE, modalOpen: true, searchOpen: true }),
    "none",
  );
  assert.equal(
    escapeAction({ ...IDLE, modalOpen: true, editing: true }),
    "none",
    "a modal outranks even an edit in progress",
  );
});

test("the search bar closes before the thread does", () => {
  /* Two presses to leave a thread you were searching in, not one — the first
     press must not throw away the search AND the conversation together. */
  assert.equal(escapeAction({ ...IDLE, searchOpen: true }), "close-search");
});

test("a message being edited is cancelled before anything else is", () => {
  assert.equal(escapeAction({ ...IDLE, editing: true }), "cancel-edit");
  assert.equal(
    escapeAction({ ...IDLE, editing: true, searchOpen: true }),
    "cancel-edit",
    "an edit in progress outranks a search bar left open behind it",
  );
});

test("a reply being composed is cancelled before the thread closes", () => {
  assert.equal(escapeAction({ ...IDLE, replying: true }), "cancel-reply");
});

test("transient overlays each take their own press", () => {
  assert.equal(escapeAction({ ...IDLE, menuOpen: true }), "close-menu");
  assert.equal(escapeAction({ ...IDLE, forwarding: true }), "close-forward");
  assert.equal(
    escapeAction({ ...IDLE, groupSettingsOpen: true }),
    "close-group-settings",
  );
});

test("the innermost thing wins when several are open at once", () => {
  const many: ThreadEscapeState = {
    ...IDLE,
    menuOpen: true,
    forwarding: true,
    groupSettingsOpen: true,
    editing: true,
    replying: true,
    searchOpen: true,
  };
  assert.equal(escapeAction(many), "close-menu");
  assert.equal(escapeAction({ ...many, menuOpen: false }), "close-forward");
  assert.equal(
    escapeAction({ ...many, menuOpen: false, forwarding: false }),
    "close-group-settings",
  );
});

test("a caller with nowhere to go does not pretend to close", () => {
  /* Better to stop at the rung above than to fire a close that changes
     nothing — that is precisely what made Escape look broken when the wide
     layout re-defaulted straight back into the thread just closed. */
  assert.equal(escapeAction({ ...IDLE, canClose: false }), "none");
});

test("a caller with nowhere to go still backs out of what IS open", () => {
  /* `canClose` gates the last rung only — everything above it still works. */
  assert.equal(
    escapeAction({ ...IDLE, canClose: false, searchOpen: true }),
    "close-search",
  );
  assert.equal(
    escapeAction({ ...IDLE, canClose: false, editing: true }),
    "cancel-edit",
  );
});

test("every rung is reachable — no state is shadowed into being dead", () => {
  /* A guard against a careless reorder making one branch unreachable: each
     action must be produced by exactly the state that names it. */
  const reached = new Set([
    escapeAction({ ...IDLE, modalOpen: true }),
    escapeAction({ ...IDLE, menuOpen: true }),
    escapeAction({ ...IDLE, forwarding: true }),
    escapeAction({ ...IDLE, groupSettingsOpen: true }),
    escapeAction({ ...IDLE, editing: true }),
    escapeAction({ ...IDLE, replying: true }),
    escapeAction({ ...IDLE, searchOpen: true }),
    escapeAction(IDLE),
  ]);
  assert.equal(reached.size, 8);
});

/* ── Rungs added for the composer features ──────────────────────────────── */

test("the mention picker is backed out of before the reply it was opened inside", () => {
  /**
   * The picker is opened by typing `@` INSIDE an edit or a reply, so it is
   * always the innermost thing on screen. A rung below them would close the
   * reply while its own autocomplete was still showing.
   */
  assert.equal(
    escapeAction({ ...IDLE, mentionPickerOpen: true, replying: true }),
    "close-mention-picker",
  );
  assert.equal(
    escapeAction({ ...IDLE, mentionPickerOpen: true, editing: true }),
    "close-mention-picker",
  );
});

test("a recording is cancelled before an edit or a reply is", () => {
  /* An edit or a reply survives being backed out of — the text is still in the
     composer and the draft keeps it. A recording that loses its rung keeps
     running with no obvious way to stop it. */
  assert.equal(
    escapeAction({ ...IDLE, recording: true, editing: true, replying: true }),
    "cancel-recording",
  );
});

test("a recording still yields to anything modal", () => {
  assert.equal(escapeAction({ ...IDLE, recording: true, modalOpen: true }), "none");
});

test("a recording is cancelled rather than the thread being left", () => {
  /* The rung that matters most: without it, Escape during a recording would
     drop the reader out of the conversation with the microphone still live. */
  assert.equal(escapeAction({ ...IDLE, recording: true }), "cancel-recording");
});

test("the new rungs are absent-safe, so a surface that has neither is unchanged", () => {
  /* Both are optional precisely so a caller that predates them — or a surface
     with no composer at all — keeps its exact previous ladder. */
  assert.equal(escapeAction(IDLE), "close-thread");
  assert.equal(escapeAction({ ...IDLE, searchOpen: true }), "close-search");
  assert.equal(
    escapeAction({ ...IDLE, mentionPickerOpen: false, recording: false }),
    "close-thread",
  );
});
