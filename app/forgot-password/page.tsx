import { Suspense } from "react";
import { ForgotPasswordForm } from "@/components/features/auth/ForgotPasswordForm";

export const metadata = { title: "Reset your password — Cowork" };

/**
 * `useSearchParams` needs a Suspense boundary or the whole route opts out of
 * static rendering with a build-time warning. The fallback matches /signin's:
 * the bare frame's background rather than a spinner, because a flash of
 * "loading" in front of a credentials form reads as breakage.
 */
export default function Page() {
  return (
    <Suspense fallback={<div className="min-h-dvh" />}>
      <ForgotPasswordForm />
    </Suspense>
  );
}
