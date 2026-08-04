import { SocketIOProvider } from "y-socket.io";
import * as Y from "yjs";
import { readConfig } from "@/lib/legacy/config";
import { PUBLIC_ENV } from "@/lib/legacy/publicEnv";

/**
 * The live connection for one room — a document, a sheet or a mindmap.
 *
 * `y-socket.io` claims `/yjs|<room>` on the engine's existing Socket.IO server,
 * so this reaches the SAME origin every other engine call does — there is no
 * second service to deploy, which is the reason this transport was chosen over
 * a standalone `y-websocket`.
 *
 * ## The token is passed, never assumed
 *
 * A WebSocket upgrade does not reliably carry cookies cross-origin and the
 * browser cannot set headers on it, so the Firebase ID token goes in the
 * handshake's `auth`. The server refuses the connection when it is missing,
 * invalid, or belongs to somebody who is not in the document — without that,
 * the room name IS the credential and document ids are guessable.
 */

export interface CollabIdentity {
  name: string;
  /** A stable colour for this person's caret and selection. */
  color: string;
}

/** Field-palette hues, so a caret can never be mistaken for a channel colour. */
const CARET_HUES = [
  "#8b9fbc",
  "#b39cc6",
  "#d9a4b0",
  "#e6c79c",
  "#7fb2a1",
  "#c2a3d4",
];

/**
 * A colour derived from the person, not assigned in join order.
 *
 * Order-based assignment gives the same person a different colour in every
 * session and two people the same colour depending on who arrived first —
 * which makes "the blue caret" useless as a way to refer to anybody.
 */
export function caretColour(employeeId: string): string {
  let hash = 0;
  for (let i = 0; i < employeeId.length; i++) {
    hash = (hash * 31 + employeeId.charCodeAt(i)) | 0;
  }
  return CARET_HUES[Math.abs(hash) % CARET_HUES.length];
}

export interface CollabSession {
  doc: Y.Doc;
  provider: SocketIOProvider;
  destroy: () => void;
}

/**
 * Open a session for one document.
 *
 * The caller owns the lifetime and must `destroy()` — a provider left running
 * after the editor unmounts keeps a socket open and keeps publishing presence
 * for somebody who has closed the document.
 */
export function openCollabSession(input: {
  /**
   * The room, NOT a bare record id.
   *
   * Build it with `documentRoom` / `mindmapRoom` — the name carries which kind
   * of record it is, and the server authorises against that collection. See
   * `lib/rules/workspace/collabRoom.ts`.
   */
  roomId: string;
  token: string;
  env?: Record<string, string | undefined>;
}): CollabSession {
  const doc = new Y.Doc();
  const { apiUrl } = readConfig(input.env ?? PUBLIC_ENV);

  const provider = new SocketIOProvider(
    apiUrl,
    input.roomId,
    doc,
    {},
    /* `autoConnect` is on; the token travels in `auth`, which is the only
       handshake field a browser can populate on a WebSocket. */
    { auth: { token: input.token } },
  );

  return {
    doc,
    provider,
    destroy: () => {
      /* Awareness first, so the other clients see this person leave rather
         than being left with a stale caret until a timeout expires. */
      try {
        provider.awareness.setLocalState(null);
      } catch {
        /* Already torn down. */
      }
      provider.disconnect();
      provider.destroy();
      doc.destroy();
    },
  };
}
