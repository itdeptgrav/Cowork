"use client";

/**
 * Import employees from the HR system into CoWork.
 *
 * Lists everyone in MongoDB who does not yet have a CoWork account. The admin
 * picks who to provision — one at a time or in bulk — and the backend creates a
 * Firebase Auth user + Firestore record, auto-generates a temp password, and
 * emails it to them. The row reports whether that email actually went: when it
 * did not, this panel holds the only remaining copy of the password.
 *
 * It lists EVERYBODY, not only the unprovisioned, and the people who already
 * have accounts are what an administrator comes here about second: somebody
 * locked out needs a new password, and the row for them used to be a green chip
 * with nothing to press. See `ResetPasswordDialog`.
 *
 * **Nothing on this panel is typed in, and nothing is asked for twice.** Every
 * field the create needs is already in the HR record, so the panel sends what
 * HR holds and the engine fills any gap from HR again before it validates. What
 * remains after that is a record HR itself is short of — see `hrGaps` — and the
 * row says which field and where, rather than offering a button that the engine
 * refuses after the click.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { firebaseAuth } from "@/lib/legacy-ui/coworkFirebase";
import {
  listHrEmployees,
  provisionCoworkAccount,
  sendCoworkCredentials,
  type HrEmployee,
} from "@/lib/legacy/employeeAdmin";
import {
  Chip,
  InlineError,
  Panel,
  SkeletonRows,
} from "@/components/ui/Primitives";
import { Icon } from "@/components/ui/Icons";
import { ResetPasswordDialog } from "./ResetPasswordDialog";

// ── Auth token ────────────────────────────────────────────────────────────────

async function getToken(): Promise<string> {
  const user = firebaseAuth.currentUser;
  if (!user) throw new Error("Not authenticated");
  return user.getIdToken();
}

// ── Types ─────────────────────────────────────────────────────────────────────

type ProvisionStatus =
  | { kind: "idle" }
  | { kind: "pending" }
  | {
      kind: "done";
      employeeId: string;
      tempPassword: string;
      /* undefined = an older engine that does not report it, so say nothing. */
      emailSent?: boolean;
    }
  | { kind: "error"; message: string };

/** Outcome of pressing Send mail on one row. */
type MailState =
  | { kind: "sending" }
  | { kind: "sent"; to: string }
  | { kind: "failed"; message: string };

// ── What HR holds, and what it genuinely does not ─────────────────────────────

/**
 * The HR fields this person has no value for.
 *
 * **A gap here is not a question to ask the admin — it is a record to fix in
 * HR.** An account is a Firebase login and Firebase keys on an email address,
 * so somebody HR has no address for cannot be created from this panel at all.
 * Offering them Add anyway is what produced a red refusal after the click,
 * naming three fields — name, email and department — when the row's only real
 * gap was one of them, and leaving the admin to guess which and where.
 *
 * Most of what used to land here was never a gap. HR records one address under
 * either of two fields and fills whichever it was given; the engine read only
 * the work one, so half the directory arrived looking address-less. It now
 * resolves both, and this names what is left.
 *
 * An engine that does not send the field yet reports no gaps — which is exactly
 * how this panel behaved before, not a new failure.
 */
function hrGaps(emp: HrEmployee): string[] {
  return emp.missingInHr ?? [];
}

/** `name, email and department` — the fields, in the words the row uses. */
function listGaps(fields: string[]): string {
  if (fields.length <= 1) return fields[0] ?? "details";
  return `${fields.slice(0, -1).join(", ")} and ${fields[fields.length - 1]}`;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function AddFromHrPanel() {
  const [employees, setEmployees] = useState<HrEmployee[]>([]);
  const [departments, setDepartments] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [dept, setDept] = useState("all");

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [statuses, setStatuses] = useState<Map<string, ProvisionStatus>>(
    new Map(),
  );
  const [bulkPending, setBulkPending] = useState(false);
  /* Whose password is being reset, if anybody's — see `ResetPasswordDialog`. */
  const [resetting, setResetting] = useState<{
    employeeId: string;
    displayName: string;
  } | null>(null);

  /* Per-row outcome of Send mail, keyed by Cowork employee id. Kept out of
     `statuses`, which is about provisioning: a row can be freshly created AND
     have had its mail re-sent, and one must not overwrite the other. */
  const [mailState, setMailState] = useState<Map<string, MailState>>(new Map());

  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(
    async (q: string, d: string) => {
      setLoading(true);
      setError(null);
      try {
        const token = await getToken();
        const res = await listHrEmployees({ token, search: q || undefined, department: d });
        if (!res.ok) { setError(res.error.message); return; }
        setEmployees(res.data?.employees ?? []);
        setDepartments(res.data?.departments ?? []);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not load employees.");
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    void load(search, dept);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function onSearch(val: string) {
    setSearch(val);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => void load(val, dept), 350);
  }

  function onDept(val: string) {
    setDept(val);
    void load(search, val);
  }

  const visible = employees;

  const withoutAccount = visible.filter((e) => !e.hasCoworkAccount);
  /**
   * The rows a Create can actually succeed on.
   *
   * Somebody HR has no email for is not merely unselected — they are kept out
   * of Select all and out of the bulk create, because sweeping them in means a
   * batch that half-fails on records this panel cannot fix.
   */
  const selectable = withoutAccount.filter(
    (e) => hrGaps(e).length === 0 && statuses.get(e.hrId)?.kind !== "done",
  );
  const blockedCount = withoutAccount.length - selectable.length;

  function toggleSelect(hrId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(hrId)) next.delete(hrId);
      else next.add(hrId);
      return next;
    });
  }

  function toggleSelectAll() {
    const allSelected = selectable.every((e) => selected.has(e.hrId));
    if (allSelected) {
      setSelected((prev) => {
        const next = new Set(prev);
        selectable.forEach((e) => next.delete(e.hrId));
        return next;
      });
    } else {
      setSelected((prev) => {
        const next = new Set(prev);
        selectable.forEach((e) => next.add(e.hrId));
        return next;
      });
    }
  }

  async function provision(emp: HrEmployee) {
    setStatuses((prev) => new Map(prev).set(emp.hrId, { kind: "pending" }));
    try {
      const token = await getToken();
      const res = await provisionCoworkAccount({
        token,
        name: emp.name,
        email: emp.email,
        phone: emp.phone || undefined,
        department: emp.department,
        biometricId: emp.biometricId || undefined,
      });
      if (!res.ok) {
        setStatuses((prev) =>
          new Map(prev).set(emp.hrId, { kind: "error", message: res.error.message }),
        );
      } else {
        setStatuses((prev) =>
          new Map(prev).set(emp.hrId, {
            kind: "done",
            employeeId: res.data!.employeeId,
            tempPassword: res.data!.tempPassword,
            emailSent: res.data!.emailSent,
          }),
        );
        setEmployees((prev) =>
          prev.map((e) =>
            e.hrId === emp.hrId ? { ...e, hasCoworkAccount: true } : e,
          ),
        );
        setSelected((prev) => {
          const next = new Set(prev);
          next.delete(emp.hrId);
          return next;
        });
      }
    } catch (e) {
      setStatuses((prev) =>
        new Map(prev).set(emp.hrId, {
          kind: "error",
          message: e instanceof Error ? e.message : "Unknown error",
        }),
      );
    }
  }

  /**
   * Re-send somebody their sign-in details.
   *
   * Nothing is generated and nothing is reset — this is the same temporary
   * password the account already carries, sent to the same address again. The
   * engine refuses once that person has chosen their own, and the refusal it
   * gives back names Reset password, so it is shown verbatim rather than
   * flattened into "failed".
   */
  async function sendMail(employeeId: string, to: string) {
    setMailState((prev) => new Map(prev).set(employeeId, { kind: "sending" }));
    try {
      const token = await getToken();
      const res = await sendCoworkCredentials({ token, employeeId });
      setMailState((prev) =>
        new Map(prev).set(
          employeeId,
          res.ok
            ? { kind: "sent", to }
            : { kind: "failed", message: res.error.message },
        ),
      );
    } catch (e) {
      setMailState((prev) =>
        new Map(prev).set(employeeId, {
          kind: "failed",
          message: e instanceof Error ? e.message : "Unknown error",
        }),
      );
    }
  }

  async function provisionSelected() {
    setBulkPending(true);
    const toProvision = employees.filter(
      (e) => selected.has(e.hrId) && !e.hasCoworkAccount && hrGaps(e).length === 0,
    );
    await Promise.allSettled(toProvision.map(provision));
    setBulkPending(false);
    setSelected(new Set());
  }

  const provisionableCount = [...selected].filter((id) => {
    const emp = employees.find((e) => e.hrId === id);
    return emp && !emp.hasCoworkAccount && hrGaps(emp).length === 0;
  }).length;

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[180px] flex-1">
          <Icon.search className="pointer-events-none absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-ink-faint" />
          <input
            type="search"
            value={search}
            onChange={(e) => onSearch(e.target.value)}
            placeholder="Search name, email or ID…"
            className="w-full rounded-inset border border-hairline bg-[var(--surface-sunken)] py-1.5 pr-3 pl-8 text-[13px] text-ink placeholder:text-ink-faint focus:outline-none focus:ring-1 focus:ring-ink/20"
          />
        </div>

        <select
          value={dept}
          onChange={(e) => onDept(e.target.value)}
          className="rounded-inset border border-hairline bg-[var(--surface-sunken)] px-2.5 py-1.5 text-[13px] text-ink focus:outline-none focus:ring-1 focus:ring-ink/20"
        >
          <option value="all">All departments</option>
          {departments.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </select>

        {provisionableCount > 0 && (
          <button
            type="button"
            onClick={() => void provisionSelected()}
            disabled={bulkPending}
            className="inline-flex items-center gap-1.5 rounded-inset bg-ink px-3 py-1.5 text-[13px] font-medium text-[var(--body-bg)] transition-opacity disabled:opacity-50"
          >
            <Icon.plus className="h-3.5 w-3.5" />
            {bulkPending
              ? "Creating…"
              : `Create ${provisionableCount} account${provisionableCount !== 1 ? "s" : ""}`}
          </button>
        )}
      </div>

      {/* List */}
      {error && <InlineError message={error} onRetry={() => void load(search, dept)} />}

      {loading ? (
        <SkeletonRows rows={6} />
      ) : visible.length === 0 ? (
        <Panel>
          <p className="py-4 text-center text-sm text-ink-muted">
              No HR employees found.
          </p>
        </Panel>
      ) : (
        <Panel padded={false}>
          {/* Select-all row */}
          {withoutAccount.length > 0 && (
            <div className="flex items-center gap-3 border-b border-hairline px-4 py-2.5">
              <input
                type="checkbox"
                id="select-all-hr"
                /* An empty `selectable` makes `every` true — a ticked box over
                   nothing. Everyone here needs HR edited first. */
                checked={
                  selectable.length > 0 &&
                  selectable.every((e) => selected.has(e.hrId))
                }
                onChange={toggleSelectAll}
                disabled={selectable.length === 0}
                className="h-3.5 w-3.5 rounded-sm accent-ink disabled:opacity-40"
              />
              <label
                htmlFor="select-all-hr"
                className="text-[12px] text-ink-muted"
              >
                Select all without account
              </label>
              <span className="ml-auto text-[11px] text-ink-faint">
                {withoutAccount.length} without account
                {blockedCount > 0 && ` · ${blockedCount} need details in HR`}
              </span>
            </div>
          )}

          <ul className="divide-y divide-hairline">
            {visible.map((emp) => {
              const status = statuses.get(emp.hrId) ?? { kind: "idle" };
              const done = status.kind === "done" || emp.hasCoworkAccount;
              /* Keyed by Cowork id, not HR id: Send mail addresses the account,
                 and the account is the thing the engine knows about. */
              const mailFor = emp.coworkEmployeeId
                ? mailState.get(emp.coworkEmployeeId)
                : undefined;
              const pending = status.kind === "pending";
              const gaps = hrGaps(emp);

              return (
                <li
                  key={emp.hrId}
                  className="flex min-h-[52px] items-center gap-3 px-4 py-2.5"
                >
                  {!done ? (
                    <input
                      type="checkbox"
                      checked={selected.has(emp.hrId)}
                      onChange={() => toggleSelect(emp.hrId)}
                      disabled={pending || gaps.length > 0}
                      className="h-3.5 w-3.5 shrink-0 rounded-sm accent-ink disabled:opacity-40"
                    />
                  ) : (
                    <Icon.check className="h-3.5 w-3.5 shrink-0 text-[var(--state-positive-ink)]" />
                  )}

                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-medium text-ink">
                      {emp.name}
                    </p>
                    <p className="truncate text-[11px] text-ink-faint">
                      {/* An absent address used to render as a bare "· GR0123",
                          which reads as a row with nothing wrong with it —
                          right up until Add was refused. */}
                      {emp.email || (
                        <span className="text-[var(--state-overdue-ink)]">
                          No email in HR
                        </span>
                      )}
                      {emp.biometricId && (
                        <span className="ml-2 text-ink-faint">
                          · {emp.biometricId}
                        </span>
                      )}
                    </p>
                  </div>

                  <div className="hidden shrink-0 sm:block">
                    <span className="text-[11px] text-ink-faint">
                      {emp.designation || emp.department}
                    </span>
                  </div>

                  <div className="flex shrink-0 items-center gap-2">
                    {/**
                     * **The one thing an admin needs on a LINKED row.**
                     *
                     * Everything else on this panel is about accounts that do
                     * not exist yet, so somebody who already had one was a dead
                     * end here: a green "Linked" chip and no way to help them.
                     * Locked out, forgotten password, a temporary one that never
                     * arrived — the answer was to open Firebase.
                     *
                     * Only where the engine told us WHICH account it is. Without
                     * an id there is nothing safe to address, and guessing from
                     * a biometric id is how the wrong person gets signed out.
                     */}
                    {done && emp.coworkEmployeeId && (
                      <button
                        type="button"
                        onClick={() =>
                          setResetting({
                            employeeId: emp.coworkEmployeeId!,
                            displayName: emp.name,
                          })
                        }
                        className="rounded-inset px-2 py-1 text-[11px] text-ink-muted transition-colors hover:bg-[var(--control)] hover:text-ink"
                      >
                        Reset password
                      </button>
                    )}
                    {/**
                     * Send mail, beside Reset password because they are the two
                     * halves of the same problem — "they cannot get in".
                     *
                     * Send mail is the gentler one and is deliberately listed
                     * first in an admin's mind: it changes nothing, signs
                     * nobody out, and is the right answer when the welcome mail
                     * simply never arrived. Reset password is the answer when it
                     * did arrive and the password is gone.
                     *
                     * Needs an address to send to, so a row HR has no email for
                     * does not offer it — the same reason such a row cannot be
                     * added in the first place.
                     */}
                    {done && emp.coworkEmployeeId && emp.email && (
                      <button
                        type="button"
                        disabled={mailFor?.kind === "sending"}
                        onClick={() =>
                          void sendMail(emp.coworkEmployeeId!, emp.email)
                        }
                        className="rounded-inset px-2 py-1 text-[11px] text-ink-muted transition-colors hover:bg-[var(--control)] hover:text-ink disabled:opacity-50"
                      >
                        {mailFor?.kind === "sending" ? "Sending…" : "Send mail"}
                      </button>
                    )}
                    {/* The engine's refusal is shown as written — it explains
                        why an already-changed password cannot be re-sent and
                        names Reset password, which "Failed" would throw away.

                        Clamped, because some of these messages come from the
                        mail provider rather than from us. Brevo's IP-allowlist
                        refusal is three sentences and an IPv6 address, and
                        unclamped it wrapped to six lines and forced the row
                        open. The engine shortens what it can recognise; this is
                        the guard for what it cannot, since no layout should
                        depend on a third party's prose staying brief. Full text
                        on hover, and never truncated mid-flow for the short
                        messages that are the normal case. */}
                    {mailFor && mailFor.kind !== "sending" && (
                      <p
                        title={
                          mailFor.kind === "sent"
                            ? `Sent to ${mailFor.to}`
                            : mailFor.message
                        }
                        className={`line-clamp-3 max-w-[200px] break-words text-right text-[10px] leading-snug ${
                          mailFor.kind === "sent"
                            ? "text-ink-faint"
                            : "text-[var(--state-overdue-ink)]"
                        }`}
                      >
                        {mailFor.kind === "sent"
                          ? `Sent to ${mailFor.to}`
                          : mailFor.message}
                      </p>
                    )}
                    {done && status.kind !== "done" && (
                      <Chip tone="positive">Linked</Chip>
                    )}
                    {status.kind === "done" && (
                      <div className="text-right">
                        <Chip tone="positive">Created</Chip>
                        <p className="mt-0.5 text-[10px] text-ink-faint">
                          ID: <span className="font-mono">{status.employeeId}</span>
                        </p>
                        <p className="text-[10px] text-ink-faint">
                          Temp: <span className="font-mono">{status.tempPassword}</span>
                        </p>
                        {/*
                          Only speak when we know. `false` is the case that
                          matters: the email did not go, so this panel is the
                          only place the password now exists and the admin has
                          to pass it on themselves.
                        */}
                        {status.emailSent === false && (
                          <p className="mt-0.5 text-[10px] text-[var(--state-overdue-ink)]">
                            Email not sent — share these yourself
                          </p>
                        )}
                        {status.emailSent === true && (
                          <p className="mt-0.5 text-[10px] text-ink-faint">
                            Emailed to {emp.email}
                          </p>
                        )}
                      </div>
                    )}
                    {status.kind === "error" && (
                      <div className="max-w-[160px] text-right">
                        <p className="text-[11px] text-[var(--state-overdue-ink)]">
                          {status.message}
                        </p>
                        <button
                          type="button"
                          onClick={() => void provision(emp)}
                          className="text-[11px] text-ink-muted underline hover:text-ink"
                        >
                          Retry
                        </button>
                      </div>
                    )}
                    {status.kind === "pending" && (
                      <span className="text-[11px] text-ink-faint">Creating…</span>
                    )}
                    {status.kind === "idle" &&
                      !emp.hasCoworkAccount &&
                      (gaps.length === 0 ? (
                        <button
                          type="button"
                          onClick={() => void provision(emp)}
                          className="rounded-inset bg-[var(--control)] px-2.5 py-1 text-[12px] text-ink transition-colors hover:bg-[var(--control-active)]"
                        >
                          Add
                        </button>
                      ) : (
                        /* Nothing to press. The record is HR's and so is the
                           fix, so the row names the missing field and where it
                           lives — which is the whole difference between this
                           and the refusal it replaces. */
                        <span className="max-w-[190px] text-right text-[11px] text-ink-faint">
                          Add {listGaps(gaps)} in HR
                        </span>
                      ))}
                  </div>
                </li>
              );
            })}
          </ul>
        </Panel>
      )}

      {resetting && (
        <ResetPasswordDialog
          employeeId={resetting.employeeId}
          displayName={resetting.displayName}
          token={getToken}
          onClose={() => setResetting(null)}
        />
      )}
    </div>
  );
}
