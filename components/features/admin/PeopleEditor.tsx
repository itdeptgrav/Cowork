"use client";

import { useState } from "react";
import {
  Button,
  Chip,
  Field,
  InlineError,
  Input,
  Panel,
  PanelHead,
  Select,
} from "@/components/ui/Primitives";
import { useAction, useQuery } from "@/lib/hooks/useRepository";
import type { ConductSeverity } from "@/lib/domain";

/**
 * Adding a person, and taking one out of service.
 *
 * Deactivation rather than deletion, everywhere. Every submission, review,
 * ledger entry and approval cites the person who made it; removing the record
 * would leave all of that unattributable. The repository refuses to deactivate
 * anyone who still manages people, because their reports' approvals would
 * otherwise resolve to somebody who is gone.
 */
/** The explicit "top of the organisation" choice, distinct from unchosen. */
const ROOT = "__root__";

export function NewEmployee({ onDone }: { onDone: () => void }) {
  const departments = useQuery((r) => r.listDepartments(), []);
  const roles = useQuery((r) => r.listRoles(), []);
  const people = useQuery((r) => r.listEmployees(), []);

  const [firstName, setFirst] = useState("");
  const [lastName, setLast] = useState("");
  const [email, setEmail] = useState("");
  const [employeeCode, setCode] = useState("");
  const [designation, setDesignation] = useState("");
  const [departmentId, setDepartment] = useState("");
  /* Three states, not two. "" is UNCHOSEN and blocks the submit; a person id
     places them under that manager; ROOT is an explicit "top of the
     organisation". The old control defaulted straight to "No manager", so
     somebody could be created outside the reporting tree without anyone
     deciding that — invisible to every manager, and to monitoring, because
     `#closure()` is what those read. */
  const [managerId, setManager] = useState("");
  const [roleIds, setRoleIds] = useState<string[]>(["role-employee"]);

  const [create, state] = useAction(
    (
      r,
      input: {
        firstName: string;
        lastName: string;
        email: string;
        employeeCode: string;
        departmentId: string | null;
        designation: string | null;
        roleIds: string[];
        managerId: string | null;
      },
    ) => r.createEmployee(input),
  );

  return (
    <Panel>
      <PanelHead
        title="Add someone"
        sub="They start with the Employee role unless you grant more."
      />
      {state.error && (
        <div className="mb-3">
          <InlineError message={state.error} />
        </div>
      )}

      <div className="grid gap-3 deck:grid-cols-2">
        <Field label="First name" required>
          <Input value={firstName} onChange={(e) => setFirst(e.target.value)} />
        </Field>
        <Field label="Last name" required>
          <Input value={lastName} onChange={(e) => setLast(e.target.value)} />
        </Field>
        <Field
          label="Work email"
          required
          className="deck:col-span-2"
          hint="Where an invitation goes. It does not create a sign-in on its own — invite them from their profile once they exist."
        >
          <Input
            type="email"
            autoComplete="off"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="first.last@company.com"
          />
        </Field>
        <Field label="Employee code" required>
          <Input
            value={employeeCode}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
          />
        </Field>
        <Field label="Designation">
          <Input
            value={designation}
            onChange={(e) => setDesignation(e.target.value)}
          />
        </Field>
        <Field label="Department">
          <Select
            value={departmentId}
            onChange={(e) => setDepartment(e.target.value)}
          >
            <option value="">No department</option>
            {(departments.data ?? []).map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field
          label="Reports to"
          required
          hint="Team visibility and monitoring follow this line. Someone with no manager is reachable by nobody."
        >
          <Select
            value={managerId}
            onChange={(e) => setManager(e.target.value)}
          >
            <option value="">Choose…</option>
            <option value={ROOT}>Nobody — top of the organisation</option>
            {(people.data ?? [])
              .filter((p) => !p.exitedAt)
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.displayName}
                </option>
              ))}
          </Select>
        </Field>
      </div>

      <div className="mt-3">
        <p className="text-[11px] tracking-[0.09em] text-ink-faint uppercase">
          Roles
        </p>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {(roles.data ?? []).map((r) => {
            const held = roleIds.includes(r.id);
            return (
              <button
                key={r.id}
                type="button"
                aria-pressed={held}
                onClick={() =>
                  setRoleIds((ids) =>
                    held ? ids.filter((x) => x !== r.id) : [...ids, r.id],
                  )
                }
                className={`rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors ${
                  held
                    ? "bg-ink text-[var(--body-bg)]"
                    : "bg-[var(--control)] text-ink-muted hover:bg-[var(--control-hover)] hover:text-ink"
                }`}
              >
                {r.displayName}
              </button>
            );
          })}
        </div>
      </div>

      <div className="mt-4 flex items-center gap-2 border-t border-hairline pt-3">
        <Button loading={state.isPending}
          tone="primary"
          size="sm"
          disabled={
            !firstName.trim() ||
            !lastName.trim() ||
            !email.trim() ||
            !employeeCode.trim() ||
            !managerId ||
            state.isPending
          }
          onClick={async () => {
            const res = await create({
              firstName,
              lastName,
              email,
              employeeCode,
              departmentId: departmentId || null,
              designation: designation || null,
              roleIds,
              /* ROOT is a deliberate "no manager"; "" cannot reach here
                 because the submit is disabled until one is chosen. */
              managerId: managerId === ROOT ? null : managerId,
            });
            if (res.ok) onDone();
          }}
        >
          {state.isPending ? "Adding…" : "Add person"}
        </Button>
        <Button tone="ghost" size="sm" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </Panel>
  );
}

/* ── Company policies ─────────────────────────────────────────────────────── */

const SEVERITIES: { id: ConductSeverity; label: string }[] = [
  { id: "minor", label: "Minor" },
  { id: "moderate", label: "Moderate" },
  { id: "serious", label: "Serious" },
  { id: "falsification", label: "Falsification" },
];

/**
 * The conduct catalogue — the company policies C3 deducts against.
 *
 * The severity chosen here selects which scoring value applies, so this list
 * and the C3 rule are two halves of one decision. Deactivating a policy stops
 * it being applicable without deleting the events already recorded under it.
 */
export function PolicyEditor({ canEdit }: { canEdit: boolean }) {
  const policies = useQuery((r) => r.listConductPolicies(), []);
  const departments = useQuery((r) => r.listDepartments(), []);
  const [creating, setCreating] = useState(false);

  const [update, updateState] = useAction(
    (
      r,
      id: string,
      patch: { isActive?: boolean; severity?: ConductSeverity },
    ) => r.updateConductPolicy(id, patch),
  );

  return (
    <Panel>
      <PanelHead
        title="Company policies"
        sub="Each policy names a severity, and the severity selects the C3 deduction that applies."
        aside={
          canEdit && !creating ? (
            <Button size="sm" onClick={() => setCreating(true)}>
              New policy
            </Button>
          ) : undefined
        }
      />
      {updateState.error && (
        <div className="mb-3">
          <InlineError message={updateState.error} />
        </div>
      )}

      {creating && (
        <div className="mb-3">
          <NewPolicy
            departments={(departments.data ?? []).map((d) => ({
              id: d.id,
              name: d.name,
            }))}
            onDone={() => setCreating(false)}
          />
        </div>
      )}

      <ul className="divide-y divide-hairline">
        {(policies.data ?? []).map((p) => (
          <li
            key={p.id}
            className="flex flex-wrap items-center gap-x-3 gap-y-2 py-2.5"
          >
            <span className="min-w-0 flex-1">
              <span className="block text-sm text-ink">{p.name}</span>
              <span className="mt-0.5 block text-[11px] text-ink-faint">
                {p.description}
              </span>
            </span>
            {!p.isActive && <Chip tone="neutral">Inactive</Chip>}
            <Select
              aria-label={`Severity for ${p.name}`}
              value={p.severity ?? ""}
              disabled={!canEdit}
              onChange={(e) =>
                void update(p.id, {
                  severity: e.target.value as ConductSeverity,
                })
              }
              className="w-[168px] shrink-0"
            >
              {SEVERITIES.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </Select>
            <Button
              size="sm"
              tone="ghost"
              disabled={!canEdit}
              onClick={() => void update(p.id, { isActive: !p.isActive })}
            >
              {p.isActive ? "Deactivate" : "Activate"}
            </Button>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function NewPolicy({
  departments,
  onDone,
}: {
  departments: { id: string; name: string }[];
  onDone: () => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [severity, setSeverity] = useState<ConductSeverity>("minor");
  /* What a breach costs, in percentage points off the score — see
     `ConductPolicy.percent`. Held as text so a half-typed "2." is not
     rewritten under the person mid-keystroke. */
  const [percent, setPercent] = useState("5");
  const [scope, setScope] = useState<"global" | "department">("global");
  const [departmentId, setDepartmentId] = useState("");
  const [create, state] = useAction(
    (
      r,
      input: {
        name: string;
        percent: number;
        description: string;
        severity: ConductSeverity;
        scope: "global" | "department";
        departmentIds: string[];
      },
    ) => r.createConductPolicy(input),
  );

  return (
    <div className="rounded-inset bg-[var(--surface-sunken)] p-3">
      {state.error && (
        <div className="mb-3">
          <InlineError message={state.error} />
        </div>
      )}
      <div className="grid gap-3 deck:grid-cols-2">
        <Field label="Policy name" required>
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field
          label="Cut when breached"
          required
          hint="Percentage points off the score. 5 turns 80 into 75."
        >
          <Input
            value={percent}
            inputMode="decimal"
            onChange={(e) => setPercent(e.target.value.replace(/[^0-9.]/g, ""))}
          />
        </Field>
        <Field label="Severity">
          <Select
            value={severity}
            onChange={(e) => setSeverity(e.target.value as ConductSeverity)}
          >
            {SEVERITIES.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Applies to">
          <Select
            value={scope}
            onChange={(e) =>
              setScope(e.target.value as "global" | "department")
            }
          >
            <option value="global">Everyone</option>
            <option value="department">One department</option>
          </Select>
        </Field>
        {scope === "department" && (
          <Field label="Department">
            <Select
              value={departmentId}
              onChange={(e) => setDepartmentId(e.target.value)}
            >
              <option value="">Choose a department</option>
              {departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </Select>
          </Field>
        )}
      </div>
      <Field label="Description" className="mt-3">
        <Input
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </Field>
      <div className="mt-3 flex items-center gap-2">
        <Button loading={state.isPending}
          tone="primary"
          size="sm"
          disabled={
            !name.trim() ||
            !(Number(percent) > 0) ||
            Number(percent) > 100 ||
            state.isPending
          }
          onClick={async () => {
            const res = await create({
              name,
              percent: Number(percent),
              description,
              severity,
              scope,
              departmentIds: departmentId ? [departmentId] : [],
            });
            if (res.ok) onDone();
          }}
        >
          Create policy
        </Button>
        <Button tone="ghost" size="sm" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
