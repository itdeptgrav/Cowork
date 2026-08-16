"use client";

/**
 * The formula helper popover — the thing that made `=` feel inert without it.
 *
 * Two faces, chosen by the caller from `formulaAssist`:
 *   · a LIST of functions matching the name being typed, each with its signature,
 *     the highlighted one expanded with a plain-language description and example;
 *   · a SIGNATURE for the function whose arguments are being filled, with the
 *     current argument in bold.
 *
 * Purely presentational: it positions itself where the caller says and reports
 * clicks and hovers back. It swallows its own `mousedown` so picking a suggestion
 * does not blur the cell editor (which would commit the edit before the click).
 */

import type { CSSProperties } from "react";
import {
  renderSignature,
  type FunctionHelp,
} from "@/lib/spreadsheet/formula/catalog";
import { activeArgIndex } from "@/lib/spreadsheet/formula/assist";

export type HelperView =
  | { kind: "list"; items: FunctionHelp[]; active: number }
  | { kind: "signature"; help: FunctionHelp; argIndex: number };

function SignatureLine({ help, argIndex }: { help: FunctionHelp; argIndex: number }) {
  if (help.signature) {
    return <span className="font-mono text-ink">{help.signature}</span>;
  }
  const active = activeArgIndex(help, argIndex);
  return (
    <span className="font-mono text-ink-muted">
      <span className="text-ink">{help.name}</span>(
      {help.args.map((a, i) => {
        const label = a.repeatable
          ? a.optional
            ? `[${a.name}, …]`
            : `${a.name}, …`
          : a.optional
            ? `[${a.name}]`
            : a.name;
        return (
          <span key={i}>
            {i > 0 ? ", " : ""}
            <span className={i === active ? "font-semibold text-ink" : undefined}>
              {label}
            </span>
          </span>
        );
      })}
      )
    </span>
  );
}

function Description({ help }: { help: FunctionHelp }) {
  return (
    <div className="border-t border-hairline px-3 py-2">
      <p className="leading-snug text-ink-muted">{help.summary}</p>
      <p className="mt-1.5 font-mono text-[11px] text-ink-faint">
        e.g. {help.example}
      </p>
    </div>
  );
}

export function FormulaHelper({
  view,
  style,
  placement,
  onPick,
  onHover,
}: {
  view: HelperView;
  style: CSSProperties;
  /** `above` flips the box so its bottom sits on the anchor point. */
  placement: "above" | "below";
  onPick: (help: FunctionHelp) => void;
  onHover: (index: number) => void;
}) {
  return (
    <div
      className="pointer-events-auto absolute z-30 w-[320px] max-w-[80vw] overflow-hidden rounded-card border border-hairline bg-[var(--surface-raised)] text-[12px] text-ink shadow-lg"
      style={{
        ...style,
        transform: placement === "above" ? "translateY(-100%)" : undefined,
      }}
      /* Keep focus in the editor so a click here doesn't blur-and-commit. */
      onMouseDown={(e) => e.preventDefault()}
      role={view.kind === "list" ? "listbox" : undefined}
    >
      {view.kind === "signature" ? (
        <>
          <div className="px-3 py-2">
            <SignatureLine help={view.help} argIndex={view.argIndex} />
          </div>
          <Description help={view.help} />
        </>
      ) : (
        <ul className="max-h-[260px] overflow-y-auto py-1">
          {view.items.map((h, i) => {
            const selected = i === view.active;
            const argsPart = renderSignature(h).slice(h.name.length);
            return (
              <li key={h.name}>
                <button
                  type="button"
                  role="option"
                  aria-selected={selected}
                  onMouseEnter={() => onHover(i)}
                  onClick={() => onPick(h)}
                  className={`flex w-full items-baseline gap-1.5 px-3 py-1.5 text-left transition-colors ${
                    selected
                      ? "bg-[color-mix(in_srgb,var(--ink)_8%,transparent)]"
                      : "hover:bg-[color-mix(in_srgb,var(--ink)_5%,transparent)]"
                  }`}
                >
                  <span className="font-mono font-semibold text-ink">{h.name}</span>
                  <span className="truncate font-mono text-[11px] text-ink-muted">
                    {argsPart}
                  </span>
                </button>
                {selected && <Description help={h} />}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
