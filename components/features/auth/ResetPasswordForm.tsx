"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { AuthFrame, AuthSwitch } from "./AuthFrame";
import { Button, Field, InlineError, Input } from "@/components/ui/Primitives";
import { PasswordInput } from "@/components/ui/PasswordInput";
import { PASSWORD_MIN_LENGTH } from "@/lib/auth/passwordRule";

/**
 * Set a password from an invitation or a reset link.
 *
 * The token is described before it is spent, so somebody arriving on a dead
 * link is told immediately rather than after filling in two fields. The two
 * purposes share this page because they share the mechanism — only the wording
 * differs, and pretending otherwise would mean two pages drifting apart.
 */
export function ResetPasswordForm() {
  const token = useSearchParams().get("token") ?? "";
  const [state, setState] = useState<
    | { phase: "checking" }
    | { phase: "dead"; message: string }
    | { phase: "ready"; purpose: "invite" | "reset"; email: string; displayName: string }
    | { phase: "done"; email: string }
  >({ phase: "checking" });

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!token) {
      /* Deferred like the fetch branch below, so neither path sets state
         synchronously inside the effect body. */
      queueMicrotask(() => {
        if (!cancelled)
          setState({ phase: "dead", message: "That link is missing its token." });
      });
      return () => {
        cancelled = true;
      };
    }
    queueMicrotask(async () => {
      try {
        const res = await fetch(`/api/auth/redeem?token=${encodeURIComponent(token)}`, {
          cache: "no-store",
        });
        const data = await res.json();
        if (cancelled) return;
        setState(
          data.ok
            ? { phase: "ready", purpose: data.purpose, email: data.email, displayName: data.displayName }
            : { phase: "dead", message: data.message },
        );
      } catch {
        if (!cancelled) setState({ phase: "dead", message: "Could not reach the server." });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [token]);

  const mismatch = confirm.length > 0 && password !== confirm;
  const ready = password.length >= PASSWORD_MIN_LENGTH && !mismatch;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!ready || pending) return;
    setError(null);
    setPending(true);
    try {
      const res = await fetch("/api/auth/redeem", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password, confirmPassword: confirm }),
      });
      const data = await res.json();
      if (!data.ok) {
        setError(data.message ?? "That did not work.");
        setPending(false);
        return;
      }
      setState({ phase: "done", email: data.email });
    } catch {
      setError("Could not reach the server.");
      setPending(false);
    }
  }

  if (state.phase === "checking")
    return (
      <AuthFrame title="Checking your link" lede="One moment." footer={<span />}>
        <p className="text-sm text-ink-muted">Verifying…</p>
      </AuthFrame>
    );

  if (state.phase === "dead")
    return (
      <AuthFrame
        title="This link is no longer valid"
        lede={state.message}
        footer={<AuthSwitch question="Have an account?" href="/signin" action="Sign in" />}
      >
        <p className="text-sm leading-relaxed text-ink-muted">
          Invitations last seven days and reset links one hour, and each one works
          once. Ask an administrator to issue a new one.
        </p>
      </AuthFrame>
    );

  if (state.phase === "done")
    return (
      <AuthFrame
        title="Password set"
        lede={`You can now sign in as ${state.email}.`}
        footer={<AuthSwitch question="Ready?" href="/signin" action="Go to sign in" />}
      >
        <Link
          href="/signin"
          className="inline-flex items-center justify-center rounded-full bg-ink px-4 py-2 text-[15px] font-medium text-[var(--body-bg)] transition-opacity hover:opacity-90"
        >
          Sign in
        </Link>
      </AuthFrame>
    );

  const inviting = state.purpose === "invite";
  return (
    <AuthFrame
      title={inviting ? `Welcome, ${state.displayName.split(" ")[0]}` : "Choose a new password"}
      lede={
        inviting
          ? `Set a password for ${state.email} and your workspace is ready.`
          : `Setting a new password for ${state.email} signs out every other device.`
      }
      footer={<AuthSwitch question="Remembered it?" href="/signin" action="Sign in instead" />}
    >
      <form onSubmit={submit} noValidate className="flex flex-col gap-4">
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
        <Button type="submit" tone="primary" disabled={!ready || pending} className="mt-1 w-full">
          {pending ? "Setting…" : inviting ? "Set password and continue" : "Set new password"}
        </Button>
      </form>
    </AuthFrame>
  );
}
