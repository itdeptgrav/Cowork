"use client";

import { useEffect, useRef, useState } from "react";
import {
  ParticipantTile,
  useMaybeTrackRefContext,
} from "@livekit/components-react";
import { RemoteParticipant, Track } from "livekit-client";
import { Icon } from "@/components/ui/Icons";

/**
 * One participant's tile, with the menu that acts on it.
 *
 * ## Every entry does something, or it is not here
 *
 * A menu of plausible-looking options that quietly do nothing is worse than a
 * short menu: somebody presses "hide" once, sees no change, and stops trusting
 * the rest of the controls too. So this offers three, all of which take effect
 * immediately and all of which are verifiable by looking at the screen.
 *
 * ## They change YOUR screen, not the room
 *
 * Pinning, hiding and silencing are decisions about what one person is looking
 * at and listening to. None of them is broadcast, and none of them touches what
 * anybody else sees — muting somebody for the room is a moderation power and a
 * different feature entirely. The wording says "for me" for exactly that
 * reason: "Mute" on a menu that only affects you is a promise the room will
 * not keep.
 *
 * ## Silencing is real, not a volume slider on the tile
 *
 * `RemoteParticipant.setVolume(0)` mutes that person's microphone track in this
 * browser's audio graph. Their recording is untouched — every participant
 * records their own microphone locally, so what somebody chose not to listen to
 * is still captured and still reaches Drive.
 */

export function TileMenu({
  pinnedKey,
  onPin,
  hiddenKeys,
  onHide,
}: {
  pinnedKey: string | null;
  onPin: (key: string | null) => void;
  hiddenKeys: Set<string>;
  onHide: (key: string, hidden: boolean) => void;
}) {
  const trackRef = useMaybeTrackRefContext();
  const [open, setOpen] = useState(false);
  const [silenced, setSilenced] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  /* Close on a press anywhere else. A menu that stays open behind the next
     thing you click is a menu that eats that click. */
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!trackRef) return <ParticipantTile />;

  const participant = trackRef.participant;
  const key = `${participant.identity}:${trackRef.source}`;
  const isPinned = pinnedKey === key;
  const isHidden = hiddenKeys.has(key);
  const isLocal = participant.isLocal;
  const isScreen = trackRef.source === Track.Source.ScreenShare;
  /* Only a remote participant has a volume in THIS browser's audio graph.
     Silencing yourself would do nothing — you do not hear your own track. */
  const remote =
    participant instanceof RemoteParticipant ? participant : null;

  return (
    <div ref={rootRef} className="relative h-full w-full">
      <ParticipantTile />

      {/* The trigger, out of the way of the name badge LiveKit draws bottom-left. */}
      <button
        type="button"
        aria-label={`Options for ${participant.name || participant.identity}`}
        aria-expanded={open}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        onPointerDown={(e) => e.stopPropagation()}
        className="absolute top-1.5 right-1.5 z-20 grid h-7 w-7 place-items-center rounded-full bg-black/50 text-white opacity-0 backdrop-blur transition-opacity group-hover:opacity-100 focus-visible:opacity-100 hover:bg-black/70 [.lk-participant-tile:hover_&]:opacity-100"
      >
        <Icon.more className="h-4 w-4" />
      </button>

      {open && (
        <div
          className="absolute top-10 right-1.5 z-30 w-56 overflow-hidden rounded-panel border border-white/10 bg-[var(--slab)] py-1 shadow-[0_18px_48px_rgba(0,0,0,0.55)]"
          onPointerDown={(e) => e.stopPropagation()}
        >
          <MenuItem
            icon={<Icon.pin className="h-3.5 w-3.5" />}
            label={isPinned ? "Unpin" : "Pin to the screen"}
            detail={
              isPinned
                ? "Back to the equal grid"
                : "Show this one large. Only on your screen."
            }
            onClick={() => {
              onPin(isPinned ? null : key);
              setOpen(false);
            }}
          />

          <MenuItem
            icon={<Icon.close className="h-3.5 w-3.5" />}
            label={isHidden ? "Show this tile" : "Hide this tile"}
            detail={
              isHidden
                ? "Put it back in your grid"
                : "Takes it off your grid. They stay in the meeting and you still hear them."
            }
            onClick={() => {
              onHide(key, !isHidden);
              setOpen(false);
            }}
          />

          {/* Absent rather than disabled where it cannot work: there is no
              volume to change on your own tile, and a screen share's audio is a
              different track from the person's microphone. */}
          {remote && !isLocal && !isScreen && (
            <MenuItem
              icon={
                silenced ? (
                  <Icon.volume className="h-3.5 w-3.5" />
                ) : (
                  <Icon.volumeOff className="h-3.5 w-3.5" />
                )
              }
              label={silenced ? "Hear them again" : "Silence for me"}
              detail={
                silenced
                  ? "Turn their microphone back up on your device"
                  : "You stop hearing them. Their recording is unaffected."
              }
              onClick={() => {
                remote.setVolume(silenced ? 1 : 0);
                setSilenced((v) => !v);
                setOpen(false);
              }}
            />
          )}
        </div>
      )}
    </div>
  );
}

function MenuItem({
  icon,
  label,
  detail,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  detail: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-start gap-2.5 px-3 py-2 text-left transition-colors hover:bg-white/10"
    >
      <span className="mt-0.5 shrink-0 text-slab-ink-muted">{icon}</span>
      <span className="min-w-0">
        <span className="block text-[12px] font-medium text-slab-ink">
          {label}
        </span>
        {/* What it will do, in the menu rather than after the fact. These are
            all local-only, and saying so is the difference between "Mute" and
            somebody believing they silenced the room. */}
        <span className="mt-0.5 block text-[10px] leading-snug text-slab-ink-muted">
          {detail}
        </span>
      </span>
    </button>
  );
}
