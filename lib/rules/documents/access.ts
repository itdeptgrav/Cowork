import type {
  CoworkDocument,
  DocumentMember,
  DocumentRole,
  EmployeeId,
} from "@/lib/domain";

/**
 * Who may do what in a document.
 *
 * ## The gate is not the toolbar
 *
 * Every predicate here is used in TWO places: the UI, so a viewer is not
 * offered controls that would be refused, and the write path, so a viewer who
 * bypasses the UI is refused anyway. The second is the actual permission — for
 * a live document that means the **collaboration socket**, which is why
 * `grav-cms-backend` runs the same rule rather than trusting a client that says
 * it is an editor.
 *
 * ## Why `owner` is a role and not a flag
 *
 * `createdById` records who made the document and never changes; `owner`
 * records who may currently administer it, and must be transferable — somebody
 * leaves the company and their documents have to keep an administrator. Making
 * them the same field means a document whose author has gone is permanently
 * unmanageable.
 */

const RANK: Record<DocumentRole, number> = {
  viewer: 1,
  editor: 2,
  owner: 3,
};

export const ROLE_LABEL: Record<DocumentRole, string> = {
  owner: "Owner",
  editor: "Editor",
  viewer: "Viewer",
};

export const ROLE_HINT: Record<DocumentRole, string> = {
  owner: "Can edit, share and delete.",
  editor: "Can edit the document.",
  viewer: "Can read it. Cannot change anything.",
};

/** This person's role, or null if they are not in the document. */
export function roleOf(
  doc: Pick<CoworkDocument, "members">,
  employeeId: EmployeeId | null,
): DocumentRole | null {
  if (!employeeId) return null;
  return doc.members.find((m) => m.employeeId === employeeId)?.role ?? null;
}

export function canView(
  doc: Pick<CoworkDocument, "members">,
  employeeId: EmployeeId | null,
): boolean {
  return roleOf(doc, employeeId) !== null;
}

export function canEdit(
  doc: Pick<CoworkDocument, "members">,
  employeeId: EmployeeId | null,
): boolean {
  const role = roleOf(doc, employeeId);
  return role !== null && RANK[role] >= RANK.editor;
}

/** Share, change roles, rename, delete. */
export function canManage(
  doc: Pick<CoworkDocument, "members">,
  employeeId: EmployeeId | null,
): boolean {
  return roleOf(doc, employeeId) === "owner";
}

/**
 * Why this person cannot write here, or null.
 *
 * A named refusal rather than a dead control: "nothing happens when I type" is
 * the hardest state to report, and "you have view access" is a fixable one.
 */
export function editRefusal(
  doc: Pick<CoworkDocument, "members">,
  employeeId: EmployeeId | null,
): string | null {
  const role = roleOf(doc, employeeId);
  if (role === null)
    return "You do not have access to this document.";
  if (RANK[role] < RANK.editor)
    return "You have view access to this document. Ask an owner for editing access.";
  return null;
}

/**
 * Why this membership change cannot be made, or null.
 *
 * The load-bearing check is the last: a document must keep an owner. Demoting
 * the only one leaves a document nobody can share or delete, and there is no
 * screen anywhere that can repair it.
 */
export function memberChangeRefusal(input: {
  doc: Pick<CoworkDocument, "members">;
  actorId: EmployeeId | null;
  targetId: EmployeeId;
  /** The role being set, or null to remove them. */
  nextRole: DocumentRole | null;
}): string | null {
  if (!canManage(input.doc, input.actorId))
    return "Only an owner can change who has access.";

  const current = roleOf(input.doc, input.targetId);

  if (input.nextRole === null && current === null)
    return "That person is not in this document.";

  /* Removing yourself is allowed — leaving a document you were added to is
     ordinary — but only while somebody else can still administer it. */
  const owners = input.doc.members.filter((m) => m.role === "owner");
  const losingLastOwner =
    current === "owner" &&
    owners.length === 1 &&
    input.nextRole !== "owner";
  if (losingLastOwner)
    return "This document would be left with no owner. Make somebody else an owner first.";

  return null;
}

/**
 * Apply a membership change.
 *
 * Pure, and it returns BOTH lists — the objects and the flat id index — because
 * they must never be written separately. Firestore cannot query inside an array
 * of objects, so `memberIds` is what `array-contains` reads; letting the two
 * drift means a person who is in `members` but cannot find the document, or one
 * who can find it and has no role.
 */
export function writeMembers(
  members: readonly DocumentMember[],
  change: { employeeId: EmployeeId; role: DocumentRole | null; at: string },
): { members: DocumentMember[]; memberIds: EmployeeId[] } {
  const without = members.filter((m) => m.employeeId !== change.employeeId);
  const next =
    change.role === null
      ? without
      : [
          ...without,
          {
            employeeId: change.employeeId,
            role: change.role,
            /* An existing member keeps the date they were added; only a new one
               is stamped now. Otherwise a role change reads as a re-invitation. */
            addedAt:
              members.find((m) => m.employeeId === change.employeeId)?.addedAt ??
              change.at,
          },
        ];
  return {
    members: next,
    memberIds: [...new Set(next.map((m) => m.employeeId))],
  };
}

/**
 * Read a stored member list, tolerating the shape that came before roles.
 *
 * Documents written in phase 1 carry `memberIds` and no `members`. Those people
 * are **editors**, not viewers: they had full access when the document was
 * written, and silently demoting them on upgrade would take away something
 * nobody chose to take away. The creator becomes the owner.
 */
export function readMembers(raw: {
  members?: unknown;
  memberIds?: unknown;
  createdById?: unknown;
  createdAt?: unknown;
}): DocumentMember[] {
  const createdById =
    typeof raw.createdById === "string" ? raw.createdById : null;
  const at = typeof raw.createdAt === "string" ? raw.createdAt : new Date(0).toISOString();

  if (Array.isArray(raw.members) && raw.members.length > 0) {
    const parsed = raw.members
      .filter((m): m is Record<string, unknown> => !!m && typeof m === "object")
      .map((m) => ({
        employeeId: String(m.employeeId ?? ""),
        role: (["owner", "editor", "viewer"] as const).includes(
          m.role as DocumentRole,
        )
          ? (m.role as DocumentRole)
          : "viewer",
        addedAt: typeof m.addedAt === "string" ? m.addedAt : at,
      }))
      .filter((m) => m.employeeId !== "");
    if (parsed.some((m) => m.role === "owner")) return parsed;
    /* No owner survived. The creator is reinstated rather than leaving a
       document nobody can administer. */
    if (createdById)
      return [
        ...parsed.filter((m) => m.employeeId !== createdById),
        { employeeId: createdById, role: "owner", addedAt: at },
      ];
    return parsed;
  }

  const ids = Array.isArray(raw.memberIds)
    ? raw.memberIds.filter((x): x is string => typeof x === "string")
    : [];
  const all = createdById ? [...new Set([createdById, ...ids])] : ids;
  return all.map((employeeId) => ({
    employeeId,
    role: employeeId === createdById ? "owner" : "editor",
    addedAt: at,
  }));
}
