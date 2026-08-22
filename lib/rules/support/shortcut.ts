/**
 * When Ctrl+S opens Support — and, more importantly, when it must not.
 *
 * ## Ctrl+S is already taken, twice
 *
 * The browser reads it as "save this page", and Cowork's own document editor
 * and spreadsheet read it as "save my work" — both bind it deliberately, both
 * call `preventDefault()`, and the sheet's comment says exactly why: "the one
 * keystroke a person reaches for to be sure their work is safe was the one
 * that did something else entirely."
 *
 * So a global Support shortcut cannot simply take the key. It stands down on
 * the routes where Ctrl+S already means save, and takes it everywhere else —
 * including before anybody has signed in, which is the case the feature exists
 * for and the one place no editor is mounted.
 *
 * Kept as a rule rather than inline in the listener because the stand-down
 * list is the whole safety of the feature: it is the difference between a
 * support panel and somebody's document quietly not saving.
 */

/**
 * Route prefixes whose own Ctrl+S is a real save.
 *
 * `/workspace` hosts the document editor and the collaborative sheet, which
 * both bind the key. Matched by PREFIX so `/workspace/anything` is covered —
 * the workspace routes its surfaces internally, and a new one added there
 * inherits the protection rather than having to remember to ask for it.
 */
export const SAVE_OWNING_ROUTES = ["/workspace"] as const;

/** Whether this route's own Ctrl+S already means "save my work". */
export function routeOwnsSave(pathname: string): boolean {
  return SAVE_OWNING_ROUTES.some(
    (r) => pathname === r || pathname.startsWith(`${r}/`),
  );
}

/**
 * The parts of a keydown this decision reads. A plain object rather than the
 * DOM event so the rule is testable without a browser.
 */
export interface ShortcutKey {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}

/**
 * Whether this keystroke should open Support.
 *
 * · **Ctrl or Cmd**, so the same muscle memory works on Windows and macOS.
 * · **Not with Alt or Shift.** Those are different keystrokes and may belong
 *   to something else; claiming the whole family would be taking keys nobody
 *   asked us to take.
 * · **Case-insensitive**, because Caps Lock reports "S" and a person with it
 *   on has not pressed a different key.
 * · **Never where the route owns save.**
 *
 * Deliberately NOT gated on the focused element. A shortcut that stopped
 * working inside a text box would be unreachable on the sign-in screen, where
 * the cursor is in a field by definition and where somebody who cannot get in
 * most needs support.
 */
export function opensSupport(e: ShortcutKey, pathname: string): boolean {
  if (e.altKey || e.shiftKey) return false;
  if (!e.ctrlKey && !e.metaKey) return false;
  if (e.key.toLowerCase() !== "s") return false;
  return !routeOwnsSave(pathname);
}
