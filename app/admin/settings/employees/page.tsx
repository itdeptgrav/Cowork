import { AddFromHrPanel } from "@/components/features/admin/AddFromHrPanel";
import { IconTabs, WorkspaceHead } from "@/components/ui/Workspace";
import { ADMIN_TABS } from "@/components/features/admin/adminTabs";
import { SettingsSubNav } from "@/components/features/admin/SettingsShell";
import { Panel } from "@/components/ui/Primitives";

export const metadata = { title: "Add employees — Cowork admin" };

export default function Page() {
  return (
    <>
      <WorkspaceHead
        title="Add employees"
        count="Import from HR"
        tabs={<IconTabs items={ADMIN_TABS} active="settings" />}
      />

      <SettingsSubNav active={null} />

      <Panel className="mb-4">
        <p className="max-w-[74ch] text-sm leading-relaxed text-ink-muted">
          Employees are fetched from the HR system. Select the ones who need a
          CoWork account — the system creates their Firebase login, assigns a
          temporary password, and sends them a welcome email. Their biometric ID
          (if set in HR) becomes their CoWork employee ID.
        </p>
      </Panel>

      <AddFromHrPanel />
    </>
  );
}
