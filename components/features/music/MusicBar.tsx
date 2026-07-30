"use client";

import Image from "next/image";
import Link from "next/link";
import { useMusic } from "./MusicContext";
import { Icon } from "@/components/ui/Icons";
import { playerCommands, usePlayerSnapshot } from "@/lib/music/playerBus";

/**
 * The persistent music bar.
 *
 * A utility, not a feature. It is deliberately the quietest fixed element in
 * Cowork: one line tall, the same frosted material as the rest of the deck, no
 * progress bar, no timings, no colour of its own, and a thumbnail that is a
 * picture rather than a control. Someone should be able to work all day beside
 * it without once being asked to look at it.
 *
 * The thumbnail is inert on purpose — no link, no hover state, no video, no
 * preview, `pointer-events-none` on the image itself. It exists so a glance
 * confirms what is playing, and nothing more. Everything that navigates is a
 * labelled control.
 *
 * Placement: bottom-left. The prototype bar owns the bottom centre, primary
 * page actions sit top-right, and the bottom-left corner is the one region of a
 * Cowork page that is reliably empty. Content scrolls clear of it because the
 * engine publishes a clearance the page adds to its own bottom padding.
 */
export function MusicBar() {
  const music = useMusic();
  const player = usePlayerSnapshot();
  const current = music.current;
  if (!current) return null;

  const isPlaying = player.phase === "playing" || player.phase === "buffering";

  return (
    <aside
      aria-label="Music"
      className="frost-bar fixed bottom-3 left-3 z-40 flex max-w-[calc(100vw-1.5rem)] items-center gap-2.5 rounded-full border border-hairline py-1.5 pr-2 pl-2.5 sm:max-w-[340px]"
    >
      {/* Static artwork. Not a link, not a button, not a video. */}
      <span
        aria-hidden="true"
        className="pointer-events-none relative h-7 w-7 shrink-0 overflow-hidden rounded-full bg-[var(--control)]"
      >
        <Image
          src={current.thumbnails.small}
          alt=""
          fill
          sizes="28px"
          className="pointer-events-none object-cover select-none"
          draggable={false}
          unoptimized
        />
      </span>

      <span className="min-w-0 flex-1">
        <span className="block truncate text-xs leading-tight text-ink">
          {current.title}
        </span>
        <span className="block truncate text-[11px] leading-tight text-ink-faint">
          {music.queueFinished ? "Queue finished" : current.channelTitle}
        </span>
      </span>

      <span className="flex shrink-0 items-center gap-0.5">
        <BarButton
          label="Previous track"
          onClick={music.previous}
          disabled={music.currentIndex <= 0}
        >
          <Icon.chevronRight className="h-3 w-3 rotate-180" />
        </BarButton>

        <BarButton
          label={music.queueFinished ? "Replay" : isPlaying ? "Pause" : "Play"}
          onClick={() =>
            music.queueFinished
              ? music.replay()
              : isPlaying
                ? music.requestPause()
                : music.requestPlay()
          }
        >
          {isPlaying ? (
            <Icon.pause className="h-3.5 w-3.5" />
          ) : (
            <Icon.play className="h-3.5 w-3.5" />
          )}
        </BarButton>

        <BarButton label="Next track" onClick={music.next}>
          <Icon.chevronRight className="h-3 w-3" />
        </BarButton>

        {/* Volume is a desktop affordance: on a phone the hardware keys are
            better than anything a slider this size could offer. */}
        <label className="ml-0.5 hidden items-center sm:flex">
          <span className="sr-only">Volume</span>
          <input
            type="range"
            min={0}
            max={100}
            step={5}
            value={music.prefs.muted ? 0 : music.prefs.volume}
            onChange={(e) => {
              const v = Number(e.target.value);
              music.setPrefs({ volume: v, muted: v === 0 });
              playerCommands().setVolume(v);
              playerCommands().setMuted(v === 0);
            }}
            aria-label="Volume"
            className="h-[3px] w-[52px] cursor-pointer appearance-none rounded-full bg-[var(--control-active)] accent-[var(--color-ink)]"
          />
        </label>

        <Link
          href="/music"
          aria-label="Open Music"
          title="Open Music"
          className="grid h-6 w-6 place-items-center rounded-full text-ink-faint transition-colors hover:bg-[var(--control)] hover:text-ink focus-visible:ring-2 focus-visible:ring-ink focus-visible:outline-none"
        >
          <Icon.chevronRight className="h-3 w-3" />
        </Link>
      </span>
    </aside>
  );
}

function BarButton({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className="grid h-6 w-6 shrink-0 place-items-center rounded-full text-ink-muted transition-colors hover:bg-[var(--control)] hover:text-ink focus-visible:ring-2 focus-visible:ring-ink focus-visible:outline-none disabled:opacity-30 disabled:hover:bg-transparent"
    >
      {children}
    </button>
  );
}
