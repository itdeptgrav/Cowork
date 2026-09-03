import "server-only";
import { NextResponse } from "next/server";
import {
  workbookPrincipal,
  workbookEmployeeId,
  type WorkbookPrincipal,
} from "./workbookPrincipal";
import {
  roleAllows,
  workbookStore,
  type ShareRole,
  type WorkbookRecord,
} from "./workbookStore";

/**
 * The one gate every per-workbook route passes through — so authorization is
 * decided in ONE place, server-side, from a verified identity.
 *
 * The order is deliberate:
 *  1. a well-formed id (a malformed one never touches the store);
 *  2. a real caller (else 401);
 *  3. an existing workbook the caller OWNS — and a workbook the caller does not
 *     own answers 404, the same as one that does not exist, so the endpoint is
 *     not an oracle for which workbook ids are real.
 *
 * Requirement 12–14 live here: the id is validated, the owner is the verified
 * principal, and no route trusts a client-supplied owner.
 */

const ID_SHAPE = /^wb-[a-z0-9]+$/i;

export type WorkbookAccess =
  | {
      ok: true;
      principal: WorkbookPrincipal;
      record: WorkbookRecord;
      /** How this caller reaches it — `"owner"`, or the role they were granted. */
      access: "owner" | ShareRole;
    }
  | { ok: false; response: NextResponse };

/**
 * The caller's standing on a record, or null when they have none.
 *
 * Takes one id or SEVERAL, because a caller reaches a workbook under two ids at
 * once: the principal that OWNS it (a server account id, or `fb:<uid>` on the
 * Firebase path) and their directory EMPLOYEE id, which is what a name-based
 * share is granted by. Ownership is checked against the owner id; a grant is
 * matched against any of them.
 */
export function standingOn(
  record: WorkbookRecord,
  principal: string | readonly string[],
): "owner" | ShareRole | null {
  const ids = typeof principal === "string" ? [principal] : principal;
  if (ids.includes(record.ownerId)) return "owner";
  const grant = record.shares?.find((s) => ids.includes(s.principalId));
  return grant ? grant.role : null;
}

function deny(status: number, error: string): { ok: false; response: NextResponse } {
  return { ok: false, response: NextResponse.json({ error }, { status }) };
}

/** What the caller is about to do, so this one function can refuse it. */
export type WorkbookIntent = "read" | "write" | "own";

export async function accessWorkbook(
  request: Request,
  id: string,
  needed: WorkbookIntent = "read",
): Promise<WorkbookAccess> {
  if (!ID_SHAPE.test(id)) return deny(400, "Invalid workbook id.");

  const principal = await workbookPrincipal(request);
  if (!principal) return deny(401, "Not authenticated.");

  const record = await workbookStore.load(id);
  if (!record) return deny(404, "Workbook not found.");

  /* Not found and not yours are the SAME answer — otherwise a 403 confirms the
     id exists to someone who may not access it. A share grant is what turns a
     stranger into someone who may see it; without one this stays a 404.

     Ownership is settled by the owner id alone and needs no lookup — the common
     path, including every autosave of your own workbook. Only when that fails do
     we resolve the caller's directory EMPLOYEE id (a `/cowork/me` round trip on
     the Firebase path) to see whether a NAME-BASED share admits them, and only
     when there is a share list to match against. */
  let access = standingOn(record, principal.ownerId);
  if (!access && record.shares?.length) {
    const employeeId = await workbookEmployeeId(request);
    if (employeeId) access = standingOn(record, [principal.ownerId, employeeId]);
  }
  if (!access) return deny(404, "Workbook not found.");

  /* A read is allowed by any standing. A WRITE needs `editor` or ownership, and
     is checked here rather than in each route, so a new route cannot forget. */
  if (needed === "write" && access !== "owner" && !roleAllows(access, "editor")) {
    return deny(403, "You have read-only access to this workbook.");
  }
  /* Only the owner may change who it is shared with, or delete it. */
  if (needed === "own" && access !== "owner") {
    return deny(403, "Only the workbook's owner can do that.");
  }
  return { ok: true, principal, record, access };
}
