"use client";

import { useSession } from "./SessionProvider";
import { Icon } from "@/components/ui/Icons";

/**
 * Sign out.
 *
 * An icon in the bar rather than a row inside the profile page: a person who
 * wants out of a shared machine should not have to navigate two screens deep to
 * do it, and hiding sign-out is how people leave sessions open.
 *
 * `signOut` posts to the endpoint — which revokes the server-side session
 * record, not just the cookie — and then hard-navigates, which is what clears
 * the module singletons still holding the previous identity.
 */
export function SignOutButton() {
  const session = useSession();
  if (session.status !== "authenticated") return null;

  return (
    <button
      type="button"
      onClick={() => void session.signOut()}
      aria-label={`Sign out${session.displayName ? ` — ${session.displayName}` : ""}`}
      title="Sign out"
      className="hidden h-8 w-8 place-items-center rounded-full text-ink-muted transition-colors duration-[180ms] hover:bg-[var(--surface-sunken)] hover:text-ink sm:grid"
    >
      <Icon.external className="h-4 w-4" />
    </button>
  );
}
