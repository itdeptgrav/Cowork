"use client";

import type { ReactNode } from "react";
import { PermissionDenied, SkeletonRows } from "@/components/ui/Primitives";
import { usePermissions } from "@/lib/hooks/usePermissions";

/**
 * The CAPABILITY half of the administration guard.
 *
 * The gate is "holds at least one administrative capability", not a role name.
 * An organisation that renames System Administrator, or splits it into two
 * roles, keeps working — which is the whole point of roles being data.
 *
 * It is the second of three layers and the only one a determined person can
 * defeat, which is fine because it is not the one holding the line:
 *
 *   1. `app/admin/layout.tsx` refuses the ROUTE on the server, from the session
 *      archetype, before any of this renders. Unbypassable from the browser.
 *   2. This, which is finer-grained and honest about *why* — a person with a
 *      session but without the capability gets an explanation, not a redirect.
 *   3. The repository, which checks every write again regardless.
 *
 * Deleting this component would make the screens visible to somebody who got
 * past layer 1 and still leave every button refused by layer 3.
 */
export function AdminCapabilityGuard({ children }: { children: ReactNode }) {
  const perms = usePermissions();

  if (!perms.ready) return <SkeletonRows rows={6} />;

  const mayAdminister =
    perms.can("people.change_role") ||
    perms.can("people.change_reporting") ||
    perms.can("integration.configure") ||
    perms.can("score.configure");

  if (!mayAdminister) {
    return (
      <PermissionDenied
        what="administration"
        reason="These screens configure roles, reporting lines and approval workflows. They need an administrative capability, which your roles do not include."
      />
    );
  }

  return <>{children}</>;
}
