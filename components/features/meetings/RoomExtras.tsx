"use client";

import { useState } from "react";
import { ConnectionBanner } from "./ConnectionBanner";
import { MeetingChat, useChatUnread } from "./MeetingChat";
import type { SidePanelTab } from "./MeetingControlBar";
import { DirectoryRoster, ParticipantRoster } from "./ParticipantRoster";
import { ReactionOverlay } from "./RoomSignals";
import { RoomShortcuts } from "./RoomShortcuts";

/**
 * The in-call features that are the same in every room, as pieces each room
 * places itself.
 *
 * ## Why pieces and not one component
 *
 * The three rooms genuinely differ in layout. The scheduled room has a
 * transcript rail; the guest room is a full-viewport column sized in `dvh`
 * because a phone's address bar moves; the floating window is 340px wide. A
 * single component that rendered the overlays, the toolbar and the panel in one
 * place would have to know all three layouts, which is how it would end up with
 * a mode flag and two of the three subtly wrong.
 *
 * So this exports the parts, and each room decides where they go. What is
 * shared is the behaviour, which is the part that was drifting.
 *
 * ## Why the guest room gets these at all
 *
 * `GuestMeetingArea` is a second implementation of the room — deliberately, in
 * part: it has no tile menu, and it never reads the employee directory, so its
 * stage stays its own. But chat, a raised hand, a reaction, knowing you are
 * reconnecting and knowing who else is here are not workspace features. A guest
 * is usually the person with the least context in the meeting, and was the one
 * given the least to work with.
 */

/** Panel state and the unread count, which has to be tracked while closed. */
export function useRoomExtras() {
  const [panel, setPanel] = useState<SidePanelTab>(null);
  const unreadChat = useChatUnread(panel === "chat");
  return { panel, setPanel, unreadChat };
}

/**
 * Everything that floats over the stage.
 *
 * Must be rendered inside a `position: relative` container that wraps the
 * grid — each of these is absolutely positioned against the stage, and against
 * the page they would sit over the wrong thing.
 */
export function RoomOverlays() {
  return (
    <>
      <ConnectionBanner />
      <ReactionOverlay />
      <RoomShortcuts />
    </>
  );
}

/**
 * The chat / people panel.
 *
 * `withDirectory` decides which roster is used, and it is a hard split rather
 * than a fallback: reading the employee directory is a request a guest is not
 * entitled to make, so the guest renders a roster that never asks.
 */
export function RoomSidePanel({
  panel,
  onClose,
  isHost,
  withDirectory,
}: {
  panel: SidePanelTab;
  onClose: () => void;
  isHost: boolean;
  withDirectory: boolean;
}) {
  if (panel === null) return null;

  return (
    <div className="flex w-full shrink-0 flex-col border-t border-white/10 bg-black/30 md:h-auto md:w-[300px] md:border-l md:border-t-0">
      <div className="flex shrink-0 items-center justify-between border-b border-white/10 px-3 py-2">
        <h2 className="text-[12px] font-semibold uppercase tracking-wide text-white/70">
          {panel === "chat" ? "Chat" : "People"}
        </h2>
        <button
          type="button"
          onClick={onClose}
          aria-label={`Close ${panel === "chat" ? "chat" : "people"}`}
          className="rounded-md px-1.5 py-0.5 text-[16px] leading-none text-white/60 transition-colors hover:bg-white/10 hover:text-white"
        >
          ×
        </button>
      </div>
      <div className="min-h-0 flex-1">
        {panel === "chat" ? (
          <MeetingChat />
        ) : withDirectory ? (
          <DirectoryRoster isHost={isHost} />
        ) : (
          <ParticipantRoster isHost={isHost} />
        )}
      </div>
    </div>
  );
}
