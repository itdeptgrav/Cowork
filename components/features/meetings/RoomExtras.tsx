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
  meetId,
  guestSessionId,
}: {
  panel: SidePanelTab;
  onClose: () => void;
  isHost: boolean;
  withDirectory: boolean;
  /** The meeting this room belongs to, so chat can save and read history. A
      task room's `meet-task-…` name is fine — the ledger refuses it and chat
      stays live-only. */
  meetId?: string;
  /** Present in the guest room only: reaches the chat ledger through the
      guest-session routes rather than a signed-in token. */
  guestSessionId?: string;
}) {
  if (panel === null) return null;

  return (
    /**
     * **Over the stage on a narrow room, beside it on a wide one — and it is
     * the ROOM's width that decides, through the `@container` root each room
     * mounts around its stage row.**
     *
     * This used to be a viewport rule (`md:`), which put the 340px corner
     * window on a desktop screen into the side-by-side layout: a 340px panel
     * beside a 340px window, off the frame's edge, clipped by its
     * `overflow-hidden`. Pressing Chat drew nothing, and the stage shrank to
     * make room for a panel nobody could see. A docked room on a phone had the
     * same fault for the same reason.
     *
     * Below 40rem of room width the panel lays itself over the stage — the
     * whole stage, not a strip under it, because a 416px room on a phone split
     * two ways leaves a chat with three lines and a composer. The control bar
     * stays out from under it (it is outside this row), so the microphone and
     * Leave are never covered; the × brings the picture back. From 40rem the
     * panel is the 340px column it always was.
     *
     * A touch wider than the roster needs, so a shared file's card is readable
     * rather than clipped. `min-w-0` so the declared width is the width it
     * gets: as a flex item it defaults to `min-width: auto`, which lets a wide
     * child — a file card, a composer that will not shrink — push it past
     * 340px and over the stage beside it.
     */
    <div className="absolute inset-0 z-20 flex w-full min-w-0 shrink-0 flex-col overflow-hidden bg-neutral-950/92 backdrop-blur-sm @min-[40rem]:static @min-[40rem]:inset-auto @min-[40rem]:z-auto @min-[40rem]:h-auto @min-[40rem]:w-[340px] @min-[40rem]:border-l @min-[40rem]:border-white/10 @min-[40rem]:bg-black/30 @min-[40rem]:backdrop-blur-none">
      <div className="flex shrink-0 items-center justify-between border-b border-white/10 py-1.5 pr-1.5 pl-3">
        <h2 className="text-[12px] font-semibold uppercase tracking-wide text-white/70">
          {panel === "chat" ? "Chat" : "People"}
        </h2>
        {/* 32px — a thumb-sized target. This was a bare glyph 23px wide, which
            on a phone is the one control that puts the picture back and the
            hardest one on the panel to hit. */}
        <button
          type="button"
          onClick={onClose}
          aria-label={`Close ${panel === "chat" ? "chat" : "people"}`}
          className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-[18px] leading-none text-white/60 transition-colors hover:bg-white/10 hover:text-white"
        >
          ×
        </button>
      </div>
      {/* A flex column, and the chat and the roster are `flex-1` inside it
          rather than `h-full`. The panel takes its height by STRETCHING in the
          stage row, and Chrome does not treat that height as definite enough
          for a percentage two levels down — so `h-full` resolved to nothing,
          the message list grew to its content, and in a phone held sideways
          the composer sat 74px below the panel and under the control bar.
          Flexing needs no definiteness; it just fills. */}
      <div className="flex min-h-0 flex-1 flex-col">
        {panel === "chat" ? (
          <MeetingChat meetId={meetId} guestSessionId={guestSessionId} />
        ) : withDirectory ? (
          <DirectoryRoster isHost={isHost} />
        ) : (
          <ParticipantRoster isHost={isHost} />
        )}
      </div>
    </div>
  );
}
