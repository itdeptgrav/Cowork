"use client";

import { useSyncExternalStore } from "react";
import type { PlayerPhase } from "./useYouTubePlayer";

/**
 * A tiny store for player state, sitting beside the music context rather than
 * inside it.
 *
 * Position ticks twice a second. Putting that on a context that wraps the whole
 * application would re-render every route, on every tick, forever — so the
 * frequently-changing part lives here instead and only the components that
 * actually draw a clock or a scrubber subscribe to it.
 *
 * The commands are separate because they never change identity: they are the
 * player's stable handle, published once when the player is created and read
 * imperatively by whichever surface is currently on screen.
 */

export interface PlayerSnapshot {
  phase: PlayerPhase;
  position: number;
  duration: number;
  message: string | null;
}

export interface PlayerCommands {
  play(): void;
  pause(): void;
  seek(seconds: number): void;
  setVolume(v: number): void;
  setMuted(m: boolean): void;
}

const IDLE: PlayerSnapshot = {
  phase: "idle",
  position: 0,
  duration: 0,
  message: null,
};

const NO_COMMANDS: PlayerCommands = {
  play() {},
  pause() {},
  seek() {},
  setVolume() {},
  setMuted() {},
};

let snapshot: PlayerSnapshot = IDLE;
let commands: PlayerCommands = NO_COMMANDS;
const listeners = new Set<() => void>();

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function publishSnapshot(next: PlayerSnapshot): void {
  if (
    next.phase === snapshot.phase &&
    next.position === snapshot.position &&
    next.duration === snapshot.duration &&
    next.message === snapshot.message
  ) {
    return;
  }
  snapshot = next;
  for (const fn of listeners) fn();
}

export function publishCommands(next: PlayerCommands): void {
  commands = next;
}

/** Imperative handle. Read at the moment of a click, never during render. */
export function playerCommands(): PlayerCommands {
  return commands;
}

export function usePlayerSnapshot(): PlayerSnapshot {
  return useSyncExternalStore(
    subscribe,
    () => snapshot,
    () => IDLE,
  );
}
