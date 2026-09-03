"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { getRepository } from "@/lib/repositories";
import { useViewerId } from "@/lib/hooks/usePermissions";
import { Icon } from "@/components/ui/Icons";
import { formatDateTime } from "@/lib/utils/format";
import {
  unseenPtsChanges,
  type PtsChange,
  type PtsChangeResult,
} from "@/lib/rules/notifications/ptsChanges";
import { playPtsSound } from "@/lib/utils/ptsSound";

/**
 * "Your score changed while you were away."
 *
 * On opening the app, this tells a person — once — about the recent deductions
 * and credits on their score ledger: a popup that names each change, a toast
 * beside it, and a short tone (falling for a cut, rising for a credit). The
 * popup closes itself after ten seconds, or on the × / Escape / a backdrop
 * click, and every change it shows is marked seen so it never repeats.
 *
 * Mounted once in the shell, beside `NewAssignmentGate`, whose show-once
 * localStorage pattern it follows. It reads the ledger the engine already keeps
 * — the same credit/debit history the score page renders — so a deduction
 * lights this up with no new plumbing.
 */

const SEEN_KEY = "cowork.ptscut.announced.v1";
/** How long the popup stays before closing itself. */
const AUTO_MS = 10_000;
/** Cap the seen list so it cannot grow without bound. */
const SEEN_CAP = 300;

function readSeen(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(SEEN_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed)
      ? parsed.filter((k): k is string => typeof k === "string")
      : [];
  } catch {
    return [];
  }
}

function writeSeen(ids: string[]): void {
  if (typeof window === "undefined") return;
  try {
    /* De-duplicated and capped to the most recent, so a long-running browser
       never fills the store with old ids. */
    const unique = Array.from(new Set(ids));
    window.localStorage.setItem(
      SEEN_KEY,
      JSON.stringify(unique.slice(-SEEN_CAP)),
    );
  } catch {
    /* Private mode / full quota. The notice reappearing beats a thrown error. */
  }
}

/** A signed points figure, trimmed — "−0.2", "+0.5", "+1". */
function fmtPts(n: number): string {
  const sign = n < 0 ? "−" : "+";
  return `${sign}${String(+Math.abs(n).toFixed(2))}`;
}

export function PtsChangePopup() {
  /* The SAME resolved viewer id the score/conduct pages pass to `listLedger`
     (`getViewer().employeeId`), so this reads exactly the ledger they render —
     the auth session id can be a different representation and would miss. Null
     until the viewer resolves, which also covers "not signed in". */
  const employeeId = useViewerId();
  const [shown, setShown] = useState<PtsChangeResult | null>(null);

  /* One read when the person is known — no listener, because a score change is
     not something they act on in real time; it is a "while you were away". */
  useEffect(() => {
    if (!employeeId) return;
    let cancelled = false;
    void getRepository()
      .listLedger(employeeId)
      .then((ledger) => {
        if (cancelled) return;
        const result = unseenPtsChanges(ledger, readSeen(), Date.now());
        if (result.changes.length === 0) return;
        setShown(result);
        playPtsSound(result.hasDebit ? "debit" : "credit");

        /* The toast, beside the popup, through the shell's existing pipeline. */
        const debits = result.changes.filter((c) => c.isDebit);
        const total = result.changes.reduce((s, c) => s + c.points, 0);
        const title = debits.length
          ? `${fmtPts(debits.reduce((s, c) => s + c.points, 0))} pts deducted`
          : `${fmtPts(total)} pts credited`;
        window.dispatchEvent(
          new CustomEvent("cowork:notification", {
            detail: {
              title,
              body: result.changes[0].label,
              url: "/score",
              type: "sop_bleach_applied",
              tag: "pts-change",
            },
          }),
        );
      })
      .catch(() => {
        /* No ledger, or offline. A missed notice is harmless. */
      });
    return () => {
      cancelled = true;
    };
  }, [employeeId]);

  function dismiss() {
    setShown((cur) => {
      if (cur) writeSeen([...readSeen(), ...cur.changes.map((c) => c.id)]);
      return null;
    });
  }

  /* Closes itself after ten seconds, and on Escape. */
  useEffect(() => {
    if (!shown) return;
    const timer = window.setTimeout(dismiss, AUTO_MS);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") dismiss();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("keydown", onKey);
    };
  }, [shown]);

  if (!shown || typeof document === "undefined") return null;

  const anyDebit = shown.hasDebit;
  const accent = anyDebit ? "var(--state-overdue-ink)" : "var(--state-positive-ink)";

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Score change"
      className="fixed inset-0 z-[110] grid place-items-center p-4"
    >
      {/* A soft backdrop; clicking it dismisses, like the app's other popups. */}
      <button
        type="button"
        aria-label="Close"
        onClick={dismiss}
        className="absolute inset-0 cursor-default bg-[var(--body-bg)]/60 backdrop-blur-[4px]"
      />

      <div className="frost-panel relative w-full max-w-[420px] overflow-hidden rounded-panel px-5 py-4">
        <div className="flex items-start gap-3">
          <span
            aria-hidden
            className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[var(--surface-sunken)]"
            style={{ color: accent }}
          >
            {/* A chevron down for a cut, flipped up for a credit. */}
            <Icon.chevronDown className={`h-4 w-4 ${anyDebit ? "" : "rotate-180"}`} />
          </span>

          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-medium text-ink">
              {anyDebit ? "Points deducted" : "Points credited"}
            </h2>
            <p className="mt-0.5 text-xs text-ink-faint">
              Your score changed while you were away.
            </p>
          </div>

          <button
            type="button"
            aria-label="Dismiss"
            onClick={dismiss}
            className="-mt-1 -mr-1 grid h-8 w-8 shrink-0 place-items-center rounded-full text-ink-faint transition-colors hover:bg-[var(--control)] hover:text-ink"
          >
            <Icon.close className="h-4 w-4" />
          </button>
        </div>

        <ul className="mt-3 max-h-[40vh] space-y-1.5 overflow-y-auto">
          {shown.changes.map((c) => (
            <ChangeRow key={c.id} change={c} />
          ))}
        </ul>

        <div className="mt-3 flex items-center justify-between">
          <Link
            href="/score"
            onClick={dismiss}
            className="text-xs text-ink-muted underline decoration-hairline underline-offset-2 hover:text-ink"
          >
            View credit / debit history
          </Link>
          <span className="text-[11px] text-ink-faint">Closes in 10s</span>
        </div>

        {/* A hairline that drains over the ten seconds, so the countdown is
            visible rather than a surprise. */}
        <span
          aria-hidden
          className="pts-countdown absolute inset-x-0 bottom-0 h-[3px] origin-left"
          style={{ backgroundColor: accent }}
        />
      </div>

      <style>{`
        @keyframes pts-drain { from { transform: scaleX(1); } to { transform: scaleX(0); } }
        .pts-countdown { animation: pts-drain ${AUTO_MS}ms linear forwards; }
        @media (prefers-reduced-motion: reduce) { .pts-countdown { animation: none; opacity: .4; } }
      `}</style>
    </div>,
    document.body,
  );
}

function ChangeRow({ change }: { change: PtsChange }) {
  const debit = change.isDebit;
  return (
    <li className="flex items-center gap-3 rounded-inset bg-[var(--surface-sunken)] px-3 py-2">
      <span
        data-figure
        className="shrink-0 rounded-full px-2 py-0.5 text-[12px] font-medium tabular-nums"
        style={{
          color: debit
            ? "var(--state-overdue-ink)"
            : "var(--state-positive-ink)",
          backgroundColor: debit
            ? "color-mix(in srgb, var(--state-overdue) 20%, transparent)"
            : "color-mix(in srgb, var(--state-positive) 20%, transparent)",
        }}
      >
        {fmtPts(change.points)} pts
      </span>
      <span className="min-w-0 flex-1 truncate text-[13px] text-ink">
        {change.label}
      </span>
      {change.at && (
        <span className="shrink-0 text-[11px] text-ink-faint">
          {formatDateTime(change.at)}
        </span>
      )}
    </li>
  );
}
