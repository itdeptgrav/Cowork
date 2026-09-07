import assert from "node:assert/strict";
import { test } from "node:test";
import {
  leaveMessage,
  leaveReason,
  mustAsk,
  canDecline,
  saveLabel,
  type CloudState,
  type FileState,
} from "./leaveGuard.ts";

const why = (cloud: CloudState, file: FileState = "none", edited = true) =>
  leaveReason({ cloud, file, edited });

test("a sheet nobody changed closes without a question", () => {
  /* Opened, read, closed. There is nothing to report, and a dialog here is the
     one people learn to dismiss without reading. */
  assert.equal(why("saved", "none", false), "clean");
  assert.equal(why("saved", "saved", false), "clean");
  assert.equal(mustAsk("clean"), false);
});

test("a sheet that WAS changed confirms, even once it is saved", () => {
  /* Both stores autosave a second after you stop typing, so a guard watching
     only the write state let Close through in silence — indistinguishable
     from a sheet that never saved at all. */
  assert.equal(why("saved"), "saved");
  assert.equal(why("saved", "saved"), "saved");
  assert.equal(mustAsk("saved"), true);
});

test("a sheet still opening is not unsaved", () => {
  /* Nothing has been typed into a sheet that has not finished loading, and
     holding somebody inside one would be a trap. */
  assert.equal(why("loading", "none", false), "clean");
});

test("a save still on the wire asks", () => {
  assert.equal(why("saving"), "cloud_pending");
  assert.equal(mustAsk("cloud_pending"), true);
});

test("a save that failed asks, and says so differently", () => {
  for (const s of ["offline", "error", "conflict"] as CloudState[])
    assert.equal(why(s), "cloud_failed", `${s} should read as a failure`);
});

test("the file on the computer is checked too, not just Cowork", () => {
  /* A sheet safely in Cowork whose file write was denied has still lost the
     thing the person was watching. */
  assert.equal(why("saved", "saving"), "file_pending");
  assert.equal(why("saved", "denied"), "file_failed");
  assert.equal(why("saved", "error"), "file_failed");
});

test("a failure outranks a pending write", () => {
  /* A pending write resolves itself in a second; a failure will not resolve
     without a decision, and it is the one worth the sentence. */
  assert.equal(why("offline", "saving"), "cloud_failed");
  assert.equal(why("saving", "denied"), "file_failed");
});

test("Cowork's own failure outranks the file's", () => {
  /* The file is a copy; the workbook is where the sheet lives. */
  assert.equal(why("error", "denied"), "cloud_failed");
});

test("a pending cloud save outranks a pending file write", () => {
  assert.equal(why("saving", "saving"), "cloud_pending");
});

test("every reason that asks has something to say", () => {
  const reasons = [
    "cloud_pending",
    "cloud_failed",
    "file_pending",
    "file_failed",
  ] as const;
  for (const r of reasons) {
    assert.ok(mustAsk(r), `${r} should ask`);
    assert.ok(leaveMessage(r).length > 20, `${r} has no message`);
  }
  /* And the one that does not ask says nothing, so a caller cannot render an
     empty dialog by accident. */
  assert.equal(leaveMessage("clean"), "");
});

test("no message promises to undo anything", () => {
  /* Autosave has already stored everything up to the last debounce. Nothing
     here can revert that, and a dialog implying otherwise would be a lie. */
  for (const r of ["cloud_pending", "cloud_failed", "file_pending", "file_failed"] as const) {
    const m = leaveMessage(r).toLowerCase();
    assert.ok(!m.includes("discard"), `${r} implies a revert`);
    assert.ok(!m.includes("your changes will be lost"), `${r} overclaims`);
  }
});

test("Save says it is a retry where the last attempt failed", () => {
  /* A Save that silently fails and closes anyway is worse than no button. */
  assert.equal(saveLabel("cloud_pending"), "Save");
  assert.equal(saveLabel("file_pending"), "Save");
  assert.equal(saveLabel("cloud_failed"), "Try saving again");
  assert.equal(saveLabel("file_failed"), "Try saving again");
});

test("the file state is ignored when no file is bound", () => {
  const states: CloudState[] = ["saved", "saving", "offline"];
  for (const c of states)
    assert.equal(why(c, "none"), why(c), `${c} changed with an unbound file`);
});

/* ── Saved edits still confirm, but offer no "Don't save" ─────────────────── */

test("Don't save is offered only where there is a write to decline", () => {
  /* With everything stored there is nothing to not-save: autosave cannot be
     undone, so the button would either do nothing or imply a revert. */
  assert.equal(canDecline("saved"), false);
  assert.equal(canDecline("clean"), false);
  for (const r of ["cloud_pending", "cloud_failed", "file_pending", "file_failed"] as const)
    assert.equal(canDecline(r), true, `${r} should offer it`);
});

test("with nothing outstanding the main button is the way out, not a save", () => {
  /* Labelling it "Save" would claim an action that does nothing. */
  assert.equal(saveLabel("saved"), "Close");
});

test("a failure is named even on a sheet that reads as unedited", () => {
  /* A save can only fail if there was something to save, so the flag being
     missed must not swallow the one message that matters. */
  assert.equal(leaveReason({ cloud: "error", file: "none", edited: false }), "cloud_failed");
  assert.equal(leaveReason({ cloud: "saved", file: "denied", edited: false }), "file_failed");
});

test("the saved message states the fact rather than warning about it", () => {
  const m = leaveMessage("saved");
  assert.match(m, /saved/i);
  assert.ok(!m.toLowerCase().includes("lost"), "it should not warn");
});
