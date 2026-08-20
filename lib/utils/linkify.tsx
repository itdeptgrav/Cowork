import type { ReactNode } from "react";
import { detectPhoneNumbers } from "@/lib/rules/messages/phoneNumbers";

/**
 * Turn `http(s)://…` runs inside plain text into clickable links.
 *
 * Message text is stored and edited as plain text — there is no rich-text
 * mode to author a link in, so a URL somebody pastes or types has no way to
 * become clickable except by being recognised after the fact. `target="_blank"`
 * pairs with `rel="noopener noreferrer"` because a message bubble opens
 * whatever anybody in the thread pasted, not just links the app itself wrote.
 */
const URL_PATTERN = /(https?:\/\/[^\s<>"']+)/g;

/** Punctuation a sentence puts AFTER a URL that the URL itself did not ask for. */
const TRAILING_PUNCTUATION = /[.,!?;:'")\]]+$/;

export function linkify(text: string, linkClassName = ""): ReactNode[] {
  const parts = text.split(URL_PATTERN);
  const out: ReactNode[] = [];
  parts.forEach((part, i) => {
    /* `split` on a single-group pattern alternates plain text and captures:
       even indices are the text between matches, odd indices are the URLs. */
    if (i % 2 === 0) {
      if (part) out.push(part);
      return;
    }
    const trailingMatch = part.match(TRAILING_PUNCTUATION);
    const trailing = trailingMatch ? trailingMatch[0] : "";
    const url = trailing ? part.slice(0, part.length - trailing.length) : part;
    if (!url) {
      /* The "URL" was entirely punctuation — not a real match. Left as text. */
      out.push(part);
      return;
    }
    out.push(
      <a
        key={`link-${i}`}
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className={linkClassName}
      >
        {url}
      </a>,
    );
    if (trailing) out.push(trailing);
  });
  return out;
}

/**
 * `linkify`, plus phone numbers as `tel:` links — the message-bubble variant.
 *
 * URLs are recognised first and phone detection runs only over the plain-text
 * stretches between them, so digits INSIDE a pasted URL can never be re-read
 * as a phone number. What counts as a phone number — and, more importantly,
 * what does not (dates, task figures, decimals) — is decided by
 * `lib/rules/messages/phoneNumbers.ts`, not here.
 *
 * A separate function rather than a change to `linkify`: other surfaces render
 * URLs only, and giving every one of them call links because the chat wanted
 * them would be a behaviour change nobody asked those surfaces for.
 */
export function linkifyMessage(text: string, linkClassName = ""): ReactNode[] {
  const out: ReactNode[] = [];
  linkify(text, linkClassName).forEach((part, i) => {
    if (typeof part !== "string") {
      out.push(part);
      return;
    }
    let at = 0;
    detectPhoneNumbers(part).forEach((match, j) => {
      if (match.index > at) out.push(part.slice(at, match.index));
      out.push(
        <a
          key={`tel-${i}-${j}`}
          href={match.href}
          className={linkClassName}
        >
          {match.text}
        </a>,
      );
      at = match.index + match.text.length;
    });
    if (at < part.length) out.push(part.slice(at));
  });
  return out;
}
