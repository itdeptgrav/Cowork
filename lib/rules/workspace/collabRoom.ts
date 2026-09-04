/**
 * Which record a live-collaboration room belongs to.
 *
 * ## Why a room name needs a KIND at all
 *
 * The collaboration server hands out one namespace per room: `/yjs|<room>`. When
 * documents were the only thing that collaborated, the room could simply BE the
 * document id — there was nothing else it could have meant. Mindmaps are a
 * separate collection with their own membership, so a bare id is now ambiguous,
 * and the ambiguity is not cosmetic: the server decides who may join by reading
 * the record, and reading the wrong collection either refuses somebody who
 * belongs or — far worse — finds an unrelated record with the same id and
 * authorises against ITS member list.
 *
 * So the kind travels in the room name, where the server can read it from its
 * own routing rather than from anything the client sends alongside.
 *
 * ## Why documents keep the bare id
 *
 * `document(id) === id`, deliberately. Every document room that is open right
 * now is named that way, and a client on the old name and a client on a new one
 * would be two rooms holding two divergent copies of one document — with no
 * error anywhere, because both would work perfectly. Leaving documents alone
 * makes this change unable to split a live session.
 *
 * The prefix is therefore only ever ADDED to new kinds. `parse` treats an
 * unprefixed room as a document for the same reason.
 */

export type CollabKind = "document" | "mindmap" | "workbook";

/** The prefix for each kind that carries one. Documents deliberately have none. */
const PREFIX: Record<Exclude<CollabKind, "document">, string> = {
  mindmap: "mindmap:",
  workbook: "workbook:",
};

/** The room for a document. The id itself — see the note above. */
export function documentRoom(documentId: string): string {
  return documentId;
}

/** The room for a mindmap. */
export function mindmapRoom(mindmapId: string): string {
  return `${PREFIX.mindmap}${mindmapId}`;
}

/** The room for a spreadsheet workbook. */
export function workbookRoom(workbookId: string): string {
  return `${PREFIX.workbook}${workbookId}`;
}

/**
 * What a room name refers to, or null if it names nothing.
 *
 * Null for an empty id rather than a record with an empty id: `mindmap:` is a
 * malformed room, and returning `{kind: "mindmap", id: ""}` would send the
 * server to look up a document whose id is the empty string.
 */
export function parseRoom(room: string): { kind: CollabKind; id: string } | null {
  const name = String(room ?? "");
  if (name.startsWith(PREFIX.mindmap)) {
    const id = name.slice(PREFIX.mindmap.length);
    return id ? { kind: "mindmap", id } : null;
  }
  if (name.startsWith(PREFIX.workbook)) {
    const id = name.slice(PREFIX.workbook.length);
    return id ? { kind: "workbook", id } : null;
  }
  return name ? { kind: "document", id: name } : null;
}
