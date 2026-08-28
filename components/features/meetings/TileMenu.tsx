"use client";

import { useEffect, useRef, useState } from "react";
import { RemoteParticipant, Track } from "livekit-client";
import type { TrackReferenceOrPlaceholder } from "@livekit/components-core";
import { Icon } from "@/components/ui/Icons";

/**
 * The per-participant menu — pin, hide, silence — as a strip above the grid.
 *
 * ## Why it is not drawn on the tile
 *
 * It was, and it turned a meeting into a black rectangle. `ParticipantTile` has
 * two properties that make an overlay impossible from outside it:
 *
 *  · It renders `children ?? defaultContent`. Anything passed as a child
 *    REPLACES the video, the name and the mute indicator — it does not layer
 *    over them.
 *  · `GridLayout` sizes its DIRECT children. Wrapping the tile makes the
 *    wrapper the grid item and the tile inside it collapses to nothing.
 *
 * A fragment is no better: the tile and the button become two grid cells.
 * Reaching the overlay properly would mean rebuilding the tile out of LiveKit's
 * parts, which is the second media stack this file exists to avoid.
 *
 * So the controls sit above the grid, one chip per person, and the grid stays
 * exactly what LiveKit renders. Less like Google Meet, and it works — which was
 * the requirement.
 *
 * ## Every action is local
 *
 * Pinning, hiding and silencing change what ONE person is looking at and
 * listening to. Nothing is broadcast and nothing touches anybody else's view —
 * muting somebody for the room is a moderation power and a different feature.
 * The wording says "for me" for that reason: "Mute" on a control that only
 * affects you is a promise the room will not keep.
 *
 * Silencing is `RemoteParticipant.setVolume(0)` — real, in this browser's audio
 * graph. Their recording is untouched: everybody records their own microphone,
 * so what you chose not to hear is still captured and still reaches Drive.
 */

export interface TileControlsProps {
  tracks: TrackReferenceOrPlaceholder[];
  keyOf: (t: TrackReferenceOrPlaceholder) => string;
  pinnedKey: string | null;
  onPin: (key: string | null) => void;
  hiddenKeys: Set<string>;
  onHide: (key: string, hidden: boolean) => void;
}

export function TileControls({
  tracks,
  keyOf,
  pinnedKey,
  onPin,
  hiddenKeys,
  onHide,
}: TileControlsProps) {
  const [openKey, setOpenKey] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  /* Close on a press anywhere else. A menu left open behind the next thing you
     click is a menu that eats that click. */
  useEffect(() => {
    if (!openKey) return;
    const onDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpenKey(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpenKey(null);
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [openKey]);

  /* One person, not one track: somebody sharing their screen has two tracks and
     does not want two identical menus. The camera tile is the one the controls
     act on; the share is offered separately below. */
  if (tracks.length === 0) return null;

  return (
    <div
      ref={rootRef}
      className="flex shrink-0 flex-wrap items-center gap-1.5 px-2 pt-2"
    >
      {tracks.map((t) => {
        const key = keyOf(t);
        const p = t.participant;
        const isPinned = pinnedKey === key;
        const isHidden = hiddenKeys.has(key);
        const isScreen = t.source === Track.Source.ScreenShare;
        const remote = p instanceof RemoteParticipant ? p : null;
        const label = `${p.name || p.identity}${isScreen ? " — screen" : ""}`;

        return (
          <div key={key} className="relative">
            <button
              type="button"
              aria-expanded={openKey === key}
              onClick={() => setOpenKey((k) => (k === key ? null : key))}
              className={`inline-flex max-w-[180px] items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors ${
                isPinned
                  ? "bg-white/20 text-slab-ink"
                  : isHidden
                    ? "bg-white/5 text-slab-ink-muted line-through"
                    : "bg-white/10 text-slab-ink-muted hover:bg-white/20 hover:text-slab-ink"
              }`}
            >
              {isPinned && <Icon.pin className="h-3 w-3 shrink-0" />}
              <span className="truncate">{label}</span>
              <Icon.chevronDown className="h-3 w-3 shrink-0 opacity-70" />
            </button>

            {openKey === key && (
              <div className="absolute top-full left-0 z-30 mt-1 w-56 overflow-hidden rounded-panel border border-white/10 bg-[var(--slab)] py-1 shadow-[0_18px_48px_rgba(0,0,0,0.55)]">
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
                    setOpenKey(null);
                  }}
                />
                <MenuItem
                  icon={<Icon.close className="h-3.5 w-3.5" />}
                  label={isHidden ? "Show this tile" : "Hide this tile"}
                  detail={
                    isHidden
                      ? "Put it back in your grid"
                      : "Off your grid only. They stay in the meeting and you still hear them."
                  }
                  onClick={() => {
                    onHide(key, !isHidden);
                    setOpenKey(null);
                  }}
                />
                {/* Absent rather than disabled where it cannot work: there is no
                    volume to change on your own tile, and a screen share's audio
                    is a different track from the person's microphone. */}
                {remote && !isScreen && (
                  <SilenceItem participant={remote} onDone={() => setOpenKey(null)} />
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/**
 * Silencing, with its own state.
 *
 * Held here rather than in the strip because it belongs to one participant and
 * has to survive that person's chip re-rendering — a map in the parent would be
 * a second place to keep the same fact.
 */
function SilenceItem({
  participant,
  onDone,
}: {
  participant: RemoteParticipant;
  onDone: () => void;
}) {
  const [silenced, setSilenced] = useState(
    () => participant.getVolume() === 0,
  );
  return (
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
        participant.setVolume(silenced ? 1 : 0);
        setSilenced((v) => !v);
        onDone();
      }}
    />
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
        {/* What it will do, said in the menu rather than discovered after. */}
        <span className="mt-0.5 block text-[10px] leading-snug text-slab-ink-muted">
          {detail}
        </span>
      </span>
    </button>
  );
}
