import type {
  ExternalShareInvite,
  ExternalShareKind,
  ExternalShareRole,
  ExternalShareStatus,
} from "../repositories/types.ts";

/**
 * Reading `grav-cms-backend`'s `/cowork/share/*` responses into
 * `ExternalShareInvite`.
 *
 * Matches the shape `coworkExternalShare.routes.js` actually answers with —
 * see its `invite:` object literals in the `POST /invite` and
 * `GET /invites` handlers — the same discipline every other `read*` mapper in
 * this folder follows: trust nothing about the wire shape, fall back to a
 * safe default for anything malformed rather than throwing mid-render.
 */

const KINDS: ExternalShareKind[] = ["document", "mindmap"];
const ROLES: ExternalShareRole[] = ["editor", "viewer"];
const STATUSES: ExternalShareStatus[] = ["pending", "accepted", "revoked"];

const str = (v: unknown, fallback = ""): string =>
  typeof v === "string" ? v : fallback;

export function readExternalShareInvite(raw: unknown): ExternalShareInvite | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const id = str(r.id);
  const targetKind = KINDS.includes(r.targetKind as ExternalShareKind)
    ? (r.targetKind as ExternalShareKind)
    : null;
  const role = ROLES.includes(r.role as ExternalShareRole)
    ? (r.role as ExternalShareRole)
    : null;
  const status = STATUSES.includes(r.status as ExternalShareStatus)
    ? (r.status as ExternalShareStatus)
    : null;
  const email = str(r.email);
  if (!id || !targetKind || !role || !status || !email) return null;
  return {
    id,
    targetKind,
    targetId: str(r.targetId),
    email,
    role,
    status,
    invitedByName: str(r.invitedByName, "A teammate"),
    createdAt: str(r.createdAt),
    expiresAt: str(r.expiresAt),
    acceptedAt: typeof r.acceptedAt === "string" ? r.acceptedAt : null,
  };
}

export function readExternalShareInvites(raw: unknown): ExternalShareInvite[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map(readExternalShareInvite)
    .filter((i): i is ExternalShareInvite => i !== null);
}
