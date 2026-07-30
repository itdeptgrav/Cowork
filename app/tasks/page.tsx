import { Suspense } from "react";
import { TasksArea } from "@/components/features/tasks/TasksArea";
import { SkeletonRows } from "@/components/ui/Primitives";

export const metadata = { title: "Tasks — Cowork" };

export default function TasksPage() {
  return (
    <Suspense fallback={<SkeletonRows rows={8} />}>
      <TasksArea />
    </Suspense>
  );
}
