"use client";

import { useState } from "react";
import {
  Button,
  Chip,
  Field,
  Input,
  InlineError,
  Panel,
  Select,
} from "@/components/ui/Primitives";
import { INERT_CAPABILITIES, label as capabilityLabel } from "@/lib/auth/can";
import { useAction } from "@/lib/hooks/useRepository";
import type { Capability, Role, Scope } from "@/lib/domain";

/**
 * The capability × scope grid for one role.
 *
 * A permission in Cowork is a capability AND a scope, so the editor cannot be a
 * list of checkboxes — a checkbox can only say "may see scores", which is the
 * legacy model that let any team lead see everyone's. Each capability here gets
 * a scope selector whose "off" position is the absence of the permission.
 *
 * Two honesty requirements the editor keeps:
 *
 *  · **Inert capabilities are marked.** Some capabilities are modelled and
 *    grantable but have no implementation behind them yet. An administrator
 *    toggling one must not be told it does something it does not.
 *  · **Denials explain themselves.** The repository refuses grants that exceed
 *    the editor's own permissions or level, and the reason is rendered rather
 *    than swallowed — "you cannot grant a capability you do not hold yourself"
 *    is a rule someone needs to read, not a silent no-op.
 */

const SCOPES: { id: Scope | "none"; label: string }[] = [
  { id: "none", label: "Not granted" },
  { id: "self", label: "Self" },
  { id: "direct_reports", label: "Direct reports" },
  { id: "hierarchy", label: "Hierarchy" },
  { id: "organisation", label: "Organisation" },
];

/** Grouped by prefix, so a long list reads as sections rather than a wall. */
const GROUPS: { id: string; label: string }[] = [
  { id: "task", label: "Tasks" },
  { id: "deadline", label: "Deadlines" },
  { id: "submission", label: "Submissions" },
  { id: "review", label: "Review" },
  { id: "score", label: "Scores" },
  { id: "conduct", label: "Conduct" },
  { id: "people", label: "People" },
  { id: "project", label: "Projects" },
  { id: "group", label: "Groups" },
  { id: "meeting", label: "Meetings" },
  { id: "integration", label: "Configuration" },
  { id: "notification", label: "Notifications" },
];

export function RoleEditor({
  role,
  allCapabilities,
  onDone,
  canEdit,
}: {
  role: Role;
  allCapabilities: Capability[];
  onDone: () => void;
  canEdit: boolean;
}) {
  const [draft, setDraft] = useState<Record<string, Scope | "none">>(() => {
    const out: Record<string, Scope | "none"> = {};
    for (const c of allCapabilities) out[c] = "none";
    for (const p of role.permissions) out[p.capability] = p.scope;
    return out;
  });
  const [name, setName] = useState(role.displayName);
  const [level, setLevel] = useState(String(role.administrativeLevel));

  const [save, saveState] = useAction(
    (r, id: string, perms: { capability: Capability; scope: Scope }[]) =>
      r.setRolePermissions(id, perms),
  );
  const [rename, renameState] = useAction(
    (
      r,
      id: string,
      patch: { displayName: string; administrativeLevel: number },
    ) => r.updateRole(id, patch),
  );

  const dirty =
    name !== role.displayName ||
    level !== String(role.administrativeLevel) ||
    allCapabilities.some((c) => {
      const held = role.permissions.find((p) => p.capability === c);
      return (held?.scope ?? "none") !== draft[c];
    });

  async function commit() {
    const perms = allCapabilities
      .filter((c) => draft[c] !== "none")
      .map((c) => ({ capability: c, scope: draft[c] as Scope }));

    const meta = await rename(role.id, {
      displayName: name.trim(),
      administrativeLevel: Number(level),
    });
    if (!meta.ok) return;
    const res = await save(role.id, perms);
    if (res.ok) onDone();
  }

  const granted = allCapabilities.filter((c) => draft[c] !== "none").length;

  return (
    <Panel>
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Role name" className="min-w-[200px] flex-1">
          <Input
            value={name}
            disabled={!canEdit}
            onChange={(e) => setName(e.target.value)}
          />
        </Field>
        <Field
          label="Administrative level"
          hint="Nobody can act on someone at or above their own level."
          className="w-[190px]"
        >
          <Input
            value={level}
            inputMode="numeric"
            disabled={!canEdit || role.isSystem}
            onChange={(e) => setLevel(e.target.value.replace(/\D/g, ""))}
          />
        </Field>
        <div className="ml-auto flex items-center gap-2 pb-1">
          <Chip>
            <span data-figure>{granted}</span> granted
          </Chip>
          {role.isSystem && <Chip tone="extension">System role</Chip>}
        </div>
      </div>

      {(saveState.error || renameState.error) && (
        <div className="mt-3">
          <InlineError message={saveState.error ?? renameState.error ?? ""} />
        </div>
      )}

      <div className="mt-4 space-y-4 border-t border-hairline pt-3">
        {GROUPS.map((g) => {
          const caps = allCapabilities.filter((c) => c.startsWith(`${g.id}.`));
          if (caps.length === 0) return null;
          return (
            <section key={g.id}>
              <h3 className="text-[11px] tracking-[0.09em] text-ink-faint uppercase">
                {g.label}
              </h3>
              <ul className="mt-1.5 divide-y divide-hairline">
                {caps.map((c) => {
                  const inert = INERT_CAPABILITIES.includes(c);
                  return (
                    <li
                      key={c}
                      className="flex flex-wrap items-center gap-x-3 gap-y-1.5 py-2"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block text-xs text-ink">
                          {capabilityLabel(c)}
                        </span>
                        <span className="mt-0.5 block text-[11px] text-ink-faint">
                          {c}
                        </span>
                      </span>
                      {inert && (
                        <Chip
                          tone="neutral"
                          title="Modelled and grantable, but nothing calls it yet. Granting it changes nothing today."
                        >
                          Not yet enforced
                        </Chip>
                      )}
                      <Select
                        aria-label={`Scope for ${c}`}
                        value={draft[c]}
                        disabled={!canEdit}
                        onChange={(e) =>
                          setDraft((d) => ({
                            ...d,
                            [c]: e.target.value as Scope | "none",
                          }))
                        }
                        className="w-[168px] shrink-0"
                      >
                        {SCOPES.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.label}
                          </option>
                        ))}
                      </Select>
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
      </div>

      <div className="mt-4 flex items-center gap-2 border-t border-hairline pt-3">
        <Button loading={saveState.isPending}
          tone="primary"
          size="sm"
          disabled={!canEdit || !dirty || saveState.isPending}
          onClick={() => void commit()}
        >
          {saveState.isPending ? "Saving…" : "Save role"}
        </Button>
        <Button tone="ghost" size="sm" onClick={onDone}>
          Close
        </Button>
        {!canEdit && (
          <p className="text-[11px] text-ink-faint">
            You do not have permission to change roles.
          </p>
        )}
      </div>
    </Panel>
  );
}
