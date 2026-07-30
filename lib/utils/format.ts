/**
 * Formatting helpers. Deterministic and locale-pinned so server and client
 * render identical strings — a locale-dependent `toLocaleString` is a classic
 * hydration mismatch.
 *
 * **Every time this application shows is IST**, whatever machine renders it.
 *
 * These read `getUTC*` and so displayed UTC: a deadline of 14:45 IST rendered
 * as "09:15", five and a half hours early, for everybody. That is the same
 * clock the office runs on being wrong on every screen — deadlines, history,
 * approval times, notifications.
 *
 * The offset is applied by shifting the instant and then reading its UTC parts.
 * That is exact rather than approximate: **IST is UTC+05:30 and has never
 * observed daylight saving**, so one fixed offset is the whole rule. It also
 * keeps the determinism the note above is about — no `Intl`, no locale, no
 * device timezone, so the server and the browser cannot disagree.
 */

/** IST is UTC+05:30, with no daylight saving. */
const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;

/** The same instant, shifted so `getUTC*` yields IST wall-clock parts. */
function ist(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return new Date(d.getTime() + IST_OFFSET_MS);
}

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

export function formatDate(iso: string | null | undefined): string {
  const d = ist(iso);
  if (!d) return "—";
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

/**
 * Hour of the IST day as a decimal — 14:30 IST is 14.5.
 *
 * For anything positioning against a working day. `getUTCHours()` was used
 * directly for this, which drew a session worked at 14:30 five and a half hours
 * to the left, at 09:00. Returns null for an absent or unparseable instant so a
 * caller places nothing rather than placing it at midnight.
 */
export function istHourOfDay(iso: string | null | undefined): number | null {
  const d = ist(iso);
  if (!d) return null;
  return d.getUTCHours() + d.getUTCMinutes() / 60;
}

/** A full stamp for a record: `29 Jul 2026 · 15:15 IST`. */
export function formatStamp(iso: string | null | undefined): string {
  const d = ist(iso);
  if (!d) return "—";
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()} · ${hh}:${mm} IST`;
}

/** With the year, for anything that outlives the current one. */
export function formatDateFull(iso: string | null | undefined): string {
  const d = ist(iso);
  if (!d) return "—";
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

export function formatDateTime(iso: string | null | undefined): string {
  const d = ist(iso);
  if (!d) return "—";
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} · ${hh}:${mm} IST`;
}

export function formatDuration(secs: number | null | undefined): string {
  if (!secs || secs <= 0) return "0m";
  const h = Math.floor(secs / 3600);
  const m = Math.round((secs % 3600) / 60);
  if (h && m) return `${h}h ${m}m`;
  if (h) return `${h}h`;
  return `${m}m`;
}

/**
 * A running clock: `0:07`, `12:40`, `1:03:45`.
 *
 * `formatDuration` is for totals and rounds to the minute, which makes a live
 * timer sit on "0m" for its first half-minute and read as broken. A timer that
 * is running shows seconds; the moment it stops it goes back to a total.
 */
/**
 * A clock reading, always `HH:MM:SS`.
 *
 * **Always all three parts, always padded.** This dropped the hour when it was
 * zero and left the minutes unpadded, so one screen could show "0:07", "3:22"
 * and "1:05:30" together — three widths for one kind of value, and "3:22"
 * genuinely ambiguous between three minutes and three hours until you read the
 * label beside it. A fixed shape also stops the figure jumping sideways as it
 * ticks past a minute or an hour, which on a live timer is the whole point.
 *
 * Hours are NOT capped at 24: a total worked across many sessions is a
 * duration, not a time of day, and rolling it over would silently lose a day.
 */
/**
 * A span of time, always `HH:MM:SS` — deadlines, budgets, effort estimates.
 *
 * **Deliberately a separate name from `formatTimer`, with the same shape.** The
 * two answer different questions — time already worked against time allowed —
 * and a call site reads better saying which it means. Sharing one implementation
 * keeps them identical today; having two names means either can change without
 * a rename touching every deadline in the product.
 *
 * Like `formatTimer`, hours are not capped: a 50-hour window is `50:00:00`,
 * because it is a duration and not a time of day.
 */
export function formatDurationTimer(secs: number | null | undefined): string {
  return formatTimer(secs);
}

export function formatTimer(secs: number | null | undefined): string {
  /* `Math.floor(NaN)` is NaN and `Math.max(0, NaN)` is NaN, so an unparsed
     figure rendered as "NaN:NaN:NaN" on the timer. A non-finite input means we
     do not know the elapsed time, and zero is the honest reading of that. */
  const raw = Number(secs);
  const total = Number.isFinite(raw) ? Math.max(0, Math.floor(raw)) : 0;
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}

/** Relative time against the prototype clock, passed in so it stays pure. */
export function formatRelative(iso: string, now: Date): string {
  const diffMs = new Date(iso).getTime() - now.getTime();
  const past = diffMs < 0;
  const abs = Math.abs(diffMs);
  const mins = Math.round(abs / 60000);
  const hrs = Math.round(abs / 3600000);
  const days = Math.round(abs / 86400000);

  let value: string;
  if (mins < 1) return "just now";
  if (mins < 60) value = `${mins}m`;
  else if (hrs < 24) value = `${hrs}h`;
  else value = `${days}d`;

  return past ? `${value} ago` : `in ${value}`;
}

export function formatPoints(n: number): string {
  return n.toFixed(2).replace(/\.00$/, "");
}

/** Minus sign U+2212, not a hyphen — these are numeric values. */
export function formatPercent(n: number | null | undefined): string | null {
  /*
   * **Null rather than "NaN%".** `Math.round(undefined)` is NaN and templates
   * it straight into the DOM — the extension chain printed "Penalty charged at
   * NaN% elapsed" because it read a field its data shape does not have.
   *
   * Returning null rather than "0%" makes the caller choose: an unmeasured
   * figure and a measured zero are different claims, and rendering the first
   * as the second asserts something nobody computed.
   */
  if (n === null || n === undefined) return null;
  const v = Number(n);
  if (!Number.isFinite(v)) return null;
  return v < 0 ? `−${Math.abs(Math.round(v))}%` : `${Math.round(v)}%`;
}

export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase();
}
