"use client";

import type { ReactNode } from "react";
import { Chip } from "@/components/ui/Primitives";
import { Icon } from "@/components/ui/Icons";

/**
 * The head of a meeting page: what this is, when, who called it, and the
 * controls that change its state.
 *
 * ## What it replaces, and why that was wrong
 *
 * The page opened with a breadcrumb, then a bare wrapped row of buttons, then
 * the room. There was **no page title anywhere** — the meeting's name appeared
 * only in the breadcrumb's last crumb, at caption size, in muted ink, styled as
 * navigation rather than as the subject of the page. The one thing a reader
 * needs to confirm they are in the right meeting was the smallest text on the
 * screen, and the loudest was a row of five buttons, two of which end the call
 * for everybody.
 *
 * Below `deck` that row wrapped into a ragged pile whose height changed with
 * the meeting's status, so the video moved down the page as a meeting
 * progressed. On a phone it could take three lines before anything else began.
 *
 * ## The composition
 *
 * Identity leads: the title at Headline, then the facts that qualify it on one
 * line — when, how long, who called it — as metadata rather than as a table.
 * The status is a chip beside the title, because "live" is part of what this
 * meeting *is* and belongs with its name.
 *
 * Controls sit at the end of the row on a wide screen and drop to their own
 * full-width row below `sm`, where a thumb reaches the bottom of the screen
 * more easily than the top right. They keep source order, so what a keyboard
 * and a screen reader traverse does not depend on the width of the window.
 *
 * ## Why the facts are here and not only in the rail
 *
 * The Details panel still holds them, and that is not duplication for its own
 * sake: below `deck` the rail moves *underneath* the room, so on a phone the
 * meeting's own time was a full screen-height of scrolling away from its name.
 * A masthead that cannot tell you when the meeting is has not done its job.
 */
export function MeetingMasthead({
  title,
  status,
  when,
  duration,
  organiser,
  actions,
}: {
  title: string;
  status: string;
  when: string;
  duration: string;
  organiser: string;
  /** The organiser's state controls. Absent for everybody else. */
  actions?: ReactNode;
}) {
  return (
    <header className="mb-4 flex flex-col gap-3 deck:flex-row deck:items-start deck:justify-between deck:gap-6">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          {/**
           * **Headline, and `text-balance`.** A meeting title is user-typed and
           * frequently long; left to itself it wraps to a last line holding one
           * word. Balancing costs nothing and stops the ragged orphan.
           */}
          <h1 className="min-w-0 text-[clamp(1.25rem,2.4vw,1.75rem)] leading-[1.15] font-[350] tracking-[-0.03em] text-balance text-ink">
            {title}
          </h1>
          <Chip tone={status === "live" ? "positive" : "neutral"}>
            {status === "waiting" ? "waiting room" : status}
          </Chip>
        </div>

        {/**
         * One metadata line, not a three-row table. These are qualifiers on the
         * title — read with it, in a breath — and the rail's Details panel is
         * where they are laid out as facts to be looked up.
         *
         * Separators are real elements rather than `::before` content so they
         * are not read aloud, and the whole line wraps as units.
         */}
        <div className="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-ink-muted">
          <MetaItem icon={<Icon.calendar className="h-3.5 w-3.5" />}>
            {when}
          </MetaItem>
          <Sep />
          <MetaItem icon={<Icon.clock className="h-3.5 w-3.5" />}>
            {duration}
          </MetaItem>
          <Sep />
          <MetaItem icon={<Icon.user className="h-3.5 w-3.5" />}>
            {organiser}
          </MetaItem>
        </div>
      </div>

      {/**
       * **A row that does not reflow into a pile.** `flex-wrap` with
       * `shrink-0` children keeps each control whole; on a narrow screen they
       * form tidy rows instead of squeezing. `deck:justify-end` puts them at
       * the far edge on a wide screen where the eye finishes.
       */}
      {actions && (
        <div className="flex flex-wrap items-center gap-2 deck:shrink-0 deck:justify-end">
          {actions}
        </div>
      )}
    </header>
  );
}

function MetaItem({
  icon,
  children,
}: {
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5">
      <span className="shrink-0 text-ink-faint">{icon}</span>
      <span className="truncate">{children}</span>
    </span>
  );
}

/** Hidden from assistive technology: it is punctuation, not content. */
function Sep() {
  return (
    <span aria-hidden className="text-ink-faint/60">
      ·
    </span>
  );
}
