import { ShareInviteAccept } from "@/components/features/workspace/guest/ShareInviteAccept";

export const dynamic = "force-dynamic";

export default async function Page({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  return <ShareInviteAccept inviteToken={token} />;
}
