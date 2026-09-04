/**
 * Links in a document: what a typed address becomes, and what is safe to open.
 *
 * **A document is shared, so a link in it came from somebody else.** That is
 * the whole reason this file is careful. `javascript:` in an href runs code in
 * the reader's session the moment they click it, and a document is exactly the
 * place a colleague would not think twice before clicking. So the scheme is
 * decided here, once, and both the editor and the bubble that opens links use
 * the same answer.
 */

/** Schemes a link in a document may use. Everything else is refused. */
const SAFE_SCHEMES = ["http:", "https:", "mailto:", "tel:"] as const;

/**
 * A link to a bookmark in the same document: `#` and the bookmark's id. The
 * id is a slug (`bookmarkId()` in the bookmark extension), so a fragment is
 * safe to keep as it is and never needs a scheme.
 */
const FRAGMENT = /^#[a-z0-9][a-z0-9_-]{0,63}$/i;

export function isFragmentHref(href: string | null | undefined): boolean {
  return FRAGMENT.test(String(href ?? "").trim());
}

/**
 * What the user typed, turned into an address a browser can follow.
 *
 * A bare `example.com` becomes `https://example.com`, because typing the
 * scheme is not something anybody does and a link that silently fails is worse
 * than one that guessed. An address that already names a scheme keeps it. An
 * empty or unsafe address returns null, which the caller reads as "do not make
 * this a link".
 */
export function normaliseHref(input: string): string | null {
  const raw = String(input ?? "").trim();
  if (!raw) return null;
  if (isFragmentHref(raw)) return raw;

  const hasScheme = /^[a-z][a-z0-9+.-]*:/i.test(raw);

  /* An email address typed on its own is a mailto:, which is what somebody
     typing one into a link box means. Asked only of an address that does NOT
     already name a scheme — `mailto:sam@example.com` satisfies "looks like an
     email" too, and prefixing it again gives `mailto:mailto:…`. */
  if (!hasScheme && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw)) {
    return `mailto:${raw}`;
  }

  const withScheme = hasScheme ? raw : `https://${raw}`;

  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return null;
  }
  if (!SAFE_SCHEMES.includes(url.protocol as (typeof SAFE_SCHEMES)[number])) {
    return null;
  }
  /* `https://` alone parses, and points nowhere. */
  if (/^https?:$/.test(url.protocol) && !url.hostname) return null;
  return url.toString();
}

/**
 * Is this href safe to follow?
 *
 * Asked again at the moment of opening rather than trusted from when it was
 * written: a document is a shared CRDT, and its HTML can also arrive from an
 * import or a paste, so an href in the document was not necessarily put there
 * by `normaliseHref`.
 */
export function isSafeHref(href: string | null | undefined): boolean {
  const raw = String(href ?? "").trim();
  if (!raw) return false;
  if (isFragmentHref(raw)) return true;
  try {
    const url = new URL(raw);
    return SAFE_SCHEMES.includes(url.protocol as (typeof SAFE_SCHEMES)[number]);
  } catch {
    return false;
  }
}

/**
 * The short form shown on the link bubble.
 *
 * The host and nothing else for a web address, because the bubble is a
 * confirmation of where a click would go and a hundred-character tracking URL
 * confirms nothing. `mailto:` and `tel:` show what they address, since for
 * those the whole point IS the rest of the string.
 */
export function linkLabel(href: string | null | undefined): string {
  const raw = String(href ?? "").trim();
  if (!raw) return "";
  /* A bookmark: its slug read back as words, since the name itself is not
     in the href. */
  if (isFragmentHref(raw)) return `In this document: ${raw.slice(1).replace(/^bm-/, "").replace(/-/g, " ")}`;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return raw;
  }
  if (url.protocol === "mailto:") return decodeURIComponent(url.pathname);
  if (url.protocol === "tel:") return decodeURIComponent(url.pathname);

  const host = url.hostname.replace(/^www\./, "");
  const path = url.pathname === "/" ? "" : url.pathname;
  const shown = `${host}${path}`;
  return shown.length > 48 ? `${shown.slice(0, 47)}…` : shown;
}

/**
 * The window features a document link is opened with.
 *
 * `noopener` is not decoration: without it the page you opened gets a handle
 * on the tab it came from and can navigate it somewhere else, which on a
 * signed-in workspace is a way to put a convincing fake login in front of
 * somebody who did nothing but click a link in a colleague's document.
 */
export const LINK_WINDOW_FEATURES = "noopener,noreferrer";
