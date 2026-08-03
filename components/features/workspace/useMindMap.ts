"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getRepository } from "@/lib/repositories";
import { useQuery } from "@/lib/hooks/useRepository";
import { editRefusal } from "@/lib/rules/mindmap/access";
import { mindmapTreeRefusal } from "@/lib/rules/mindmap/validity";
import type { MindMap } from "@/lib/rules/mindmap/tree";
import type { MindMapRecord, MindNode } from "@/lib/domain";

/**
 * One open mindmap: its cards, and getting changes back to the server.
 *
 * ## What replaced what
 *
 * This used to read a single map out of `localStorage` through a module-level
 * external store. That map did not follow anybody between machines, nobody else
 * could see it, and clearing site data threw it away — limits the page said out
 * loud, because they were real. The map is a server record now, so the hook
 * takes an id: there are many maps, and this one holds the one that is open.
 *
 * ## Edits are local first, and REFUSED local first
 *
 * `update` runs the transform, checks the result with the same rule the engine
 * checks it with, and only then applies it. That ordering is the point. An
 * optimistic apply followed by a server refusal would leave the canvas drawing
 * a tree the server does not have, and the person would keep working on it —
 * so a tree that cannot be stored never becomes the tree on screen. The
 * refusal appears immediately, in the engine's own words.
 *
 * ## Saving is debounced, and a failed save stays dirty
 *
 * Dragging a card produces a stream of changes and one request per change would
 * be a request per frame. The two paths a debounce alone loses — the tab being
 * hidden, and the component unmounting — are flushed explicitly, matching
 * `DocumentEditor`. A refused save marks the work dirty again rather than
 * treating it as landed, so the next flush retries instead of quietly dropping
 * somebody's branch.
 */

const SAVE_DEBOUNCE_MS = 1200;

export type SaveStatus = "idle" | "saving" | "saved" | "error";

export function useMindMap(mindmapId: string | null): {
  /** The working copy the canvas draws. Null until it has loaded. */
  map: MindMap | null;
  record: MindMapRecord | null;
  loading: boolean;
  loadError: string | null;
  /** Null when this person may edit; the reason, in words, when they may not. */
  readOnlyReason: string | null;
  status: SaveStatus;
  /** A refused edit or a failed save, whichever happened last. */
  saveError: string | null;
  update: (fn: (map: MindMap) => MindMap) => void;
  reload: () => void;
} {
  const detail = useQuery(
    (r) => (mindmapId ? r.getMindMap(mindmapId) : Promise.resolve(null)),
    [mindmapId],
  );
  const me = useQuery((r) => r.getCurrentEmployee(), []);

  const [nodes, setNodes] = useState<MindNode[] | null>(null);
  const [status, setStatus] = useState<SaveStatus>("idle");
  const [saveError, setSaveError] = useState<string | null>(null);

  const dirty = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef<MindNode[]>([]);
  /* The id the pending save belongs to. Read at flush time rather than closed
     over, so a debounce still in flight when somebody opens another map cannot
     write this map's cards onto that one. */
  const savingId = useRef<string | null>(null);

  /* Adopt the server's cards when a map loads or is reloaded. Keyed on the id
     AND the body's stamp so a reload after an external change replaces what is
     held, while ordinary re-renders do not stamp on local edits. */
  const loadedStamp = detail.data
    ? `${detail.data.mindmap.id}:${detail.data.mindmap.updatedAt}`
    : null;
  const adopted = useRef<string | null>(null);
  useEffect(() => {
    if (!detail.data || loadedStamp === null) return;
    if (adopted.current === loadedStamp) return;
    /* Local work not yet saved wins over a re-read of the same map: adopting
       here would silently discard the branch somebody is in the middle of. */
    if (dirty.current && adopted.current?.startsWith(`${detail.data.mindmap.id}:`))
      return;
    adopted.current = loadedStamp;
    setNodes(detail.data.nodes);
    latest.current = detail.data.nodes;
    savingId.current = detail.data.mindmap.id;
    setStatus("idle");
    setSaveError(null);
  }, [detail.data, loadedStamp]);

  const record = detail.data?.mindmap ?? null;
  const readOnlyReason = record ? editRefusal(record, me.data?.id ?? null) : null;

  const flush = useCallback(async () => {
    if (!dirty.current) return;
    const id = savingId.current;
    if (!id) return;
    dirty.current = false;
    setStatus("saving");
    try {
      const result = await getRepository().saveMindMapNodes(id, latest.current);
      if (result.ok) {
        setStatus("saved");
        setSaveError(null);
      } else {
        /* Dirty again, so the next flush retries rather than treating a refused
           write as though it had landed. */
        dirty.current = true;
        setStatus("error");
        setSaveError(result.message);
      }
    } catch (e) {
      dirty.current = true;
      setStatus("error");
      setSaveError(
        e instanceof Error ? e.message : "This mindmap could not be saved.",
      );
    }
  }, []);

  const update = useCallback(
    (fn: (map: MindMap) => MindMap) => {
      if (!record) return;
      if (readOnlyReason) {
        setSaveError(readOnlyReason);
        return;
      }
      const current = nodes ?? [];
      const next = fn({
        id: record.id,
        title: record.title,
        nodes: current,
        updatedAt: record.updatedAt,
      });

      /* Checked BEFORE it is applied, with the rule the engine uses. A tree
         that cannot be stored never becomes the tree on screen. */
      const refusal = mindmapTreeRefusal(next.nodes);
      if (refusal) {
        setSaveError(refusal);
        return;
      }

      setNodes(next.nodes);
      latest.current = next.nodes;
      savingId.current = record.id;
      dirty.current = true;
      setSaveError(null);
      setStatus("saving");
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void flush(), SAVE_DEBOUNCE_MS);
    },
    [record, readOnlyReason, nodes, flush],
  );

  /* The two paths a debounce alone loses: the tab being hidden — on a phone
     often the last event before the process dies — and leaving this map. */
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === "hidden") void flush();
    };
    document.addEventListener("visibilitychange", onHide);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      if (timer.current) clearTimeout(timer.current);
      void flush();
    };
  }, [flush]);

  return {
    map:
      record && nodes
        ? {
            id: record.id,
            title: record.title,
            nodes,
            updatedAt: record.updatedAt,
          }
        : null,
    record,
    loading: detail.isLoading,
    loadError: detail.error,
    readOnlyReason,
    status,
    saveError,
    update,
    reload: detail.refetch,
  };
}

/**
 * An id unique within this session.
 *
 * Only ever a NEW card's id — the server stores whatever it is given and never
 * mints one, so two cards created in different tabs must not collide. The
 * timestamp is what makes that true; the counter is what separates two created
 * in the same millisecond.
 */
let counter = 0;
export function nextNodeId(): string {
  counter += 1;
  return `n${Date.now().toString(36)}${counter.toString(36)}`;
}
