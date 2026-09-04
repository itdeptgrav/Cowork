"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Button, Field, InlineError, Input, Textarea } from "@/components/ui/Primitives";

/**
 * One value, asked for in a dialog — a URL, a LaTeX expression, a footnote.
 *
 * The browser's `prompt()` would do the job and would look like 1998; this
 * is the same question in the product's own dress, with a hint, validation
 * and Escape.
 */
export function DocsPrompt({
  title,
  label,
  hint,
  placeholder,
  initial = "",
  multiline = false,
  submitLabel = "Insert",
  validate,
  onSubmit,
  onClose,
}: {
  title: string;
  label: string;
  hint?: string;
  placeholder?: string;
  initial?: string;
  multiline?: boolean;
  submitLabel?: string;
  /** Null when fine; the sentence to show when not. */
  validate?: (value: string) => string | null;
  onSubmit: (value: string) => void;
  onClose: () => void;
}) {
  const [value, setValue] = useState(initial);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const submit = () => {
    const problem = validate?.(value) ?? null;
    if (problem) {
      setError(problem);
      return;
    }
    onSubmit(value);
  };

  if (typeof document === "undefined") return null;
  return createPortal(
    <div role="dialog" aria-modal="true" aria-labelledby="docs-prompt-title" className="fixed inset-0 z-[97] grid place-items-center p-4">
      <button type="button" aria-label="Close" onClick={onClose} className="absolute inset-0 cursor-default bg-[var(--body-bg)]/60 backdrop-blur-[4px]" />
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        className="frost-panel relative w-[min(480px,96vw)] rounded-panel px-6 py-5"
      >
        <h2 id="docs-prompt-title" className="text-[17px] leading-tight font-medium tracking-[-0.01em] text-ink">
          {title}
        </h2>
        <Field label={label} hint={hint} className="mt-4">
          {multiline ? (
            <Textarea autoFocus rows={4} value={value} onChange={(e) => setValue(e.target.value)} placeholder={placeholder} className="font-mono text-[13px]" />
          ) : (
            <Input autoFocus value={value} onChange={(e) => setValue(e.target.value)} placeholder={placeholder} />
          )}
        </Field>
        {error && (
          <div className="mt-3">
            <InlineError compact message={error} />
          </div>
        )}
        <div className="mt-5 flex items-center justify-end gap-2">
          <Button size="sm" tone="ghost" type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" tone="primary" type="submit" disabled={!value.trim()}>
            {submitLabel}
          </Button>
        </div>
      </form>
    </div>,
    document.body,
  );
}
