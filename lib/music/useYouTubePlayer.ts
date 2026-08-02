"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  IDLE_TRANSPORT,
  advance,
  canDeclareBlocked,
  type TransportEvent,
} from "./transport.ts";

/**
 * The YouTube IFrame Player API, wrapped.
 *
 * Everything about this is deliberately literal: the player is a real iframe,
 * created by YouTube's own script, in a container we mount and never cover.
 * We do not proxy, transform, extract or re-host anything, and we do not touch
 * the iframe's internals — we ask the documented API to do things and we listen
 * to the documented events.
 *
 * The one rule enforced in code rather than in prose: if the iframe stops being
 * genuinely visible at a usable size, playback pauses. A hidden player with
 * audio running is exactly what the platform forbids, so an IntersectionObserver
 * and a ResizeObserver hold us to it.
 */

export type PlayerPhase =
  | "idle"
  | "loading"
  | "ready"
  | "buffering"
  | "playing"
  | "paused"
  | "ended"
  | "unavailable"
  | "embedding_disabled"
  | "autoplay_blocked"
  | "error";

/** Minimal surface of the global the API script installs. */
interface YTPlayer {
  playVideo(): void;
  pauseVideo(): void;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  setVolume(v: number): void;
  mute(): void;
  unMute(): void;
  getCurrentTime(): number;
  getDuration(): number;
  loadVideoById(id: string): void;
  cueVideoById(id: string): void;
  destroy(): void;
}
interface YTNamespace {
  Player: new (el: HTMLElement, opts: Record<string, unknown>) => YTPlayer;
  PlayerState: Record<string, number>;
}
declare global {
  interface Window {
    YT?: YTNamespace;
    onYouTubeIframeAPIReady?: () => void;
  }
}

let apiPromise: Promise<YTNamespace> | null = null;

/** Loads the official API script once per document and reuses it. */
function loadApi(): Promise<YTNamespace> {
  if (typeof window === "undefined") return Promise.reject(new Error("server"));
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (apiPromise) return apiPromise;

  apiPromise = new Promise<YTNamespace>((resolve, reject) => {
    const prior = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      prior?.();
      if (window.YT?.Player) resolve(window.YT);
      else reject(new Error("YouTube IFrame API loaded without a Player"));
    };
    const tag = document.createElement("script");
    tag.src = "https://www.youtube.com/iframe_api";
    tag.async = true;
    tag.onerror = () => reject(new Error("Could not load the YouTube player"));
    document.head.appendChild(tag);
  });
  return apiPromise;
}

export interface PlayerApi {
  phase: PlayerPhase;
  /** Seconds. Polled while playing; exact enough for a scrubber. */
  position: number;
  duration: number;
  play(): void;
  pause(): void;
  seek(seconds: number): void;
  setVolume(v: number): void;
  setMuted(m: boolean): void;
  /** The message shown for the current failure phase, if any. */
  message: string | null;
}

export function useYouTubePlayer({
  container,
  videoId,
  volume,
  muted,
  onEnded,
  onPlayingChange,
  enforceVisibility = true,
}: {
  /**
   * The element the player is mounted into, held as STATE rather than a ref.
   *
   * The host only exists once something is playing, so it appears after this
   * hook first runs. A ref would be null on that first pass and the creation
   * effect — which must run exactly once per host — would never see the node
   * arrive. Tracking the element itself makes its appearance an ordinary
   * dependency change.
   */
  container: HTMLElement | null;
  videoId: string | null;
  volume: number;
  muted: boolean;
  onEnded: () => void;
  onPlayingChange?: (playing: boolean) => void;
  /**
   * Whether the visibility guard is armed.
   *
   * It is armed whenever the player is meant to be seen, which is the case
   * that matters: a player presented to someone must not then be hidden or
   * shrunk under them while it plays. It is disarmed only for the deliberate
   * audio-only presentation — see the note in `PlayerEngine`.
   */
  enforceVisibility?: boolean;
}): PlayerApi {
  const [rawPhase, setPhase] = useState<PlayerPhase>("idle");
  /* Two facts are derived rather than stored: with no host there is no player,
     and a host that has not yet reported ready is loading. Deriving them keeps
     the creation effect free of a synchronous setState. */
  const phase: PlayerPhase = !container
    ? "idle"
    : rawPhase === "idle"
      ? "loading"
      : rawPhase;
  const [message, setMessage] = useState<string | null>(null);
  // Keyed to the track it was measured on. A new track therefore reads 0
  // by DERIVATION, which is what removes the setState-inside-an-effect that a
  // manual reset would need.
  const [clock, setClock] = useState<{
    id: string;
    position: number;
    duration: number;
  }>({
    id: "",
    position: 0,
    duration: 0,
  });
  const position = clock.id === videoId ? clock.position : 0;
  const duration = clock.id === videoId ? clock.duration : 0;

  const playerRef = useRef<YTPlayer | null>(null);
  const readyRef = useRef(false);
  const blockTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /* The track the player currently holds, and the one to construct it with.
     The player is built with a real video id rather than an empty `/embed/`
     frame that is cued afterwards: an id-less embed is a configuration YouTube
     does not always recover from. */
  const loadedIdRef = useRef<string | null>(null);
  /* An outstanding play request, and whether a track switch is in flight.
     See `lib/music/transport.ts` — a request is held until playback actually
     starts, because the two moments somebody asks for it are exactly the two
     moments the player cannot yet take it: before it has been created, and
     while it is still swapping to the track they asked for. */
  const transportRef = useRef(IDLE_TRANSPORT);
  const playRef = useRef<() => void>(() => {});

  /* Applies an event to the transport state and honours any request it frees
     up. Called from the API callbacks, so it reads and writes refs only. */
  const observe = useCallback((event: TransportEvent) => {
    const { state, reissue } = advance(transportRef.current, event);
    transportRef.current = state;
    if (reissue) playRef.current();
  }, []);
  const videoIdRef = useRef<string | null>(videoId);
  useEffect(() => {
    videoIdRef.current = videoId;
  }, [videoId]);
  /* The phase as the timers see it, which is not the same as the phase this
     render closed over. */
  const phaseRef = useRef<PlayerPhase>("idle");
  useEffect(() => {
    phaseRef.current = rawPhase;
  }, [rawPhase]);
  useEffect(
    () => () => {
      if (blockTimer.current) clearTimeout(blockTimer.current);
    },
    [],
  );
  // Callbacks change every render; the API callbacks are registered once, so
  // they read through refs rather than capturing a stale closure.
  const endedRef = useRef(onEnded);
  const playingRef = useRef(onPlayingChange);
  useEffect(() => {
    endedRef.current = onEnded;
    playingRef.current = onPlayingChange;
  }, [onEnded, onPlayingChange]);

  /* ── Create the player once per host element ─────────────────────────── */
  useEffect(() => {
    if (!container) return;
    let cancelled = false;

    loadApi()
      .then((YT) => {
        if (cancelled) return;
        const host = document.createElement("div");
        container.appendChild(host);

        loadedIdRef.current = videoIdRef.current;
        playerRef.current = new YT.Player(host, {
          width: "100%",
          height: "100%",
          videoId: videoIdRef.current ?? undefined,
          playerVars: {
            // YouTube's own controls stay. We never overlay our own on top of
            // the video, and we never strip branding.
            controls: 1,
            rel: 0,
            playsinline: 1,
            origin:
              typeof window !== "undefined"
                ? window.location.origin
                : undefined,
          },
          events: {
            onReady: () => {
              readyRef.current = true;
              setPhase("ready");
              observe("player_ready");
            },
            onStateChange: (e: { data: number }) => {
              const S = YT.PlayerState;
              switch (e.data) {
                case S.BUFFERING:
                  setPhase("buffering");
                  break;
                case S.PLAYING:
                  setPhase("playing");
                  setMessage(null);
                  playingRef.current?.(true);
                  observe("playing");
                  break;
                case S.PAUSED:
                  setPhase("paused");
                  playingRef.current?.(false);
                  observe("paused");
                  break;
                /* The switch finished. If somebody asked for playback while it
                   was in flight, this is the first moment the player can take
                   it — and the moment the old code threw the request away. */
                case S.CUED:
                  observe("video_cued");
                  break;
                case S.ENDED:
                  setPhase("ended");
                  playingRef.current?.(false);
                  observe("ended");
                  endedRef.current();
                  break;
                default:
                  break;
              }
            },
            onError: (e: { data: number }) => {
              playingRef.current?.(false);
              observe("failed");
              // Documented IFrame API error codes.
              switch (e.data) {
                case 101:
                case 150:
                  setPhase("embedding_disabled");
                  setMessage(
                    "The owner does not allow this video to play outside YouTube. Open it on YouTube instead.",
                  );
                  break;
                case 100:
                  setPhase("unavailable");
                  setMessage("This video has been removed or made private.");
                  break;
                case 2:
                  setPhase("unavailable");
                  setMessage("That video id was not valid.");
                  break;
                default:
                  setPhase("error");
                  setMessage("The player could not start this track.");
              }
            },
          },
        });
      })
      .catch(() => {
        if (!cancelled) {
          setPhase("error");
          setMessage(
            "The YouTube player could not be loaded. Check your connection.",
          );
        }
      });

    return () => {
      cancelled = true;
      try {
        playerRef.current?.destroy();
      } catch {
        // The node may already be gone during a fast unmount; nothing to do.
      }
      playerRef.current = null;
      readyRef.current = false;
    };
  }, [container, observe]);

  /* ── Cue whatever track is current ───────────────────────────────────────
     CUE, not load: `loadVideoById` starts playing immediately, which would
     mean reopening Cowork with a restored queue starts making noise on its
     own. Playback always begins from an explicit intent — the transport, a
     result row, or the advance at the end of a track. */
  const isReady = phase !== "idle" && phase !== "loading";
  useEffect(() => {
    if (!readyRef.current || !playerRef.current || !videoId) return;
    if (loadedIdRef.current === videoId) return;
    loadedIdRef.current = videoId;
    /* Declared BEFORE the call, because the play intent that accompanies a
       track change is committed in the same pass and lands immediately after
       this — it has to find a switch already in flight. */
    transportRef.current = advance(
      transportRef.current,
      "track_changed",
    ).state;
    try {
      playerRef.current.cueVideoById(videoId);
    } catch {
      // A failed switch surfaces through onError rather than a direct
      // setState here, which would cascade a render inside the effect.
    }
  }, [videoId, isReady]);

  /* ── Volume and mute follow preferences ──────────────────────────────── */
  useEffect(() => {
    if (!readyRef.current || !playerRef.current) return;
    try {
      playerRef.current.setVolume(Math.max(0, Math.min(100, volume)));
      if (muted) playerRef.current.mute();
      else playerRef.current.unMute();
    } catch {
      // Pre-ready calls are safely ignored.
    }
  }, [volume, muted, phase]);

  /* ── Position polling, only while it can change ──────────────────────── */
  useEffect(() => {
    // Paused and ready are polled too, slowly: a cued track knows its own
    // length, and a scrubber that reads 0:00 next to a three-minute song is
    // simply wrong.
    if (phase !== "playing" && phase !== "paused" && phase !== "ready") return;
    const id = setInterval(
      () => {
        const p = playerRef.current;
        if (!p) return;
        try {
          setClock({
            id: videoId ?? "",
            position: p.getCurrentTime(),
            duration: p.getDuration(),
          });
        } catch {
          // Transient during a track change.
        }
      },
      phase === "playing" ? 500 : 2000,
    );
    return () => clearInterval(id);
  }, [phase, videoId]);

  /* ── Stall watchdog ──────────────────────────────────────────────────────
     Buffering that never resolves is the failure nobody codes for: no error
     event arrives, so the player sits on a spinner indefinitely. A blocked
     region, a dead network or a stream the browser cannot decode all look like
     this. After twenty seconds without progress, say so and offer the way out. */
  useEffect(() => {
    if (phase !== "buffering") return;
    const started = position;
    const id = setTimeout(() => {
      if (phaseRef.current !== "buffering") return;
      const p = playerRef.current;
      let now = started;
      try {
        now = p ? p.getCurrentTime() : started;
      } catch {
        // Treated as no progress.
      }
      if (now > started + 0.5) return;
      setPhase("error");
      setMessage(
        "This track is not loading. Your network or a regional restriction may be blocking it.",
      );
    }, 20_000);
    return () => clearTimeout(id);
    // `position` is read once when buffering begins, deliberately: adding it as
    // a dependency would restart the watchdog on every poll.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  /* ── The compliance guard ────────────────────────────────────────────────
     If the player is scrolled away, collapsed, or reduced below a usable size
     while audio is running, playback stops. This is the rule that makes the
     rest of the feature legitimate, so it is enforced by observers rather than
     by a promise in a code comment. */
  useEffect(() => {
    if (!container || !enforceVisibility) return;

    const pauseIfPlaying = () => {
      if (!playerRef.current) return;
      setPhase((cur) => {
        if (cur === "playing" || cur === "buffering") {
          try {
            playerRef.current?.pauseVideo();
          } catch {
            // Nothing more we can do; the phase change still stops autoplay.
          }
          return "paused";
        }
        return cur;
      });
    };

    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.intersectionRatio < 0.5) pauseIfPlaying();
      },
      { threshold: [0, 0.5, 1] },
    );
    io.observe(container);

    /* The floor is the compact bar's own size, not an arbitrary number: the
       bar plays a real 160×90 video, and anything smaller than that is a token
       rather than a player. Shrink it below this and playback stops. */
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      if (width < 150 || height < 84) pauseIfPlaying();
    });
    ro.observe(container);

    return () => {
      io.disconnect();
      ro.disconnect();
    };
  }, [container, enforceVisibility]);

  /* `playVideo()` does not throw when the browser refuses to start audio — it
     simply does nothing, which would leave someone pressing a dead button. So
     the request is verified: if the player has not started shortly afterwards,
     say so and point at the one control the browser will always honour, which
     is the play button inside YouTube's own visible player. */
  const play = useCallback(() => {
    /* Recorded first and cleared only when playback actually starts, so a
       request made before the player exists — or mid-switch — is honoured on
       ready or on cued rather than dropped. */
    transportRef.current = advance(
      transportRef.current,
      "play_requested",
    ).state;
    const p = playerRef.current;
    if (!p || !readyRef.current) return;
    try {
      p.playVideo();
    } catch {
      // Falls through to the check below.
    }
    if (blockTimer.current) clearTimeout(blockTimer.current);
    blockTimer.current = setTimeout(() => {
      /* A switch still in flight is not a refusal — the cued event will
         re-issue this request, and that call restarts this timer. */
      if (!canDeclareBlocked(transportRef.current)) return;
      const now = phaseRef.current;
      if (now !== "playing" && now !== "buffering") {
        transportRef.current = advance(
          transportRef.current,
          "declared_blocked",
        ).state;
        setPhase("autoplay_blocked");
        setMessage(
          "Your browser would not start audio from this button. Press play on the video above to begin.",
        );
      }
    }, 1600);
  }, []);

  const pause = useCallback(() => {
    transportRef.current = advance(
      transportRef.current,
      "pause_requested",
    ).state;
    try {
      playerRef.current?.pauseVideo();
    } catch {
      // Already stopped.
    }
  }, []);

  const seek = useCallback((seconds: number) => {
    try {
      playerRef.current?.seekTo(Math.max(0, seconds), true);
      setClock((c) => ({ ...c, position: Math.max(0, seconds) }));
    } catch {
      // Seeking before ready is a no-op.
    }
  }, []);

  const setVolume = useCallback((v: number) => {
    try {
      playerRef.current?.setVolume(Math.max(0, Math.min(100, v)));
    } catch {
      /* pre-ready */
    }
  }, []);

  const setMuted = useCallback((m: boolean) => {
    try {
      if (m) playerRef.current?.mute();
      else playerRef.current?.unMute();
    } catch {
      /* pre-ready */
    }
  }, []);

  useEffect(() => {
    playRef.current = play;
  }, [play]);

  return {
    phase,
    position,
    duration,
    play,
    pause,
    seek,
    setVolume,
    setMuted,
    message,
  };
}
