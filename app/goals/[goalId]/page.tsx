import { GoalDetail } from "@/components/features/notifications/WorkAreas";

export default async function Page({ params }: { params: Promise<{ goalId: string }> }) {
  const { goalId } = await params;
  return <GoalDetail goalId={goalId} />;
}
