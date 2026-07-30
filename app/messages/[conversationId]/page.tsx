import { MessagesPage } from "@/components/features/messages/MessagesArea";

export default async function Page({ params }: { params: Promise<{ conversationId: string }> }) {
  const { conversationId } = await params;
  return <MessagesPage conversationId={conversationId} />;
}
