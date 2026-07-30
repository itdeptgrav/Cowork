import { JoinPage } from "@/components/features/messages/CollabAreas";

export default async function Page({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <JoinPage token={token} />;
}
