"use client";

import { useState } from "react";
import { driveImageSources } from "@/lib/rules/media/driveUrls";

/**
 * A Drive-hosted image, with the fallback chain that makes it appear.
 *
 * **Drive will not render its own files in an `<img>`.** The reasoning, and the
 * ordered list of sources, live in `lib/rules/media/driveUrls.ts` — this is the
 * component that walks the list. First Google's `lh3` CDN, then the backend's
 * byte proxy, then whatever URL was stored.
 *
 * The walk is not decoration. A file uploaded a second ago 404s on the CDN until
 * Google indexes it, which is precisely the moment somebody is looking at the
 * message they just sent. Without the second source the image is broken for
 * exactly as long as they are watching it.
 *
 * Shared rather than reimplemented per feature: this used to live inside
 * `MessageAttachments`, so the mind map and the document editor — which had no
 * upload at all — had nothing to copy even if they had wanted to.
 */
export function DriveImage({
  fileId,
  url,
  alt,
  width,
  className,
  style,
  apiBase = process.env.NEXT_PUBLIC_LEGACY_API_URL,
  onExhausted,
}: {
  fileId?: string | null;
  /** The stored URL. Used as the last source, and to recover an id from. */
  url?: string | null;
  alt: string;
  /** Delivered width asked of the CDN. Not a layout size. */
  width?: number;
  className?: string;
  /**
   * Inline layout, for a caller whose sizing is computed rather than a class.
   *
   * A spreadsheet cell is the case: its `object-fit` follows the IMAGE
   * formula's mode argument and its box follows the row and column, so neither
   * can be a Tailwind class.
   */
  style?: React.CSSProperties;
  apiBase?: string | null;
  /** Called when every source has failed, so a caller can show its own state. */
  onExhausted?: () => void;
}) {
  const sources = driveImageSources({ fileId, url, apiBase, width });
  /* An index rather than a URL, so "which have we tried" is a number and the
     component cannot loop between two sources that both fail. */
  const [attempt, setAttempt] = useState(0);

  const src = sources[attempt];
  if (!src) return null;

  return (
    /* eslint-disable-next-line @next/next/no-img-element */
    <img
      src={src}
      alt={alt}
      className={className}
      style={style}
      onError={() => {
        if (attempt + 1 < sources.length) {
          setAttempt(attempt + 1);
          return;
        }
        onExhausted?.();
      }}
    />
  );
}
