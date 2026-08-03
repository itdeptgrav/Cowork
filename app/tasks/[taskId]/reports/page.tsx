import { TaskDetail } from "@/components/features/tasks/TaskDetail";

export default async function Page({ params }: { params: Promise<{ taskId: string }> }) {
  const { taskId } = await params;
  return <TaskDetail taskId={taskId} tab="reports" />;
}
