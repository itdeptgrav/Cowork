/**
 * What is new on each tab of a task, since this person last looked.
 *
 * **The reported gap, 17 Aug 2026.** A task's tabs gave no sign that anything
 * had happened on them: a message arrived in Chat, work was submitted, a
 * reviewer sent it back, and the only way to find out was to open each tab and
 * read it. The tab bar already had a `count` slot — Chat passed `chatCount` —
 * but the legacy mapper hardcoded that to `0`, so the affordance existed and
 * had never shown anything.
 *
 * **Names live in the engine, not here.** The activity map is keyed by tab id
 * and this rule never mentions one, so a tab added later gets a badge by the
 * engine reporting activity for it. A `switch` on tab names here is exactly
 * the thing that would have to be edited twice.
 *
 * **Your own actions are not news to you.** An event this viewer caused is
 * excluded before counting: a badge on the Chat tab for the message you just
 * sent teaches people to ignore badges.
 */

export interface TabEvent {
  /** ISO instant. */
  at: string;
  /** Who caused it, where the engine knows. Null when it does not. */
  by?: string | null;
}

export interface TabActivity {
  /** The most recent event, or null where nothing has ever happened. */
  lastAt: string | null;
  items?: TabEvent[];
}

export interface TabBadge {
  /** How many events are newer than the mark. Zero means no badge. */
  count: number;
  /**
   * Something is new but it cannot be counted.
   *
   * The engine reports `lastAt` for every tab and itemises only some. A tab
   * that changed without an item list gets a dot rather than a number — which
   * is honest, where inventing "1" would be a figure nobody could check.
   */
  dot: boolean;
}

function ms(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
}

/**
 * One tab's badge.
 *
 * **Never seen** counts as everything being new — a task somebody has never
 * opened genuinely has news on it, and treating an absent mark as "seen just
 * now" would hide every message that arrived before their first visit.
 */
export function badgeFor(input: {
  activity: TabActivity | undefined;
  /** ISO of when this person last opened the tab, or null if never. */
  seenAt: string | null | undefined;
  /** The viewer, so their own events are not reported back to them. */
  viewerId: string | null;
}): TabBadge {
  const lastAt = ms(input.activity?.lastAt ?? null);
  if (lastAt === null) return { count: 0, dot: false };

  const seen = ms(input.seenAt ?? null);
  const items = input.activity?.items ?? [];

  if (items.length > 0) {
    const fresh = items.filter((e) => {
      const at = ms(e.at);
      if (at === null) return false;
      if (seen !== null && at <= seen) return false;
      /* Your own doing is not news. Only excluded where the engine actually
         named an author — an unattributed event still counts, because
         suppressing it would hide somebody else's. */
      if (input.viewerId && e.by && e.by === input.viewerId) return false;
      return true;
    });
    return { count: fresh.length, dot: fresh.length > 0 };
  }

  /* No item list: the tab changed, and all that can be said is that it did. */
  const isNew = seen === null || lastAt > seen;
  return { count: 0, dot: isNew };
}

/**
 * Every tab's badge, keyed the same way the engine keyed its activity.
 *
 * Tabs with no activity are simply absent from the result rather than present
 * with a zero — a caller reading `badges[id]?.dot` then cannot accidentally
 * render a badge for a tab the engine said nothing about.
 */
export function tabBadges(input: {
  activity: Record<string, TabActivity> | null | undefined;
  seen: Record<string, string | null> | null | undefined;
  viewerId: string | null;
}): Record<string, TabBadge> {
  const out: Record<string, TabBadge> = {};
  for (const [tabId, activity] of Object.entries(input.activity ?? {})) {
    const badge = badgeFor({
      activity,
      seenAt: input.seen?.[tabId] ?? null,
      viewerId: input.viewerId,
    });
    if (badge.count > 0 || badge.dot) out[tabId] = badge;
  }
  return out;
}

/** Does anything on this task need attention? For a row in a list. */
export function anyUnread(badges: Record<string, TabBadge>): boolean {
  return Object.values(badges).some((b) => b.count > 0 || b.dot);
}
