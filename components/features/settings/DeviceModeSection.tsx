"use client";

import { Chip, Panel, PanelHead } from "@/components/ui/Primitives";
import { useDeviceMode } from "@/components/layout/shell/DeviceModeContext";
import { DEVICE_MODES } from "@/lib/rules/performance/deviceMode";

/**
 * Settings → Performance → Device mode.
 *
 * **In personal settings, not the admin console.** This is a property of the
 * machine in front of you: one person may use a fast desktop and a slow laptop,
 * and an administrator setting it for somebody else would be deciding how
 * another person's hardware behaves. It is stored per browser.
 *
 * ## What it says, and what it refuses to say
 *
 * Each option names the cost it removes rather than promising a speed. Nothing
 * here claims a frame rate: the effects are measurable but the result depends on
 * a GPU nobody has profiled, and a number invented for reassurance is worse than
 * no number.
 *
 * The one promise made is the one that matters and is verifiable: **nothing
 * stops working.** Presence, timers, deadlines, screen sharing and notifications
 * are untouched — the mode reaches rendering only.
 */
export function DeviceModeSection() {
  const { mode, setMode, signals, profile } = useDeviceMode();

  return (
    <Panel padded={false} data-help="device-mode">
      <PanelHead
        title="Device mode"
        sub="How much work this browser does to draw the interface. Stored on this machine, not on your account."
      />

      <fieldset className="divide-y divide-hairline border-t border-hairline">
        <legend className="sr-only">Device mode</legend>
        {DEVICE_MODES.map((option) => {
          const on = option.id === mode;
          return (
            <label
              key={option.id}
              className={`flex cursor-pointer items-start gap-2.5 px-4 py-3 transition-colors ${
                on ? "bg-[var(--surface-sunken)]" : "hover:bg-[var(--row-hover)]"
              }`}
            >
              <input
                type="radio"
                name="device-mode"
                checked={on}
                onChange={() => setMode(option.id)}
                className="mt-0.5"
              />
              <span className="min-w-0">
                <span className="flex flex-wrap items-center gap-2 text-sm text-ink">
                  {option.label}
                  {option.id === "balanced" && <Chip>Default</Chip>}
                  {/* Said on the option itself, because it is the reason
                      somebody would pick this one over the mode below it. */}
                  {option.id === "lite" && <Chip>Same look</Chip>}
                </span>
                <span className="mt-0.5 block max-w-[68ch] text-[11px] leading-relaxed text-ink-faint">
                  {option.hint}
                </span>
              </span>
            </label>
          );
        })}
      </fieldset>

      <div className="border-t border-hairline px-4 py-3">
        <p className="text-[11px] tracking-[0.09em] text-ink-faint uppercase">
          What this machine reports
        </p>
        <dl className="mt-1.5 flex flex-wrap gap-x-5 gap-y-1">
          <Signal
            label="Processor cores"
            value={signals.cores === null ? "not reported" : String(signals.cores)}
          />
          <Signal
            label="Memory"
            value={
              signals.memoryGb === null
                ? "not reported"
                : `about ${signals.memoryGb}GB`
            }
          />
          <Signal
            label="Reduced motion"
            value={signals.prefersReducedMotion ? "on" : "off"}
          />
        </dl>
        {/* Said plainly, because a reader comparing these to their spec sheet
            will otherwise think the product is wrong. */}
        <p className="mt-2 max-w-[68ch] text-[11px] leading-relaxed text-ink-faint">
          Browsers report these coarsely — memory is rounded down and caps at 8GB
          however much is fitted, and Safari reports neither. Neither figure says
          anything about the graphics chip, which is what actually struggles with
          the frosted surfaces. They are a hint for the suggestion, never a
          verdict on your machine.
        </p>
      </div>

      <div className="border-t border-hairline px-4 py-3">
        <p className="text-[11px] tracking-[0.09em] text-ink-faint uppercase">
          In this mode
        </p>
        <ul className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-ink-muted">
          <Effect
            state={
              profile.blur ? "on" : profile.paintedFrost ? "painted" : "off"
            }
            label="Frosted surfaces"
          />
          <Effect
            state={
              profile.backdropField === "none"
                ? "off"
                : profile.backdropField === "painted"
                  ? "painted"
                  : "on"
            }
            label="Moving background"
          />
          <Effect state={profile.animations ? "on" : "off"} label="Animation" />
          <Effect
            state={profile.richCharts ? "on" : "off"}
            label="Charts and graphs"
          />
          <Effect
            state={profile.timerTickMs <= 1000 ? "on" : "off"}
            label="Timer redraws every second"
          />
        </ul>
        {/* What "painted" means, said once and only where it applies. Somebody
            looking at a frosted surface marked "painted" will otherwise assume
            the label is wrong — the whole point is that it looks the same. */}
        {(profile.paintedFrost || profile.backdropField === "painted") && (
          <p className="mt-2 max-w-[68ch] text-[11px] leading-relaxed text-ink-faint">
            Painted means the effect is drawn once and then left alone, instead
            of being worked out again for every frame. It is the same picture on
            screen; your graphics chip simply stops recomputing it while you
            scroll. The blur behind the top bar is the clearest case — it was
            costing a full pass to reveal about six percent of what is under it.
          </p>
        )}
        <p className="mt-2 max-w-[68ch] text-[11px] leading-relaxed text-ink-faint">
          Presence, task timers, deadlines, screen sharing, notifications and
          every rule behind them work identically in all four modes. A timer
          redrawing every two seconds is still counting every second — the figure
          is worked out from when you started, not added up from the redraws.
        </p>
      </div>
    </Panel>
  );
}

function Signal({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] text-ink-faint">{label}</dt>
      <dd data-figure className="text-[12px] text-ink">
        {value}
      </dd>
    </div>
  );
}

/**
 * One effect, in one of three states.
 *
 * `painted` is neither on nor off and is not struck through, because striking
 * it through would be a lie about the screen the reader is looking at: the
 * frosted surface is still there. It is marked as an approximation instead, and
 * the paragraph above says what the approximation is.
 */
function Effect({
  state,
  label,
}: {
  state: "on" | "painted" | "off";
  label: string;
}) {
  const mark = state === "on" ? "✓" : state === "painted" ? "≈" : "—";
  return (
    <li className="flex items-center gap-1.5">
      <span aria-hidden className={state === "off" ? "text-ink-faint" : "text-ink"}>
        {mark}
      </span>
      <span
        className={
          state === "off" ? "text-ink-faint line-through" : "text-ink-muted"
        }
      >
        {label}
        {state === "painted" && (
          <span className="text-ink-faint"> · painted</span>
        )}
      </span>
    </li>
  );
}

/**
 * The offer, shown once, where the machine looks like it would benefit.
 *
 * **Suggested rather than applied.** The signals are coarse and say nothing
 * about the GPU; downgrading somebody's interface on that evidence would be
 * acting on a guess about their hardware. Dismissing it is remembered, and so is
 * choosing to stay where they are.
 *
 * ## Why the gentler mode is offered first
 *
 * The signals here are a guess, and the cost of a wrong guess is what decides
 * the order. Lightweight keeps the interface looking as it does and removes the
 * per-frame work, so being wrong about the machine costs the reader nothing.
 * Low-end mode is a real trade — flat surfaces, no motion — and is worth making
 * only once somebody knows they need it. Both are still offered, because a
 * suggestion that has already chosen for you is not a suggestion.
 */
export function DeviceModeSuggestion() {
  const { suggestion, setMode, dismissSuggestion } = useDeviceMode();
  if (!suggestion) return null;

  return (
    <Panel className="mb-4">
      <p className="text-sm text-ink">
        This browser may run Cowork more smoothly in a lighter mode.
      </p>
      <p className="mt-1 max-w-[68ch] text-[11px] leading-relaxed text-ink-faint">
        {suggestion} Lightweight mode looks exactly like the interface you have
        now — the frosted surfaces and the drifting background are painted once
        instead of being recalculated for every frame. Low-end mode goes further
        and makes everything flat and still. Either way presence, timers,
        deadlines, screen sharing and notifications are untouched.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setMode("lite")}
          className="rounded-full bg-ink px-3 py-1.5 text-xs font-medium text-[var(--body-bg)]"
        >
          Use lightweight mode
        </button>
        <button
          type="button"
          onClick={() => setMode("low")}
          className="rounded-full bg-[var(--control)] px-3 py-1.5 text-xs font-medium text-ink-muted hover:text-ink"
        >
          Use low-end mode
        </button>
        <button
          type="button"
          onClick={dismissSuggestion}
          className="rounded-full bg-[var(--control)] px-3 py-1.5 text-xs font-medium text-ink-muted hover:text-ink"
        >
          Keep the full interface
        </button>
      </div>
    </Panel>
  );
}
