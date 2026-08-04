import type { ReactNode } from "react";

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
