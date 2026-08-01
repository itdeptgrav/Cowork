"use client";

import { useState } from "react";
import { Icon } from "@/components/ui/Icons";
import { Field, Input } from "@/components/ui/Primitives";
import { resolveParty } from "@/lib/integrations/mail/transport";
import type { MailParty } from "@/lib/domain";

/**
 * One addressing field — To, Cc or Bcc.
 *
 * Extracted when Cc and Bcc arrived rather than copied twice: the chip list,
 * the comma/Enter handling, the directory suggestions and the
 * "type an address, get an employee" resolution are one behaviour, and three
 * copies of it would be three places for the fields to start behaving
 * differently from each other.
 *
 * `taken` is every address already used in ANY of the three fields, so the
 * suggestion list cannot offer somebody who is already addressed — which is
 * what stops the commonest way of ending up in both To and Bcc.
 */
export function RecipientField({
  label,
  hint,
  required,
  value,
  onChange,
  directory,
  taken,
  autoFocus,
}: {
  label: string;
  hint?: string;
  required?: boolean;
  value: MailParty[];
  onChange: (next: MailParty[]) => void;
  directory: { employeeId: string; address: string; displayName: string }[];
  taken: ReadonlySet<string>;
  autoFocus?: boolean;
}) {
  const [draft, setDraft] = useState("");

  const add = (p: MailParty) => {
    if (value.some((x) => x.address === p.address)) return;
    onChange([...value, p]);
    setDraft("");
  };

  const commit = () => {
    const p = resolveParty(draft, directory);
    if (p) add(p);
  };

  const suggestions = draft.trim()
    ? directory
        .filter(
          (d) =>
            !taken.has(d.address) &&
            `${d.displayName} ${d.address}`
              .toLowerCase()
              .includes(draft.trim().toLowerCase()),
        )
        .slice(0, 4)
    : [];

  return (
    <>
      <Field label={label} hint={hint} required={required}>
        {value.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {value.map((r) => (
              <span
                key={r.address}
                className="inline-flex items-center gap-1.5 rounded-full bg-[var(--control)] px-2.5 py-1 text-[11px] text-ink"
              >
                {r.kind === "employee" ? (
                  <Icon.user className="h-3 w-3" />
                ) : (
                  <Icon.link className="h-3 w-3" />
                )}
                {r.displayName}
                <button
                  type="button"
                  aria-label={`Remove ${r.displayName} from ${label}`}
                  onClick={() =>
                    onChange(value.filter((x) => x.address !== r.address))
                  }
                  className="text-ink-faint hover:text-ink"
                >
                  <Icon.close className="h-3 w-3" />
                </button>
              </span>
            ))}
          </div>
        )}
        <Input
          className={value.length > 0 ? "mt-1.5" : undefined}
          value={draft}
          autoFocus={autoFocus}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === ",") {
              e.preventDefault();
              commit();
            }
          }}
          /* Committed on blur as well as on Enter. A typed address left sitting
             in the box when Send is pressed used to be silently dropped. */
          onBlur={commit}
          placeholder="Search a colleague, or type an email address"
        />
      </Field>

      {suggestions.length > 0 && (
        <ul className="mt-1.5 flex flex-col gap-0.5">
          {suggestions.map((sug) => (
            <li key={sug.employeeId}>
              <button
                type="button"
                /* `onMouseDown` rather than `onClick`: the input's `onBlur`
                   fires first on click and would re-resolve the half-typed
                   text, adding the wrong party before this ever ran. */
                onMouseDown={(e) => {
                  e.preventDefault();
                  add({
                    kind: "employee",
                    employeeId: sug.employeeId,
                    address: sug.address,
                    displayName: sug.displayName,
                  });
                }}
                className="flex w-full items-baseline gap-2 rounded-inset px-2.5 py-1.5 text-left text-sm transition-colors hover:bg-[var(--control)]"
              >
                <span className="text-ink">{sug.displayName}</span>
                <span className="text-[11px] text-ink-faint">{sug.address}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
