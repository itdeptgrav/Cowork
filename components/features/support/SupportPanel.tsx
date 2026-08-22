"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Icon } from "@/components/ui/Icons";
import {
  EMPTY_SUPPORT_DRAFT,
  SUPPORT_TOPICS,
  SUPPORT_URGENCIES,
  supportDraftReady,
  supportReference,
  supportRefusals,
  type SupportDraft,
} from "@/lib/rules/support/request";

/**
 * The Support page, opened by Ctrl+S from anywhere — signed in or not.
 *
 * ## Why it is an overlay rather than a route
 *
 * It has to work on the sign-in screen, and that is exactly where navigating
 * away is most expensive: somebody halfway through typing a password, or
 * reading the error explaining why they cannot get in, would lose both to a
 * page change. It also has to work while the shell is still saying "Signing
 * you in…", which is a state with no route of its own. An overlay costs
 * nothing on either count — it opens over what is already there, and closing
 * puts the reader back exactly where they were, mid-sentence.
 *
 * ## What is real and what is not
 *
 * The form, the validation and the wording are real. **Nothing is sent.** No
 * request is written and no message leaves the browser, and the panel says so
 * in two places rather than implying delivery and quietly dropping it —
 * somebody who believes they have asked for help and has not is worse off than
 * somebody who was told to use another channel.
 *
 * The draft survives closing: this component stays mounted and renders nothing
 * while shut, so a panel dismissed by accident opens again with the sentence
 * still in it.
 */

export function SupportPanel({
  open,
  onClose,
  /** Where the reader was when they asked. Shown so a report can be placed. */
  fromPath,
  /** Focus returns here on close — the control that opened it, where there was
   *  one. A keyboard shortcut has none, and focus goes back to the page. */
  returnFocusTo,
}: {
  open: boolean;
  onClose: () => void;
  fromPath?: string;
  returnFocusTo?: React.RefObject<HTMLElement | null>;
}) {
  const [draft, setDraft] = useState<SupportDraft>(EMPTY_SUPPORT_DRAFT);
  /** Set once the reader has tried to send — refusals stay quiet until then. */
  const [tried, setTried] = useState(false);
  /** A drafted request, and the screen that admits it went nowhere. */
  const [sent, setSent] = useState<{ reference: string; subject: string } | null>(
    null,
  );
  const panelRef = useRef<HTMLDivElement>(null);
  const headingId = useId();

  const refusals = useMemo(() => supportRefusals(draft), [draft]);
  const ready = supportDraftReady(draft);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      /* Stopped here so one Escape closes one thing: this panel can open over
         a page that is itself listening for Escape. */
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("keydown", onKey);
    const restore = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    panelRef.current?.focus();
    /* Captured now rather than read in the cleanup, where the ref may point at
       something else or at nothing. */
    const opener = returnFocusTo?.current ?? null;
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = restore;
      opener?.focus();
    };
  }, [open, onClose, returnFocusTo]);

  function set<K extends keyof SupportDraft>(field: K, value: SupportDraft[K]) {
    setDraft((d) => ({ ...d, [field]: value }));
  }

  function submit() {
    setTried(true);
    if (!ready) return;
    /* `Date.now()` in an event handler, never in render: the reference has to
       hold still once it is on screen, and a value read while drawing would
       change on every re-render. */
    setSent({
      reference: supportReference(Date.now(), draft.subject.trim()),
      subject: draft.subject.trim(),
    });
  }

  function startAnother() {
    setSent(null);
    setTried(false);
    setDraft(EMPTY_SUPPORT_DRAFT);
  }

  if (typeof document === "undefined" || !open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[95] flex items-end justify-center sm:items-center sm:p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      {/* **The entrance is CSS, not a state flip on mount.** The obvious
          version renders at `opacity: 0` and turns it up in a
          `requestAnimationFrame` — and rAF does not run while the tab is not
          compositing, which leaves an invisible overlay over a page whose
          scroll is already locked. A keyframe cannot fail to start. */}
      <div aria-hidden className="fade-in absolute inset-0 bg-black/50" />

      {/* A sheet on a phone, a dialog on a desktop. Full width against the
          bottom edge below `sm`: a centred box with margins on all four sides
          wastes the one screen where the form barely fits. */}
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        tabIndex={-1}
        /* `.snap-in` is the product's own class for chrome that arrives
           because somebody pressed a key a fifth of a second ago — the same
           one the command palette wears. */
        className="frost-bar snap-in relative flex max-h-[92dvh] w-full max-w-[640px] flex-col overflow-hidden rounded-t-panel border border-hairline shadow-[var(--deck-seat)] outline-none sm:max-h-[85dvh] sm:rounded-panel"
      >
        <header className="flex shrink-0 items-start gap-3 border-b border-hairline px-4 py-3.5 sm:px-5">
          <span
            aria-hidden
            className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[var(--surface-sunken)] text-ink-muted"
          >
            <Icon.support className="h-4 w-4" />
          </span>
          <div className="min-w-0 flex-1">
            <h2
              id={headingId}
              className="text-[15px] leading-tight font-medium tracking-[-0.015em] text-ink"
            >
              Support
            </h2>
            <p className="mt-1 text-[11px] leading-relaxed text-ink-faint">
              {sent
                ? "Here is what you wrote."
                : "Tell us what is happening. You do not need to be signed in."}
            </p>
          </div>
          {/* The shortcut, shown where it was used: somebody who found this by
              accident should learn how to find it again on purpose. */}
          <span
            aria-hidden
            className="hidden shrink-0 items-center gap-1 rounded-full bg-[var(--control)] px-2 py-1 text-[10px] text-ink-muted sm:inline-flex"
          >
            <kbd className="font-sans">Ctrl</kbd>
            <span>+</span>
            <kbd className="font-sans">S</kbd>
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close support"
            className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-ink-muted transition-colors hover:bg-[var(--control)] hover:text-ink"
          >
            <Icon.close className="h-4 w-4" />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 scroll-slim sm:px-5">
          {sent ? (
            <Sent
              reference={sent.reference}
              subject={sent.subject}
              onAnother={startAnother}
              onClose={onClose}
            />
          ) : (
            <div className="flex flex-col gap-4">
              <Field
                label="What is this about?"
                error={tried ? refusals.topic : undefined}
              >
                <div className="flex flex-wrap gap-1.5">
                  {SUPPORT_TOPICS.map((t) => {
                    const on = draft.topic === t.id;
                    return (
                      <button
                        key={t.id}
                        type="button"
                        aria-pressed={on}
                        onClick={() => set("topic", t.id)}
                        className={`rounded-full px-3 py-1.5 text-xs transition-colors ${
                          on
                            ? "bg-ink text-[var(--body-bg)]"
                            : "bg-[var(--control)] text-ink hover:bg-[var(--control-hover)]"
                        }`}
                      >
                        {t.label}
                      </button>
                    );
                  })}
                </div>
              </Field>

              <Field label="Summary" error={tried ? refusals.subject : undefined}>
                <input
                  value={draft.subject}
                  onChange={(e) => set("subject", e.target.value)}
                  placeholder="One line — what went wrong?"
                  maxLength={120}
                  className={INPUT}
                />
              </Field>

              <Field
                label="What happened?"
                hint="What you expected, and what happened instead."
                error={tried ? refusals.detail : undefined}
              >
                <textarea
                  value={draft.detail}
                  onChange={(e) => set("detail", e.target.value)}
                  rows={5}
                  placeholder="The steps you took, anything on screen you can quote, and roughly when."
                  maxLength={2000}
                  className={`${INPUT} min-h-[104px] resize-y leading-relaxed`}
                />
              </Field>

              <Field
                label="Where should we reply?"
                error={tried ? refusals.email : undefined}
              >
                <input
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  value={draft.email}
                  onChange={(e) => set("email", e.target.value)}
                  placeholder="you@company.com"
                  className={INPUT}
                />
              </Field>

              <Field label="How urgent is it?">
                <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-3">
                  {SUPPORT_URGENCIES.map((u) => {
                    const on = draft.urgency === u.id;
                    return (
                      <button
                        key={u.id}
                        type="button"
                        aria-pressed={on}
                        onClick={() => set("urgency", u.id)}
                        className={`rounded-inset px-3 py-2 text-left transition-colors ${
                          on
                            ? "bg-[var(--control-active)] text-ink shadow-[inset_0_0_0_1px_var(--color-ink)]"
                            : "bg-[var(--control)] text-ink hover:bg-[var(--control-hover)]"
                        }`}
                      >
                        <span className="block text-xs font-medium">{u.label}</span>
                        <span className="mt-0.5 block text-[11px] text-ink-faint">
                          {u.hint}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </Field>

              {/* What the reader was looking at. Read from the route rather
                  than asked for — nobody can recite their own URL, and it is
                  the single most useful line in a report. */}
              {fromPath && (
                <p className="text-[11px] text-ink-faint">
                  Sent from{" "}
                  <span data-figure className="text-ink-muted">
                    {fromPath}
                  </span>
                </p>
              )}
            </div>
          )}
        </div>

        {!sent && (
          <footer className="flex shrink-0 flex-wrap items-center gap-2 border-t border-hairline px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-5">
            {/* Said BEFORE the button, not after it. A preview that admits what
                it is only once the reader has pressed Send has already let them
                believe they asked for help. */}
            <p className="min-w-0 flex-1 text-[11px] leading-snug text-ink-faint">
              Preview — nothing is sent yet.
            </p>
            <button
              type="button"
              onClick={onClose}
              className="rounded-full px-3 py-1.5 text-xs text-ink-muted transition-colors hover:bg-[var(--control)] hover:text-ink"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={submit}
              /* Never disabled. A dead button explains nothing; pressing this
                 one marks every unfinished field at once, which is the answer
                 to "why can I not send this?" */
              className="rounded-full bg-ink px-3.5 py-1.5 text-xs font-medium text-[var(--body-bg)] transition-opacity hover:opacity-90"
            >
              Send request
            </button>
          </footer>
        )}
      </div>
    </div>,
    document.body,
  );
}

const INPUT =
  "w-full rounded-inset bg-[var(--surface-sunken)] px-3 py-2 text-sm text-ink outline-none placeholder:text-ink-faint focus-visible:ring-2 focus-visible:ring-ink";

/** One labelled field, with its refusal underneath where there is one. */
function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-medium text-ink">{label}</span>
      {hint && !error && (
        <span className="mb-1.5 block text-[11px] text-ink-faint">{hint}</span>
      )}
      {children}
      {error && (
        <span
          role="alert"
          className="mt-1.5 block text-[11px] text-[var(--state-overdue-ink)]"
        >
          {error}
        </span>
      )}
    </label>
  );
}

/**
 * The confirmation.
 *
 * It gives the reference AND states that nothing was sent, in that order and
 * both plainly. A convincing success screen over a request that went nowhere
 * is the one outcome this panel must never produce.
 */
function Sent({
  reference,
  subject,
  onAnother,
  onClose,
}: {
  reference: string;
  subject: string;
  onAnother: () => void;
  onClose: () => void;
}) {
  return (
    <div className="py-2 text-center">
      <span
        aria-hidden
        className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-full bg-[var(--surface-sunken)] text-ink"
      >
        <Icon.check className="h-5 w-5" />
      </span>
      <p className="text-[15px] font-medium text-ink">Request drafted</p>
      <p className="mx-auto mt-2 max-w-[42ch] text-xs leading-relaxed text-ink-muted">
        “{subject}” would be raised as{" "}
        <span data-figure className="text-ink">
          {reference}
        </span>
        .
      </p>
      <p className="mx-auto mt-3 max-w-[46ch] rounded-inset bg-[var(--surface-sunken)] px-3 py-2 text-[11px] leading-relaxed text-ink-faint">
        This is a preview of the support form.{" "}
        <strong className="font-medium text-ink-muted">Nothing was sent</strong>{" "}
        and no record was kept — the reference above is an example of what you
        would be given. Please raise anything urgent the way you do today.
      </p>
      <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
        <button
          type="button"
          onClick={onClose}
          className="rounded-full bg-ink px-3.5 py-1.5 text-xs font-medium text-[var(--body-bg)] transition-opacity hover:opacity-90"
        >
          Close
        </button>
        <button
          type="button"
          onClick={onAnother}
          className="rounded-full bg-[var(--control)] px-3.5 py-1.5 text-xs font-medium text-ink transition-colors hover:bg-[var(--control-hover)]"
        >
          Write another
        </button>
      </div>
    </div>
  );
}
