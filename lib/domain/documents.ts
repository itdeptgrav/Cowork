import type { EmployeeId } from "./identity";

/**
 * A collaborative document.
 *
 * ## Why the body is stored apart from the record
 *
 * `CoworkDocument` is the thing a LIST needs — title, who touched it, when. The
 * body is fetched only when a document is opened. A list of thirty documents
 * that carried thirty bodies would read a megabyte to render a sidebar, and
 * Firestore charges by document read rather than by field.
 *
 * ## Two representations of the same content, on purpose
 *
 * `html` is what the editor loads and what search and export read. `ydocState`
 * is the CRDT's own binary state, base64'd, and it is the authority once
 * collaboration is on: it carries the edit history the merge algorithm needs,
 * which HTML cannot express. Phase 1 writes only `html`; phase 2 adds
 * `ydocState` and makes it the source, with `html` kept as its projection.
 *
 * They are not allowed to disagree silently — whoever writes `ydocState` writes
 * the matching `html` in the same operation.
 */
/**
 * What somebody may do in a document.
 *
 * Three, not four. Google's "commenter" sits between editor and viewer, and
 * there is no comment layer here yet — shipping a role that behaves exactly
 * like `viewer` would be a promise the product does not keep. It goes in with
 * annotations.
 */
export type DocumentRole = "owner" | "editor" | "viewer";

export interface DocumentMember {
  employeeId: EmployeeId;
  role: DocumentRole;
  addedAt: string;
}

/**
 * What kind of thing this is.
 *
 * A sheet is a document with a different body, deliberately: sharing, roles,
 * the collaboration room and the permission gate are identical, and forking
 * them into a parallel `cowork_sheets` collection would mean maintaining two
 * copies of every one of those rules.
 */
export type DocumentKind = "doc" | "sheet";

/** Paper this document is laid out for. Print sizes, not screen sizes. */
export type PaperSize = "letter" | "legal" | "tabloid" | "a4" | "a5";

export type PageOrientation = "portrait" | "landscape";

/**
 * The page a document is written on.
 *
 * **Part of the document, not a per-reader preference.** The measure decides
 * where every line breaks, so two people editing through different margins
 * would see different pages of what is supposed to be one text. Zoom is the
 * per-reader preference and is deliberately not here.
 *
 * Margins are in inches — the unit every word processor authors them in, and
 * the one the ruler is marked in.
 */
export interface DocumentPageSetup {
  paper: PaperSize;
  orientation: PageOrientation;
  margins: { top: number; right: number; bottom: number; left: number };
  /**
   * Text repeated at the top and bottom of every PRINTED page, and whether the
   * footer carries a page number. Empty means none — the default, and what
   * every document stored before these fields existed reads as.
   */
  header: string;
  footer: string;
  pageNumbers: boolean;
  /** Faint diagonal text behind every page ("DRAFT"); empty for none. */
  watermark?: string;
  /** The paper colour, a hex string; unset for the theme's page white. */
  pageColor?: string;
  /** Number each block down the left margin, as legal drafts do. */
  lineNumbers?: boolean;
}

export interface CoworkDocument {
  /**
   * Owning tenant. Every read is scoped to it; every write stamps it.
   *
   * Denormalised onto the record rather than joined through a parent, matching
   * every other directly-queried entity in this domain.
   */
  organisationId: string;
  id: string;
  kind: DocumentKind;
  title: string;
  createdById: EmployeeId;
  /** Who last committed a change. Null on a document nobody has edited yet. */
  lastEditedById: EmployeeId | null;
  /**
   * Who may open it, and as what.
   *
   * Always includes the creator as `owner`. A document with no owner is
   * unreachable and unmanageable, so nothing is allowed to write one.
   */
  members: DocumentMember[];
  /**
   * The employee ids in `members`, denormalised.
   *
   * **Derived, never authored.** Firestore cannot query inside an array of
   * objects, so `array-contains` needs a flat list — this is that index, and it
   * is what the document list query and the collaboration socket both read.
   * `writeMembers` is the one place that keeps the two in step.
   */
  memberIds: EmployeeId[];
  createdAt: string;
  updatedAt: string;
  /** Soft. A deleted document is recoverable until something reaps it. */
  deletedAt: string | null;

  /**
   * The Drive file this mirrors, once it has been pushed.
   *
   * Null until the first push. Phase 4 fills it; it is on the record from the
   * start so a document created now can be mirrored later without a migration.
   */
  driveFileId: string | null;
  driveSyncedAt: string | null;
}

/** The body, fetched only when a document is opened. */
export interface CoworkDocumentBody {
  documentId: string;
  /** ProseMirror's HTML. Empty string is a genuinely empty document. Docs only. */
  html: string;
  /**
   * A sheet's cells, as JSON. Null on a document.
   *
   * `{ "A1": "=SUM(B1:B9)", "B1": "3" }` — sparse, storing what somebody typed
   * rather than a rectangular array. A 1000×26 grid with four values in it is
   * four entries here, not 26,000 nulls.
   *
   * The RAW input is stored, never the computed value: a formula's result is
   * derived and re-derived on load, and persisting it would let a stale number
   * outlive the inputs it came from.
   */
  cells: string | null;
  /**
   * The Yjs state vector, base64. Null until collaboration writes one.
   *
   * Stored rather than rebuilt from `html` because rebuilding loses the edit
   * history, and two clients rebuilding independently would produce documents
   * that can never merge.
   */
  ydocState: string | null;
  /**
   * The page this document is laid out for. Null on a document written before
   * page setup existed, which opens at the default rather than at no page.
   *
   * It lives on the BODY rather than the record because it is a property of the
   * text, and because a list that draws thirty rows has no use for thirty sets
   * of margins.
   */
  pageSetup: DocumentPageSetup | null;
  updatedAt: string;
}

/** What a list row shows. */
export interface DocumentSummary extends CoworkDocument {
  /** First line of text, for the list. Never the whole body. */
  preview: string;
}
