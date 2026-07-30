"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import type { Lens } from "@/lib/utils/types";

/**
 * The lens is Cowork's visibility boundary, not a view preference.
 *
 * docs/architecture/PRODUCT.md (confirmed): an individual sees their own score only, never a
 * peer's and never their position relative to peers. A manager sees the people
 * reporting to them, including how those people compare to each other — and
 * that comparison exists only looking down the reporting chain.
 *
 * So `private` renders one person and no peers; `team` renders the roster with
 * comparison. Because it is shared between the top bar and the page body, it
 * lives in context rather than in either one.
 *
 * It also PERSISTS, in `localStorage` and in the URL. For a manager the team
 * lens is not a detour, it is where they work — and holding it in component
 * state alone meant every refresh, every shared link and every restored tab
 * dropped them back into their own private view. The URL carries it so a view
 * can be linked; storage carries it so a bare `/` restores the last choice.
 */

export const LENS_STORAGE_KEY = "cowork-lens";
const STORAGE_KEY = LENS_STORAGE_KEY;

interface LensValue {
  lens: Lens;
  setLens: (l: Lens) => void;
}

const LensContext = createContext<LensValue | null>(null);

export function LensProvider({ children }: { children: ReactNode }) {
  // Server and first client render agree on the documented default; the effect
  // below corrects it, in the same shape the theme provider uses.
  const [lens, setLensState] = useState<Lens>("private");

  useEffect(() => {
    // Deferred a frame rather than run in the effect body: this syncs React to
    // two external systems and doing it synchronously cascades a render.
    const id = requestAnimationFrame(() => {
      const fromUrl = new URLSearchParams(window.location.search).get("lens");
      const stored = window.localStorage.getItem(STORAGE_KEY);
      const next = fromUrl ?? stored;
      if (next === "team" || next === "private") setLensState(next);
    });
    return () => cancelAnimationFrame(id);
  }, []);

  const setLens = useCallback((l: Lens) => {
    setLensState(l);
    try {
      window.localStorage.setItem(STORAGE_KEY, l);
    } catch {
      // A blocked storage write must never break the boundary control itself.
    }
    // `replaceState`, not a router push: switching lens is not a navigation and
    // must not stack history entries a person then has to back out through.
    const url = new URL(window.location.href);
    if (l === "private") url.searchParams.delete("lens");
    else url.searchParams.set("lens", l);
    window.history.replaceState(null, "", url);
  }, []);

  return (
    <LensContext.Provider value={{ lens, setLens }}>
      {children}
    </LensContext.Provider>
  );
}

export function useLens(): LensValue {
  const ctx = useContext(LensContext);
  if (!ctx) throw new Error("useLens must be used inside <LensProvider>");
  return ctx;
}
