"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Icon } from "./Icons";

/**
 * A horizontal rail with page arrows and position dots.
 *
 * Structure taken from `Task_overview`'s projects band: a row of cards that
 * extends past both edges, circular previous/next controls at the extremes, and
 * a dot indicator beneath.
 *
 * One deliberate departure, recorded in REFERENCE_MAPPING: the reference dims
 * and shrinks every card except the centre one. That is a showcase device, and
 * this page has to support comparison — an at-risk project must be as readable
 * at the edge as in the middle. Every card here renders at full strength and
 * the rail simply scrolls. The structure is kept; the dimming is not.
 *
 * Arrows and dots are supplementary: the rail is natively scrollable and
 * keyboard-reachable, so nothing is only available through a button.
 */
export function Rail({
  children,
  count,
  label,
}: {
  children: ReactNode;
  /** Item count, for the dot indicator. */
  count: number;
  label: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ index: 0, atStart: true, atEnd: false });

  const measure = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    const step = max > 0 ? max / Math.max(1, count - 1) : 0;
    setPos({
      index: step > 0 ? Math.round(el.scrollLeft / step) : 0,
      atStart: el.scrollLeft <= 4,
      atEnd: el.scrollLeft >= max - 4,
    });
  }, [count]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // Measured from the scroll event rather than written during render, so no
    // state is set synchronously inside the effect body.
    el.addEventListener("scroll", measure, { passive: true });
    window.addEventListener("resize", measure);
    const id = requestAnimationFrame(measure);
    return () => {
      el.removeEventListener("scroll", measure);
      window.removeEventListener("resize", measure);
      cancelAnimationFrame(id);
    };
  }, [measure]);

  function page(dir: -1 | 1) {
    const el = ref.current;
    if (!el) return;
    el.scrollBy({
      left: dir * Math.round(el.clientWidth * 0.72),
      behavior: "smooth",
    });
  }

  function jump(i: number) {
    const el = ref.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    el.scrollTo({
      left: (max / Math.max(1, count - 1)) * i,
      behavior: "smooth",
    });
  }

  return (
    <div className="relative">
      <div
        ref={ref}
        role="group"
        aria-label={label}
        tabIndex={0}
        className="rail flex snap-x snap-mandatory gap-4 overflow-x-auto px-0.5 pb-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink"
      >
        {children}
      </div>

      {count > 1 && (
        <>
          <RailArrow dir={-1} disabled={pos.atStart} onClick={() => page(-1)} />
          <RailArrow dir={1} disabled={pos.atEnd} onClick={() => page(1)} />

          <div className="mt-3 flex items-center justify-center gap-1.5">
            {Array.from({ length: count }, (_, i) => (
              <button
                key={i}
                type="button"
                onClick={() => jump(i)}
                aria-label={`Go to item ${i + 1} of ${count}`}
                aria-current={i === pos.index}
                className={`h-1.5 rounded-full transition-[width,background-color] duration-[260ms] ease-[var(--ease-deck)] ${
                  i === pos.index
                    ? "w-5 bg-ink"
                    : "w-1.5 bg-[var(--control-active)]"
                }`}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function RailArrow({
  dir,
  disabled,
  onClick,
}: {
  dir: -1 | 1;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={dir === -1 ? "Scroll left" : "Scroll right"}
      className={`frost-bar absolute top-1/2 z-10 hidden h-9 w-9 -translate-y-1/2 place-items-center rounded-full text-ink transition-opacity sm:grid ${
        dir === -1 ? "-left-3" : "-right-3"
      } ${disabled ? "pointer-events-none opacity-0" : "opacity-100 hover:text-ink"}`}
    >
      {dir === -1 ? (
        <Icon.chevronRight className="h-4 w-4 rotate-180" />
      ) : (
        <Icon.chevronRight className="h-4 w-4" />
      )}
    </button>
  );
}
