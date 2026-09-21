"use client";

/**
 * The workspace's one live connection, and the change feed that rides it.
 *
 * ## Why this exists
 *
 * Until now the only Socket.IO connection Cowork made was created by the
 * meeting code, when a meeting mounted. Everything else that was "live" — the
 * task list, the chat, the bell — was a Firestore listener talking to Google
 * directly. With the database moved, those listeners have nothing to talk to,
 * and the replacement (`startChangeFeed`, the server's `realtime:change`) needs
 * a socket that exists for the whole session, not just during a meeting.
 *
 * This connects it once, after sign-in, with the ID token in the handshake so
 * the server can grant the `user:<id>` room — see `socketIdentity.js` on the
 * backend. It reuses `getCoworkSocket` rather than opening a second connection;
 * one socket per tab is the right number.
 *
 * ## Two consumers, one subscription
 *
 * `startChangeFeed` turns notices into `notifyRepositoryChanged`, which every
 * `useQuery` already listens to. `subscribeToChanges` is for the Firestore
 * facade's `onSnapshot`, which needs the raw notice to decide whether the thing
 * IT is watching changed. Both hang off the same socket handler.
 */

import { getCoworkSocket } from "@/lib/legacy-ui/coworkSocket";
import { startChangeFeed, type ChangeNotice } from "./changeFeed";

type Listener = (notice: ChangeNotice | { resync: true }) => void;

const listeners = new Set<Listener>();
let stopFeed: (() => void) | null = null;
let attachedTo: unknown = null;
let detachRaw: (() => void) | null = null;

function attach(socket: ReturnType<typeof getCoworkSocket>) {
  if (attachedTo === socket) return;
  detachRaw?.();
  const onChange = (n: ChangeNotice) => {
    for (const l of listeners) l(n);
  };
  const onResync = () => {
    for (const l of listeners) l({ resync: true });
  };
  socket.on("realtime:change", onChange);
  socket.on("realtime:resync", onResync);
  attachedTo = socket;
  detachRaw = () => {
    socket.off("realtime:change", onChange);
    socket.off("realtime:resync", onResync);
    attachedTo = null;
  };
}

/**
 * Connect (or reuse) the session socket and start the change feed on it.
 *
 * Returns a stop function. Calling it again for a new employee replaces the
 * previous feed rather than stacking a second one — two feeds would turn every
 * change into two refetch storms.
 */
export function connectAppSocket(employeeId: string): () => void {
  const socket = getCoworkSocket(employeeId);
  attach(socket);
  stopFeed?.();
  stopFeed = startChangeFeed(socket);
  return () => {
    stopFeed?.();
    stopFeed = null;
  };
}

/** Raw notices for the Firestore facade's `onSnapshot`. */
export function subscribeToChanges(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** For tests: pretend a notice arrived. */
export function __emitForTest(notice: ChangeNotice | { resync: true }): void {
  for (const l of listeners) l(notice);
}
