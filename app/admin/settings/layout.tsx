import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { adminConsoleAccess } from "@/lib/server/adminAuth";

/**
 * The settings gate, checked again here.
 *
 * `app/admin/layout.tsx` already refuses anybody who is not `system_admin`, so on
 * today's predicates this cannot refuse anything that got past it. It exists
 * anyway, for one reason: **`canAccessAdminConsole` and `canModifySettings` are
 * separate questions and will not always agree.** A read-only auditor is the
 * obvious next archetype — somebody who should see the console and the audit log
 * and change nothing — and the moment that exists, this layout is the difference
 * between them reading the settings and editing them.
 *
 * Splitting a shared guard at the moment a new role appears is exactly when the
 * mistake gets made. It is cheaper to have the seam now, while it is provably
 * equivalent, than to add it under pressure later.
 *
 * `mayModifySettings` rather than `mayOpenConsole`: this subtree contains editors.
 */
export default async function SettingsLayout({
  children,
}: {
  children: ReactNode;
}) {
  const { identity, mayModifySettings } = await adminConsoleAccess();

  if (!identity) redirect("/signin?next=/admin/settings");
  if (!mayModifySettings) redirect("/admin?denied=settings");

  return <>{children}</>;
}
