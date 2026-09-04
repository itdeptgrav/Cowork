import { MessagesPage } from "@/components/features/messages/MessagesArea";

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ conversationId: string }>;
  /* `?m=` names a message a global-search result asked to open at. Read on the
     server and passed as a prop, the same way `?closed=1` is on the list page,
     so MessagesArea needs no `useSearchParams` (and no Suspense boundary). */
  searchParams: Promise<{ m?: string }>;
}) {
  const { conversationId } = await params;
  const { m } = await searchParams;
  return <MessagesPage conversationId={conversationId} jumpToMessageId={m} />;
}
