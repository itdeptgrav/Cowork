"use client";

/**
 * A document or sheet, opened by a guest with no Cowork account.
 *
 * **Deliberately not the real editor.** `DocumentEditor`/`SheetGrid` are
 * built on ProseMirror/Yjs and `getRepository()` — neither of which a guest
 * has any business touching, and neither of which this feature promises for
 * a guest (see the plan's own "explicitly out of scope": no real-time
 * collaboration here). This is the scoped-down v1: load once, edit plainly
 * if the grant is `"editor"`, save with one button. A viewer sees the same
 * content with no editing surface at all.
 *
 * A sheet is a `CoworkDocument` with `kind:"sheet"` and its content lives in
 * `cells` (a JSON string), never `html` — so which one this renders is
 * decided by which field the backend actually sent, not by anything passed
 * in as a prop.
 */

import { useEffect, useRef, useState } from "react";
import { Mark } from "@/components/layout/shell/Mark";
import { Button, InlineError } from "@/components/ui/Primitives";
import { getGuestContent, saveGuestContent } from "@/lib/legacy/shareGuest";

type Phase =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | {
      kind: "ready";
      title: string;
      role: "editor" | "viewer";
      isSheet: boolean;
      html: string;
      cellsText: string;
    };

export function GuestDocumentViewer({
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
  const editableRef = useRef<HTMLDivElement>(null);
  const cellsRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const res = await getGuestContent(sessionToken, "document", id);
      if (cancelled) return;
      if (!res.ok) {
        setPhase({ kind: "error", message: res.error.message });
        return;
      }
      const role = res.data.role === "editor" ? "editor" : "viewer";
      const isSheet = typeof res.data.cells === "string";
      setPhase({
        kind: "ready",
        title: res.data.title ?? "Untitled",
        role,
        isSheet,
        html: res.data.html ?? "",
        cellsText: formatCells(res.data.cells ?? ""),
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionToken, id]);

  async function save() {
    if (phase.kind !== "ready") return;
    setSaving(true);
    setSaveError(null);
    setSaved(false);
    try {
      const body = phase.isSheet
        ? { cells: cellsRef.current?.value ?? phase.cellsText }
        : { html: editableRef.current?.innerHTML ?? phase.html };
      const res = await saveGuestContent(sessionToken, "document", id, body);
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
        <div className="flex w-full max-w-[860px] flex-col gap-4">
          <header className="flex items-center gap-3">
            <h1 className="min-w-0 flex-1 truncate text-xl font-medium text-ink">
              {phase.title}
            </h1>
            <span className="shrink-0 rounded-full bg-[var(--control)] px-2.5 py-1 text-[11px] text-ink-muted">
              {phase.role === "editor" ? "Can edit" : "View only"}
            </span>
          </header>

          {phase.isSheet ? (
            <textarea
              ref={cellsRef}
              defaultValue={phase.cellsText}
              readOnly={phase.role !== "editor"}
              spellCheck={false}
              className="min-h-[420px] w-full rounded-card border border-hairline bg-[var(--surface-raised)] p-4 font-mono text-[13px] text-ink outline-none"
            />
          ) : (
            <div
              ref={editableRef}
              role="textbox"
              aria-multiline="true"
              aria-label={phase.title}
              contentEditable={phase.role === "editor"}
              suppressContentEditableWarning
              dangerouslySetInnerHTML={{ __html: phase.html || "<p></p>" }}
              className="min-h-[420px] w-full rounded-card border border-hairline bg-[var(--surface-raised)] p-6 text-[15px] leading-relaxed text-ink outline-none"
            />
          )}

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

/** Pretty-printed if the raw string parses as JSON, kept as-is otherwise —
    an empty or malformed sheet must still be openable rather than blank. */
function formatCells(raw: string): string {
  if (!raw) return "{}";
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
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
