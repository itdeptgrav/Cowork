"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { getRepository } from "@/lib/repositories";
import { notifyRepositoryChanged } from "@/lib/repositories/events";
import type { SimulatedFailure } from "@/lib/repositories";
import { openDecisionCount } from "@/lib/config/provisional";

/**
 * Prototype controls: reset the demo data and force the failure states every
 * page has to handle.
 *
 * This exists ONLY in the prototype. It is the visible edge of the temporary
 * state layer, and it goes away with the mock repository.
 */
export function DemoBar() {
  const [open, setOpen] = useState(false);
  const [failure, setFailure] = useState<SimulatedFailure>("none");
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  const modes: { id: SimulatedFailure; label: string }[] = [
    { id: "none", label: "Normal" },
    { id: "offline", label: "Offline" },
    { id: "error", label: "Error" },
    { id: "permission_denied", label: "Denied" },
  ];

  async function reset() {
    setBusy(true);
    await getRepository().resetDemoData();
    setFailure("none");
    getRepository().setSimulatedFailure("none");
    router.refresh();
    setBusy(false);
    // A full reload is the honest way to clear every component's local state.
    window.location.reload();
  }

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-40 flex justify-center px-3 pb-3">
      <div className="frost-bar pointer-events-auto flex items-center gap-2 rounded-full py-1.5 pr-1.5 pl-4">
        <span className="text-xs text-ink-faint">
          Prototype
          <span className="mx-1.5 opacity-40">·</span>
          sample data
        </span>

        {open && (
          <>
            <span className="h-4 w-px bg-hairline" />
            <div
              role="radiogroup"
              aria-label="Simulate a failure state"
              className="flex items-center gap-0.5 rounded-full bg-[var(--surface-sunken)] p-[3px]"
            >
              {modes.map((m) => {
                const active = failure === m.id;
                return (
                  <button
                    key={m.id}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    onClick={() => {
                      setFailure(m.id);
                      getRepository().setSimulatedFailure(m.id);
                      /* Every mounted query refetches, so the switch actually
                         shows the states rather than only arming them for the
                         next navigation. */
                      notifyRepositoryChanged();
                    }}
                    className={`rounded-full px-2.5 py-1 text-xs font-medium transition-colors duration-[180ms] ${
                      active
                        ? "bg-ink text-[var(--body-bg)]"
                        : "text-ink-muted hover:text-ink"
                    }`}
                  >
                    {m.label}
                  </button>
                );
              })}
            </div>
            <span className="h-4 w-px bg-hairline" />
            <a
              href="/admin/scoring-rules"
              className="rounded-full px-2.5 py-1 text-xs text-ink-muted hover:text-ink"
              title="Every unconfirmed rule the prototype is standing in for"
            >
              {openDecisionCount()} provisional rules
            </a>
            <button
              type="button"
              onClick={reset}
              disabled={busy}
              className="rounded-full px-2.5 py-1 text-xs text-ink-muted hover:text-ink disabled:opacity-50"
            >
              {busy ? "Resetting…" : "Reset data"}
            </button>
          </>
        )}

        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="grid h-7 w-7 place-items-center rounded-full text-ink-muted transition-colors hover:bg-[var(--surface-sunken)] hover:text-ink"
          aria-label={
            open ? "Hide prototype controls" : "Show prototype controls"
          }
        >
          <svg
            viewBox="0 0 16 16"
            className="h-3.5 w-3.5"
            fill="none"
            aria-hidden="true"
          >
            <path
              d={open ? "M4 10l4-4 4 4" : "M4 6l4 4 4-4"}
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      </div>
    </div>
  );
}
