"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Button, InlineError } from "@/components/ui/Primitives";
import { Icon } from "@/components/ui/Icons";
import {
  generateTempPassword,
  resetCoworkPassword,
} from "@/lib/legacy/employeeAdmin";

/**
 * Give somebody a new password, because they cannot get in.
 *
 * **This is a bigger act than it reads as, and the dialog says so before it is
 * done rather than after.** The engine writes the password to Firebase Auth,
 * marks it temporary, and revokes every refresh token the person holds — they
 * are signed out of every device within moments, mid-task if they were working
 * — and it tells them, in the app, by push and by email. An administrator
 * pressing this while somebody is on a call with a client should know that
 * before pressing it.
 *
 * **The password is generated, not invented.** A human choosing one under time
 * pressure produces a weak one, reuses one, or picks something the person is
 * embarrassed to type. It is editable for the case where somebody has a
 * convention to follow, and the engine's own floor — six characters — is
 * enforced here too so a refusal costs a round trip rather than a mystery.
 *
 * It is shown once, afterwards, because it has to be passed on: the welcome
 * email carries it, and an administrator on the phone needs to read it out.
 */
export function ResetPasswordDialog({
  employeeId,
  displayName,
  token,
  onClose,
}: {
  /** The `cowork_employees` document id — never the HR id. */
  employeeId: string;
  displayName: string;
  /** A Firebase ID token for the acting administrator. */
  token: () => Promise<string>;
  onClose: () => void;
}) {
  const [password, setPassword] = useState(generateTempPassword);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !pending) onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose, pending]);

  const tooShort = password.trim().length < 6;

  async function submit() {
    if (tooShort || pending) return;
    setPending(true);
    setError(null);
    try {
      const res = await resetCoworkPassword({
        token: await token(),
        employeeId,
        newPassword: password.trim(),
      });
      if (!res.ok) setError(res.error.message);
      else setDone(res.data?.message ?? "Password reset.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "The reset could not be sent.");
    } finally {
      setPending(false);
    }
  }

  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="reset-pw-title"
      className="fixed inset-0 z-[97] grid place-items-center p-4"
    >
      <button
        type="button"
        aria-label="Close"
        onClick={() => !pending && onClose()}
        className="absolute inset-0 cursor-default bg-[var(--body-bg)]/60 backdrop-blur-[4px]"
      />

      <div className="frost-panel relative w-[min(460px,96vw)] rounded-panel px-6 py-5">
        <h2
          id="reset-pw-title"
          className="text-[17px] leading-tight font-medium tracking-[-0.01em] text-ink"
        >
          {done ? "Password reset" : `Reset ${displayName}’s password`}
        </h2>

        {done ? (
          <>
            <p className="mt-1.5 text-[13px] leading-relaxed text-ink-muted">
              {done}
            </p>
            {/* Shown once, and only here: it has to reach the person somehow,
                and the engine's email is not always the fastest route. */}
            <div className="mt-3 flex items-center gap-2 rounded-inset bg-[var(--surface-sunken)] px-3 py-2.5">
              <code className="min-w-0 flex-1 truncate font-mono text-[13px] text-ink">
                {password.trim()}
              </code>
              <button
                type="button"
                onClick={() => {
                  void navigator.clipboard
                    ?.writeText(password.trim())
                    .then(() => setCopied(true))
                    .catch(() => setCopied(false));
                }}
                className="shrink-0 rounded-full bg-[var(--control)] px-2.5 py-1 text-[11px] text-ink transition-colors hover:bg-[var(--control-hover)]"
              >
                {copied ? "Copied" : "Copy"}
              </button>
            </div>
            <p className="mt-2 text-[11px] leading-relaxed text-ink-faint">
              They will be asked to choose their own the next time they sign in.
            </p>
            <div className="mt-5 flex justify-end">
              <Button tone="primary" size="sm" onClick={onClose}>
                Done
              </Button>
            </div>
          </>
        ) : (
          <>
            <p className="mt-1.5 text-[13px] leading-relaxed text-ink-muted">
              This signs {displayName} out of every device immediately, and
              tells them it happened — in the app, by push and by email. Their
              work is not affected; anything unsaved in an open tab is.
            </p>

            <label className="mt-4 block">
              <span className="text-[11px] text-ink-faint">
                Temporary password
              </span>
              <span className="mt-1 flex items-center gap-2">
                <input
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoFocus
                  spellCheck={false}
                  autoComplete="off"
                  className="min-w-0 flex-1 rounded-inset border border-hairline bg-[var(--surface-sunken)] px-3 py-2 font-mono text-[13px] text-ink focus:ring-1 focus:ring-ink/20 focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => setPassword(generateTempPassword())}
                  title="Generate another"
                  aria-label="Generate another password"
                  className="shrink-0 rounded-inset bg-[var(--control)] p-2 text-ink-muted transition-colors hover:bg-[var(--control-hover)] hover:text-ink"
                >
                  <Icon.sparkle className="h-3.5 w-3.5" />
                </button>
              </span>
            </label>
            {tooShort && (
              <p className="mt-1.5 text-[11px] text-ink-faint">
                At least six characters.
              </p>
            )}

            {error && (
              <div className="mt-3">
                <InlineError message={error} />
              </div>
            )}

            <div className="mt-5 flex items-center justify-end gap-2">
              <Button
                tone="ghost"
                size="sm"
                onClick={onClose}
                disabled={pending}
              >
                Cancel
              </Button>
              <Button
                tone="primary"
                size="sm"
                onClick={() => void submit()}
                disabled={tooShort || pending}
              >
                {pending ? "Resetting…" : "Reset and sign them out"}
              </Button>
            </div>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}
