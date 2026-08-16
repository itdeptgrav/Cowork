/**
 * Hyperlinks — the URL layer over a cell.
 *
 * A link is kept SEPARATE from the cell's value: the worksheet holds a sparse
 * `links: Record<A1ref, url>` map, so a cell can show its own text while
 * carrying a URL underneath, and clearing the value never orphans the link.
 * This module is the pure part: recognising a URL in typed text (so a pasted or
 * typed address links itself), and normalising a URL to something safe to open.
 *
 * Only http and https and mailto links are produced. A bare "www.example.com"
 * or "example.com/path" is promoted to https; anything with a script-ish scheme
 * (javascript:, data:) is rejected, so a link can never smuggle in code.
 */

/** Schemes a link is allowed to use. */
const SAFE_SCHEME = /^(https?:|mailto:)/i;
/** A leading scheme of any kind, to tell "has a scheme" from "bare domain". */
const ANY_SCHEME = /^[a-z][a-z0-9+.-]*:/i;
/** A plausible bare domain: label(.label)+ optionally followed by a path. */
const BARE_DOMAIN = /^[a-z0-9-]+(\.[a-z0-9-]+)+(\/\S*)?$/i;
/** A plausible email address, for mailto promotion. */
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * A URL made safe to open, or null when the text is not a linkable address.
 * Adds `https://` to a bare domain and `mailto:` to a bare email; passes an
 * explicit http/https/mailto through untouched; rejects everything else.
 */
export function normalizeUrl(raw: string): string | null {
  const text = raw.trim();
  if (text === "") return null;
  if (SAFE_SCHEME.test(text)) return text;
  if (ANY_SCHEME.test(text)) return null; // some other scheme — not allowed
  if (EMAIL.test(text)) return `mailto:${text}`;
  if (BARE_DOMAIN.test(text)) return `https://${text}`;
  return null;
}

/** Whether the text, on its own, reads as a URL this module would link. */
export function isUrl(text: string): boolean {
  return normalizeUrl(text) !== null;
}

/**
 * The URL to auto-link for a freshly typed/pasted cell value, or null. A value
 * is auto-linked only when the WHOLE cell is a single URL — embedding a link in
 * a sentence is an explicit "Insert link", not a detection.
 */
export function detectUrl(value: string): string | null {
  return normalizeUrl(value);
}

/** The link on a cell, or undefined. */
export function linkAt(
  links: Record<string, string> | undefined,
  ref: string,
): string | undefined {
  return links?.[ref];
}

/** Set (or clear, when url is null) a cell's link, returning a NEW map — or the
    same reference when nothing changes, so callers can skip a no-op. */
export function setLink(
  links: Record<string, string> | undefined,
  ref: string,
  url: string | null,
): Record<string, string> | undefined {
  const current = links?.[ref];
  if (url === null) {
    if (!links || !(ref in links)) return links;
    const next = { ...links };
    delete next[ref];
    return Object.keys(next).length ? next : undefined;
  }
  if (current === url) return links;
  return { ...(links ?? {}), [ref]: url };
}
