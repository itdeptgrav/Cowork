"use client";

import { useId, useState } from "react";
import { Input } from "./Primitives";

/**
 * A password field that can be read back.
 *
 * **Why this is not a prop on `Input`.** `Primitives.tsx` carries no
 * `"use client"` and is imported by server components; the reveal toggle needs
 * `useState`, and adding it there would turn the whole primitives module client
 * -only — every panel, every button, every table, shipped to the browser for
 * one eye icon. So the state lives here and `Input` is reused unchanged, which
 * also means the field keeps the exact focus ring and inset border of every
 * other input on the page rather than a lookalike.
 *
 * **The toggle is a `<button type="button">`, deliberately.** Inside a `<form>`
 * a bare `<button>` submits it — pressing "show" would have attempted a sign-in
 * with a half-typed password and burned an attempt against the rate limiter.
 *
 * **It is never part of the tab order to a keyboard user filling the form.**
 * It is focusable (it must be operable without a mouse) but sits after the
 * input, so Tab from the password field reaches Submit by way of one control
 * that announces its own state — not a mystery icon.
 *
 * The revealed state is deliberately NOT persisted anywhere. A password left
 * visible across a reload, on a shared machine, is the failure this control is
 * otherwise worth having.
 */
export function PasswordInput({
  className = "",
  ...props
}: Omit<React.InputHTMLAttributes<HTMLInputElement>, "type">) {
  const [shown, setShown] = useState(false);
  const describedBy = useId();

  return (
    <div className="relative">
      <Input
        {...props}
        type={shown ? "text" : "password"}
        /* Room for the toggle, so a long password never runs underneath it. */
        className={`pr-11 ${className}`}
      />
      <button
        type="button"
        onClick={() => setShown((v) => !v)}
        /* `aria-pressed` states the toggle's condition; the label states what
           pressing it does. Announcing only one of the two leaves a screen
           reader user unable to tell whether their password is currently on
           screen — which is the whole point of the control. */
        aria-pressed={shown}
        aria-label={shown ? "Hide password" : "Show password"}
        aria-describedby={describedBy}
        title={shown ? "Hide password" : "Show password"}
        className="absolute top-1/2 right-1 flex h-8 w-9 -translate-y-1/2 items-center justify-center rounded-inset text-ink-faint transition-colors hover:text-ink focus-visible:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--color-ink)]"
      >
        <EyeIcon off={shown} />
      </button>
      <span id={describedBy} className="sr-only">
        {shown
          ? "Your password is visible on screen."
          : "Your password is hidden."}
      </span>
    </div>
  );
}

/**
 * `off` means "the password is currently shown", so the icon offers the next
 * action — a struck-through eye meaning "hide this again". An icon that mirrors
 * the current state instead reads as a status light and gets pressed by mistake.
 */
function EyeIcon({ off }: { off: boolean }) {
  return (
    <svg
      width="17"
      height="17"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12Z" />
      <circle cx="12" cy="12" r="2.8" />
      {off && <path d="m3.5 3.5 17 17" />}
    </svg>
  );
}
