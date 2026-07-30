"use client";

import { useState } from "react";
import { LEGACY_LANDING } from "@/lib/auth/roleMap";
import { signIn } from "@/lib/legacy/firebase";
import { writeFirebaseCookie } from "@/lib/auth/firebaseCookie";
import { useSearchParams } from "next/navigation";
import { AuthFrame, AuthSwitch } from "./AuthFrame";
import { Button, Field, InlineError, Input } from "@/components/ui/Primitives";

/**
 * Sign in.
 *
 * The form is deliberately unhelpful about *why* a sign-in failed, and the
 * server is the reason: it returns one message for an unknown address, a wrong
 * password and a suspended account alike. Splitting them would tell somebody
 * working through a breach list which addresses are registered, and a form that
 * softened the wording would undo the endpoint's care.
 *
 * `next` is carried from the middleware redirect so signing in resumes where
 * somebody was going. It is validated before use — see `safeNext`.
 */
export function SignInForm() {
  const params = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (pending) return;
    setError(null);
    setPending(true);
    try {
      /* Firebase is the identity now. Same form, same markup, same copy —
         only where the credentials go has changed. */
      const user = await signIn(email.trim(), password);

      /* Mirror the token into the cookie HERE, before navigating.
         `SessionProvider` normally does this, but on the sign-in page it is
         mounted with `anonymous` and returns without resolving anything — it
         must not, since it would be resolving a session this page exists to
         create. So nothing else writes the cookie on this route, and the hard
         navigation below would reach middleware with no credential and bounce
         straight back here. */
      writeFirebaseCookie(await user.getIdToken());

      /* A hard navigation rather than `router.push`. The workspace's identity
         lives in module singletons that were created before this session
         existed; a client transition would carry them across. */
      window.location.href = safeNext(params.get("next")) ?? LEGACY_LANDING;
    } catch (e) {
      setError(signInMessage(e));
      setPending(false);
    }
  }

  return (
    <AuthFrame
      title="Sign in"
      lede="Your workspace, and the record of what it measured."
      footer={
        <AuthSwitch
          question="Setting up a new organisation?"
          href="/signup"
          action="Create an administrator account"
        />
      }
    >
      <form onSubmit={submit} noValidate className="flex flex-col gap-4">
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

        <Field label="Password">
          <Input
            type="password"
            name="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Your password"
          />
        </Field>

        <Button
          type="submit"
          tone="primary"
          disabled={pending || !email || !password}
          className="mt-1 w-full"
        >
          {pending ? "Signing in…" : "Sign in"}
        </Button>
      </form>
    </AuthFrame>
  );
}

/**
 * Only same-origin paths survive.
 *
 * `next` arrives in a query string, which means anybody can put anything in it.
 * Without this check, a link to
 * `/signin?next=https://evil.example/looks-like-cowork` would sign somebody in
 * and then hand them to an attacker's page with the product's own redirect as
 * the referrer — a textbook open redirect, and a convincing one because the
 * first half of the journey is genuine.
 *
 * Must start with a single `/` and not `//`, which browsers read as a
 * protocol-relative absolute URL.
 */
function safeNext(raw: string | null): string | null {
  if (!raw) return null;
  if (!raw.startsWith("/") || raw.startsWith("//")) return null;
  return raw;
}

/**
 * Firebase error codes, in words somebody signing in can act on.
 *
 * The SDK's own messages read like `Firebase: Error (auth/invalid-credential).`
 * — precise and useless. These distinguish "wrong password" from "no such
 * account in this project", which point at very different problems while a
 * migration is in progress, and mention the mobile-number default because that
 * is what a legacy Cowork account starts with.
 */
function signInMessage(e: unknown): string {
  const code =
    typeof e === "object" && e !== null && "code" in e
      ? String((e as { code: unknown }).code)
      : "";

  switch (code) {
    case "auth/invalid-email":
      return "That does not look like an email address.";
    case "auth/user-not-found":
      return "No Cowork account exists with that email.";
    case "auth/wrong-password":
    case "auth/invalid-credential":
      return "Those details do not match an account. If you have not signed in before, your password may still be your mobile number.";
    case "auth/user-disabled":
      return "That account has been disabled. Ask your CEO.";
    case "auth/too-many-requests":
      return "Too many attempts. Try again in a few minutes.";
    case "auth/network-request-failed":
      return "Could not reach the server. Check your connection.";
    default:
      return "Could not sign you in. Try again.";
  }
}
