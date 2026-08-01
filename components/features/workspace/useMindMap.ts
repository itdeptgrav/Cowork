"use client";

import { useEffect, useSyncExternalStore } from "react";
import {
  getSaveError,
  getServerSnapshot,
  getSnapshot,
  hydrate,
  isHydrated,
  subscribe,
} from "@/lib/mindmap/store";
import type { MindMap } from "@/lib/rules/mindmap/tree";

/**
 * The map, and whether it is the stored one yet.
 *
 * `hydrated` matters on screen rather than only internally: until the stored
 * map has been read, what is rendered is the seed, and offering an "empty map"
 * message or a delete control against it would be acting on a map that is not
 * the person's.
 */
export function useMindMap(): {
  map: MindMap;
  hydrated: boolean;
  saveError: string | null;
} {
  const map = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  /* Read from storage after mount, never during render: the server has no
     `localStorage`, and reading it in the render body would make the first
     client paint disagree with the markup the server sent. */
  useEffect(() => {
    hydrate();
  }, []);

  return { map, hydrated: isHydrated(), saveError: getSaveError() };
}
