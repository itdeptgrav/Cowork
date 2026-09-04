"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { LEGACY_LANDING } from "@/lib/auth/roleMap";
import { signIn, signInWithToken } from "@/lib/legacy/firebase";
import { writeFirebaseCookie } from "@/lib/auth/firebaseCookie";
import { clearSignInNotice, readSignInNotice } from "@/lib/auth/sessionCache";
import { redeemQrCode } from "@/lib/auth/recoveryApi";
import { useSearchParams } from "next/navigation";
import { AuthFrame, AuthSwitch } from "./AuthFrame";
import { Button, Field, InlineError, Input } from "@/components/ui/Primitives";
import { PasswordInput } from "@/components/ui/PasswordInput";
import { QrSignInScanner } from "./QrSignInScanner";

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
 *
 * ## Three ways in, one landing
 *
 * A password, a scanned code, and the `?qr=` link a phone's own camera app
 * opens. All three converge on `finishSignIn` — one cookie write, one hard
 * navigation, one `next` validation. That convergence is the point: a second
 * path that forgot the cookie mirror would authenticate correctly and then be
 * bounced straight back here by the middleware, which is a bug that looks like
 * a button doing nothing.
 */
export function SignInForm() {
  const params = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  /** Whether the viewfinder is up in place of the password fields. */
  const [scanning, setScanning] = useState(false);
  /** True while a scanned code is being exchanged for a session. */
  const [redeeming, setRedeeming] = useState(false);

  /**
   * Why you were sent back here, if you were.
   *
   * **The silent bounce.** Signing in with a correct password for an account the
   * workspace does not recognise as an employee authenticates fine, resolves,
   * finds no employee, and returns you to this form — historically with nothing
   * said, which is indistinguishable from a button that did nothing. The session
   * that gave up leaves the sentence behind (`leaveSignInNotice`), and this is
   * where it is read.
   *
   * Read during render, cleared in an effect: reading is repeatable, removing is
   * not, and doing both in one place would make the message vanish on React's
   * second development render. It is dropped as soon as it has been shown, so it
   * belongs to this bounce rather than to the page.
   */
  const [bounced] = useState(readSignInNotice);
  useEffect(clearSignInNotice, []);

  /**
   * Establish the session and leave. Shared by all three routes in.
   *
   * The cookie is mirrored HERE, before navigating. `SessionProvider` normally
   * does this, but on the sign-in page it is mounted with `anonymous` and
   * returns without resolving anything — it must not, since it would be
   * resolving a session this page exists to create. So nothing else writes the
   * cookie on this route, and the hard navigation below would otherwise reach
   * middleware with no credential and bounce straight back here.
   *
   * A hard navigation rather than `router.push`: the workspace's identity lives
   * in module singletons created before this session existed, and a client
   * transition would carry them across.
   */
  async function finishSignIn(user: { getIdToken: () => Promise<string> }) {
    writeFirebaseCookie(await user.getIdToken());
    window.location.href = safeNext(params.get("next")) ?? LEGACY_LANDING;
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (pending) return;
    setError(null);
    setPending(true);
    try {
      /* Firebase is the identity now. Same form, same markup, same copy —
         only where the credentials go has changed. */
      await finishSignIn(await signIn(email.trim(), password));
    } catch (e) {
      setError(signInMessage(e));
      setPending(false);
    }
  }

  /**
   * Spend a scanned code.
   *
   * Guarded on `redeeming` because the scan loop can hand over the same code
   * twice before the first exchange returns — and the code is single-use, so the
   * second attempt would come back "already used" and replace a successful
   * sign-in with an error on screen.
   */
  async function useScannedCode(token: string) {
    if (redeeming) return;
    setRedeeming(true);
    setError(null);

    const result = await redeemQrCode(token);
    if (!result.success || !result.token) {
      setError(result.message ?? "That code did not work.");
      setRedeeming(false);
      return;
    }

    try {
      /* The same custom-token exchange `/sso` performs for the CMS handoff. */
      await finishSignIn(await signInWithToken(result.token));
    } catch {
      setError("That code could not be used to sign in. Try a fresh one.");
      setRedeeming(false);
    }
  }

  /**
   * A code scanned by the phone's OWN camera app, which opens
   * `/signin?qr=<token>` rather than handing anything to our scanner.
   *
   * Runs once on mount, against the token the route was loaded with — the same
   * shape and the same reasoning as `SsoConsumer`: a single-use credential gets
   * one attempt, and a stale one needs a fresh code rather than a retry.
   *
   * The parameter is stripped from the address bar first. Left there, a reload
   * or a shared URL would replay a spent code and answer "already used" to
   * somebody who had done nothing wrong — and the token would sit in history.
   */
  useEffect(() => {
    const token = params.get("qr");
    if (!token) return;

    window.history.replaceState(null, "", window.location.pathname);
    void useScannedCode(token);
    // Once, for the token this page was opened with.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const footer = (
    <AuthSwitch
      question="Setting up a new organisation?"
      href="/signup"
      action="Create an administrator account"
    />
  );

  /* ── Scanning ───────────────────────────────────────────────────────────── */

  if (scanning) {
    return (
      <AuthFrame
        title="Scan to sign in"
        lede="Point this camera at the code on a device you are already signed in to."
        footer={footer}
      >
        <QrSignInScanner
          onScan={(token) => void useScannedCode(token)}
          onCancel={() => {
            setScanning(false);
            setError(null);
          }}
          busy={redeeming}
          error={error}
        />
      </AuthFrame>
    );
  }

  /* ── Password ───────────────────────────────────────────────────────────── */

  return (
    <AuthFrame
      title="Sign in"
      lede="Your workspace, and the record of what it measured."
      footer={footer}
    >
      <form onSubmit={submit} noValidate className="flex flex-col gap-4">
        {/* A fresh failure outranks the reason you arrived with: once you have
            pressed the button, what just happened is the thing to read. */}
        {(error ?? bounced) && <InlineError message={(error ?? bounced)!} />}

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
          <PasswordInput
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
          disabled={pending || redeeming || !email || !password}
          loading={pending || redeeming}
          className="mt-1 w-full"
        >
          {redeeming ? "Signing in…" : pending ? "Signing in…" : "Sign in"}
        </Button>

        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 text-sm">
          {/* The address already typed is carried over, so somebody who got as
              far as their password does not retype it on the next screen. */}
          <Link
            href={
              email.trim()
                ? `/forgot-password?email=${encodeURIComponent(email.trim())}`
                : "/forgot-password"
            }
            className="text-ink-muted underline decoration-hairline underline-offset-4 transition-colors hover:text-ink"
          >
            Forgot your password?
          </Link>

          {/* A text button rather than a camera icon: this opens a camera, and
              a bare icon on a sign-in form is the kind of thing people decline
              to press because they cannot tell what it will do. */}
          <button
            type="button"
            onClick={() => {
              setScanning(true);
              setError(null);
            }}
            className="text-ink-muted underline decoration-hairline underline-offset-4 transition-colors hover:text-ink"
          >
            Sign in by scanning a code
          </button>
        </div>
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
