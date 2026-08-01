"use client";

import type { ReactNode } from "react";
import { EmptyState, Panel, SkeletonRows } from "@/components/ui/Primitives";
import { useQuery } from "@/lib/hooks/useRepository";
import { managesAnyone, NO_TEAM_NOTICE } from "@/lib/rules/team/visibility";

/**
 * Team surfaces, for people who have a team.
 *
 * Wraps a page rather than being checked inside each one, so a new team view
 * gets the rule by being placed here instead of by remembering to ask.
 *
 * **A sentence, not a redirect or a 404.** Somebody who followed a colleague's
 * link, or who used to have reports, needs to know the page exists and is
 * simply not theirs — bouncing them to the dashboard teaches them the product
 * is broken, and "not found" sends them to ask why.
 *
 * This HIDES; it does not protect. Every team read is already scoped
 * server-side to the viewer's reporting closure, so a person with no reports
 * who reached the URL anyway would see themselves and nothing else. The job
 * here is to stop offering a door onto an empty room.
 */
export function TeamGate({ children }: { children: ReactNode }) {
  const viewer = useQuery((r) => r.getViewer(), []);

  /* Nothing decided until the viewer is known. Rendering the page and then
     replacing it with a refusal is worse than a moment of skeleton. */
  if (viewer.isLoading) return <SkeletonRows rows={6} />;

  /* A viewer that failed to load is not evidence of having no team. The page
     is left to make its own error, which it does better than this can. */
  if (!viewer.data) return <>{children}</>;

  if (!managesAnyone(viewer.data)) {
    return (
      <Panel>
        <EmptyState title="No team to show" body={NO_TEAM_NOTICE} />
      </Panel>
    );
  }

  return <>{children}</>;
}
