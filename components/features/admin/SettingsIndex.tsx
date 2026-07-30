"use client";

import Link from "next/link";
import { Chip, Panel, PanelHead } from "@/components/ui/Primitives";
import { IconTabs, WorkspaceHead } from "@/components/ui/Workspace";
import {
  SETTINGS_SECTIONS,
  enforcementNote,
} from "@/lib/rules/settings/sections";
import { ADMIN_TABS, SETTINGS_TABS } from "./adminTabs";
import { SettingsSubNav } from "./SettingsShell";

/**
 * `/admin/settings` — the index, not a redirect to the first section.
 *
 * A redirect would be shorter and would lose the only place that says how the
 * configuration is divided and, per section, **who reads the value once it is
 * saved**. That last fact is the one an administrator cannot get from any form,
 * and it is what decides whether a control can be trusted: a value the Express
 * engine computes published scores from and a value only this UI enforces deserve
 * different amounts of caution, and nothing on a section page can establish the
 * difference as clearly as seeing all six listed together.
 */
export function SettingsIndex() {
  return (
    <>
      <WorkspaceHead
        title="Settings"
        count={
          <>
            <span data-figure>{SETTINGS_TABS.length}</span> sections
          </>
        }
        tabs={<IconTabs items={ADMIN_TABS} active="settings" />}
      />

      <SettingsSubNav active={null} />

      <Panel className="mb-4">
        <p className="max-w-[74ch] text-sm leading-relaxed text-ink-muted">
          Every change made here is recorded with its previous value, its new
          value, who made it and when. Changes that move when live work is
          expected to finish ask for confirmation first, and say so in the record.
        </p>
      </Panel>

      <div className="grid gap-3 deck:grid-cols-2">
        {SETTINGS_SECTIONS.map((section) => (
          <Panel key={section.id} padded={false}>
            <Link
              href={section.href}
              className="block px-4 py-3.5 transition-colors hover:bg-[var(--row-hover)]"
            >
              <span className="flex flex-wrap items-baseline gap-2">
                <span className="text-sm font-medium text-ink">
                  {section.label}
                </span>
                <Chip
                  tone={section.enforcement === "engine" ? "risk" : "neutral"}
                >
                  {section.enforcement === "both"
                    ? "Cowork + legacy"
                    : section.enforcement === "engine"
                      ? "Scoring engine"
                      : "Cowork only"}
                </Chip>
                {section.readOnly && <Chip>Read-only</Chip>}
                {section.mayAffectDeadlines && (
                  <Chip tone="risk" title="Saving asks for confirmation first.">
                    Affects deadlines
                  </Chip>
                )}
              </span>
              <span className="mt-1.5 block text-xs leading-relaxed text-ink-muted">
                {section.summary}
              </span>
              <span className="mt-2 block text-[11px] leading-relaxed text-ink-faint">
                {enforcementNote(section.enforcement)}
              </span>
              <span className="mt-1.5 block text-[11px] text-ink-faint">
                <span data-figure>{section.store}</span>
              </span>
            </Link>
          </Panel>
        ))}
      </div>

      <Panel className="mt-4">
        <PanelHead
          title="What is deliberately not configurable"
          sub="Named here so it reads as a decision rather than a gap."
        />
        <ul className="mt-3 flex flex-col gap-2 text-sm text-ink-muted">
          <li>
            <span className="text-ink">Task statuses.</span> The engine&rsquo;s
            vocabulary. Renaming one here would not rename it there.
          </li>
          <li>
            <span className="text-ink">Priority position.</span> Derived from the
            workload queue per read, not chosen — there is no weight to set.
          </li>
          <li>
            <span className="text-ink">
              The hours-versus-date split on extensions.
            </span>{" "}
            Enforced by the types, because adding hours to a date is always wrong:
            the work sits behind other work and runs through a calendar.
          </li>
          <li>
            <span className="text-ink">Reporting lines and departments.</span> HR
            records. A second place to edit them is a second answer to who
            somebody reports to.
          </li>
        </ul>
      </Panel>
    </>
  );
}
