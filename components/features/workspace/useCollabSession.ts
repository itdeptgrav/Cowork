"use client";

import { useEffect, useMemo, useState } from "react";
import {
  caretColour,
  openCollabSession,
  type CollabSession,
} from "@/lib/documents/collabProvider";
import { idToken } from "@/lib/legacy/firebase";
import type { Employee } from "@/lib/domain";

/**
 * A live session for one document, or nothing.
 *
 * **Nothing is a supported outcome, not a failure.** The mock backend has no
 * Socket.IO server, the engine may be unreachable, and a person may have no
 * Firebase token — in every one of those cases the editor still opens and still
 * saves, single-writer, exactly as it did in phase 1. Collaboration is an
 * upgrade to that path rather than a replacement for it, which is what stops a
 * transport problem turning into a document nobody can edit.
 *
 * `connected` is reported separately from `session` because they are different
 * facts: a session exists the moment the provider is constructed, and the
 * socket is up some time later. The banner reads the second.
 */
export function useCollabSession(
  documentId: string,
  me: Employee | null,
): {
  session: CollabSession | null;
  connected: boolean;
  peers: number;
  identity: { name: string; color: string };
  /** Why collaboration is not on, when it is not. Shown, never swallowed. */
  reason: string | null;
} {
  const [session, setSession] = useState<CollabSession | null>(null);
  const [connected, setConnected] = useState(false);
  const [peers, setPeers] = useState(0);
  const [reason, setReason] = useState<string | null>(null);

  const identity = useMemo(
    () => ({
      name: me?.displayName ?? "Someone",
      color: caretColour(me?.id ?? "anon"),
    }),
    [me?.displayName, me?.id],
  );

  useEffect(() => {
    /* Waits for the person. Connecting first and naming the caret afterwards
       shows every other editor an "Someone" cursor that later renames itself. */
    if (!documentId) return;
    if (!me) {
      setReason("Waiting for your profile…");
      return;
    }
    let cancelled = false;
    let opened: CollabSession | null = null;

    void (async () => {
      const token = await idToken().catch(() => null);
      if (cancelled) return;
      if (!token) {
        setReason("Not signed in to the engine, so live editing is off.");
        return;
      }
      try {
        opened = openCollabSession({ documentId, token });
      } catch (e) {
        setReason(
          e instanceof Error ? e.message : "The collaboration server could not be reached.",
        );
        return;
      }
      if (cancelled) {
        opened.destroy();
        return;
      }

      opened.provider.awareness.setLocalStateField("user", {
        name: identity.name,
        color: identity.color,
      });

      const onStatus = (event: { status: string }) => {
        const up = event.status === "connected";
        setConnected(up);
        if (up) setReason(null);
      };
      /* The refusal reason the server sent, verbatim. Swallowing it is what
         made this look like "offline" when it was actually "not authorised" —
         one is a network problem and the other is a permissions problem, and
         they need completely different next steps. */
      opened.provider.socket.on("connect_error", (e: Error) => {
        setConnected(false);
        setReason(e?.message || "The collaboration server refused the connection.");
      });
      const onAwareness = () => {
        /* Everybody with a state, minus this client. `getStates()` includes
           self, and reporting "1 editing" when you are alone is noise. */
        setPeers(Math.max(0, opened!.provider.awareness.getStates().size - 1));
      };

      opened.provider.on("status", onStatus);
      opened.provider.awareness.on("change", onAwareness);
      onAwareness();
      setSession(opened);
    })();

    return () => {
      cancelled = true;
      setSession(null);
      setConnected(false);
      setPeers(0);
      opened?.destroy();
    };
  }, [documentId, me, identity.name, identity.color]);

  return { session, connected, peers, identity, reason };
}
