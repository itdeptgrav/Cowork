/**
 * Whether closing a sheet has to ask first, and what to say.
 *
 * ## What was wrong
 *
 * Leaving an open sheet — the back arrow, or the browser's own back button —
 * closed it on the spot. A sheet autosaves, so *usually* nothing was lost; but
 * "usually" is not something a person can see, and the two cases that are NOT
 * safe look identical to the one that is:
 *
 *   · a save still on the wire, holding the last second or two of typing;
 *   · a save that FAILED — offline, a conflict, a file whose permission was
 *     refused — where the edits are on screen and nowhere else.
 *
 * So the sheet closed and you could not tell whether your work had been stored.
 * That is the complaint this answers.
 *
 * ## Two stores, either of which can be behind
 *
 * A sheet is saved to Cowork, and — when it was opened from a file on the
 * computer and bound to it — written back to that file too. Either can be mid
 * write or broken, and both have to be checked: a sheet safely in Cowork whose
 * file write was denied has still lost the thing the person was watching.
 *
 * ## A failure outranks a pending write
 *
 * When both are unhappy the dialog names the failure. A pending write resolves
 * itself in a second; a failure will not resolve without a decision, and it is
 * the one worth spending the sentence on. Cowork's own store outranks the file
 * for the same reason it is the durable one: the file is a copy, the workbook
 * is where the sheet lives.
 *
 * ## Why "Don't save" cannot mean "undo"
 *
 * Autosave has already stored everything up to the last debounce. Nothing here
 * can revert that, and a button implying otherwise would be a lie. "Don't
 * save" means *leave without waiting for the outstanding write*, and
 * `leaveMessage` says so in the words the dialog shows.
 */

/** Cowork's own autosave — mirrors `SaveState` in `useWorkbookPersistence`. */
export type CloudState =
  | "loading"
  | "saving"
  | "saved"
  | "offline"
  | "error"
  | "conflict";

/** Writing back to a file on the computer — mirrors `LocalBindState`. */
export type FileState = "none" | "saving" | "saved" | "denied" | "error";

export type LeaveReason =
  /** Nothing was changed. Closing costs nothing and asks nothing. */
  | "clean"
  /** Changed, and every store has it. Confirmed, but nothing is at risk. */
  | "saved"
  /** Cowork has not finished storing the last edits. */
  | "cloud_pending"
  /** Cowork could not store them at all. */
  | "cloud_failed"
  /** The file on the computer has not finished being written. */
  | "file_pending"
  /** The file on the computer could not be written. */
  | "file_failed";

export function leaveReason(input: {
  cloud: CloudState;
  file: FileState;
  /**
   * Anything changed since this sheet was opened — whether or not it has
   * since been stored.
   *
   * **Not the same question as "is a write outstanding", and the difference is
   * the whole reason this exists.** Both stores autosave about a second after
   * you stop typing, so a second later everything reads `saved` and a guard
   * that watched only the write state let Close go through in silence. From
   * the outside that is indistinguishable from a sheet that never saved at
   * all: you changed something, you closed it, and nothing told you which had
   * happened. Somebody who edits a sheet is owed the answer on the way out.
   */
  edited: boolean;
}): LeaveReason {
  const { cloud, file, edited } = input;
  /* Failures first, and Cowork's before the file's — see the note above.
     These do not wait on `edited`: a save can only fail if there was
     something to save, and a failure is worth naming even where the flag was
     somehow missed. */
  if (cloud === "offline" || cloud === "error" || cloud === "conflict")
    return "cloud_failed";
  if (file === "denied" || file === "error") return "file_failed";
  if (cloud === "saving") return "cloud_pending";
  if (file === "saving") return "file_pending";
  /* Everything is stored. Still worth confirming where something WAS changed,
     and worth staying out of the way where nothing was: a sheet somebody
     opened, read and closed has nothing to report, and a dialog there is the
     one people learn to dismiss without reading. */
  if (edited) return "saved";
  /* `loading` is not unsaved — nothing has been typed into a sheet that has
     not finished opening, and holding somebody inside one would be a trap. */
  return "clean";
}

/** Whether closing must stop and ask. */
export function mustAsk(reason: LeaveReason): boolean {
  return reason !== "clean";
}

/**
 * The line the dialog shows, in the words that are actually true.
 *
 * Each one names what is outstanding and what leaving without it would cost —
 * never "your changes will be lost", which is wrong for a sheet that has been
 * autosaving all along and is the sentence people learn to dismiss.
 */
export function leaveMessage(reason: LeaveReason): string {
  switch (reason) {
    case "saved":
      return "Everything you changed is saved.";
    case "cloud_pending":
      return "The last few seconds of edits are still being saved. Leaving now may drop them.";
    case "cloud_failed":
      return "The last edits could not be saved — they are on this screen and nowhere else. Leaving now loses them.";
    case "file_pending":
      return "The last edits are still being written to the file on your computer. Leaving now may drop them.";
    case "file_failed":
      return "The edits could not be written to the file on your computer. They are saved in Cowork, but the file is behind.";
    case "clean":
      return "";
  }
}

/**
 * Whether pressing Save can actually resolve it.
 *
 * A pending write only needs to be waited for. A failed one is being retried
 * into the same wall, so the button says "Try saving again" and the person is
 * told plainly that it may not work — a Save that silently fails and closes
 * anyway is worse than no button.
 */
export function saveLabel(reason: LeaveReason): string {
  if (reason === "cloud_failed" || reason === "file_failed")
    return "Try saving again";
  /* Nothing is outstanding, so the button is not a save — it is the way out.
     Labelling it "Save" would claim an action that does nothing. */
  if (reason === "saved") return "Close";
  return "Save";
}

/**
 * Whether "Don't save" belongs on the dialog.
 *
 * **Only where there is a write to decline.** With everything stored there is
 * nothing to not-save: autosave cannot be undone, so the button would either
 * do nothing or imply a revert it cannot perform. A dialog that offers a
 * choice with no consequence teaches people the whole dialog is decorative.
 */
export function canDecline(reason: LeaveReason): boolean {
  return reason !== "clean" && reason !== "saved";
}
