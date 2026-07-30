"use client";

import { useMusic } from "./MusicContext";
import { Icon } from "@/components/ui/Icons";
import { playerCommands, usePlayerSnapshot } from "@/lib/music/playerBus";

/**
 * Transport, seek and volume, for the `/music` page.
 *
 * These sit BESIDE and BELOW the video, never on top of it. YouTube's own
 * controls remain inside the iframe and are not duplicated there — these
 * operate the documented API from outside, which is what makes them a
 * companion rather than an overlay.
 *
 * State comes from the player bus rather than props: the player itself is owned
 * by the shell, and this page is one of the surfaces looking at it.
 */

function clock(secs: number): string {
  if (!Number.isFinite(secs) || secs < 0) return "0:00";
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function PlayerControls() {
  const music = useMusic();
  const player = usePlayerSnapshot();
  const isPlaying = player.phase === "playing" || player.phase === "buffering";
  const canSeek = player.duration > 0;

  const failed =
    player.phase === "unavailable" ||
    player.phase === "embedding_disabled" ||
    player.phase === "error";

  return (
    <div className="flex flex-col gap-2">
      {(failed || player.phase === "autoplay_blocked") && player.message && (
        <p
          role={failed ? "alert" : "status"}
          className={`flex items-start gap-1.5 text-[11px] ${
            failed ? "text-[var(--state-overdue-ink)]" : "text-ink-muted"
          }`}
        >
          {failed && <Icon.blocked className="mt-px h-3 w-3 shrink-0" />}
          <span className="min-w-0">
            {player.message}
            {failed && music.current && (
              <>
                {" "}
                <a
                  href={music.current.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline underline-offset-2"
                >
                  Open on YouTube
                </a>
              </>
            )}
          </span>
        </p>
      )}

      {/* Seek. Disabled rather than hidden while the duration is unknown, so
          the control never silently disappears mid-track. */}
      <label className="flex items-center gap-2">
        <span className="sr-only">Seek within the track</span>
        <input
          type="range"
          min={0}
          max={Math.max(1, Math.floor(player.duration))}
          step={1}
          value={Math.floor(player.position)}
          disabled={!canSeek}
          onChange={(e) => playerCommands().seek(Number(e.target.value))}
          aria-label="Seek"
          aria-valuetext={`${clock(player.position)} of ${clock(player.duration)}`}
          className="h-1 w-full cursor-pointer appearance-none rounded-full bg-[var(--control-active)] accent-[var(--color-ink)] disabled:cursor-not-allowed disabled:opacity-50"
        />
      </label>

      <div className="flex items-center gap-1">
        <IconButton
          label="Previous track"
          onClick={music.previous}
          disabled={music.currentIndex <= 0}
        >
          <Icon.chevronRight className="h-3.5 w-3.5 rotate-180" />
        </IconButton>

        <button
          type="button"
          onClick={() =>
            isPlaying ? music.requestPause() : music.requestPlay()
          }
          aria-label={isPlaying ? "Pause" : "Play"}
          className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-ink text-[var(--body-bg)] transition-opacity hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2 focus-visible:outline-none"
        >
          {isPlaying ? (
            <Icon.pause className="h-4 w-4" />
          ) : (
            <Icon.play className="h-4 w-4" />
          )}
        </button>

        <IconButton label="Next track" onClick={music.next}>
          <Icon.chevronRight className="h-3.5 w-3.5" />
        </IconButton>

        <span
          data-figure
          className="ml-1 shrink-0 text-[11px] text-ink-faint"
          aria-hidden="true"
        >
          {clock(player.position)} / {clock(player.duration)}
        </span>

        <span className="ml-auto flex items-center gap-1">
          <IconButton
            label={music.prefs.muted ? "Unmute" : "Mute"}
            onClick={() => {
              const next = !music.prefs.muted;
              music.setPrefs({ muted: next });
              playerCommands().setMuted(next);
            }}
          >
            {music.prefs.muted ? (
              <Icon.volumeOff className="h-3.5 w-3.5" />
            ) : (
              <Icon.volume className="h-3.5 w-3.5" />
            )}
          </IconButton>

          <label className="flex items-center gap-1.5">
            <span className="sr-only">Volume</span>
            <input
              type="range"
              min={0}
              max={100}
              step={5}
              value={music.prefs.volume}
              onChange={(e) => {
                const v = Number(e.target.value);
                music.setPrefs({ volume: v, muted: false });
                playerCommands().setVolume(v);
                playerCommands().setMuted(false);
              }}
              aria-label="Volume"
              className="h-1 w-[76px] cursor-pointer appearance-none rounded-full bg-[var(--control-active)] accent-[var(--color-ink)]"
            />
          </label>
        </span>
      </div>

      <p aria-live="polite" className="sr-only">
        {player.phase === "buffering"
          ? "Buffering"
          : player.phase === "playing"
            ? "Playing"
            : player.phase === "paused"
              ? "Paused"
              : player.phase === "ended"
                ? "Track ended"
                : ""}
      </p>
    </div>
  );
}

function IconButton({
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
      className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-ink-muted transition-colors hover:bg-[var(--control)] hover:text-ink focus-visible:ring-2 focus-visible:ring-ink focus-visible:outline-none disabled:opacity-40 disabled:hover:bg-transparent"
    >
      {children}
    </button>
  );
}
