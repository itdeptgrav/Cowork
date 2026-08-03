import type { EmployeeId, MindMapRecord, MindMapRole } from "@/lib/domain";

/**
 * Who may do what to a mindmap.
 *
 * The same three roles a document has, answering the same three questions, and
 * deliberately not a shared generic over both: the two records have different
 * shapes and the day one of them grows a fourth role or an organisation-wide
 * default, a shared helper would either fork or start lying about one of them.
 * Two short files that agree today are cheaper than one that has to be told
 * which kind of thing it is holding.
 *
 * **The engine is the authority.** Every one of these is also enforced in
 * `coworkMindmaps.js`, and it has to be — this file decides which BUTTONS a
 * person sees, and a button is not a permission. What it buys is that somebody
 * is not offered a control that would fail, which is its own kind of honesty.
 */

export function roleOf(
  map: MindMapRecord,
  employeeId: EmployeeId | null,
): MindMapRole | null {
  if (!employeeId) return null;
  return (
    map.members.find((m) => m.employeeId === employeeId)?.role ?? null
  );
}

export function canView(
  map: MindMapRecord,
  employeeId: EmployeeId | null,
): boolean {
  return roleOf(map, employeeId) !== null;
}

export function canEdit(
  map: MindMapRecord,
  employeeId: EmployeeId | null,
): boolean {
  const role = roleOf(map, employeeId);
  return role === "owner" || role === "editor";
}

/** Rename, delete, and change who is on it. */
export function canManage(
  map: MindMapRecord,
  employeeId: EmployeeId | null,
): boolean {
  return roleOf(map, employeeId) === "owner";
}

/**
 * Why this person cannot change this map, in words, or null if they can.
 *
 * A sentence rather than a boolean because it is shown: "you can view this
 * mindmap but not change it" tells somebody their cards are read-only and
 * nothing else does — a canvas that simply ignores clicks reads as broken.
 *
 * The wording matches the engine's refusal for the same case, so the screen and
 * a failed request do not describe the same rule in two different ways.
 */
export function editRefusal(
  map: MindMapRecord,
  employeeId: EmployeeId | null,
): string | null {
  if (canEdit(map, employeeId)) return null;
  if (canView(map, employeeId))
    return "You can view this mindmap but not change it.";
  return "You do not have access to this mindmap.";
}
