"use client";

import { useEffect, useRef, useState } from "react";
import {
  CarouselLayout,
  FocusLayout,
  FocusLayoutContainer,
  GridLayout,
  ParticipantTile,
  useTracks,
} from "@livekit/components-react";
import { Track } from "livekit-client";
import { TileControls } from "./TileMenu";
import { TileContent } from "./TileContent";

/**
 * Moved here from `MeetingRoom` so a task's meeting gets it too.
 *
 * It had grown every feature the scheduled room learned — pinning, the per-tile
 * menu, profile pictures instead of grey outlines — while the task room next to
 * it still drew a bare grid. Nothing about this is specific to a scheduled
 * meeting, so nothing about it should have lived only there.
 */

/**
 * The participant grid.
 *
 * Camera and screen-share tracks in one grid, which is what makes a shared
 * screen take the space it needs instead of sitting in a thumbnail beside the
 * faces. `ParticipantTile` carries the active-speaker ring and the muted
 * indicator already.
 */
/**
 * The participant grid, and one tile enlarged when somebody pins it.
 *
 * ## Why pinning is worth having
 *
 * A shared screen in an equal grid is a thumbnail of a spreadsheet — present,
 * and unreadable. The grid is right when a meeting is faces talking to each
 * other and wrong the moment one tile carries the thing everybody is looking
 * at. Pinning is how a reader says which that is.
 *
 * **It is a decision about your own screen only.** Nothing is broadcast: pinning
 * does not move anybody else's view, because whose turn it is to look at what
 * is not the pinner's call to make for the room.
 *
 * A newly shared screen pins ITSELF, once. Somebody sharing has almost always
 * done it to be looked at, and making every viewer hunt for a pin button first
 * is the wrong default — but it is a default, not a lock: unpin, or pin
 * something else, and the choice is yours from then on. It does not re-pin
 * every time the track updates, only when a share that was not there appears.
 */
/* No `compact` flag any more: the per-tile menu is the only control on the
   stage and it fits at every size, so the corner window draws exactly what the
   page does. */
export function RoomStage() {
  const tracks = useTracks(
    [
      { source: Track.Source.Camera, withPlaceholder: true },
      { source: Track.Source.ScreenShare, withPlaceholder: false },
    ],
    { onlySubscribed: false },
  );

  /** The pinned track's identity+source key, or null for the plain grid. */
  const [pinnedKey, setPinnedKey] = useState<string | null>(null);
  /**
   * Tiles this reader has taken off their own grid.
   *
   * Local only, and never applied to the pinned tile: hiding the thing you are
   * looking at would empty the stage with no obvious way back.
   */
  const [hiddenKeys, setHiddenKeys] = useState<Set<string>>(new Set());
  /* What was auto-pinned, so a share appearing twice does not override a
     reader who has since chosen something else. */
  const autoPinnedRef = useRef<string | null>(null);

  const keyOf = (t: (typeof tracks)[number]) =>
    `${t.participant.identity}:${t.source}`;

  const share = tracks.find((t) => t.source === Track.Source.ScreenShare);
  useEffect(() => {
    if (!share) {
      /* The share ended. Only clear the pin if it was the share's own — a
         reader who pinned a face keeps it. */
      if (autoPinnedRef.current) {
        setPinnedKey((k) => (k === autoPinnedRef.current ? null : k));
        autoPinnedRef.current = null;
      }
      return;
    }
    const key = `${share.participant.identity}:${share.source}`;
    if (autoPinnedRef.current === key) return;
    autoPinnedRef.current = key;
    setPinnedKey(key);
  }, [share]);

  const pinned = pinnedKey
    ? (tracks.find((t) => keyOf(t) === pinnedKey) ?? null)
    : null;
  /* A hidden tile is off the grid but never off the PIN: what somebody chose
     to look at large outranks a hide they set earlier. */
  const visible = tracks.filter(
    (t) => !hiddenKeys.has(keyOf(t)) || keyOf(t) === pinnedKey,
  );
  const others = pinned ? visible.filter((t) => keyOf(t) !== pinnedKey) : [];

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Above the grid, never inside it: see TileControls for why an overlay
          on the tile itself cannot work. */}
      <TileControls
        tracks={tracks}
        keyOf={keyOf}
        pinnedKey={pinnedKey}
        onPin={(k) => {
          autoPinnedRef.current = null;
          setPinnedKey(k);
        }}
        hiddenKeys={hiddenKeys}
        onHide={(k, hidden) =>
          setHiddenKeys((prev) => {
            const next = new Set(prev);
            if (hidden) next.add(k);
            else next.delete(k);
            return next;
          })
        }
      />
      <div className="relative min-h-0 flex-1 p-2">
      {/**
       * **The carousel comes FIRST and the focus second.** That is the
       * container's contract, not a style choice: it "expects two children — a
       * small side component ... and a larger main component". Written the other
       * way round it silently swaps them, which is what put a pinned screen
       * share in the thumbnail strip and a face in the large slot. Pinning
       * appeared to do the opposite of what it says.
       *
       * An empty carousel is still rendered when nobody else is here, so the
       * focused tile stays in the slot sized for it rather than being promoted
       * to the container's first child.
       */}
      {pinned ? (
        <FocusLayoutContainer className="h-full">
          <CarouselLayout tracks={others}>
            <ParticipantTile>
              <TileContent />
            </ParticipantTile>
          </CarouselLayout>
          <FocusLayout trackRef={pinned} />
        </FocusLayoutContainer>
      ) : (
        <GridLayout tracks={visible} className="h-full">
          <ParticipantTile>
            <TileContent />
          </ParticipantTile>
        </GridLayout>
      )}

        {/* Somewhere to go when everything has been hidden. Without it the
            stage is simply empty and the way back is not discoverable. */}
        {visible.length === 0 && tracks.length > 0 && (
          <div className="grid h-full place-items-center">
            <div className="text-center">
              <p className="text-[13px] text-slab-ink">
                Every tile is hidden on your screen
              </p>
              <button
                type="button"
                onClick={() => setHiddenKeys(new Set())}
                className="mt-2 rounded-full bg-white/10 px-3 py-1.5 text-[12px] font-medium text-slab-ink transition-colors hover:bg-white/20"
              >
                Show them all again
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
