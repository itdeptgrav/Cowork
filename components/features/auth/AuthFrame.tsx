"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { Mark } from "@/components/layout/shell/Mark";

/**
 * The frame both auth routes sit in.
 *
 * Two panels on the field: the product's own claim on the left, the form on the
 * right. The left half is not decoration — it is the only thing that makes this
 * read as Cowork rather than as a login page any product could have shipped,
 * and it says what the score model actually is rather than three adjectives.
 *
 * Below the deck breakpoint the left half is dropped rather than stacked. On a
 * narrow screen somebody signing in wants the fields, and a paragraph of
 * positioning above them is an obstacle between a person and their work.
 *
 * The material is the system's own: `frost-panel` at the panel radius over the
 * iridescent field, which `AppShell` keeps mounted on these routes precisely so
 * the first thing anyone sees of the product is its own surface.
 */
export function AuthFrame({
  title,
  lede,
  children,
  footer,
}: {
  title: string;
  lede: string;
  children: ReactNode;
  footer: ReactNode;
}) {
  return (
    <div className="grid min-h-dvh place-items-center px-[clamp(16px,4vw,48px)] py-[clamp(24px,5vh,64px)]">
      <div className="grid w-full max-w-[1080px] items-stretch gap-[clamp(16px,2vw,28px)] deck:grid-cols-[minmax(0,1fr)_minmax(0,460px)]">
        <Pitch />

        <section
          aria-label={title}
          className="frost-panel flex flex-col justify-center rounded-panel px-[clamp(20px,3vw,36px)] py-[clamp(24px,3.5vw,40px)]"
        >
          <div className="deck:hidden">
            <Mark className="h-7 w-7" />
          </div>
          <h1 className="mt-4 text-[clamp(1.5rem,2.6vw,2.125rem)] leading-[1.08] font-light tracking-[-0.03em] text-ink deck:mt-0">
            {title}
          </h1>
          <p className="mt-2 max-w-[46ch] text-sm leading-relaxed text-ink-muted">
            {lede}
          </p>

          <div className="mt-6">{children}</div>

          <div className="mt-6 border-t border-hairline pt-4 text-sm text-ink-muted">
            {footer}
          </div>
        </section>
      </div>
    </div>
  );
}

/**
 * What Cowork is, in the product's own words.
 *
 * Taken from `docs/architecture/PRODUCT.md` rather than written fresh: execution and measurement
 * are one system, and the score is a percentage of an achievable ceiling. No
 * figures — per the same document, any score shown must be self-evidently
 * illustrative, and a marketing panel is the last place to imply a number the
 * product has not computed for anybody.
 */
function Pitch() {
  return (
    <section
      aria-hidden="true"
      className="hidden flex-col justify-between rounded-panel px-[clamp(20px,2.5vw,32px)] py-[clamp(24px,3vw,36px)] deck:flex"
    >
      <div className="flex items-center gap-2.5">
        <Mark className="h-7 w-7" />
        <span className="text-[17px] leading-none font-medium tracking-[-0.03em] text-ink">
          cowork
        </span>
      </div>

      <div className="py-10">
        <p className="max-w-[22ch] text-[clamp(1.75rem,3.4vw,2.75rem)] leading-[1.05] font-light tracking-[-0.035em] text-ink">
          Where the work gets done, and where it gets measured.
        </p>
        <p className="mt-5 max-w-[42ch] text-sm leading-relaxed text-ink-muted">
          Tasks, projects, meetings, documents and team workflows in one
          workspace — with performance derived from the same actions rather than
          collected separately at review time.
        </p>
      </div>

      {/* On the FIELD, so every value here obeys The Field Is Not A Text Surface
          Rule: `ink-faint` is a panel-only token and anything under Body size
          has to move onto a surface. These were 12px faint and read as ghosts
          over the field's lighter drifts — the composite contrast varies with
          scroll position, so no amount of re-tuning could certify them. Body
          size in `ink-muted` is the sanctioned pairing out here. */}
      <ul className="flex flex-col gap-3">
        {[
          ["C1", "Task execution", "How work landed, not merely that it did"],
          ["C2", "Goals", "Attainment against what was set"],
          ["C3", "Policy", "Deduction only, never a score of its own"],
          ["C4", "Attendance", "The steady baseline underneath"],
        ].map(([code, label, note]) => (
          <li key={code} className="flex items-baseline gap-3">
            <span
              data-figure
              className="w-6 shrink-0 text-sm font-medium text-ink"
            >
              {code}
            </span>
            <span className="min-w-0 text-sm">
              <span className="text-ink">{label}</span>
              <span className="ml-2 text-ink-muted">{note}</span>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** The link line under each form. */
export function AuthSwitch({
  question,
  href,
  action,
}: {
  question: string;
  href: string;
  action: string;
}) {
  return (
    <p>
      {question}{" "}
      <Link
        href={href}
        className="font-medium text-ink underline decoration-hairline underline-offset-4 transition-colors hover:decoration-current"
      >
        {action}
      </Link>
    </p>
  );
}
