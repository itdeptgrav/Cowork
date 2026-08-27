"use client";

/**
 * Guest meeting flow — no Cowork account needed.
 *
 * The host copies a public share link from the meeting detail page and sends
 * it to whoever they want to include. That person lands here:
 *
 *   1. Lobby — a camera preview on one side, the invite on the other: title,
 *      how many are already in the call, a name field, Join. Mic/camera
 *      toggle as round buttons on the video frame itself, with device
 *      pickers underneath it — the same grammar every mainstream video-call
 *      product's pre-join screen uses, because guests arrive already knowing
 *      it. Error states cover: invalid token, meeting not started yet,
 *      meeting ended, and server errors.
 *   2. Room — once the guest submits their name and the backend returns
 *      LiveKit credentials, we drop them into a lightweight LiveKit room,
 *      carrying over the mic/camera/device choice made in the lobby. The
 *      recording hook RUNS — a guest's microphone is captured and uploaded on
 *      the same 30-second cadence as anybody else's, through the no-auth
 *      `guest-chunk` / `guest-finalize` routes keyed by the `guestSessionId`
 *      issued at join. This said "guests can't upload to Drive", which was
 *      true before those routes existed and left every meeting with a guest in
 *      it missing the one voice most likely to matter. No transcript (needs
 *      LiveKit DataChannel which needs auth participants to broadcast), and
 *      otherwise just the participant grid + control bar.
 *
 * All API calls go through `meetingMedia.ts` — the `getPublicMeetingInfo` and
 * `guestJoinMeeting` functions hit the NO-AUTH backend routes directly.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ControlBar,
  GridLayout,
  LiveKitRoom,
  ParticipantTile,
  RoomAudioRenderer,
  useTracks,
} from "@livekit/components-react";
import { Track } from "livekit-client";
import "@livekit/components-styles";
import { Button, Input, InlineError } from "@/components/ui/Primitives";
import { Icon } from "@/components/ui/Icons";
import { Mark } from "@/components/layout/shell/Mark";
import {
  getPublicMeetingInfo,
  guestJoinMeeting,
} from "@/lib/legacy/meetingMedia";
import { useMeetingRecording } from "@/lib/legacy-ui/useMeetingRecording";

// ── Component ──────────────────────────────────────────────────────────────────

type Phase =
  | { kind: "loading" }
  | {
      kind: "lobby";
      meetTitle: string;
      status: string;
      canJoin: boolean;
      participantCount: number;
    }
  | {
      kind: "room";
      token: string;
      url: string;
      meetTitle: string;
      camEnabled: boolean;
      micEnabled: boolean;
      camId: string;
      micId: string;
      /**
       * What a guest needs to have their voice recorded like anybody else's.
       *
       * `guest-join` has always returned these three; this screen discarded
       * them, on a comment that said "guests can't upload to Drive". That was
       * true once and has not been for some time: `/cowork/audio/guest-chunk`
       * and `/cowork/audio/guest-finalize` take a `guestSessionId` instead of a
       * Firebase token, merge the chunks and push the file to Drive through the
       * same `uploadAudioToDrive` an employee's recording uses, into the same
       * `meeting_audio_recordings` collection the summary reads.
       *
       * So a guest's voice was missing from every recording and every summary —
       * not because it could not be captured, but because nothing asked for it.
       */
      meetId: string;
      guestId: string;
      guestSessionId: string;
    }
  | { kind: "error"; message: string };

export function GuestMeetingArea({ shareToken }: { shareToken: string }) {
  const [phase, setPhase] = useState<Phase>({ kind: "loading" });
  const [name, setName] = useState("");
  const [camEnabled, setCamEnabled] = useState(false);
  const [micEnabled, setMicEnabled] = useState(true);
  const [camId, setCamId] = useState("");
  const [micId, setMicId] = useState("");
  const [joining, setJoining] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);

  const devices = useDeviceLists(camEnabled || micEnabled);

  // Resolve the token to meeting info on first render
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const res = await getPublicMeetingInfo({ shareToken });
      if (cancelled) return;
      if (!res.ok) {
        setPhase({ kind: "error", message: res.error.message });
        return;
      }
      const d = res.data ?? {};
      setPhase({
        kind: "lobby",
        meetTitle: d.meetTitle ?? "CoWork Meeting",
        status: d.status ?? "unknown",
        canJoin: d.canJoin ?? false,
        participantCount: d.participantCount ?? 0,
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [shareToken]);

  async function join() {
    const safeName = name.trim();
    if (!safeName) return;
    setJoining(true);
    setJoinError(null);
    try {
      const res = await guestJoinMeeting({
        shareToken,
        guestName: safeName,
      });
      if (!res.ok) throw new Error(res.error.message);
      const d = res.data!;
      if (!d.token || !d.url)
        throw new Error("Server did not return room credentials.");
      setPhase({
        kind: "room",
        token: d.token,
        url: d.url,
        meetTitle: d.meetTitle ?? "CoWork Meeting",
        camEnabled,
        micEnabled,
        camId,
        micId,
        /* Carried rather than dropped — the guest's voice is recorded with
           these. Empty strings where the engine sent nothing: the recorder
           refuses to start without a meet id and a session, which is the right
           answer for a build whose engine predates guest recording. */
        meetId: d.meetId ?? "",
        guestId: d.guestId ?? "",
        guestSessionId: d.guestSessionId ?? "",
      });
    } catch (e) {
      setJoinError(e instanceof Error ? e.message : "Could not join.");
    } finally {
      setJoining(false);
    }
  }

  if (phase.kind === "loading") return <Shell><Spinner /></Shell>;
  if (phase.kind === "error") return <Shell><ErrorCard message={phase.message} /></Shell>;
  if (phase.kind === "room") {
    return (
      <GuestRoom
        token={phase.token}
        url={phase.url}
        meetTitle={phase.meetTitle}
        camEnabled={phase.camEnabled}
        micEnabled={phase.micEnabled}
        camId={phase.camId}
        micId={phase.micId}
        meetId={phase.meetId}
        guestId={phase.guestId}
        guestSessionId={phase.guestSessionId}
        guestName={name.trim() || "Guest"}
        onLeave={() =>
          setPhase({
            kind: "lobby",
            meetTitle: phase.meetTitle,
            status: "ended",
            canJoin: false,
            participantCount: 0,
          })
        }
      />
    );
  }

  const { meetTitle, status, canJoin, participantCount } = phase;

  if (!canJoin) {
    return (
      <Shell>
        <div className="max-w-md space-y-5 text-center">
          <span
            aria-hidden="true"
            className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-[var(--control)] text-ink-muted"
          >
            <Icon.meeting className="h-6 w-6" />
          </span>
          <div>
            <h1 className="text-xl font-semibold text-ink">{meetTitle}</h1>
            <p className="mt-1.5 text-base text-ink-muted">
              {status === "ended" ||
              status === "completed" ||
              status === "archived"
                ? "This meeting has ended."
                : "This link is not currently active. Ask the host to share an active link."}
            </p>
          </div>
        </div>
      </Shell>
    );
  }

  return (
    <Shell>
      <div className="grid w-full max-w-[1220px] items-center gap-x-14 gap-y-10 md:grid-cols-[1.35fr_1fr]">
        <div className="flex flex-col gap-4">
          <VideoPanel
            name={name}
            camEnabled={camEnabled}
            micEnabled={micEnabled}
            camId={camId}
            onToggleCam={() => setCamEnabled((v) => !v)}
            onToggleMic={() => setMicEnabled((v) => !v)}
          />
          <DeviceRow
            cams={devices.cams}
            mics={devices.mics}
            camId={camId}
            micId={micId}
            onCamChange={setCamId}
            onMicChange={setMicId}
          />
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            void join();
          }}
          className="flex flex-col items-start gap-6"
        >
          <div>
            <h1 className="text-[clamp(1.875rem,3.2vw,2.75rem)] leading-[1.08] font-light tracking-[-0.035em] text-ink">
              {meetTitle}
            </h1>
            {participantCount > 0 && (
              <p className="mt-2.5 text-base text-ink-muted">
                {participantCount === 1
                  ? "1 other is"
                  : `${participantCount} others are`}{" "}
                already in this call
              </p>
            )}
          </div>

          <label className="block w-full max-w-sm">
            <span className="mb-2 block text-base font-medium text-ink">
              Your name
            </span>
            <Input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="How should others see you?"
              maxLength={60}
              required
              autoFocus
              disabled={joining}
              className="!py-3.5 !text-base"
            />
          </label>

          {joinError && <InlineError compact message={joinError} />}

          <Button
            type="submit"
            tone="primary"
            disabled={joining || !name.trim()}
            className="!px-7 !py-3.5 !text-base"
          >
            {joining ? "Joining…" : "Join now"}
          </Button>
        </form>
      </div>
    </Shell>
  );
}

// ── Device enumeration ────────────────────────────────────────────────────────

/**
 * Labels stay blank until the browser has granted at least one getUserMedia
 * permission — `unlocked` re-runs the listing once that happens, so the
 * picker fills in real device names instead of "Camera 1" / "Microphone 1".
 */
function useDeviceLists(unlocked: boolean) {
  const [cams, setCams] = useState<MediaDeviceInfo[]>([]);
  const [mics, setMics] = useState<MediaDeviceInfo[]>([]);

  const refresh = useCallback(() => {
    navigator.mediaDevices
      ?.enumerateDevices?.()
      .then((list) => {
        setCams(list.filter((d) => d.kind === "videoinput"));
        setMics(list.filter((d) => d.kind === "audioinput"));
      })
      .catch(() => {
        /* No device access at all — the pickers just stay empty. */
      });
  }, []);

  useEffect(() => {
    refresh();
    navigator.mediaDevices?.addEventListener?.("devicechange", refresh);
    return () =>
      navigator.mediaDevices?.removeEventListener?.("devicechange", refresh);
  }, [refresh]);

  useEffect(() => {
    if (unlocked) refresh();
  }, [unlocked, refresh]);

  return { cams, mics };
}

// ── Video panel — camera preview + the round mic/camera buttons ──────────────

function VideoPanel({
  name,
  camEnabled,
  micEnabled,
  camId,
  onToggleCam,
  onToggleMic,
}: {
  name: string;
  camEnabled: boolean;
  micEnabled: boolean;
  camId: string;
  onToggleCam: () => void;
  onToggleMic: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [camError, setCamError] = useState<string | null>(null);

  /* Local device preview only — nothing here publishes to a room. The
     acquired stream is torn down by this effect's own cleanup whenever the
     camera is switched off, a different camera is picked, or the lobby
     unmounts, so the guest's camera light goes out the moment they leave
     this screen. `stream` is left stale (not nulled) once `camEnabled` goes
     false — harmless, since `showVideo` below gates on `camEnabled` too and
     stopped tracks render nothing. */
  useEffect(() => {
    if (!camEnabled) return;
    let cancelled = false;
    let acquired: MediaStream | null = null;
    navigator.mediaDevices
      ?.getUserMedia({
        video: camId ? { deviceId: { exact: camId } } : true,
      })
      .then((s) => {
        if (cancelled) {
          s.getTracks().forEach((t) => t.stop());
          return;
        }
        acquired = s;
        setCamError(null);
        setStream(s);
      })
      .catch(() => {
        if (!cancelled) setCamError("Camera unavailable");
      });
    return () => {
      cancelled = true;
      acquired?.getTracks().forEach((t) => t.stop());
    };
  }, [camEnabled, camId]);

  useEffect(() => {
    if (videoRef.current) videoRef.current.srcObject = stream;
  }, [stream]);

  const showVideo = camEnabled && stream && !camError;

  return (
    <div className="relative aspect-video w-full overflow-hidden rounded-card bg-black">
      {showVideo ? (
        <video
          ref={videoRef}
          autoPlay
          muted
          playsInline
          className="h-full w-full -scale-x-100 object-cover"
        />
      ) : (
        <div className="grid h-full w-full place-items-center px-6 text-center">
          <p className="text-base font-medium text-white/70">
            {camEnabled ? (camError ?? "Camera unavailable") : "Camera is off"}
          </p>
        </div>
      )}

      <div className="absolute inset-x-0 top-0 h-20 bg-gradient-to-b from-black/45 to-transparent" />
      <span className="absolute top-4 left-5 text-sm font-medium text-white [text-shadow:0_1px_2px_rgba(0,0,0,0.5)]">
        {name.trim() || "Guest"}
      </span>

      <div className="absolute inset-x-0 bottom-5 flex items-center justify-center gap-4">
        <ToggleCircle
          on={micEnabled}
          onClick={onToggleMic}
          onLabel="Mute microphone"
          offLabel="Unmute microphone"
          iconOn={<MicIcon className="h-[22px] w-[22px]" />}
          iconOff={<MicOffIcon className="h-[22px] w-[22px]" />}
        />
        <ToggleCircle
          on={camEnabled}
          onClick={onToggleCam}
          onLabel="Turn off camera"
          offLabel="Turn on camera"
          iconOn={<CameraIcon className="h-[22px] w-[22px]" />}
          iconOff={<CameraOffIcon className="h-[22px] w-[22px]" />}
        />
      </div>
    </div>
  );
}

function ToggleCircle({
  on,
  onClick,
  onLabel,
  offLabel,
  iconOn,
  iconOff,
}: {
  on: boolean;
  onClick: () => void;
  onLabel: string;
  offLabel: string;
  iconOn: React.ReactNode;
  iconOff: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={on ? onLabel : offLabel}
      className={`grid h-14 w-14 place-items-center rounded-full transition-colors ${
        on
          ? "bg-white/15 text-white hover:bg-white/25"
          : "bg-[var(--state-overdue)] text-[var(--state-overdue-ink)] hover:opacity-90"
      }`}
    >
      {on ? iconOn : iconOff}
    </button>
  );
}

// ── Device pickers — plain, beneath the video frame ───────────────────────────

function DeviceRow({
  cams,
  mics,
  camId,
  micId,
  onCamChange,
  onMicChange,
}: {
  cams: MediaDeviceInfo[];
  mics: MediaDeviceInfo[];
  camId: string;
  micId: string;
  onCamChange: (id: string) => void;
  onMicChange: (id: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-x-8 gap-y-2.5 px-1">
      <DeviceSelect
        icon={<MicIcon className="h-[18px] w-[18px]" />}
        label="Microphone"
        value={micId}
        onChange={onMicChange}
        options={mics}
      />
      <DeviceSelect
        icon={<CameraIcon className="h-[18px] w-[18px]" />}
        label="Camera"
        value={camId}
        onChange={onCamChange}
        options={cams}
      />
    </div>
  );
}

function DeviceSelect({
  icon,
  label,
  value,
  onChange,
  options,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  onChange: (id: string) => void;
  options: MediaDeviceInfo[];
}) {
  return (
    <label className="flex min-w-0 items-center gap-2.5 text-sm text-ink-muted">
      <span aria-hidden="true" className="shrink-0 text-ink-faint">
        {icon}
      </span>
      <span className="sr-only">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="min-w-0 max-w-[220px] truncate bg-transparent text-ink outline-none"
      >
        <option value="">System default</option>
        {options.map((d, i) => (
          <option key={d.deviceId || i} value={d.deviceId}>
            {d.label || `${label} ${i + 1}`}
          </option>
        ))}
      </select>
    </label>
  );
}

// ── Icons ──────────────────────────────────────────────────────────────────────

function MicIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true" className={className}>
      <rect
        x="5.75"
        y="1.5"
        width="4.5"
        height="7.5"
        rx="2.25"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <path
        d="M3.25 7.25a4.75 4.75 0 0 0 9.5 0M8 12.25v2M5.75 14.25h4.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function MicOffIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true" className={className}>
      <rect
        x="5.75"
        y="1.5"
        width="4.5"
        height="7.5"
        rx="2.25"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <path
        d="M3.25 7.25a4.75 4.75 0 0 0 9.5 0M8 12.25v2M5.75 14.25h4.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M2 2l12 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function CameraIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true" className={className}>
      <rect
        x="1.5"
        y="4.25"
        width="8.75"
        height="7.5"
        rx="1.75"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <path
        d="M10.25 7.4 14.5 4.75v6.5l-4.25-2.65"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CameraOffIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true" className={className}>
      <rect
        x="1.5"
        y="4.25"
        width="8.75"
        height="7.5"
        rx="1.75"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <path
        d="M10.25 7.4 14.5 4.75v6.5l-4.25-2.65"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path d="M2 2l12 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

/**
 * The guest room — the grid, the controls, and the guest's own voice.
 *
 * **Recording is not an employee privilege.** It reads as one because the
 * uploads an employee makes are authenticated with their Firebase token, and a
 * guest has no account to hold one. The engine answered that a long time ago
 * with `/cowork/audio/guest-chunk` and `/cowork/audio/guest-finalize`, which
 * take the `guestSessionId` issued at join instead — same 30-second cadence,
 * same merge, same `uploadAudioToDrive`, same `meeting_audio_recordings`
 * collection the summary reads. `useMeetingRecording` has carried a
 * `guestSessionId` parameter for exactly this since it was ported.
 *
 * Only this screen never asked. So a meeting with a guest in it produced a
 * recording with a hole where they spoke, and a summary that could not
 * attribute a word of it — the one participant most likely to be the reason
 * the meeting happened.
 */

function GuestRoom({
  token,
  url,
  meetTitle,
  camEnabled,
  micEnabled,
  camId,
  micId,
  meetId,
  guestId,
  guestSessionId,
  guestName,
  onLeave,
}: {
  token: string;
  url: string;
  meetTitle: string;
  camEnabled: boolean;
  micEnabled: boolean;
  camId: string;
  micId: string;
  meetId: string;
  guestId: string;
  guestSessionId: string;
  guestName: string;
  onLeave: () => void;
}) {
  const [error, setError] = useState<string | null>(null);

  /**
   * The guest's own microphone, captured and uploaded exactly as a colleague's
   * is.
   *
   * `employeeId` carries the guest id: the hook uses it as the identity for the
   * socket room and as the folder its chunks are written under, and the engine
   * keys a guest's chunk directory by the same `guestId` it minted at join. It
   * is an identity, not a claim of employment — and passing a blank would put
   * every guest's audio in one unnamed pile.
   *
   * `isHost: false` always. A guest hears the host's start and stop over the
   * socket like everybody else and never drives the room's recording.
   */
  const recording = useMeetingRecording({
    meetId,
    employeeId: guestId,
    employeeName: guestName,
    firstName: guestName.trim().split(/\s+/)[0] || guestName,
    isHost: false,
    guestSessionId,
  });
  /* Read so the hook is unmistakably live rather than looking like a call whose
     result was thrown away — and so a guest can be told their voice failed to
     reach Drive instead of finding out from a silent gap in the summary. */
  const uploadFailed = recording.uploadError;

  return (
    <section
      className="slab slab-flat relative flex min-h-screen flex-col overflow-hidden"
      data-on-slab
    >
      <header className="flex shrink-0 items-center gap-3 border-b border-white/10 px-4 py-3">
        <Icon.meeting className="h-4 w-4 text-slab-ink-muted" />
        <span className="flex-1 truncate text-sm font-medium text-slab-ink">
          {meetTitle}
        </span>
        {/* Said where it happens. A guest whose clips are not reaching Drive
            would otherwise learn it from a gap in a summary nobody can fix
            afterwards, and the recording is still running — this is a warning,
            not a failure of the meeting. */}
        {uploadFailed ? (
          <span
            className="truncate text-[11px] text-[var(--state-rework-ink)]"
            title={uploadFailed}
          >
            Your audio is not uploading
          </span>
        ) : null}
        <span className="text-[11px] text-slab-ink-muted">Guest</span>
      </header>

      {error ? (
        <div className="grid flex-1 place-items-center px-8 py-16 text-center">
          <p className="text-[15px] font-medium text-slab-ink">
            Connection error
          </p>
          <p className="mt-1.5 text-xs text-slab-ink-muted">{error}</p>
        </div>
      ) : (
        <LiveKitRoom
          token={token}
          serverUrl={url}
          connect
          video={camEnabled ? (camId ? { deviceId: { exact: camId } } : true) : false}
          audio={micEnabled ? (micId ? { deviceId: { exact: micId } } : true) : false}
          data-lk-theme="default"
          className="flex min-h-0 flex-1 flex-col"
          onDisconnected={onLeave}
          onError={(e) => setError(e.message)}
        >
          <GuestStage />
          <div className="shrink-0 border-t border-white/10">
            <ControlBar variation="verbose" />
          </div>
          <RoomAudioRenderer />
        </LiveKitRoom>
      )}
    </section>
  );
}

function GuestStage() {
  const tracks = useTracks(
    [
      { source: Track.Source.Camera, withPlaceholder: true },
      { source: Track.Source.ScreenShare, withPlaceholder: false },
    ],
    { onlySubscribed: false },
  );
  return (
    <div className="min-h-0 flex-1 p-2">
      <GridLayout tracks={tracks} className="h-full">
        <ParticipantTile />
      </GridLayout>
    </div>
  );
}

// ── Shell / utilities ─────────────────────────────────────────────────────────

/**
 * The page-level wrapper — deliberately NOT a slab.
 *
 * `AppShell` mounts `IridescentField` at the root for every route, signed in
 * or not (see its own doc comment: the sign-in page is the first thing
 * anyone sees of Cowork and it should be the product's own material). A
 * full-viewport opaque slab here would sit directly over that field and hide
 * it completely — leaving this transparent, with real padding, lets the
 * field show around the content the way `AuthFrame` does for `/signin`. The
 * mark is pinned in the corner rather than centered above the content so it
 * does not fight the two-column layout's own width.
 */
function Shell({ children }: { children: React.ReactNode }) {
  return (
    <>
      {/* `fixed`, not `absolute` — pinned to the viewport as its own layer so
          it never enters the grid below and can't be pulled toward center by
          `place-items-center`, which is what happened the first time this
          used `absolute` inside that grid. */}
      <div className="fixed top-6 left-6 z-10 flex items-center gap-2.5 sm:top-8 sm:left-8">
        <Mark className="h-7 w-7" />
        <span className="text-base leading-none font-medium tracking-[-0.03em] text-ink">
          cowork
        </span>
      </div>
      <div className="grid min-h-dvh place-items-center px-[clamp(16px,4vw,48px)] py-[clamp(24px,5vh,64px)]">
        {children}
      </div>
    </>
  );
}

function Spinner() {
  return (
    <div className="flex flex-col items-center gap-3.5">
      <span
        aria-hidden="true"
        className="h-8 w-8 animate-spin rounded-full border-[2.5px] border-[var(--color-hairline)] border-t-ink"
      />
      <p className="text-base text-ink-muted">Loading…</p>
    </div>
  );
}

function ErrorCard({ message }: { message: string }) {
  return (
    <div className="max-w-md space-y-2 text-center">
      <p className="text-lg font-medium text-ink">Cannot open this link</p>
      <p className="text-base text-ink-muted">{message}</p>
    </div>
  );
}
