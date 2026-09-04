"use client";

import { useEffect, useRef, useState } from "react";
import type * as Y from "yjs";
import { useCollabSession } from "@/components/features/workspace/useCollabSession";
import { workbookRoom } from "@/lib/rules/workspace/collabRoom";
import type { Employee } from "@/lib/domain";
import {
  LOCAL_ORIGIN,
  applyRemoteEvents,
  captureEvent,
  docIsEmpty,
  mapsOf,
  peersFrom,
  pushLocalChanges,
  readDoc,
  seedDoc,
  type PeerCursor,
  type RemoteEvent,
} from "@/lib/spreadsheet/collabSync";
import type { Workbook } from "@/lib/spreadsheet/model";
import type { SpreadsheetController } from "./useSpreadsheet";

/**
 * Live collaboration for one workbook.
 *
 * Joins the workbook's room once the workbook is stored (a draft has no id
 * and nobody else to share it with). On joining, an empty room is seeded
 * from what this client loaded; a room that already holds state — someone
 * else is editing — replaces the local workbook with the live one, since the
 * saved copy is older by definition. From then on every local change is
 * written to the shared document and every remote change is applied to the
 * controller without touching undo history, and each person's selection is
 * published so the others see where they are.
 *
 * Saving is unchanged: every client still autosaves through the REST route.
 * With a shared document all of them hold the same content, so a save
 * refused for a stale revision is simply retried at the current one.
 *
 * Nothing here is required. With no engine, no token or no socket the sheet
 * works exactly as before, single-writer, and `reason` says why.
 */
export interface WorkbookCollab {
  connected: boolean;
  /** How many OTHER people are in the workbook. */
  peers: number;
  cursors: PeerCursor[];
  reason: string | null;
}

export function useWorkbookCollab(
  controller: SpreadsheetController,
  workbookId: string | null,
  me: Employee | null,
): WorkbookCollab {
  const collab = useCollabSession(workbookId ? workbookRoom(workbookId) : "", me);
  const [cursors, setCursors] = useState<PeerCursor[]>([]);
  /* The last workbook this hook pushed or applied — the diff base. Held in a
     ref: it is bookkeeping between renders, not something to render. */
  const synced = useRef<Workbook | null>(null);
  const controllerRef = useRef(controller);
  useEffect(() => {
    controllerRef.current = controller;
  });

  /* Join: seed or adopt, then listen. */
  useEffect(() => {
    const session = collab.session;
    if (!session) {
      synced.current = null;
      return;
    }
    const doc = session.doc;
    const maps = mapsOf(doc);
    let cancelled = false;

    const adopt = () => {
      const c = controllerRef.current;
      if (docIsEmpty(maps)) {
        seedDoc(doc, c.workbook, c.styleRegistry);
        synced.current = c.workbook;
      } else {
        const live = readDoc(doc, c.styleRegistry, c.activeSheetId);
        c.applyRemote(live, { cells: [], structural: true, namesChanged: true });
        synced.current = live;
      }
    };

    /* The provider syncs the initial state shortly after connecting; adopt
       once that has landed, or straight away when it already has. */
    let adopted = false;
    const onSynced = () => {
      if (cancelled || adopted) return;
      adopted = true;
      adopt();
    };
    if (session.provider.synced) onSynced();
    else session.provider.once("sync", onSynced);

    /* Remote transactions: apply, and move the diff base along. */
    const onRemote = (events: RemoteEvent[], tr: Y.Transaction) => {
      if (tr.origin === LOCAL_ORIGIN || cancelled || !adopted) return;
      const c = controllerRef.current;
      const base = synced.current ?? c.workbook;
      const { workbook, change } = applyRemoteEvents(events, doc, base, c.styleRegistry);
      synced.current = workbook;
      c.applyRemote(workbook, change);
    };
    const observers: Y.Map<string>[] = [maps.cells, maps.styles, maps.sheets, maps.workbook];
    /* One handler per map, batched per transaction through `observe`; the
       events of one transaction arrive in one call each, in order. */
    const pending = new Map<Y.Transaction, RemoteEvent[]>();
    const handler = (event: Y.YEvent<Y.Map<string>>, tr: Y.Transaction) => {
      const captured = captureEvent(event, maps);
      if (!captured) return;
      let list = pending.get(tr);
      if (!list) {
        list = [];
        pending.set(tr, list);
        /* Flush after every observer of this transaction has run. */
        queueMicrotask(() => {
          const events = pending.get(tr) ?? [];
          pending.delete(tr);
          onRemote(events, tr);
        });
      }
      list.push(captured);
    };
    for (const m of observers) m.observe(handler);

    const awareness = session.provider.awareness;
    const onAwareness = () => {
      if (cancelled) return;
      setCursors(peersFrom(awareness.getStates() as Map<number, Record<string, unknown>>, awareness.clientID));
    };
    awareness.on("change", onAwareness);
    onAwareness();

    return () => {
      cancelled = true;
      for (const m of observers) m.unobserve(handler);
      awareness.off("change", onAwareness);
      session.provider.off("sync", onSynced);
      setCursors([]);
    };
  }, [collab.session]);

  /* Local changes → the shared document. Runs after every render whose
     workbook differs from the last synced one. */
  const workbook = controller.workbook;
  useEffect(() => {
    const session = collab.session;
    if (!session || !synced.current || synced.current === workbook) return;
    pushLocalChanges(session.doc, synced.current, workbook, controller.styleRegistry);
    synced.current = workbook;
  }, [collab.session, workbook, controller.styleRegistry]);

  /* Presence: where this person is. */
  const { activeSheetId, selection } = controller;
  useEffect(() => {
    const session = collab.session;
    if (!session) return;
    session.provider.awareness.setLocalStateField("sheet", {
      sheetId: activeSheetId,
      row: selection.active.row,
      col: selection.active.col,
      range: selection.range,
    });
  }, [collab.session, activeSheetId, selection]);

  return {
    connected: collab.connected,
    peers: collab.peers,
    cursors,
    reason: workbookId ? collab.reason : "Save the sheet to edit it with others.",
  };
}
