"use client";

import { useTheme, type ThemePreference } from "./ThemeContext";

/**
 * Light / System / Dark.
 *
 * Renders a fixed-width placeholder until mounted so the server and first
 * client render agree — the stored preference is not knowable during SSR, and
 * rendering the "real" state early is exactly what causes a hydration mismatch.
 */

function SunIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      className="h-[15px] w-[15px]"
      fill="none"
      aria-hidden="true"
    >
      <circle cx="8" cy="8" r="3.1" stroke="currentColor" strokeWidth="1.3" />
      <path
        d="M8 1.4v1.6M8 13v1.6M14.6 8H13M3 8H1.4M12.7 3.3l-1.1 1.1M4.4 11.6l-1.1 1.1M12.7 12.7l-1.1-1.1M4.4 4.4L3.3 3.3"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
      />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      className="h-[15px] w-[15px]"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M13.4 9.6A5.8 5.8 0 0 1 6.4 2.6a5.9 5.9 0 1 0 7 7Z"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function SystemIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      className="h-[15px] w-[15px]"
      fill="none"
      aria-hidden="true"
    >
      <rect
        x="1.8"
        y="2.8"
        width="12.4"
        height="8.4"
        rx="1.5"
        stroke="currentColor"
        strokeWidth="1.3"
      />
      <path
        d="M5.6 13.6h4.8"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
      />
    </svg>
  );
}

const options: {
  id: ThemePreference;
  label: string;
  icon: () => React.ReactElement;
}[] = [
  { id: "light", label: "Light", icon: SunIcon },
  { id: "system", label: "System", icon: SystemIcon },
  { id: "dark", label: "Dark", icon: MoonIcon },
];

export function ThemeToggle() {
  const { preference, setPreference, mounted } = useTheme();

  if (!mounted) {
    return (
      <span className="block h-8 w-[102px] rounded-full bg-[var(--surface-sunken)]" />
    );
  }

  function onKeyDown(e: React.KeyboardEvent) {
    const forward = e.key === "ArrowRight" || e.key === "ArrowDown";
    const back = e.key === "ArrowLeft" || e.key === "ArrowUp";
    if (!forward && !back) return;
    e.preventDefault();
    const i = options.findIndex((o) => o.id === preference);
    const next = (i + (forward ? 1 : -1) + options.length) % options.length;
    setPreference(options[next].id);
    (e.currentTarget as HTMLElement)
      .querySelectorAll<HTMLButtonElement>("[role=radio]")
      [next]?.focus();
  }

  return (
    <div
      role="radiogroup"
      aria-label="Appearance"
      onKeyDown={onKeyDown}
      className="inline-flex gap-0.5 rounded-full bg-[var(--surface-sunken)] p-[3px]"
    >
      {options.map((o) => {
        const active = preference === o.id;
        const Icon = o.icon;
        return (
          <button
            key={o.id}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={o.label}
            title={o.label}
            tabIndex={active ? 0 : -1}
            onClick={() => setPreference(o.id)}
            className={`grid h-[26px] w-[26px] place-items-center rounded-full transition-[color,background-color] duration-[180ms] ease-[var(--ease-deck)] ${
              active
                ? "bg-ink text-[var(--body-bg)]"
                : "text-ink-muted hover:text-ink"
            }`}
          >
            <Icon />
          </button>
        );
      })}
    </div>
  );
}
