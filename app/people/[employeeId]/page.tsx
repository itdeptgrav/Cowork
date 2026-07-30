import { PersonProfile } from "@/components/features/team/TeamArea";

export default async function Page({ params }: { params: Promise<{ employeeId: string }> }) {
  const { employeeId } = await params;
  return <PersonProfile employeeId={employeeId} />;
}
