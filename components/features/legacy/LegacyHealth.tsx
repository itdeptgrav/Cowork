"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Button,
  Chip,
  Panel,
  PanelHead,
  SkeletonRows,
} from "@/components/ui/Primitives";
import type { CheckResult, HealthReport } from "@/lib/legacy/health";
import { runHealthChecks } from "@/lib/legacy/runHealth";
import { useSession } from "@/components/features/auth/SessionProvider";

/**
 * Whether the adapter can reach the legacy system, and if not, exactly why.
 *
 * Built for the moment somebody is standing up a deployment and something is
 * wrong. Every failure names the variable, the endpoint or the account
 * involved, because "connection failed" sends a person to search the code and
 * a named cause sends them to fix it.
 *
 * **Three outcomes, never two.** A check that could not run is `skipped`, not
 * quietly passed — a health page that reports green for things it never asked
 * about is one nobody trusts twice.
 */
/** Shown only if the checker itself throws, which it is written not to do. */
const UNEXPECTED: HealthReport = {
  overall: "failed",
  summary: "The connection checker did not finish.",
  checks: [],
  missing: [],
};

export function LegacyHealth() {
  const [report, setReport] = useState<HealthReport | null>(null);
  const [running, setRunning] = useState(false);
  /**
   * The application's session — the one every other screen reads.
   *
   * Only the "are you signed in" line needs it. The checks above run without a
   * session on purpose: a diagnostics page has to work when the thing being
   * diagnosed does not.
   */
  const session = useSession();

  /**
   * Run the checks on mount.
   *
   * Written as a promise chain with a cancellation flag — the convention the
   * rest of this codebase uses for a one-shot load, and what keeps a resolved
   * check from writing state into an unmounted page.
   *
   * The "checking…" flag is not set here. Doing so would write state as the
   * mount effect runs, which React 19 rejects; and the skeleton already says the
   * work is in flight. The flag only means anything for the re-run button, where
   * an event handler owns it.
   */
  useEffect(() => {
    let cancelled = false;
    runHealthChecks()
      .then((next) => {
        if (!cancelled) setReport(next);
      })
      .catch(() => {
        /* `runHealthChecks` catches its own probe failures, so reaching here
           means something unforeseen. Leaving the skeleton up would be a page
           that never resolves, so say so instead. */
        if (!cancelled) setReport(UNEXPECTED);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const rerun = useCallback(async () => {
    setRunning(true);
    const next = await runHealthChecks().catch(() => UNEXPECTED);
    setReport(next);
    setRunning(false);
  }, []);

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4 py-8">
      <Panel label="Legacy connection health">
        <PanelHead
          title="Legacy connection"
          sub="Whether Cowork can reach the existing system"
          aside={report ? <Verdict report={report} /> : undefined}
        />

        {!report ? (
          <SkeletonRows rows={6} />
        ) : (
          <>
            <p className="mt-3 text-sm text-ink-muted">{report.summary}</p>
            <ul className="mt-4 flex flex-col gap-3">
              {report.checks.map((check) => (
                <CheckRow key={check.id} check={check} />
              ))}
            </ul>
          </>
        )}
      </Panel>

      {report && report.missing.length > 0 && (
        <Panel label="Missing variables">
          <PanelHead
            title="Missing environment variables"
            sub="Set these, then run the checks again"
          />
          <ul className="mt-3 flex flex-col gap-1.5">
            {report.missing.map((name) => (
              <li key={name} className="font-mono text-sm text-ink">
                {name}
              </li>
            ))}
          </ul>
          <p className="mt-4 text-sm text-ink-muted">
            Every value comes from the legacy system&rsquo;s own environment.
            See <span className="font-mono">docs/legacy-environment-setup.md</span>.
          </p>
        </Panel>
      )}

      <Panel label="Sign-in">
        <PanelHead
          title="Cowork sign-in"
          sub="The same session the rest of the application uses"
        />
        <p className="mt-3 text-sm text-ink-muted">
          {session.status === "authenticated"
            ? `Signed in as ${session.displayName ?? session.employeeId}.`
            : session.status === "loading"
              ? "Resolving your session\u2026"
              : "Not signed in."}
        </p>
        {session.status === "anonymous" && (
          <p className="mt-2 text-sm">
            <a href="/signin" className="text-ink underline underline-offset-2">
              Sign in
            </a>{" "}
            <span className="text-ink-muted">
              — the application&rsquo;s own sign-in, not a separate one for this page.
            </span>
          </p>
        )}
      </Panel>

      <div className="flex justify-end">
        <Button size="sm" onClick={() => void rerun()}>
          {running ? "Checking…" : "Run checks again"}
        </Button>
      </div>
    </div>
  );
}

function Verdict({ report }: { report: HealthReport }) {
  if (report.overall === "connected") return <Chip tone="positive">CONNECTED</Chip>;
  if (report.overall === "not_configured")
    return <Chip tone="neutral">NOT CONFIGURED</Chip>;
  return <Chip tone="overdue">FAILED</Chip>;
}

function CheckRow({ check }: { check: CheckResult }) {
  const mark =
    check.state === "pass" ? "✓" : check.state === "fail" ? "✕" : "–";

  return (
    <li className="flex gap-3">
      <span
        aria-hidden
        className={`mt-px w-4 shrink-0 text-center text-sm ${
          check.state === "pass"
            ? "text-[color:var(--positive-ink,currentColor)]"
            : "text-ink-muted"
        }`}
      >
        {mark}
      </span>
      <div className="min-w-0">
        <p className="text-sm text-ink">
          {check.label}
          <span className="sr-only">
            {" — "}
            {check.state === "pass"
              ? "passed"
              : check.state === "fail"
                ? "failed"
                : "not checked"}
          </span>
        </p>
        <p className="mt-0.5 text-sm text-ink-muted">{check.detail}</p>
        {check.remedy && (
          <p className="mt-1 text-sm text-ink-muted">{check.remedy}</p>
        )}
      </div>
    </li>
  );
}
