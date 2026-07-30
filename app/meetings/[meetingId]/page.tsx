import { MeetingDetailArea } from "@/components/features/meetings/MeetingDetailArea";

export default async function Page({
  params,
}: {
  params: Promise<{ meetingId: string }>;
}) {
  const { meetingId } = await params;
  return <MeetingDetailArea meetingId={meetingId} />;
}
