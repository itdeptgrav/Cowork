import { Suspense } from "react";
import { SsoConsumer } from "@/components/features/auth/SsoConsumer";

export const metadata = { title: "Signing in — Cowork" };

/**
 * `useSearchParams` needs a Suspense boundary — same reasoning as
 * app/signin/page.tsx, whose fallback comment this mirrors.
 */
export default function Page() {
  return (
    <Suspense fallback={<div className="min-h-dvh" />}>
      <SsoConsumer />
    </Suspense>
  );
}
