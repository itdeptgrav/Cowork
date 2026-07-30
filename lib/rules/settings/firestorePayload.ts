/**
 * A document Firestore will accept, with the client-side id removed.
 *
 * **The bug this exists to prevent, verbatim:**
 *
 *     Function addDoc() called with invalid data. Unsupported field value:
 *     undefined (found in field id in document cowork_task_budget_extensions/…)
 *
 * The intent was to strip `id` before writing — the document id comes from
 * Firestore, so carrying a client-side one is meaningless. The expression used
 * was `{ ...record, id: undefined }`, which does not remove the key. It sets it
 * to `undefined`, and `undefined` is the one value Firestore refuses outright.
 *
 * Spreading cannot delete. Written three times across two collections and the
 * audit log, so the same request crashed whichever door it came through.
 *
 * ## Why a function rather than a careful line
 *
 * Because the careful line was written three times and was wrong three times.
 * This strips `id`, drops any other `undefined` leaf, and throws on the values
 * Firestore also rejects — so a malformed payload fails here, with the field
 * named, rather than inside the SDK with a message a user should never see.
 */

/** Fields that must never be absent, per collection, checked before the write. */
export type RequiredFields = readonly string[];

export class PayloadError extends Error {
  /* Declared and assigned rather than a constructor parameter property: the
     test runner strips types without transforming, and a parameter property
     needs a transform. */
  readonly field: string;

  constructor(field: string, message: string) {
    super(message);
    this.name = "PayloadError";
    this.field = field;
  }
}

/**
 * Recursively drop `undefined`. Nulls are KEPT: Firestore stores them, and
 * "explicitly not set" is a fact worth writing — `approvedAt: null` on a
 * pending record says something `approvedAt` absent does not.
 */
function stripUndefined(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripUndefined);
  if (value && typeof value === "object" && !(value instanceof Date)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (v === undefined) continue;
      out[k] = stripUndefined(v);
    }
    return out;
  }
  return value;
}

/**
 * The document body for `addDoc`.
 *
 * `id` is removed rather than blanked — Firestore assigns it, and the record's
 * own id is only meaningful once it has.
 */
export function documentBody(
  record: object,
  required: RequiredFields = [],
): Record<string, unknown> {
  const { id: _id, ...rest } = record as Record<string, unknown>;
  void _id;

  for (const field of required) {
    const v = (rest as Record<string, unknown>)[field];
    if (v === undefined || v === null || v === "") {
      throw new PayloadError(
        field,
        `The record cannot be saved: "${field}" is missing.`,
      );
    }
  }

  /* NaN and Infinity are rejected by Firestore too, and reach it far more
     easily than undefined — any arithmetic on a missing number produces one. */
  for (const [k, v] of Object.entries(rest)) {
    if (typeof v === "number" && !Number.isFinite(v)) {
      throw new PayloadError(k, `The record cannot be saved: "${k}" is not a number.`);
    }
  }

  return stripUndefined(rest) as Record<string, unknown>;
}

/** What a budget extension must carry to be worth storing. */
export const BUDGET_EXTENSION_REQUIRED: RequiredFields = [
  "type",
  "taskId",
  "requestedBy",
  "createdAt",
];

/** What a deadline extension must carry. */
export const DEADLINE_EXTENSION_REQUIRED: RequiredFields = [
  "type",
  "taskId",
  "requestedBy",
  "proposedDeadline",
  "createdAt",
];

/** What an audit entry must carry. */
export const AUDIT_REQUIRED: RequiredFields = ["section", "type", "changedAt"];
