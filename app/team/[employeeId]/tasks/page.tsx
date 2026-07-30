import { PersonPage } from "@/components/features/team/TeamArea";

export default async function Page({ params }: { params: Promise<{ employeeId: string }> }) {
  const { employeeId } = await params;
  return <PersonPage employeeId={employeeId} tab="tasks" />;
}
