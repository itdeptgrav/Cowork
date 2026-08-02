"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Avatar } from "@/components/ui/Avatar";
import { Icon } from "@/components/ui/Icons";
import {
  Button,
  Field,
  InlineError,
  Input,
  Segmented,
} from "@/components/ui/Primitives";
import { useAction, useQuery } from "@/lib/hooks/useRepository";
import { useViewerId } from "@/lib/hooks/usePermissions";
import type { Employee } from "@/lib/domain";

/**
 * Starting a conversation.
 *
 * The two modes are one dialog rather than two, because the decision people
 * actually make is "who am I talking to" and the answer — one person or
 * several — is what determines the shape. Two separate entry points would ask
 * them to classify the conversation before they have picked anybody.
 *
 * It follows the dialog pattern the product already owns (`PriorityDialog`,
 * `PriorityReorderConfirm`): a portal, a frosted panel over a blurred scrim, Escape to
 * close, and the action's error rendered in place rather than thrown away.
 *
 * **Nothing here gates who you may reach.** There is no messaging capability in
 * Cowork and this does not invent one — the directory is the whole directory,
 * the same principle as assignment, where anyone may raise work for anyone and
 * the gates sit on the work rather than on the asking.
 */
export function NewChatDialog({
  onClose,
  onCreated,
  initialKind = "direct",
}: {
  onClose: () => void;
  /** Handed the new (or existing) conversation id. */
  onCreated: (conversationId: string) => void;
  initialKind?: "direct" | "group";
}) {
  const me = useViewerId();
  const [kind, setKind] = useState<"direct" | "group">(initialKind);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [title, setTitle] = useState("");

  const peopleQ = useQuery((r) => r.listEmployees(), []);
  const [create, state] = useAction((r) =>
    r.createConversation({
      kind,
      participantIds: selected,
      title: kind === "group" ? title : null,
    }),
  );

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const people = useMemo(() => {
    const all = (peopleQ.data ?? []).filter((p) => p.id !== me && !p.exitedAt);
    const q = query.trim().toLowerCase();
    if (!q) return all;
    return all.filter((p) =>
      [p.displayName, p.designation, p.departmentName]
        .filter(Boolean)
        .some((v) => v!.toLowerCase().includes(q)),
    );
  }, [peopleQ.data, me, query]);

  const chosen = (peopleQ.data ?? []).filter((p) => selected.includes(p.id));

  /* Switching mode keeps the people already picked — in a direct message only
     the last one survives, because that is what "direct" means. Clearing the
     selection instead would punish somebody for changing their mind after
     choosing correctly. */
  function switchKind(next: "direct" | "group") {
    setKind(next);
    if (next === "direct") setSelected((s) => s.slice(-1));
  }

  function toggle(id: string) {
    if (kind === "direct") {
      setSelected([id]);
      return;
    }
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  }

  const canCreate =
    kind === "direct"
      ? selected.length === 1
      : selected.length >= 2 && title.trim().length > 0;

  async function submit() {
    if (!canCreate) return;
    const r = await create();
    if (r.ok) onCreated(r.data.id);
  }

  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="new-chat-title"
      className="fixed inset-0 z-[90] grid place-items-center p-4"
    >
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 cursor-default bg-[var(--body-bg)]/60 backdrop-blur-[4px]"
      />

      <div className="frost-panel relative flex max-h-[88vh] w-[min(560px,96vw)] flex-col overflow-hidden rounded-panel">
        <div className="px-6 pt-5 pb-4">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <h2
                id="new-chat-title"
                className="text-[22px] leading-tight font-light tracking-[-0.03em] text-ink"
              >
                New message
              </h2>
              <p className="mt-1.5 text-sm text-ink-muted">
                {kind === "direct"
                  ? "Pick one person. If you already have a thread with them, it opens instead of starting a second."
                  : "Pick two or more people and name the group."}
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-ink-faint transition-colors hover:bg-[var(--control)] hover:text-ink"
            >
              <Icon.close className="h-4 w-4" />
            </button>
          </div>

          <div className="mt-4">
            <Segmented
              size="sm"
              label="Conversation type"
              value={kind}
              onChange={switchKind}
              options={[
                { id: "direct", label: "Direct message" },
                { id: "group", label: "Group" },
              ]}
            />
          </div>

          {kind === "group" && (
            <Field label="Group name" required className="mt-4">
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Product design"
                maxLength={60}
              />
            </Field>
          )}

          {/* Selected people as removable chips. In a group this is the only
              place the whole selection is visible at once — the list below
              scrolls, so a count alone would not tell you who is in it. */}
          {chosen.length > 0 && (
            <ul className="mt-4 flex flex-wrap gap-1.5">
              {chosen.map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    onClick={() => toggle(p.id)}
                    className="group inline-flex items-center gap-1.5 rounded-full bg-[var(--control)] py-1 pr-2.5 pl-1 text-xs text-ink transition-colors hover:bg-[var(--control-hover)]"
                  >
                    <Avatar
                      initials={p.initials}
                      hue={p.hue}
                      src={p.profilePictureUrl}
                      name={p.displayName}
                      size="sm"
                    />
                    {p.firstName}
                    <Icon.close
                      aria-hidden="true"
                      className="h-3 w-3 text-ink-faint transition-colors group-hover:text-ink"
                    />
                    <span className="sr-only">Remove {p.displayName}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}

          <div className="relative mt-4">
            <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-ink-faint">
              <Icon.search className="h-4 w-4" />
            </span>
            <input
              type="search"
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by name, role or department"
              aria-label="Search people"
              className="h-10 w-full rounded-inset bg-[var(--surface-raised)] pr-3 pl-9 text-sm text-ink shadow-[inset_0_0_0_1px_var(--color-hairline)] transition-shadow duration-[180ms] placeholder:text-ink-faint focus:shadow-[inset_0_0_0_1.5px_var(--color-ink)] focus:outline-none"
            />
          </div>
        </div>

        <div className="min-h-[180px] flex-1 overflow-y-auto border-t border-hairline px-3 py-2 scroll-slim">
          {peopleQ.isLoading ? (
            <p className="px-3 py-6 text-sm text-ink-faint">Loading people…</p>
          ) : people.length === 0 ? (
            <p className="px-3 py-6 text-sm text-ink-muted">
              Nobody matches “{query}”.
            </p>
          ) : (
            <ul>
              {people.map((p) => (
                <PersonRow
                  key={p.id}
                  person={p}
                  selected={selected.includes(p.id)}
                  multi={kind === "group"}
                  onToggle={() => toggle(p.id)}
                />
              ))}
            </ul>
          )}
        </div>

        <div className="border-t border-hairline px-6 py-4">
          {state.error && (
            <div className="mb-3">
              <InlineError
                compact
                message={state.error}
                code={state.errorCode}
              />
            </div>
          )}
          <div className="flex items-center justify-between gap-3">
            <p className="text-[11px] text-ink-faint">
              {kind === "direct"
                ? selected.length === 1
                  ? `Messaging ${chosen[0]?.firstName ?? "them"}`
                  : "Choose one person"
                : `${selected.length} selected · two or more`}
            </p>
            <div className="flex shrink-0 items-center gap-2">
              <Button tone="ghost" size="sm" onClick={onClose}>
                Cancel
              </Button>
              <Button
                tone="primary"
                size="sm"
                disabled={!canCreate || state.isPending}
                onClick={submit}
              >
                {state.isPending
                  ? "Starting…"
                  : kind === "direct"
                    ? "Start conversation"
                    : "Create group"}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/**
 * One person in the picker.
 *
 * `aria-pressed` rather than a checkbox: in direct mode the row is a choice
 * among alternatives and in group mode it is a toggle, and a real checkbox
 * would announce the direct case wrongly. The selected state is carried by the
 * control surface plus a check, never by colour alone.
 */
function PersonRow({
  person,
  selected,
  multi,
  onToggle,
}: {
  person: Employee;
  selected: boolean;
  multi: boolean;
  onToggle: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        aria-pressed={selected}
        onClick={onToggle}
        className={`flex w-full items-center gap-3 rounded-inset px-3 py-2 text-left transition-colors duration-[180ms] ease-[var(--ease-deck)] ${
          selected
            ? "bg-[var(--control-active)]"
            : "hover:bg-[var(--control)]"
        }`}
      >
        <Avatar
          initials={person.initials}
          hue={person.hue}
          src={person.profilePictureUrl}
          name={person.displayName}
          size="md"
        />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm text-ink">
            {person.displayName}
          </span>
          <span className="mt-0.5 block truncate text-[11px] text-ink-faint">
            {person.designation}
            {person.departmentName ? ` · ${person.departmentName}` : ""}
          </span>
        </span>
        <span
          aria-hidden="true"
          className={`grid h-5 w-5 shrink-0 place-items-center rounded-full transition-colors ${
            selected
              ? "bg-ink text-[var(--body-bg)]"
              : multi
                ? "shadow-[inset_0_0_0_1.5px_var(--color-hairline)]"
                : ""
          }`}
        >
          {selected && <Icon.check className="h-3 w-3" />}
        </span>
      </button>
    </li>
  );
}
