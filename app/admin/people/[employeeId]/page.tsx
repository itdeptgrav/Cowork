import { EmployeeProfile } from "@/components/features/admin/EmployeeProfile";

export const metadata = { title: "Employee — Cowork" };

/**
 * Admin Settings → People → an employee.
 *
 * Nested under `app/admin`, so it inherits that layout's SERVER gate — the
 * session is resolved and the archetype checked before this renders. No gate is
 * repeated here; adding a second one would invite the belief that the route is
 * self-protecting when it is the layout doing the work.
 */
export default async function Page({
  params,
}: {
  params: Promise<{ employeeId: string }>;
}) {
  const { employeeId } = await params;
  return <EmployeeProfile employeeId={employeeId} />;
}
