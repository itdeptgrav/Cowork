"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Button,
  Chip,
  EmptyState,
  Panel,
  PanelHead,
  SkeletonRows,
} from "@/components/ui/Primitives";
import { accessSummary } from "@/lib/legacy/profile";
import { useSession } from "@/components/features/auth/SessionProvider";
import { idToken } from "@/lib/legacy/firebase";
import { type Check, runValidation, summarise } from "@/lib/legacy/validate";

/**
 * Adapter output against the engine's own responses, field by field.
 *
 * The verification surface for the vertical slice. It exists because the
 * dangerous failure in this migration is silent: an inferred envelope key
 * returns nothing, the adapter maps nothing, and the screen shows a healthy
 * empty state. Reading a page cannot tell you that happened — comparing can.
 *
 * Both sides of every check are shown, so a disagreement can be judged rather
 * than taken on trust. Legacy is correct by definition; anything that differs is
 * an adapter bug.
 */
export function LegacyValidate() {
  /**
   * The application's session — the same one every other screen reads.
   *
   * The token comes from `idToken()` rather than from the session object,
   * because that is where the app itself gets it: the Firebase SDK refreshes on
   * its own schedule, so a token captured into state goes stale while the page
   * sits open.
   */
  const session = useSession();
  const [checks, setChecks] = useState<Check[] | null>(null);
  const [running, setRunning] = useState(false);

  const run = useCallback(async () => {
    if (session.status !== "authenticated" || !session.employeeId) return;
    const token = await idToken();
    if (!token) return;
    const result = await runValidation({
      token,
      employeeId: String(session.employeeId),
      role: legacyRoleOf(session.archetype),
    });
    setChecks(result);
  }, [session]);

  useEffect(() => {
    if (session.status !== "authenticated") return;
    let cancelled = false;
    void (async () => {
      const employeeId = session.employeeId;
      if (!employeeId) return;
      const token = await idToken();
      if (!token || cancelled) return;
      const result = await runValidation({
        token,
        employeeId: String(employeeId),
        role: legacyRoleOf(session.archetype),
      });
      if (!cancelled) setChecks(result);
    })();
    return () => {
      cancelled = true;
    };
  }, [session]);

  /* The app session has three states, not the legacy provider's five. Said in
     the same words the rest of the migration uses. */
  const message =
    session.status === "loading"
      ? { title: "Loading\u2026", detail: "Resolving your Cowork session." }
      : session.status === "anonymous"
        ? { title: "Sign in", detail: "You are not signed in to Cowork." }
        : null;
  if (message) {
    return (
      <div className="mx-auto w-full max-w-4xl px-4 py-8">
        <Panel label="Validation">
          <PanelHead title="Adapter validation" sub="Against the live engine" />
          <EmptyState
            title={message.title}
            body={
              session.status === "anonymous"
                ? "This compares real responses, so it needs a signed-in session."
                : message.detail
            }
          />
        </Panel>
      </div>
    );
  }

  const totals = checks ? summarise(checks) : null;

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-4 px-4 py-8">
      <Panel label="Validation">
        <PanelHead
          title="Adapter validation"
          sub="Every check compares the engine's raw response with the adapter's output"
          aside={
            totals ? (
              <Chip tone={totals.overall === "pass" ? "positive" : totals.overall === "fail" ? "overdue" : "risk"}>
                {totals.pass} pass · {totals.warn} warn · {totals.fail} fail
              </Chip>
            ) : undefined
          }
        />
        {!checks ? (
          <SkeletonRows rows={6} />
        ) : (
          <ul className="mt-4 flex flex-col gap-4">
            {checks.map((check) => (
              <li key={check.id + check.label}>
                <div className="flex items-baseline gap-2">
                  <Mark verdict={check.verdict} />
                  <p className="text-sm font-medium text-ink">{check.label}</p>
                </div>
                <p className="mt-1 pl-6 text-sm text-ink-muted">{check.detail}</p>
                {(check.legacy || check.adapter) && (
                  <dl className="mt-2 pl-6 text-xs">
                    {check.legacy && (
                      <div className="flex gap-2">
                        <dt className="shrink-0 text-ink-muted">legacy</dt>
                        <dd className="min-w-0 break-all font-mono text-ink-muted">{check.legacy}</dd>
                      </div>
                    )}
                    {check.adapter && (
                      <div className="mt-0.5 flex gap-2">
                        <dt className="shrink-0 text-ink-muted">adapter</dt>
                        <dd className="min-w-0 break-all font-mono text-ink-muted">{check.adapter}</dd>
                      </div>
                    )}
                  </dl>
                )}
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel label="Role permissions">
        <PanelHead
          title="Role permissions"
          sub={`As the engine will enforce them for role "${legacyRoleOf(session.archetype)}"`}
        />
        <ul className="mt-3 flex flex-col gap-2">
          {accessSummary(null).map((line) => (
            <li key={line.label} className="flex items-center justify-between gap-4 text-sm">
              <span className="text-ink">
                {line.label}
                <span className="ml-2 font-mono text-xs text-ink-muted">{line.gate}</span>
              </span>
              <Chip tone={line.allowed ? "positive" : "neutral"}>
                {line.allowed ? "Allowed" : "No"}
              </Chip>
            </li>
          ))}
        </ul>
      </Panel>

      <div className="flex justify-end">
        <Button
          size="sm"
          onClick={async () => {
            setRunning(true);
            await run();
            setRunning(false);
          }}
        >
          {running ? "Running…" : "Run again"}
        </Button>
      </div>
    </div>
  );
}

function Mark({ verdict }: { verdict: Check["verdict"] }) {
  const symbol = verdict === "pass" ? "✓" : verdict === "fail" ? "✕" : verdict === "warn" ? "!" : "–";
  return (
    <span aria-hidden className="w-4 shrink-0 text-center text-sm text-ink-muted">
      {symbol}
      <span className="sr-only">{verdict}</span>
    </span>
  );
}

/**
 * The engine's role, from the app's archetype.
 *
 * The app publishes an archetype; the validation suite needs the engine's own
 * word, because the endpoint it probes are gated on `ceo`/`tl`/`employee`.
 * Inverting here keeps the session contract untouched — the same inversion
 * `SessionProvider` performs for the repository.
 */
function legacyRoleOf(archetype: string | null): string {
  if (archetype === "system_admin") return "ceo";
  if (archetype === "manager") return "tl";
  return "employee";
}
