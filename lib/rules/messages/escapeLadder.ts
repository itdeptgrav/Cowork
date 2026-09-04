/**
 * What Escape backs out of, given everything a thread currently has open.
 *
 * **The order is the feature, so it lives somewhere it can be asserted.**
 * Escape already meant something in a conversation — it closes the search bar —
 * and it means something in the image and video lightboxes, which listen on
 * `document` exactly as the thread does. A handler that simply left the
 * conversation would fire alongside those: pressing Escape to dismiss a photo
 * would dismiss the photo AND the thread behind it, leaving the reader at their
 * conversation list wondering what they did.
 *
 * Buried in a chain of `if`s inside a component, that ordering is one careless
 * reorder away from breaking, and nothing would catch it. Here it is a value
 * that a test can hold to.
 */

/** Everything that could reasonably swallow an Escape, innermost last-opened. */
export interface ThreadEscapeState {
  /**
   * A lightbox or dialog is on screen.
   *
   * Read from the DOM (`[aria-modal="true"]`) rather than tracked as state, so
   * a modal added later is covered without anybody remembering this list.
   */
  modalOpen: boolean;
  menuOpen: boolean;
  /**
   * The @-mention autocomplete is open under the composer.
   *
   * OPTIONAL, like every rung added after the first: `ThreadEscapeState` is
   * built as a full object literal at each call site and in this module's own
   * test fixture, so a required field here would break all of them at once
   * for a surface that has not adopted the feature yet.
   */
  mentionPickerOpen?: boolean;
  forwarding: boolean;
  groupSettingsOpen: boolean;
  /**
   * A voice note is being recorded right now.
   *
   * Above `editing` and `replying` because it is the only rung that is
   * CAPTURING something: an edit or a reply survives being backed out of —
   * the text is still in the composer, and the draft keeps it — while a
   * recording that loses its rung is a recording that keeps running with no
   * obvious way to stop it.
   */
  recording?: boolean;
  editing: boolean;
  replying: boolean;
  searchOpen: boolean;
  /**
   * Whether the caller has anywhere to go when the thread closes.
   *
   * False means the last rung does nothing, so Escape stops at the rung above
   * rather than appearing to be ignored. A caller that can genuinely empty its
   * thread pane passes true even for a thread the layout chose rather than the
   * reader — leaving a defaulted thread is still leaving it.
   */
  canClose: boolean;
}

export type EscapeAction =
  | "none"
  | "close-menu"
  | "close-mention-picker"
  | "close-forward"
  | "close-group-settings"
  | "cancel-recording"
  | "cancel-edit"
  | "cancel-reply"
  | "close-search"
  | "close-thread";

/**
 * One rung per press.
 *
 * `"none"` means leave the event alone entirely — either something modal owns
 * it, or there is nothing left to back out of and no thread to leave.
 *
 * Text in the composer is deliberately not a rung. Escape does not discard it,
 * and closing the thread does not lose it: drafts are kept per conversation, so
 * coming back finds it exactly as it was.
 */
export function escapeAction(state: ThreadEscapeState): EscapeAction {
  /* Anything modal owns Escape while it is open, and runs its own handler. */
  if (state.modalOpen) return "none";

  if (state.menuOpen) return "close-menu";
  /* Above the dialogs and above `editing`/`replying`, because the picker is
     opened by typing INSIDE an edit or a reply — it is always the innermost
     thing on screen when it is open, and a rung below them would back out of
     the reply while its own autocomplete was still showing. */
  if (state.mentionPickerOpen) return "close-mention-picker";
  if (state.forwarding) return "close-forward";
  if (state.groupSettingsOpen) return "close-group-settings";
  if (state.recording) return "cancel-recording";
  if (state.editing) return "cancel-edit";
  if (state.replying) return "cancel-reply";
  /* After the transient things, because the search bar is a mode somebody
     stays in — closing it while a message menu is open would be backing out of
     the wrong thing. Its own handler only fires while the input has focus, so
     this rung is what makes Escape work after clicking away from it. */
  if (state.searchOpen) return "close-search";

  return state.canClose ? "close-thread" : "none";
}
