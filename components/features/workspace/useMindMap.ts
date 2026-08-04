"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getRepository } from "@/lib/repositories";
import { useQuery } from "@/lib/hooks/useRepository";
import { editRefusal } from "@/lib/rules/mindmap/access";
import { crdtOf, isEmpty, readNodes, writeNodes } from "@/lib/rules/mindmap/collab";
import { mindmapTreeRefusal } from "@/lib/rules/mindmap/validity";
import type { CollabSession } from "@/lib/documents/collabProvider";
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
 *
 * ## When a live session is passed, the CRDT is the tree
 *
 * With a session the cards live in the shared document and every edit — anybody's
 * — arrives through it, which is what makes the canvas update while somebody
 * else is drawing on it. Without one, nothing changes: local state, debounced
 * save, exactly as before. **That fallback is load-bearing rather than
 * defensive** — the collaboration server can be unreachable and the mock backend
 * has none at all, and a mindmap that would not open in either case would be a
 * worse product than one that does not sync.
 *
 * The server write stays either way, and it is not redundant with the CRDT.
 * `GET /mindmaps/:id` returns `nodes`, the list reads `nodeCount`, and the
 * engine validates the tree on the way in — none of which the Yjs state
 * satisfies. It is the same division `DocumentEditor` uses when it writes `html`
 * beside the document's CRDT: the CRDT is how people collaborate, the projection
 * is what everything else reads.
 */

const SAVE_DEBOUNCE_MS = 1200;

export type SaveStatus = "idle" | "saving" | "saved" | "error";

export function useMindMap(
  mindmapId: string | null,
  /** The live session, when there is one. Null keeps the single-writer path. */
  session: CollabSession | null = null,
): {
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

  const [localNodes, setLocalNodes] = useState<MindNode[] | null>(null);
  const [status, setStatus] = useState<SaveStatus>("idle");
  const [saveError, setSaveError] = useState<string | null>(null);
  /* Bumped by the CRDT observers so the tree below can name it as a dependency
     rather than depending on a render side effect. Mirrors `SheetGrid`. */
  const [version, setVersion] = useState(0);

  const crdt = useMemo(() => (session ? crdtOf(session.doc) : null), [session]);

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
    /* The CRDT owns the tree once there is a session — adopting the server's
       cards over it would stamp on whatever the room already holds, including
       edits made while this tab was loading. Seeding is the effect below. */
    if (crdt) return;
    if (!detail.data || loadedStamp === null) return;
    if (adopted.current === loadedStamp) return;
    /* Local work not yet saved wins over a re-read of the same map: adopting
       here would silently discard the branch somebody is in the middle of. */
    if (dirty.current && adopted.current?.startsWith(`${detail.data.mindmap.id}:`))
      return;
    adopted.current = loadedStamp;
    setLocalNodes(detail.data.nodes);
    latest.current = detail.data.nodes;
    savingId.current = detail.data.mindmap.id;
    setStatus("idle");
    setSaveError(null);
  }, [crdt, detail.data, loadedStamp]);

  /**
   * Carry the stored map into the room, ONCE, and only if the room is empty.
   *
   * The emptiness check is what stops the second person to open a map writing a
   * copy of the server's cards over the live ones. Waiting for `synced` is what
   * makes that check meaningful: before the first sync a joined room always
   * looks empty, so seeding early would do exactly the damage the check exists
   * to prevent.
   */
  const seeded = useRef(false);
  useEffect(() => {
    if (!crdt || !session || !detail.data || seeded.current) return;
    const nodes = detail.data.nodes;
    const apply = () => {
      if (seeded.current) return;
      seeded.current = true;
      if (!isEmpty(crdt)) return;
      writeNodes(crdt, nodes);
    };
    if (session.provider.synced) apply();
    else session.provider.once("sync", apply);
  }, [crdt, session, detail.data]);

  /* Anybody's change, including this client's own. */
  useEffect(() => {
    if (!crdt) return;
    const bump = () => setVersion((n) => n + 1);
    crdt.nodes.observe(bump);
    crdt.order.observe(bump);
    return () => {
      crdt.nodes.unobserve(bump);
      crdt.order.unobserve(bump);
    };
  }, [crdt]);

  /** The authoritative tree: the CRDT when live, local state otherwise. */
  const nodes = useMemo(
    () => (crdt ? readNodes(crdt) : localNodes),
    /* `version` is the CRDT's change signal — it has no value of its own here. */
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [crdt, localNodes, version],
  );

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

      /* Through the CRDT when live, so every other person on this map sees it
         now rather than after a save-and-reload round trip. The observer above
         is what turns it back into a render, for this client too — there is no
         separate local apply, so what this tab draws is what the room holds. */
      if (crdt) writeNodes(crdt, next.nodes);
      else setLocalNodes(next.nodes);

      latest.current = next.nodes;
      savingId.current = record.id;
      dirty.current = true;
      setSaveError(null);
      setStatus("saving");
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void flush(), SAVE_DEBOUNCE_MS);
    },
    [record, readOnlyReason, nodes, flush, crdt],
  );

  /**
   * A collaborator's change, written through to the server too.
   *
   * The room keeps everybody's canvas in step, but nothing outside it reads the
   * CRDT: `GET /mindmaps/:id` returns `nodes` and the list reads `nodeCount`. If
   * only the person who typed saved, a map edited entirely by somebody else
   * would sit in the list with a stale card count and would open stale for
   * anybody who joined without a live session.
   *
   * Guarded on `readOnlyReason` because a viewer watching an editor work would
   * otherwise fire a request per change that the engine answers 403 — a viewer
   * has nothing to save, and saying so quietly is the whole of it.
   */
  useEffect(() => {
    if (!crdt || !record || readOnlyReason || version === 0) return;
    latest.current = readNodes(crdt);
    savingId.current = record.id;
    dirty.current = true;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void flush(), SAVE_DEBOUNCE_MS);
  }, [version, crdt, record, readOnlyReason, flush]);

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
