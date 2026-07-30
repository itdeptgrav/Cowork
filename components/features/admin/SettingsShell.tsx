"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { IconTabs, WorkspaceHead } from "@/components/ui/Workspace";
import { Chip, InlineError, Panel } from "@/components/ui/Primitives";
import { usePermissions } from "@/lib/hooks/usePermissions";
import {
  enforcementNote,
  sectionById,
  type SettingsSectionId,
} from "@/lib/rules/settings/sections";
import { ADMIN_TABS, SETTINGS_TABS } from "./adminTabs";

/**
 * The frame every settings section renders inside.
 *
 * One frame rather than each section assembling its own heading, sub-navigation
 * and permission notice. Six copies of that is six places for the read-only
 * notice to be forgotten, and the section that forgot it would silently look
 * editable to somebody whose save the repository is going to refuse.
 *
 * **It states where the value is stored and who reads it.** That is the fact an
 * administrator cannot get from a form and the one that decides whether to trust
 * the control — a value this app enforces and the legacy app ignores is a real
 * and temporary condition of a half-migrated product, and it belongs on screen
 * rather than in a handoff document.
 */
export function SettingsShell({
  section,
  children,
  count,
  action,
}: {
  section: SettingsSectionId;
  children: ReactNode;
  /** The section's own summary figure, e.g. "5 working days". */
  count?: ReactNode;
  action?: ReactNode;
}) {
  const meta = sectionById(section);
  const perms = usePermissions();
  const canEdit = perms.can("score.configure");

  return (
    <>
      <WorkspaceHead
        title={meta.label}
        count={count ?? meta.summary}
        tabs={<IconTabs items={ADMIN_TABS} active="settings" />}
        action={action}
      />

      <SettingsSubNav active={section} />

      {/* Provenance, before the controls. Somebody about to change a published
          score should know it is a published score before they touch the field,
          not after they press Save. */}
      <Panel className="mb-4">
        <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
          <Chip
            tone={meta.enforcement === "engine" ? "risk" : "neutral"}
            title={enforcementNote(meta.enforcement)}
          >
            {meta.enforcement === "both"
              ? "Cowork + legacy"
              : meta.enforcement === "engine"
                ? "Scoring engine"
                : "Cowork only"}
          </Chip>
          <p className="min-w-0 flex-1 text-xs leading-relaxed text-ink-muted">
            {enforcementNote(meta.enforcement)}{" "}
            <span className="text-ink-faint">
              Stored in <span data-figure>{meta.store}</span>.
            </span>
          </p>
        </div>
        {meta.mayAffectDeadlines && (
          <p className="mt-2.5 border-t border-hairline pt-2.5 text-xs leading-relaxed text-ink-muted">
            Saving this can change when live work is expected to finish. The
            committed deadline never moves on its own — what changes is the
            operational date derived from the calendar.
          </p>
        )}
      </Panel>

      {meta.readOnly ? (
        <div className="mb-4">
          <InlineError message={meta.readOnly} />
        </div>
      ) : (
        !canEdit &&
        perms.ready && (
          <div className="mb-4">
            {/* The words the repository uses, not a paraphrase. A help article
                or a screen that describes a refusal differently than the refusal
                itself is hard to match against what somebody is looking at. */}
            <InlineError message="You can read these settings but not change them. Only a system administrator can change system settings." />
          </div>
        )
      )}

      {children}
    </>
  );
}

/**
 * The Settings sub-navigation.
 *
 * A separate strip rather than more entries in `IconTabs`: these are peers of
 * each other and children of Settings, and rendering them at the same weight as
 * Overview is what made the old flat console shapeless.
 */
export function SettingsSubNav({ active }: { active: SettingsSectionId | null }) {
  return (
    <nav aria-label="Settings sections" className="mb-4">
      <ul className="rail flex flex-wrap items-center gap-1.5">
        {SETTINGS_TABS.map((tab) => {
          const on = tab.id === active;
          return (
            <li key={tab.id}>
              <Link
                href={tab.href}
                aria-current={on ? "page" : undefined}
                className={`inline-flex shrink-0 items-center rounded-full px-3 py-1.5 text-xs font-medium tracking-[-0.012em] transition-[color,background-color] duration-[180ms] ease-[var(--ease-deck)] ${
                  on
                    ? "bg-ink text-[var(--body-bg)]"
                    : "bg-[var(--control)] text-ink-muted hover:bg-[var(--control-hover)] hover:text-ink"
                }`}
              >
                {tab.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
