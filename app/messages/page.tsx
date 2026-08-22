import { MessagesPage } from "@/components/features/messages/MessagesArea";
export const metadata = { title: "Messages — Cowork" };

/**
 * `?closed=1` means the reader left a thread rather than never opening one.
 *
 * Read here rather than with `useSearchParams` for the same reason
 * `[conversationId]` is: this is a server component, the value is already in
 * the request, and reading it as a prop keeps `MessagesPage` free of a client
 * hook that would need its own Suspense boundary.
 */
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ closed?: string }>;
}) {
  const { closed } = await searchParams;
  return <MessagesPage closed={closed === "1"} />;
}
