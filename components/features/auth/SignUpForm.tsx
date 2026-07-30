"use client";

import { useState } from "react";
import { AuthFrame, AuthSwitch } from "./AuthFrame";
import { Button, Field, InlineError, Input } from "@/components/ui/Primitives";
import { PASSWORD_MIN_LENGTH } from "@/lib/auth/passwordRule";

/**
 * Create the first administrator, and the organisation with them.
 *
 * Errors land on the field that caused them. The server returns `{ field,
 * message }` for every validation failure precisely so this is possible — a
 * banner saying "check your details" over six inputs makes somebody hunt, and
 * the two most likely failures here (an address already registered, a phone
 * number already registered) are both about one specific field.
 *
 * The client validates too, and does not pretend that is the check: the server
 * rejects the same things independently. This exists to answer before a round
 * trip, not instead of one.
 */

interface Fields {
  fullName: string;
  organisationName: string;
  email: string;
  phone: string;
  password: string;
  confirmPassword: string;
}

const EMPTY: Fields = {
  fullName: "",
  organisationName: "",
  email: "",
  phone: "",
  password: "",
  confirmPassword: "",
};

export function SignUpForm() {
  const [fields, setFields] = useState<Fields>(EMPTY);
  const [fieldError, setFieldError] = useState<{
    field: string;
    message: string;
  } | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const set = (key: keyof Fields) => (v: string) => {
    setFields((f) => ({ ...f, [key]: v }));
    /* Clear the error on the field being corrected, and only that one. Clearing
       everything would wipe a message about a field they have not reached. */
    setFieldError((e) => (e?.field === key ? null : e));
  };

  const errorFor = (key: keyof Fields) =>
    fieldError?.field === key ? fieldError.message : undefined;

  const mismatch =
    fields.confirmPassword.length > 0 &&
    fields.password !== fields.confirmPassword;

  const complete =
    fields.fullName.trim().length >= 2 &&
    fields.organisationName.trim().length >= 2 &&
    fields.email.trim().length > 0 &&
    fields.phone.trim().length > 0 &&
    fields.password.length >= PASSWORD_MIN_LENGTH &&
    !mismatch;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (pending || !complete) return;
    setFieldError(null);
    setFormError(null);
    setPending(true);

    try {
      const res = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(fields),
      });
      const data = (await res.json()) as {
        ok: boolean;
        field?: string;
        message?: string;
        landing?: string;
      };

      if (!data.ok) {
        if (data.field && data.message)
          setFieldError({ field: data.field, message: data.message });
        else
          setFormError(
            data.message ?? "The account could not be created. Try again.",
          );
        setPending(false);
        return;
      }

      /* Signed in already — the endpoint issued the session. Hard navigation
         for the same reason sign-in uses one: the module singletons holding the
         old (anonymous) identity have to go. */
      window.location.href = data.landing ?? "/home";
    } catch {
      setFormError("Could not reach the server. Check your connection.");
      setPending(false);
    }
  }

  return (
    <AuthFrame
      title="Create your organisation"
      lede="The first account is the administrator. You will be able to add people, set reporting lines and configure roles once you are in."
      footer={
        <AuthSwitch
          question="Already have an account?"
          href="/signin"
          action="Sign in"
        />
      }
    >
      <form onSubmit={submit} noValidate className="flex flex-col gap-4">
        {formError && <InlineError message={formError} />}

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Full name" required error={errorFor("fullName")}>
            <Input
              name="name"
              autoComplete="name"
              autoFocus
              value={fields.fullName}
              onChange={(e) => set("fullName")(e.target.value)}
              placeholder="Maya Ferreira"
            />
          </Field>

          <Field
            label="Organisation"
            required
            error={errorFor("organisationName")}
          >
            <Input
              name="organization"
              autoComplete="organization"
              value={fields.organisationName}
              onChange={(e) => set("organisationName")(e.target.value)}
              placeholder="Acme Industries"
            />
          </Field>
        </div>

        <Field label="Work email" required error={errorFor("email")}>
          <Input
            type="email"
            name="email"
            autoComplete="username"
            value={fields.email}
            onChange={(e) => set("email")(e.target.value)}
            placeholder="you@company.com"
          />
        </Field>

        <Field
          label="Phone number"
          required
          error={errorFor("phone")}
          hint="Include the country code."
        >
          <Input
            type="tel"
            name="tel"
            autoComplete="tel"
            value={fields.phone}
            onChange={(e) => set("phone")(e.target.value)}
            placeholder="+44 7700 900123"
          />
        </Field>

        <Field
          label="Password"
          required
          error={errorFor("password")}
          hint={`At least ${PASSWORD_MIN_LENGTH} characters. Length matters more than symbols.`}
        >
          <Input
            type="password"
            name="new-password"
            autoComplete="new-password"
            value={fields.password}
            onChange={(e) => set("password")(e.target.value)}
            placeholder="A passphrase you will remember"
          />
        </Field>

        <Field
          label="Confirm password"
          required
          error={
            mismatch
              ? "The two passwords do not match."
              : errorFor("confirmPassword")
          }
        >
          <Input
            type="password"
            name="confirm-password"
            autoComplete="new-password"
            value={fields.confirmPassword}
            onChange={(e) => set("confirmPassword")(e.target.value)}
            placeholder="Type it again"
          />
        </Field>

        <Button
          type="submit"
          tone="primary"
          disabled={pending || !complete}
          className="mt-1 w-full"
        >
          {pending ? "Creating your organisation…" : "Create administrator account"}
        </Button>

        <p className="text-[11px] leading-relaxed text-ink-faint">
          Creating an account sets you up as the administrator of a new
          organisation. Everyone you add afterwards joins it with the role you
          give them.
        </p>
      </form>
    </AuthFrame>
  );
}
