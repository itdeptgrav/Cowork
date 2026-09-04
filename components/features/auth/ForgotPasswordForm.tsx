"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { AuthFrame, AuthSwitch } from "./AuthFrame";
import { Button, Field, InlineError, Input } from "@/components/ui/Primitives";
import { PasswordInput } from "@/components/ui/PasswordInput";
import { PASSWORD_MIN_LENGTH } from "@/lib/auth/passwordRule";
import {
  checkResetCode,
  requestResetCode,
  resetPasswordWithCode,
} from "@/lib/auth/recoveryApi";

/**
 * Forgot password — email, then a 4-digit code, then a new password.
 *
 * **Three steps rather than one form.** The code could be submitted together
 * with the new password, and that is a step fewer. It is also how you spend
 * somebody's fourth of five attempts on a correct code because their two
 * password fields did not match. `check-otp` exists so that being wrong about
 * the password costs nothing, and this form is why.
 *
 * **The email is never confirmed to exist.** The endpoint answers the same
 * sentence whether or not there is an account, and this screen repeats it
 * verbatim. Softening it — "we couldn't find that address" — would undo the
 * whole point: sign-in refuses to say which addresses are registered, and a
 * form needing no password at all must not be the one that tells you.
 *
 * The consequence is a real dead end for somebody who mistyped their address:
 * they wait for mail that will never come. That is why the code step keeps the
 * address on screen with a way back to change it, rather than treating the
 * first step as finished business.
 */

type Phase =
  | { step: "email" }
  | { step: "code" }
  | { step: "password" }
  | { step: "done" };

const OTP_LENGTH = 4;

export function ForgotPasswordForm() {
  /* Carried from the sign-in form so somebody who typed their address there
     does not type it again. Not trusted for anything — it only fills a field. */
  const prefill = useSearchParams().get("email") ?? "";

  const [phase, setPhase] = useState<Phase>({ step: "email" });
  const [email, setEmail] = useState(prefill);
  const [otp, setOtp] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");

  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  /**
   * Seconds until another code may be asked for.
   *
   * Mirrors the endpoint's own 60-second cooldown. Without it the button
   * invites a second press that the server silently absorbs — the reply is
   * identical either way, by design — so the screen would show success and
   * send nothing, which is indistinguishable from mail that is merely slow.
   */
  const [cooldown, setCooldown] = useState(0);
  useEffect(() => {
    if (cooldown <= 0) return;
    const id = setTimeout(() => setCooldown((s) => s - 1), 1000);
    return () => clearTimeout(id);
  }, [cooldown]);

  async function sendCode(e?: React.FormEvent) {
    e?.preventDefault();
    if (pending || cooldown > 0) return;
    setError(null);
    setNotice(null);
    setPending(true);

    const result = await requestResetCode(email.trim());
    setPending(false);

    if (!result.success) {
      setError(result.message ?? "Could not send a code. Try again.");
      return;
    }

    setPhase({ step: "code" });
    setCooldown(60);
    setNotice(
      result._devOtp
        ? /* Development only — the backend omits this outside production. It is
             surfaced rather than hidden in a console because without a mail key
             configured locally there is otherwise no way to walk this flow. */
          `${result.message} Development code: ${result._devOtp}`
        : (result.message ?? null),
    );
  }

  async function submitCode(e: React.FormEvent) {
    e.preventDefault();
    if (pending || otp.length !== OTP_LENGTH) return;
    setError(null);
    setPending(true);

    const result = await checkResetCode(email.trim(), otp);
    setPending(false);

    if (!result.success) {
      setError(result.message ?? "That code did not work.");
      return;
    }
    setNotice(null);
    setPhase({ step: "password" });
  }

  const mismatch = confirm.length > 0 && password !== confirm;
  const passwordReady = password.length >= PASSWORD_MIN_LENGTH && !mismatch;

  async function submitPassword(e: React.FormEvent) {
    e.preventDefault();
    if (pending || !passwordReady) return;
    setError(null);
    setPending(true);

    const result = await resetPasswordWithCode(email.trim(), otp, password);
    setPending(false);

    if (!result.success) {
      /* The code can still be rejected here — it may have expired between the
         two steps. Sending them back to the code step rather than leaving them
         on a password form whose submit will never succeed. */
      setError(result.message ?? "Could not set your new password.");
      if (/code|expired|attempt/i.test(result.message ?? "")) {
        setPhase({ step: "code" });
        setOtp("");
      }
      return;
    }
    setPhase({ step: "done" });
  }

  /* ── Done ───────────────────────────────────────────────────────────────── */

  if (phase.step === "done") {
    return (
      <AuthFrame
        title="Password updated"
        lede={`Sign in as ${email.trim()} with your new password.`}
        footer={<AuthSwitch question="Ready?" href="/signin" action="Go to sign in" />}
      >
        <p className="text-sm leading-relaxed text-ink-muted">
          Every other device has been signed out. If you reset this because you
          lost a phone or a laptop, that device no longer has access.
        </p>
        <a
          href="/signin"
          className="mt-5 inline-flex items-center justify-center rounded-full bg-ink px-4 py-2 text-[15px] font-medium text-[var(--body-bg)] transition-opacity hover:opacity-90"
        >
          Sign in
        </a>
      </AuthFrame>
    );
  }

  /* ── Choose a new password ──────────────────────────────────────────────── */

  if (phase.step === "password") {
    return (
      <AuthFrame
        title="Choose a new password"
        lede={`Setting a new password for ${email.trim()} signs out every other device.`}
        footer={<AuthSwitch question="Remembered it?" href="/signin" action="Sign in instead" />}
      >
        <form onSubmit={submitPassword} noValidate className="flex flex-col gap-4">
          {error && <InlineError message={error} />}
          <Field
            label="New password"
            required
            hint={`At least ${PASSWORD_MIN_LENGTH} characters. Length matters more than symbols.`}
          >
            <PasswordInput
              autoComplete="new-password"
              autoFocus
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </Field>
          <Field
            label="Confirm password"
            required
            error={mismatch ? "The two passwords do not match." : undefined}
          >
            <PasswordInput
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
            />
          </Field>
          <Button
            type="submit"
            tone="primary"
            disabled={!passwordReady || pending}
            className="mt-1 w-full"
          >
            {pending ? "Setting…" : "Set new password"}
          </Button>
        </form>
      </AuthFrame>
    );
  }

  /* ── Enter the code ─────────────────────────────────────────────────────── */

  if (phase.step === "code") {
    return (
      <AuthFrame
        title="Enter your code"
        lede={`We sent a ${OTP_LENGTH}-digit code to ${email.trim()}. It expires in 10 minutes.`}
        footer={<AuthSwitch question="Remembered it?" href="/signin" action="Sign in instead" />}
      >
        <form onSubmit={submitCode} noValidate className="flex flex-col gap-4">
          {error && <InlineError message={error} />}
          {notice && !error && (
            <p className="rounded-inset bg-[var(--control)] px-3.5 py-2.5 text-sm leading-relaxed text-ink-muted">
              {notice}
            </p>
          )}

          <Field label="4-digit code" required>
            <Input
              /* Focused on mount, which is also how focus follows the step:
                 the email step and this one are different trees, so arriving
                 here mounts a fresh input rather than re-rendering the old one.
                 A ref would be the reflex, and `Input` is not a `forwardRef`
                 component — only `Textarea` is. */
              autoFocus
              /* `text` with a numeric inputMode, not `type="number"`. A number
                 input drops leading zeros, and a code of "0431" typed into one
                 becomes "431" — which then fails to verify for a reason nobody
                 on either side can see. */
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]*"
              maxLength={OTP_LENGTH}
              required
              value={otp}
              onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, OTP_LENGTH))}
              placeholder="0000"
              className="text-center text-lg tracking-[0.6em]"
            />
          </Field>

          <Button
            type="submit"
            tone="primary"
            disabled={pending || otp.length !== OTP_LENGTH}
            className="mt-1 w-full"
          >
            {pending ? "Checking…" : "Continue"}
          </Button>

          <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <button
              type="button"
              onClick={() => {
                setPhase({ step: "email" });
                setOtp("");
                setError(null);
                setNotice(null);
              }}
              className="text-ink-muted underline decoration-hairline underline-offset-4 transition-colors hover:text-ink"
            >
              Use a different address
            </button>
            <button
              type="button"
              onClick={() => void sendCode()}
              disabled={cooldown > 0 || pending}
              className="text-ink-muted underline decoration-hairline underline-offset-4 transition-colors hover:text-ink disabled:no-underline disabled:opacity-60"
            >
              {cooldown > 0 ? `Resend in ${cooldown}s` : "Send a new code"}
            </button>
          </div>
        </form>
      </AuthFrame>
    );
  }

  /* ── Ask for a code ─────────────────────────────────────────────────────── */

  return (
    <AuthFrame
      title="Reset your password"
      lede="Tell us your work address and we will send a 4-digit code."
      footer={<AuthSwitch question="Remembered it?" href="/signin" action="Sign in instead" />}
    >
      <form onSubmit={sendCode} noValidate className="flex flex-col gap-4">
        {error && <InlineError message={error} />}

        <Field label="Email">
          <Input
            type="email"
            name="email"
            autoComplete="username"
            autoFocus
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@company.com"
          />
        </Field>

        <Button
          type="submit"
          tone="primary"
          disabled={pending || !email.trim()}
          className="mt-1 w-full"
        >
          {pending ? "Sending…" : "Send code"}
        </Button>
      </form>
    </AuthFrame>
  );
}
