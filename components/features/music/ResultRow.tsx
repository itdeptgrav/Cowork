"use client";

import Image from "next/image";
import { useMusic } from "./MusicContext";
import { Icon } from "@/components/ui/Icons";
import { Chip } from "@/components/ui/Primitives";
import type { MusicResult, SourceHint } from "@/lib/domain";

/**
 * One search result, favourite or queue entry.
 *
 * Source chips state EVIDENCE, never a verdict. YouTube exposes no "official"
 * flag, so the only claims made here are things the metadata literally says:
 * this is an auto-generated Topic channel, this is a VEVO channel, this title
 * calls itself an official video. The word "Official" appears only where the
 * channel or the title said it first.
 */

const HINT_LABEL: Partial<Record<SourceHint, string>> = {
  vevo: "VEVO channel",
  topic_channel: "Artist topic channel",
  artist_channel: "Artist channel",
  label_channel: "Label channel",
  official_video: "Official video",
  official_audio: "Official audio",
  lyric_video: "Lyrics",
};

/** Ranked, so the single chip shown is the strongest evidence available. */
const HINT_ORDER: SourceHint[] = [
  "vevo",
  "topic_channel",
  "artist_channel",
  "label_channel",
  "official_video",
  "official_audio",
  "lyric_video",
];

function duration(secs: number | null): string | null {
  if (secs === null) return null;
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  return h
    ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
    : `${m}:${String(s).padStart(2, "0")}`;
}

function year(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : String(d.getUTCFullYear());
}

/** 1,204,000 plays reads as "1.2M plays". Precision here would be noise. */
function plays(views: number | null): string | null {
  if (!views || views <= 0) return null;
  if (views >= 1_000_000_000)
    return `${(views / 1_000_000_000).toFixed(1)}B plays`;
  if (views >= 1_000_000) return `${(views / 1_000_000).toFixed(1)}M plays`;
  if (views >= 1_000) return `${Math.round(views / 1_000)}K plays`;
  return `${views} plays`;
}

export function ResultRow({
  item,
  index,
  variant = "result",
  onMove,
  onRemove,
}: {
  item: MusicResult;
  index?: number;
  variant?: "result" | "queue";
  onMove?: (from: number, to: number) => void;
  onRemove?: (index: number) => void;
}) {
  const music = useMusic();
  const isCurrent = music.current?.id === item.id;
  const fav = music.isFavourite(item.id);
  const len = duration(item.durationSecs);
  const yr = year(item.publishedAt);
  const played = plays(item.viewCount);
  const chip = HINT_ORDER.find((h) => item.sourceHints.includes(h));

  return (
    /* The row has to survive two very different widths: the wide results column
       and the narrow supporting column. A container query — not a viewport one
       — is the honest test, because what changes is the width of this list, not
       the size of the screen. Below 380px the actions drop to their own line
       rather than squeezing the title down to one letter. */
    <li
      className={`group flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 transition-colors hover:bg-[var(--row-hover)] ${
        isCurrent ? "bg-[var(--row-live)]" : ""
      }`}
    >
      {/* Artwork stays small on purpose. This is a work tool with music in it,
          not a music app — oversized art would make the page video-first. */}
      <span className="relative h-10 w-[72px] shrink-0 overflow-hidden rounded-inset bg-[var(--control)]">
        <Image
          src={item.thumbnails.small}
          alt=""
          fill
          sizes="72px"
          className="object-cover"
          unoptimized
        />
      </span>

      <span className="min-w-0 flex-1 basis-[120px]">
        <span className="flex items-center gap-1.5">
          {isCurrent && (
            <span
              aria-hidden="true"
              className="relative flex h-1.5 w-1.5 shrink-0 text-ink"
            >
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-current opacity-60" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-current" />
            </span>
          )}
          <span className="truncate text-sm text-ink">{item.title}</span>
        </span>
        <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-ink-faint">
          <span className="truncate">{item.channelTitle}</span>
          {len && <span data-figure>{len}</span>}
          {yr && <span data-figure>{yr}</span>}
          {played && <span data-figure>{played}</span>}
          {chip && <Chip>{HINT_LABEL[chip]}</Chip>}
        </span>
      </span>

      <span className="flex w-full shrink-0 items-center justify-end gap-0.5 @[380px]:w-auto">
        {variant === "queue" && typeof index === "number" && (
          <>
            {/* Keyboard-operable reordering. Drag alone would exclude anyone
                not using a mouse. */}
            <Act
              label={`Move ${item.title} up`}
              disabled={index === 0}
              onClick={() => onMove?.(index, index - 1)}
            >
              <Icon.chevronDown className="h-3.5 w-3.5 rotate-180" />
            </Act>
            <Act
              label={`Move ${item.title} down`}
              disabled={index === music.queue.length - 1}
              onClick={() => onMove?.(index, index + 1)}
            >
              <Icon.chevronDown className="h-3.5 w-3.5" />
            </Act>
          </>
        )}

        <Act label={`Play ${item.title}`} onClick={() => music.playNow(item)}>
          <Icon.play className="h-3.5 w-3.5" />
        </Act>

        {variant === "result" && (
          <Act
            label={`Add ${item.title} to the queue`}
            onClick={() => music.enqueue(item)}
          >
            <Icon.queue className="h-3.5 w-3.5" />
          </Act>
        )}

        <Act
          label={
            fav
              ? `Remove ${item.title} from favourites`
              : `Save ${item.title} to favourites`
          }
          pressed={fav}
          onClick={() => music.toggleFavourite(item)}
        >
          <Icon.heart className={`h-3.5 w-3.5 ${fav ? "fill-current" : ""}`} />
        </Act>

        {variant === "queue" && typeof index === "number" && (
          <Act
            label={`Remove ${item.title} from the queue`}
            onClick={() => onRemove?.(index)}
          >
            <Icon.close className="h-3.5 w-3.5" />
          </Act>
        )}

        <a
          href={item.url}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`Open ${item.title} on YouTube in a new tab`}
          title="Open on YouTube"
          className="grid h-8 w-8 place-items-center rounded-full text-ink-faint transition-colors hover:bg-[var(--control)] hover:text-ink focus-visible:ring-2 focus-visible:ring-ink focus-visible:outline-none"
        >
          <Icon.external className="h-3.5 w-3.5" />
        </a>
      </span>
    </li>
  );
}

function Act({
  label,
  onClick,
  disabled,
  pressed,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  pressed?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      aria-pressed={pressed}
      title={label}
      className={`grid h-8 w-8 place-items-center rounded-full transition-colors hover:bg-[var(--control)] hover:text-ink focus-visible:ring-2 focus-visible:ring-ink focus-visible:outline-none disabled:opacity-35 disabled:hover:bg-transparent ${
        pressed ? "text-ink" : "text-ink-faint"
      }`}
    >
      {children}
    </button>
  );
}
