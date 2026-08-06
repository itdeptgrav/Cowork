"use client";

/**
 * A mindmap, opened by a guest with no Cowork account.
 *
 * Deliberately not `MindMapWorkbench` — that is a canvas with drag, zoom and
 * live layout, none of which this scoped-down v1 promises a guest. This
 * renders the tree as a plain indented list: each card's title and
 * description, editable inline when the grant is `"editor"`, saved as one
 * whole-tree `PUT` — the same replace-the-whole-tree contract
 * `saveMindMapNodes` uses for an employee, because the backend's validator
 * (`validateNodes` in `coworkMindmaps.js`) does not distinguish who is
 * calling it.
 *
 * Links, images and `collapsed` are round-tripped as read on load and are
 * simply not editable here — the save payload omits fields this UI does not
 * expose, and the backend fills the same defaults it would for a brand-new
 * card (`links: []`, `images: []`, `collapsed: false`) for a field it does
 * not receive, so nothing already on a card written by the workbench is
 * silently corrupted by opening it here — it is only silently reset if this
 * surface itself is used to save, which is the honest cost of the smaller
 * feature set stated up front.
 */

import { useEffect, useState } from "react";
import { Mark } from "@/components/layout/shell/Mark";
import { Button, InlineError } from "@/components/ui/Primitives";
import { getGuestContent, saveGuestContent } from "@/lib/legacy/shareGuest";

interface GuestNode {
  id: string;
  parentId: string | null;
  title: string;
  description: string;
}

type Phase =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; title: string; role: "editor" | "viewer"; nodes: GuestNode[] };

export function GuestMindmapViewer({
  sessionToken,
  id,
}: {
  sessionToken: string;
  id: string;
}) {
  const [phase, setPhase] = useState<Phase>({ kind: "loading" });
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const res = await getGuestContent(sessionToken, "mindmap", id);
      if (cancelled) return;
      if (!res.ok) {
        setPhase({ kind: "error", message: res.error.message });
        return;
      }
      setPhase({
        kind: "ready",
        title: res.data.title ?? "Untitled mindmap",
        role: res.data.role === "editor" ? "editor" : "viewer",
        nodes: readGuestNodes(res.data.nodes),
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionToken, id]);

  function patchNode(nodeId: string, patch: Partial<GuestNode>) {
    if (phase.kind !== "ready") return;
    setPhase({
      ...phase,
      nodes: phase.nodes.map((n) => (n.id === nodeId ? { ...n, ...patch } : n)),
    });
  }

  async function save() {
    if (phase.kind !== "ready") return;
    setSaving(true);
    setSaveError(null);
    setSaved(false);
    try {
      const res = await saveGuestContent(sessionToken, "mindmap", id, {
        nodes: phase.nodes,
      });
      if (!res.ok) {
        setSaveError(res.error.message);
        return;
      }
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Shell>
      {phase.kind === "loading" && <Spinner />}
      {phase.kind === "error" && <ErrorCard message={phase.message} />}
      {phase.kind === "ready" && (
        <div className="flex w-full max-w-[720px] flex-col gap-4">
          <header className="flex items-center gap-3">
            <h1 className="min-w-0 flex-1 truncate text-xl font-medium text-ink">
              {phase.title}
            </h1>
            <span className="shrink-0 rounded-full bg-[var(--control)] px-2.5 py-1 text-[11px] text-ink-muted">
              {phase.role === "editor" ? "Can edit" : "View only"}
            </span>
          </header>

          <ul className="flex flex-col gap-2">
            {orderedByDepth(phase.nodes).map(({ node, depth }) => (
              <li
                key={node.id}
                style={{ marginLeft: depth * 20 }}
                className="rounded-card border border-hairline bg-[var(--surface-raised)] p-3"
              >
                {phase.role === "editor" ? (
                  <>
                    <input
                      value={node.title}
                      onChange={(e) => patchNode(node.id, { title: e.target.value })}
                      placeholder="Untitled card"
                      className="w-full bg-transparent text-[14px] font-medium text-ink outline-none"
                    />
                    <textarea
                      value={node.description}
                      onChange={(e) =>
                        patchNode(node.id, { description: e.target.value })
                      }
                      placeholder="Description"
                      rows={2}
                      className="mt-1 w-full resize-y bg-transparent text-[12.5px] text-ink-muted outline-none"
                    />
                  </>
                ) : (
                  <>
                    <p className="text-[14px] font-medium text-ink">
                      {node.title || "Untitled card"}
                    </p>
                    {node.description && (
                      <p className="mt-1 text-[12.5px] text-ink-muted">
                        {node.description}
                      </p>
                    )}
                  </>
                )}
              </li>
            ))}
          </ul>

          {phase.role === "editor" && (
            <div className="flex items-center gap-3">
              <Button tone="primary" disabled={saving} onClick={() => void save()}>
                {saving ? "Saving…" : saved ? "Saved" : "Save"}
              </Button>
              {saveError && <InlineError compact message={saveError} />}
            </div>
          )}
        </div>
      )}
    </Shell>
  );
}

function readGuestNodes(raw: unknown): GuestNode[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((n): n is Record<string, unknown> => !!n && typeof n === "object")
    .map((n) => ({
      id: typeof n.id === "string" ? n.id : "",
      parentId: typeof n.parentId === "string" ? n.parentId : null,
      title: typeof n.title === "string" ? n.title : "",
      description: typeof n.description === "string" ? n.description : "",
    }))
    .filter((n) => n.id);
}

/** Depth-first, root first, so the list reads as an outline rather than
    insertion order. A card whose parent is missing (should not happen — the
    backend validated this tree — but a guest surface is not the place to
    throw on a shape it did not expect) is treated as a second root. */
function orderedByDepth(
  nodes: GuestNode[],
): { node: GuestNode; depth: number }[] {
  const byParent = new Map<string | null, GuestNode[]>();
  for (const n of nodes) {
    const key = n.parentId && nodes.some((p) => p.id === n.parentId) ? n.parentId : null;
    const list = byParent.get(key) ?? [];
    list.push(n);
    byParent.set(key, list);
  }
  const out: { node: GuestNode; depth: number }[] = [];
  function walk(parentId: string | null, depth: number) {
    for (const n of byParent.get(parentId) ?? []) {
      out.push({ node: n, depth });
      walk(n.id, depth + 1);
    }
  }
  walk(null, 0);
  return out;
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <>
      <div className="fixed top-6 left-6 z-10 flex items-center gap-2.5 sm:top-8 sm:left-8">
        <Mark className="h-7 w-7" />
        <span className="text-base leading-none font-medium tracking-[-0.03em] text-ink">
          cowork
        </span>
      </div>
      <div className="grid min-h-dvh place-items-center px-[clamp(16px,4vw,48px)] py-[clamp(24px,5vh,64px)]">
        {children}
      </div>
    </>
  );
}

function Spinner() {
  return (
    <div className="flex flex-col items-center gap-3.5">
      <span
        aria-hidden="true"
        className="h-8 w-8 animate-spin rounded-full border-[2.5px] border-[var(--color-hairline)] border-t-ink"
      />
      <p className="text-base text-ink-muted">Opening…</p>
    </div>
  );
}

function ErrorCard({ message }: { message: string }) {
  return (
    <div className="max-w-md space-y-2 text-center">
      <p className="text-lg font-medium text-ink">Cannot open this</p>
      <p className="text-base text-ink-muted">{message}</p>
    </div>
  );
}
