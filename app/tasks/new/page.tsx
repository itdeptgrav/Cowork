import { NewTaskForm } from "@/components/features/tasks/NewTaskForm";

export const metadata = { title: "New task — Cowork" };

/**
 * `?parent=<taskId>` breaks work out of that task instead of raising a new one.
 *
 * One route and one form for both, because a subtask IS a task — it negotiates
 * a budget, holds a priority, is submitted and reviewed. See `NewTaskForm`'s
 * `presetParentTaskId`. `?project=` does the same job for a project, and the
 * two are independent.
 */
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ parent?: string; project?: string }>;
}) {
  const { parent, project } = await searchParams;
  return <NewTaskForm presetParentTaskId={parent} presetProjectId={project} />;
}
