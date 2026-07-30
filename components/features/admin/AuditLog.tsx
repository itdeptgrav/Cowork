"use client";

import { useState } from "react";
import {
  Chip,
  ErrorState,
  Panel,
  Segmented,
  SkeletonRows,
} from "@/components/ui/Primitives";
import { useQuery } from "@/lib/hooks/useRepository";
import type { AuditEntry } from "@/lib/rules/settings/audit";
import { formatStamp } from "@/lib/utils/format";
import { AUDIT_SECTION } from "@/lib/rules/settings/sections";

/**
 * Every settings change, and who made it.
 *
 * **The answer to "why did my due date change?"** Office hours feed the deadline
 * chain, so one save moves the expected completion of every live task in the
 * company. Until this existed that change left no trace at all — the only way to
 * find out was to ask around.
 *
 * **A narrower gate than the area it sits in.** The log records what
 * configuration was altered, so somebody who can alter it and also read the record
 * of alterations can cover one change with another. The repository refuses as
 * well, because a page is not the only way to call it.
 *
 * A refusal renders as a refusal, not as an empty log — "nothing has changed" and
 * "you may not see what changed" are different facts and must not look the same.
 */

/**
 * The event, in words a person scanning for a cause would use.
 *
 * Derived from the stored `type`, not from the section — the log is append-only
 * and its rows outlive any renaming of a route, so a row written months ago must
 * still describe itself. An unrecognised type falls back to the raw section rather
 * than to a guess: an honest constant beats a plausible sentence about the wrong
 * thing.
 */
function eventLabel(entry: AuditEntry): string {
  switch (entry.type) {
    case "OFFICE_POLICY_CHANGED":
      return "Office policy changed";
    case "SCORING_CHANGED":
      return "Scoring values changed";
    case "TASK_RULES_CHANGED":
      return "Task rules changed";
    case "WORKFLOW_ROUTING_CHANGED":
      return "Approval routing changed";
    case "PROVISIONAL_RULES_CHANGED":
      return "Provisional rule values published";
    default:
      return entry.section;
  }
}

/** A stored value as a person reads it. Absent is "not set", never blank. */
function show(value: unknown): string {
  if (value === null || value === undefined) return "not set";
  if (typeof value === "string") return value === "" ? "empty" : value;
  return JSON.stringify(value);
}

function Row({
  entry,
  actorName,
  open,
  onToggle,
}: {
  entry: AuditEntry;
  actorName: string | null;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <li className="border-b border-hairline last:border-0">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full flex-wrap items-baseline gap-x-3 gap-y-1 px-5 py-3 text-left transition-colors hover:bg-[var(--control)]"
      >
        <span className="min-w-0 flex-1 text-[13px] text-ink">
          {/* WHO, then WHAT, in one sentence — this is the line somebody reads
              when they are looking for a cause, and splitting the actor into a
              separate column made it scan as metadata rather than as the answer. */}
          <span className="font-medium">
            {actorName ?? (entry.changedById || "Somebody")}
          </span>{" "}
          <span className="text-ink-muted">{eventLabel(entry).toLowerCase()}</span>
        </span>
        <span className="text-[12px] text-ink-muted">
          <span data-figure>{entry.fields.length}</span>{" "}
          {entry.fields.length === 1 ? "field" : "fields"}
        </span>
        <span data-figure className="text-[11px] text-ink-faint">
          {formatStamp(entry.changedAt)}
        </span>
        {entry.affectsDeadlines && (
          /* The consequence, on the row rather than in the detail — somebody
             scanning for what moved their deadline needs it at this level. */
          <Chip tone="rework">Active deadlines recalculated</Chip>
        )}
        <span aria-hidden className="text-[11px] text-ink-faint">
          {open ? "−" : "+"}
        </span>
      </button>

      {open && (
        <div className="bg-[var(--surface-sunken)] px-5 py-3.5">
          <dl className="grid gap-x-4 gap-y-2 sm:grid-cols-[130px_minmax(0,1fr)]">
            <dt className="text-[11px] tracking-[0.09em] text-ink-faint uppercase">
              Who
            </dt>
            <dd className="text-[12px] text-ink">
              {actorName ? (
                <>
                  {actorName}{" "}
                  <span data-figure className="text-ink-faint">
                    {entry.changedById}
                  </span>
                </>
              ) : (
                /* The id, always stored; the name, resolved when possible. Names
                   change and ids do not, which is why the record keeps the id. */
                <span data-figure>{entry.changedById || "unknown"}</span>
              )}
            </dd>

            <dt className="text-[11px] tracking-[0.09em] text-ink-faint uppercase">
              When
            </dt>
            <dd data-figure className="text-[12px] text-ink">
              {formatStamp(entry.changedAt)}
            </dd>

            <dt className="text-[11px] tracking-[0.09em] text-ink-faint uppercase">
              What changed
            </dt>
            <dd className="flex flex-col gap-2">
              {entry.fields.map((field) => (
                <div key={field.path}>
                  <p className="text-[12px] text-ink-muted">{field.path}</p>
                  <p className="mt-0.5 flex flex-wrap items-baseline gap-2 text-[12px]">
                    <span data-figure className="text-ink-faint line-through">
                      {show(field.oldValue)}
                    </span>
                    <span aria-hidden className="text-ink-faint">
                      →
                    </span>
                    <span data-figure className="text-ink">
                      {show(field.newValue)}
                    </span>
                  </p>
                </div>
              ))}
            </dd>

            <dt className="text-[11px] tracking-[0.09em] text-ink-faint uppercase">
              Impact
            </dt>
            <dd className="text-[12px] text-ink-muted">
              {entry.affectsDeadlines ? (
                <>
                  Active task deadlines recalculated. Committed dates were not
                  moved — what changed is when the work is now expected to finish
                  once it is laid out through the working calendar.
                </>
              ) : (
                "No effect on live deadlines."
              )}
            </dd>

            {entry.reason && (
              <>
                <dt className="text-[11px] tracking-[0.09em] text-ink-faint uppercase">
                  Reason
                </dt>
                <dd className="text-[12px] text-ink-muted">
                  &ldquo;{entry.reason}&rdquo;
                </dd>
              </>
            )}
          </dl>
        </div>
      )}
    </li>
  );
}

const SECTION_FILTERS = [
  { id: "all", label: "All" },
  ...Object.values(AUDIT_SECTION)
    .filter((v, i, a) => a.indexOf(v) === i)
    .map((section) => ({ id: section, label: section.replace(/_/g, " ") })),
];

export function AuditLog() {
  const log = useQuery((r) => r.listSettingsAudit(100), []);
  /* Names for the ids the log stores. Failure is tolerable: the entry still
     renders with its id, which is the durable half of the record. A log that
     refused to display because a directory read failed would withhold the thing
     somebody came for. */
  const people = useQuery((r) => r.listEmployees(), []);
  const [openId, setOpenId] = useState<string | null>(null);
  const [section, setSection] = useState("all");

  if (log.isLoading) return <SkeletonRows rows={6} />;

  if (log.error) {
    /* A refusal is not an empty log. Rendering it as one would tell somebody
       nothing has ever changed, which is a different and false claim. */
    return (
      <Panel>
        <ErrorState title="Audit log unavailable" body={log.error} />
      </Panel>
    );
  }

  const nameOf = (id: string) =>
    (people.data ?? []).find((p) => p.id === id)?.displayName ?? null;

  const entries = (log.data ?? []).filter(
    (e) => section === "all" || e.section === section,
  );
  const withDeadlineImpact = (log.data ?? []).filter(
    (e) => e.affectsDeadlines,
  ).length;

  return (
    <Panel className="p-0">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-hairline px-5 py-3">
        <div className="min-w-0">
          <p className="text-[11px] tracking-[0.09em] text-ink-faint uppercase">
            Audit log
          </p>
          <p className="mt-0.5 text-[12px] text-ink-faint">
            Every system settings change, newest first, with its previous and new
            value. Only a system administrator can read this.
            {withDeadlineImpact > 0 && (
              <>
                {" "}
                <span data-figure>{withDeadlineImpact}</span>{" "}
                {withDeadlineImpact === 1 ? "entry" : "entries"} recalculated
                deadlines.
              </>
            )}
          </p>
        </div>
        {(log.data ?? []).length > 0 && (
          <Segmented
            label="Section"
            size="sm"
            value={section}
            onChange={setSection}
            options={SECTION_FILTERS}
          />
        )}
      </div>

      {entries.length === 0 ? (
        <p className="px-5 py-6 text-sm text-ink-faint">
          {section === "all"
            ? "No settings have been changed yet."
            : "Nothing has been changed in this section."}
        </p>
      ) : (
        <ul>
          {entries.map((e) => (
            <Row
              key={e.id}
              entry={e}
              actorName={nameOf(e.changedById)}
              open={openId === e.id}
              onToggle={() => setOpenId(openId === e.id ? null : e.id)}
            />
          ))}
        </ul>
      )}
    </Panel>
  );
}
