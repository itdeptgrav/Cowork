"use client";

import { useMemo, useState } from "react";
import {
  ConnectionQualityIndicator,
  useLocalParticipant,
  useParticipants,
} from "@livekit/components-react";
import { Avatar } from "@/components/ui/Avatar";
import { useQuery } from "@/lib/hooks/useRepository";
import type { Employee } from "@/lib/domain";
import { useRoomSignals } from "./RoomSignals";

/**
 * Who is in the room, what their microphone and camera are doing, and who has
 * a hand up.
 *
 * ## Why this exists when a grid of tiles already shows everybody
 *
 * It does not, past about nine people — and the grid answers "who is talking",
 * not "is Priya here yet". A roster is also the only place a search makes
 * sense, and the only place a per-person action can live that is not a menu
 * hidden behind a tile that may be paginated away.
 *
 * ## Hands sort to the top, and that is the whole point of them
 *
 * A raised hand nobody notices is worse than no raise-hand feature, because the
 * person who raised it is now waiting on a signal that was delivered and
 * ignored. Hands sort first, in the order they went up is not tracked — so
 * within the group they stay alphabetical rather than jumping around as the
 * set changes.
 *
 * ## What a host may do here
 *
 * Lower a hand, after calling on somebody. Muting another person's microphone
 * is deliberately NOT here: it needs a server-side `roomAdmin` grant that only
 * a verified organiser gets, and offering a control that silently fails for
 * everybody else is worse than not offering it.
 */
/**
 * The roster, for a reader who can read the employee directory.
 *
 * Split from the presentational component below because a GUEST cannot: the
 * guest room deliberately never calls `listEmployees` — its tiles use LiveKit's
 * default rather than `TileContent` for exactly that reason. A hook cannot be
 * called conditionally, so the fetch lives in its own component and the guest
 * renders the other one.
 */
export function DirectoryRoster({ isHost = false }: { isHost?: boolean }) {
  const people = useQuery((r) => r.listEmployees(), []);
  return <ParticipantRoster isHost={isHost} directory={people.data} />;
}

export function ParticipantRoster({
  isHost = false,
  directory,
}: {
  isHost?: boolean;
  /**
   * Names and faces from the workspace, when the reader may have them.
   *
   * Absent for a guest, who falls back to the name each participant published
   * with — which is what LiveKit's own tiles show them anyway, so the roster
   * agrees with the grid rather than being the one surface that says "GR0067".
   */
  directory?: readonly Employee[] | null;
}) {
  const participants = useParticipants();
  const { localParticipant } = useLocalParticipant();
  const me = localParticipant?.identity ?? "";
  const { hands, lowerHandOf } = useRoomSignals();
  const [term, setTerm] = useState("");

  const rows = useMemo(() => {
    const q = term.trim().toLowerCase();
    const named = participants.map((p) => {
      const person = directory?.find((e) => e.id === p.identity);
      return {
        identity: p.identity,
        label: person?.displayName ?? p.name ?? p.identity,
        initials: person?.initials ?? initialsOf(p.name ?? p.identity),
        hue: person?.hue ?? 0,
        picture: person?.profilePictureUrl ?? undefined,
        micOn: p.isMicrophoneEnabled,
        camOn: p.isCameraEnabled,
        sharing: p.isScreenShareEnabled,
        isMe: p.identity === me,
        handUp: hands.has(p.identity),
      };
    });
    const filtered = q
      ? named.filter((r) => r.label.toLowerCase().includes(q))
      : named;
    return filtered.sort((a, b) => {
      if (a.handUp !== b.handUp) return a.handUp ? -1 : 1;
      return a.label.localeCompare(b.label);
    });
  }, [participants, directory, me, hands, term]);

  const raised = rows.filter((r) => r.handUp).length;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 border-b border-white/10 p-2">
        <label className="sr-only" htmlFor="roster-search">
          Search participants
        </label>
        <input
          id="roster-search"
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          placeholder={`Search ${participants.length} ${participants.length === 1 ? "person" : "people"}`}
          className="w-full rounded-lg border border-white/15 bg-white/5 px-2.5 py-1.5 text-[13px] text-white placeholder:text-white/35 focus:border-white/30 focus:outline-none"
        />
        {raised > 0 && (
          <p className="mt-1.5 px-0.5 text-[11px] text-amber-300" aria-live="polite">
            {raised} {raised === 1 ? "hand" : "hands"} up
          </p>
        )}
      </div>

      <ul className="min-h-0 flex-1 overflow-y-auto p-1.5">
        {rows.length === 0 && (
          <li className="px-2 py-6 text-center text-[12px] text-white/45">
            Nobody matches “{term}”.
          </li>
        )}
        {rows.map((r) => (
          <li
            key={r.identity}
            className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 hover:bg-white/5"
          >
            <Avatar
              initials={r.initials}
              hue={r.hue}
              src={r.picture}
              name={r.label}
              size="sm"
            />
            <span className="min-w-0 flex-1 truncate text-[13px] text-white/90">
              {r.label}
              {r.isMe && <span className="text-white/45"> (you)</span>}
            </span>

            {r.handUp && (
              <span
                title={`${r.label} has a hand up`}
                className="text-[14px]"
                role="img"
                aria-label="Hand up"
              >
                ✋
              </span>
            )}
            {r.sharing && (
              <span
                className="rounded bg-white/15 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-white/80"
                title={`${r.label} is sharing their screen`}
              >
                Sharing
              </span>
            )}

            {/* Muted is the state worth drawing. An unmuted microphone is the
                expected one and a second icon for it is noise. */}
            <span
              className={r.micOn ? "text-white/35" : "text-rose-300"}
              title={r.micOn ? "Microphone on" : "Muted"}
              role="img"
              aria-label={r.micOn ? "Microphone on" : "Muted"}
            >
              {r.micOn ? "🎙" : "🔇"}
            </span>
            {!r.camOn && (
              <span className="text-white/30" title="Camera off" role="img" aria-label="Camera off">
                📷
              </span>
            )}

            <ParticipantQuality identity={r.identity} />

            {isHost && r.handUp && !r.isMe && (
              <button
                type="button"
                onClick={() => lowerHandOf(r.identity)}
                className="shrink-0 rounded-md bg-white/10 px-2 py-1 text-[11px] font-medium text-white/80 transition-colors hover:bg-white/20"
              >
                Lower
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * One person's connection, in the roster.
 *
 * `ConnectionQualityIndicator` takes its participant from context, so it is
 * given one here rather than being handed a prop it does not accept.
 */
function ParticipantQuality({ identity }: { identity: string }) {
  const participants = useParticipants();
  const p = participants.find((x) => x.identity === identity);
  if (!p) return null;
  return (
    <span className="shrink-0 opacity-70" title="Connection quality">
      <ConnectionQualityIndicator participant={p} />
    </span>
  );
}

function initialsOf(name: string | undefined): string {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "??";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
