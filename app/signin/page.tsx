import { Suspense } from "react";
import { SignInForm } from "@/components/features/auth/SignInForm";

export const metadata = { title: "Sign in — Cowork" };

/**
 * `useSearchParams` needs a Suspense boundary or the whole route opts out of
 * static rendering with a build-time warning. The fallback is deliberately the
 * bare frame's background rather than a spinner: this page renders in a few
 * milliseconds and a flash of "loading" before a login form reads as breakage.
 */
export default function Page() {
  return (
    <Suspense fallback={<div className="min-h-dvh" />}>
      <SignInForm />
    </Suspense>
  );
}
