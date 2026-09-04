"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  DisconnectButton,
  MediaDeviceMenu,
  TrackToggle,
  useParticipants,
  useTrackToggle,
} from "@livekit/components-react";
import { Track } from "livekit-client";
import { REACTIONS, useRoomSignals } from "./RoomSignals";

export type SidePanelTab = "chat" | "people" | null;

/**
 * One control bar, the shape every video product has converged on.
 *
 * ## What this replaces, and why
 *
 * There were two rows: LiveKit's `ControlBar` with wide labelled pills
 * ("Microphone ⌄  Camera ⌄  Share screen  Leave") and, above it, a second row
 * of our own with emoji glyphs. Two rows of two different shapes, in two
 * different visual languages, for one set of actions — and the meeting itself
 * lost the vertical space to both.
 *
 * This is one row of equal circular buttons with drawn icons: the arrangement
 * people already know, where the shape of a control tells you it is a control
 * and the only wide element is the one you must not press by accident.
 *
 * ## The toggles are still LiveKit's
 *
 * `TrackToggle` and `useTrackToggle` own the microphone, the camera and the
 * screen share exactly as they did inside `ControlBar` — `showIcon={false}`
 * asks for the behaviour without the appearance. Nothing here calls
 * `setMicrophoneEnabled` itself, because a second implementation of muting is
 * how the button and the track come to disagree.
 *
 * `MediaDeviceMenu` stays LiveKit's too, behind the small chevron beside each
 * toggle — the split control, so "mute" and "which microphone" are one button
 * apart rather than the same button.
 *
 * ## Icon-only, at every width
 *
 * The old bar carried words and dropped them below 640px via a `variation`
 * prop, which is what stopped a 375px phone overflowing. Icons need no such
 * rule: the bar is the same at every size, and the phone case is handled by
 * the layout rather than by remembering to pass a flag. `compact` — the 340px
 * floating window — moves the less-used controls into the overflow menu rather
 * than shrinking everything until nothing can be hit.
 *
 * ## Red means one thing
 *
 * A muted microphone and a stopped camera are filled red, and so is Leave.
 * That is the convention people arrive with, and it is the difference between
 * noticing you are muted and talking to a room that cannot hear you.
 */
export function MeetingControlBar({
  panel,
  onPanelChange,
  unreadChat,
  compact = false,
  canSelectSpeaker,
  captions,
}: {
  panel: SidePanelTab;
  onPanelChange: (tab: SidePanelTab) => void;
  unreadChat: number;
  compact?: boolean;
  canSelectSpeaker: boolean;
  /**
   * Live captions, where the room has them.
   *
   * Only the scheduled room passes this today — a task room and a guest room
   * have no transcript panel to show — so the button appears exactly where it
   * does something. A CC button that is present but inert would be worse than
   * its absence.
   */
  captions?: { on: boolean; toggle: () => void };
}) {
  const { myHandUp, toggleHand, sendReaction, hands } = useRoomSignals();
  const participants = useParticipants();
  const [picker, setPicker] = useState(false);
  const [overflow, setOverflow] = useState(false);

  const mic = useTrackToggle({ source: Track.Source.Microphone });
  const cam = useTrackToggle({ source: Track.Source.Camera });
  const share = useTrackToggle({ source: Track.Source.ScreenShare });

  const toggle = (tab: Exclude<SidePanelTab, null>) =>
    onPanelChange(panel === tab ? null : tab);

  /* In the 340px window only the essentials stay on the row. Everything else
     is in the overflow, which is a menu rather than a second row. */
  const showOnRow = {
    share: !compact,
    react: !compact,
    captions: !compact && Boolean(captions),
    hand: true,
    chat: true,
    people: !compact,
  };

  return (
    <div className="relative flex shrink-0 items-center justify-center gap-1.5 px-2 py-2.5 sm:gap-2">
      {/* ── Microphone ─────────────────────────────────────────────── */}
      <SplitControl
        deviceKind="audioinput"
        compact={compact}
        showChevron={!compact}
      >
        <TrackToggle
          source={Track.Source.Microphone}
          showIcon={false}
          aria-label={mic.enabled ? "Mute microphone" : "Unmute microphone"}
          title={`${mic.enabled ? "Mute" : "Unmute"} (Ctrl+D)`}
          className={round(compact, mic.enabled ? "neutral" : "danger")}
        >
          {mic.enabled ? <MicIcon /> : <MicOffIcon />}
        </TrackToggle>
      </SplitControl>

      {/* ── Camera ─────────────────────────────────────────────────── */}
      <SplitControl
        deviceKind="videoinput"
        compact={compact}
        showChevron={!compact}
      >
        <TrackToggle
          source={Track.Source.Camera}
          showIcon={false}
          aria-label={cam.enabled ? "Turn camera off" : "Turn camera on"}
          title={`${cam.enabled ? "Turn camera off" : "Turn camera on"} (Ctrl+E)`}
          className={round(compact, cam.enabled ? "neutral" : "danger")}
        >
          {cam.enabled ? <CamIcon /> : <CamOffIcon />}
        </TrackToggle>
      </SplitControl>

      {/* ── Screen share ───────────────────────────────────────────── */}
      {showOnRow.share && (
        <TrackToggle
          source={Track.Source.ScreenShare}
          showIcon={false}
          aria-label={share.enabled ? "Stop sharing your screen" : "Share your screen"}
          title={share.enabled ? "Stop sharing" : "Share screen"}
          className={round(compact, share.enabled ? "on" : "neutral")}
        >
          <PresentIcon />
        </TrackToggle>
      )}

      {/* ── Reactions ──────────────────────────────────────────────── */}
      {showOnRow.react && (
        <div className="relative">
          <RoundButton
            compact={compact}
            tone={picker ? "on" : "neutral"}
            label="Send a reaction"
            pressed={picker}
            onClick={() => setPicker((v) => !v)}
          >
            <SmileyIcon />
          </RoundButton>
          {picker && (
            <Popover onClose={() => setPicker(false)} label="Send a reaction">
              <div className="flex gap-0.5">
                {REACTIONS.map((emoji) => (
                  <button
                    key={emoji}
                    type="button"
                    role="menuitem"
                    aria-label={`React with ${emoji}`}
                    onClick={() => {
                      sendReaction(emoji);
                      setPicker(false);
                    }}
                    className="rounded-lg px-1.5 py-1 text-[19px] leading-none transition-transform hover:scale-125 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white/60"
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            </Popover>
          )}
        </div>
      )}

      {/* ── Captions ───────────────────────────────────────────────── */}
      {showOnRow.captions && captions && (
        <RoundButton
          compact={compact}
          tone={captions.on ? "on" : "neutral"}
          label={captions.on ? "Hide captions" : "Show captions"}
          pressed={captions.on}
          onClick={captions.toggle}
        >
          <CaptionsIcon />
        </RoundButton>
      )}

      {/* ── Raise hand ─────────────────────────────────────────────── */}
      {showOnRow.hand && (
        <RoundButton
          compact={compact}
          tone={myHandUp ? "raised" : "neutral"}
          label={myHandUp ? "Lower your hand" : "Raise your hand"}
          pressed={myHandUp}
          onClick={toggleHand}
        >
          <HandIcon />
        </RoundButton>
      )}

      {/* ── Chat ───────────────────────────────────────────────────── */}
      {showOnRow.chat && (
        <RoundButton
          compact={compact}
          tone={panel === "chat" ? "on" : "neutral"}
          label="Chat with everyone"
          pressed={panel === "chat"}
          onClick={() => toggle("chat")}
          badge={panel === "chat" ? 0 : unreadChat}
        >
          <ChatIcon />
        </RoundButton>
      )}

      {/* ── People ─────────────────────────────────────────────────── */}
      {showOnRow.people && (
        <RoundButton
          compact={compact}
          tone={
            panel === "people" ? "on" : hands.size > 0 ? "attention" : "neutral"
          }
          label={`People (${participants.length})`}
          pressed={panel === "people"}
          onClick={() => toggle("people")}
          count={participants.length}
        >
          <PeopleIcon />
        </RoundButton>
      )}

      {/* ── Overflow ───────────────────────────────────────────────── */}
      <div className="relative">
        <RoundButton
          compact={compact}
          tone={overflow ? "on" : "neutral"}
          label="More options"
          pressed={overflow}
          onClick={() => setOverflow((v) => !v)}
        >
          <MoreIcon />
        </RoundButton>
        {overflow && (
          <Popover onClose={() => setOverflow(false)} label="More options">
            <div className="flex w-max min-w-[190px] flex-col gap-0.5">
              {!showOnRow.share && (
                <MenuRow
                  icon={<PresentIcon />}
                  label={share.enabled ? "Stop sharing" : "Share screen"}
                  onClick={() => {
                    void share.toggle();
                    setOverflow(false);
                  }}
                />
              )}
              {!showOnRow.people && (
                <MenuRow
                  icon={<PeopleIcon />}
                  label={`People (${participants.length})`}
                  onClick={() => {
                    toggle("people");
                    setOverflow(false);
                  }}
                />
              )}
              {!showOnRow.react && (
                <div className="px-2 py-1.5">
                  <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-white/45">
                    React
                  </p>
                  <div className="flex flex-wrap gap-0.5">
                    {REACTIONS.map((emoji) => (
                      <button
                        key={emoji}
                        type="button"
                        aria-label={`React with ${emoji}`}
                        onClick={() => {
                          sendReaction(emoji);
                          setOverflow(false);
                        }}
                        className="rounded-lg px-1.5 py-1 text-[17px] leading-none transition-transform hover:scale-125"
                      >
                        {emoji}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {captions && !showOnRow.captions && (
                <MenuRow
                  icon={<CaptionsIcon />}
                  label={captions.on ? "Hide captions" : "Show captions"}
                  onClick={() => {
                    captions.toggle();
                    setOverflow(false);
                  }}
                />
              )}
              {compact && (
                <>
                  <MenuSection label="Microphone">
                    <MediaDeviceMenu kind="audioinput" />
                  </MenuSection>
                  <MenuSection label="Camera">
                    <MediaDeviceMenu kind="videoinput" />
                  </MenuSection>
                </>
              )}
              {canSelectSpeaker && (
                <MenuSection label="Speaker">
                  <MediaDeviceMenu kind="audiooutput" />
                </MenuSection>
              )}
              {!canSelectSpeaker && !compact && (
                <p className="px-2 py-1.5 text-[11px] leading-snug text-white/45">
                  This browser cannot choose the speaker. Change it in your
                  system sound settings.
                </p>
              )}
            </div>
          </Popover>
        )}
      </div>

      {/* ── Leave ──────────────────────────────────────────────────── */}
      <DisconnectButton
        aria-label="Leave the meeting"
        title="Leave"
        className={`ml-1 grid ${compact ? "h-9" : "h-11"} place-items-center rounded-full bg-rose-600 px-4 text-white transition-colors hover:bg-rose-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-300`}
      >
        <HangupIcon />
      </DisconnectButton>
    </div>
  );
}

/* ──────────────────────────────────────────────────────── building blocks */

type Tone = "neutral" | "danger" | "on" | "raised" | "attention";

function toneClass(tone: Tone): string {
  switch (tone) {
    case "danger":
      return "bg-rose-600 text-white hover:bg-rose-500";
    case "on":
      return "bg-white text-neutral-900 hover:bg-white/90";
    case "raised":
      return "bg-amber-400 text-amber-950 hover:bg-amber-300";
    case "attention":
      return "bg-amber-400/25 text-amber-100 hover:bg-amber-400/35";
    default:
      return "bg-white/10 text-white hover:bg-white/20";
  }
}

/** The shared shape: a circle, one size, one focus ring. */
function round(compact: boolean, tone: Tone): string {
  return `relative grid ${compact ? "h-9 w-9" : "h-11 w-11"} shrink-0 place-items-center rounded-full transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/70 ${toneClass(tone)}`;
}

function RoundButton({
  children,
  compact,
  tone,
  label,
  pressed,
  onClick,
  badge = 0,
  count,
}: {
  children: ReactNode;
  compact: boolean;
  tone: Tone;
  label: string;
  pressed?: boolean;
  onClick: () => void;
  badge?: number;
  count?: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={pressed}
      aria-label={label}
      title={label}
      className={round(compact, tone)}
    >
      {children}
      {typeof count === "number" && count > 0 && (
        <span className="absolute -right-0.5 -top-0.5 min-w-[17px] rounded-full bg-white/90 px-1 text-[10px] font-bold leading-[17px] tabular-nums text-neutral-900">
          {count > 99 ? "99" : count}
        </span>
      )}
      {badge > 0 && (
        <span
          className="absolute -right-0.5 -top-0.5 min-w-[17px] rounded-full bg-rose-500 px-1 text-[10px] font-bold leading-[17px] text-white"
          aria-label={`${badge} unread`}
        >
          {badge > 9 ? "9+" : badge}
        </span>
      )}
    </button>
  );
}

/**
 * A toggle with its device picker one button away.
 *
 * The chevron is a separate, smaller target on purpose: "mute me" and "which
 * microphone" are different intentions, and merging them means every mute is a
 * menu.
 */
function SplitControl({
  children,
  deviceKind,
  compact,
  showChevron,
}: {
  children: ReactNode;
  deviceKind: "audioinput" | "videoinput";
  compact: boolean;
  showChevron: boolean;
}) {
  return (
    <div className="flex items-center">
      {children}
      {showChevron && (
        <div
          className={`lk-cowork-device-menu -ml-1 grid ${compact ? "h-9" : "h-11"} shrink-0 place-items-center`}
        >
          <MediaDeviceMenu kind={deviceKind} />
        </div>
      )}
    </div>
  );
}

/** A menu anchored above its button, with click-away and Escape. */
function Popover({
  children,
  onClose,
  label,
}: {
  children: ReactNode;
  onClose: () => void;
  label: string;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <>
      <div className="fixed inset-0 z-30" aria-hidden onClick={onClose} />
      <div
        ref={ref}
        role="menu"
        aria-label={label}
        className="absolute bottom-full left-1/2 z-40 mb-2 -translate-x-1/2 rounded-xl border border-white/15 bg-neutral-900/97 p-1.5 shadow-2xl backdrop-blur"
      >
        {children}
      </div>
    </>
  );
}

function MenuRow({
  icon,
  label,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-[13px] text-white/90 transition-colors hover:bg-white/10"
    >
      <span className="grid h-4 w-4 shrink-0 place-items-center text-white/70">
        {icon}
      </span>
      {label}
    </button>
  );
}

function MenuSection({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="lk-cowork-device-menu px-2 py-1.5">
      <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-white/45">
        {label}
      </p>
      {children}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────── icons */
/* Drawn rather than emoji: an emoji is a different typeface on every machine,
   renders in colour beside monochrome controls, and cannot take the button's
   colour when the button turns red. These are 20px line icons on a 24 grid. */

const S = {
  width: 20,
  height: 20,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
};

function MicIcon() {
  return (
    <svg {...S}>
      <path d="M12 3.5a2.5 2.5 0 0 1 2.5 2.5v6a2.5 2.5 0 0 1-5 0V6A2.5 2.5 0 0 1 12 3.5Z" />
      <path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" />
    </svg>
  );
}

function MicOffIcon() {
  return (
    <svg {...S}>
      <path d="M9.5 5.9A2.5 2.5 0 0 1 14.5 6v4.2M14.5 14.3a2.5 2.5 0 0 1-5-1.3V11" />
      <path d="M5.5 11a6.5 6.5 0 0 0 10.2 5.3M18.5 11v.6M12 17.5V21" />
      <path d="M3.5 3.5 20.5 20.5" />
    </svg>
  );
}

function CamIcon() {
  return (
    <svg {...S}>
      <rect x="2.5" y="6.5" width="12.5" height="11" rx="2.5" />
      <path d="M15 11l6.5-3.2v8.4L15 13z" />
    </svg>
  );
}

function CamOffIcon() {
  return (
    <svg {...S}>
      <path d="M15 10.5V9a2.5 2.5 0 0 0-2.5-2.5H7.8M4.2 6.6A2.5 2.5 0 0 0 2.5 9v6a2.5 2.5 0 0 0 2.5 2.5h7.5c.6 0 1.2-.2 1.6-.6" />
      <path d="M21.5 7.8 15 11v2l6.5 3.2z" />
      <path d="M3.5 3.5 20.5 20.5" />
    </svg>
  );
}

function PresentIcon() {
  return (
    <svg {...S}>
      <rect x="2.5" y="4.5" width="19" height="12.5" rx="2" />
      <path d="M8.5 20.5h7M12 8.5v5M12 8.5 9.8 10.7M12 8.5l2.2 2.2" />
    </svg>
  );
}

function SmileyIcon() {
  return (
    <svg {...S}>
      <circle cx="12" cy="12" r="9" />
      <path d="M8.5 14.2a4.2 4.2 0 0 0 7 0" />
      <path d="M9 9.5h.01M15 9.5h.01" strokeWidth={2.4} />
    </svg>
  );
}

function CaptionsIcon() {
  return (
    <svg {...S}>
      <rect x="2.5" y="5" width="19" height="14" rx="2.5" />
      <path d="M10 10.4a2.6 2.6 0 1 0 0 3.2M17.5 10.4a2.6 2.6 0 1 0 0 3.2" />
    </svg>
  );
}

function HandIcon() {
  return (
    <svg {...S}>
      <path d="M8 11V5.6a1.55 1.55 0 1 1 3.1 0V10M11.1 10V4.6a1.55 1.55 0 1 1 3.1 0V10M14.2 10.4V6.6a1.55 1.55 0 0 1 3.1 0V14a7 7 0 0 1-7 7h-.4a6 6 0 0 1-5-2.7l-2-3a1.6 1.6 0 0 1 2.5-2L8 15.2V11" />
    </svg>
  );
}

function ChatIcon() {
  return (
    <svg {...S}>
      <path d="M21 11.6c0 4-3.9 7.2-8.7 7.2a10 10 0 0 1-2.6-.34L4.5 20.5l1.2-3.6A6.9 6.9 0 0 1 3.6 11.6c0-4 3.9-7.1 8.7-7.1s8.7 3.2 8.7 7.1Z" />
    </svg>
  );
}

function PeopleIcon() {
  return (
    <svg {...S}>
      <circle cx="9" cy="8" r="3.2" />
      <path d="M2.8 19.5a6.4 6.4 0 0 1 12.4 0" />
      <path d="M16 5.2a3.2 3.2 0 0 1 0 5.9M17.6 13.6a6.4 6.4 0 0 1 3.6 5.9" />
    </svg>
  );
}

function MoreIcon() {
  return (
    <svg {...S}>
      <circle cx="12" cy="5.5" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="12" cy="18.5" r="1.4" fill="currentColor" stroke="none" />
    </svg>
  );
}

function HangupIcon() {
  return (
    <svg {...S} width={22} height={22}>
      <path d="M2.8 14.2c5-4.6 13.4-4.6 18.4 0l-1.5 2.6c-.5.8-1.5 1-2.3.6l-2.4-1.2a1.7 1.7 0 0 1-.9-1.7l.14-1.3a11.4 11.4 0 0 0-4.5 0l.14 1.3a1.7 1.7 0 0 1-.9 1.7l-2.4 1.2c-.8.4-1.8.2-2.3-.6z" />
    </svg>
  );
}
