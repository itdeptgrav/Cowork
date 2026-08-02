import { GuestMeetingArea } from "@/components/features/meetings/GuestMeetingArea";

export const dynamic = "force-dynamic";

export default async function Page({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  return <GuestMeetingArea shareToken={token} />;
}
