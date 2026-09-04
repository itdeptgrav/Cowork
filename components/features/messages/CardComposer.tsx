"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Employee, MessageCard, MessagePollOption } from "@/lib/domain";
import { Icon } from "@/components/ui/Icons";
import { Avatar } from "@/components/ui/Avatar";

/* ── Resolving "where am I" robustly ────────────────────────────────────────
 *
 * On Windows, Chrome and Edge hand the actual position fix to the OS location
 * provider. A granted SITE permission (the prompt the user allowed) is only
 * half of it: if the OS gate is off, the machine has no Wi-Fi to scan, or the
 * provider is merely warming up, `getCurrentPosition` fails with code 2
 * (POSITION_UNAVAILABLE) — and Chromium has a long-standing race where the very
 * FIRST call fails and an identical retry a second later succeeds. So one
 * one-shot call is not enough. This resolves the position through a ladder —
 * fast-and-coarse, then a fresh GPS attempt, then a short watch — and finally,
 * if the device simply cannot produce a fix, falls back to an APPROXIMATE
 * location derived from the network (IP), clearly labelled as approximate.
 * A hard PERMISSION_DENIED short-circuits and never falls through to IP.
 */

type LocateResult =
  | { ok: true; lat: number; lng: number; approximate: boolean }
  | { ok: false; reason: "denied" | "unavailable" };

const getPos = (opts: PositionOptions): Promise<GeolocationPosition> =>
  new Promise((resolve, reject) =>
    navigator.geolocation.getCurrentPosition(resolve, reject, opts),
  );

/** watchPosition resolved on its FIRST fix, then cleared — it lands a fix on
 *  devices where getCurrentPosition rejects at its deadline while the provider
 *  is still acquiring. Bounded by our own wall-clock timer, because the per-fix
 *  `timeout` does not bound the whole watch. */
function firstWatchFix(
  opts: PositionOptions,
  wallMs: number,
): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    let done = false;
    let watchId = -1;
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      if (watchId !== -1) navigator.geolocation.clearWatch(watchId);
      reject(new Error("watch-timeout"));
    }, wallMs);
    watchId = navigator.geolocation.watchPosition(
      (p) => {
        if (done) return;
        done = true;
        navigator.geolocation.clearWatch(watchId);
        clearTimeout(timer);
        resolve(p);
      },
      (err) => {
        /* Only a hard denial ends the watch; anything else leaves it waiting
           for a later fix, up to the wall-clock guard. */
        if (!done && err.code === err.PERMISSION_DENIED) {
          done = true;
          navigator.geolocation.clearWatch(watchId);
          clearTimeout(timer);
          reject(err);
        }
      },
      opts,
    );
  });
}

/** Approximate coordinates from the caller's IP — the last resort when the
 *  device cannot produce a fix. Keyless, HTTPS, CORS-open services; the primary
 *  carries a `success` flag and numeric coords, the secondary returns strings.
 *  Each call is bounded so a slow service cannot hang the share. */
async function ipApproxLocation(): Promise<{ lat: number; lng: number } | null> {
  const fetchJson = async (
    url: string,
  ): Promise<Record<string, unknown> | null> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6000);
    try {
      const res = await fetch(url, { signal: controller.signal });
      if (!res.ok) return null;
      const data = await res.json();
      return data && typeof data === "object"
        ? (data as Record<string, unknown>)
        : null;
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  };
  const a = await fetchJson("https://ipwho.is/");
  if (a && a.success !== false && a.latitude != null && a.longitude != null) {
    return { lat: Number(a.latitude), lng: Number(a.longitude) };
  }
  const b = await fetchJson("https://get.geojs.io/v1/ip/geo.json");
  if (b && b.latitude != null && b.longitude != null) {
    return { lat: Number(b.latitude), lng: Number(b.longitude) };
  }
  return null;
}

async function resolveLocation(): Promise<LocateResult> {
  const secure =
    typeof window === "undefined" || window.isSecureContext !== false;
  const hasGeo =
    typeof navigator !== "undefined" && "geolocation" in navigator;

  if (secure && hasGeo) {
    /* Rung 1 — fast, coarse, a recent cached fix accepted: the attempt most
       likely to return at all, and instantly when a fix is already warm. */
    try {
      const p = await getPos({
        enableHighAccuracy: false,
        timeout: 8000,
        maximumAge: 60000,
      });
      return { ok: true, lat: p.coords.latitude, lng: p.coords.longitude, approximate: false };
    } catch (e) {
      if ((e as GeolocationPositionError).code === 1) return { ok: false, reason: "denied" };
    }
    /* Rung 2 — a FRESH high-accuracy fix: a different provider path (GPS), and
       the retry that absorbs Chromium's "first call after load fails" race. */
    try {
      const p = await getPos({
        enableHighAccuracy: true,
        timeout: 12000,
        maximumAge: 0,
      });
      return { ok: true, lat: p.coords.latitude, lng: p.coords.longitude, approximate: false };
    } catch (e) {
      if ((e as GeolocationPositionError).code === 1) return { ok: false, reason: "denied" };
    }
    /* Rung 3 — watch for the first fix, for a provider still warming up. */
    try {
      const p = await firstWatchFix({ enableHighAccuracy: true, maximumAge: 0 }, 9000);
      return { ok: true, lat: p.coords.latitude, lng: p.coords.longitude, approximate: false };
    } catch (e) {
      if ((e as GeolocationPositionError | undefined)?.code === 1)
        return { ok: false, reason: "denied" };
    }
  }

  /* Rung 4 — approximate location from the network. Reached when the device has
     no fix at all (OS location off, no Wi-Fi, blocked provider) and for an
     insecure origin where the Geolocation API is unavailable. */
  const ip = await ipApproxLocation();
  if (ip) return { ok: true, lat: ip.lat, lng: ip.lng, approximate: true };

  return { ok: false, reason: "unavailable" };
}

/**
 * The attach menu at the head of a message composer — a WhatsApp-style sheet
 * offering Photos & files, Poll, Location and Contact. Files delegate to the
 * host's existing picker (`onPickFiles`); the other three produce a
 * `MessageCard` the host sends through the same path a text message takes
 * (`onCard`). Shared by the conversation thread and the task chat so the two
 * cannot drift.
 *
 * ## One control, not two
 *
 * This used to be a `+` sitting beside a paperclip, and the paperclip opened
 * the file picker — which is the first row of this very menu. Two buttons, a
 * pixel apart, one of them a shortcut into the other: the reader had to learn
 * which was which before they could attach anything, and there was no rule to
 * learn, because there was no real difference.
 *
 * So there is one button now, and it wears the PAPERCLIP. Attaching is what
 * people come to this control for; `+` says "more" and made the common case the
 * unlabelled one.
 */
export function CardComposer({
  people,
  onCard,
  onPickFiles,
  canPickFiles = true,
  disabled,
  submission,
}: {
  /** The directory the contact picker searches. */
  people: Employee[];
  onCard: (card: MessageCard) => void;
  onPickFiles: () => void;
  /** Whether this surface accepts file uploads. The poll, location and contact
   *  actions are always available (they send a message, not a file); the
   *  "Photos & files" row hides where uploads are not supported. */
  canPickFiles?: boolean;
  disabled?: boolean;
  /**
   * Handing work over for review, where the surface offers it.
   *
   * **Task chat only, and only for somebody who could actually submit.** The
   * same PDF can be a reference to look at or the work itself, and only the
   * sender knows which — so it is asked rather than guessed from the file.
   * Absent everywhere else: a direct message has no submission to make.
   *
   * A named prop rather than a generic slot, because this is the one extra
   * item that exists and a menu anybody can inject into is a menu nobody can
   * reason about.
   */
  submission?: { label: string; hint: string; onPick: () => void };
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [dialog, setDialog] = useState<null | "poll" | "contact">(null);
  const [locating, setLocating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  /* Rises on every location attempt; a resolution whose token is stale is
     dropped, so a slow earlier attempt can never land an error on top of a
     fresh success — the "error shown next to a shared card" bug. */
  const locateToken = useRef(0);

  useEffect(() => {
    if (!menuOpen) return;
    function onDown(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setMenuOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setMenuOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  function shareLocation() {
    setMenuOpen(false);
    setError(null);
    setLocating(true);
    const token = ++locateToken.current;
    void resolveLocation().then((r) => {
      /* A newer attempt (or a menu re-open) supersedes this one — drop its late
         outcome so a stale error can never land on top of a fresh success. */
      if (token !== locateToken.current) return;
      setLocating(false);
      if (r.ok) {
        onCard({
          kind: "location",
          lat: r.lat,
          lng: r.lng,
          /* Provenance rides on the card's own label, so an IP-derived fix is
             shown as approximate rather than passing for a precise one. */
          label: r.approximate ? "Approximate location (from your network)" : null,
        });
      } else if (r.reason === "denied") {
        setError(
          "Location is blocked for this site. Allow it in your browser (the ⓘ or lock icon by the address bar), then try again.",
        );
      } else {
        setError(
          "Your location couldn’t be determined. Turn on your device’s location service and try again.",
        );
      }
    });
  }

  /* The hint only appears where there are TWO kinds of attachment to tell
     apart. On a direct message "Photos & files" is unambiguous, and explaining
     it there would be words for their own sake. */
  const items: {
    id: string;
    label: string;
    hint?: string;
    icon: (p: { className?: string }) => React.ReactNode;
    run: () => void;
  }[] = [
    ...(canPickFiles
      ? [{
          id: "files",
          label: "Photos & files",
          hint: submission ? "Sent with your message. Nothing is reviewed." : undefined,
          icon: Icon.attach,
          run: () => { setMenuOpen(false); onPickFiles(); },
        }]
      : []),
    ...(submission
      ? [{
          id: "submission",
          label: submission.label,
          hint: submission.hint,
          icon: Icon.check,
          run: () => { setMenuOpen(false); submission.onPick(); },
        }]
      : []),
    { id: "poll", label: "Poll", icon: Icon.poll, run: () => { setMenuOpen(false); setDialog("poll"); } },
    { id: "location", label: "Location", icon: Icon.location, run: shareLocation },
    { id: "contact", label: "Contact", icon: Icon.contact, run: () => { setMenuOpen(false); setDialog("contact"); } },
  ];

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        disabled={disabled || locating}
        onClick={() => setMenuOpen((o) => !o)}
        aria-label="Attach"
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        title={
          submission
            ? "Attach a file, hand work over, or share a poll, location or contact"
            : "Attach a file, or share a poll, location or contact"
        }
        className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-ink-faint transition-colors hover:bg-[var(--control)] hover:text-ink disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:bg-transparent disabled:hover:text-ink-faint"
      >
        {locating ? (
          <Icon.sync className="h-4 w-4 animate-spin" />
        ) : (
          /* The paperclip, not a `+`. Attaching is what this is opened for;
             `+` said "more" and left the common case unlabelled. */
          <Icon.attach className="h-4 w-4" />
        )}
      </button>

      {menuOpen && (
        <div
          role="menu"
          className="absolute bottom-full left-0 z-40 mb-2 min-w-[196px] overflow-hidden rounded-panel border border-hairline bg-[var(--surface-raised)] p-1 shadow-[var(--deck-seat)]"
        >
          {items.map((it) => (
            <button
              key={it.id}
              role="menuitem"
              type="button"
              /* mousedown, not click — the composer keeps focus and the menu's
                 own outside-mousedown handler does not race the action. */
              onMouseDown={(e) => e.preventDefault()}
              onClick={it.run}
              className="flex w-full items-start gap-3 rounded-inset px-2 py-2 text-left text-sm text-ink transition-colors hover:bg-[var(--control)]"
            >
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[var(--control)] text-ink-muted">
                <it.icon className="h-4 w-4" />
              </span>
              <span className="min-w-0 flex-1 self-center">
                <span className="block">{it.label}</span>
                {it.hint && (
                  <span className="mt-0.5 block text-[11px] leading-snug text-ink-muted">
                    {it.hint}
                  </span>
                )}
              </span>
            </button>
          ))}
        </div>
      )}

      {error && (
        <div
          role="alert"
          className="absolute bottom-full left-0 z-40 mb-2 w-max max-w-[240px] rounded-inset border border-hairline bg-[var(--surface-raised)] px-3 py-2 text-[12px] leading-snug text-ink shadow-[var(--deck-seat)]"
        >
          {error}
          <button
            type="button"
            onClick={() => setError(null)}
            className="mt-1 block text-[11px] text-ink-faint underline hover:text-ink"
          >
            Dismiss
          </button>
        </div>
      )}

      {dialog === "poll" && (
        <PollDialog
          onClose={() => setDialog(null)}
          onSubmit={(card) => {
            setDialog(null);
            onCard(card);
          }}
        />
      )}
      {dialog === "contact" && (
        <ContactDialog
          people={people}
          onClose={() => setDialog(null)}
          onPick={(card) => {
            setDialog(null);
            onCard(card);
          }}
        />
      )}
    </div>
  );
}

/* ── Poll ─────────────────────────────────────────────────────────────────── */

const MAX_OPTIONS = 10;

function PollDialog({
  onClose,
  onSubmit,
}: {
  onClose: () => void;
  onSubmit: (card: MessageCard) => void;
}) {
  const [question, setQuestion] = useState("");
  const [options, setOptions] = useState<string[]>(["", ""]);
  const [multiple, setMultiple] = useState(false);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const filled = options.map((o) => o.trim()).filter(Boolean);
  const ready = question.trim().length > 0 && filled.length >= 2;

  function setOption(i: number, value: string) {
    setOptions((prev) => prev.map((o, idx) => (idx === i ? value : o)));
  }
  function addOption() {
    setOptions((prev) => (prev.length >= MAX_OPTIONS ? prev : [...prev, ""]));
  }
  function removeOption(i: number) {
    setOptions((prev) => (prev.length <= 2 ? prev : prev.filter((_, idx) => idx !== i)));
  }

  function submit() {
    if (!ready) return;
    const opts: MessagePollOption[] = filled.map((text, i) => ({
      id: `opt-${i}`,
      text,
      votes: [],
    }));
    onSubmit({ kind: "poll", question: question.trim(), options: opts, multiple });
  }

  if (typeof document === "undefined") return null;
  return createPortal(
    <div
      className="fixed inset-0 z-[80] grid place-items-center bg-black/45 p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Create a poll"
        className="frost-bar flex max-h-[min(600px,88vh)] w-full max-w-md flex-col overflow-hidden rounded-panel border border-hairline shadow-[var(--deck-seat)]"
      >
        <div className="border-b border-hairline px-4 py-3">
          <p className="text-sm font-medium text-ink">New poll</p>
        </div>
        <div className="flex-1 space-y-3 overflow-y-auto px-4 py-3">
          <label className="block">
            <span className="mb-1 block text-[12px] text-ink-muted">Question</span>
            <input
              autoFocus
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="Ask something…"
              className="w-full rounded-inset bg-[var(--surface-sunken)] px-3 py-2 text-sm text-ink outline-none placeholder:text-ink-faint focus-visible:ring-2 focus-visible:ring-ink"
            />
          </label>
          <div>
            <span className="mb-1 block text-[12px] text-ink-muted">Options</span>
            <div className="space-y-2">
              {options.map((o, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input
                    value={o}
                    onChange={(e) => setOption(i, e.target.value)}
                    placeholder={`Option ${i + 1}`}
                    className="w-full rounded-inset bg-[var(--surface-sunken)] px-3 py-2 text-sm text-ink outline-none placeholder:text-ink-faint focus-visible:ring-2 focus-visible:ring-ink"
                  />
                  {options.length > 2 && (
                    <button
                      type="button"
                      onClick={() => removeOption(i)}
                      aria-label={`Remove option ${i + 1}`}
                      className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-ink-faint hover:bg-[var(--control)] hover:text-ink"
                    >
                      <Icon.close className="h-4 w-4" />
                    </button>
                  )}
                </div>
              ))}
            </div>
            {options.length < MAX_OPTIONS && (
              <button
                type="button"
                onClick={addOption}
                className="mt-2 flex items-center gap-1.5 text-[13px] text-ink-muted hover:text-ink"
              >
                <Icon.plus className="h-3.5 w-3.5" /> Add option
              </button>
            )}
          </div>
          <label className="flex cursor-pointer items-center gap-2 text-[13px] text-ink">
            <input
              type="checkbox"
              checked={multiple}
              onChange={(e) => setMultiple(e.target.checked)}
              className="h-4 w-4 accent-[var(--accent,#1a73e8)]"
            />
            Allow more than one answer
          </label>
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-hairline px-4 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-inset px-3 py-2 text-sm text-ink-muted hover:bg-[var(--control)]"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={!ready}
            className="rounded-inset bg-ink px-3 py-2 text-sm font-medium text-[var(--surface)] disabled:cursor-not-allowed disabled:opacity-45"
          >
            Send poll
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/* ── Contact ──────────────────────────────────────────────────────────────── */

function ContactDialog({
  people,
  onClose,
  onPick,
}: {
  people: Employee[];
  onClose: () => void;
  onPick: (card: MessageCard) => void;
}) {
  const [query, setQuery] = useState("");

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const list = needle
      ? people.filter((p) =>
          [p.displayName, p.designation ?? "", p.departmentName ?? "", p.email ?? ""]
            .join(" ")
            .toLowerCase()
            .includes(needle),
        )
      : people;
    return [...list].sort((a, b) => a.displayName.localeCompare(b.displayName)).slice(0, 60);
  }, [people, query]);

  function pick(p: Employee) {
    onPick({
      kind: "contact",
      employeeId: p.id,
      name: p.displayName,
      role: p.designation ?? p.departmentName ?? null,
      email: p.email ?? null,
      phone: null,
    });
  }

  if (typeof document === "undefined") return null;
  return createPortal(
    <div
      className="fixed inset-0 z-[80] grid place-items-center bg-black/45 p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Share a contact"
        className="frost-bar flex max-h-[min(560px,85vh)] w-full max-w-md flex-col overflow-hidden rounded-panel border border-hairline shadow-[var(--deck-seat)]"
      >
        <div className="border-b border-hairline px-4 py-3">
          <p className="text-sm font-medium text-ink">Share a contact</p>
        </div>
        <div className="border-b border-hairline px-4 py-2.5">
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search people"
            aria-label="Search people"
            className="w-full rounded-inset bg-[var(--surface-sunken)] px-3 py-2 text-sm text-ink outline-none placeholder:text-ink-faint focus-visible:ring-2 focus-visible:ring-ink"
          />
        </div>
        <div className="flex-1 overflow-y-auto p-1">
          {rows.length === 0 ? (
            <p className="px-3 py-6 text-center text-sm text-ink-faint">No one matches “{query}”.</p>
          ) : (
            rows.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => pick(p)}
                className="flex w-full items-center gap-3 rounded-inset px-2 py-2 text-left hover:bg-[var(--control)]"
              >
                <Avatar
                  initials={p.initials}
                  hue={p.hue}
                  src={p.profilePictureUrl}
                  name={p.displayName}
                  size="sm"
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm text-ink">{p.displayName}</span>
                  {(p.designation ?? p.departmentName) && (
                    <span className="block truncate text-[11px] text-ink-faint">
                      {p.designation ?? p.departmentName}
                    </span>
                  )}
                </span>
              </button>
            ))
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
