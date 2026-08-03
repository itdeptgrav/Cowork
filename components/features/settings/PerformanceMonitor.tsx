"use client";

import { useEffect, useRef, useState } from "react";
import { Button, Chip, Panel, PanelHead } from "@/components/ui/Primitives";
import { useDeviceMode } from "@/components/layout/shell/DeviceModeContext";

/**
 * The performance monitor. **Off by default, and that is not a detail.**
 *
 * A monitor that samples every frame to tell you your frame rate is low is
 * itself a cost on the machine least able to carry it. So it mounts nothing
 * until somebody asks, and stops the moment they close it — an FPS counter left
 * running is the observer changing what it observes.
 *
 * ## What each figure is, and what it is not
 *
 * **FPS** is measured from `requestAnimationFrame` deltas. That is the rate the
 * browser is *servicing animation frames*, which on an idle page is not a
 * complaint — a still page legitimately renders nothing. It is meaningful while
 * you scroll or drag.
 *
 * **Memory** is `performance.memory.usedJSHeapSize`: Chrome-family only, the JS
 * heap alone, and it does not include the compositing layers that a blurred
 * surface actually costs. So it is a useful trend and a poor absolute.
 *
 * Both are reported with those limits attached rather than as bare numbers,
 * because a figure without its caveat is how somebody concludes the wrong thing
 * and changes the wrong setting.
 */
export function PerformanceMonitor() {
  const { mode, profile } = useDeviceMode();
  const [running, setRunning] = useState(false);
  const [fps, setFps] = useState<number | null>(null);
  const [heapMb, setHeapMb] = useState<number | null>(null);
  const frames = useRef(0);
  const since = useRef(0);

  useEffect(() => {
    if (!running) return;
    let raf = 0;
    let stopped = false;
    frames.current = 0;
    since.current = performance.now();

    const tick = () => {
      if (stopped) return;
      frames.current += 1;
      const now = performance.now();
      const elapsed = now - since.current;
      /* Sampled once a second rather than per frame: a counter that re-renders
         React sixty times a second is the cost it is measuring. */
      if (elapsed >= 1000) {
        setFps(Math.round((frames.current * 1000) / elapsed));
        const mem = (
          performance as Performance & {
            memory?: { usedJSHeapSize: number };
          }
        ).memory;
        setHeapMb(
          mem ? Math.round(mem.usedJSHeapSize / 1024 / 1024) : null,
        );
        frames.current = 0;
        since.current = now;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
    };
  }, [running]);

  /* The features that actually cost something, read from the live profile rather
     than restated — a list that could disagree with the mode would be worse than
     no list. */
  const heavy = [
    { label: "Frosted surfaces (backdrop blur)", on: profile.blur },
    {
      label: "Animated background field",
      on: profile.backdropField === "animated",
    },
    { label: "Interface animation", on: profile.animations },
    { label: "Charts and sparklines", on: profile.richCharts },
    { label: "Live screen preview", on: profile.livePreview },
  ];

  return (
    <Panel padded={false} data-help="performance-monitor">
      <PanelHead
        title="Performance monitor"
        sub="For diagnosing a slow machine. Off by default — a monitor that samples every frame costs what it measures."
      />

      <div className="flex flex-wrap items-center gap-2 border-t border-hairline px-4 py-3">
        <Button size="sm" onClick={() => setRunning((r) => !r)}>
          {running ? "Stop measuring" : "Start measuring"}
        </Button>
        <Chip>{mode}</Chip>
        {running && (
          <span className="text-[11px] text-ink-faint">
            Scroll or drag something — a still page renders nothing, and a low
            number on an idle screen is not a fault.
          </span>
        )}
      </div>

      {running && (
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 border-t border-hairline px-4 py-3 sm:grid-cols-3">
          <Reading
            label="Frames per second"
            value={fps === null ? "…" : String(fps)}
            note="While the page is moving"
          />
          <Reading
            label="JS heap"
            value={heapMb === null ? "not reported" : `${heapMb} MB`}
            note="Chrome only; excludes GPU layers"
          />
          <Reading
            label="Timer redraw"
            value={`${profile.timerTickMs / 1000}s`}
            note="Display only — counting is exact"
          />
        </dl>
      )}

      <div className="border-t border-hairline px-4 py-3">
        <p className="text-[11px] tracking-[0.09em] text-ink-faint uppercase">
          Expensive features enabled
        </p>
        <ul className="mt-1.5 flex flex-col gap-1">
          {heavy.map((f) => (
            <li
              key={f.label}
              className="flex items-center gap-2 text-[12px] text-ink-muted"
            >
              <span aria-hidden className={f.on ? "text-ink" : "text-ink-faint"}>
                {f.on ? "●" : "○"}
              </span>
              <span className={f.on ? "" : "text-ink-faint"}>{f.label}</span>
            </li>
          ))}
        </ul>
        {/* The one thing that outweighs everything above, and it is a feature
            rather than chrome — so it belongs in the reckoning even though no
            mode turns it off. */}
        <p className="mt-2.5 max-w-[70ch] text-[11px] leading-relaxed text-ink-faint">
          Sharing your screen to go online costs more than every item above
          combined: it captures and encodes your whole display continuously. No
          device mode changes that, because presence depends on it — if this
          machine struggles while you are online, that is the first thing to
          weigh, not the interface.
        </p>
      </div>
    </Panel>
  );
}

function Reading({
  label,
  value,
  note,
}: {
  label: string;
  value: string;
  note: string;
}) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] text-ink-faint">{label}</dt>
      <dd
        data-figure
        className="mt-0.5 text-[18px] leading-none font-light tracking-[-0.02em] text-ink"
      >
        {value}
      </dd>
      <p className="mt-1 text-[11px] leading-relaxed text-ink-faint">{note}</p>
    </div>
  );
}
