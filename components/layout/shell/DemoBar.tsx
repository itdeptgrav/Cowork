"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getRepository } from "@/lib/repositories";
import { notifyRepositoryChanged } from "@/lib/repositories/events";
import type { SimulatedFailure } from "@/lib/repositories";
import { openDecisionCount } from "@/lib/config/provisional";
import type { Employee } from "@/lib/domain";
import {
  PROFILE_STORAGE_KEY,
  PROFILE_SWITCHER_ENABLED,
} from "@/lib/config/profileSwitcher";

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

  /**
   * Everybody the prototype can act as.
   *
   * `profileSwitcher.ts` has carried the storage key and both safety gates
   * since it was written, but nothing ever offered a way to SET it and nothing
   * applied it to the repository — so the thing the prototype exists for,
   * walking a flow whose steps belong to different people, could not be done.
   *
   * Switching people, not roles: department, reporting line, permissions,
   * tasks and approvals all follow from the acting employee already.
   */
  const [people, setPeople] = useState<Employee[]>([]);
  const [actingId, setActingId] = useState<string | null>(null);

  useEffect(() => {
    if (!PROFILE_SWITCHER_ENABLED) return;
    let live = true;
    void getRepository()
      .listEmployees()
      .then((list) => {
        if (!live) return;
        setPeople(list);
        setActingId(window.localStorage.getItem(PROFILE_STORAGE_KEY));
      });
    return () => {
      live = false;
    };
  }, []);

  function actAs(employeeId: string | null) {
    if (employeeId) window.localStorage.setItem(PROFILE_STORAGE_KEY, employeeId);
    else window.localStorage.removeItem(PROFILE_STORAGE_KEY);
    getRepository().setActingEmployee?.(employeeId);
    /* A reload, not a refetch. Identity is read once and threaded into every
       hook below it, so re-running the queries alone would leave half the
       screen answering as the previous person. */
    window.location.reload();
  }

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
            {PROFILE_SWITCHER_ENABLED && people.length > 0 && (
              <>
                <span className="h-4 w-px bg-hairline" />
                <label className="flex items-center gap-1.5">
                  <span className="text-xs text-ink-faint">Acting as</span>
                  <select
                    value={actingId ?? ""}
                    onChange={(e) => actAs(e.target.value || null)}
                    aria-label="Act as another person"
                    className="rounded-full bg-[var(--surface-sunken)] px-2.5 py-1 text-xs text-ink"
                  >
                    <option value="">Seed default</option>
                    {people.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.displayName}
                      </option>
                    ))}
                  </select>
                </label>
              </>
            )}
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
