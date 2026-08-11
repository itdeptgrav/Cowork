"use client";

/**
 * Import employees from the HR system into CoWork.
 *
 * Lists everyone in MongoDB who does not yet have a CoWork account. The admin
 * picks who to provision — one at a time or in bulk — and the backend creates a
 * Firebase Auth user + Firestore record, auto-generates a temp password, and
 * sends a welcome email.
 *
 * It lists EVERYBODY, not only the unprovisioned, and the people who already
 * have accounts are what an administrator comes here about second: somebody
 * locked out needs a new password, and the row for them used to be a green chip
 * with nothing to press. See `ResetPasswordDialog`.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { firebaseAuth } from "@/lib/legacy-ui/coworkFirebase";
import {
  listHrEmployees,
  provisionCoworkAccount,
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
  | { kind: "done"; employeeId: string; tempPassword: string }
  | { kind: "error"; message: string };

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

  function toggleSelect(hrId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(hrId)) next.delete(hrId);
      else next.add(hrId);
      return next;
    });
  }

  function toggleSelectAll() {
    const provisionable = visible.filter(
      (e) => !e.hasCoworkAccount && statuses.get(e.hrId)?.kind !== "done",
    );
    const allSelected = provisionable.every((e) => selected.has(e.hrId));
    if (allSelected) {
      setSelected((prev) => {
        const next = new Set(prev);
        provisionable.forEach((e) => next.delete(e.hrId));
        return next;
      });
    } else {
      setSelected((prev) => {
        const next = new Set(prev);
        provisionable.forEach((e) => next.add(e.hrId));
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

  async function provisionSelected() {
    setBulkPending(true);
    const toProvision = employees.filter(
      (e) => selected.has(e.hrId) && !e.hasCoworkAccount,
    );
    await Promise.allSettled(toProvision.map(provision));
    setBulkPending(false);
    setSelected(new Set());
  }

  const provisionableCount = [...selected].filter((id) => {
    const emp = employees.find((e) => e.hrId === id);
    return emp && !emp.hasCoworkAccount;
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
          {visible.some((e) => !e.hasCoworkAccount) && (
            <div className="flex items-center gap-3 border-b border-hairline px-4 py-2.5">
              <input
                type="checkbox"
                id="select-all-hr"
                checked={visible
                  .filter((e) => !e.hasCoworkAccount && statuses.get(e.hrId)?.kind !== "done")
                  .every((e) => selected.has(e.hrId))}
                onChange={toggleSelectAll}
                className="h-3.5 w-3.5 rounded-sm accent-ink"
              />
              <label
                htmlFor="select-all-hr"
                className="text-[12px] text-ink-muted"
              >
                Select all without account
              </label>
              <span className="ml-auto text-[11px] text-ink-faint">
                {visible.filter((e) => !e.hasCoworkAccount).length} without account
              </span>
            </div>
          )}

          <ul className="divide-y divide-hairline">
            {visible.map((emp) => {
              const status = statuses.get(emp.hrId) ?? { kind: "idle" };
              const done = status.kind === "done" || emp.hasCoworkAccount;
              const pending = status.kind === "pending";

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
                      disabled={pending}
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
                      {emp.email}
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
                    {status.kind === "idle" && !emp.hasCoworkAccount && (
                      <button
                        type="button"
                        onClick={() => void provision(emp)}
                        className="rounded-inset bg-[var(--control)] px-2.5 py-1 text-[12px] text-ink transition-colors hover:bg-[var(--control-active)]"
                      >
                        Add
                      </button>
                    )}
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
