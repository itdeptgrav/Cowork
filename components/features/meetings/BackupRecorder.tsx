"use client";

import { useBackupRecording } from "@/lib/legacy-ui/useBackupRecording";

/**
 * Mounts the host's backup capture inside the room's LiveKit context.
 *
 * A component rather than a hook call in `MeetingRoom` because
 * `useBackupRecording` needs `useRoomContext`, and `MeetingRoom` renders
 * `LiveKitRoom` — it is outside its own room's provider. Renders nothing.
 */
export function BackupRecorder({
  meetId,
  isHost,
  enabled,
}: {
  meetId: string;
  isHost: boolean;
  enabled: boolean;
}) {
  useBackupRecording({ meetId, isHost, enabled });
  return null;
}
