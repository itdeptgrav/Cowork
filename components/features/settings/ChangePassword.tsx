"use client";

/**
 * Change your own password, from Settings.
 *
 * Until this existed there was no way for anybody to change their password at
 * all. `changePassword` had been written in the adapter and nothing called it;
 * the only route to a new password was to ask an administrator to reset one,
 * which signs you out of every device and hands your password to somebody else
 * on the way. That is a fine recovery path and a poor routine one.
 *
 * ## Where the checking actually happens
 *
 * Three places, deliberately, each doing something the others cannot:
 *
 *  1. `passwordChangeProblems` — shape. Length, confirmation, reuse. Pure and
 *     instant, so nobody waits on the network to be told they typed two
 *     different things.
 *  2. `reauthenticate` — Firebase confirms the CURRENT password. This is what
 *     makes an open unattended tab insufficient authority to lock its owner out
 *     of their own account.
 *  3. `POST /cowork/change-password` — the engine verifies the current password
 *     again and performs the change. This is the security boundary; the two
 *     above are courtesy. Anything the browser checks, the browser can skip.
 *
 * Step 2 is not redundant with step 3. It answers the wrong-password case
 * against Firebase directly, in one round trip instead of two, and it means a
 * mistyped password never reaches our own server at all.
 */

import { useState } from "react";
import { Button, Field, Input, Panel } from "@/components/ui/Primitives";
import { changePassword } from "@/lib/legacy/auth";
import { idToken, reauthenticate } from "@/lib/legacy/firebase";
import {
  canSubmitPasswordChange,
  passwordChangeProblems,
  problemFor,
} from "@/lib/rules/auth/passwordChange";

/** What the form is doing, which is also what it is allowed to do next. */
type Phase =
  | { kind: "editing" }
  | { kind: "saving" }
  | { kind: "saved" }
  | { kind: "failed"; message: string };

const EMPTY = { current: "", next: "", confirm: "" };

export function ChangePassword() {
  const [form, setForm] = useState(EMPTY);
  const [phase, setPhase] = useState<Phase>({ kind: "editing" });
  /* Problems stay hidden until the first submit. Marking a field red while
     somebody is still typing their first six characters is scolding them for
     not having finished. */
  const [showProblems, setShowProblems] = useState(false);

  const problems = passwordChangeProblems(form);
  const saving = phase.kind === "saving";

  function edit(field: keyof typeof EMPTY, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }));
    /* Any edit retracts a finished outcome: a green "Password changed" sitting
       above a half-typed form describes a state that is no longer true. */
    if (phase.kind !== "editing" && phase.kind !== "saving")
      setPhase({ kind: "editing" });
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setShowProblems(true);
    if (!canSubmitPasswordChange(form) || saving) return;

    setPhase({ kind: "saving" });

    const proof = await reauthenticate(form.current);
    if (!proof.ok) {
      setPhase({ kind: "failed", message: reauthMessage(proof.reason) });
      return;
    }

    const token = await idToken();
    if (!token) {
      setPhase({
        kind: "failed",
        message: "Your session has expired. Sign in again and retry.",
      });
      return;
    }

    const result = await changePassword({
      token,
      currentPassword: form.current,
      newPassword: form.next,
    });

    if (!result.ok) {
      setPhase({ kind: "failed", message: result.error.message });
      return;
    }

    /* Cleared on success, not left filled. The new password should not stay
       sitting in three inputs on a screen somebody walks away from. */
    setForm(EMPTY);
    setShowProblems(false);
    setPhase({ kind: "saved" });
  }

  return (
    <Panel>
      <h2 className="text-sm font-medium text-ink">Password</h2>
      <p className="mt-2 text-sm text-ink-muted">
        Choose your own password. You will need your current one — nobody,
        administrators included, can read an existing password back.
      </p>

      <form onSubmit={submit} className="mt-3 space-y-3 border-t border-hairline pt-3">
        <Field
          label="Current password"
          error={showProblems ? problemFor(problems, "current") : null}
        >
          <Input
            type="password"
            autoComplete="current-password"
            value={form.current}
            disabled={saving}
            onChange={(e) => edit("current", e.target.value)}
          />
        </Field>

        <Field
          label="New password"
          hint="At least 6 characters."
          error={showProblems ? problemFor(problems, "next") : null}
        >
          <Input
            type="password"
            autoComplete="new-password"
            value={form.next}
            disabled={saving}
            onChange={(e) => edit("next", e.target.value)}
          />
        </Field>

        <Field
          label="Confirm new password"
          /* This one speaks before submit: a mismatch is knowable the moment
             both boxes have content, and finding out at submit time means
             retyping something they believed they had already got right. */
          error={problemFor(problems, "confirm")}
        >
          <Input
            type="password"
            autoComplete="new-password"
            value={form.confirm}
            disabled={saving}
            onChange={(e) => edit("confirm", e.target.value)}
          />
        </Field>

        <div className="flex items-center gap-3">
          <Button type="submit" tone="primary" size="sm" disabled={saving}>
            {saving ? "Changing…" : "Change password"}
          </Button>

          {phase.kind === "saved" && (
            <span
              role="status"
              className="text-xs text-[var(--state-positive-ink)]"
            >
              Password changed.
            </span>
          )}
          {phase.kind === "failed" && (
            <span
              role="alert"
              className="text-xs text-[var(--state-overdue-ink)]"
            >
              {phase.message}
            </span>
          )}
        </div>
      </form>
    </Panel>
  );
}

/**
 * Firebase's reason for refusing, in words that say what to do about it.
 *
 * `no-session` is its own case rather than a generic failure because it has a
 * real cause: a session started from the CMS handoff holds a custom token and
 * has no password to re-check. Telling that person "wrong password" would be
 * false — they have not got one here to be wrong about.
 */
function reauthMessage(reason: string): string {
  switch (reason) {
    case "wrong-password":
      return "That is not your current password.";
    case "too-many-attempts":
      return "Too many attempts. Wait a few minutes and try again.";
    case "no-session":
      return "This session cannot change a password. Sign in with your email address and password, then try again.";
    default:
      return "Your password could not be checked just now. Try again in a moment.";
  }
}
