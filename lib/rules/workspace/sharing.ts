/**
 * The three roles, and what each one means — for anything that can be shared.
 *
 * ## Why the hints are a function of the noun
 *
 * Documents and mindmaps grant the same three roles, and deliberately the same
 * words: somebody who has learned what "editor" means on a document has learned
 * it on a mindmap too. What cannot be shared is the SENTENCE. "Can edit the
 * document." shown on a mindmap is a small lie that costs real trust — a person
 * reading it while looking at a card tree has to decide whether the product is
 * confused or they are.
 *
 * So the labels are constant and the hints take the noun. One rule, said
 * correctly in each place, rather than one rule said generically enough to be
 * true everywhere and useful nowhere ("Can edit the item.").
 */

export type ShareRole = "owner" | "editor" | "viewer";

/** Owners first, then editors, then viewers — the order people scan for. */
export const SHARE_ROLES: readonly ShareRole[] = ["owner", "editor", "viewer"];

export const SHARE_ROLE_LABEL: Record<ShareRole, string> = {
  owner: "Owner",
  editor: "Editor",
  viewer: "Viewer",
};

/**
 * What each role may do here, in words, for this kind of thing.
 *
 * `noun` is lower-case and singular — "document", "mindmap" — because it is
 * dropped mid-sentence.
 */
export function shareRoleHints(noun: string): Record<ShareRole, string> {
  return {
    owner: "Can edit, share and delete.",
    editor: `Can edit the ${noun}.`,
    viewer: "Can read it. Cannot change anything.",
  };
}

/**
 * Sort members into the order the list shows them.
 *
 * Copies rather than sorting in place: the array handed in belongs to a record
 * held in a query cache, and sorting it where it lies mutates what the next
 * reader sees without any re-render to announce it.
 */
export function sortByRole<T extends { role: ShareRole }>(
  members: readonly T[],
): T[] {
  return [...members].sort(
    (a, b) => SHARE_ROLES.indexOf(a.role) - SHARE_ROLES.indexOf(b.role),
  );
}
