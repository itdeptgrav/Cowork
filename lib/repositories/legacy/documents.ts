import { LEGACY_ORGANISATION_ID } from "./map.ts";
import { readMembers } from "../../rules/documents/access.ts";
import type { CoworkDocument } from "../../domain/documents.ts";

/**
 * `cowork_documents` — the record — and `cowork_document_bodies` — the text.
 *
 * A NEW pair of collections. Legacy has nothing resembling a document, so
 * unlike every other mapper in this folder there is no old shape to stay
 * compatible with, and the stored shape is simply the domain type.
 *
 * They are split because the list reads records and the editor reads one body.
 * Keeping the text on the record would make drawing a sidebar of thirty
 * documents a thirty-body read, and Firestore bills per document.
 */

export const DOCUMENT_COLLECTION = "cowork_documents";
export const DOCUMENT_BODY_COLLECTION = "cowork_document_bodies";

const str = (v: unknown, fallback = ""): string =>
  typeof v === "string" ? v : fallback;

const ids = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];

/**
 * Read a stored record, or null if it is not one.
 *
 * A document with no members is treated as unreadable rather than returned
 * empty: it is not openable by anybody including its author, so surfacing it in
 * a list would put a row on screen that cannot be clicked.
 */
export function readDocument(
  id: string,
  raw: Record<string, unknown>,
): CoworkDocument | null {
  /* Tolerates the pre-roles shape: those people were editors, and the creator
     becomes the owner. See `readMembers`. */
  const members = readMembers(raw);
  if (members.length === 0) return null;
  const memberIds = [...new Set(members.map((m) => m.employeeId))];
  const createdAt = str(raw.createdAt);
  return {
    organisationId: str(raw.organisationId, LEGACY_ORGANISATION_ID),
    id,
    kind: raw.kind === "sheet" ? "sheet" : "doc",
    title: str(raw.title).trim() || "Untitled document",
    createdById: str(raw.createdById),
    lastEditedById: typeof raw.lastEditedById === "string" ? raw.lastEditedById : null,
    members,
    memberIds,
    createdAt,
    /* Falls back to `createdAt` rather than to now: a record written before
       this field existed has not just been touched, and saying it was would
       sort it to the top of a list ordered by recency. */
    updatedAt: str(raw.updatedAt, createdAt),
    deletedAt: typeof raw.deletedAt === "string" ? raw.deletedAt : null,
    driveFileId: typeof raw.driveFileId === "string" ? raw.driveFileId : null,
    driveSyncedAt: typeof raw.driveSyncedAt === "string" ? raw.driveSyncedAt : null,
  };
}

/** The record as it is stored. `id` is the document key, never a field. */
export function documentBody(record: CoworkDocument): Record<string, unknown> {
  return {
    organisationId: record.organisationId,
    kind: record.kind,
    title: record.title,
    createdById: record.createdById,
    lastEditedById: record.lastEditedById,
    members: record.members,
    memberIds: record.memberIds,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    deletedAt: record.deletedAt,
    driveFileId: record.driveFileId,
    driveSyncedAt: record.driveSyncedAt,
  };
}
