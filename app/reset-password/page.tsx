import { Suspense } from "react";
import { ResetPasswordForm } from "@/components/features/auth/ResetPasswordForm";

export const metadata = { title: "Set your password — Cowork" };

export default function Page() {
  return (
    <Suspense fallback={<div className="min-h-dvh" />}>
      <ResetPasswordForm />
    </Suspense>
  );
}
