import type { WorkbookErrorKind } from "@/lib/spreadsheet/workbookClient";

/**
 * What to tell somebody whose sheets did not load.
 *
 * ## Why this is not one sentence
 *
 * It was: every failure that was not a 401 read "Couldn't load your sheets."
 * That sentence is true of all of them and useful about none, and the cost of
 * it was real — the Sheets list came up empty with that line under it, and
 * finding out why meant reading the client, the route, the environment, and
 * finally probing the engine by hand to discover that `/cowork/workbooks`
 * answers 404 while every sibling route answers 401. None of that was visible
 * from the screen. A person seeing it can only conclude their sheets are gone.
 *
 * The kinds are already distinguished — `WorkbookRequestError` carries one —
 * so the surface was throwing away an answer it had been handed.
 *
 * ## The one that matters most
 *
 * **`not-found` on the LIST is not a missing workbook.** There is no id in that
 * request; it asks the server for the caller's collection. A 404 therefore says
 * the server has no such endpoint — the backend does not have the workbooks
 * feature — which is an operator's problem and not something the reader can act
 * on by trying again. Saying "not available on this server" points at the right
 * thing; "couldn't load" invites them to blame their own data.
 *
 * That is why this takes the kind rather than the message: the server's own
 * text for a 404 is a router default about a path, which is not a sentence to
 * show anybody.
 */
export function sheetsLoadError(kind: WorkbookErrorKind | null): string {
  switch (kind) {
    case "unauthorized":
      return "Sign in to see your sheets.";
    /* No id was asked for, so this is the endpoint missing, not a workbook. */
    case "not-found":
      return "Sheets aren’t available on this server yet. Nothing of yours is lost — the workbooks service isn’t running.";
    case "forbidden":
      return "You don’t have access to sheets on this workspace.";
    case "network":
      return "Couldn’t reach the server. Check your connection and try again.";
    case "server":
      return "The server couldn’t load your sheets. Try again in a moment.";
    /* `conflict` and `bad-request` cannot arise from a plain listing; if one
       does, the generic line is still true and still honest. */
    default:
      return "Couldn’t load your sheets.";
  }
}

/**
 * Whether the reader can do anything about it by trying again.
 *
 * A Retry button under a 404 is a button that cannot work: the endpoint will
 * still be missing on the next press. Offering one there is how a person comes
 * to believe the product is simply broken rather than that a service is down.
 */
export function sheetsLoadRetryable(kind: WorkbookErrorKind | null): boolean {
  return kind === "network" || kind === "server" || kind === null;
}
