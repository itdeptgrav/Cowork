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
 *      LiveKit credentials, the call is handed to the SHELL as a
 *      `GuestSession`, and this page renders only a `MeetingStage` saying
 *      where to draw it. `MeetingEngine` mounts `GuestRoom` over that stage
 *      and keeps it when the guest navigates — a link in the chat, Back — as
 *      the same draggable corner window and picture-in-picture window an
 *      employee gets. The room used to be a phase of this page, and a page
 *      unmounts: every navigation ended the guest's call and finalised their
 *      recording mid-sentence. The recording hook runs inside `GuestRoom`,
 *      through the no-auth `guest-chunk` / `guest-finalize` routes keyed by
 *      the `guestSessionId` issued at join.
 *
 * All API calls go through `meetingMedia.ts` — the `getPublicMeetingInfo` and
 * `guestJoinMeeting` functions hit the NO-AUTH backend routes directly.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Button, Input, InlineError } from "@/components/ui/Primitives";
import { Icon } from "@/components/ui/Icons";
import { Mark } from "@/components/layout/shell/Mark";
import {
  getPublicMeetingInfo,
  guestJoinMeeting,
} from "@/lib/legacy/meetingMedia";
import { MeetingStage } from "./MeetingStage";
import { useMeetingSession } from "./MeetingSessionContext";
import { PendingAudioDrain } from "./PendingAudioDrain";

// ── Component ──────────────────────────────────────────────────────────────────

/**
 * What this page is showing. There is no "room" phase any more: the room is
 * the shell's `GuestSession`, and the page reads it from there — see `live`.
 */
type Phase =
  | { kind: "loading" }
  | {
      kind: "lobby";
      meetTitle: string;
      status: string;
      canJoin: boolean;
      participantCount: number;
    }
  | { kind: "error"; message: string };

export function GuestMeetingArea({ shareToken }: { shareToken: string }) {
  const [phase, setPhase] = useState<Phase>({ kind: "loading" });
  /* Bumped to re-read the invite — after a guest leaves, the meeting may
     still be running and the lobby should offer to rejoin it. */
  const [reload, setReload] = useState(0);
  const [name, setName] = useState("");
  const [camEnabled, setCamEnabled] = useState(false);
  const [micEnabled, setMicEnabled] = useState(true);
  const [camId, setCamId] = useState("");
  const [micId, setMicId] = useState("");
  const [joining, setJoining] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);

  const devices = useDeviceLists(camEnabled || micEnabled);

  /**
   * The call the shell is holding for THIS link, if any.
   *
   * Read from the shell rather than kept in local state, so a page that was
   * left and returned to — Open on the corner window, the browser's Back —
   * finds the room it left rather than a lobby offering to join it twice.
   */
  const meetingSession = useMeetingSession();
  const live =
    meetingSession.session?.kind === "guest" &&
    meetingSession.session.shareToken === shareToken
      ? meetingSession.session
      : null;

  // Resolve the token to meeting info on first render, and again on reload
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
  }, [shareToken, reload]);

  const openSession = meetingSession.open;

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
      const meetTitle = d.meetTitle ?? "CoWork Meeting";
      /**
       * Hand the call to the shell. Everything the room needs travels on the
       * session, because this page may be gone by the time it is drawn.
       *
       * The identity fields are carried rather than dropped — the guest's
       * voice is recorded with these. Empty strings where the engine sent
       * nothing: the recorder refuses to start without a meet id and a
       * session, which is the right answer for a build whose engine predates
       * guest recording.
       */
      openSession({
        kind: "guest",
        shareToken,
        meetId: d.meetId ?? "",
        meetTitle,
        token: d.token,
        url: d.url,
        guestId: d.guestId ?? "",
        guestSessionId: d.guestSessionId ?? "",
        guestName: safeName,
        micEnabled,
        camEnabled,
        micId,
        camId,
        onLeave: (reason) => {
          /* The organiser ended it: say so, and offer nothing. Their own
             Leave, or a connection that gave up: the meeting may well still be
             running, so re-read the invite and let the lobby offer to rejoin —
             which is what the signed-in page's Rejoin does. */
          if (reason === "ended") {
            setPhase({
              kind: "lobby",
              meetTitle,
              status: "ended",
              canJoin: false,
              participantCount: 0,
            });
            return;
          }
          setPhase({ kind: "loading" });
          setReload((n) => n + 1);
        },
      });
    } catch (e) {
      setJoinError(e instanceof Error ? e.message : "Could not join.");
    } finally {
      setJoining(false);
    }
  }

  if (live) {
    /**
     * **The room is the shell's; this page is only where it is drawn.**
     *
     * A full-viewport stage, as the room itself was when it lived here: a
     * guest joins to be shown something, and they have no other Cowork window
     * to keep. The engine positions `GuestRoom` over this box, and takes it
     * to a corner the moment this page is left.
     */
    return <MeetingStage className="h-dvh w-full" />;
  }

  if (phase.kind === "loading") return <Shell><Spinner /></Shell>;
  if (phase.kind === "error") return <Shell><ErrorCard message={phase.message} /></Shell>;

  const { meetTitle, status, canJoin, participantCount } = phase;

  if (!canJoin) {
    return (
      <Shell>
        {/**
         * **A guest's second chance at their own audio.**
         *
         * A guest's recording is uploaded by their own browser and by nothing
         * else: the finalize route takes the identity from the caller, so no
         * host and no server can push it for them. If the upload failed at
         * the moment they left — a dropped connection, a tab closed a beat too
         * soon — the chunks sit in this browser's IndexedDB with nothing to
         * retry them, because the signed-in shell that carries this drain
         * everywhere is a shell a guest never sees.
         *
         * This card is the one page a guest reliably returns to — the link
         * they were sent, reloaded — so the drain lives here. It needs no
         * sign-in: `drainPendingAudio` picks the guest routes from the
         * `guestSessionId` stored beside each chunk.
         */}
        <PendingAudioDrain />
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
                : status === "cancelled"
                  ? "This meeting was cancelled."
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
