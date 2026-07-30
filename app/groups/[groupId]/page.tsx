import { GroupDetail } from "@/components/features/messages/CollabAreas";

export default async function Page({ params }: { params: Promise<{ groupId: string }> }) {
  const { groupId } = await params;
  return <GroupDetail groupId={groupId} />;
}
