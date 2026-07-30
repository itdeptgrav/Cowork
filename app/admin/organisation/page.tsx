import { redirect } from "next/navigation";

/**
 * `/admin/organisation` → `/admin/settings/organisation`.
 *
 * `OrgEditor` offered controls for departments, heads of department and reporting
 * lines. All five write methods behind them — `createDepartment`,
 * `updateDepartment`, `setReportingManager`, `setEmployeeDepartment`,
 * `listReporting` — are absent from `LegacyRepository`, so every one of those
 * controls threw on save against the real engine.
 *
 * The section this points at reads the same records from the methods that ARE
 * wired, and states where each one is edited instead of pretending to edit it. See
 * `OrganisationSection` for why read-only is the decision rather than the
 * shortfall.
 */
export default function Page() {
  redirect("/admin/settings/organisation");
}
