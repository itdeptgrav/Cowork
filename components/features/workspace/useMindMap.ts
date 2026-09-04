"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getRepository } from "@/lib/repositories";
import { useQuery } from "@/lib/hooks/useRepository";
import { editRefusal } from "@/lib/rules/mindmap/access";
import { crdtOf, isEmpty, readExtras, readNodes, writeExtras, writeNodes } from "@/lib/rules/mindmap/collab";
import { mindmapTreeRefusal } from "@/lib/rules/mindmap/validity";
import { pruneExtras } from "@/lib/rules/mindmap/extras";
import type { CollabSession } from "@/lib/documents/collabProvider";
import type { MindMap } from "@/lib/rules/mindmap/tree";
import { emptyExtras, type MindMapExtras, type MindMapRecord, type MindNode } from "@/lib/domain";

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
  /** Step back through this session's edits. No-ops when there is nothing to undo. */
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  reload: () => void;
} {
  const detail = useQuery(
    (r) => (mindmapId ? r.getMindMap(mindmapId) : Promise.resolve(null)),
    [mindmapId],
  );
  const me = useQuery((r) => r.getCurrentEmployee(), []);

  const [localNodes, setLocalNodes] = useState<MindNode[] | null>(null);
  /* The map-level extras — layout, theme, relationships, groupings — held the
     same way the cards are: locally when single-writer, in the room when live. */
  const [localExtras, setLocalExtras] = useState<MindMapExtras | null>(null);
  const [status, setStatus] = useState<SaveStatus>("idle");
  const [saveError, setSaveError] = useState<string | null>(null);
  /* Bumped by the CRDT observers so the tree below can name it as a dependency
     rather than depending on a render side effect. Mirrors `SheetGrid`. */
  const [version, setVersion] = useState(0);

  const crdt = useMemo(() => (session ? crdtOf(session.doc) : null), [session]);

  /**
   * Undo history — this session's, this person's.
   *
   * A stack of whole trees rather than inverse operations: the tree is small
   * (2,000 cards at most, usually a few dozen) and a snapshot per edit is what
   * makes undo trivially correct for every operation, including ones the AI
   * assistant makes. Structural edits are what people most want back.
   *
   * **Consecutive edits to one card's text are folded into one entry.** Typing
   * a title is thirty updates; thirty presses of ⌘Z to get the old title back
   * would be a stack nobody uses. An edit to a different card, or a structural
   * edit, or a pause longer than `COALESCE_MS`, closes the entry.
   *
   * In a live session undo writes through the same reconcile as any edit, so a
   * collaborator sees it as one more change — it is not a rollback of their
   * work, only of this client's last step, against whatever the tree is now.
   */
  type Snapshot = { nodes: MindNode[]; extras: MindMapExtras };
  const past = useRef<Snapshot[]>([]);
  const future = useRef<Snapshot[]>([]);
  const lastEditAt = useRef(0);
  const lastEditKey = useRef<string | null>(null);
  /* The stack DEPTHS, as state, because the render needs them for the buttons
     and a ref cannot be read during render. Stamped with the map they belong
     to: a different map is a different history, and keying on the id is what
     lets the old counts read as zero the moment another map opens, with no
     effect needed to clear them. */
  const [history, setHistory] = useState<{ mapId: string | null; past: number; future: number }>({
    mapId: null,
    past: 0,
    future: 0,
  });
  /** Drop a history that belongs to a map other than the one open. */
  const ownHistory = useCallback(() => {
    if (history.mapId === mindmapId) return;
    past.current = [];
    future.current = [];
    lastEditKey.current = null;
  }, [history.mapId, mindmapId]);
  const publishHistory = useCallback(
    () =>
      setHistory({ mapId: mindmapId, past: past.current.length, future: future.current.length }),
    [mindmapId],
  );

  const dirty = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef<MindNode[]>([]);
  const latestExtras = useRef<MindMapExtras | null>(null);
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
    setLocalExtras(detail.data.extras);
    latest.current = detail.data.nodes;
    latestExtras.current = detail.data.extras;
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
    const extras = detail.data.extras;
    const apply = () => {
      if (seeded.current) return;
      seeded.current = true;
      if (!isEmpty(crdt)) return;
      writeNodes(crdt, nodes);
      writeExtras(crdt, extras);
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
    crdt.extras.observe(bump);
    return () => {
      crdt.nodes.unobserve(bump);
      crdt.order.unobserve(bump);
      crdt.extras.unobserve(bump);
    };
  }, [crdt]);

  /** The authoritative tree: the CRDT when live, local state otherwise. */
  const nodes = useMemo(
    () => (crdt ? readNodes(crdt) : localNodes),
    /* `version` is the CRDT's change signal — it has no value of its own here. */
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [crdt, localNodes, version],
  );

  /** The authoritative extras: the room's when live, local state otherwise. */
  const extras = useMemo(
    () => (crdt ? readExtras(crdt) : (localExtras ?? emptyExtras())),
    // `version` is the CRDT's change signal — it has no value of its own here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [crdt, localExtras, version],
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
      const result = await getRepository().saveMindMapNodes(
        id,
        latest.current,
        latestExtras.current ?? undefined,
      );
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
      const currentExtras = extras;
      const next = fn({
        id: record.id,
        title: record.title,
        nodes: current,
        updatedAt: record.updatedAt,
        extras: currentExtras,
      });
      /* Whatever the edit did, the extras must not name a card that is gone.
         `pruneExtras` hands back the same object when nothing was dropped, so
         an ordinary edit still compares equal below. */
      const nextExtras = pruneExtras(next.extras ?? currentExtras, next.nodes);

      /* Checked BEFORE it is applied, with the rule the engine uses. A tree
         that cannot be stored never becomes the tree on screen. */
      const refusal = mindmapTreeRefusal(next.nodes);
      if (refusal) {
        setSaveError(refusal);
        return;
      }

      /* Remember where we were. `fn` is opaque, so which card changed is
         worked out by diffing — a single card differing in title or description
         only is a text edit and folds into the previous entry when it is the
         same card and recent enough. */
      ownHistory();
      /* A change to the extras is never a text edit, so it always closes the
         entry — switching the layout must be one ⌘Z, not folded into typing. */
      const key = nextExtras === currentExtras ? textEditKey(current, next.nodes) : null;
      const now = Date.now();
      const fold =
        key !== null && key === lastEditKey.current && now - lastEditAt.current < COALESCE_MS;
      if (!fold) {
        past.current.push({ nodes: current, extras: currentExtras });
        if (past.current.length > HISTORY_LIMIT) past.current.shift();
        future.current = [];
      }
      lastEditKey.current = key;
      lastEditAt.current = now;
      publishHistory();

      /* Through the CRDT when live, so every other person on this map sees it
         now rather than after a save-and-reload round trip. The observer above
         is what turns it back into a render, for this client too — there is no
         separate local apply, so what this tab draws is what the room holds. */
      if (crdt) {
        writeNodes(crdt, next.nodes);
        if (nextExtras !== currentExtras) writeExtras(crdt, nextExtras);
      } else {
        setLocalNodes(next.nodes);
        if (nextExtras !== currentExtras) setLocalExtras(nextExtras);
      }

      latest.current = next.nodes;
      latestExtras.current = nextExtras;
      savingId.current = record.id;
      dirty.current = true;
      setSaveError(null);
      setStatus("saving");
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void flush(), SAVE_DEBOUNCE_MS);
    },
    [record, readOnlyReason, nodes, extras, flush, crdt, ownHistory, publishHistory],
  );

  /** Put a remembered tree back, through the ordinary write path. */
  const applySnapshot = useCallback(
    ({ nodes, extras: snapExtras }: Snapshot) => {
      if (!record || readOnlyReason) return;
      if (crdt) {
        writeNodes(crdt, nodes);
        writeExtras(crdt, snapExtras);
      } else {
        setLocalNodes(nodes);
        setLocalExtras(snapExtras);
      }
      latest.current = nodes;
      latestExtras.current = snapExtras;
      savingId.current = record.id;
      dirty.current = true;
      setSaveError(null);
      setStatus("saving");
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void flush(), SAVE_DEBOUNCE_MS);
    },
    [record, readOnlyReason, crdt, flush],
  );

  const undo = () => {
    ownHistory();
    const prev = past.current.pop();
    if (!prev) return;
    future.current.push({ nodes: nodes ?? [], extras });
    lastEditKey.current = null;
    publishHistory();
    applySnapshot(prev);
  };

  const redo = () => {
    ownHistory();
    const next = future.current.pop();
    if (!next) return;
    past.current.push({ nodes: nodes ?? [], extras });
    lastEditKey.current = null;
    publishHistory();
    applySnapshot(next);
  };

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
    latestExtras.current = readExtras(crdt);
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
            extras,
          }
        : null,
    record,
    loading: detail.isLoading,
    loadError: detail.error,
    readOnlyReason,
    status,
    saveError,
    update,
    undo,
    redo,
    canUndo: history.mapId === mindmapId && history.past > 0,
    canRedo: history.mapId === mindmapId && history.future > 0,
    reload: detail.refetch,
  };
}

const COALESCE_MS = 900;
const HISTORY_LIMIT = 200;

/**
 * `"<id>:text"` when exactly one card differs and only in its title or
 * description; null for anything structural or wider. Cheap: the common case
 * is one card's text changing and the arrays are otherwise the same objects.
 */
function textEditKey(before: MindNode[], after: MindNode[]): string | null {
  if (before.length !== after.length) return null;
  let changed: MindNode | null = null;
  for (let i = 0; i < after.length; i++) {
    const a = before[i];
    const b = after[i];
    if (a === b) continue;
    if (a.id !== b.id || a.parentId !== b.parentId || a.collapsed !== b.collapsed) return null;
    if (a.links !== b.links || a.images !== b.images) return null;
    if (changed) return null;
    changed = b;
  }
  return changed ? `${changed.id}:text` : null;
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
