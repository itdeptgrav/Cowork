import type { LinkPreview } from "@/lib/domain";

/**
 * Reading and writing a message's `linkPreview`, and finding the URL to
 * preview in the first place — kept apart from the message readers the same
 * way `card.ts` is, and for the same two reasons: both the conversation
 * thread and (eventually) task chat need to read the stored shape back
 * identically, and the render path must never throw on a malformed
 * document — a partial or hand-edited preview reads as "no preview" rather
 * than crashing the bubble.
 */

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);

/**
 * The same URL a message bubble already linkifies — see
 * `lib/utils/linkify.tsx`'s `URL_PATTERN`. Duplicated rather than imported:
 * that file renders JSX and lives in `lib/utils`, this one is pure logic
 * used by both the composer and the repositories, and the two constants are
 * simple enough that keeping them independently is cheaper than routing a
 * rules-layer import through a render-layer module.
 */
const URL_PATTERN = /https?:\/\/[^\s<>"']+/;
const TRAILING_PUNCTUATION = /[.,!?;:'")\]]+$/;

/**
 * The first URL in a message draft, trailing sentence punctuation trimmed —
 * or null when the text has none.
 *
 * Only the FIRST: a message can carry several links, and previewing every
 * one would turn a two-sentence message with three links into a wall of
 * cards. iMessage, WhatsApp and Slack all preview only the first link found,
 * and this follows the same convention — the rest still linkify as plain
 * clickable text, they just do not get their own card.
 */
export function firstUrl(text: string): string | null {
  const match = URL_PATTERN.exec(text);
  if (!match) return null;
  const trailing = match[0].match(TRAILING_PUNCTUATION);
  const url = trailing ? match[0].slice(0, match[0].length - trailing[0].length) : match[0];
  return url || null;
}

/** Defensively read a stored preview off a message document. `undefined`
 *  for anything malformed — missing a URL or a domain is not a preview
 *  worth keeping, since neither can be recovered by falling back to a
 *  default the way a title or an image can. */
export function readLinkPreview(raw: unknown): LinkPreview | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const p = raw as Record<string, unknown>;
  const url = str(p.url);
  const domain = str(p.domain);
  if (!url || !domain) return undefined;
  return {
    url,
    finalUrl: str(p.finalUrl),
    domain,
    title: str(p.title),
    description: str(p.description),
    image: str(p.image),
    favicon: str(p.favicon),
    siteName: str(p.siteName),
  };
}

/** Normalise a preview for storage: Firestore rejects `undefined`, so every
 *  optional field is written as an explicit `null`. */
export function linkPreviewForWrite(preview: LinkPreview): Record<string, unknown> {
  return {
    url: preview.url,
    finalUrl: preview.finalUrl ?? null,
    domain: preview.domain,
    title: preview.title ?? null,
    description: preview.description ?? null,
    image: preview.image ?? null,
    favicon: preview.favicon ?? null,
    siteName: preview.siteName ?? null,
  };
}

/**
 * Whether a preview has enough to draw a card of its own.
 *
 * The domain alone — what a fetch that found nothing still returns — is not
 * worth a card: the bare link already sitting in the message text says the
 * same thing, and a card with only a hostname in it would read as a bug
 * rather than a feature. A preview needs a title, a description or an
 * image before it earns a place in the bubble; anything short of that falls
 * back to the plain clickable URL the text already carries.
 */
export function hasPreviewContent(
  preview: Pick<LinkPreview, "title" | "description" | "image">,
): boolean {
  return Boolean(preview.title || preview.description || preview.image);
}
