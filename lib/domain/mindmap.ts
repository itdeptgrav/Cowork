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

/**
 * How a card looks. Every field optional, and absent means "the theme's
 * default for this depth" — so a map made before styling existed reads back
 * exactly as it did, and a card that has never been styled carries nothing.
 */
export interface MindNodeStyle {
  /** A named swatch from the map's palette, or a CSS colour. */
  fill?: string;
  /** Text colour. Defaults to whatever reads on `fill`. */
  text?: string;
  shape?: "rounded" | "rect" | "pill" | "underline" | "ellipse";
  /** Title size. `m` is the default. */
  size?: "s" | "m" | "l" | "xl";
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  /** Connector line to the parent. */
  line?: "curve" | "straight" | "elbow";
}

/** The importance markers XMind-style tools carry on a card. */
export type MindPriority = 1 | 2 | 3 | 4 | 5;
export type MindProgress = 0 | 25 | 50 | 75 | 100;

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
  /* ── Optional from here: absent on every card written before these existed. */
  style?: MindNodeStyle;
  /** One emoji, drawn before the title. */
  icon?: string;
  priority?: MindPriority | null;
  progress?: MindProgress | null;
  /** Short labels, drawn as chips under the title. */
  tags?: string[];
  /**
   * A floating topic: a card with no parent that is not the root, placed
   * where it was dropped (canvas coordinates) with its own branch beneath it.
   */
  floating?: { x: number; y: number };
  /**
   * A Cowork task this card stands for. The one thing a mindmap here can do
   * that a standalone tool cannot: a branch of ideas becomes the work, and the
   * card reads the task's state back.
   */
  taskId?: string | null;
}

/* ── Map-level extras ──────────────────────────────────────────────────────
 *
 * Things that belong to the MAP rather than to one card: how it is laid out,
 * what palette it uses, and the lines and groupings drawn across the tree.
 * Stored beside the cards in the body, never on the record, because the list
 * has no use for them and the body is what a save replaces whole.
 */

export type MindLayoutKind =
  | "right"
  | "left"
  | "both"
  | "org"
  | "tree"
  | "radial"
  | "timeline"
  | "fishbone";

export type MindThemeKind = "field" | "mono" | "vivid" | "warm" | "cool" | "night";

export interface MindMapSettings {
  layout: MindLayoutKind;
  theme: MindThemeKind;
  /** Draw "1.2.3" before each card's title, by position in the tree. */
  numbering?: boolean;
}

/** A line between two cards that are not parent and child. */
export interface MindRelation {
  id: string;
  from: MindNodeId;
  to: MindNodeId;
  label: string;
  /** Curved by default; straight reads better for short hops. */
  line?: "curve" | "straight";
  color?: string;
}

/** A shaded region around a card and its whole branch. */
export interface MindBoundary {
  id: string;
  nodeId: MindNodeId;
  label: string;
  color?: string;
}

/** A bracket across a card's children, with a sentence about them together. */
export interface MindSummary {
  id: string;
  nodeId: MindNodeId;
  text: string;
}

export interface MindMapExtras {
  settings: MindMapSettings;
  relations: MindRelation[];
  boundaries: MindBoundary[];
  summaries: MindSummary[];
}

export const DEFAULT_MINDMAP_SETTINGS: MindMapSettings = { layout: "right", theme: "field" };

export function emptyExtras(): MindMapExtras {
  return { settings: { ...DEFAULT_MINDMAP_SETTINGS }, relations: [], boundaries: [], summaries: [] };
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
  /** Layout, theme, relationships and groupings. Defaults on a map that has none. */
  extras: MindMapExtras;
}
