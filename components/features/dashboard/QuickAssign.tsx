"use client";

import Link from "next/link";
import { Card } from "./Card";
import { Avatar } from "@/components/ui/Avatar";
import { Icon } from "@/components/ui/Icons";
import { QueryError, SkeletonRows } from "@/components/ui/Primitives";
import { useQuery } from "@/lib/hooks/useRepository";
import { useViewerId } from "@/lib/hooks/usePermissions";

/**
 * "Hand work over" — the reference's Quick send.
 *
 * Its anatomy there is a title, a `+` at the top right, and a row of faces you
 * can send to without opening anything. The same shape carries the one action a
 * dashboard can offer that is not "go and look at something": start a task for
 * a named person, from the row of people you actually work with.
 *
 * Deliberately the smallest card on the page. It sits under the meeting card in
 * the right column exactly as the reference stacks its own pair, and it is the
 * last thing the eye reaches.
 */
export function QuickAssign() {
  const viewerId = useViewerId();
  const viewer = useQuery((r) => r.getViewer(), []);
  const people = useQuery((r) => r.listEmployees(), []);

  /* Reports first — the people a task is most likely to go to — then anyone
     else, so the row is never empty for someone who manages nobody. */
  const ids = viewer.data?.hierarchyIds ?? [];
  const all = people.data ?? [];
  const ordered = [
    ...all.filter((p) => ids.includes(p.id) && p.id !== viewerId),
    ...all.filter((p) => !ids.includes(p.id) && p.id !== viewerId),
  ].slice(0, 5);

  return (
    <Card
      title="Hand work over"
      headerRight={
        <Link
          href="/tasks/new"
          aria-label="New task"
          title="New task"
          className="grid h-7 w-7 place-items-center rounded-full bg-[var(--control)] text-ink transition-colors hover:bg-[var(--control-hover)]"
        >
          <Icon.plus className="h-3.5 w-3.5" />
        </Link>
      }
      className="min-w-0"
    >
      {people.error || viewer.error ? (
        <QueryError
          compact
          queries={[people, viewer]}
          message="People could not be loaded."
        />
      ) : people.isLoading ? (
        <SkeletonRows rows={1} />
      ) : ordered.length === 0 ? (
        <p className="text-[11px] text-ink-faint">
          Nobody else is in this workspace yet.
        </p>
      ) : (
        <>
          <ul className="flex flex-wrap items-center gap-1.5">
            {ordered.map((p) => (
              <li key={p.id}>
                <Link
                  href={`/tasks/new?assignee=${p.id}`}
                  aria-label={`New task for ${p.displayName}`}
                  title={`New task for ${p.displayName}`}
                  className="block rounded-full transition-transform hover:-translate-y-0.5"
                >
                  <Avatar
                    initials={p.initials}
                    hue={p.hue}
                    src={p.profilePictureUrl}
                    name={p.displayName}
                    size="md"
                  />
                </Link>
              </li>
            ))}
          </ul>
          <p className="mt-2.5 text-[11px] text-ink-faint">
            Start a task for someone without leaving this page.
          </p>
        </>
      )}
    </Card>
  );
}
