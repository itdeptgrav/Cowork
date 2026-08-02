"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Icon } from "@/components/ui/Icons";
import { Button, Chip, InlineError, Skeleton } from "@/components/ui/Primitives";
import { assistStatus, requestAssist, type AssistStatus } from "@/lib/workspace/ai/client";
import { assistRequestRefusal } from "@/lib/rules/workspace/ai/protocol";
import type { AiChatTurn, AiSurface } from "@/lib/rules/workspace/ai/protocol";

/**
 * The assistant panel — one component, reused by Docs and Sheets.
 *
 * ## What this owns, and what it deliberately does not
 *
 * This component talks to the backend and renders the conversation. It has
 * never heard of Tiptap, HyperFormula, or `SheetCommand`. Every place this
 * would otherwise need to know something surface-specific, it takes a
 * callback instead: `validate` turns a raw tool call into a typed action and
 * a preview, `apply` executes that action through the real editor, `undo`
 * reaches for the editor's own history. `DocsAssistant.tsx` and
 * `SheetsAssistant.tsx` supply those. This split is what "one shared AI
 * service, separate Docs and Sheets tool schemas" means at the UI layer: one
 * conversation surface, two executors that never touch each other's editor.
 *
 * ## Why every apply passes through the editor's OWN mutation path
 *
 * Nothing here holds a parallel undo stack. `apply` calls the same Tiptap
 * chain commands (or the same `SheetCommand` dispatch) a toolbar button
 * would, so the edit lands in the editor's real history — Ctrl-Z undoes it,
 * and so does this panel's own Undo button, which is just a courtesy call to
 * the same mechanism right after Apply. A second, independent undo system
 * would only be a second thing that could disagree with the first.
 *
 * ## The model label
 *
 * "Gemini Flash-Lite", always, everywhere this panel appears — never a
 * different model name, because there IS no different model this panel is
 * ever allowed to call. The raw model string reaches the badge's tooltip
 * only, not the label itself: a mid-generation alias like
 * `gemini-flash-lite-latest` is an implementation detail, and surfacing it as
 * the primary label reads like a claim that it might change under you.
 */

export interface AssistantValidation<A> {
  ok: true;
  action: A;
  preview: ReactNode;
  requiresConfirmation: boolean;
  confirmationMessage?: string;
}
export interface AssistantValidationFailure {
  ok: false;
  message: string;
}

export interface AssistantPanelProps<A> {
  surface: AiSurface;
  surfaceLabel: string;
  /** Quick-start chips — full instructions the assistant can act on directly. */
  suggestedActions: { label: string; instruction: string }[];
  /** A short, ALWAYS-CURRENT description of the selection, shown above the input. */
  contextLabel: string;
  /** Shown in the empty input — one concrete example, in the surface's own vocabulary. */
  placeholder: string;
  /**
   * An instruction raised from somewhere else in the surface — today, an
   * `=ai …` typed into a cell. Sent as soon as the panel sees it, then
   * handed back via {@link onPendingTaken} so re-opening the panel later
   * does not re-ask a question from ten minutes ago.
   */
  pendingInstruction?: string | null;
  onPendingTaken?: () => void;
  /**
   * Called at send time with the instruction the person just typed — builds
   * the actual context payload sent to Gemini. Takes the instruction so the
   * caller can decide whether "the whole document/sheet" was explicitly
   * asked for; nothing else may make that call.
   */
  getContextSummary: (instruction: string) => string;
  validate: (
    tool: string,
    args: Record<string, unknown>,
  ) => AssistantValidation<A> | AssistantValidationFailure;
  apply: (action: A) => void;
  undo: () => void;
  onClose: () => void;
}

type ProposalStatus = "awaiting" | "confirming" | "applied" | "rejected" | "undone";

type Turn<A> =
  | { kind: "user"; text: string }
  | { kind: "pending" }
  | { kind: "assistant-text"; text: string }
  | { kind: "error"; message: string }
  | {
      kind: "proposal";
      tool: string;
      preview: ReactNode;
      requiresConfirmation: boolean;
      confirmationMessage?: string;
      action: A;
      status: ProposalStatus;
    };

const MAX_INPUT = 1500;

export function AssistantPanel<A>({
  surface,
  surfaceLabel,
  suggestedActions,
  contextLabel,
  placeholder,
  pendingInstruction,
  onPendingTaken,
  getContextSummary,
  validate,
  apply,
  undo,
  onClose,
}: AssistantPanelProps<A>) {
  const [turns, setTurns] = useState<Turn<A>[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [status, setStatus] = useState<AssistStatus | null>(null);
  const [statusLoading, setStatusLoading] = useState(true);
  const logRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const panelId = useId();

  useEffect(() => {
    let cancelled = false;
    assistStatus().then((s) => {
      if (!cancelled) {
        setStatus(s);
        setStatusLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: "smooth" });
  }, [turns]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const historyFor = (): AiChatTurn[] =>
    turns
      .filter((t): t is Turn<A> & { kind: "user" | "assistant-text" } => t.kind === "user" || t.kind === "assistant-text")
      .map((t): AiChatTurn => ({ role: t.kind === "user" ? "user" : "assistant", text: t.text }))
      .slice(-6);

  async function submit(instructionRaw: string) {
    const instruction = instructionRaw.trim();
    const contextSummary = getContextSummary(instruction);
    const refusal = assistRequestRefusal({ instruction, contextSummary });
    if (refusal) {
      setTurns((t) => [...t, { kind: "user", text: instruction || "(empty)" }, { kind: "error", message: refusal }]);
      return;
    }

    setDraft("");
    setSending(true);
    const history = historyFor();
    setTurns((t) => [...t, { kind: "user", text: instruction }, { kind: "pending" }]);

    const outcome = await requestAssist({ surface, instruction, contextSummary, history });
    setSending(false);

    setTurns((t) => {
      const withoutPending = t.slice(0, -1);
      if (!outcome.ok) {
        return [...withoutPending, { kind: "error", message: outcome.message }];
      }
      if (outcome.kind === "message") {
        return [...withoutPending, { kind: "assistant-text", text: outcome.text }];
      }
      const validated = validate(outcome.tool, outcome.args);
      if (!validated.ok) {
        return [
          ...withoutPending,
          { kind: "error", message: `The assistant proposed something that couldn't be applied here: ${validated.message}` },
        ];
      }
      return [
        ...withoutPending,
        {
          kind: "proposal",
          tool: outcome.tool,
          preview: validated.preview,
          requiresConfirmation: validated.requiresConfirmation,
          confirmationMessage: validated.confirmationMessage,
          action: validated.action,
          status: validated.requiresConfirmation ? "confirming" : "awaiting",
        },
      ];
    });
  }

  function setProposalStatus(index: number, status: ProposalStatus) {
    setTurns((t) =>
      t.map((turn, i) => (i === index && turn.kind === "proposal" ? { ...turn, status } : turn)),
    );
  }

  /**
   * Take an instruction raised from elsewhere in the surface — an `=ai …`
   * typed into a cell — and send it once.
   *
   * `onPendingTaken` fires FIRST, before the await inside `submit`, so the
   * parent clears it immediately and a re-render mid-flight cannot deliver
   * the same question twice.
   */
  const pendingRef = useRef<string | null>(null);
  useEffect(() => {
    if (!pendingInstruction || pendingRef.current === pendingInstruction) return;
    pendingRef.current = pendingInstruction;
    onPendingTaken?.();
    void submit(pendingInstruction);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingInstruction]);

  const unconfigured = !statusLoading && status && !status.configured;

  return (
    <aside
      aria-label={`${surfaceLabel} assistant`}
      className="absolute inset-y-0 end-0 z-20 flex w-[340px] flex-col border-s border-hairline bg-[var(--surface-raised)] shadow-[var(--shadow-deck-seat)]"
    >
      <div className="flex items-center gap-2 border-b border-hairline px-3.5 py-2.5">
        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-inset bg-[var(--control)] text-ink-muted">
          <Icon.chat className="h-3.5 w-3.5" />
        </span>
        <h2 className="min-w-0 flex-1 truncate text-[13.5px] font-medium text-ink">Assistant</h2>
        <Chip tone="neutral" title="Cowork's built-in assistant">
          Cowork AI
        </Chip>
        <button
          type="button"
          aria-label="Close assistant"
          onClick={onClose}
          className="grid h-6 w-6 shrink-0 place-items-center rounded-inset text-ink-faint hover:bg-[var(--control)] hover:text-ink"
        >
          <Icon.close className="h-3.5 w-3.5" />
        </button>
      </div>

      {unconfigured && (
        <div className="px-3.5 pt-3">
          <InlineError compact message="The assistant is not configured on this server." />
        </div>
      )}

      <div ref={logRef} id={panelId} className="min-h-0 flex-1 overflow-y-auto px-3.5 py-3 scroll-slim">
        {turns.length === 0 ? (
          <>
            <p className="text-[12.5px] leading-relaxed text-ink-muted">
              Describe what you want, or start with one of these.
            </p>
            {/* Wrapping pills rather than a stack of full-width bars: eleven
                of these down a 340px column is a wall, and their labels are
                two or three words — the width was never carrying meaning. */}
            <ul className="mt-2.5 flex flex-wrap gap-1.5">
              {suggestedActions.map((s) => (
                <li key={s.label}>
                  <button
                    type="button"
                    disabled={!!unconfigured}
                    onClick={() => void submit(s.instruction)}
                    className="rounded-full bg-[var(--control)] px-2.5 py-1 text-[12px] text-ink-muted transition-colors hover:bg-[var(--control-hover)] hover:text-ink disabled:opacity-40"
                  >
                    {s.label}
                  </button>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <ol className="flex flex-col gap-3.5">
            {turns.map((turn, i) => (
              <li key={i}>
                <TurnView
                  turn={turn}
                  onApply={() => {
                    if (turn.kind !== "proposal") return;
                    apply(turn.action);
                    setProposalStatus(i, "applied");
                  }}
                  onConfirm={() => {
                    if (turn.kind !== "proposal") return;
                    apply(turn.action);
                    setProposalStatus(i, "applied");
                  }}
                  onReject={() => setProposalStatus(i, "rejected")}
                  onUndo={() => {
                    undo();
                    setProposalStatus(i, "undone");
                  }}
                />
              </li>
            ))}
          </ol>
        )}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!sending) void submit(draft);
        }}
        className="border-t border-hairline px-3 py-2.5"
      >
        <p className="mb-1.5 truncate text-[10.5px] text-ink-faint" title={contextLabel}>
          {contextLabel}
        </p>
        <div className="flex items-end gap-2">
          <textarea
            ref={inputRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                if (!sending && draft.trim()) void submit(draft);
              }
            }}
            maxLength={MAX_INPUT}
            rows={2}
            disabled={!!unconfigured}
            placeholder={placeholder}
            aria-label="Instruction for the assistant"
            className="min-w-0 flex-1 resize-none rounded-inset bg-[var(--surface-sunken)] px-3 py-2 text-[12.5px] text-ink shadow-[inset_0_0_0_1px_var(--color-hairline)] placeholder:text-ink-faint focus:shadow-[inset_0_0_0_1.5px_var(--color-ink)] focus:outline-none disabled:opacity-45"
          />
          <Button
            type="submit"
            size="sm"
            disabled={sending || !draft.trim() || !!unconfigured}
            className="shrink-0"
          >
            {sending ? "…" : "Send"}
          </Button>
        </div>
      </form>
    </aside>
  );
}

function TurnView<A>({
  turn,
  onApply,
  onConfirm,
  onReject,
  onUndo,
}: {
  turn: Turn<A>;
  onApply: () => void;
  onConfirm: () => void;
  onReject: () => void;
  onUndo: () => void;
}) {
  if (turn.kind === "user")
    return <p className="rounded-inset bg-[var(--control)] px-2.5 py-1.5 text-[12.5px] text-ink">{turn.text}</p>;

  if (turn.kind === "pending")
    return (
      <div className="flex items-center gap-1.5 px-1 py-1" role="status" aria-label="Thinking">
        <Skeleton className="h-3 w-3" />
        <span className="text-[11.5px] text-ink-faint">Thinking…</span>
      </div>
    );

  if (turn.kind === "assistant-text")
    return <p className="text-[12.5px] leading-relaxed text-ink-muted">{turn.text}</p>;

  if (turn.kind === "error")
    return (
      <div>
        <InlineError compact message={turn.message} />
      </div>
    );

  /* turn.kind === "proposal" */
  return (
    <div className="rounded-inset border border-hairline bg-[var(--surface-sunken)] p-2.5">
      <div className="text-[12.5px]">{turn.preview}</div>

      {turn.status === "confirming" && turn.confirmationMessage && (
        <p className="mt-2 rounded-inset bg-[color-mix(in_srgb,var(--state-overdue)_16%,transparent)] px-2 py-1.5 text-[11.5px] leading-relaxed text-[var(--state-overdue-ink)]">
          {turn.confirmationMessage}
        </p>
      )}

      <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
        {turn.status === "awaiting" && (
          <>
            <Button size="sm" onClick={onApply}>
              Apply
            </Button>
            <Button size="sm" tone="ghost" onClick={onReject}>
              Reject
            </Button>
          </>
        )}
        {turn.status === "confirming" && (
          <>
            <Button size="sm" tone="destructive" onClick={onConfirm}>
              Confirm & apply
            </Button>
            <Button size="sm" tone="ghost" onClick={onReject}>
              Reject
            </Button>
          </>
        )}
        {turn.status === "applied" && (
          <>
            <span className="text-[11.5px] text-[var(--state-positive-ink)]">Applied ✓</span>
            <Button size="sm" tone="ghost" onClick={onUndo}>
              Undo
            </Button>
          </>
        )}
        {turn.status === "undone" && <span className="text-[11.5px] text-ink-faint">Undone</span>}
        {turn.status === "rejected" && <span className="text-[11.5px] text-ink-faint">Rejected</span>}
      </div>
    </div>
  );
}
