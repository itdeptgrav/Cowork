"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  useDataChannel,
  useLocalParticipant,
  useRemoteParticipants,
} from "@livekit/components-react";

/**
 * Raised hands and reactions, for every room.
 *
 * ## Why one channel and not two features
 *
 * A raised hand and a 👍 are the same mechanism — a small, ephemeral thing one
 * participant says to the room that is not speech and not chat. Splitting them
 * would mean two topics, two payload shapes and two sets of joining/leaving
 * bookkeeping, so they share a topic and differ by `kind`.
 *
 * ## Why hands are re-announced rather than stored
 *
 * There is nowhere to store them. LiveKit data messages reach whoever is in the
 * room at the time, so somebody joining after a hand went up would not see it.
 * Writing hands to Firestore instead would put a per-meeting-second write rate
 * on the database to express something that stops mattering the moment the
 * meeting ends.
 *
 * So a new participant asks — `kind: "sync"` — and everybody with a hand up
 * answers. Two messages per join, no storage, and a late joiner sees the room
 * as it actually is. The alternative that looks simpler, having every hand
 * re-broadcast on a timer, is a message per person per interval forever.
 *
 * ## Why a hand is dropped when its owner leaves
 *
 * A hand belongs to a person in the room. Without this, somebody who raised a
 * hand and then dropped out stayed raised in everybody's roster for the rest of
 * the meeting, and there is no way to lower another person's hand.
 */

const TOPIC = "cowork-room-signal";

/** How long a reaction stays on screen. Long enough to see, short enough to pass. */
const REACTION_MS = 4_000;

/** The reactions offered. Deliberately few — a picker is a different feature. */
export const REACTIONS = ["👍", "👏", "🎉", "❤️", "😂", "😮", "🤔", "👋"] as const;

export interface FloatingReaction {
  /** Unique per emission, so React can key them and two identical emoji coexist. */
  id: string;
  identity: string;
  name: string;
  emoji: string;
}

interface RoomSignalsValue {
  /** Identities with a hand currently up, including possibly your own. */
  hands: ReadonlySet<string>;
  /** Reactions currently on screen, oldest first. */
  reactions: readonly FloatingReaction[];
  myHandUp: boolean;
  toggleHand: () => void;
  sendReaction: (emoji: string) => void;
  /** Lower somebody else's hand — the host, after calling on them. */
  lowerHandOf: (identity: string) => void;
}

const RoomSignalsContext = createContext<RoomSignalsValue | null>(null);

export function useRoomSignals(): RoomSignalsValue {
  const ctx = useContext(RoomSignalsContext);
  if (!ctx) {
    throw new Error("useRoomSignals must be used inside <RoomSignalsProvider>");
  }
  return ctx;
}

/**
 * Safe outside a room, for components rendered on both sides of the boundary.
 * Returns null rather than throwing.
 */
export function useMaybeRoomSignals(): RoomSignalsValue | null {
  return useContext(RoomSignalsContext);
}

type Payload =
  | { kind: "hand"; up: boolean; name?: string }
  | { kind: "reaction"; emoji: string; name?: string }
  | { kind: "sync" }
  | { kind: "lower"; target: string };

export function RoomSignalsProvider({ children }: { children: ReactNode }) {
  const { localParticipant } = useLocalParticipant();
  const remotes = useRemoteParticipants();
  const me = localParticipant?.identity ?? "";

  const [hands, setHands] = useState<Set<string>>(new Set());
  const [reactions, setReactions] = useState<FloatingReaction[]>([]);

  /* Read inside the message handler without making it a dependency — the
     handler is registered once and must see current values. */
  const handsRef = useRef(hands);
  handsRef.current = hands;
  const meRef = useRef(me);
  meRef.current = me;

  const seqRef = useRef(0);
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  const { send } = useDataChannel(TOPIC, (msg) => {
    let data: Payload;
    try {
      data = JSON.parse(new TextDecoder().decode(msg.payload)) as Payload;
    } catch {
      return; /* malformed — ignore */
    }
    const from = msg.from?.identity ?? "";
    const fromName = msg.from?.name ?? from;

    if (data.kind === "hand") {
      setHands((prev) => {
        const next = new Set(prev);
        if (data.up) next.add(from);
        else next.delete(from);
        return next;
      });
      return;
    }

    if (data.kind === "reaction") {
      const id = `${from}-${(seqRef.current += 1)}`;
      setReactions((prev) => [
        ...prev,
        { id, identity: from, name: fromName, emoji: data.emoji },
      ]);
      const t = setTimeout(() => {
        setReactions((prev) => prev.filter((r) => r.id !== id));
      }, REACTION_MS);
      timersRef.current.push(t);
      return;
    }

    if (data.kind === "lower") {
      setHands((prev) => {
        if (!prev.has(data.target)) return prev;
        const next = new Set(prev);
        next.delete(data.target);
        return next;
      });
      return;
    }

    if (data.kind === "sync") {
      /* Somebody just arrived. If MY hand is up, tell them — each raised hand
         answers for itself, so nobody has to be the authority on the room. */
      if (handsRef.current.has(meRef.current)) {
        publish(send, { kind: "hand", up: true });
      }
    }
  });

  /* Ask the room for its raised hands, once, on arrival. */
  const askedRef = useRef(false);
  useEffect(() => {
    if (askedRef.current || !me) return;
    askedRef.current = true;
    publish(send, { kind: "sync" });
  }, [me, send]);

  /* A hand belongs to somebody who is here. */
  useEffect(() => {
    const present = new Set([me, ...remotes.map((p) => p.identity)]);
    setHands((prev) => {
      const next = new Set([...prev].filter((id) => present.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [me, remotes]);

  useEffect(
    () => () => {
      for (const t of timersRef.current) clearTimeout(t);
      timersRef.current = [];
    },
    [],
  );

  const myHandUp = hands.has(me);

  const toggleHand = useCallback(() => {
    const up = !handsRef.current.has(meRef.current);
    setHands((prev) => {
      const next = new Set(prev);
      if (up) next.add(meRef.current);
      else next.delete(meRef.current);
      return next;
    });
    publish(send, { kind: "hand", up });
  }, [send]);

  const sendReaction = useCallback(
    (emoji: string) => {
      /* Shown locally too: LiveKit does not echo your own data messages back,
         so without this your reaction is the one nobody sees you send. */
      const id = `${meRef.current}-${(seqRef.current += 1)}`;
      setReactions((prev) => [
        ...prev,
        { id, identity: meRef.current, name: "You", emoji },
      ]);
      const t = setTimeout(() => {
        setReactions((prev) => prev.filter((r) => r.id !== id));
      }, REACTION_MS);
      timersRef.current.push(t);
      publish(send, { kind: "reaction", emoji });
    },
    [send],
  );

  const lowerHandOf = useCallback(
    (identity: string) => {
      setHands((prev) => {
        if (!prev.has(identity)) return prev;
        const next = new Set(prev);
        next.delete(identity);
        return next;
      });
      publish(send, { kind: "lower", target: identity });
    },
    [send],
  );

  const value = useMemo(
    () => ({ hands, reactions, myHandUp, toggleHand, sendReaction, lowerHandOf }),
    [hands, reactions, myHandUp, toggleHand, sendReaction, lowerHandOf],
  );

  return (
    <RoomSignalsContext.Provider value={value}>
      {children}
    </RoomSignalsContext.Provider>
  );
}

/* Derived from the hook rather than hand-written, so a change to LiveKit's
   publish signature is a compile error here instead of a silent mismatch. */
type SendData = ReturnType<typeof useDataChannel>["send"];

function publish(send: SendData, data: Payload): void {
  if (!send) return;
  try {
    /* Reliable: a hand going up or down is a state change, and an unreliable
       one that is dropped leaves that person raised for everybody else with no
       way to correct it. Reactions are cheap enough to send the same way. */
    void Promise.resolve(
      send(new TextEncoder().encode(JSON.stringify(data)), { reliable: true }),
    ).catch(() => {
      /* A message that does not leave is a hand nobody sees, not a broken room. */
    });
  } catch {
    /* Same. */
  }
}

/**
 * Reactions drifting over the stage.
 *
 * Positioned absolutely over the grid rather than inside a tile: a reaction is
 * from a person but it is TO the room, and pinning it to a tile hides it
 * whenever that tile is off-screen or the sender is the one being looked at.
 */
export function ReactionOverlay() {
  const { reactions } = useRoomSignals();
  if (reactions.length === 0) return null;

  return (
    <div
      aria-live="polite"
      className="pointer-events-none absolute inset-x-0 bottom-2 z-20 flex flex-wrap justify-center gap-2 px-2"
    >
      {reactions.map((r) => (
        <span
          key={r.id}
          className="animate-[fadeUp_4s_ease-out_forwards] rounded-full bg-black/60 px-3 py-1 text-[13px] text-white backdrop-blur-sm"
        >
          <span aria-hidden className="mr-1.5 text-[15px]">
            {r.emoji}
          </span>
          {r.name}
        </span>
      ))}
      <style>{`
        @keyframes fadeUp {
          0%   { opacity: 0; transform: translateY(8px) scale(0.9); }
          12%  { opacity: 1; transform: translateY(0) scale(1); }
          80%  { opacity: 1; }
          100% { opacity: 0; transform: translateY(-14px); }
        }
        @media (prefers-reduced-motion: reduce) {
          .animate-\\[fadeUp_4s_ease-out_forwards\\] { animation: none; }
        }
      `}</style>
    </div>
  );
}
