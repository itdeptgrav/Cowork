"use client";

import Link from "next/link";
import {
  Chip,
  Panel,
  PanelHead,
  SkeletonRows,
} from "@/components/ui/Primitives";
import { IconTabs, WorkspaceHead } from "@/components/ui/Workspace";
import { useQuery } from "@/lib/hooks/useRepository";
import { formatDateTime } from "@/lib/utils/format";
import {
  SETTINGS_SECTIONS,
  enforcementNote,
} from "@/lib/rules/settings/sections";
import { ADMIN_REFERENCE_PAGES, ADMIN_TABS } from "./adminTabs";

/**
 * `/admin` — the console's front door.
 *
 * **This route had no page at all.** `/admin` rendered the layout's guard and then
 * nothing, so the console's own root was a dead URL and every entry point had to
 * name a section. `landingFor("system_admin")` pointed at `/admin/organisation`
 * for the same reason.
 *
 * What belongs on an overview is what an administrator needs before choosing where
 * to go: the size of the thing they administer, what was changed most recently, and
 * which parts of the configuration are enforced where. Not a dashboard of metrics —
 * those live in the product's own surfaces, and duplicating them here would be a
 * second answer to every figure.
 */
export function AdminOverview() {
  const people = useQuery((r) => r.listEmployees(), []);
  const departments = useQuery((r) => r.listDepartments(), []);
  /* The five most recent entries, not the whole log. The log has its own page;
     this is "has anything changed lately", which five rows answers. */
  const audit = useQuery((r) => r.listSettingsAudit(5), []);

  return (
    <>
      <WorkspaceHead
        title="Administration"
        count="System configuration and its record"
        tabs={<IconTabs items={ADMIN_TABS} active="overview" />}
      />

      <div className="grid gap-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <Stat
            label="People"
            value={people.data?.length}
            hint="In the Cowork directory"
          />
          <Stat
            label="Departments"
            value={departments.data?.length}
            hint="Grouping only — reach comes from the reporting line"
          />
          <Stat
            label="Settings sections"
            value={SETTINGS_SECTIONS.length}
            hint="Each one names where its values are stored"
          />
        </div>

        <Panel padded={false}>
          <PanelHead
            title="Settings"
            sub="What each section controls, and who reads the value once it is saved."
          />
          <ul className="divide-y divide-hairline">
            {SETTINGS_SECTIONS.map((section) => (
              <li key={section.id}>
                <Link
                  href={section.href}
                  className="block px-4 py-3 transition-colors hover:bg-[var(--row-hover)]"
                >
                  <span className="flex flex-wrap items-baseline gap-2">
                    <span className="text-sm font-medium text-ink">
                      {section.label}
                    </span>
                    <Chip
                      tone={section.enforcement === "engine" ? "risk" : "neutral"}
                      title={enforcementNote(section.enforcement)}
                    >
                      {section.enforcement === "both"
                        ? "Cowork + legacy"
                        : section.enforcement === "engine"
                          ? "Scoring engine"
                          : "Cowork only"}
                    </Chip>
                    {section.readOnly && <Chip>Read-only</Chip>}
                  </span>
                  <span className="mt-1 block max-w-[74ch] text-xs leading-relaxed text-ink-muted">
                    {section.summary}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </Panel>

        <Panel padded={false}>
          <PanelHead
            title="Recent changes"
            sub="Newest first. The full record, with every before and after value, is in the audit log."
          />
          {audit.isLoading ? (
            <div className="px-4 py-3">
              <SkeletonRows rows={3} />
            </div>
          ) : audit.error ? (
            /* A refusal renders as a refusal. An empty log and a log this person
               may not read are different facts, and showing "nothing yet" for the
               second would be a lie that happens to look reassuring. */
            <p className="px-4 py-3 text-sm text-ink-muted">{audit.error}</p>
          ) : !audit.data?.length ? (
            <p className="px-4 py-3 text-sm text-ink-muted">
              No settings have been changed yet.
            </p>
          ) : (
            <ul className="divide-y divide-hairline">
              {audit.data.map((entry) => (
                <li key={entry.id} className="px-4 py-2.5">
                  <p className="flex flex-wrap items-baseline gap-x-2 text-xs">
                    <span className="text-ink">{entry.section}</span>
                    <span className="text-ink-faint">
                      <span data-figure>{entry.fields.length}</span>{" "}
                      {entry.fields.length === 1 ? "field" : "fields"}
                    </span>
                    <span className="text-[11px] text-ink-faint">
                      {formatDateTime(entry.changedAt)}
                    </span>
                    {entry.affectsDeadlines && (
                      <Chip tone="risk">Deadlines recalculated</Chip>
                    )}
                  </p>
                </li>
              ))}
            </ul>
          )}
          <div className="border-t border-hairline px-4 py-2.5">
            <Link
              href="/admin/audit"
              className="text-xs text-ink underline underline-offset-2"
            >
              Open the audit log
            </Link>
          </div>
        </Panel>

        <Panel padded={false}>
          <PanelHead
            title="Reference"
            sub="Records Cowork reads rather than configuration it owns."
          />
          <ul className="divide-y divide-hairline">
            {ADMIN_REFERENCE_PAGES.map((page) => (
              <li key={page.id}>
                <Link
                  href={page.href}
                  className="block px-4 py-3 transition-colors hover:bg-[var(--row-hover)]"
                >
                  <span className="text-sm font-medium text-ink">
                    {page.label}
                  </span>
                  <span className="mt-1 block max-w-[74ch] text-xs leading-relaxed text-ink-muted">
                    {page.summary}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </Panel>
      </div>
    </>
  );
}

/**
 * One figure.
 *
 * An unresolved count renders as an em dash rather than zero. Zero people is a
 * claim about the organisation; not having loaded yet is a claim about the
 * request, and the two must not look the same.
 */
function Stat({
  label,
  value,
  hint,
}: {
  label: string;
  value: number | undefined;
  hint: string;
}) {
  return (
    <Panel>
      <p className="text-[11px] tracking-[0.09em] text-ink-faint uppercase">
        {label}
      </p>
      <p
        data-figure
        className="mt-1 text-[26px] leading-none font-light tracking-[-0.03em] text-ink"
      >
        {value ?? "—"}
      </p>
      <p className="mt-1.5 text-[11px] leading-relaxed text-ink-faint">{hint}</p>
    </Panel>
  );
}
