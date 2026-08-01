"use client";

import { newNode, type MindMap } from "@/lib/rules/mindmap/tree";

/**
 * Where the mindmap lives.
 *
 * **`localStorage`, and this is a deliberate limit rather than an oversight.**
 * Every other surface in Cowork reads and writes through the repository seam,
 * and this one does not, for a reason worth stating: a mindmap is a thinking
 * tool, and putting one behind a new repository contract would mean ten new
 * methods, a mock, a Firestore collection and an engine route before anybody
 * could try the idea at all.
 *
 * What that costs, said plainly so nobody discovers it later:
 *
 *  · **It does not follow you between browsers or machines.**
 *  · **Nobody else can see it.** There is no sharing, and the page says so.
 *  · A cleared browser store clears the map with it.
 *
 * The seam is deliberate and narrow — `load`, `save`, `subscribe`. Moving this
 * to the repository means reimplementing those three against it and changing
 * nothing in the components, which read the map through `useMindMap` only.
 *
 * The external-store shape matches `lib/status/employeeStatus.ts` for the same
 * reason it does: `useSyncExternalStore` re-renders only the components that
 * actually read the map, and the writer is not above the reader in the tree.
 */

const KEY = "cowork.mindmap.v1";

function seed(): MindMap {
  const root = newNode("root", null, "New workspace");
  return {
    id: "default",
    title: "Workspace",
    nodes: [
      root,
      newNode("n1", "root", "First idea"),
      newNode("n2", "root", "Second idea"),
    ],
    updatedAt: new Date(0).toISOString(),
  };
}

/**
 * The in-memory copy every reader sees.
 *
 * Seeded rather than left null so the first render has a tree. `hydrated`
 * records whether the stored map has been read yet — the server cannot read
 * `localStorage`, so rendering the stored map during SSR would produce markup
 * the client immediately contradicts.
 */
let state: MindMap = seed();
let hydrated = false;
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getSnapshot(): MindMap {
  return state;
}

/**
 * The server's answer.
 *
 * A STABLE object, never a fresh `seed()`. `useSyncExternalStore` calls this on
 * every server render and throws if it returns a new reference each time.
 */
const SERVER_SNAPSHOT = seed();
export function getServerSnapshot(): MindMap {
  return SERVER_SNAPSHOT;
}

/** Whether the stored map has been read. False during SSR and first paint. */
export function isHydrated(): boolean {
  return hydrated;
}

/**
 * Read the stored map once.
 *
 * Anything unreadable is discarded in favour of the seed rather than throwing:
 * this is `localStorage`, the contents are editable by hand, and a corrupt
 * value must not leave the page blank with a console error as its only
 * explanation.
 */
export function hydrate(): void {
  if (hydrated) return;
  hydrated = true;
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as unknown;
    if (!isMindMap(parsed)) return;
    /* A map with no root cannot be laid out, so it is treated as unreadable
       rather than rendered as nothing. */
    if (!parsed.nodes.some((n) => n.parentId === null)) return;
    state = parsed;
  } catch {
    /* Keep the seed. */
  } finally {
    emit();
  }
}

function isMindMap(v: unknown): v is MindMap {
  if (!v || typeof v !== "object") return false;
  const m = v as Partial<MindMap>;
  return (
    typeof m.id === "string" &&
    Array.isArray(m.nodes) &&
    m.nodes.every(
      (n) =>
        !!n &&
        typeof n.id === "string" &&
        (n.parentId === null || typeof n.parentId === "string") &&
        typeof n.title === "string",
    )
  );
}

/** The last write that failed, or null. Surfaced rather than swallowed. */
let saveError: string | null = null;
export function getSaveError(): string | null {
  return saveError;
}

export function setMap(next: MindMap): void {
  state = { ...next, updatedAt: new Date().toISOString() };
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
    saveError = null;
  } catch {
    /* Almost always the quota, and almost always an attached image. Reported on
       screen: the change IS in memory and will be lost on refresh, and letting
       somebody keep working in ignorance of that is the worst outcome. */
    saveError =
      "This map is too large to save — the browser store is full. Remove an attached image; large pictures fill it fastest.";
  }
  emit();
}

/** Apply a pure transform from `rules/mindmap/tree`. */
export function update(fn: (map: MindMap) => MindMap): void {
  setMap(fn(state));
}

export function resetMap(): void {
  setMap(seed());
}

/** Ids that are unique within a session without needing a crypto dependency. */
let counter = 0;
export function nextNodeId(): string {
  counter += 1;
  return `n${Date.now().toString(36)}${counter.toString(36)}`;
}
