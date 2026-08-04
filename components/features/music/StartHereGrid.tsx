"use client";

import Image from "next/image";
import { useMusic } from "./MusicContext";
import { Icon } from "@/components/ui/Icons";
import { Skeleton } from "@/components/ui/Primitives";
import type { MusicResult } from "@/lib/domain";

/**
 * "Start here", as real thumbnail cards rather than plain text prompts.
 *
 * Compact by design, not YouTube-sized — this stays a work tool with music in
 * it, matching the small artwork `ResultRow` already commits to elsewhere on
 * this page. What's shown is real search results for a few preset/personal
 * queries (see `loadStartHere` in `MusicContext.tsx` for the quota story),
 * capped at three per query so one broad preset can't crowd out the rest.
 */

function duration(secs: number | null): string | null {
  if (secs === null) return null;
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  return h
    ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
    : `${m}:${String(s).padStart(2, "0")}`;
}

export function StartHereGrid({ items }: { items: MusicResult[] }) {
  const music = useMusic();

  return (
    <ul className="grid grid-cols-2 gap-3 pb-2 sm:grid-cols-3">
      {items.map((item) => {
        const fav = music.isFavourite(item.id);
        const len = duration(item.durationSecs);
        return (
          <li key={item.id}>
            <div className="group relative">
              <button
                type="button"
                onClick={() => music.playNow(item)}
                aria-label={`Play ${item.title}`}
                className="block w-full text-left"
              >
                <span className="relative block aspect-video w-full overflow-hidden rounded-inset bg-[var(--control)]">
                  <Image
                    src={item.thumbnails.medium}
                    alt=""
                    fill
                    sizes="(min-width: 640px) 33vw, 50vw"
                    className="object-cover transition-transform duration-200 group-hover:scale-[1.03]"
                    unoptimized
                  />
                  {len && (
                    <span
                      data-figure
                      className="absolute right-1 bottom-1 rounded bg-black/75 px-1 py-0.5 text-[10px] font-medium text-white"
                    >
                      {len}
                    </span>
                  )}
                  <span className="absolute inset-0 flex items-center justify-center opacity-0 transition-opacity group-hover:opacity-100">
                    <span className="grid h-8 w-8 place-items-center rounded-full bg-black/60 text-white">
                      <Icon.play className="h-3.5 w-3.5" />
                    </span>
                  </span>
                </span>
                <span className="mt-1.5 block truncate text-[13px] text-ink">
                  {item.title}
                </span>
                <span className="block truncate text-[11px] text-ink-faint">
                  {item.channelTitle}
                </span>
              </button>

              <button
                type="button"
                onClick={() => music.toggleFavourite(item)}
                aria-label={
                  fav
                    ? `Remove ${item.title} from favourites`
                    : `Save ${item.title} to favourites`
                }
                aria-pressed={fav}
                className={`absolute top-1.5 right-1.5 grid h-7 w-7 place-items-center rounded-full bg-black/50 text-white transition-opacity focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-white focus-visible:outline-none ${
                  fav ? "opacity-100" : "opacity-0 group-hover:opacity-100"
                }`}
              >
                <Icon.heart className={`h-3.5 w-3.5 ${fav ? "fill-current" : ""}`} />
              </button>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

export function StartHereGridSkeleton() {
  return (
    <div
      className="grid grid-cols-2 gap-3 pb-2 sm:grid-cols-3"
      role="status"
      aria-label="Loading suggestions"
    >
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i}>
          <Skeleton block className="aspect-video w-full rounded-inset" />
          <Skeleton className="mt-1.5 h-3.5" style={{ width: `${60 + (i % 3) * 10}%` }} />
          <Skeleton className="mt-1 h-3 w-1/2" />
        </div>
      ))}
    </div>
  );
}
