import type { EmployeeId, Viewer } from "@/lib/domain";

/**
 * Who sees the team surfaces.
 *
 * **Managing somebody, not holding a title.** Every team view — the Team page,
 * a person's profile, monitoring, the Team lens on the dashboard — answers a
 * question about people beneath you in the reporting tree. Somebody with nobody
 * beneath them gets an empty page and, worse, an invitation to look for
 * colleagues they have no business browsing.
 *
 * Derived from the **reporting closure**, which this product already treats as
 * the source of truth for visibility, monitoring and assignment. Not from a
 * role: a "TL" with an empty team manages nobody, and a senior individual
 * contributor who has picked up one report manages somebody. The tree knows;
 * the title does not.
 *
 * ## This hides, it does not protect
 *
 * Every team read is already scoped server-side to the viewer's closure — a
 * person with no reports who reached `/team` by typing the URL would see their
 * own row and nothing else, because that is all the query returns. So this is
 * about not offering a door that opens onto an empty room, which is a
 * different job from locking one.
 */

/**
 * Whether anybody reports to this person, directly or further down.
 *
 * Reads `hierarchyIds` — the transitive closure — rather than `directReportIds`
 * alone, so a manager whose only reports sit under a vacant intermediate role
 * still counts. **Self is excluded**: the closure includes the viewer in some
 * responses and not others, and "manages themselves" must never read as true.
 */
export function managesAnyone(viewer: Viewer | null | undefined): boolean {
  if (!viewer) return false;
  return peopleUnder(viewer).length > 0;
}

/** Everybody beneath this person, never including themselves. */
export function peopleUnder(viewer: Viewer | null | undefined): EmployeeId[] {
  if (!viewer) return [];
  const ids = new Set<EmployeeId>([
    ...(viewer.hierarchyIds ?? []),
    ...(viewer.directReportIds ?? []),
  ]);
  ids.delete(viewer.employeeId);
  return [...ids];
}

/**
 * Why this person has no team surfaces, or null.
 *
 * A sentence rather than a bare redirect. Somebody who followed a link from a
 * colleague, or who used to have reports, needs to know the page exists and is
 * simply not theirs — "not found" would send them to ask why the product is
 * broken.
 */
export const NO_TEAM_NOTICE =
  "Team views are for people with somebody reporting to them. Nobody reports to you at the moment.";

export function teamRefusal(viewer: Viewer | null | undefined): string | null {
  if (!viewer) return null;
  return managesAnyone(viewer) ? null : NO_TEAM_NOTICE;
}
