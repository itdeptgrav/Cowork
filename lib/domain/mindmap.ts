import type { EmployeeId } from "./identity";

/**
 * A mindmap, and the cards in it.
 *
 * ## Why this is now a record with a body, like a document
 *
 * The mindmap used to be ONE map per browser, in `localStorage`. That was a
 * deliberate limit while the idea was being tried, and it cost exactly what it
 * said it would: the map did not follow you between machines, nobody else could
 * see it, and clearing site data threw it away. It is a server record now, so
 * all three are gone — and, like a document, there can be many of them.
 *
 * The record/body split is the documents split and it is here for the same
 * reason: a list of thirty maps must not read thirty card trees to draw a table
 * of names. `nodeCount` is on the RECORD so the list can show how big a map is
 * without opening it.
 *
 * ## Why the cards are written through a route rather than straight to the store
 *
 * A document body is opaque text and cannot be malformed. A card tree can: two
 * roots, a parent that is not in the map, a cycle. None of those look wrong —
 * they fail to draw at all, for every member of that map. So the tree is
 * validated by `grav-cms-backend` (`routes/task_routes/coworkMindmaps.js`),
 * where the check cannot be skipped by an edited request, rather than in the
 * browser where it can.
 */

/** A link on a card. `label` is optional — a bare URL is a normal thing to paste. */
export interface MindLink {
  id: string;
  url: string;
  label: string;
}

/**
 * An attached image.
 *
 * **`fileId` is where the bytes are: Google Drive, the same store every other
 * attachment in this product uses.** They used to be here, as a base64
 * `dataUrl`, justified by "the mindmap persists to `localStorage` and there is
 * no storage service in the path". Both halves are now moot — the map is a
 * server record and the engine has had a Drive upload route since the old
 * application — and the server refuses `dataUrl` outright, because one base64
 * picture fills a Firestore document on its own and a map carrying three would
 * be unsaveable.
 *
 * `dataUrl` is kept and OPTIONAL so a map still sitting in somebody's browser
 * can be READ and imported. Nothing writes it, and a card carrying one cannot
 * be saved to the server until the picture is attached again.
 */
export interface MindImage {
  id: string;
  name: string;
  /** The Drive file id. Null only on a picture stored before the upload path. */
  fileId?: string | null;
  /** What the store returned, kept so a record still means something on its own. */
  url?: string | null;
  /** Legacy in-browser bytes. Read on import, never written. */
  dataUrl?: string;
  sizeBytes: number;
}

export type MindNodeId = string;

export interface MindNode {
  id: MindNodeId;
  /** Null for the root. Every other card has exactly one parent. */
  parentId: MindNodeId | null;
  title: string;
  description: string;
  links: MindLink[];
  images: MindImage[];
  /** Children hidden. The card itself stays visible, carrying a count. */
  collapsed: boolean;
}

/**
 * What somebody may do in a mindmap.
 *
 * The same three a document has, and deliberately the same words: a person who
 * has learned what "editor" means on a document has learned it here too, and a
 * fourth role that behaved almost like one of these would be a promise the
 * product does not keep.
 */
export type MindMapRole = "owner" | "editor" | "viewer";

export interface MindMapMember {
  employeeId: EmployeeId;
  role: MindMapRole;
  addedAt: string;
}

/** The record — what a LIST needs. Never the cards. */
export interface MindMapRecord {
  /**
   * Owning tenant. Every read is scoped to it; every write stamps it.
   *
   * Denormalised onto the record rather than joined through a parent, matching
   * every other directly-queried entity in this domain.
   */
  organisationId: string;
  id: string;
  title: string;
  createdById: EmployeeId;
  /** Who last committed a change. Null on a map nobody has edited yet. */
  lastEditedById: EmployeeId | null;
  /**
   * Who may open it, and as what.
   *
   * Always includes the creator as `owner`. A map with no owner is unreachable
   * and unmanageable, so nothing is allowed to write one — the server refuses
   * the change that would produce it.
   */
  members: MindMapMember[];
  /**
   * The employee ids in `members`, denormalised.
   *
   * **Derived, never authored.** Firestore cannot query inside an array of
   * objects, so `array-contains` needs a flat list, and this is that index —
   * what the list query reads. The route keeps the two in step.
   */
  memberIds: EmployeeId[];
  /**
   * How many cards the map holds.
   *
   * On the record so the list can say how big a map is without reading its
   * body. Written by the one route that writes cards, so it cannot drift.
   */
  nodeCount: number;
  createdAt: string;
  updatedAt: string;
  /** Soft. A deleted map is recoverable until something reaps it. */
  deletedAt: string | null;
}

/** What a list row shows. The record is already all of it. */
export type MindMapSummary = MindMapRecord;

/** A map and its cards, read when one is opened. */
export interface MindMapDetail {
  mindmap: MindMapRecord;
  nodes: MindNode[];
}
