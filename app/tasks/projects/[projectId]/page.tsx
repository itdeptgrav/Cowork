import { ProjectDetail } from "@/components/features/projects/ProjectDetail";

export default async function Page({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  return <ProjectDetail projectId={projectId} />;
}
