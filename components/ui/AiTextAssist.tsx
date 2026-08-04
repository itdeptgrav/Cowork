"use client";

import { useState } from "react";
import { Icon } from "@/components/ui/Icons";
import { Popover } from "@/components/ui/Workspace";
import { Button } from "@/components/ui/Primitives";
import {
  improveText,
  type TextAssistMode,
  type TextAssistSurface,
} from "@/lib/workspace/ai/textAssist";

const PRESETS: { id: TextAssistMode; label: string }[] = [
  { id: "grammar", label: "Fix grammar" },
  { id: "rephrase", label: "Rephrase" },
  { id: "shorten", label: "Shorter" },
  { id: "lengthen", label: "Longer" },
];

/**
 * A small sparkle button that sits inside any plain text field (task form,
 * mail compose, …). Opens a popover offering quick rewrites or a freeform
 * instruction; the result is shown for review — it never overwrites the
 * field until the user picks "Replace". The popover always names the field
 * it is editing in its own header, so it reads as attached to that field
 * regardless of where it renders on screen.
 */
export function AiTextAssistButton({
  value,
  onApply,
  fieldLabel,
  surface,
}: {
  value: string;
  onApply: (next: string) => void;
  fieldLabel: string;
  /** What this field actually is, so the backend shapes its output correctly. */
  surface?: TextAssistSurface;
}) {
  const [mode, setMode] = useState<TextAssistMode | null>(null);
  const [prompt, setPrompt] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setMode(null);
    setPrompt("");
    setResult(null);
    setError(null);
    setLoading(false);
  }

  async function run(next: TextAssistMode, instruction?: string) {
    setMode(next);
    setResult(null);
    setError(null);
    setLoading(true);
    const outcome = await improveText({ text: value, mode: next, instruction, surface });
    setLoading(false);
    if (outcome.ok) setResult(outcome.text);
    else setError(outcome.message);
  }

  const hasText = value.trim().length > 0;
  const label = hasText ? `Improve ${fieldLabel} with AI` : `Write ${fieldLabel} with AI`;
  const showPicker = mode === null;

  return (
    <Popover
      label={label}
      align="right"
      trigger={({ open, toggle }) => (
        <button
          type="button"
          aria-label={label}
          title={label}
          onClick={() => {
            if (!open) reset();
            toggle();
          }}
          className="flex h-6 w-6 items-center justify-center rounded-full text-ink-faint transition-colors hover:bg-[var(--control)] hover:text-ink"
        >
          <Icon.sparkle className="h-3.5 w-3.5" />
        </button>
      )}
    >
      {(close) => (
        <div className="w-[300px]">
          <div className="flex items-center gap-1.5 border-b border-hairline px-2 pt-1 pb-2">
            <Icon.sparkle className="h-3 w-3 text-ink-faint" />
            <span className="text-xs font-medium text-ink-muted">
              {hasText ? (
                <>Improve &ldquo;{fieldLabel}&rdquo;</>
              ) : (
                <>Write &ldquo;{fieldLabel}&rdquo;</>
              )}
            </span>
          </div>

          <div className="p-2">
            {showPicker && (
              <div className="flex flex-col gap-2">
                {hasText && (
                  <div className="flex flex-wrap gap-1.5">
                    {PRESETS.map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => run(p.id)}
                        className="rounded-full bg-[var(--control)] px-2.5 py-1 text-[12px] font-medium text-ink-muted transition-colors hover:bg-[var(--control-hover)] hover:text-ink"
                      >
                        {p.label}
                      </button>
                    ))}
                  </div>
                )}
                <div className={hasText ? "border-t border-hairline pt-2" : ""}>
                  <span className="mb-1 block text-[11px] text-ink-faint">
                    {hasText
                      ? "Or tell it what to do"
                      : "Nothing here yet — describe what to write"}
                  </span>
                  <div className="flex gap-1.5">
                    <input
                      value={prompt}
                      onChange={(e) => setPrompt(e.target.value)}
                      placeholder={
                        hasText
                          ? "e.g. make it sound more formal"
                          : "e.g. a task to redesign the login page"
                      }
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && prompt.trim()) {
                          e.preventDefault();
                          run("custom", prompt.trim());
                        }
                      }}
                      className="w-full rounded-inset bg-[var(--surface-raised)] px-2.5 py-1.5 text-[13px] text-ink placeholder:text-ink-faint shadow-[inset_0_0_0_1px_var(--color-hairline)] focus:shadow-[inset_0_0_0_1.5px_var(--color-ink)] focus:outline-none"
                    />
                    <Button
                      size="sm"
                      tone="primary"
                      disabled={!prompt.trim()}
                      onClick={() => run("custom", prompt.trim())}
                    >
                      {hasText ? "Go" : "Write"}
                    </Button>
                  </div>
                </div>
              </div>
            )}

            {!showPicker && mode && (
              <>
                {loading && <p className="text-sm text-ink-muted">Thinking…</p>}
                {error && (
                  <>
                    <p className="text-sm text-[var(--state-overdue-ink)]">
                      {error}
                    </p>
                    <div className="mt-2 flex justify-end gap-1.5">
                      <Button size="sm" tone="ghost" onClick={reset}>
                        Back
                      </Button>
                      <Button
                        size="sm"
                        tone="secondary"
                        onClick={() => run(mode, mode === "custom" ? prompt.trim() : undefined)}
                      >
                        Try again
                      </Button>
                    </div>
                  </>
                )}
                {result && (
                  <>
                    <p className="max-h-40 overflow-y-auto rounded-inset bg-[var(--surface-sunken)] p-2 text-sm whitespace-pre-wrap text-ink">
                      {result}
                    </p>
                    <div className="mt-2 flex justify-end gap-1.5">
                      <Button size="sm" tone="ghost" onClick={reset}>
                        Back
                      </Button>
                      <Button
                        size="sm"
                        tone="secondary"
                        onClick={() => run(mode, mode === "custom" ? prompt.trim() : undefined)}
                      >
                        Try again
                      </Button>
                      <Button
                        size="sm"
                        tone="primary"
                        onClick={() => {
                          onApply(result);
                          reset();
                          close();
                        }}
                      >
                        Replace
                      </Button>
                    </div>
                  </>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </Popover>
  );
}
