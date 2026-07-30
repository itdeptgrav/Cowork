"use client";

import { useEffect, useRef, useState } from "react";
import { useMusic } from "./MusicContext";
import { MusicBar } from "./MusicBar";
import { useYouTubePlayer } from "@/lib/music/useYouTubePlayer";
import { publishCommands, publishSnapshot } from "@/lib/music/playerBus";

/**
 * The single YouTube player, mounted once by the shell.
 *
 * The iframe is never moved in the DOM — moving one reloads it, which would end
 * playback on every navigation. It stays in this element for the life of the
 * session; only its geometry changes.
 *
 *   · `/yt` registers a slot and the player is drawn over it at full size.
 *     This is the VIDEO surface: the player is visible, interactive and carries
 *     YouTube's own controls and branding.
 *   · Everywhere else — including `/music` — the product direction is audio
 *     only: no video, no iframe on the page, a static thumbnail instead.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE COMPLIANCE NOTE, because this is the one place it can be seen.
 *
 * In audio-only presentation the player continues to run off-screen. YouTube's
 * API Services Developer Policies require the embedded player to be visible and
 * unobscured while it plays, and offer no audio-only entitlement to third-party
 * embedders. So this configuration plays media in a way those policies do not
 * permit, and the size/visibility guard that normally enforces it has to be
 * switched off here or playback would stop immediately.
 *
 * It is implemented this way because it is the product direction, and it is
 * confined to this one constant so it is a one-line revert. `/yt` is the
 * compliant surface. Before shipping against YouTube's API, either route audio
 * through a source licensed for audio-only playback, or make `/music` present
 * the player the way `/yt` does.
 * ───────────────────────────────────────────────────────────────────────────── */
const AUDIO_ONLY_WHEN_OFF_VIDEO_ROUTE = true;

export function PlayerEngine() {
  const music = useMusic();
  const [frame, setFrame] = useState<HTMLDivElement | null>(null);

  const player = useYouTubePlayer({
    container: frame,
    videoId: music.current?.id ?? null,
    volume: music.prefs.volume,
    muted: music.prefs.muted,
    onEnded: music.next,
    onPlayingChange: music.reportPlaying,
    /* The guard only makes sense while the player is meant to be seen. */
    enforceVisibility: music.stage !== null,
  });

  /* Publish to the bus so pages can draw a clock and a scrubber without the
     whole application re-rendering twice a second on a context change. */
  const { phase, position, duration, message } = player;
  useEffect(() => {
    publishSnapshot({ phase, position, duration, message });
  }, [phase, position, duration, message]);

  const { play, pause, seek, setVolume, setMuted } = player;
  useEffect(() => {
    publishCommands({ play, pause, seek, setVolume, setMuted });
  }, [play, pause, seek, setVolume, setMuted]);

  /* Transport intents from anywhere in the app are consumed here — the only
     place that holds the player handle. */
  const lastNonce = useRef(0);
  useEffect(() => {
    if (music.intent.nonce === lastNonce.current) return;
    lastNonce.current = music.intent.nonce;
    if (music.intent.action === "play") player.play();
    if (music.intent.action === "pause") player.pause();
    if (music.intent.action === "replay") {
      player.seek(0);
      player.play();
    }
  }, [music.intent, player]);

  /* One polite announcement per track change, for screen readers. */
  const current = music.current;
  const [announce, setAnnounce] = useState("");
  const spokenFor = useRef<string | null>(null);
  useEffect(() => {
    if (!current || current.id === spokenFor.current) return;
    spokenFor.current = current.id;
    setAnnounce(`Now playing ${current.title} by ${current.channelTitle}`);
  }, [current]);

  /* The bar reserves no layout space, so the bottom of a page has to be able to
     scroll clear of it. A fixed figure rather than a measured one: the bar has
     one height, and a ResizeObserver does not deliver while a tab is hidden. */
  const barVisible = music.enabled && current !== null && music.stage === null;
  useEffect(() => {
    const root = document.documentElement;
    if (!barVisible) {
      root.style.removeProperty("--music-bar-clearance");
      return;
    }
    root.style.setProperty("--music-bar-clearance", "88px");
    return () => {
      root.style.removeProperty("--music-bar-clearance");
    };
  }, [barVisible]);

  if (!music.enabled || !current) return null;

  const rect = music.stage;
  const onVideoRoute = rect !== null;

  return (
    <>
      <div
        aria-hidden={onVideoRoute ? undefined : true}
        className={
          onVideoRoute
            ? "pointer-events-auto fixed z-20 overflow-hidden rounded-panel bg-black"
            : /* Audio-only presentation. See the note at the top of this file. */
              "pointer-events-none fixed h-[180px] w-[320px] opacity-0"
        }
        style={
          onVideoRoute
            ? {
                left: rect.left,
                top: rect.top,
                width: rect.width,
                height: rect.height,
              }
            : AUDIO_ONLY_WHEN_OFF_VIDEO_ROUTE
              ? { left: "-9999px", top: 0 }
              : { left: 12, bottom: 12, top: "auto" }
        }
      >
        {/* Always the first child, in both presentations. React reconciles by
            position, and an iframe that changes position in the tree reloads. */}
        <div ref={setFrame} className="h-full w-full" />
      </div>

      {!onVideoRoute && <MusicBar />}

      <p aria-live="polite" className="sr-only">
        {announce}
      </p>
    </>
  );
}
