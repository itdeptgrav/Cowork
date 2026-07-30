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
          <Effect on={profile.blur} label="Frosted surfaces" />
          <Effect on={profile.animations} label="Animation" />
          <Effect on={profile.richCharts} label="Charts and graphs" />
          <Effect
            on={profile.timerTickMs <= 1000}
            label="Timer redraws every second"
          />
        </ul>
        <p className="mt-2 max-w-[68ch] text-[11px] leading-relaxed text-ink-faint">
          Presence, task timers, deadlines, screen sharing, notifications and
          every rule behind them work identically in all three modes. A timer
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

function Effect({ on, label }: { on: boolean; label: string }) {
  return (
    <li className="flex items-center gap-1.5">
      <span aria-hidden className={on ? "text-ink" : "text-ink-faint"}>
        {on ? "✓" : "—"}
      </span>
      <span className={on ? "text-ink-muted" : "text-ink-faint line-through"}>
        {label}
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
 */
export function DeviceModeSuggestion() {
  const { suggestion, setMode, dismissSuggestion } = useDeviceMode();
  if (!suggestion) return null;

  return (
    <Panel className="mb-4">
      <p className="text-sm text-ink">
        This browser may run Cowork more smoothly in low-end laptop mode.
      </p>
      <p className="mt-1 max-w-[68ch] text-[11px] leading-relaxed text-ink-faint">
        {suggestion} Low-end mode drops the frosted surfaces and the animation
        and keeps everything else exactly as it is — presence, timers, deadlines,
        screen sharing and notifications are untouched.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setMode("low")}
          className="rounded-full bg-ink px-3 py-1.5 text-xs font-medium text-[var(--body-bg)]"
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
