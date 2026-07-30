"use client";

import { useEffect, useId, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { GuidedTour } from "./GuidedTour";
import type { HelpGuide } from "@/lib/help/types";
import {
  PROFILE_STORAGE_KEY,
  PROFILE_SWITCHER_ENABLED,
} from "@/lib/config/profileSwitcher";

/**
 * The help assistant.
 *
 * Built entirely from the deck's existing parts — `frost-bar`, the panel
 * radius, the control tokens, the 11/12/14 type steps, the deck-seat shadow.
 * There is no new visual language here and no new colour: the only tinted
 * element is the generated-answer marker, which borrows the state-extension
 * wash the product already uses for "this is qualified".
 *
 * **It explains and nothing else.** There is no path from this component to a
 * mutation: it holds one `fetch` to `/api/help`, and that endpoint reads. It
 * cannot approve, assign, configure or grant, and the answers it renders say so
 * where it matters — a permission question returns the general rule plus a note
 * that the product decides the individual case.
 *
 * No help logic lives here. The panel sends a question and a pathname; which
 * category that path implies, what to suggest, and whether to fall back to a
 * model are all decided on the server. A component that knew "/admin/roles is
 * about permissions" would be a second place to update when help changes.
 */

interface Turn {
  question: string;
  answer: string;
  source: "knowledge" | "related" | "generated" | "none";
  pending?: boolean;
  /** Present when the article has a walkthrough the viewer can perform. */
  guide?: HelpGuide | null;
  /** Present when it has one their role cannot perform. */
  guideWithheldReason?: string | null;
}

interface Opening {
  prompt: string;
  suggestions: string[];
}

const FALLBACK_OPENING: Opening = {
  prompt: "What would you like help with?",
  suggestions: [
    "How do I create a task?",
    "How does scoring work?",
    "Why am I offline?",
  ],
};

export function HelpAssistant() {
  const [open, setOpen] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState("");
  const [opening, setOpening] = useState<Opening>(FALLBACK_OPENING);
  const [tour, setTour] = useState<HelpGuide | null>(null);
  const pathname = usePathname();
  const panelId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const logRef = useRef<HTMLDivElement>(null);

  /* The opening offer depends on the page, so it is fetched when the panel
     opens rather than once on mount — the reader may have navigated since. */
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    fetch(`/api/help?page=${encodeURIComponent(pathname ?? "")}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: Opening | null) => {
        if (!cancelled && d?.prompt) setOpening(d);
      })
      .catch(() => {
        /* The panel still works without its suggestions. */
      });
    return () => {
      cancelled = true;
    };
  }, [open, pathname]);

  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    function onDown(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDown);
    };
  }, [open]);

  /* Keep the newest turn in view. */
  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [turns]);

  async function submit(question: string) {
    const q = question.trim();
    if (!q) return;
    setDraft("");
    setTurns((t) => [
      ...t,
      { question: q, answer: "", source: "none", pending: true },
    ]);

    try {
      const res = await fetch("/api/help", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          question: q,
          page: pathname,
          /* Who the app is currently acting as. The server has no way to know
             otherwise — the profile switcher changes identity in this process
             only — so without it the assistant gated every walkthrough against
             the seeded default and offered admin tours to people who are not
             admins. Sent only when the switcher is compiled in; the route
             ignores the field in production regardless. */
          actingEmployeeId: PROFILE_SWITCHER_ENABLED
            ? window.localStorage.getItem(PROFILE_STORAGE_KEY)
            : null,
        }),
      });
      const d = await res.json();
      setTurns((t) =>
        t.map((turn, i) =>
          i === t.length - 1
            ? {
                question: q,
                answer:
                  d.answer ??
                  "That could not be answered just now. Try again in a moment.",
                source: d.source ?? "none",
                guide: d.guide ?? null,
                guideWithheldReason: d.guideWithheldReason ?? null,
              }
            : turn,
        ),
      );
    } catch {
      setTurns((t) =>
        t.map((turn, i) =>
          i === t.length - 1
            ? {
                question: q,
                answer:
                  "The assistant could not be reached. Check your connection and try again.",
                source: "none",
              }
            : turn,
        ),
      );
    }
  }

  return (
    <>
      {tour && <GuidedTour guide={tour} onClose={() => setTour(null)} />}
      <div
        ref={rootRef}
        /* Bottom RIGHT: the music bar occupies bottom-left and the prototype bar
         bottom-centre. Reserves no space and shrinks no page. */
        className="pointer-events-none fixed right-[clamp(12px,3vw,32px)] bottom-[clamp(12px,3vw,28px)] z-40 flex flex-col items-end gap-2"
      >
        {open && (
          <div
            id={panelId}
            role="dialog"
            aria-label="Cowork help"
            className="frost-bar pointer-events-auto flex h-[min(560px,70vh)] w-[min(380px,calc(100vw-24px))] flex-col overflow-hidden rounded-panel border border-hairline shadow-[var(--deck-seat)]"
          >
            <div className="flex items-center gap-2 border-b border-hairline px-4 py-3">
              <h2 className="text-sm font-medium text-ink">Help</h2>
              <span className="text-[11px] text-ink-faint">
                Explains Cowork — it never changes anything
              </span>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close help"
                className="ml-auto grid h-6 w-6 shrink-0 place-items-center rounded-full text-ink-faint transition-colors hover:bg-[var(--control)] hover:text-ink"
              >
                ✕
              </button>
            </div>

            <div
              ref={logRef}
              className="min-h-0 flex-1 overflow-y-auto px-4 py-3 scroll-slim"
            >
              {turns.length === 0 ? (
                <>
                  <p className="text-sm text-ink">{opening.prompt}</p>
                  <ul className="mt-3 space-y-1.5">
                    {opening.suggestions.map((s) => (
                      <li key={s}>
                        <button
                          type="button"
                          onClick={() => void submit(s)}
                          className="w-full rounded-inset bg-[var(--control)] px-3 py-2 text-left text-xs text-ink transition-colors hover:bg-[var(--control-hover)]"
                        >
                          {s}
                        </button>
                      </li>
                    ))}
                  </ul>
                </>
              ) : (
                <ol className="space-y-4">
                  {turns.map((t, i) => (
                    <li key={i}>
                      <p className="text-xs font-medium text-ink">
                        {t.question}
                      </p>
                      {t.pending ? (
                        <p className="mt-1.5 text-xs text-ink-faint">
                          Looking…
                        </p>
                      ) : (
                        <>
                          <p className="mt-1.5 text-xs leading-relaxed text-ink-muted">
                            {t.answer}
                          </p>
                          {/* "Show me" appears only when a walkthrough exists
                            AND the viewer's role could actually perform it —
                            the gate is decided server-side against real
                            permissions, not guessed here. */}
                          {t.guide && (
                            <div className="mt-2 flex flex-wrap items-center gap-2">
                              <button
                                type="button"
                                onClick={() => {
                                  setTour(t.guide!);
                                  setOpen(false);
                                }}
                                className="rounded-full bg-ink px-3 py-1.5 text-[11px] font-medium text-[var(--body-bg)] transition-opacity hover:opacity-90"
                              >
                                Show me
                              </button>
                              <span className="text-[11px] text-ink-faint">
                                or read the explanation above
                              </span>
                            </div>
                          )}
                          {t.guideWithheldReason && (
                            <p className="mt-2 text-[11px] leading-relaxed text-ink-faint">
                              {t.guideWithheldReason}
                            </p>
                          )}
                          <SourceTag source={t.source} />
                        </>
                      )}
                    </li>
                  ))}
                </ol>
              )}
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                void submit(draft);
              }}
              className="flex items-center gap-2 border-t border-hairline px-3 py-2.5"
            >
              <input
                ref={inputRef}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                maxLength={500}
                placeholder="Ask about Cowork"
                aria-label="Ask about Cowork"
                className="min-w-0 flex-1 rounded-inset bg-[var(--surface-raised)] px-3 py-2 text-xs text-ink shadow-[inset_0_0_0_1px_var(--color-hairline)] placeholder:text-ink-faint focus:shadow-[inset_0_0_0_1.5px_var(--color-ink)] focus:outline-none"
              />
              <button
                type="submit"
                disabled={!draft.trim()}
                className="shrink-0 rounded-full bg-ink px-3 py-2 text-[11px] font-medium text-[var(--body-bg)] transition-opacity hover:opacity-90 disabled:opacity-40"
              >
                Ask
              </button>
            </form>
          </div>
        )}

        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-controls={open ? panelId : undefined}
          aria-label={open ? "Close help" : "Open help"}
          className="frost-bar pointer-events-auto grid h-11 w-11 place-items-center rounded-full border border-hairline text-sm font-medium text-ink shadow-[var(--deck-seat)] transition-colors hover:bg-[var(--control)]"
        >
          {open ? "✕" : "?"}
        </button>
      </div>
    </>
  );
}

/**
 * Where the answer came from.
 *
 * Two states, worded for a reader rather than a maintainer: the knowledge base
 * is Cowork stating its own rule, a generated answer is an explanation of those
 * rules. No confidence number, no model name, no article id — the distinction
 * that matters is which KIND of answer this is, and a percentage invites
 * arithmetic about something that is really a judgement.
 */
function SourceTag({ source }: { source: Turn["source"] }) {
  if (source === "none") return null;

  /* Three kinds of answer, three labels. "Related help" is the important one:
     it is a weak match the search is not confident about, and rendering it as
     "Knowledge base" would assert something the search itself doubts. */
  const label =
    source === "generated"
      ? "Assistant"
      : source === "related"
        ? "Related help"
        : "Knowledge base";
  const title =
    source === "generated"
      ? "Explained from Cowork's help material. It is a guide — the product itself decides what you can do."
      : source === "related"
        ? "The closest topic Cowork's help covers. It may not answer exactly what you asked."
        : "Answered directly from Cowork's help.";

  return (
    <span
      title={title}
      className={`mt-2 inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] ${
        source === "knowledge"
          ? "bg-[var(--control)] text-ink-muted"
          : "bg-[color-mix(in_srgb,var(--state-extension)_20%,transparent)] text-[var(--state-extension-ink)]"
      }`}
    >
      {label}
    </span>
  );
}
