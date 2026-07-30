"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

/**
 * Theme: light, dark, or follow the system.
 *
 * Three problems this has to solve, and how:
 *
 *  1. FLASH — the resolved theme must be on <html> before first paint. A
 *     blocking inline script in <head> does that (see `themeScript`), so React
 *     never gets a chance to render the wrong theme.
 *  2. HYDRATION — the server cannot know the stored preference, so it must not
 *     render anything that depends on it. The provider starts at the documented
 *     default and syncs from the DOM in an effect; controls that display the
 *     current choice render a stable skeleton until `mounted`.
 *  3. TRANSITION FLICKER — the `theme-ready` class is added one frame after
 *     mount, so the colour transition never runs during the initial paint.
 */

export type ThemePreference = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

const STORAGE_KEY = "cowork-theme";

interface ThemeContextValue {
  preference: ThemePreference;
  resolved: ResolvedTheme;
  setPreference: (p: ThemePreference) => void;
  /** False during SSR and the first client render. */
  mounted: boolean;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

/**
 * Runs before paint. Kept deliberately tiny and dependency-free — it is inlined
 * into the document head and any error here would leave the page unstyled.
 */
export const themeScript = `(function(){try{var k="${STORAGE_KEY}";var p=localStorage.getItem(k)||"system";var m=window.matchMedia("(prefers-color-scheme: dark)").matches;var r=p==="system"?(m?"dark":"light"):p;document.documentElement.setAttribute("data-theme",r);document.documentElement.style.colorScheme=r;}catch(e){document.documentElement.setAttribute("data-theme","light");}})();`;

export function ThemeProvider({ children }: { children: ReactNode }) {
  // Server and first client render agree on these values; the effect below
  // corrects them from the DOM the inline script already set.
  const [preference, setPreferenceState] = useState<ThemePreference>("system");
  const [resolved, setResolved] = useState<ResolvedTheme>("light");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    // Deferred to the next frame rather than run synchronously: this is
    // syncing React to an external system (localStorage plus an attribute the
    // pre-paint script already set), and doing it in the effect body would
    // cascade a render. The same frame is where `theme-ready` lands, so the
    // colour transition still cannot catch the initial paint.
    const id = requestAnimationFrame(() => {
      const stored =
        (localStorage.getItem(STORAGE_KEY) as ThemePreference) || "system";
      const attr = document.documentElement.getAttribute("data-theme");
      setPreferenceState(stored);
      setResolved(attr === "dark" ? "dark" : "light");
      setMounted(true);
      document.documentElement.classList.add("theme-ready");
    });
    return () => cancelAnimationFrame(id);
  }, []);

  /**
   * Keep the document in step with the preference, and follow the OS only
   * while that preference is "system".
   *
   * `mounted` is load-bearing, not decorative. `preference` starts at the
   * SSR-safe default of "system", and this effect used to run on that value
   * before the effect above had read the stored preference — so on every load
   * with a saved light preference under a dark OS, it overwrote the correct
   * attribute the pre-paint script had already set, and never put it back.
   * Storage said "light" and the page rendered dark, permanently. Caught by
   * setting the preference, navigating, and finding the theme reverted.
   */
  useEffect(() => {
    if (!mounted) return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      const next: ResolvedTheme =
        preference === "system" ? (mq.matches ? "dark" : "light") : preference;
      setResolved(next);
      document.documentElement.setAttribute("data-theme", next);
      document.documentElement.style.colorScheme = next;
    };
    apply();
    if (preference !== "system") return;
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, [preference, mounted]);

  const setPreference = useCallback((p: ThemePreference) => {
    setPreferenceState(p);
    localStorage.setItem(STORAGE_KEY, p);
    const next: ResolvedTheme =
      p === "system"
        ? window.matchMedia("(prefers-color-scheme: dark)").matches
          ? "dark"
          : "light"
        : p;
    setResolved(next);
    document.documentElement.setAttribute("data-theme", next);
    document.documentElement.style.colorScheme = next;
  }, []);

  return (
    <ThemeContext.Provider
      value={{ preference, resolved, setPreference, mounted }}
    >
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used inside ThemeProvider");
  return ctx;
}
